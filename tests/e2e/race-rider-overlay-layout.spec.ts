import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const riderCards = [
  { badge: 'P1', color: '#2aa8ff', initials: 'RH', name: 'Rasheen The Machine Hicks', place: '1st' },
  { badge: 'P2', color: '#ffd83d', initials: 'EK', name: 'Evel Knievel', place: '2nd' },
  { badge: 'P3', color: '#7ade36', initials: 'B', name: 'B', place: '3rd' },
  { badge: 'P4', color: '#ff4d4d', initials: 'KB', name: 'Kira Boustead', place: '4th' },
] as const;

function riderCardMarkup(card: typeof riderCards[number]) {
  const profilePhoto = card.badge === 'P1'
    ? '<img alt="" src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'44\' height=\'44\'%3E%3Crect width=\'44\' height=\'44\' fill=\'%23253862\'/%3E%3C/svg%3E">'
    : `<span aria-hidden="true">${card.initials}</span>`;

  return `
    <div class="race-rider-overlay-card race-rider-overlay-card-local" style="--player-color:${card.color}">
      <div class="race-rider-overlay-summary">
        <span class="rider-avatar race-rider-overlay-avatar${card.badge === 'P1' ? ' has-photo' : ''}" style="--rider-avatar-accent:${card.color}">
          ${profilePhoto}
        </span>
        <span class="race-rider-overlay-badge">${card.badge}</span>
        <div class="race-rider-overlay-identity">
          <strong>${card.name}</strong>
          <span>76% track / 21 MPH</span>
        </div>
      </div>
      <div class="race-rider-overlay-place" aria-label="${card.place} place">
        <strong>${card.place}</strong><span>Place</span>
      </div>
    </div>
  `;
}

test('keeps every placement fully visible with a long photographed rider name on iPad layouts', async ({ page }) => {
  const styles = await readFile(new URL('../../src/styles.css', import.meta.url), 'utf8');

  for (const viewport of [
    { width: 1366, height: 1024, columns: 4, minimumPanelHeight: 190 },
    { width: 1280, height: 960, columns: 4, minimumPanelHeight: 190 },
    { width: 1024, height: 768, columns: 4, minimumPanelHeight: 190 },
    { width: 820, height: 1180, columns: 2, minimumPanelHeight: 340 },
  ]) {
    await page.setViewportSize(viewport);
    await page.setContent(`
      <main class="earth-stage" style="position:relative;width:100vw;height:100dvh;overflow:hidden">
        <div
          class="race-rider-overlay locked"
          aria-label="Race rider positions"
          style="--overlay-x:0%;--overlay-y:0%;--overlay-width:940px;--overlay-height:190px"
        >
          <div class="race-rider-overlay-toolbar">
            <div class="race-rider-overlay-handle"><span>Rider positions</span></div>
            <span class="race-rider-overlay-lock"><span>Locked</span></span>
          </div>
          <div class="race-rider-overlay-grid">${riderCards.map(riderCardMarkup).join('')}</div>
        </div>
      </main>
    `);
    await page.addStyleTag({ content: styles });

    const panel = page.locator('.race-rider-overlay');
    const layout = await panel.evaluate((element) => {
      const grid = element.querySelector<HTMLElement>('.race-rider-overlay-grid')!;
      const columnCount = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
      return {
        columnCount,
        height: element.getBoundingClientRect().height,
      };
    });
    expect(layout.columnCount).toBe(viewport.columns);
    expect(layout.height).toBeGreaterThanOrEqual(viewport.minimumPanelHeight);

    const cardLayouts = await panel.locator('.race-rider-overlay-card').evaluateAll((cards) => cards.map((card) => {
      const summary = card.querySelector<HTMLElement>('.race-rider-overlay-summary')!;
      const identity = card.querySelector<HTMLElement>('.race-rider-overlay-identity')!;
      const name = identity.querySelector<HTMLElement>('strong')!;
      const place = card.querySelector<HTMLElement>('.race-rider-overlay-place')!;
      const placeText = place.querySelector<HTMLElement>('strong')!;
      const avatar = card.querySelector<HTMLElement>('.race-rider-overlay-avatar')!;
      const summaryBox = summary.getBoundingClientRect();
      const placeBox = place.getBoundingClientRect();
      const placeTextBox = placeText.getBoundingClientRect();
      const avatarBox = avatar.getBoundingClientRect();
      return {
        avatarHeight: avatarBox.height,
        avatarWidth: avatarBox.width,
        identityFits: identity.scrollHeight <= identity.clientHeight + 1
          && identity.scrollWidth <= identity.clientWidth + 1,
        nameFits: name.scrollHeight <= name.clientHeight + 1
          && name.scrollWidth <= name.clientWidth + 1,
        placeHeight: placeBox.height,
        placeTextFits: placeTextBox.top >= placeBox.top
          && placeTextBox.bottom <= placeBox.bottom
          && placeTextBox.left >= placeBox.left
          && placeTextBox.right <= placeBox.right,
        rowsDoNotOverlap: summaryBox.bottom <= placeBox.top,
      };
    }));

    expect(cardLayouts).toHaveLength(4);
    for (const card of cardLayouts) {
      expect(card.avatarWidth).toBe(44);
      expect(card.avatarHeight).toBe(44);
      expect(card.identityFits).toBe(true);
      expect(card.nameFits).toBe(true);
      expect(card.placeHeight).toBeGreaterThanOrEqual(48);
      expect(card.placeTextFits).toBe(true);
      expect(card.rowsDoNotOverlap).toBe(true);
    }
  }
});
