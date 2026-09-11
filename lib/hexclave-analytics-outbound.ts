/**
 * Sanitize Hexclave analytics batches on the actual outbound fetch path.
 *
 * Hexclave's EventTracker lives on the Provider-reconstructed app and flushes
 * through `_interface.sendAnalyticsEventBatch`, which gzip-encodes the JSON
 * (`application/octet-stream`) unless `keepalive` is set. Wrapping a different
 * HexclaveClientApp never sees those bytes. This fetch wrapper is installed
 * before that client exists so automatic $page-view / $click cannot leak
 * session URLs or chat text, including gzip batches observed in production.
 */

import { sanitizeAnalyticsBatchBody } from './campaign-analytics.ts';

const INSTALL_FLAG = '__inzoneHexclaveAnalyticsFetchSanitizer';

export function isHexclaveAnalyticsBatchUrl(url: string): boolean {
  try {
    const parsed = new URL(url, 'https://r.hexclave.com');
    const path = parsed.pathname.replace(/\/+$/, '');
    return path === '/api/v1/analytics/events/batch' || path.endsWith('/analytics/events/batch');
  } catch {
    return false;
  }
}

function headerValue(headers: HeadersInit | undefined, name: string): string | null {
  if (!headers) return null;
  if (typeof Headers !== 'undefined' && headers instanceof Headers) return headers.get(name);
  if (Array.isArray(headers)) {
    const found = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return found ? found[1] : null;
  }
  const record = headers as Record<string, string>;
  const match = Object.keys(record).find((key) => key.toLowerCase() === name.toLowerCase());
  return match ? record[match] : null;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

async function bodyToUint8Array(body: BodyInit): Promise<Uint8Array> {
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    return new Uint8Array(await body.arrayBuffer());
  }
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    return new TextEncoder().encode(body.toString());
  }
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    throw new Error('Hexclave analytics fetch sanitizer cannot read FormData bodies');
  }
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
    return new Uint8Array(await new Response(body).arrayBuffer());
  }
  return new TextEncoder().encode(String(body));
}

function looksLikeGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

async function gunzipUtf8(bytes: Uint8Array): Promise<string> {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('Hexclave analytics sanitizer requires DecompressionStream for gzip batches');
  }
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

async function gzipUtf8(text: string): Promise<Uint8Array> {
  if (typeof CompressionStream !== 'function') {
    throw new Error('Hexclave analytics sanitizer requires CompressionStream for gzip batches');
  }
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function decodeHexclaveAnalyticsBody(
  body: BodyInit,
  contentType: string | null,
): Promise<{ json: string; gzip: boolean }> {
  const bytes = await bodyToUint8Array(body);
  const gzip =
    looksLikeGzip(bytes) ||
    (contentType || '').toLowerCase().includes('application/octet-stream');
  if (gzip) {
    return { json: await gunzipUtf8(bytes), gzip: true };
  }
  return { json: new TextDecoder().decode(bytes), gzip: false };
}

export async function sanitizeHexclaveAnalyticsFetchBody(
  body: BodyInit,
  contentType: string | null,
): Promise<{ body: BodyInit; contentType: string }> {
  const decoded = await decodeHexclaveAnalyticsBody(body, contentType);
  const json = sanitizeAnalyticsBatchBody(decoded.json);
  if (decoded.gzip) {
    return {
      body: (await gzipUtf8(json)) as BodyInit,
      contentType: contentType || 'application/octet-stream',
    };
  }
  return {
    body: json,
    contentType: contentType || 'application/json',
  };
}

export async function rewriteHexclaveAnalyticsFetchArgs(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<{ input: RequestInfo | URL; init?: RequestInit }> {
  const url = requestUrl(input);
  if (!isHexclaveAnalyticsBatchUrl(url)) return { input, init };

  let method = init?.method;
  let headers = init?.headers;
  let body = init?.body;
  let keepalive = init?.keepalive;
  let rest: RequestInit = init ? { ...init } : {};

  if (typeof Request !== 'undefined' && input instanceof Request) {
    method = method || input.method;
    headers = headers || input.headers;
    keepalive = keepalive ?? input.keepalive;
    if (body == null && input.method !== 'GET' && input.method !== 'HEAD') {
      body = await input.arrayBuffer();
    }
  }

  if (body == null) return { input, init };

  const contentType = headerValue(headers, 'Content-Type');
  const sanitized = await sanitizeHexclaveAnalyticsFetchBody(body, contentType);
  const nextHeaders = new Headers(headers || undefined);
  nextHeaders.set('Content-Type', sanitized.contentType);

  const nextInit: RequestInit = {
    ...rest,
    method: method || 'POST',
    headers: nextHeaders,
    body: sanitized.body,
    keepalive,
  };

  if (typeof Request !== 'undefined' && input instanceof Request) {
    return { input: url, init: nextInit };
  }
  return { input, init: nextInit };
}

type FetchWindow = Window &
  typeof globalThis & {
    [INSTALL_FLAG]?: boolean;
    fetch: typeof fetch;
  };

export function installHexclaveAnalyticsFetchSanitizer(
  target: FetchWindow | typeof globalThis = globalThis as FetchWindow,
): void {
  const holder = target as FetchWindow;
  if (typeof holder.fetch !== 'function') {
    throw new Error('Hexclave analytics fetch sanitizer requires global fetch');
  }
  if (holder[INSTALL_FLAG]) return;
  holder[INSTALL_FLAG] = true;
  const original = holder.fetch.bind(holder);
  holder.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const rewritten = await rewriteHexclaveAnalyticsFetchArgs(input, init);
    return original(rewritten.input, rewritten.init);
  }) as typeof fetch;
}

export function hexclaveAnalyticsFetchSanitizerInstalled(
  target: FetchWindow | typeof globalThis = globalThis as FetchWindow,
): boolean {
  return Boolean((target as FetchWindow)[INSTALL_FLAG]);
}
