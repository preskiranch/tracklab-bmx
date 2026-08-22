import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');

function navigationButtonSource(iconSource: string, label: string) {
  const labelIndex = appSource.indexOf(`${iconSource}\n            ${label}`);
  expect(labelIndex).toBeGreaterThan(-1);
  const buttonStart = appSource.lastIndexOf('<button', labelIndex);
  const buttonEnd = appSource.indexOf('</button>', labelIndex);
  expect(buttonStart).toBeGreaterThan(-1);
  expect(buttonEnd).toBeGreaterThan(labelIndex);
  return appSource.slice(buttonStart, buttonEnd);
}

describe('sidebar section navigation', () => {
  it('opens the already-mounted rider rail without rebuilding the race workspace', () => {
    const ridersButton = navigationButtonSource('<Users size={17} />', 'Riders');

    expect(ridersButton).toContain("document.querySelector('.pairing-rail')");
    expect(ridersButton).not.toContain('setAppMode(');
  });

  it('opens lightweight results from other sections without mounting the race workspace', () => {
    const resultsButton = navigationButtonSource('<BarChart3 size={17} />', 'Results');
    const resultsBranchStart = appSource.lastIndexOf(') : resultsMode ? (');
    const resultsBranch = appSource.slice(
      resultsBranchStart,
      appSource.indexOf(") : appMode === 'club-monitor'", resultsBranchStart),
    );

    expect(resultsButton).toContain("setAppMode('results')");
    expect(resultsButton).toContain("className={resultsMode ? 'selected' : ''}");
    expect(resultsButton).toContain('if (raceWorkspaceActive)');
    expect(resultsBranch).toContain('analyticsPanel');
    expect(resultsBranch).not.toMatch(/EarthTrackView|SessionControlPanel|MultiplayerPanel/);
  });

  it('keeps the last sprint configuration when results open from another section', () => {
    expect(appSource).toContain("const resultsMode = appMode === 'results';");
    expect(appSource).toMatch(/const raceWorkspaceMode =[\s\S]*?resultsMode[\s\S]*?lastRaceWasSprintRef\.current/);
    expect(appSource).toMatch(/sprintConfiguration=\{raceWorkspaceMode === 'straight-sprint'[\s\S]*?straightSprintAirSetting/);
  });
});
