import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  racePresentationFrame,
  raceRiderOverlayRectForPresentation,
  satelliteZoomForRacePresentation,
} from '../../src/lib/racePresentation';
import { normalizeRiderPresentationScale } from '../../src/lib/riderPresentation';

const globalStylesUrl = new URL('../../src/styles.css', import.meta.url);
const trackStylesUrl = new URL('../../src/components/EarthTrackView.mobile.css', import.meta.url);
const heartRateStylesUrl = new URL('../../src/components/HeartRateMetric.css', import.meta.url);

const authoredViewport = { width: 1366, height: 1024 } as const;
const savedCamera = {
  angle: 47,
  heading: 180,
  center: { lat: 32.6297455, lng: -116.9383327 },
  zoom: 20.78,
  referenceViewport: authoredViewport,
} as const;
const savedOverlay = {
  xPct: 0.04,
  yPct: 0.7,
  width: 940,
  height: 220,
  locked: true,
  referenceViewport: authoredViewport,
} as const;

const devices = [
  {
    name: 'iPhone SE',
    phone: true,
    portrait: { width: 375, height: 667 },
    landscape: { width: 667, height: 375 },
  },
  {
    name: 'standard iPhone',
    phone: true,
    portrait: { width: 393, height: 852 },
    landscape: { width: 852, height: 393 },
  },
  {
    name: 'iPhone Pro Max',
    phone: true,
    portrait: { width: 430, height: 932 },
    landscape: { width: 932, height: 430 },
  },
  {
    name: 'iPad mini',
    phone: false,
    portrait: { width: 744, height: 1133 },
    landscape: { width: 1133, height: 744 },
  },
  {
    name: '10.9-inch iPad',
    phone: false,
    portrait: { width: 820, height: 1180 },
    landscape: { width: 1180, height: 820 },
  },
  {
    name: '11-inch iPad Pro',
    phone: false,
    portrait: { width: 834, height: 1194 },
    landscape: { width: 1194, height: 834 },
  },
  {
    name: '13-inch iPad Pro',
    phone: false,
    portrait: { width: 1024, height: 1366 },
    landscape: { width: 1366, height: 1024 },
  },
] as const;

type Viewport = { width: number; height: number };

type LayoutSignature = {
  stage: [number, number, number, number];
  frame: [number, number, number, number];
  overlay: [number, number, number, number];
  zoom: number;
};

function rounded(value: number) {
  return Math.round(value * 100) / 100;
}

function compactLandscape(viewport: Viewport) {
  return viewport.width > viewport.height
    && viewport.width <= 1000
    && viewport.height <= 500;
}

function phonePortrait(viewport: Viewport) {
  return viewport.height > viewport.width && viewport.width <= 600;
}

function shortPhonePortrait(viewport: Viewport) {
  return phonePortrait(viewport) && viewport.height <= 700;
}

function responsiveMinimumHeight(
  viewport: Viewport,
  presentationScale: number,
  requestedPresentationHeight: number,
) {
  if (Math.abs(presentationScale - 1) > 0.001) {
    if (compactLandscape(viewport)) return 110;
    if (phonePortrait(viewport)) return Math.min(shortPhonePortrait(viewport) ? 200 : 248, Math.max(1, viewport.height - 24));
    const scaledDefaultMinimum = Math.max(110, Math.round(220 * presentationScale));
    return Math.min(scaledDefaultMinimum, Math.max(1, requestedPresentationHeight));
  }
  if (compactLandscape(viewport)) return 110;
  if (phonePortrait(viewport)) return Math.min(shortPhonePortrait(viewport) ? 200 : 248, Math.max(1, viewport.height - 24));
  return viewport.width <= 900 ? Math.min(300, Math.round(viewport.height * 0.28)) : 220;
}

function responsiveMaximumHeight(viewport: Viewport) {
  if (compactLandscape(viewport)) {
    return Math.max(110, Math.min(128, Math.round(viewport.height * 0.3)));
  }
  if (phonePortrait(viewport)) {
    if (shortPhonePortrait(viewport)) return 200;
    return Math.max(248, Math.min(272, Math.round(viewport.height * 0.32)));
  }
  return Number.POSITIVE_INFINITY;
}

