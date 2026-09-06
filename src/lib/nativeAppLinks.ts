import { childDeviceTokenFromHref } from './childDevices';
import { App as CapacitorApp, type URLOpenListenerEvent } from '@capacitor/app';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { normalizeHeartRateAccountBlockCode } from './heartRateAccountBlock';
import { normalizeHeartRateStudioInviteCode } from './heartRateCloud';
import { normalizeTrackLocatorId } from './mapLinks';
import { betaInviteTokenFromHref } from './betaAccess';
import { familyInviteTokenFromHref } from './familyAccounts';

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

export function betaInviteTokenFromAppLink(value: unknown) {
  const url = productionAppLink(value);
  return url ? betaInviteTokenFromHref(url.href) : '';
}

export function familyInviteTokenFromAppLink(value: unknown) {
  const url = productionAppLink(value);
  return url ? familyInviteTokenFromHref(url.href) : '';
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
    onBetaInvite?: (token: string) => void;
    onFamilyInvite?: (token: string) => void;
    onChildDevice?: (token: string) => void;
    onClubInvite?: (token: string) => void;
  } = {},
): Promise<PluginListenerHandle> {
  const isNativePlatform = options.isNativePlatform ?? (() => Capacitor.isNativePlatform());
  if (!isNativePlatform()) return { remove: async () => undefined };
  const addListener = options.addListener ?? CapacitorApp.addListener.bind(CapacitorApp);
  const getLaunchUrl = options.getLaunchUrl ?? CapacitorApp.getLaunchUrl.bind(CapacitorApp);
  let lastDisposition = '';
  let lastBetaDispositionAt = 0;
  let lastFamilyDispositionAt = 0;
  let lastChildDispositionAt = 0;
  let lastClubDispositionAt = 0;
  let lastTrackDispositionAt = 0;
  const handleUrl = (value: unknown) => {
    const url = productionAppLink(value);
    const childToken = url ? childDeviceTokenFromHref(url.href) : '';
    const clubToken = url ? new URLSearchParams(url.hash.slice(1)).get('clubInvite') || url.searchParams.get('clubInvite') || '' : '';
    if (childToken && options.onChildDevice) { const now = Date.now(); if (lastDisposition !== `child:${childToken}` || now - lastChildDispositionAt >= 1000) { lastDisposition = `child:${childToken}`; lastChildDispositionAt = now; options.onChildDevice(childToken); } return; }
    if (/^[A-Za-z0-9_-]{43}$/.test(clubToken) && options.onClubInvite) { const now = Date.now(); if (lastDisposition !== `club:${clubToken}` || now - lastClubDispositionAt >= 1000) { lastDisposition = `club:${clubToken}`; lastClubDispositionAt = now; options.onClubInvite(clubToken); } return; }
    const familyToken = familyInviteTokenFromAppLink(value);
    if (familyToken && options.onFamilyInvite) {
      const now = Date.now();
      if (lastDisposition !== `family:${familyToken}` || now - lastFamilyDispositionAt >= 1_000) {
        lastDisposition = `family:${familyToken}`;
        lastFamilyDispositionAt = now;
        options.onFamilyInvite(familyToken);
      }
      return;
    }
    const betaToken = betaInviteTokenFromAppLink(value);
    if (betaToken && options.onBetaInvite) {
      const now = Date.now();
      if (lastDisposition !== `beta:${betaToken}` || now - lastBetaDispositionAt >= 1_000) {
        lastDisposition = `beta:${betaToken}`;
        lastBetaDispositionAt = now;
        options.onBetaInvite(betaToken);
      }
      return;
    }
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
    if (typeof window !== 'undefined') {
      const href = new URL(window.location.href);
      href.searchParams.set('locator', trackId);
      href.hash = 'track-locator';
      window.history.replaceState(
        window.history.state,
        '',
        `${href.pathname}${href.search}${href.hash}`,
      );
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
