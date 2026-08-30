import { expect, test, type Page } from '@playwright/test';

const deviceMatrices = {
  iphone: [
    { label: 'iPhone SE 3 portrait', orientation: 'portrait', width: 375, height: 667 },
    { label: 'iPhone SE 3 landscape', orientation: 'landscape', width: 667, height: 375 },
    { label: 'iPhone 15/16 portrait', orientation: 'portrait', width: 390, height: 844 },
    { label: 'iPhone 15/16 landscape', orientation: 'landscape', width: 844, height: 390 },
    { label: 'iPhone Plus portrait', orientation: 'portrait', width: 430, height: 932 },
    { label: 'iPhone Plus landscape', orientation: 'landscape', width: 932, height: 430 },
  ],
  ipad: [
    { label: 'iPad mini portrait', orientation: 'portrait', width: 744, height: 1133 },
    { label: 'iPad mini landscape', orientation: 'landscape', width: 1133, height: 744 },
    { label: 'iPad Pro portrait', orientation: 'portrait', width: 1024, height: 1366 },
    { label: 'iPad Pro landscape', orientation: 'landscape', width: 1366, height: 1024 },
  ],
} as const;

const iosUserAgents = {
  iphone: [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X)',
    'AppleWebKit/605.1.15 Mobile/15E148 TrackLabBMX-iOS',
  ].join(' '),
  ipad: [
    'Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X)',
    'AppleWebKit/605.1.15 Mobile/15E148 TrackLabBMX-iOS',
  ].join(' '),
} as const;

type DeviceViewport = {
  label: string;
  orientation: 'landscape' | 'portrait';
  width: number;
  height: number;
};

