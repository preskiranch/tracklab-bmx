import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';

const globalStylesUrl = new URL('../../src/styles.css', import.meta.url);
const trackStylesUrl = new URL('../../src/components/EarthTrackView.mobile.css', import.meta.url);
const heartRateStylesUrl = new URL('../../src/components/HeartRateMetric.css', import.meta.url);

async function installTrackStyles(page: Page) {
  const [globalStyles, heartRateStyles, trackStyles] = await Promise.all([
    readFile(globalStylesUrl, 'utf8'),
    readFile(heartRateStylesUrl, 'utf8'),
    readFile(trackStylesUrl, 'utf8'),
  ]);
  await page.addStyleTag({ content: globalStyles });
  await page.addStyleTag({ content: heartRateStyles });
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

function riderCards(positionsPending = false) {
  return ['Gwen Hodge', 'Rasheen The Machine Hicks', 'Kira Boustead', 'Candace “Baby Cakes” Hicks']
    .map((name, index) => `
      <article class="race-rider-overlay-card${positionsPending ? ' positions-pending' : ''}" style="--player-color:${['#2aa8ff', '#ffd83d', '#7ade36', '#ff4d4d'][index]}">
        <div class="race-rider-overlay-summary">
          <span class="race-rider-overlay-portrait"><span class="rider-avatar race-rider-overlay-avatar has-photo"><img alt="" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64'%3E%3Crect width='64' height='64' fill='%23253862'/%3E%3C/svg%3E"></span><span class="race-rider-overlay-badge">P${index + 1}</span></span>
          <span class="race-rider-overlay-identity${name.length > 18 ? ' has-long-name' : ''}">
            <strong>${name}</strong>
            <span class="race-rider-overlay-progress">76% track / 21 MPH</span>
            <span class="race-rider-overlay-heart-rate" aria-label="Simulated heart rate ${158 + index} beats per minute"><b aria-hidden="true">♥</b><span class="race-rider-overlay-heart-rate-source" aria-hidden="true">Sim ·</span><span aria-hidden="true">${158 + index} BPM</span></span>
          </span>
        </div>
        ${positionsPending ? '' : `<div class="race-rider-overlay-place"><strong>${index + 1}${index === 0 ? 'st' : index === 1 ? 'nd' : index === 2 ? 'rd' : 'th'}</strong><span>Place</span></div>`}
      </article>
    `).join('');
}

function raceMarkup(
  overlayHeight: number,
  positionsPending = false,
  presentation?: {
    scale: number;
    width: number;
    height: number;
    xPct: number;
    yPct: number;
  },
) {
  const overlayStyle = presentation
    ? `--overlay-x:${presentation.xPct * 100}%;--overlay-y:${presentation.yPct * 100}%;--overlay-width:${presentation.width}px;--overlay-height:${presentation.height}px;--race-overlay-min-height:${presentation.height}px;--rr-font:${16 / presentation.scale}px;--rr-compact-avatar:${28 / presentation.scale}px;--rr-compact-toolbar:${20 / presentation.scale}px;--rr-compact-place:${21 / presentation.scale}px;--rr-compact-gap:${3 / presentation.scale}px;--rr-compact-padding:${3 / presentation.scale}px;--rr-portrait-avatar:${52 / presentation.scale}px;--rr-portrait-toolbar:${28 / presentation.scale}px;--rr-portrait-place:${34 / presentation.scale}px;--rr-portrait-gap:${4 / presentation.scale}px;--rr-portrait-padding:${4 / presentation.scale}px;--rr-short-portrait-avatar:${40 / presentation.scale}px;--rr-short-portrait-toolbar:${20 / presentation.scale}px;--rr-short-portrait-place:${26 / presentation.scale}px;--rr-short-portrait-gap:${2 / presentation.scale}px;--rr-short-portrait-padding:${2 / presentation.scale}px`
    : `--overlay-x:4%;--overlay-y:70%;--overlay-width:940px;--overlay-height:${overlayHeight}px;--race-overlay-min-height:${overlayHeight}px`;
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
                  <button class="race-camera-lock-overlay locked" aria-label="Race layout locked"><svg aria-hidden="true" width="17" height="17"></svg><span>Layout Locked</span></button>
                  ${positionsPending
                    ? '<div class="race-staging-countdown" aria-label="Race staging countdown"><strong>5</strong><span>Adjust the view, then return to your bike</span></div>'
                    : '<div class="start-tree-light" aria-label="BMX start tree light"><span class="tree-lamp red"></span><span class="tree-lamp yellow"></span><span class="tree-lamp yellow"></span><span class="tree-lamp green"></span></div>'}
                  <div class="earth-overlay bottom-left"><span>Angle 55 deg</span><span>Heading 20 deg</span><span>Satellite</span></div>
                  <div class="race-rider-overlay locked${presentation ? ' presentation-scaled' : ''}" aria-label="Race rider positions" style="${overlayStyle}">
                    <div class="race-rider-overlay-presentation" style="width:${presentation ? presentation.width / presentation.scale : '100%'}${presentation ? 'px' : ''};height:${presentation ? presentation.height / presentation.scale : '100%'}${presentation ? 'px' : ''};display:grid;grid-template-rows:auto minmax(0,1fr);transform:${presentation ? `scale(${presentation.scale})` : 'none'};transform-origin:top left">
                      <div class="race-rider-overlay-toolbar"><div class="race-rider-overlay-handle">Rider positions</div></div>
                      <div class="race-rider-overlay-grid">${riderCards(positionsPending)}</div>
                    </div>
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
    { width: 390, height: 844, columns: 2, overlayHeight: 248, positionsPending: false },
    { width: 844, height: 390, columns: 4, overlayHeight: 220, positionsPending: false },
    { width: 844, height: 390, columns: 4, overlayHeight: 220, positionsPending: true },
    { width: 852, height: 393, columns: 4, overlayHeight: 220, positionsPending: false },
    { width: 852, height: 393, columns: 4, overlayHeight: 220, positionsPending: true },
    { width: 932, height: 430, columns: 4, overlayHeight: 220, positionsPending: false },
    { width: 932, height: 430, columns: 4, overlayHeight: 220, positionsPending: true },
  ]) {
    await page.setViewportSize(viewport);
    await page.setContent(raceMarkup(viewport.overlayHeight, viewport.positionsPending));
    await installTrackStyles(page);

    await expectViewportLocked(page, page.locator('.platform-shell'));
    await expectViewportLocked(page, page.locator('.earth-stage'));
    await expectInsideViewport(page, page.getByLabel('Fullscreen race controls'));
    await expectInsideViewport(page, page.getByLabel('Race layout locked'));
    await expectInsideViewport(page, page.getByLabel('Race rider positions'));
    if (viewport.width > viewport.height) {
      const topControlHeights = await page.getByLabel('Fullscreen race controls').locator('button').evaluateAll((buttons) => (
        buttons.map((button) => button.getBoundingClientRect().height)
      ));
      expect(topControlHeights.every((height) => height >= 44)).toBe(true);
      const lockBounds = await page.getByLabel('Race layout locked').boundingBox();
      expect(lockBounds?.width).toBeCloseTo(44, 0);
      expect(lockBounds?.height).toBeCloseTo(44, 0);
    }

    const gridColumns = await page.locator('.race-rider-overlay-grid').evaluate((grid) => (
      getComputedStyle(grid).gridTemplateColumns.split(' ').length
    ));
    expect(gridColumns).toBe(viewport.columns);
    const compactLayout = await page.getByLabel('Race rider positions').evaluate((panel) => {
      const bounds = panel.getBoundingClientRect();
      const cards = [...panel.querySelectorAll('.race-rider-overlay-card')];
      return {
        height: bounds.height,
        viewportHeight: window.innerHeight,
        cardsFit: cards.every((card) => {
          const cardBounds = card.getBoundingClientRect();
          return cardBounds.left >= bounds.left - 0.5
            && cardBounds.right <= bounds.right + 0.5
            && cardBounds.top >= bounds.top - 0.5
            && cardBounds.bottom <= bounds.bottom + 0.5;
        }),
        contentChecks: cards.map((card) => {
          const summary = card.querySelector<HTMLElement>('.race-rider-overlay-summary')!;
          const avatar = card.querySelector<HTMLElement>('.race-rider-overlay-avatar')!;
          const badge = card.querySelector<HTMLElement>('.race-rider-overlay-badge')!;
          const identity = card.querySelector<HTMLElement>('.race-rider-overlay-identity')!;
          const name = identity.querySelector<HTMLElement>('strong')!;
          const metric = identity.querySelector<HTMLElement>('.race-rider-overlay-progress')!;
          const heartRate = identity.querySelector<HTMLElement>('.race-rider-overlay-heart-rate')!;
          const summaryBounds = summary.getBoundingClientRect();
          const avatarBounds = avatar.getBoundingClientRect();
          const badgeBounds = badge.getBoundingClientRect();
          const identityBounds = identity.getBoundingClientRect();
          const nameBounds = name.getBoundingClientRect();
          const metricBounds = metric.getBoundingClientRect();
          const heartRateBounds = heartRate.getBoundingClientRect();
          const intersects = (left: DOMRect, right: DOMRect) => left.right > right.left + 0.5
            && left.left < right.right - 0.5
            && left.bottom > right.top + 0.5
            && left.top < right.bottom - 0.5;
          const place = card.querySelector<HTMLElement>('.race-rider-overlay-place');
          const placeBounds = place?.getBoundingClientRect();
          return {
            summaryFits: summary.scrollHeight <= summary.clientHeight + 1,
            identityFits: identity.scrollHeight <= identity.clientHeight + 1,
            nameFits: name.scrollHeight <= name.clientHeight + 1,
            metricFits: metricBounds.left >= identityBounds.left - 0.5
              && metricBounds.right <= identityBounds.right + 0.5,
            avatarClear: avatarBounds.right <= identityBounds.left + 0.5,
            badgeClear: badgeBounds.left >= summaryBounds.left - 0.5
              && badgeBounds.right <= summaryBounds.right + 0.5
              && badgeBounds.top >= summaryBounds.top - 0.5
              && badgeBounds.bottom <= summaryBounds.bottom + 0.5
              && !intersects(badgeBounds, nameBounds),
            heartRateClear: heartRateBounds.left >= identityBounds.left - 0.5
              && heartRateBounds.right <= identityBounds.right + 0.5
              && heartRateBounds.bottom <= summaryBounds.bottom + 0.5
              && (!placeBounds || heartRateBounds.bottom <= placeBounds.top + 2.5),
            heartRateFits: heartRate.scrollWidth <= heartRate.clientWidth + 1
              && heartRate.scrollHeight <= heartRate.clientHeight + 1,
            rowsClear: !placeBounds || summaryBounds.bottom <= placeBounds.top + 0.5,
          };
        }),
      };
    });
    expect(compactLayout.cardsFit).toBe(true);
    expect(compactLayout.contentChecks).toEqual(compactLayout.contentChecks.map(() => ({
      summaryFits: true,
      identityFits: true,
      nameFits: true,
      metricFits: true,
      avatarClear: true,
      badgeClear: true,
      heartRateClear: true,
      heartRateFits: true,
      rowsClear: true,
    })));
    if (viewport.width > viewport.height) {
      expect(compactLayout.height / compactLayout.viewportHeight).toBeLessThanOrEqual(0.3);
      const overlayBounds = await page.getByLabel('Race rider positions').boundingBox();
      expect((overlayBounds?.y ?? 0) / viewport.height).toBeGreaterThanOrEqual(0.64);
      expect(viewport.width - (overlayBounds?.x ?? 0) - (overlayBounds?.width ?? viewport.width)).toBeGreaterThanOrEqual(51.5);
      expect(viewport.height - (overlayBounds?.y ?? 0) - (overlayBounds?.height ?? viewport.height)).toBeGreaterThanOrEqual(19.5);
      if (viewport.positionsPending) {
        await expect(page.locator('.race-rider-overlay-card.positions-pending')).toHaveCount(4);
        await expect(page.locator('.race-rider-overlay-place')).toHaveCount(0);
        const countdown = page.getByLabel('Race staging countdown');
        await expectInsideViewport(page, countdown);
        const doesNotIntersectOverlay = await countdown.evaluate((countdownElement) => {
          const countdownBounds = countdownElement.getBoundingClientRect();
          const overlayBounds = document.querySelector<HTMLElement>('.race-rider-overlay')!.getBoundingClientRect();
          return countdownBounds.bottom <= overlayBounds.top - 4;
        });
        expect(doesNotIntersectOverlay).toBe(true);
      } else {
        const startTree = page.getByLabel('BMX start tree light');
        await expectInsideViewport(page, startTree);
        const treeClearsControls = await startTree.evaluate((treeElement) => {
          const treeBounds = treeElement.getBoundingClientRect();
          const controlsBounds = document.querySelector<HTMLElement>('.race-top-left-controls')!.getBoundingClientRect();
          const lockBounds = document.querySelector<HTMLElement>('.race-camera-lock-overlay')!.getBoundingClientRect();
          const intersects = (left: DOMRect, right: DOMRect) => left.right > right.left
            && left.left < right.right
            && left.bottom > right.top
            && left.top < right.bottom;
          return !intersects(treeBounds, controlsBounds) && !intersects(treeBounds, lockBounds);
        });
        expect(treeClearsControls).toBe(true);
      }
    } else {
      expect(compactLayout.height / compactLayout.viewportHeight).toBeLessThanOrEqual(0.3);
      const longNameTypography = await page.locator('.race-rider-overlay-identity.has-long-name strong').first().evaluate((name) => ({
        fontSize: Number.parseFloat(getComputedStyle(name).fontSize),
        lineClamp: getComputedStyle(name).webkitLineClamp,
      }));
      expect(longNameTypography.fontSize).toBeGreaterThanOrEqual(12);
      expect(longNameTypography.lineClamp).toBe('3');
    }
    await expectStableAcrossFrames(page.locator('.earth-stage'));
  }
});

