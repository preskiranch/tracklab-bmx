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
    { label: 'iPad screenshot landscape', orientation: 'landscape', width: 1280, height: 960 },
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

async function installPaintedGoogleMaps(
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
      private renderingType?: string;
      private zoom: number;
      private readonly element: HTMLElement;

      constructor(element: HTMLElement, options: { center?: Point; zoom?: number; heading?: number; renderingType?: string }) {
        this.element = element;
        this.renderingType = options.renderingType;
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
        this.element.replaceChildren(surface, ...this.element.querySelectorAll('.explore-map-rider-marker'));
        this.element.querySelectorAll<HTMLElement>('.explore-map-rider-marker').forEach(marker => {
          marker.style.left = `${this.element.clientWidth / 2}px`;
          marker.style.top = `${this.element.clientHeight / 2}px`;
        });
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

      addListener(eventName: string, handler: MockMapListener) {
        if (eventName === 'click') (window as any).__selectMockPlace = handler;
        return { remove() {} };
      }

      fitBounds() { this.element.dataset.routeOverview = "true"; }
      getCenter() { return { toJSON: () => this.center }; }
      getHeading() { return this.heading; }
      getZoom() { return this.zoom; }
      moveCamera(options: { center?: Point; zoom?: number; heading?: number; renderingType?: string }) {
        if (options.center) {
          this.center = options.center;
          this.element.dataset.center = JSON.stringify(this.center);
        }
        if (options.zoom != null) this.zoom = options.zoom;
        if (options.heading != null) this.setHeading(options.heading);
      }
      setCenter(center: Point) { this.center = center; }
      setHeading(heading: number) {
        if (this.renderingType === 'VECTOR') this.heading = heading;
        this.element.dataset.heading = String(this.heading);
      }
      setOptions() {}
      setTilt() {}
      setZoom(zoom: number) { this.zoom = zoom; this.element.dataset.zoom = String(zoom); }
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

    class MockOverlayView {
      map: any;
      onAdd = () => {};
      onRemove = () => {};
      draw = () => {};
      setMap(map: any) { this.map = map; if (map) { this.onAdd(); this.draw(); } else this.onRemove(); }
      getPanes() { return { overlayMouseTarget: this.map.element }; }
      getProjection() { return { fromLatLngToDivPixel: () => ({ x: this.map.element.clientWidth / 2, y: this.map.element.clientHeight / 2 }) }; }
    }
    class MockLatLng { constructor(public lat: number, public lng: number) {} }

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

    class MockPlace {
      displayName = 'Selected beach business';
      formattedAddress = 'Business address';
      location = {toJSON: () => ({lat:38.5002,lng:-120.201})};
      async fetchFields() {}
    }
    class MockStreetViewService {
      async getPanorama(request: any) {
        (window as any).__streetRequest = request;
        if ((window as any).__streetUnavailable) throw new Error('ZERO_RESULTS');
        return {data:{location:{pano:'selected-panorama',latLng:{toJSON:()=>({lat:request.location.lat-0.0001,lng:request.location.lng})}}}};
      }
    }
    class MockStreetViewPanorama {
      constructor(_element: HTMLElement, options: any) { (window as any).__streetOptions=options; }
      setVisible() {}
    }
    const places = {
      Place: MockPlace,
      AutocompleteService: MockAutocompleteService,
      AutocompleteSessionToken: MockAutocompleteSessionToken,
    };
    (window as typeof window & { google?: unknown }).google = {
      maps: {
        LatLngBounds: MockLatLngBounds,
        LatLng: MockLatLng,
        OverlayView: MockOverlayView,
        Map: MockMap,
        Marker: MockMarker,
        Point: MockPoint,
        Polyline: MockPolyline,
        Size: MockSize,
        SymbolPath: { CIRCLE: 'circle' },
        RenderingType: { VECTOR: 'VECTOR', RASTER: 'RASTER' },
        places,
        importLibrary: async (name: string) => (name === 'places' ? places : name === 'streetView' ? {StreetViewService:MockStreetViewService, StreetViewPanorama:MockStreetViewPanorama} : {}),
        event: {
          trigger: (target: { handleResize?: () => void }, eventName: string) => {
            if (eventName === 'resize') target.handleResize?.();
          },
        },
      },
    };
  }, { legacyApplePreference, userAgent: iosUserAgents[device] });
}

