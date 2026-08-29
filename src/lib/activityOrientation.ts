import {
  Capacitor,
  registerPlugin,
} from '@capacitor/core';
import type { AppMode } from '../types';

export const activityOrientationPluginName = 'TrackLabActivityOrientation' as const;

type ActivityOrientationPlugin = {
  setActivityMode: (options: { active: boolean }) => Promise<{ active?: unknown }>;
};

const activityOrientationPlugin = registerPlugin<ActivityOrientationPlugin>(
  activityOrientationPluginName,
);

const landscapeActivityModes = new Set<AppMode>([
  'race',
  'straight-sprint',
  'get-pulled',
  'explore',
]);

export function activityRequiresIPhoneLandscape(appMode: AppMode) {
  return landscapeActivityModes.has(appMode);
}

export function userAgentIsIPhone(userAgent: string) {
  return /\b(?:iPhone|iPod)\b/iu.test(userAgent);
}

export function currentDeviceIsIPhone() {
  if (typeof navigator === 'undefined') return false;
  return userAgentIsIPhone(navigator.userAgent);
}

export function nativeActivityOrientationAvailable() {
  try {
    return Capacitor.getPlatform() === 'ios'
      && Capacitor.isNativePlatform()
      && Capacitor.isPluginAvailable(activityOrientationPluginName);
  } catch {
    return false;
  }
}

/**
 * Restricts only the native iPhone activity surface. The web guard remains the
 * source of truth for Safari/PWA users and prompts them to physically rotate.
 */
export async function setNativeActivityLandscape(active: boolean) {
  if (!nativeActivityOrientationAvailable()) return false;
  const result = await activityOrientationPlugin.setActivityMode({ active });
  return result?.active === active;
}