/** Mirrors the exported responsive limits around the saved presentation rect. */
function presentedOverlay(viewport: Viewport) {
  const frame = racePresentationFrame(authoredViewport, viewport);
  const savedRect = raceRiderOverlayRectForPresentation(
    savedOverlay,
    viewport,
    authoredViewport,
  );
  if (!frame || !savedRect) throw new Error('The test viewport must produce a race presentation.');

  const scale = normalizeRiderPresentationScale(frame.uniformScale);
  const minimumHeight = responsiveMinimumHeight(
    viewport,
    scale,
    savedRect.height,
  );
  const maximumHeight = responsiveMaximumHeight(viewport);
  const scaledMinimumWidth = Math.max(220, Math.round(320 * scale));
  const responsiveMinimumWidth = compactLandscape(viewport)
    ? Math.round(viewport.width * 0.68)
    : phonePortrait(viewport)
      ? viewport.width - 16
      : 0;
  const minimumWidth = Math.min(
    Math.max(1, viewport.width - 16),
    Math.max(responsiveMinimumWidth, Math.min(scaledMinimumWidth, Math.max(1, savedRect.width))),
  );
  const width = Math.max(
    minimumWidth,
    Math.min(savedRect.width, Math.max(minimumWidth, viewport.width - 24)),
  );
  const height = Math.max(
    minimumHeight,
    Math.min(
      savedRect.height,
      maximumHeight,
      Math.max(minimumHeight, viewport.height - 24),
    ),
  );
  const maxX = Math.max(0, 1 - (width / viewport.width));
  const maxY = Math.max(0, 1 - (height / viewport.height));

  return {
    frame,
    scale,
    minimumHeight,
    left: Math.max(0, Math.min(maxX, savedRect.left / viewport.width)) * viewport.width,
    top: (compactLandscape(viewport) || phonePortrait(viewport)
      ? maxY
      : Math.max(0, Math.min(maxY, savedRect.top / viewport.height))) * viewport.height,
    width,
    height,
    zoom: satelliteZoomForRacePresentation(savedCamera.zoom, authoredViewport, viewport),
  };
}

function riderCards() {
  const riders = [
    'Ryan “The Astronaut” Nelson',
    'Rasheen The Machine Hicks',
    'Danial “DJ” Johnson',
    'Barry Ellis',
  ];
  return riders.map((name, index) => `
    <article class="race-rider-overlay-card" style="--player-color:${['#7ade36', '#2aa8ff', '#ff4d4d', '#ffd83d'][index]}">
      <div class="race-rider-overlay-summary">
        <span class="race-rider-overlay-portrait">
          <span class="rider-avatar race-rider-overlay-avatar has-photo">
            <img alt="" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64'%3E%3Crect width='64' height='64' fill='%23253862'/%3E%3C/svg%3E">
          </span>
          <span class="race-rider-overlay-badge">P${index + 1}</span>
        </span>
        <span class="race-rider-overlay-identity">
          <strong>${name}</strong>
          <span class="race-rider-overlay-progress">${76 - index * 4}% track / ${24 - index} MPH</span>
          <span class="race-rider-overlay-heart-rate" aria-label="Heart rate ${158 + index} beats per minute">
            <b aria-hidden="true">♥</b><span aria-hidden="true">${158 + index} BPM</span>
          </span>
        </span>
      </div>
      <div class="race-rider-overlay-place"><strong>${index + 1}${index === 0 ? 'st' : index === 1 ? 'nd' : index === 2 ? 'rd' : 'th'}</strong><span>Place</span></div>
    </article>
  `).join('');
}

