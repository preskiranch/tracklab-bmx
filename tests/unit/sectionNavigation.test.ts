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
});
