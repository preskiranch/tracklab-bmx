import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';

const globalStylesUrl = new URL('../../src/styles.css', import.meta.url);
const trackStylesUrl = new URL('../../src/components/EarthTrackView.mobile.css', import.meta.url);

async function installTrackStyles(page: Page) {
  const [globalStyles, trackStyles] = await Promise.all([
    readFile(globalStylesUrl, 'utf8'),
    readFile(trackStylesUrl, 'utf8'),
  ]);
  await page.addStyleTag({ content: globalStyles });
  await page.addStyleTag({ content: trackStyles });
}

async function expectInsideViewport(page: Page, locator: Locator) {
  const viewport = page.viewportSize();
  const box = await locator.boundingBox();
  expect(viewport).not.toBeNull();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-0.5);
  expect(box!.y).toBeGreaterThanOrEqual(-0.5);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 0.5);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 0.5);
}

async function expectViewportLocked(page: Page, locator: Locator) {
  const viewport = page.viewportSize();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeCloseTo(0, 0);
  expect(box!.y).toBeCloseTo(0, 0);
  expect(box!.width).toBeCloseTo(viewport!.width, 0);
  expect(box!.height).toBeCloseTo(viewport!.height, 0);
  await expect.poll(() => page.evaluate(() => ({
    horizontal: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    vertical: document.documentElement.scrollHeight - document.documentElement.clientHeight,
  }))).toEqual({ horizontal: 0, vertical: 0 });
}