function savedSatelliteMarkup() {
  return `
    <style>
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: rgb(217, 70, 239); }
      .saved-satellite-mock {
        position: absolute;
        inset: 0;
        overflow: hidden;
        background-color: rgb(73, 103, 68);
        background-image:
          linear-gradient(24deg, rgba(218, 190, 135, .46) 0 18%, transparent 19% 100%),
          linear-gradient(154deg, transparent 0 43%, rgba(84, 115, 74, .82) 44% 59%, transparent 60%),
          linear-gradient(90deg, rgba(132, 96, 65, .62) 0 1px, transparent 1px 74px);
      }
      .saved-composition-frame { position: absolute; overflow: hidden; }
      .saved-course { position: absolute; inset: 4% 3% auto; width: 94%; height: 60%; overflow: visible; }
      .saved-course .track-halo { fill: none; stroke: rgba(2, 6, 12, .72); stroke-width: 7; }
      .saved-course .track-line { fill: none; stroke: rgb(91, 225, 143); stroke-linecap: round; stroke-width: 3.5; }
      .saved-course .finish { fill: rgb(4, 8, 14); stroke: white; stroke-width: 1.5; }
      .saved-course text { fill: white; font: 900 10px Arial, sans-serif; }
      .race-rider-overlay-presentation { display: grid; grid-template-rows: auto minmax(0, 1fr); transform-origin: top left; }
    </style>
    <main class="platform-shell race-fullscreen">
      <section class="platform-main"><div class="dashboard-grid"><div class="dashboard-primary-column"><div class="race-canvas-shell"><section class="earth-panel">
        <div class="earth-stage google-enabled" aria-label="Saved satellite race stage">
          <div class="google-map-layer saved-satellite-mock" aria-label="Loaded satellite map" data-map-loaded="true">
            <div class="saved-composition-frame" aria-label="Saved map composition">
              <svg class="saved-course" viewBox="0 0 100 62" role="img" aria-label="Complete saved BMX route">
                <path class="track-halo" d="M4 49 C18 53 28 45 35 36 C42 27 49 26 58 31 C67 36 78 33 95 10" />
                <path class="track-line" d="M4 49 C18 53 28 45 35 36 C42 27 49 26 58 31 C67 36 78 33 95 10" />
                <rect class="finish" x="82" y="2" width="16" height="9" rx="2" />
                <text x="90" y="8.5" text-anchor="middle">FINISH</text>
              </svg>
            </div>
          </div>
          <div class="race-rider-overlay locked presentation-scaled" aria-label="Race rider positions">
            <div class="race-rider-overlay-presentation">
              <div class="race-rider-overlay-toolbar"><div class="race-rider-overlay-handle">Rider positions</div></div>
              <div class="race-rider-overlay-grid">${riderCards()}</div>
            </div>
          </div>
        </div>
      </section></div></div></div></section>
    </main>
  `;
}

async function installProductionStyles(page: Page) {
  const [globalStyles, heartRateStyles, trackStyles] = await Promise.all([
    readFile(globalStylesUrl, 'utf8'),
    readFile(heartRateStylesUrl, 'utf8'),
    readFile(trackStylesUrl, 'utf8'),
  ]);
  await page.addStyleTag({ content: globalStyles });
  await page.addStyleTag({ content: heartRateStyles });
  await page.addStyleTag({ content: trackStyles });
}

