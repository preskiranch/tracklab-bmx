import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const nativePlugin = vi.hoisted(() => ({
  capture: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => 'ios',
    isNativePlatform: () => true,
    isPluginAvailable: (name: string) => name === 'TrackLabClubLiveScreenMirror',
  },
  registerPlugin: () => nativePlugin,
}));

import {
  captureNativeClubLiveScreenMirror,
  maximumClubLiveJpegBase64Length,
  nativeClubLiveScreenMirrorAvailable,
  normalizeNativeClubLiveScreenMirrorFrame,
  resetNativeClubLiveScreenMirrorForTests,
} from '../../src/lib/nativeClubLiveScreenMirror';

const validFrame = {
  mimeType: 'image/jpeg',
  base64: '/9j/2Q==',
  dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
  pixelWidth: 1_280,
  pixelHeight: 960,
  capturedAt: 1_788_179_696_789,
};

beforeEach(() => {
  nativePlugin.capture.mockReset();
  resetNativeClubLiveScreenMirrorForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('native Club Live screen mirror', () => {
  it('normalizes an exact JPEG frame from the visible TrackLab WebView', () => {
    expect(normalizeNativeClubLiveScreenMirrorFrame(validFrame)).toEqual(validFrame);
  });

  it('rejects malformed, oversized, mismatched, or stale-contract frame fields', () => {
    expect(normalizeNativeClubLiveScreenMirrorFrame({ ...validFrame, mimeType: 'image/png' })).toBeNull();
    expect(normalizeNativeClubLiveScreenMirrorFrame({ ...validFrame, pixelWidth: 1_281 })).toBeNull();
    expect(normalizeNativeClubLiveScreenMirrorFrame({ ...validFrame, capturedAt: '2026-08-31' })).toBeNull();
    expect(normalizeNativeClubLiveScreenMirrorFrame({ ...validFrame, dataUrl: 'data:image/jpeg;base64,AAAA' })).toBeNull();
    expect(normalizeNativeClubLiveScreenMirrorFrame({ ...validFrame, base64: '<script>' })).toBeNull();
    const oversizedBase64 = 'A'.repeat(maximumClubLiveJpegBase64Length + 4);
    expect(normalizeNativeClubLiveScreenMirrorFrame({
      ...validFrame,
      base64: oversizedBase64,
      dataUrl: `data:image/jpeg;base64,${oversizedBase64}`,
    })).toBeNull();
  });

  it('feature-detects iOS without enabling capture on web or unavailable shells', () => {
    expect(nativeClubLiveScreenMirrorAvailable()).toBe(true);
    expect(nativeClubLiveScreenMirrorAvailable({
      getPlatform: () => 'web',
      isNativePlatform: () => false,
      isPluginAvailable: () => false,
    })).toBe(false);
  });

  it('shares one in-flight native snapshot between concurrent callers', async () => {
    let resolveCapture: ((value: unknown) => void) | undefined;
    nativePlugin.capture.mockReturnValue(new Promise((resolve) => {
      resolveCapture = resolve;
    }));

    const first = captureNativeClubLiveScreenMirror();
    const second = captureNativeClubLiveScreenMirror();
    expect(nativePlugin.capture).toHaveBeenCalledOnce();
    resolveCapture?.(validFrame);
    await expect(first).resolves.toEqual(validFrame);
    await expect(second).resolves.toEqual(validFrame);
  });

  it('fails closed when native capture rejects or returns malformed data', async () => {
    nativePlugin.capture.mockRejectedValueOnce(new Error('WebView hidden'));
    await expect(captureNativeClubLiveScreenMirror()).resolves.toBeNull();
    nativePlugin.capture.mockResolvedValueOnce({ ...validFrame, pixelHeight: 0 });
    await expect(captureNativeClubLiveScreenMirror()).resolves.toBeNull();
  });

  it('captures only the visible TrackLab WebView and is registered in the iOS target', () => {
    const swift = readFileSync(resolve('ios/App/App/ClubLiveScreenMirrorPlugin.swift'), 'utf8');
    const controller = readFileSync(resolve('ios/App/App/TrackLabBridgeViewController.swift'), 'utf8');
    const project = readFileSync(resolve('ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
    const app = readFileSync(resolve('src/App.tsx'), 'utf8');

    expect(swift).toContain('webView.takeSnapshot');
    expect(swift).toContain('webView.window');
    expect(swift).toContain('data-club-live-activity-screen');
    expect(swift.match(/activityScreenIsVisible\(in: webView\)/g)).toHaveLength(2);
    expect(swift).toContain('maximumPixelEdge: CGFloat = 1_280');
    expect(swift).toContain('maximumJpegBytes = 350 * 1_024');
    expect(swift).toContain('jpegQualities: [CGFloat]');
    expect(swift).not.toContain('estimatedLongestEdge');
    expect(swift).not.toContain('import ReplayKit');
    expect(swift).not.toContain('import AVFoundation');
    expect(controller).toContain('registerPluginInstance(ClubLiveScreenMirrorPlugin())');
    expect(project).toContain('ClubLiveScreenMirrorPlugin.swift in Sources');
    expect(app).toContain("data-club-live-activity-screen={clubLiveActivityScreenVisible ? 'visible' : undefined}");
  });
});