async function expectStableAcrossFrames(locator: Locator) {
  const samples = await locator.evaluate(async (element) => {
    const boxes: Array<{ x: number; y: number; width: number; height: number }> = [];
    for (let frame = 0; frame < 8; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const bounds = element.getBoundingClientRect();
      boxes.push({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
    }
    return boxes;
  });
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    const values = samples.map((sample) => sample[key]);
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(0.5);
  }
}

function riderCards() {
  return ['Rasheen The Machine Hicks', 'Maya Torres', 'Jordan Lee', 'Avery Brooks']
    .map((name, index) => `
      <article class="race-rider-overlay-card" style="--player-color:${['#2aa8ff', '#ffd83d', '#7ade36', '#ff4d4d'][index]}">
        <div class="race-rider-overlay-summary">
          <span class="rider-avatar race-rider-overlay-avatar">${name.slice(0, 1)}</span>
          <span class="race-rider-overlay-badge">P${index + 1}</span>
          <span class="race-rider-overlay-identity"><strong>${name}</strong><span>76% track / 21 MPH</span></span>
        </div>
        <div class="race-rider-overlay-place"><strong>${index + 1}${index === 0 ? 'st' : index === 1 ? 'nd' : index === 2 ? 'rd' : 'th'}</strong><span>Place</span></div>
      </article>
    `).join('');
}

function raceMarkup(overlayHeight: number) {
  return `
    <main class="platform-shell race-fullscreen">
      <section class="platform-main">
        <div class="dashboard-grid">
          <div class="dashboard-primary-column">
            <div class="race-canvas-shell">
              <section class="earth-panel">
                <div class="earth-stage google-enabled">
                  <div class="google-map-layer"></div>
                  <div class="race-top-left-controls" aria-label="Fullscreen race controls">
                    <div class="race-top-left-header">
                      <div class="earth-overlay top-left race-status-overlay"><span class="race-dot racing"></span><strong>Live Race</strong></div>
                      <button class="race-cancel-overlay">Cancel Race</button>
                    </div>
                    <div class="race-top-left-actions">
                      <button class="race-countdown-pause-overlay">Pause Countdown</button>
                      <button class="race-countdown-pause-overlay race-force-start-overlay">Force Start</button>
                    </div>
                    <div class="race-countdown-pause-overlay race-sprint-info-overlay"><span>500 ft Sprint<br><small>Wattbike Air 5</small></span></div>
                  </div>
                  <button class="race-camera-lock-overlay locked" aria-label="Race layout locked">Layout Locked</button>
                  <div class="earth-overlay bottom-left"><span>Angle 55 deg</span><span>Heading 20 deg</span><span>Satellite</span></div>
                  <div class="race-rider-overlay locked" aria-label="Race rider positions" style="--overlay-x:4%;--overlay-y:70%;--overlay-width:940px;--overlay-height:${overlayHeight}px">
                    <div class="race-rider-overlay-toolbar"><div class="race-rider-overlay-handle">Rider positions</div></div>
                    <div class="race-rider-overlay-grid">${riderCards()}</div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </section>
    </main>
  `;
}

function mapMarkup() {
  return `
    <main class="platform-shell map-fullscreen">
      <section class="platform-main">
        <div class="dashboard-grid">
          <div class="dashboard-primary-column">
            <div class="race-canvas-shell">
              <section class="earth-panel">
                <div class="earth-stage google-enabled">
                  <div class="google-map-layer"></div>
                  <div class="map-edit-toolbar"><button><span>Full screen</span></button></div>
                  <div class="map-camera-pad" aria-label="Map camera controls">
                    <button>↶</button><button>↑</button><button>◎</button><button>↓</button><button>↷</button>
                  </div>
                  <div class="earth-overlay bottom-left"><span>Angle 55 deg</span><span>Heading 20 deg</span><span>Satellite</span></div>
                </div>
              </section>
            </div>
          </div>
          <div class="dashboard-secondary-column">
            <aside class="control-panel"><section class="panel-section mapping-section"><h3>Track map</h3><p>Mapping tools remain reachable.</p></section></aside>
          </div>
        </div>
      </section>
    </main>
  `;
}

function gameArenaMarkup() {
  return `
    <main class="platform-shell race-fullscreen">
      <section class="platform-main"><div class="dashboard-grid"><div class="dashboard-primary-column"><div class="race-canvas-shell"><section class="earth-panel"><div class="earth-stage">
        <section class="game-arena-hud" aria-label="Game arena rider data" style="position:absolute;z-index:1200;right:clamp(10px,2vw,30px);bottom:clamp(10px,1.8vh,22px);left:clamp(10px,2vw,30px);min-height:clamp(150px,20vh,218px);padding:clamp(8px,1vw,13px);overflow:hidden">
          <header class="game-arena-hud-header" style="min-height:25px;padding:0 4px 7px">TrackLab Live Timing</header>
          <div class="game-arena-hud-grid" style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:clamp(6px,.7vw,12px);min-height:clamp(112px,15vh,166px)">
            ${['Rasheen', 'Maya', 'Jordan', 'Avery'].map((name, index) => `
              <article class="game-arena-hud-card" style="display:grid;grid-template-rows:auto minmax(52px,1fr);min-width:0;overflow:hidden">
                <div class="game-arena-hud-summary" style="display:grid;grid-template-columns:auto auto minmax(0,1fr);min-width:0;align-items:center;gap:9px;padding:9px">
                  <span class="rider-avatar">${name[0]}</span><strong>P${index + 1}</strong><span class="game-arena-hud-identity">${name}</span>
                </div>
                <div class="game-arena-hud-place" style="display:flex;align-items:center;justify-content:center;margin:0 9px 9px">${index + 1} Place</div>
              </article>`).join('')}
          </div>
        </section>
      </div></section></div></div></div></section>
    </main>
  `;
}

test('keeps satellite race controls and rider data inside iPhone portrait and landscape', async ({ page }) => {
  for (const viewport of [
    { width: 390, height: 844, columns: 2, overlayHeight: 340 },
    { width: 844, height: 390, columns: 4, overlayHeight: 220 },
  ]) {
    await page.setViewportSize(viewport);
    await page.setContent(raceMarkup(viewport.overlayHeight));
    await installTrackStyles(page);

    await expectViewportLocked(page, page.locator('.platform-shell'));
    await expectViewportLocked(page, page.locator('.earth-stage'));
    await expectInsideViewport(page, page.getByLabel('Fullscreen race controls'));
    await expectInsideViewport(page, page.getByLabel('Race layout locked'));
    await expectInsideViewport(page, page.getByLabel('Race rider positions'));

    const gridColumns = await page.locator('.race-rider-overlay-grid').evaluate((grid) => (
      getComputedStyle(grid).gridTemplateColumns.split(' ').length
    ));
    expect(gridColumns).toBe(viewport.columns);
    const cardsFit = await page.getByLabel('Race rider positions').evaluate((panel) => {
      const bounds = panel.getBoundingClientRect();
      return [...panel.querySelectorAll('.race-rider-overlay-card')].every((card) => {
        const cardBounds = card.getBoundingClientRect();
        return cardBounds.left >= bounds.left - 0.5
          && cardBounds.right <= bounds.right + 0.5
          && cardBounds.top >= bounds.top - 0.5
          && cardBounds.bottom <= bounds.bottom + 0.5;
      });
    });
    expect(cardsFit).toBe(true);
    await expectStableAcrossFrames(page.locator('.earth-stage'));
  }
});

test('locks map editing to the dynamic viewport through phone rotation without overflow or shaking', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent(mapMarkup());
  await installTrackStyles(page);

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expectViewportLocked(page, page.locator('.platform-shell'));
    await expectViewportLocked(page, page.locator('.earth-stage'));
    await expectInsideViewport(page, page.locator('.control-panel'));
    await expectInsideViewport(page, page.getByLabel('Map camera controls'));
    await expectInsideViewport(page, page.locator('.map-edit-toolbar'));
    await expectStableAcrossFrames(page.locator('.earth-stage'));
  }
});

test('scales the demo game timing cards to two portrait rows and one landscape row', async ({ page }) => {
  for (const viewport of [
    { width: 390, height: 844, columns: 2 },
    { width: 844, height: 390, columns: 4 },
  ]) {
    await page.setViewportSize(viewport);
    await page.setContent(gameArenaMarkup());
    await installTrackStyles(page);

    const hud = page.getByLabel('Game arena rider data');
    await expectInsideViewport(page, hud);
    const columns = await hud.locator('.game-arena-hud-grid').evaluate((grid) => (
      getComputedStyle(grid).gridTemplateColumns.split(' ').length
    ));
    expect(columns).toBe(viewport.columns);
    const cardsFit = await hud.evaluate((panel) => {
      const bounds = panel.getBoundingClientRect();
      return [...panel.querySelectorAll('.game-arena-hud-card')].every((card) => {
        const cardBounds = card.getBoundingClientRect();
        return cardBounds.left >= bounds.left - 0.5
          && cardBounds.right <= bounds.right + 0.5
          && cardBounds.top >= bounds.top - 0.5
          && cardBounds.bottom <= bounds.bottom + 0.5;
      });
    });
    expect(cardsFit).toBe(true);
  }
});