async function installPaintedGoogleMapsRaster(
  page: Page,
  device: keyof typeof iosUserAgents,
  legacyApplePreference = false,
) {
  await page.addInitScript(({ legacyApplePreference, userAgent }) => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      get: () => userAgent,
    });
    window.localStorage.setItem(
      'tracklab-explore-map-renderer-v1',
      legacyApplePreference ? 'apple-satellite' : 'google-satellite',
    );

    type Point = { lat: number; lng: number };
    type MockMapListener = (event?: {
      placeId?: string;
      stop?: () => void;
    }) => void;
    type RegressionWindow = typeof window & {
      __tracklabExploreActiveMap?: { handleResize: () => void };
      __tracklabExploreMapInstances?: number;
      __tracklabExploreMapPaints?: Array<{ height: number; routePainted: boolean; width: number }>;
      __tracklabExploreMapResizeCount?: number;
      __tracklabExploreRouteDrawn?: boolean;
    };
    const regressionWindow = window as RegressionWindow;

    class MockMap {
      private center: Point;
      private heading = 0;
      private zoom: number;
      private readonly element: HTMLElement;

      constructor(element: HTMLElement, options: { center?: Point; zoom?: number }) {
        this.element = element;
        this.center = options.center ?? { lat: 38.5, lng: -120.2 };
        this.zoom = options.zoom ?? 18;
        regressionWindow.__tracklabExploreMapInstances =
          (regressionWindow.__tracklabExploreMapInstances ?? 0) + 1;
        regressionWindow.__tracklabExploreActiveMap = this;
        this.paint();
      }

      private paint() {
        const surface = document.createElement('div');
        surface.className = 'tracklab-mock-google-satellite';
        surface.dataset.routePainted = String(Boolean(regressionWindow.__tracklabExploreRouteDrawn));
        surface.style.cssText = [
          'position:absolute',
          'inset:0',
          'overflow:hidden',
          'background-color:rgb(49,95,61)',
          'background-image:linear-gradient(145deg,#315f3d 0 45%,#284d34 45% 100%)',
        ].join(';');
        if (regressionWindow.__tracklabExploreRouteDrawn) {
          const routeLine = document.createElement('div');
          routeLine.className = 'tracklab-mock-route-line';
          routeLine.dataset.routePainted = 'true';
          routeLine.style.cssText = [
            'position:absolute',
            'left:8%',
            'right:8%',
            'top:50%',
            'height:8px',
            'border-radius:999px',
            'background:#d8ff3e',
            'box-shadow:0 0 0 2px rgba(15,23,42,.75)',
          ].join(';');
          surface.append(routeLine);
        }
        this.element.replaceChildren(surface);
        const bounds = this.element.getBoundingClientRect();
        regressionWindow.__tracklabExploreMapPaints ??= [];
        regressionWindow.__tracklabExploreMapPaints.push({
          height: bounds.height,
          routePainted: Boolean(regressionWindow.__tracklabExploreRouteDrawn),
          width: bounds.width,
        });
      }

      handleResize() {
        regressionWindow.__tracklabExploreMapResizeCount =
          (regressionWindow.__tracklabExploreMapResizeCount ?? 0) + 1;
        this.paint();
      }

      addListener(_eventName: string, _handler: MockMapListener) {
        return { remove() {} };
      }

      fitBounds() {}
      getCenter() { return { toJSON: () => this.center }; }
      getHeading() { return this.heading; }
      getZoom() { return this.zoom; }
      moveCamera(options: { center?: Point; zoom?: number }) {
        if (options.center) this.center = options.center;
        if (options.zoom != null) this.zoom = options.zoom;
      }
      setCenter(center: Point) { this.center = center; }
      setHeading(heading: number) { this.heading = heading; }
      setOptions() {}
      setTilt() {}
      setZoom(zoom: number) { this.zoom = zoom; }
    }

    class MockMarker {
      constructor(_options: Record<string, unknown> = {}) {}
      addListener() { return { remove() {} }; }
      setIcon() {}
      setLabel() {}
      setMap() {}
      setPosition() {}
      setTitle() {}
    }

    class MockPolyline {
      constructor(_options: Record<string, unknown> = {}) {
        regressionWindow.__tracklabExploreRouteDrawn = true;
        regressionWindow.__tracklabExploreActiveMap?.handleResize();
      }
      setMap() {}
      setPath() {}
    }

    class MockLatLngBounds {
      extend() {}
    }

    class MockPoint {
      constructor(public x: number, public y: number) {}
    }

    class MockSize {
      constructor(public width: number, public height: number) {}
    }

    class MockAutocompleteSessionToken {}
    class MockAutocompleteService {
      getPlacePredictions(
        _request: { input: string },
        callback?: (predictions: unknown[], status: string) => void,
      ) {
        callback?.([], 'ZERO_RESULTS');
      }
    }

    const places = {
      AutocompleteService: MockAutocompleteService,
      AutocompleteSessionToken: MockAutocompleteSessionToken,
    };
    (window as typeof window & { google?: unknown }).google = {
      maps: {
        LatLngBounds: MockLatLngBounds,
        Map: MockMap,
        Marker: MockMarker,
        Point: MockPoint,
        Polyline: MockPolyline,
        Size: MockSize,
        SymbolPath: { CIRCLE: 'circle' },
        places,
        importLibrary: async (name: string) => (name === 'places' ? places : {}),
        event: {
          trigger: (target: { handleResize?: () => void }, eventName: string) => {
            if (eventName === 'resize') target.handleResize?.();
          },
        },
      },
    };
  }, { legacyApplePreference, userAgent: iosUserAgents[device] });
}

