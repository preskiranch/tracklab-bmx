import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = [
  readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8'),
  readFileSync(new URL('../../src/components/PublicTrackLocator.css', import.meta.url), 'utf8'),
].join('\n');

describe('iPhone shell styles', () => {
  it('contains the page instead of allowing horizontal document movement', () => {
    expect(styles).toMatch(/html,\s*body\s*{[^}]*overflow-x:\s*hidden;[^}]*overflow-x:\s*clip;[^}]*overscroll-behavior-x:\s*none;/s);
    expect(styles).toMatch(/html,\s*body\s*{[^}]*min-width:\s*0;[^}]*-webkit-text-size-adjust:\s*100%;/s);
    expect(styles).toMatch(/#root\s*{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*min-width:\s*0;[^}]*overflow-x:\s*hidden;[^}]*overflow-x:\s*clip;/s);
    expect(styles).toMatch(/\.platform-shell\s*{[^}]*max-width:\s*100%;[^}]*overflow-x:\s*hidden;[^}]*overflow-x:\s*clip;/s);
  });

  it('keeps the mobile navigation readable, touchable, and below the safe area', () => {
    expect(styles).toMatch(/@media \(max-width:\s*720px\)[\s\S]*?\.side-nav\s*{[^}]*top:\s*env\(safe-area-inset-top\);[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*min-width:\s*0;[^}]*grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\);[^}]*overflow-x:\s*hidden;[^}]*overflow-x:\s*clip;/);
    expect(styles).toMatch(/@media \(max-width:\s*720px\)[\s\S]*?\.side-nav > \.watch-connect-indicator-slot\s*{[^}]*display:\s*block;[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;/);
    expect(styles).toMatch(/@media \(max-width:\s*720px\)[\s\S]*?\.side-nav \.watch-connect-indicator\s*{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;/);
    expect(styles).toMatch(/@media \(max-width:\s*720px\)[\s\S]*?\.side-nav \.watch-connect-indicator-label\s*{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*white-space:\s*normal;[^}]*text-align:\s*center;/);
    expect(styles).toMatch(/@media \(max-width:\s*720px\)[\s\S]*?\.side-nav button\s*{[^}]*min-height:\s*58px;[^}]*font-size:\s*12px;[^}]*font-weight:\s*850;/);
    expect(styles).toMatch(/@media \(max-width:\s*480px\)[\s\S]*?\.side-nav\s*{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);/);
    expect(styles).toMatch(/@media \(max-width:\s*480px\)[\s\S]*?\.side-nav button\s*{[^}]*font-size:\s*13px;/);
    expect(styles).not.toMatch(/\.side-nav\s*{[^}]*grid-template-columns:\s*repeat\(6,/);
  });

  it('lets every signed-in dashboard panel shrink to a portrait viewport', () => {
    expect(styles).toMatch(/@media \(max-width:\s*820px\)[\s\S]*?\.track-selectors\s*{[^}]*flex:\s*1 1 100%;[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*min-width:\s*0;[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
    expect(styles).toMatch(/@media \(max-width:\s*720px\)[\s\S]*?\.track-selectors\s*{[^}]*flex:\s*1 1 100%;[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*min-width:\s*0;/);
    expect(styles).toMatch(/@media \(max-width:\s*720px\)[\s\S]*?\.platform-main,\s*\.platform-topbar,\s*\.race-readiness-strip,\s*\.dashboard-grid,[\s\S]*?\.recovery-alert-card\s*{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*min-width:\s*0;/);
  });

  it('uses legible locator labels and result text', () => {
    expect(styles).toMatch(/\.public-track-search > span,\s*\.public-locator-filters label > span\s*{[^}]*font-size:\s*13px;/s);
    expect(styles).toMatch(/\.public-locator-filters select\s*{[^}]*font-size:\s*16px;/s);
    expect(styles).toMatch(/\.public-track-results button strong\s*{[^}]*font-size:\s*16px;/s);
    expect(styles).toMatch(/\.public-track-results button span\s*{[^}]*font-size:\s*14px;/s);
  });
});