async function mockSignedInDeveloperAndExploreApis(page: Page, administrator = true) {
  const now = Date.now();
  const user = {
    id: administrator ? 'explore-device-regression' : 'other-preview-account',
    profileKey: administrator ? 'user:explore-device-regression' : 'user:other-preview-account',
    email: administrator ? 'explore-device@tracklab.test' : 'other-preview@tracklab.test',
    name: 'Explore Device Developer',
    admin: administrator,
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
      const incoming = (route.request().postDataJSON() as { routes?: any[] }).routes ?? [];
      recentRoutes = [...incoming, ...recentRoutes.filter((saved: any) => !incoming.some(item => item.id === saved.id))];
    }
    if (route.request().method() === 'DELETE') {
      const { routeId } = route.request().postDataJSON();
      recentRoutes = recentRoutes.filter((saved: any) => saved.id !== routeId);
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
          id: request.origin.lat === 38.5 ? 'EXPLORE-device-regression' : 'EXPLORE-second-route',
          origin: request.origin,
          destination: request.destination,
          originLabel: request.originLabel,
          destinationLabel: request.destinationLabel,
          travelMode: request.travelMode,
          distanceMeters: 1_000,
          durationSeconds: 300,
          encodedPolyline: request.origin.lat === 38.5 ? '_p~iF~ps|U_ulLnnqC_mqNvxq`@' : '_se~F~ps|U_ulLnnqC_mqNvxq`@',
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
      toolbarBox: box(document.querySelector('.explore-camera-toolbar')),
      actionBoxes: [...document.querySelectorAll('.explore-session-actions button')].map(button => box(button)),
      mapBox: box(mapGrid),
      orientation: matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape',
      riderBox: box(riderStrip),
      riderCardBoxes: riderCards.map((card) => box(card)),
      surfaceBackground: surfaceStyle?.backgroundColor ?? '',
      viewport: { height: window.innerHeight, width: window.innerWidth },
    };
  });

  const textSizes = await page.locator('.explore-rider-strip article').first().evaluate(card => ({
    name: parseFloat(getComputedStyle(card.querySelector('.explore-rider-name')!).fontSize),
    speed: parseFloat(getComputedStyle(card.querySelector('.explore-rider-speed')!).fontSize),
    average: parseFloat(getComputedStyle(card.querySelector('.explore-rider-average')!).fontSize),
    heart: parseFloat(getComputedStyle(card.querySelector('.explore-heart-rate')!).fontSize),
  }));
  expect(textSizes.name).toBeGreaterThanOrEqual(18);
  for (const size of [textSizes.speed, textSizes.average, textSizes.heart]) expect(size).toBeGreaterThanOrEqual(16);
  for (const action of layout.actionBoxes) {
    expect(action!.bottom, `${label}: action is not clipped by toolbar`).toBeLessThanOrEqual(layout.toolbarBox!.bottom + 1);
    expect(action!.bottom, `${label}: action is above the map`).toBeLessThanOrEqual(layout.mapBox!.top + 1);
  }
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
  const riderCardHeightLimit = shortLandscape ? 144 : 160;
  const riderRailHeightLimit = riderCardHeightLimit + 10;
  expect(layout.riderBox?.height ?? Number.POSITIVE_INFINITY,
    `${label}: rider panel stays compact`).toBeLessThanOrEqual(riderRailHeightLimit + 0.5);
  expect(layout.mapBox?.height ?? 0,
    `${label}: map keeps most of the playable screen`).toBeGreaterThanOrEqual(viewport.height * 0.35);
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

async function openDemoExploreRide(page: Page, legacyApplePreference: boolean, riderName?: string) {
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

  if (riderName) {
    await page.getByRole('textbox', { name: /^Name for player/ }).first().fill(riderName);
    await page.getByRole('textbox', { name: /^Name for player/ }).first().press('Tab');
  }
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
  await installPaintedGoogleMaps(page, 'iphone', true);
  await mockSignedInDeveloperAndExploreApis(page);
  await openDemoExploreRide(page, true);
  await exerciseDeviceMatrix(page, deviceMatrices.iphone);
});

test('Explore keeps a compact painted layout through every supported iPad orientation', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(deviceMatrices.ipad[0]);
  await installPaintedGoogleMaps(page, 'ipad');
  await mockSignedInDeveloperAndExploreApis(page);
  await openDemoExploreRide(page, false);
  await exerciseDeviceMatrix(page, deviceMatrices.ipad);
  await page.screenshot({ path: "/tmp/explore116-ipad.png" });
});