async function mockSignedInDeveloperAndExploreApis(page: Page) {
  const now = Date.now();
  const user = {
    id: 'explore-device-regression',
    profileKey: 'user:explore-device-regression',
    email: 'explore-device@tracklab.test',
    name: 'Explore Device Developer',
    admin: true,
    membership: { tier: 'racer', bikeSeats: 4, updatedAt: now },
  };
  let recentRoutes: unknown[] = [];

  await page.route('**/api/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ user }),
  }));
  await page.route('**/api/user-data*', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      trackMappings: {},
      customRoutes: [],
      bikeProfiles: [],
      studioRiders: [],
      accountProfile: { updatedAt: now },
    }),
  }));
  await page.route('**/api/club-connect*', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ memberships: [], ownedClub: null, canManageClub: false }),
  }));
  await page.route('**/api/friends**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ items: [], nextCursor: null, total: 0, incomingTotal: 0, outgoingTotal: 0 }),
  }));
  await page.route('**/api/ghosts*', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ghosts: [] }),
  }));
  await page.route('**/api/recovery-alert/**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ accountId: `recacct_${'a'.repeat(32)}`, episode: null }),
  }));
  await page.route('**/api/explore/recent-routes', async (route) => {
    if (route.request().method() === 'POST') {
      recentRoutes = (route.request().postDataJSON() as { routes?: unknown[] }).routes ?? [];
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ routes: recentRoutes }),
    });
  });
  await page.route('**/api/explore/elevation', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      elevation: {
        elevationSamples: [
          { distanceMeters: 0, elevationMeters: 10 },
          { distanceMeters: 1_000, elevationMeters: 10 },
        ],
        elevationGainMeters: 0,
        elevationLossMeters: 0,
      },
    }),
  }));
  await page.route('**/api/explore/route', async (route) => {
    const request = route.request().postDataJSON() as {
      destination: { lat: number; lng: number };
      destinationLabel: string;
      origin: { lat: number; lng: number };
      originLabel: string;
      travelMode: 'bicycle';
    };
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        route: {
          id: 'EXPLORE-device-regression',
          origin: request.origin,
          destination: request.destination,
          originLabel: request.originLabel,
          destinationLabel: request.destinationLabel,
          travelMode: request.travelMode,
          distanceMeters: 1_000,
          durationSeconds: 300,
          encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
          elevationSamples: [
            { distanceMeters: 0, elevationMeters: 10 },
            { distanceMeters: 1_000, elevationMeters: 10 },
          ],
          elevationGainMeters: 0,
          elevationLossMeters: 0,
          createdAt: Date.now(),
        },
      }),
    });
  });
  await page.route('https://maps.googleapis.com/**', (route) => route.abort());
}

async function openSignedInApp(page: Page) {
  const openApp = page.getByRole('button', { name: 'Open App' });
  const primaryNavigation = page.getByRole('navigation', { name: 'Primary' });
  await openApp.or(primaryNavigation).first().waitFor({ state: 'visible', timeout: 15_000 });
  if (await openApp.isVisible()) await openApp.click();
  await expect(primaryNavigation).toBeVisible();
}