test('replays the iPad Pro rider panel throughout the iPad landscape matrix', async ({ page }) => {
  const referenceViewport = { width: 1366, height: 1024 };
  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 1180, height: 820 },
    { width: 1194, height: 834 },
    { width: 1366, height: 1024 },
  ]) {
    const scale = Math.min(
      viewport.width / referenceViewport.width,
      viewport.height / referenceViewport.height,
    );
    const frameWidth = referenceViewport.width * scale;
    const frameHeight = referenceViewport.height * scale;
    const expected = {
      left: ((viewport.width - frameWidth) / 2) + (0.04 * frameWidth),
      top: ((viewport.height - frameHeight) / 2) + (0.7 * frameHeight),
      width: 940 * scale,
      height: 220 * scale,
    };
    await page.setViewportSize(viewport);
    await page.setContent(raceMarkup(220, false, {
      scale,
      width: expected.width,
      height: expected.height,
      xPct: expected.left / viewport.width,
      yPct: expected.top / viewport.height,
    }));
    await installTrackStyles(page);
    const geometry = await page.getByLabel('Race rider positions').evaluate((panel) => {
      const panelBounds = panel.getBoundingClientRect();
      const avatarBounds = panel.querySelector<HTMLElement>('.race-rider-overlay-avatar')!
        .getBoundingClientRect();
      const stageBounds = panel.parentElement!.getBoundingClientRect();
      const contains = (outer: DOMRect, inner: DOMRect) => (
        inner.left >= outer.left - 0.5
        && inner.top >= outer.top - 0.5
        && inner.right <= outer.right + 0.5
        && inner.bottom <= outer.bottom + 0.5
      );
      const cards = [...panel.querySelectorAll<HTMLElement>('.race-rider-overlay-card')];
      return {
        cardsContained: cards.every((card) => contains(panelBounds, card.getBoundingClientRect())),
        mapFillsViewport: Math.abs(stageBounds.left) < 0.5
          && Math.abs(stageBounds.top) < 0.5
          && Math.abs(stageBounds.width - window.innerWidth) < 0.5
          && Math.abs(stageBounds.height - window.innerHeight) < 0.5,
        panelInsideMap: contains(stageBounds, panelBounds),
        panelHeightRatio: panelBounds.height / stageBounds.height,
        left: panelBounds.left,
        top: panelBounds.top,
        width: panelBounds.width,
        height: panelBounds.height,
        avatarSize: avatarBounds.width,
      };
    });
    expect(geometry.left).toBeCloseTo(expected.left, 0);
    expect(geometry.top).toBeCloseTo(expected.top, 0);
    expect(geometry.width).toBeCloseTo(expected.width, 0);
    expect(geometry.height).toBeCloseTo(expected.height, 0);
    expect(geometry.avatarSize).toBeCloseTo(64 * scale, 0);
    expect(geometry.panelHeightRatio).toBeLessThanOrEqual(0.216);
    expect(geometry.mapFillsViewport).toBe(true);
    expect(geometry.panelInsideMap).toBe(true);
    expect(geometry.cardsContained).toBe(true);
    await expectInsideViewport(page, page.getByLabel('Race rider positions'));
  }
});