for (const device of ['iphone', 'ipad'] as const) {
  test(`Explore ${device} switches between travel heading and north`, async ({ page }) => {
    await page.setViewportSize(deviceMatrices[device][1]);
    await installPaintedGoogleMaps(page, device);
    await mockSignedInDeveloperAndExploreApis(page);
    await openDemoExploreRide(page, false);
    const options = page.getByRole('button', { name: 'View options', exact: true });
    if (await options.isVisible()) await options.click();
    await page.getByRole('button', { name: 'Direction of travel up', exact: true }).click();
    await expect.poll(async () => Number(await page.locator('.explore-map-canvas').first().getAttribute('data-heading'))).toBeGreaterThan(5);
    await page.getByRole('button', { name: 'North up', exact: true }).click();
    await expect.poll(async () => {
      const heading = Number(await page.locator('.explore-map-canvas').first().getAttribute('data-heading'));
      return Math.min(heading, 360 - heading);
    }).toBeLessThan(1);
  });
}

test('Explore produces audible bike output during a demo ride', async ({ page }) => {
  await page.addInitScript(() => {
    const audioWindow = window as typeof window & { bikeOutput?: AnalyserNode[] };
    audioWindow.bikeOutput = [];
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (destination: AudioNode, ...args: number[]) {
      if (destination instanceof AudioDestinationNode) {
        const analyser = this.context.createAnalyser();
        analyser.fftSize = 2048;
        audioWindow.bikeOutput!.push(analyser);
        connect.call(analyser, destination);
        return connect.call(this, analyser);
      }
      return connect.call(this, destination, ...args);
    } as typeof connect;
  });
  await page.setViewportSize({ width: 1280, height: 960 });
  await installPaintedGoogleMaps(page, 'ipad');
  await mockSignedInDeveloperAndExploreApis(page);
  await openDemoExploreRide(page, false);
  await expect.poll(() => page.evaluate(() => {
    const outputs = (window as typeof window & { bikeOutput?: AnalyserNode[] }).bikeOutput ?? [];
    return Math.max(0, ...outputs.map(analyser => {
      const samples = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(samples);
      return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
    }));
  }), { timeout: 20000 }).toBeGreaterThan(0.008);
  await page.getByRole('button', {name: 'Mute bike sounds'}).click();
  await expect(page.getByRole('button', {name: 'Unmute bike sounds'})).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const outputs = (window as typeof window & { bikeOutput?: AnalyserNode[] }).bikeOutput ?? [];
    return Math.max(0, ...outputs.map(analyser => {
      const samples = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(samples);
      return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
    }));
  })).toBeLessThan(0.001);
  await page.getByRole('button', {name: 'Unmute bike sounds'}).click();
  await expect(page.getByRole('button', {name: 'Mute bike sounds'})).toBeVisible();
  await page.screenshot({path:'/tmp/explore122-ipad-sound.png'});
});

test('Smart Route sends the selected surface through planning and route building', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 960 });
  await installPaintedGoogleMaps(page, 'ipad');
  await mockSignedInDeveloperAndExploreApis(page);
  const planRequests: unknown[] = [];
  const routeRequests: unknown[] = [];
  await page.route('**/api/explore/smart-route', async route => {
    const request = route.request().postDataJSON();
    planRequests.push(request);
    await route.fulfill({ json: { plan: {
      name: 'Direct city ride', originQuery: '38.5, -120.2', destinationQuery: '43.252, -126.453',
      routeSurface: request.routeSurface, routeKind: 'point-to-point', waypointQueries: [], sources: [],
    } } });
  });
  page.on('request', request => {
    if (request.url().endsWith('/api/explore/route')) routeRequests.push(request.postDataJSON());
  });
  await page.goto('/');
  await openSignedInApp(page);
  await page.getByRole('button', { name: /Demo/i }).first().click();
  await page.getByRole('button', { name: 'Explore the World', exact: true }).click();
  await page.getByRole('textbox', { name: 'Describe your Smart Route' }).fill('Cliff House to Ghirardelli Square');
  for (const surface of ['streets', 'streets-and-paths']) {
    await page.getByRole('combobox', { name: 'Smart Route type' }).selectOption(surface);
    await page.getByRole('button', { name: 'Find and build this ride' }).click();
    await expect.poll(() => planRequests.at(-1)).toMatchObject({ routeSurface: surface });
    await expect.poll(() => routeRequests.at(-1)).toMatchObject({ routeSurface: surface, waypoints: [] });
    await expect(page.getByRole('button', { name: 'Find and build this ride' })).toBeEnabled();
  }
});