async function expectPaintedContainedExploreMap(page: Page, viewport: DeviceViewport) {
  const { label } = viewport;
  const surface = page.locator('.explore-map-canvas .tracklab-mock-google-satellite').first();
  const routeLine = surface.locator('.tracklab-mock-route-line');
  await expect(surface, `${label}: satellite surface`).toBeVisible();
  await expect(surface).toHaveAttribute('data-route-painted', 'true');
  await expect(routeLine, `${label}: route line`).toBeVisible();
  await expect(page.locator('.explore-map-status.error')).toHaveCount(0);

  const layout = await page.evaluate(() => {
    const selectors = [
      '.platform-shell',
      '.explore-camera-toolbar',
      '.explore-map-grid',
      '.explore-map-panel',
      '.explore-map-canvas',
      '.explore-rider-strip',
      '.tracklab-mock-google-satellite',
      '.tracklab-mock-route-line',
    ];
    const visibleBoxes = selectors.flatMap((selector) => [...document.querySelectorAll<HTMLElement>(selector)]
      .filter((element) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
      })
      .map((element) => {
        const box = element.getBoundingClientRect();
        return { selector, left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      }));
    const surface = document.querySelector<HTMLElement>('.tracklab-mock-google-satellite');
    const mapGrid = document.querySelector<HTMLElement>('.explore-map-grid');
    const riderStrip = document.querySelector<HTMLElement>('.explore-rider-strip');
    const riderCards = [...document.querySelectorAll<HTMLElement>('.explore-rider-strip article')];
    const surfaceStyle = surface ? getComputedStyle(surface) : null;
    const paints = (window as typeof window & {
      __tracklabExploreMapPaints?: Array<{ height: number; routePainted: boolean; width: number }>;
    }).__tracklabExploreMapPaints ?? [];
    const box = (element: HTMLElement | null) => {
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      return {
        bottom: bounds.bottom,
        height: bounds.height,
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        width: bounds.width,
      };
    };
    const horizontalContainers = [
      '.platform-shell',
      '.explore-camera-toolbar',
      '.explore-map-grid',
    ].flatMap((selector) => [...document.querySelectorAll<HTMLElement>(selector)]
      .filter((element) => {
        const style = getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden'
          && bounds.width > 0 && bounds.height > 0;
      })
      .map((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        selector,
      })));
    return {
      boxes: visibleBoxes,
      documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      horizontalContainers,
      lastPaint: paints.at(-1) ?? null,
      mapBox: box(mapGrid),
      orientation: matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape',
      riderBox: box(riderStrip),
      riderCardBoxes: riderCards.map((card) => box(card)),
      surfaceBackground: surfaceStyle?.backgroundColor ?? '',
      viewport: { height: window.innerHeight, width: window.innerWidth },
    };
  });

  expect(layout.documentFits, `${label}: document horizontal containment`).toBe(true);
  expect(layout.orientation, `${label}: active CSS orientation`).toBe(viewport.orientation);
  expect(layout.viewport, `${label}: exact viewport`).toEqual({
    height: viewport.height,
    width: viewport.width,
  });
  expect(layout.surfaceBackground, `${label}: non-black map surface`).toBe('rgb(49, 95, 61)');
  expect(layout.lastPaint?.routePainted, `${label}: route painted during latest resize`).toBe(true);
  expect(layout.lastPaint?.width ?? 0, `${label}: map paint width`).toBeGreaterThan(100);
  expect(layout.lastPaint?.height ?? 0, `${label}: map paint height`).toBeGreaterThan(100);
  expect(layout.mapBox, `${label}: playable map bounds`).not.toBeNull();
  expect(layout.riderBox, `${label}: rider panel bounds`).not.toBeNull();

  const shortLandscape = viewport.orientation === 'landscape' && viewport.height <= 500;
  const riderCardHeightLimit = viewport.orientation === 'portrait' ? 68 : shortLandscape ? 56 : 64;
  const riderRailHeightLimit = riderCardHeightLimit + 10;
  expect(layout.riderBox?.height ?? Number.POSITIVE_INFINITY,
    `${label}: rider panel stays compact`).toBeLessThanOrEqual(riderRailHeightLimit + 0.5);
  expect(layout.mapBox?.height ?? 0,
    `${label}: map keeps most of the playable screen`).toBeGreaterThanOrEqual(viewport.height * 0.54);
  expect(layout.mapBox?.height ?? 0,
    `${label}: map remains materially taller than the rider panel`)
    .toBeGreaterThan((layout.riderBox?.height ?? viewport.height) * 2);
  expect(layout.mapBox?.bottom ?? viewport.height,
    `${label}: rider panel does not cover the playable map`)
    .toBeLessThanOrEqual((layout.riderBox?.top ?? 0) + 2);

  expect(layout.riderCardBoxes.length, `${label}: rider card rendered`).toBeGreaterThan(0);
  for (const card of layout.riderCardBoxes) {
    expect(card?.height ?? Number.POSITIVE_INFINITY,
      `${label}: individual rider card stays compact`).toBeLessThanOrEqual(riderCardHeightLimit + 0.5);
  }
  for (const container of layout.horizontalContainers) {
    expect(container.scrollWidth, `${label}: ${container.selector} has no horizontal overflow`)
      .toBeLessThanOrEqual(container.clientWidth + 1);
  }
  for (const box of layout.boxes) {
    expect(box.left, `${label}: ${box.selector} left`).toBeGreaterThanOrEqual(-1);
    expect(box.top, `${label}: ${box.selector} top`).toBeGreaterThanOrEqual(-1);
    expect(box.right, `${label}: ${box.selector} right`).toBeLessThanOrEqual(layout.viewport.width + 1);
    expect(box.bottom, `${label}: ${box.selector} bottom`).toBeLessThanOrEqual(layout.viewport.height + 1);
  }
}

