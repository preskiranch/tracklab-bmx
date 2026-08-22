import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = [
  readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8'),
  readFileSync(new URL('../../src/components/PublicTrackLocator.css', import.meta.url), 'utf8'),
].join('\n');

describe('iPhone shell styles', () => {
  it('contains the page instead of allowing horizontal document movement', () => {
    expect(styles).toMatch(/html,\s*body\s*{[^}]*overflow-x:\s*hidden;[^}]*overflow-x:\s*clip;[^}]*overscroll-behavior-x:\s*none;/s);
    expect(styles).toMatch(/\.platform-shell\s*{[^}]*max-width:\s*100%;[^}]*overflow-x:\s*hidden;[^}]*overflow-x:\s*clip;/s);
  });

  it('keeps the mobile navigation readable, touchable, and below the safe area', () => {
    expect(styles).toMatch(/@media \(max-width:\s*720px\)[\s\S]*?\.side-nav\s*{[^}]*top:\s*env\(safe-area-inset-top\);[^}]*grid-template-columns:\s*repeat\(5,\s*1fr\);/);
    expect(styles).toMatch(/@media \(max-width:\s*720px\)[\s\S]*?\.side-nav button\s*{[^}]*min-height:\s*58px;[^}]*font-size:\s*12px;[^}]*font-weight:\s*850;/);
    expect(styles).toMatch(/@media \(max-width:\s*480px\)[\s\S]*?\.side-nav\s*{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);/);
    expect(styles).toMatch(/@media \(max-width:\s*480px\)[\s\S]*?\.side-nav button\s*{[^}]*font-size:\s*13px;/);
    expect(styles).not.toMatch(/\.side-nav\s*{[^}]*grid-template-columns:\s*repeat\(6,/);
  });

  it('uses legible locator labels and result text', () => {
    expect(styles).toMatch(/\.public-track-search > span,\s*\.public-locator-filters label > span\s*{[^}]*font-size:\s*13px;/s);
    expect(styles).toMatch(/\.public-locator-filters select\s*{[^}]*font-size:\s*16px;/s);
    expect(styles).toMatch(/\.public-track-results button strong\s*{[^}]*font-size:\s*16px;/s);
    expect(styles).toMatch(/\.public-track-results button span\s*{[^}]*font-size:\s*14px;/s);
  });
});