test('Explore phone keeps its center across labeled view changes and rotation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installPaintedGoogleMaps(page, 'iphone');
  await mockSignedInDeveloperAndExploreApis(page);
  await openDemoExploreRide(page, false);
  await page.getByRole('button', { name: 'Pause ride' }).click();
  await page.waitForTimeout(500);
  const center = JSON.parse((await page.locator('.explore-map-canvas').first().getAttribute('data-center'))!);
  const expectSameCenter = async () => {
    await expect.poll(async () => {
      const recentered = JSON.parse((await page.locator('.explore-map-canvas').first().getAttribute('data-center'))!);
      return Math.abs(recentered.lat - center.lat) + Math.abs(recentered.lng - center.lng);
    }).toBeLessThan(0.00001);
  };
  await page.getByRole('button', { name: 'View options', exact: true }).click();
  for (const label of ['North up', 'Travel up', 'Free camera', 'Resume', 'Exit view']) {
    await expect(page.locator('.explore-camera-toolbar').getByText(label, { exact: true })).toBeVisible();
  }
  for (const name of ['Direction of travel up', 'North up', 'Enable free camera', 'Center rider', 'Show more of the route', 'Move closer to the riders']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expectSameCenter();
  }
  await page.screenshot({ path: '/tmp/explore115-phone-options.png' });
  await page.getByRole('button', { name: 'Close options' }).click();
  await page.screenshot({ path: '/tmp/explore115-phone.png' });
  await transitionExploreViewport(page, deviceMatrices.iphone[3]);
  await expectSameCenter();
  await page.screenshot({ path: '/tmp/explore115-landscape.png' });
});


test('Explore deletes a saved route only after confirmation and keeps it removed on reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installPaintedGoogleMaps(page, 'iphone');
  await mockSignedInDeveloperAndExploreApis(page);
  await openDemoExploreRide(page, false);
  await page.getByRole('button', { name: 'Pause ride' }).click();
  await page.getByRole('button', { name: 'Exit full screen' }).click();
  await page.getByText('Manage routes', { exact: true }).click();
  await page.getByRole('button', { name: /^Delete saved route/ }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Delete saved route/ })).toHaveCount(1);
  await page.getByRole('button', { name: /^Delete saved route/ }).click();
  const deleted = page.waitForRequest(r => r.method() === 'DELETE' && r.url().includes('/api/explore/recent-routes'));
  await page.getByRole('button', { name: 'Delete route', exact: true }).click();
  expect((await deleted).postDataJSON()).toEqual({ routeId: 'EXPLORE-device-regression' });
  await expect(page.getByText('Manage routes', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Recent Explore routes' })).toBeDisabled();
  await page.reload();
  await openSignedInApp(page);
  await page.getByRole('button', { name: 'Explore the World', exact: true }).click();
  await expect(page.getByText('Manage routes', { exact: true })).toHaveCount(0);
});

test('Explore setup rider cards use available width and readable text on phone tablet and PC', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 960 });
  await installPaintedGoogleMaps(page, 'ipad');
  await mockSignedInDeveloperAndExploreApis(page);
  await openDemoExploreRide(page, false, 'Rasheen The Machine Hicks');
  await page.getByRole('button', { name: 'Pause ride' }).click();
  await page.getByRole('button', { name: 'Exit full screen' }).click();
  await expect(page.locator('.explore-rider-name').first()).toHaveText('Rasheen The Machine Hicks');
  for (const viewport of [{width:1280,height:960}, {width:390,height:844}, {width:844,height:390}, {width:1920,height:1080}]) {
    await page.setViewportSize(viewport);
    const cards = page.locator('.explore-rider-strip article');
    await expect(cards.first()).toBeVisible();
    const layouts = await cards.evaluateAll(items => items.map(card => {
      const name = card.querySelector('.explore-rider-name')!;
      const speed = card.querySelector('.explore-rider-speed')!;
      const style = getComputedStyle(name);
      return {
        width: card.getBoundingClientRect().width,
        nameHeight: name.getBoundingClientRect().height,
        nameLineHeight: parseFloat(style.lineHeight),
        foreground: getComputedStyle(speed).color,
        background: getComputedStyle(card).backgroundColor,
        contained: card.getBoundingClientRect().right <= innerWidth + 1,
      };
    }));
    for (const layout of layouts) {
      expect(layout.width).toBeGreaterThan(270);
      expect(layout.nameHeight).toBeLessThanOrEqual(layout.nameLineHeight * 3);
      expect(layout.foreground).not.toBe(layout.background);
      expect(layout.contained).toBe(true);
    }
    if (viewport.width === 1280) await page.locator('.explore-rider-strip').screenshot({path:'/tmp/explore118-setup-cards.png'});
  }
});