async function openDemoExploreRide(page: Page, legacyApplePreference: boolean) {
  await page.goto('/');
  await openSignedInApp(page);
  await page.getByRole('button', { name: /Demo/i }).first().click();
  await page.getByRole('button', { name: 'Explore the World', exact: true }).click();

  const renderer = page.getByRole('group', { name: 'Explore map renderer' });
  await expect(renderer).toBeVisible();
  await expect(renderer.getByRole('button')).toHaveCount(2);
  await expect(renderer.getByRole('button', { name: 'Google Satellite' })).toHaveClass(/selected/);
  await expect(page.getByText(/Apple (Satellite|Maps)/i)).toHaveCount(0);
  if (legacyApplePreference) {
    await expect.poll(() => page.evaluate(() => (
      window.localStorage.getItem('tracklab-explore-map-renderer-v1')
    ))).toBe('google-satellite');
  }

  await page.getByRole('textbox', { name: 'Starting location', exact: true })
    .fill('38.5, -120.2');
  await page.getByRole('textbox', { name: 'Destination', exact: true })
    .fill('43.252, -126.453');
  await page.getByRole('button', { name: 'Build Explore the World route' }).click();
  await expect(page.locator('.explore-route-summary')).toBeVisible();
  await expect(page.locator('.tracklab-mock-route-line').first()).toBeVisible();

  await page.getByRole('button', { name: 'Start Explore the World ride' }).click();
  await expect(page.locator('.platform-shell')).toHaveClass(/explore-fullscreen/);
  await expect(page.getByRole('button', { name: 'Pause ride' })).toBeVisible();
}

async function transitionExploreViewport(page: Page, viewport: DeviceViewport) {
  const before = await page.evaluate(() => ({
    paints: (window as typeof window & { __tracklabExploreMapPaints?: unknown[] })
      .__tracklabExploreMapPaints?.length ?? 0,
    resizes: (window as typeof window & { __tracklabExploreMapResizeCount?: number })
      .__tracklabExploreMapResizeCount ?? 0,
  }));

  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await expect.poll(() => page.evaluate(() => ({
    height: window.innerHeight,
    orientation: matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape',
    width: window.innerWidth,
  })), { message: `${viewport.label}: browser completed the orientation transition` }).toEqual({
    height: viewport.height,
    orientation: viewport.orientation,
    width: viewport.width,
  });
  await expect.poll(() => page.evaluate((previous) => {
    const paints = (window as typeof window & { __tracklabExploreMapPaints?: unknown[] })
      .__tracklabExploreMapPaints?.length ?? 0;
    const resizes = (window as typeof window & { __tracklabExploreMapResizeCount?: number })
      .__tracklabExploreMapResizeCount ?? 0;
    return paints > previous.paints || resizes > previous.resizes;
  }, before), { message: `${viewport.label}: Google map repainted after orientation change` }).toBe(true);

  await expectPaintedContainedExploreMap(page, viewport);
}

async function exerciseDeviceMatrix(page: Page, viewports: readonly DeviceViewport[]) {
  await expectPaintedContainedExploreMap(page, viewports[0]);

  for (const viewport of viewports.slice(1)) {
    await transitionExploreViewport(page, viewport);
  }

  await transitionExploreViewport(page, {
    ...viewports[0],
    label: `${viewports[0].label} after rotating back`,
  });
}

test('Explore keeps a compact painted layout through every supported iPhone orientation', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(deviceMatrices.iphone[0]);
  await installPaintedGoogleMapsRaster(page, 'iphone', true);
  await mockSignedInDeveloperAndExploreApis(page);
  await openDemoExploreRide(page, true);
  await exerciseDeviceMatrix(page, deviceMatrices.iphone);
});

test('Explore keeps a compact painted layout through every supported iPad orientation', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(deviceMatrices.ipad[0]);
  await installPaintedGoogleMapsRaster(page, 'ipad');
  await mockSignedInDeveloperAndExploreApis(page);
  await openDemoExploreRide(page, false);
  await exerciseDeviceMatrix(page, deviceMatrices.ipad);
});
