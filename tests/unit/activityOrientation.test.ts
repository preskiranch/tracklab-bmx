import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('activity orientation choice', () => {
  it('advertises portrait and both landscape orientations on iPhone and iPad', () => {
    const infoPlist = read('../../ios/App/App/Info.plist');
    const phoneOrientations = infoPlist.match(
      /<key>UISupportedInterfaceOrientations<\/key>[\s\S]*?<\/array>/u,
    )?.[0];
    const tabletOrientations = infoPlist.match(
      /<key>UISupportedInterfaceOrientations~ipad<\/key>[\s\S]*?<\/array>/u,
    )?.[0];

    for (const orientations of [phoneOrientations, tabletOrientations]) {
      expect(orientations).toContain('UIInterfaceOrientationPortrait');
      expect(orientations).toContain('UIInterfaceOrientationLandscapeLeft');
      expect(orientations).toContain('UIInterfaceOrientationLandscapeRight');
    }
  });

  it('never asks UIKit to rotate or restrict an activity', () => {
    const bridge = read('../../ios/App/App/TrackLabBridgeViewController.swift');

    expect(bridge).toContain('return UIDevice.current.userInterfaceIdiom == .pad ? .all : .allButUpsideDown');
    expect(bridge).not.toContain('TrackLabActivityOrientation');
    expect(bridge).not.toContain('activityLandscapeRequired');
    expect(bridge).not.toContain('requestGeometryUpdate');
    expect(bridge).not.toContain('attemptRotationToDeviceOrientation');
    expect(bridge).not.toContain('interfaceOrientations: .landscape');
    expect(bridge).toContain('webView?.scrollView.alwaysBounceHorizontal = false');
    expect(bridge).toContain('webView?.scrollView.showsHorizontalScrollIndicator = false');
    expect(bridge).toContain('webView?.scrollView.isDirectionalLockEnabled = true');
  });

  it('keeps every native activity in the rotatable UIKit surface without a portrait blocker', () => {
    const app = read('../../src/App.tsx');
    const requestRaceFullscreen = app.match(
      /const requestRaceFullscreen = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[raceViewFullscreen\]\);/u,
    )?.[0];
    const startRace = app.match(
      /setDemoSignalsStopped\(false\);[\s\S]*?if \(!demoMode\) bridge\.sendControlCommand\('race-arm'\);/u,
    )?.[0];

    expect(app).not.toContain('iphone-activity-landscape-guard');
    expect(app).not.toContain('Rotate your iPhone');
    expect(app).not.toContain('setNativeActivityLandscape');
    expect(app).not.toContain("from './lib/activityOrientation'");
    expect(requestRaceFullscreen).toContain('raceViewFullscreen && !isNativeTrackLabShell()');
    expect(startRace).toContain(
      'if (!isNativeTrackLabShell()) requestBrowserFullscreen(raceShellRef.current);',
    );
  });
});