test('Explore anchors the pin tip on the route coordinate across rotation', async ({page}) => {
  await page.setViewportSize({width:1280,height:960});
  await installPaintedGoogleMaps(page, 'ipad');
  await mockSignedInDeveloperAndExploreApis(page);
  await openDemoExploreRide(page, false);
  await page.getByRole('button', {name:'Pause ride'}).click();
  for (const viewport of [{width:1280,height:960},{width:390,height:844},{width:844,height:390}]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => page.locator('.explore-map-rider-marker').first().evaluate(marker => {
      const pin=marker.querySelector('.explore-map-rider-pin')!.getBoundingClientRect();
      const avatar=marker.querySelector('.explore-map-rider-avatar')!.getBoundingClientRect();
      const box=marker.parentElement!.getBoundingClientRect();
      return Math.max(Math.abs(pin.bottom-(box.top+box.height/2)), Math.abs(pin.left+pin.width/2-(box.left+box.width/2)), avatar.bottom-pin.bottom);
    })).toBeLessThan(2);
  }
});


test('Street View targets the selected business or tapped rider and reports missing imagery', async ({page}) => {
  await page.setViewportSize({width:1280,height:960});
  await installPaintedGoogleMaps(page, 'ipad');
  await mockSignedInDeveloperAndExploreApis(page);
  await openDemoExploreRide(page, false);
  await page.getByRole('button', {name:'Pause ride'}).click();
  await page.evaluate(()=>(window as any).__selectMockPlace({placeId:'beach-business',stop(){}}));
  await page.getByRole('button', {name:'View Street View'}).click();
  await expect(page.getByRole('dialog', {name:'Street View: Selected beach business'})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>(window as any).__streetRequest)).toEqual({location:{lat:38.5002,lng:-120.201},preference:'nearest',radius:50});
  await expect.poll(()=>page.evaluate(()=>(window as any).__streetOptions.pov.heading)).toBeCloseTo(0,1);
  await expect(page.getByText(/Camera is 11 m from/)).toBeVisible();
  await page.getByRole('button', {name:'Back to map',exact:true}).click();
  await page.getByRole('button', {name:'Demo Rider 4 map position — open Street View',exact:true}).click();
  await expect(page.getByRole('dialog', {name:'Street View: Demo Rider 4 · current route position'})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>(window as any).__streetRequest.location.lng)).not.toBe(-120.201);
  await page.getByRole('button', {name:'Back to map',exact:true}).click();
  await page.evaluate(()=>(window as any).__streetUnavailable=true);
  await page.getByRole('button', {name:'Demo Rider 4 map position — open Street View',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Street View is not available here');
});


