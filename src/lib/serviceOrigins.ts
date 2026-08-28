import { Capacitor } from '@capacitor/core';

export const trackLabProductionOrigin = 'https://tracklab-bmx.onrender.com' as const;

function normalizedHttpsOrigin(value: unknown, fallback: string) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && url.origin === value.trim().replace(/\/$/u, '')
      ? url.origin
      : fallback;
  } catch {
    return fallback;
  }
}

/** Origin of the authenticated TrackLab cloud service. */
export const trackLabServiceOrigin = normalizedHttpsOrigin(
  import.meta.env.VITE_TRACKLAB_SERVICE_ORIGIN,
  trackLabProductionOrigin,
);

/** Origin used for links another person or application must be able to open. */
export const trackLabPublicOrigin = normalizedHttpsOrigin(
  import.meta.env.VITE_TRACKLAB_PUBLIC_ORIGIN,
  trackLabProductionOrigin,
);

export function isTrackLabNativeShell() {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function trackLabApiUrl(pathname: string, native = isTrackLabNativeShell()) {
  if (!pathname.startsWith('/api/')) return pathname;
  return native ? new URL(pathname, trackLabServiceOrigin).toString() : pathname;
}

export function trackLabPublicUrl(pathname = '/') {
  return new URL(pathname, trackLabPublicOrigin).toString();
}

export function trackLabWebSocketUrl(pathname = '/multiplayer') {
  const url = new URL(pathname, trackLabServiceOrigin);
  url.protocol = 'wss:';
  return url.toString();
}