async function applySavedComposition(page: Page, viewport: Viewport) {
  const layout = presentedOverlay(viewport);
  await page.evaluate(({ camera, frame, overlay }) => {
    const stage = document.querySelector<HTMLElement>('.earth-stage')!;
    stage.dataset.cameraAngle = String(camera.angle);
    stage.dataset.cameraHeading = String(camera.heading);
    stage.dataset.cameraCenter = `${camera.center.lat},${camera.center.lng}`;
    stage.dataset.cameraZoom = String(camera.zoom);

    const compositionFrame = document.querySelector<HTMLElement>('.saved-composition-frame')!;
    Object.assign(compositionFrame.style, {
      left: `${frame.offsetX}px`,
      top: `${frame.offsetY}px`,
      width: `${frame.width}px`,
      height: `${frame.height}px`,
    });

    const panel = document.querySelector<HTMLElement>('.race-rider-overlay')!;
    panel.style.setProperty('--overlay-x', `${overlay.left}px`);
    panel.style.setProperty('--overlay-y', `${overlay.top}px`);
    panel.style.setProperty('--overlay-width', `${overlay.width}px`);
    panel.style.setProperty('--overlay-height', `${overlay.height}px`);
    panel.style.setProperty('--race-overlay-min-height', `${overlay.minimumHeight}px`);
    panel.style.setProperty('--rr-font', `${16 / overlay.scale}px`);
    panel.style.setProperty('--rr-compact-avatar', `${28 / overlay.scale}px`);
    panel.style.setProperty('--rr-compact-toolbar', `${20 / overlay.scale}px`);
    panel.style.setProperty('--rr-compact-place', `${21 / overlay.scale}px`);
    panel.style.setProperty('--rr-compact-gap', `${3 / overlay.scale}px`);
    panel.style.setProperty('--rr-compact-padding', `${3 / overlay.scale}px`);
    panel.style.setProperty('--rr-portrait-avatar', `${44 / overlay.scale}px`);
    panel.style.setProperty('--rr-portrait-toolbar', `${28 / overlay.scale}px`);
    panel.style.setProperty('--rr-portrait-place', `${34 / overlay.scale}px`);
    panel.style.setProperty('--rr-portrait-gap', `${4 / overlay.scale}px`);
    panel.style.setProperty('--rr-portrait-padding', `${4 / overlay.scale}px`);
    panel.style.setProperty('--rr-short-portrait-avatar', `${40 / overlay.scale}px`);
    panel.style.setProperty('--rr-short-portrait-toolbar', `${20 / overlay.scale}px`);
    panel.style.setProperty('--rr-short-portrait-place', `${26 / overlay.scale}px`);
    panel.style.setProperty('--rr-short-portrait-gap', `${2 / overlay.scale}px`);
    panel.style.setProperty('--rr-short-portrait-padding', `${2 / overlay.scale}px`);

    const presentation = panel.querySelector<HTMLElement>('.race-rider-overlay-presentation')!;
    Object.assign(presentation.style, {
      width: `${overlay.width / overlay.scale}px`,
      height: `${overlay.height / overlay.scale}px`,
      transform: `scale(${overlay.scale})`,
    });
  }, {
    camera: {
      ...savedCamera,
      zoom: layout.zoom,
    },
    frame: layout.frame,
    overlay: layout,
  });
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

async function signature(page: Page): Promise<LayoutSignature> {
  return page.evaluate(() => {
    const tuple = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return [
        Math.round(rect.x * 100) / 100,
        Math.round(rect.y * 100) / 100,
        Math.round(rect.width * 100) / 100,
        Math.round(rect.height * 100) / 100,
      ] as [number, number, number, number];
    };
    const stage = document.querySelector<HTMLElement>('.earth-stage')!;
    return {
      stage: tuple(stage),
      frame: tuple(document.querySelector('.saved-composition-frame')!),
      overlay: tuple(document.querySelector('.race-rider-overlay')!),
      zoom: Number(stage.dataset.cameraZoom),
    };
  });
}

async function expectStable(locator: Locator) {
  const samples = await locator.evaluate(async (element) => {
    const values: number[][] = [];
    for (let index = 0; index < 6; index += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const rect = element.getBoundingClientRect();
      values.push([rect.x, rect.y, rect.width, rect.height]);
    }
    return values;
  });
  for (let index = 0; index < 4; index += 1) {
    const dimension = samples.map((sample) => sample[index]);
    expect(Math.max(...dimension) - Math.min(...dimension)).toBeLessThanOrEqual(0.5);
  }
}