test('recent routes switch on one selection and ignore an older pending build', async ({page}) => {
  await page.setViewportSize({width:1280,height:960});
  await installPaintedGoogleMaps(page, 'ipad');
  await mockSignedInDeveloperAndExploreApis(page);
  await openDemoExploreRide(page, false);
  await page.getByRole('button', {name:'Pause ride'}).click();
  await page.getByRole('button', {name:'Exit full screen'}).click();
  const recent = page.getByRole('combobox', {name:'Recent Explore routes'});
  await expect(recent).toHaveValue('EXPLORE-device-regression');
  await page.getByRole('textbox', {name:'Starting location',exact:true}).fill('39.5, -120.2');
  await page.getByRole('button', {name:'Build Explore the World route',exact:true}).click();
  await expect(recent).toHaveValue('EXPLORE-second-route');
  for (const id of ['EXPLORE-device-regression', 'EXPLORE-second-route', 'EXPLORE-device-regression']) {
    await recent.selectOption(id);
    await expect(recent).toHaveValue(id);
    await expect(page.locator('.explore-route-summary')).toContainText(id === 'EXPLORE-second-route' ? '39.5' : '38.5');
  }
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/explore/route', async route => {
    await hold;
    await route.fallback();
  });
  await page.getByRole('textbox', {name:'Starting location',exact:true}).fill('39.5, -120.2');
  const requested = page.waitForRequest('**/api/explore/route');
  await page.getByRole('button', {name:'Build Explore the World route',exact:true}).click();
  await requested;
  await recent.selectOption('EXPLORE-device-regression');
  const responded = page.waitForResponse('**/api/explore/route');
  release();
  await responded;
  await expect(recent).toHaveValue('EXPLORE-device-regression');
  await expect(page.locator('.explore-route-summary')).toContainText('38.5');
});


test('Explore defaults to sound enabled and toggles immediately even when audio cannot load', async ({page}) => {
  await page.setViewportSize({width:1280,height:960});
  await installPaintedGoogleMaps(page, 'ipad');
  await mockSignedInDeveloperAndExploreApis(page);
  await page.route('**/assets/bmx-bike-mechanics.mp3', route => route.fulfill({status:503,body:'Unavailable'}));
  await openDemoExploreRide(page, false);
  await page.getByRole('button', {name:'Pause ride'}).click();
  const mute = page.getByRole('button', {name:'Mute bike sounds',exact:true});
  const unmute = page.getByRole('button', {name:'Unmute bike sounds',exact:true});
  await expect(mute).toHaveText('Mute');
  await expect(mute).toHaveAttribute('aria-pressed','false');
  await mute.click();
  await expect(unmute).toHaveText('Unmute');
  await expect(unmute).toHaveAttribute('aria-pressed','true');
  await unmute.click();
  await expect(mute).toHaveText('Mute');
  await expect(mute).toHaveAttribute('aria-pressed','false');
});


test('route preview stays in setup, orbits for 60 seconds and preserves zoom without starting a ride', async ({page}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({width:1280,height:960});
  await installPaintedGoogleMaps(page, 'ipad');
  await mockSignedInDeveloperAndExploreApis(page);
  await openDemoExploreRide(page, false);
  await page.getByRole('button', {name:'Pause ride', exact:true}).click();
  await page.getByRole('button', {name:'Exit full screen'}).click();
  await page.getByRole('button', {name:'Reset', exact:true}).last().click();
  const start = page.getByRole('button', {name:'Start Explore the World ride', exact:true});
  await expect(start).toBeVisible();
  await page.clock.install();
  await page.getByRole('button', {name:'Preview route · 1 min'}).click();
  await page.locator('.explore-route-preview-controls').screenshot({path:'/tmp/preview124-controls.png'});
  const canvas = page.locator('.explore-map-canvas').first();
  await page.clock.runFor(10_000);
  await expect(canvas).toHaveAttribute('data-heading', /6[0-9]/);
  await page.getByRole('button', {name:'Pause preview', exact:true}).click();
  const center = await canvas.getAttribute('data-center');
  await page.getByRole('button', {name:'Show more of the route', exact:true}).click();
  await expect(canvas).toHaveAttribute('data-zoom','17');
  await page.clock.runFor(1000);
  expect(await canvas.getAttribute('data-center')).toBe(center);
  await expect(start).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button', {name:'Resume preview', exact:true}).click();
  await page.clock.runFor(10_000);
  await expect(canvas).toHaveAttribute('data-heading', /1[12][0-9]/);
  await page.setViewportSize({width:844,height:390});
  await page.clock.runFor(40_500);
  await expect(page.getByText('Preview complete', {exact:true})).toBeVisible();
  await expect(canvas).toHaveAttribute('data-route-overview','true');
  await expect(start).toBeVisible();
  await page.getByRole('button', {name:'Replay', exact:true}).click();
  await page.clock.runFor(1000);
  await page.getByRole('button', {name:'Exit preview', exact:true}).click();
  await expect(page.getByRole('button', {name:'Preview route · 1 min'})).toBeVisible();
});


