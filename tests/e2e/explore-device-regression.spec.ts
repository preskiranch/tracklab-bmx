import { expect, test, type Page } from '@playwright/test';

const iphonePortrait = { width: 390, height: 844 };
const landscapeViewports = [
  { label: 'iPhone SE 3', width: 667, height: 375 },
  { label: 'iPhone 15/16', width: 844, height: 390 },
  { label: 'iPhone Plus', width: 932, height: 430 },
  { label: 'iPad mini', width: 1133, height: 744 },
] as const;

async function installPaintedGoogleMapsRaster(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      get: () => [
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X)',
        'AppleWebKit/605.1.15 Mobile/15E148 TrackLabBMX-iOS',
      ].join(' '),
    });
    window.localStorage.setItem('tracklab-explore-map-renderer-v1', 'apple-satellite');

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
  });
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

async function expectPaintedContainedExploreMap(page: Page, label: string) {
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
    const surfaceStyle = surface ? getComputedStyle(surface) : null;
    const paints = (window as typeof window & {
      __tracklabExploreMapPaints?: Array<{ height: number; routePainted: boolean; width: number }>;
    }).__tracklabExploreMapPaints ?? [];
    return {
      boxes: visibleBoxes,
      documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      lastPaint: paints.at(-1) ?? null,
      surfaceBackground: surfaceStyle?.backgroundColor ?? '',
      viewport: { height: window.innerHeight, width: window.innerWidth },
    };
  });

  expect(layout.documentFits, `${label}: document horizontal containment`).toBe(true);
  expect(layout.surfaceBackground, `${label}: non-black map surface`).toBe('rgb(49, 95, 61)');
  expect(layout.lastPaint?.routePainted, `${label}: route painted during latest resize`).toBe(true);
  expect(layout.lastPaint?.width ?? 0, `${label}: map paint width`).toBeGreaterThan(100);
  expect(layout.lastPaint?.height ?? 0, `${label}: map paint height`).toBeGreaterThan(100);
  for (const box of layout.boxes) {
    expect(box.left, `${label}: ${box.selector} left`).toBeGreaterThanOrEqual(-1);
    expect(box.top, `${label}: ${box.selector} top`).toBeGreaterThanOrEqual(-1);
    expect(box.right, `${label}: ${box.selector} right`).toBeLessThanOrEqual(layout.viewport.width + 1);
    expect(box.bottom, `${label}: ${box.selector} bottom`).toBeLessThanOrEqual(layout.viewport.height + 1);
  }
}

test('Explore migrates Apple preference and keeps the Google route painted through iPhone rotation', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize(iphonePortrait);
  await installPaintedGoogleMapsRaster(page);
  await mockSignedInDeveloperAndExploreApis(page);

  await page.goto('/');
  await openSignedInApp(page);
  await page.getByRole('button', { name: /Demo/i }).first().click();
  await page.getByRole('button', { name: 'Explore the World', exact: true }).click();

  const renderer = page.getByRole('group', { name: 'Explore map renderer' });
  await expect(renderer).toBeVisible();
  await expect(renderer.getByRole('button')).toHaveCount(2);
  await expect(renderer.getByRole('button', { name: 'Google Satellite' })).toHaveClass(/selected/);
  await expect(page.getByText(/Apple (Satellite|Maps)/i)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (
    window.localStorage.getItem('tracklab-explore-map-renderer-v1')
  ))).toBe('google-satellite');

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
  const paintsBeforeRotation = await page.evaluate(() => (
    (window as typeof window & { __tracklabExploreMapPaints?: unknown[] })
      .__tracklabExploreMapPaints?.length ?? 0
  ));

  for (const viewport of landscapeViewports) {
    const resizeCountBefore = await page.evaluate(() => (
      (window as typeof window & { __tracklabExploreMapResizeCount?: number })
        .__tracklabExploreMapResizeCount ?? 0
    ));
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect.poll(() => page.evaluate((previous) => (
      ((window as typeof window & { __tracklabExploreMapResizeCount?: number })
        .__tracklabExploreMapResizeCount ?? 0) > previous
    ), resizeCountBefore), { message: `${viewport.label}: Google map resized after viewport change` })
      .toBe(true);
    await expectPaintedContainedExploreMap(page, viewport.label);
  }

  await expect.poll(() => page.evaluate((previous) => (
    ((window as typeof window & { __tracklabExploreMapPaints?: unknown[] })
      .__tracklabExploreMapPaints?.length ?? 0) > previous
  ), paintsBeforeRotation)).toBe(true);
  await expect.poll(() => page.evaluate(() => (
    (window as typeof window & { __tracklabExploreMapInstances?: number })
      .__tracklabExploreMapInstances ?? 0
  ))).toBeGreaterThanOrEqual(3);
});
