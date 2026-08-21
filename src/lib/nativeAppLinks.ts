import { App as CapacitorApp, type URLOpenListenerEvent } from '@capacitor/app';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { normalizeHeartRateAccountBlockCode } from './heartRateAccountBlock';
import { normalizeHeartRateStudioInviteCode } from './heartRateCloud';

export const trackLabUniversalLinkHost = 'tracklab-bmx.onrender.com' as const;

type AppUrlListener = (
  eventName: 'appUrlOpen',
  listener: (event: URLOpenListenerEvent) => void,
) => Promise<PluginListenerHandle>;

export function heartRateStudioInviteCodeFromAppLink(value: unknown) {
  if (typeof value !== 'string' || value.length > 2_048) return '';
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:'
      || url.hostname !== trackLabUniversalLinkHost
      || url.port
      || (url.pathname !== '/' && url.pathname !== '')
    ) return '';
    return normalizeHeartRateStudioInviteCode(url.searchParams.get('heartRateStudioInvite'));
  } catch {
    return '';
  }
}

export function heartRateAccountBlockCodeFromAppLink(value: unknown) {
  if (typeof value !== 'string' || value.length > 2_048) return '';
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:'
      || url.hostname !== trackLabUniversalLinkHost
      || url.port
      || (url.pathname !== '/' && url.pathname !== '')
    ) return '';
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
    return normalizeHeartRateAccountBlockCode(fragment.get('heartRateAccountBlock'));
  } catch {
    return '';
  }
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
  } = {},
): Promise<PluginListenerHandle> {
  const isNativePlatform = options.isNativePlatform ?? (() => Capacitor.isNativePlatform());
  if (!isNativePlatform()) return { remove: async () => undefined };
  const addListener = options.addListener ?? CapacitorApp.addListener.bind(CapacitorApp);
  return addListener('appUrlOpen', (event) => {
    const inviteCode = heartRateStudioInviteCodeFromAppLink(event.url);
    if (inviteCode) onInvite(inviteCode);
  });
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