async function assertViewport(
  page: Page,
  viewport: Viewport,
  phone: boolean,
) {
  const stage = page.getByLabel('Saved satellite race stage');
  const map = page.getByLabel('Loaded satellite map');
  const frame = page.getByLabel('Saved map composition');
  const course = page.getByLabel('Complete saved BMX route');
  const panel = page.getByLabel('Race rider positions');

  const geometry = await page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>('.earth-stage')!;
    const map = document.querySelector<HTMLElement>('.saved-satellite-mock')!;
    const frame = document.querySelector<HTMLElement>('.saved-composition-frame')!;
    const course = document.querySelector<SVGElement>('.saved-course')!;
    const panel = document.querySelector<HTMLElement>('.race-rider-overlay')!;
    const stageRect = stage.getBoundingClientRect();
    const mapRect = map.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const courseRect = course.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const contains = (outer: DOMRect, inner: DOMRect) => (
      inner.left >= outer.left - 0.5
      && inner.top >= outer.top - 0.5
      && inner.right <= outer.right + 0.5
      && inner.bottom <= outer.bottom + 0.5
    );
    const mapStyle = getComputedStyle(map);
    return {
      stage: { x: stageRect.x, y: stageRect.y, width: stageRect.width, height: stageRect.height },
      mapFillsStage: contains(stageRect, mapRect)
        && Math.abs(mapRect.width - stageRect.width) <= 0.5
        && Math.abs(mapRect.height - stageRect.height) <= 0.5,
      frameInsideStage: contains(stageRect, frameRect),
      courseInsideFrame: contains(frameRect, courseRect),
      panelInsideStage: contains(stageRect, panelRect),
      panelHeightRatio: panelRect.height / stageRect.height,
      unobstructedMapRatio: (panelRect.top - stageRect.top) / stageRect.height,
      backgroundColor: mapStyle.backgroundColor,
      backgroundImage: mapStyle.backgroundImage,
      mapLoaded: map.dataset.mapLoaded,
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      verticalOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      cameraAngle: stage.dataset.cameraAngle,
      cameraHeading: stage.dataset.cameraHeading,
      cameraCenter: stage.dataset.cameraCenter,
    };
  });

  expect([
    rounded(geometry.stage.x),
    rounded(geometry.stage.y),
    rounded(geometry.stage.width),
    rounded(geometry.stage.height),
  ]).toEqual([0, 0, viewport.width, viewport.height]);
  expect(geometry.mapFillsStage).toBe(true);
  expect(geometry.frameInsideStage).toBe(true);
  expect(geometry.courseInsideFrame).toBe(true);
  expect(geometry.panelInsideStage).toBe(true);
  expect(geometry.mapLoaded).toBe('true');
  expect(geometry.backgroundImage).not.toBe('none');
  expect(geometry.backgroundColor).not.toBe('rgb(0, 0, 0)');
  expect(geometry.horizontalOverflow).toBe(0);
  expect(geometry.verticalOverflow).toBe(0);
  expect(geometry.cameraAngle).toBe(String(savedCamera.angle));
  expect(geometry.cameraHeading).toBe(String(savedCamera.heading));
  expect(geometry.cameraCenter).toBe(`${savedCamera.center.lat},${savedCamera.center.lng}`);
  if (phone) {
    expect.soft(geometry.panelHeightRatio, 'phone rider panel must occupy no more than 30% of the viewport')
      .toBeLessThanOrEqual(0.3);
  }
  if (viewport.width > viewport.height) {
    expect.soft(geometry.unobstructedMapRatio, 'landscape must leave at least 65% of the map unobstructed')
      .toBeGreaterThanOrEqual(0.65);
  }

  await expect(panel.locator('.race-rider-overlay-card')).toHaveCount(4);
  const cardChecks = await panel.locator('.race-rider-overlay-card').evaluateAll((cards) => cards.map((card) => {
    const cardRect = card.getBoundingClientRect();
    const panel = card.closest<HTMLElement>('.race-rider-overlay')!;
    const presentation = panel.querySelector<HTMLElement>('.race-rider-overlay-presentation')!;
    const presentationScale = presentation.getBoundingClientRect().width / presentation.offsetWidth;
    const panelRect = panel.getBoundingClientRect();
    const summary = card.querySelector<HTMLElement>('.race-rider-overlay-summary')!;
    const place = card.querySelector<HTMLElement>('.race-rider-overlay-place')!;
    const name = card.querySelector<HTMLElement>('.race-rider-overlay-identity strong')!;
    const progress = card.querySelector<HTMLElement>('.race-rider-overlay-progress')!;
    const heartRate = card.querySelector<HTMLElement>('.race-rider-overlay-heart-rate')!;
    const badge = card.querySelector<HTMLElement>('.race-rider-overlay-badge')!;
    const summaryRect = summary.getBoundingClientRect();
    const placeRect = place.getBoundingClientRect();
    const nameRect = name.getBoundingClientRect();
    const progressRect = progress.getBoundingClientRect();
    const heartRateRect = heartRate.getBoundingClientRect();
    const badgeRect = badge.getBoundingClientRect();
    const effectiveFontSize = (element: HTMLElement) => (
      Number.parseFloat(getComputedStyle(element).fontSize) * presentationScale
    );
    const intersects = (left: DOMRect, right: DOMRect) => (
      left.right > right.left + 0.5
      && left.left < right.right - 0.5
      && left.bottom > right.top + 0.5
      && left.top < right.bottom - 0.5
    );
    const contains = (outer: DOMRect, inner: DOMRect) => (
      inner.left >= outer.left - 0.5
      && inner.top >= outer.top - 0.5
      && inner.right <= outer.right + 0.5
      && inner.bottom <= outer.bottom + 0.5
    );
    const readableLine = (element: HTMLElement, rect: DOMRect, minimumFont: number) => {
      const fontSize = effectiveFontSize(element);
      return element.textContent!.trim().length > 0
        && fontSize >= minimumFont
        && rect.width >= fontSize * 4
        && rect.height >= fontSize * 0.85;
    };
    return {
      cardInsidePanel: contains(panelRect, cardRect),
      rowsInsideCard: contains(cardRect, summaryRect)
        && contains(cardRect, placeRect)
        && summaryRect.bottom <= placeRect.top + 0.5,
      nameReadable: readableLine(name, nameRect, 10),
      progressReadable: readableLine(progress, progressRect, 9),
      heartRateReadable: readableLine(heartRate, heartRateRect, 9),
      badgeClearOfName: contains(summaryRect, badgeRect) && !intersects(badgeRect, nameRect),
    };
  }));
  expect(cardChecks).toEqual(cardChecks.map(() => ({
    cardInsidePanel: true,
    rowsInsideCard: true,
    nameReadable: true,
    progressReadable: true,
    heartRateReadable: true,
    badgeClearOfName: true,
  })));

  await expectStable(stage);
  await expectStable(map);
  await expectStable(frame);
  await expectStable(course);
  await expectStable(panel);
}

