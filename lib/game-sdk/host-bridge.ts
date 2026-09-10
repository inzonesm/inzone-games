import { HostSdkError, toSdkError } from './errors.ts';
import { isSdkRequest, SDK_CHANNEL, SDK_PROTOCOL, type SdkResponse } from './protocol.ts';

export type HostMethodMap = Record<string, (payload: unknown) => Promise<unknown>>;

export type HostBridgeContext = {
  /** iframe.contentWindow currently bound as the only accepted event.source */
  boundSource: unknown;
  /** Document origin of the trusted host (not the opaque game origin). */
  allowedOrigin: string;
  methods: HostMethodMap;
  postToSource: (source: unknown, data: SdkResponse) => void;
};

/**
 * Authorize a game SDK RPC. The bound iframe window is the capability, and
 * origin must be the opaque `"null"` from a frame without `allow-same-origin`.
 * A legacy same-origin frame can read the host; those messages are rejected
 * even if `event.source` matches, so checkout never attaches to them.
 */
export function isBoundGameMessage(
  event: { source: unknown; origin: string },
  boundSource: unknown,
  _allowedOrigin?: string,
): boolean {
  if (!boundSource || event.source !== boundSource) return false;
  return event.origin === 'null';
}

export async function handleHostSdkMessage(
  event: { source: unknown; origin: string; data: unknown },
  ctx: HostBridgeContext,
): Promise<boolean> {
  if (!isSdkRequest(event.data)) return false;
  if (!isBoundGameMessage(event, ctx.boundSource, ctx.allowedOrigin)) return false;

  const req = event.data;
  const reply = (response: Omit<SdkResponse, 'channel' | 'v' | 'id' | 'type'> & { ok: boolean }) => {
    ctx.postToSource(event.source, {
      channel: SDK_CHANNEL,
      v: SDK_PROTOCOL,
      id: req.id,
      type: 'res',
      ...response,
    });
  };

  const method = ctx.methods[req.method];
  if (!method) {
    reply({
      ok: false,
      error: { code: 'INZONE_UNSUPPORTED_CAPABILITY', message: req.method },
    });
    return true;
  }

  try {
    const result = await method(req.payload);
    reply({ ok: true, result });
  } catch (error) {
    const mapped = error instanceof HostSdkError ? error : toSdkError(error);
    reply({
      ok: false,
      error: {
        code: mapped.code,
        message: mapped.message,
        outcomeUnknown: mapped.outcomeUnknown,
        requestId: mapped.requestId,
        status: mapped.status,
      },
    });
  }
  return true;
}