test('create save and preview a route with no bike or demo riders then restore it later', async ({page}) => {
  await page.setViewportSize({width:1280,height:960});
  await installPaintedGoogleMaps(page, 'ipad');
  await mockSignedInDeveloperAndExploreApis(page);
  await page.goto('/');
  await openSignedInApp(page);
  await page.getByRole('button', {name:'Explore the World', exact:true}).click();
  await page.getByRole('textbox', {name:'Starting location', exact:true}).fill('38.5, -120.2');
  await page.getByRole('textbox', {name:'Destination', exact:true}).fill('43.252, -126.453');
  const saved = page.waitForResponse(response => response.url().includes('/api/explore/recent-routes') && response.request().method() === 'POST');
  await page.getByRole('button', {name:'Build Explore the World route'}).click();
  expect((await saved).ok()).toBe(true);
  await expect(page.getByRole('button', {name:'Start Explore the World ride', exact:true})).toBeDisabled();
  await expect(page.getByText('Saved to Recent routes · ready whenever you are')).toBeVisible();
  await page.getByRole('button', {name:'Preview route · 1 min'}).click();
  await expect(page.getByRole('button', {name:'Pause preview', exact:true})).toBeVisible();
  await page.reload();
  await openSignedInApp(page);
  await page.getByRole('button', {name:'Explore the World', exact:true}).click();
  await page.getByRole('button', {name:'Saved routes (1)', exact:true}).click();
  await page.getByRole('combobox', {name:'Saved Explore routes'}).selectOption('EXPLORE-device-regression');
  await expect(page.locator('.explore-route-summary')).toBeVisible();
  await page.getByRole('button', {name:'Recent routes', exact:true}).click();
  await expect(page.getByRole('combobox', {name:'Recent Explore routes'})).toHaveValue('EXPLORE-device-regression');
  await expect(page.getByRole('button', {name:'Preview route · 1 min'})).toBeVisible();
  await expect(page.getByRole('button', {name:'Start Explore the World ride', exact:true})).toBeDisabled();
});


test('administrator locks orbit speed globally and a different account receives it', async ({page, browser}) => {
  let globalSpeed = 1;
  const serveSettings = async (target: Page) => {
    await target.route('**/api/explore/preview-settings', async route => {
      if (route.request().method() === 'PATCH') globalSpeed = route.request().postDataJSON().orbitSpeed;
      await route.fulfill({contentType:'application/json', body:JSON.stringify({orbitSpeed:globalSpeed, locked:true})});
    });
  };
  const buildWithoutBike = async (target: Page) => {
    await target.goto('/');
    await openSignedInApp(target);
    await target.getByRole('button', {name:'Explore the World', exact:true}).click();
    await target.getByRole('textbox', {name:'Starting location', exact:true}).fill('38.5, -120.2');
    await target.getByRole('textbox', {name:'Destination', exact:true}).fill('43.252, -126.453');
    await target.getByRole('button', {name:'Build Explore the World route'}).click();
  };
  await page.setViewportSize({width:1280,height:960});
  await installPaintedGoogleMaps(page, 'ipad');
  await mockSignedInDeveloperAndExploreApis(page);
  await serveSettings(page);
  await buildWithoutBike(page);
  await page.getByText('Administrator · Orbit speed (locked)', {exact:true}).click();
  await page.getByRole('button', {name:'Unlock orbit speed', exact:true}).click();
  await page.getByRole('slider', {name:'Preview orbit speed'}).fill('0.5');
  await page.getByRole('button', {name:'Save & lock for all devices', exact:true}).click();
  await expect(page.getByText('Saved and locked for all devices.', {exact:true})).toBeVisible();
  expect(globalSpeed).toBe(0.5);
  await expect(page.getByRole('slider', {name:'Preview orbit speed'})).toHaveCount(0);
  const context = await browser.newContext({viewport:{width:390,height:844}});
  const other = await context.newPage();
  await installPaintedGoogleMaps(other, 'iphone');
  await mockSignedInDeveloperAndExploreApis(other, false);
  await serveSettings(other);
  await buildWithoutBike(other);
  await expect(other.getByText(/Administrator · Orbit speed/)).toHaveCount(0);
  await other.clock.install();
  await other.getByRole('button', {name:'Preview route · 1 min'}).click();
  await other.clock.runFor(10_000);
  await expect(other.locator('.explore-map-canvas').first()).toHaveAttribute('data-heading', /3[0-9]/);
  await context.close();
});