function expectSameSignature(actual: LayoutSignature, expected: LayoutSignature) {
  for (const key of ['stage', 'frame', 'overlay'] as const) {
    actual[key].forEach((value, index) => {
      expect(value).toBeCloseTo(expected[key][index], 1);
    });
  }
  expect(actual.zoom).toBeCloseTo(expected.zoom, 5);
}

for (const device of devices) {
  test(`${device.name} preserves the saved satellite composition through both rotation directions`, async ({ page }) => {
    await page.setViewportSize(device.portrait);
    await page.setContent(savedSatelliteMarkup());
    await installProductionStyles(page);

    const signatures = new Map<'portrait' | 'landscape', LayoutSignature>();
    const sequence = [
      ['portrait', device.portrait],
      ['landscape', device.landscape],
      ['portrait', device.portrait],
      ['landscape', device.landscape],
      ['portrait', device.portrait],
      ['landscape', device.landscape],
    ] as const;

    for (const [orientation, viewport] of sequence) {
      await page.setViewportSize(viewport);
      await applySavedComposition(page, viewport);
      await assertViewport(page, viewport, device.phone);
      const current = await signature(page);
      const first = signatures.get(orientation);
      if (first) {
        expectSameSignature(current, first);
      } else {
        signatures.set(orientation, current);
      }
    }
  });
}
