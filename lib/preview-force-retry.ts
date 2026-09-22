/**
 * Preview-only recovery probe. Production hostnames never honor this.
 * Used to exercise Retry on a healthy frame without claiming the build failed.
 */

const PRODUCTION_HOSTS = new Set(['inzone.games', 'www.inzone.games']);

export function isPreviewForceRetryHost(hostname: string): boolean {
  const host = (hostname || '').trim().toLowerCase();
  if (!host || PRODUCTION_HOSTS.has(host)) return false;
  return host.endsWith('.vercel.app') || host === 'localhost' || host === '127.0.0.1';
}

export function previewForceRetryRequested(
  search: { get(name: string): string | null },
  hostname: string,
): boolean {
  if (!isPreviewForceRetryHost(hostname)) return false;
  return search.get('previewForceRetry') === '1';
}
