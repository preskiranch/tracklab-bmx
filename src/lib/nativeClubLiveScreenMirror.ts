import {
  Capacitor,
  registerPlugin,
} from '@capacitor/core';

export const nativeClubLiveScreenMirrorPluginName = 'TrackLabClubLiveScreenMirror' as const;

export type NativeClubLiveScreenMirrorFrame = Readonly<{
  mimeType: 'image/jpeg';
  base64: string;
  dataUrl: `data:image/jpeg;base64,${string}`;
  pixelWidth: number;
  pixelHeight: number;
  capturedAt: number;
}>;

type NativeClubLiveScreenMirrorPlugin = {
  capture: () => Promise<unknown>;
};

type CapacitorDetector = Pick<
  typeof Capacitor,
  'getPlatform' | 'isNativePlatform' | 'isPluginAvailable'
>;

const nativePlugin = registerPlugin<NativeClubLiveScreenMirrorPlugin>(
  nativeClubLiveScreenMirrorPluginName,
);
export const maximumClubLiveJpegBase64Length = Math.ceil((350 * 1_024) / 3) * 4;
let captureInFlight: Promise<NativeClubLiveScreenMirrorFrame | null> | null = null;

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function imageDimension(value: unknown) {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value > 0
    && value <= 1_280
    ? value
    : 0;
}

export function normalizeNativeClubLiveScreenMirrorFrame(
  value: unknown,
): NativeClubLiveScreenMirrorFrame | null {
  const item = record(value);
  if (!item || item.mimeType !== 'image/jpeg') return null;
  const base64 = typeof item.base64 === 'string' ? item.base64.trim() : '';
  const dataUrl = typeof item.dataUrl === 'string' ? item.dataUrl.trim() : '';
  const pixelWidth = imageDimension(item.pixelWidth);
  const pixelHeight = imageDimension(item.pixelHeight);
  const capturedAt = typeof item.capturedAt === 'number'
    && Number.isSafeInteger(item.capturedAt)
    && item.capturedAt > 0
    ? item.capturedAt
    : 0;
  if (
    !base64
    || base64.length > maximumClubLiveJpegBase64Length
    || !/^[A-Za-z0-9+/]+={0,2}$/u.test(base64)
    || dataUrl !== `data:image/jpeg;base64,${base64}`
    || !pixelWidth
    || !pixelHeight
    || !capturedAt
  ) return null;
  return {
    mimeType: 'image/jpeg',
    base64,
    dataUrl: dataUrl as `data:image/jpeg;base64,${string}`,
    pixelWidth,
    pixelHeight,
    capturedAt,
  };
}

export function nativeClubLiveScreenMirrorAvailable(
  detector: CapacitorDetector = Capacitor,
) {
  try {
    return detector.getPlatform() === 'ios'
      && detector.isNativePlatform()
      && detector.isPluginAvailable(nativeClubLiveScreenMirrorPluginName);
  } catch {
    return false;
  }
}

/**
 * Captures only the visible TrackLab WKWebView. Web, Android, unavailable
 * bridges, capture failures, and malformed native responses resolve to null.
 * Concurrent callers share one native capture instead of creating a queue.
 */
export function captureNativeClubLiveScreenMirror() {
  if (!nativeClubLiveScreenMirrorAvailable()) {
    return Promise.resolve<NativeClubLiveScreenMirrorFrame | null>(null);
  }
  if (captureInFlight) return captureInFlight;

  const request = nativePlugin.capture()
    .then(normalizeNativeClubLiveScreenMirrorFrame)
    .catch(() => null)
    .finally(() => {
      if (captureInFlight === request) captureInFlight = null;
    });
  captureInFlight = request;
  return request;
}

/** Test-only state reset; it does not call the native plugin. */
export function resetNativeClubLiveScreenMirrorForTests() {
  captureInFlight = null;
}
