import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  activityRequiresIPhoneLandscape,
  userAgentIsIPhone,
} from '../../src/lib/activityOrientation';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('iPhone activity orientation', () => {
  it('requires landscape for every rider activity and not for setup or account screens', () => {
    for (const mode of ['race', 'straight-sprint', 'get-pulled', 'explore'] as const) {
      expect(activityRequiresIPhoneLandscape(mode)).toBe(true);
    }
    for (const mode of ['profile', 'settings', 'results', 'club-tablet', 'monitor'] as const) {
      expect(activityRequiresIPhoneLandscape(mode)).toBe(false);
    }
  });

  it('targets iPhones and iPods without treating iPads or Macs as phones', () => {
    expect(userAgentIsIPhone('Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X)')).toBe(true);
    expect(userAgentIsIPhone('Mozilla/5.0 (iPod touch; CPU iPhone OS 17_0 like Mac OS X)')).toBe(true);
    expect(userAgentIsIPhone('Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X)')).toBe(false);
    expect(userAgentIsIPhone('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_5)')).toBe(false);
  });

  it('locks only native iPhone activities and keeps a portrait web rotation guard', () => {
    const bridge = read('../../ios/App/App/TrackLabBridgeViewController.swift');
    const infoPlist = read('../../ios/App/App/Info.plist');
    const app = read('../../src/App.tsx');

    expect(bridge).toContain('public let jsName = "TrackLabActivityOrientation"');
    expect(bridge).toContain('UIDevice.current.userInterfaceIdiom == .phone');
    expect(bridge).toContain('return .landscape');
    expect(bridge).toContain('return UIDevice.current.userInterfaceIdiom == .pad ? .all : .allButUpsideDown');
    expect(bridge).toContain('interfaceOrientations: .landscape');
    expect(bridge).toContain('setNeedsUpdateOfSupportedInterfaceOrientations()');
    expect(bridge).toContain('guard required, let windowScene = view.window?.windowScene else { return }');
    expect(bridge).toContain('UIViewController.attemptRotationToDeviceOrientation()');
    expect(bridge).toContain('bridge?.registerPluginInstance(activityOrientationPlugin)');
    expect(infoPlist).toContain('<string>UIInterfaceOrientationLandscapeLeft</string>');
    expect(infoPlist).toContain('<string>UIInterfaceOrientationLandscapeRight</string>');
    expect(app).toContain('className="iphone-activity-landscape-guard"');
    expect(app).toContain('Rotate your iPhone');
    expect(app).toContain('void setNativeActivityLandscape(false).catch(() => undefined)');
    expect(app).toContain('@media(orientation:portrait) and (max-width:600px)');
    expect(app).toMatch(/\.iphone-activity-landscape-guard\{position:fixed/u);
  });
});
