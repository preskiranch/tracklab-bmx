import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('native iOS external-display mirroring', () => {
  const appDelegate = read('../../ios/App/App/AppDelegate.swift');
  const sceneDelegate = read('../../ios/App/App/SceneDelegate.swift');
  const infoPlist = read('../../ios/App/App/Info.plist');

  it('leaves external displays to the system mirror path instead of dynamically configuring a second app scene', () => {
    expect(appDelegate).not.toContain('configurationForConnecting');
    expect(infoPlist).toContain('UIWindowSceneSessionRoleApplication');
    expect(infoPlist).not.toMatch(/UIWindowSceneSessionRoleExternalDisplay(?:NonInteractive)?/u);
    expect(infoPlist).toMatch(
      /<key>UIApplicationSupportsMultipleScenes<\/key>\s*<false\/>/u,
    );
  });

  it('never mounts an independent Capacitor web view for a non-application scene', () => {
    expect(sceneDelegate).toMatch(
      /guard let windowScene = scene as\? UIWindowScene,\s*session\.role == \.windowApplication else \{ return \}[\s\S]*?window\?\.rootViewController = TrackLabBridgeViewController\(\)/u,
    );
  });
});
