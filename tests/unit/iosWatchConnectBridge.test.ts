import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('iOS Watch Connect bridge bootstrap', () => {
  it('replaces the storyboard controller with the app-owned bridge when the scene connects', () => {
    const sceneDelegate = source('ios/App/App/SceneDelegate.swift');

    expect(sceneDelegate).toMatch(/guard let windowScene = scene as\? UIWindowScene else \{ return \}/);
    expect(sceneDelegate).toMatch(/window\s*=\s*UIWindow\(windowScene:\s*windowScene\)/);
    expect(sceneDelegate).toMatch(
      /window\?\.rootViewController\s*=\s*TrackLabBridgeViewController\(\)/,
    );
    expect(sceneDelegate).toMatch(/window\?\.makeKeyAndVisible\(\)/);
  });

  it('registers the complete native heart-rate plugin when Capacitor loads', () => {
    const bridge = source('ios/App/App/TrackLabBridgeViewController.swift');
    const plugin = source('ios/App/App/HeartRatePlugin.swift');

    expect(bridge).toMatch(
      /final class TrackLabBridgeViewController:\s*CAPBridgeViewController/,
    );
    expect(bridge).toMatch(
      /override func capacitorDidLoad\(\)[\s\S]*?super\.capacitorDidLoad\(\)[\s\S]*?bridge\?\.registerPluginInstance\(HeartRatePlugin\(\)\)/,
    );
    expect(plugin).toContain('public let jsName = "TrackLabHeartRate"');
    for (const method of [
      'getAvailability',
      'getWatchConnectIdentity',
      'getWatchConnectState',
      'startWatchConnect',
      'stopWatchConnect',
    ]) {
      expect(plugin).toContain(`CAPPluginMethod(name: "${method}"`);
    }
  });

  it('ships every bridge source in the iOS target', () => {
    const project = source('ios/App/App.xcodeproj/project.pbxproj');

    for (const file of [
      'SceneDelegate.swift',
      'TrackLabBridgeViewController.swift',
      'HeartRatePlugin.swift',
    ]) {
      expect(project).toMatch(new RegExp(`${file.replace(/\./g, '\\.')} in Sources`));
    }
  });
});