test('counter-scales saved rider text on iPhone portrait and landscape without growing the panel', async ({ page }) => {
  for (const viewport of [
    { width: 390, height: 844, name: 13.8, progress: 11.8, badge: 9.8, place: 19.8 },
    { width: 844, height: 390, name: 11.8, progress: 10.8, badge: 9.8, place: 16.8 },
    { width: 932, height: 430, name: 11.8, progress: 10.8, badge: 9.8, place: 16.8 },
  ]) {
    const rawScale = Math.min(viewport.width / 1366, viewport.height / 1024);
    const presentationScale = Math.max(0.5, rawScale);
    const panelWidth = viewport.width > viewport.height
      ? Math.max(940 * rawScale, viewport.width * 0.68)
      : viewport.width - 16;
    const rawPanelHeight = 220 * rawScale;
    const panelHeight = viewport.width > viewport.height
      ? Math.max(110, rawPanelHeight)
      : Math.max(248, rawPanelHeight);
    await page.setViewportSize(viewport);
    await page.setContent(raceMarkup(panelHeight, false, {
      scale: presentationScale,
      width: panelWidth,
      height: panelHeight,
      xPct: 0.04,
      yPct: 0.5,
    }));
    await installTrackStyles(page);

    const panel = page.getByLabel('Race rider positions');
    const panelBounds = await panel.boundingBox();
    expect(panelBounds?.height).toBeCloseTo(panelHeight, 0);
    await expectInsideViewport(page, panel);
    const typography = await panel.evaluate((element) => {
      const presentation = element.querySelector<HTMLElement>('.race-rider-overlay-presentation')!;
      const scale = element.getBoundingClientRect().width / presentation.offsetWidth;
      const fontSize = (selector: string) => (
        Number.parseFloat(getComputedStyle(element.querySelector<HTMLElement>(selector)!).fontSize) * scale
      );
      return {
        toolbar: fontSize('.race-rider-overlay-handle'),
        name: fontSize('.race-rider-overlay-identity strong'),
        progress: fontSize('.race-rider-overlay-progress'),
        heartRate: fontSize('.race-rider-overlay-heart-rate'),
        heartIcon: fontSize('.race-rider-overlay-heart-rate b'),
        badge: fontSize('.race-rider-overlay-badge'),
        place: fontSize('.race-rider-overlay-place strong'),
      };
    });
    expect(typography.toolbar).toBeGreaterThanOrEqual(11.8);
    expect(typography.name).toBeGreaterThanOrEqual(viewport.name);
    expect(typography.progress).toBeGreaterThanOrEqual(viewport.progress);
    expect(typography.heartRate).toBeGreaterThanOrEqual(11.8);
    expect(typography.heartIcon).toBeGreaterThanOrEqual(13.8);
    expect(typography.badge).toBeGreaterThanOrEqual(viewport.badge);
    expect(typography.place).toBeGreaterThanOrEqual(viewport.place);

    const contentFits = await panel.evaluate((element) => {
      const panelBounds = element.getBoundingClientRect();
      const contains = (outer: DOMRect, inner: DOMRect) => (
        inner.left >= outer.left - 0.5
        && inner.right <= outer.right + 0.5
        && inner.top >= outer.top - 0.5
        && inner.bottom <= outer.bottom + 0.5
      );
      return [...element.querySelectorAll<HTMLElement>('.race-rider-overlay-card')].map((card) => {
        const cardBounds = card.getBoundingClientRect();
        const summary = card.querySelector<HTMLElement>('.race-rider-overlay-summary')!;
        const summaryBounds = summary.getBoundingClientRect();
        const placeBounds = card.querySelector<HTMLElement>('.race-rider-overlay-place')!
          .getBoundingClientRect();
        const content = [
          card.querySelector<HTMLElement>('.race-rider-overlay-avatar')!,
          card.querySelector<HTMLElement>('.race-rider-overlay-badge')!,
          card.querySelector<HTMLElement>('.race-rider-overlay-identity strong')!,
          card.querySelector<HTMLElement>('.race-rider-overlay-progress')!,
          card.querySelector<HTMLElement>('.race-rider-overlay-heart-rate')!,
        ];
        return {
          card: contains(panelBounds, cardBounds),
          summary: contains(cardBounds, summaryBounds),
          place: contains(cardBounds, placeBounds),
          rows: summaryBounds.bottom <= placeBounds.top + 0.5,
          content: content.map((child) => contains(summaryBounds, child.getBoundingClientRect())),
          placeContent: [...card.querySelectorAll<HTMLElement>('.race-rider-overlay-place > *')]
            .map((child) => {
              const childBounds = child.getBoundingClientRect();
              return childBounds.left >= placeBounds.left - 2.5
                && childBounds.right <= placeBounds.right + 2.5
                && childBounds.top >= placeBounds.top - 2.5
                && childBounds.bottom <= placeBounds.bottom + 2.5;
            }),
        };
      });
    });
    expect(contentFits).toEqual(contentFits.map(() => ({
      card: true,
      summary: true,
      place: true,
      rows: true,
      content: [true, true, true, true, true],
      placeContent: [true, true],
    })));
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
