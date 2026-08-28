import { clearNativeAuthToken, loadNativeAuthToken, nativeAuthSessionAvailable } from './nativeAuthSession';
import { isTrackLabNativeShell, trackLabApiUrl } from './serviceOrigins';

const nativeSessionRequestHeader = 'X-TrackLab-Native-Session';
let originalFetch: typeof fetch | null = null;

function relativeApiPath(input: RequestInfo | URL) {
  if (typeof input === 'string') return input.startsWith('/api/') ? input : '';
  if (input instanceof URL) return input.pathname.startsWith('/api/') && input.origin === window.location.origin
    ? `${input.pathname}${input.search}`
    : '';
  try {
    const url = new URL(input.url);
    return url.pathname.startsWith('/api/') && url.origin === window.location.origin
      ? `${url.pathname}${url.search}`
      : '';
  } catch {
    return '';
  }
}

function copiedRequestInit(input: RequestInfo | URL, init: RequestInit) {
  if (!(typeof Request !== 'undefined' && input instanceof Request)) return init;
  return {
    method: input.method,
    headers: input.headers,
    body: ['GET', 'HEAD'].includes(input.method) ? undefined : input.body,
    cache: input.cache,
    credentials: input.credentials,
    integrity: input.integrity,
    keepalive: input.keepalive,
    mode: input.mode,
    redirect: input.redirect,
    referrer: input.referrer,
    referrerPolicy: input.referrerPolicy,
    signal: input.signal,
    ...init,
  } satisfies RequestInit;
}

export async function trackLabServiceFetch(
  fetcher: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: { native?: boolean; token?: string } = {},
) {
  const native = options.native ?? isTrackLabNativeShell();
  const path = native ? relativeApiPath(input) : '';
  if (!native || !path) return fetcher(input, init);

  const inherited = copiedRequestInit(input, init);
  const headers = new Headers(inherited.headers);
  const token = options.token ?? (nativeAuthSessionAvailable() ? await loadNativeAuthToken() : '');
  // Club Tablet device enrollment has its own explicitly supplied Bearer
  // credential. Never replace a narrower endpoint credential with the ambient
  // personal-account session.
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
  // The server returns a native token only to the exact Capacitor origin and
  // only when this explicit protocol marker is present.
  headers.set(nativeSessionRequestHeader, '1');
  return fetcher(trackLabApiUrl(path, true), {
    ...inherited,
    credentials: 'omit',
    headers,
  });
}

export function installTrackLabServiceTransport() {
  if (originalFetch || !isTrackLabNativeShell()) return;
  originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => (
    trackLabServiceFetch(originalFetch!, input, init)
  )) as typeof fetch;
}

/**
 * Central TrackLab cloud transport for modules that can also run before React
 * mounts. In the native shell this always uses the original fetch so the
 * request is rewritten exactly once and receives the device Keychain session.
 */
export function trackLabAuthenticatedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const fetcher = originalFetch ?? globalThis.fetch.bind(globalThis);
  return trackLabServiceFetch(fetcher, input, init);
}

export function uninstallTrackLabServiceTransportForTests() {
  if (!originalFetch) return;
  globalThis.fetch = originalFetch;
  originalFetch = null;
}

export async function clearNativeSessionAfterUnauthorized(response: Response) {
  if (response.status === 401 && isTrackLabNativeShell()) await clearNativeAuthToken();
  return response;
}
