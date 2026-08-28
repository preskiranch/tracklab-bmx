const defaultRateLimitWindowMs = 15 * 60 * 1000;
const maxRateLimitEntries = 10_000;
export const trackLabCapacitorOrigin = 'capacitor://localhost';

const nativeCorsMethods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const nativeCorsHeaders = new Map([
  ['accept', 'Accept'],
  ['authorization', 'Authorization'],
  ['content-type', 'Content-Type'],
  ['x-tracklab-native-session', 'X-TrackLab-Native-Session'],
  ['x-tracklab-club-tablet-session', 'X-TrackLab-Club-Tablet-Session'],
  ['x-tracklab-club-tablet-result-token', 'X-TrackLab-Club-Tablet-Result-Token'],
  ['x-tracklab-group-completion-token', 'X-TrackLab-Group-Completion-Token'],
  ['x-tracklab-monitor-save-token', 'X-TrackLab-Monitor-Save-Token'],
]);

function firstHeaderValue(value) {
  return String(value || '').split(',')[0].trim();
}

export function requestClientIp(request) {
  return firstHeaderValue(request.headers['x-forwarded-for'])
    || request.socket?.remoteAddress
    || 'unknown';
}

export function publicRequestOrigin(request) {
  const protocol = firstHeaderValue(request.headers['x-forwarded-proto'])
    || (request.socket?.encrypted ? 'https' : 'http');
  const host = firstHeaderValue(request.headers['x-forwarded-host'])
    || firstHeaderValue(request.headers.host);

  if (!host || !/^[a-zA-Z0-9.:[\]-]+(?::\d+)?$/.test(host)) {
    return null;
  }

  try {
    return new URL(`${protocol === 'https' ? 'https' : 'http'}://${host}`).origin;
  } catch {
    return null;
  }
}

export function mutationOriginAllowed(request) {
  const origin = firstHeaderValue(request.headers.origin);
  // WKWebView correctly labels its HTTPS service call as cross-site. The exact
  // non-HTTP Capacitor origin cannot be asserted by an ordinary website.
  if (origin === trackLabCapacitorOrigin) return true;
  const fetchSite = firstHeaderValue(request.headers['sec-fetch-site']).toLowerCase();
  if (fetchSite === 'cross-site') {
    return false;
  }

  if (!origin) {
    return true;
  }

  const expectedOrigin = publicRequestOrigin(request);
  if (!expectedOrigin) {
    return false;
  }

  try {
    return new URL(origin).origin === expectedOrigin;
  } catch {
    return false;
  }
}

export function nativeAppCorsPreflight(request) {
  if (
    firstHeaderValue(request.headers.origin) !== trackLabCapacitorOrigin
    || String(request.method || '').toUpperCase() !== 'OPTIONS'
    || !String(request.url || '').startsWith('/api/')
  ) return { native: false, allowed: false };
  const method = firstHeaderValue(request.headers['access-control-request-method']).toUpperCase();
  const requestedHeaders = String(request.headers['access-control-request-headers'] || '')
    .toLowerCase()
    .split(',')
    .map((header) => header.trim())
    .filter(Boolean);
  return {
    native: true,
    allowed: nativeCorsMethods.has(method)
      && requestedHeaders.every((header) => nativeCorsHeaders.has(header)),
  };
}

export function applyNativeAppCors(request, response) {
  if (
    firstHeaderValue(request.headers.origin) !== trackLabCapacitorOrigin
    || !String(request.url || '').startsWith('/api/')
  ) return false;
  response.setHeader('Access-Control-Allow-Origin', trackLabCapacitorOrigin);
  response.setHeader('Access-Control-Allow-Methods', [...nativeCorsMethods].join(', '));
  response.setHeader('Access-Control-Allow-Headers', [...nativeCorsHeaders.values()].join(', '));
  response.setHeader('Access-Control-Max-Age', '600');
  response.setHeader('Vary', 'Origin');
  return true;
}

export function applySecurityHeaders(request, response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('Permissions-Policy', 'camera=(), geolocation=(self), microphone=(self), fullscreen=(self)');

  const origin = publicRequestOrigin(request);
  if (origin?.startsWith('https://')) {
    response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

export function createRateLimiter({
  windowMs = defaultRateLimitWindowMs,
  maxEntries = maxRateLimitEntries,
} = {}) {
  const buckets = new Map();
  let checksSinceCleanup = 0;

  const cleanup = (now) => {
    checksSinceCleanup = 0;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) {
        buckets.delete(key);
      }
    }

    if (buckets.size <= maxEntries) {
      return;
    }

    const oldest = [...buckets.entries()]
      .sort(([, left], [, right]) => left.resetAt - right.resetAt)
      .slice(0, buckets.size - maxEntries);
    oldest.forEach(([key]) => buckets.delete(key));
  };

  return {
    check(key, limit, now = Date.now()) {
      checksSinceCleanup += 1;
      if (checksSinceCleanup >= 250 || buckets.size > maxEntries) {
        cleanup(now);
      }

      const safeLimit = Math.max(1, Math.round(Number(limit) || 1));
      const existing = buckets.get(key);
      const bucket = !existing || existing.resetAt <= now
        ? { count: 0, resetAt: now + windowMs }
        : existing;
      bucket.count += 1;
      buckets.set(key, bucket);

      return {
        allowed: bucket.count <= safeLimit,
        limit: safeLimit,
        remaining: Math.max(0, safeLimit - bucket.count),
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      };
    },
    clear() {
      buckets.clear();
    },
  };
}

export function staticCacheControl(pathname) {
  if (/^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(?:css|js|mjs|png|webp|svg)$/.test(pathname)) {
    return 'public, max-age=31536000, immutable';
  }

  if (pathname.endsWith('.html') || pathname.endsWith('.json') || pathname.endsWith('.webmanifest')) {
    return 'no-cache';
  }

  return 'public, max-age=86400';
}

export function pathIsInside(parentPath, childPath, pathModule) {
  const relative = pathModule.relative(parentPath, childPath);
  return relative === '' || (!relative.startsWith('..') && !pathModule.isAbsolute(relative));
}