test('preview settings endpoint allows reads but rejects unsigned changes', async ({request}) => {
  const response = await request.get('/api/explore/preview-settings');
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({orbitSpeed:1, locked:true});
  const update = await request.patch('/api/explore/preview-settings', {data:{orbitSpeed:2}});
  expect(update.status()).toBe(401);
});


test('landmark tip auto hides after ten riding seconds and dismisses immediately on tap', async ({page}) => {
  await page.setViewportSize({width:1280,height:960});
  await installPaintedGoogleMaps(page, 'ipad');
  await mockSignedInDeveloperAndExploreApis(page);
  await openDemoExploreRide(page, false);
  const tip = page.getByRole('button', {name:'Dismiss landmark tip', exact:true});
  await expect(tip).toBeVisible();
  await page.clock.install();
  await page.clock.runFor(11_000);
  await expect(tip).toHaveCount(0);
  await page.getByRole('button', {name:'Pause ride', exact:true}).click();
  await page.getByRole('button', {name:'Exit full screen'}).click();
  await page.getByRole('button', {name:'Reset', exact:true}).last().click();
  await expect(tip).toBeVisible();
  await tip.click();
  await expect(tip).toHaveCount(0);
  await page.getByRole('button', {name:'Start Explore the World ride', exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  await expect(tip).toHaveCount(0);
  await page.setViewportSize({width:844,height:390});
  await expect(tip).toHaveCount(0);
});


test('solo demo survives socket identity changes and reload restores paused progress', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 960 });
  await installPaintedGoogleMaps(page, 'ipad');
  await mockSignedInDeveloperAndExploreApis(page);
  let socket: { send: (data: string) => void } | undefined;
  await page.route('**/api/auth/websocket-ticket', route => route.fulfill({ json: { ticket: 'a'.repeat(43), expiresAt: Date.now() + 600_000 } }));
  await page.routeWebSocket(/multiplayer/, ws => {
    socket = ws;
    ws.send(JSON.stringify({ type: 'connected', clientId: 'first-connection' }));
  });
  await openDemoExploreRide(page, false);
  await page.clock.install();
  await page.clock.runFor(15_000);
  const checkpoint = () => page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.startsWith('tracklab-explore-ride-checkpoint-v1:') && key.endsWith('%3Ademo'));
    return key ? JSON.parse(localStorage.getItem(key)!) : null;
  });
  await expect.poll(async () => (await checkpoint())?.elapsedMs ?? 0).toBeGreaterThan(10_000);
  const before = await checkpoint();
  expect(socket).toBeDefined();
  socket!.send(JSON.stringify({ type: 'connected', clientId: 'reconnected-client' }));
  await page.clock.runFor(5_000);
  await expect(page.getByRole('button', { name: 'Pause ride' })).toBeVisible();
  expect((await checkpoint()).elapsedMs).toBeGreaterThan(before.elapsedMs);
  await page.reload();
  await expect(page.locator('.explore-view')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resume ride', exact: true })).toBeVisible();
  const recovered = await checkpoint();
  expect(recovered.elapsedMs).toBeGreaterThanOrEqual(before.elapsedMs);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Resume ride', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause ride' })).toBeVisible();
});

test('Explore sound controls never prime race cadence or BMX ambience', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 960 });
  await installPaintedGoogleMaps(page, 'ipad');
  await mockSignedInDeveloperAndExploreApis(page);
  await page.addInitScript(() => {
    const audioWindow = window as typeof window & { exploreRaceAudioPlays?: string[] };
    audioWindow.exploreRaceAudioPlays = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (document.querySelector('.explore-view') && /uci-random-start|bmx-event-ambience/.test(this.src)) {
        audioWindow.exploreRaceAudioPlays!.push(this.src);
      }
      return play.call(this);
    };
  });
  await openDemoExploreRide(page, false);
  await page.getByRole('button', { name: 'Mute bike sounds', exact: true }).click();
  await page.getByRole('button', { name: 'Unmute bike sounds', exact: true }).click();
  await page.getByRole('button', { name: 'Pause ride', exact: true }).click();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.clock.install();
  await page.clock.runFor(30_000);
  expect(await page.evaluate(() => (window as typeof window & { exploreRaceAudioPlays?: string[] }).exploreRaceAudioPlays)).toEqual([]);
  await expect(page.getByRole('button', { name: 'Pause ride', exact: true })).toBeVisible();
});
