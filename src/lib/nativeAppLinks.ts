import { App as CapacitorApp, type URLOpenListenerEvent } from '@capacitor/app';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { normalizeHeartRateAccountBlockCode } from './heartRateAccountBlock';
import { normalizeHeartRateStudioInviteCode } from './heartRateCloud';
import { normalizeTrackLocatorId, trackLocatorShareUrl } from './mapLinks';

export const trackLabUniversalLinkHost = 'tracklab-bmx.onrender.com' as const;

type AppUrlListener = (
  eventName: 'appUrlOpen',
  listener: (event: URLOpenListenerEvent) => void,
) => Promise<PluginListenerHandle>;

type AppLaunchUrl = () => Promise<{ url?: string }>;

function productionAppLink(value: unknown) {
  if (typeof value !== 'string' || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === trackLabUniversalLinkHost
      && !url.port
      && (url.pathname === '/' || url.pathname === '')
      ? url
      : null;
  } catch {
    return null;
  }
}

export function heartRateStudioInviteCodeFromAppLink(value: unknown) {
  const url = productionAppLink(value);
  return url ? normalizeHeartRateStudioInviteCode(url.searchParams.get('heartRateStudioInvite')) : '';
}

export function heartRateAccountBlockCodeFromAppLink(value: unknown) {
  const url = productionAppLink(value);
  if (!url) return '';
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
  return normalizeHeartRateAccountBlockCode(fragment.get('heartRateAccountBlock'));
}

export function trackLocatorIdFromAppLink(value: unknown) {
  const url = productionAppLink(value);
  return url ? normalizeTrackLocatorId(url.searchParams.get('locator')) : '';
}

/**
 * Accepts only the production TrackLab HTTPS universal-link origin and emits
 * the normalized one-use invitation code. The raw URL is never logged or
 * persisted by this bridge.
 */
export async function listenForHeartRateStudioInviteAppLinks(
  onInvite: (inviteCode: string) => void,
  options: {
    isNativePlatform?: () => boolean;
    addListener?: AppUrlListener;
    getLaunchUrl?: AppLaunchUrl;
    onTrackLocator?: (trackId: string) => void;
  } = {},
): Promise<PluginListenerHandle> {
  const isNativePlatform = options.isNativePlatform ?? (() => Capacitor.isNativePlatform());
  if (!isNativePlatform()) return { remove: async () => undefined };
  const addListener = options.addListener ?? CapacitorApp.addListener.bind(CapacitorApp);
  const getLaunchUrl = options.getLaunchUrl ?? CapacitorApp.getLaunchUrl.bind(CapacitorApp);
  let lastDisposition = '';
  let lastTrackDispositionAt = 0;
  const handleUrl = (value: unknown) => {
    const inviteCode = heartRateStudioInviteCodeFromAppLink(value);
    if (inviteCode && lastDisposition !== `invite:${inviteCode}`) {
      lastDisposition = `invite:${inviteCode}`;
      onInvite(inviteCode);
      return;
    }
    const trackId = trackLocatorIdFromAppLink(value);
    const disposition = `track:${trackId}`;
    const now = Date.now();
    if (!trackId || (lastDisposition === disposition && now - lastTrackDispositionAt < 1_000)) return;
    lastDisposition = disposition;
    lastTrackDispositionAt = now;
    const href = typeof window === 'undefined' ? '' : trackLocatorShareUrl(trackId, window.location.origin);
    if (href) {
      window.history.replaceState(window.history.state, '', href);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
    options.onTrackLocator?.(trackId);
  };
  const listener = await addListener('appUrlOpen', (event) => handleUrl(event.url));
  void getLaunchUrl().then((launch) => handleUrl(launch?.url)).catch(() => undefined);
  return listener;
}

/**
 * Accepts only the production TrackLab HTTPS universal-link origin and emits
 * the normalized one-use account handoff code without logging the raw URL.
 */
export async function listenForHeartRateAccountBlockAppLinks(
  onHandoff: (pairCode: string) => void,
  options: {
    isNativePlatform?: () => boolean;
    addListener?: AppUrlListener;
  } = {},
): Promise<PluginListenerHandle> {
  const isNativePlatform = options.isNativePlatform ?? (() => Capacitor.isNativePlatform());
  if (!isNativePlatform()) return { remove: async () => undefined };
  const addListener = options.addListener ?? CapacitorApp.addListener.bind(CapacitorApp);
  return addListener('appUrlOpen', (event) => {
    const pairCode = heartRateAccountBlockCodeFromAppLink(event.url);
    if (pairCode) onHandoff(pairCode);
  });
}
