import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const riderCards = [
  { badge: 'P1', color: '#2aa8ff', initials: 'RH', name: 'Rasheen The Machine Hicks', place: '1st', heartRate: 166, simulated: true },
  { badge: 'P2', color: '#ffd83d', initials: 'EK', name: 'Evel “Sky King” Knievel', place: '2nd', heartRate: 158, simulated: false },
  { badge: 'P3', color: '#7ade36', initials: 'BE', name: 'Barry Ellis', place: '3rd', heartRate: 172, simulated: true },
  { badge: 'P4', color: '#ff4d4d', initials: 'KB', name: 'Kira “Full Send” Boustead', place: '4th', heartRate: 164, simulated: false },
] as const;

function riderCardMarkup(card: typeof riderCards[number]) {
  const profilePhoto = `<img alt="" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64'%3E%3Crect width='64' height='64' fill='%23253862'/%3E%3C/svg%3E">`;

  return `
    <div class="race-rider-overlay-card race-rider-overlay-card-local" style="--player-color:${card.color}">
      <div class="race-rider-overlay-summary">
        <span class="race-rider-overlay-portrait">
          <span class="rider-avatar race-rider-overlay-avatar has-photo" style="--rider-avatar-accent:${card.color}">${profilePhoto}</span>
          <span class="race-rider-overlay-badge">${card.badge}</span>
        </span>
        <div class="race-rider-overlay-identity">
          <strong>${card.name}</strong>
          <span class="race-rider-overlay-progress">76% track / 21 MPH</span>
          <span class="race-rider-overlay-heart-rate" aria-label="${card.simulated ? 'Simulated heart rate' : 'Heart rate'} ${card.heartRate} beats per minute"><b aria-hidden="true">♥</b>${card.simulated ? '<span class="race-rider-overlay-heart-rate-source" aria-hidden="true">Sim ·</span>' : ''}<span aria-hidden="true">${card.heartRate} BPM</span></span>
        </div>
      </div>
      <div class="race-rider-overlay-place" aria-label="${card.place} place">
        <strong>${card.place}</strong><span>Place</span>
      </div>
    </div>
  `;
}

test('keeps every placement fully visible with a long photographed rider name on iPad layouts', async ({ page }) => {
  const [styles, heartRateStyles] = await Promise.all([
    readFile(new URL('../../src/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../../src/components/HeartRateMetric.css', import.meta.url), 'utf8'),
  ]);

  for (const viewport of [
    { width: 1440, height: 900, columns: 4, minimumPanelHeight: 220, photoSize: 64 },
    { width: 1366, height: 1024, columns: 4, minimumPanelHeight: 220, photoSize: 64 },
    { width: 1280, height: 960, columns: 4, minimumPanelHeight: 220, photoSize: 64 },
    { width: 1024, height: 768, columns: 4, minimumPanelHeight: 220, photoSize: 64 },
    { width: 820, height: 1180, columns: 2, minimumPanelHeight: 340, photoSize: 60 },
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
    await page.addStyleTag({ content: heartRateStyles });

    const panel = page.locator('.race-rider-overlay');
    const layout = await panel.evaluate((element) => {
      const grid = element.querySelector<HTMLElement>('.race-rider-overlay-grid')!;
      return {
        columnCount: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        height: element.getBoundingClientRect().height,
      };
    });
    expect(layout.columnCount).toBe(viewport.columns);
    expect(layout.height).toBeGreaterThanOrEqual(viewport.minimumPanelHeight);

    const cardLayouts = await panel.locator('.race-rider-overlay-card').evaluateAll((cards) => cards.map((card) => {
      const summary = card.querySelector<HTMLElement>('.race-rider-overlay-summary')!;
      const identity = card.querySelector<HTMLElement>('.race-rider-overlay-identity')!;
      const name = identity.querySelector<HTMLElement>('strong')!;
      const badge = card.querySelector<HTMLElement>('.race-rider-overlay-badge')!;
      const heartRate = card.querySelector<HTMLElement>('.race-rider-overlay-heart-rate')!;
      const place = card.querySelector<HTMLElement>('.race-rider-overlay-place')!;
      const placeText = place.querySelector<HTMLElement>('strong')!;
      const avatar = card.querySelector<HTMLElement>('.race-rider-overlay-avatar')!;
      const photo = avatar.querySelector<HTMLElement>('img')!;
      const summaryBox = summary.getBoundingClientRect();
      const identityBox = identity.getBoundingClientRect();
      const nameBox = name.getBoundingClientRect();
      const badgeBox = badge.getBoundingClientRect();
      const heartRateBox = heartRate.getBoundingClientRect();
      const placeBox = place.getBoundingClientRect();
      const placeTextBox = placeText.getBoundingClientRect();
      const avatarBox = avatar.getBoundingClientRect();
      const photoBox = photo.getBoundingClientRect();
      const intersects = (left: DOMRect, right: DOMRect) => left.right > right.left + 0.5
        && left.left < right.right - 0.5
        && left.bottom > right.top + 0.5
        && left.top < right.bottom - 0.5;
      return {
        avatarHeight: avatarBox.height,
        avatarWidth: avatarBox.width,
        badgeClearsPhoto: !intersects(badgeBox, avatarBox),
        badgeClearsName: !intersects(badgeBox, nameBox),
        heartRateContained: heartRateBox.left >= identityBox.left - 0.5
          && heartRateBox.right <= identityBox.right + 0.5
          && heartRateBox.top >= summaryBox.top - 0.5
          && heartRateBox.bottom <= summaryBox.bottom + 0.5
          && heartRateBox.bottom <= placeBox.top + 0.5,
        identityFits: identity.scrollHeight <= identity.clientHeight + 1
          && identity.scrollWidth <= identity.clientWidth + 1,
        nameFits: name.scrollHeight <= name.clientHeight + 1
          && name.scrollWidth <= name.clientWidth + 1,
        photoContained: photoBox.left >= avatarBox.left - 0.5
          && photoBox.right <= avatarBox.right + 0.5
          && photoBox.top >= avatarBox.top - 0.5
          && photoBox.bottom <= avatarBox.bottom + 0.5,
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
      expect(card.avatarWidth).toBe(viewport.photoSize);
      expect(card.avatarHeight).toBe(viewport.photoSize);
      expect(card.badgeClearsPhoto).toBe(true);
      expect(card.badgeClearsName).toBe(true);
      expect(card.heartRateContained).toBe(true);
      expect(card.identityFits).toBe(true);
      expect(card.nameFits).toBe(true);
      expect(card.photoContained).toBe(true);
      expect(card.placeHeight).toBeGreaterThanOrEqual(46);
      expect(card.placeTextFits).toBe(true);
      expect(card.rowsDoNotOverlap).toBe(true);
    }
  }
});
