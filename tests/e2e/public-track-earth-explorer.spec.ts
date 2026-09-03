import { expect, test, type Page } from '@playwright/test';

const tracks = [
  {
    id: 'napa-track',
    name: 'Napa Track BMX',
    country: 'United States',
    countryCode: 'US',
    state: 'California',
    region: 'California',
    source: 'Test directory',
    city: 'Napa',
    latitude: 38.2975,
    longitude: -122.2869,
  },
  {
    id: 'melbourne-track',
    name: 'Melbourne Track BMX',
    country: 'Australia',
    countryCode: 'AU',
    state: 'Victoria',
    region: 'Victoria',
    source: 'Test directory',
    city: 'Melbourne',
    latitude: -37.8136,
    longitude: 144.9631,
  },
  {
    id: 'london-track',
    name: 'London Track BMX',
    country: 'United Kingdom',
    countryCode: 'GB',
    state: 'England',
    region: 'England',
    source: 'Test directory',
    city: 'London',
    latitude: 51.5072,
    longitude: -0.1276,
  },
];

const bikeShop = {
  id: 'osm:node:9001',
  name: 'Napa Blue Dot Bikes',
  latitude: 38.301,
  longitude: -122.281,
  distanceMiles: 0.6,
  address: {
    line1: '9001 Test Street',
    locality: 'Napa',
    region: 'CA',
    postalCode: '94558',
    countryCode: 'US',
    formatted: '9001 Test Street, Napa, CA 94558',
  },
  phone: '',
  website: '',
  openingHours: '',
  services: { sales: true, repair: true, rental: false, ebike: false },
  source: {
    provider: 'OpenStreetMap',
    elementType: 'node',
    elementId: '9001',
    url: 'https://www.openstreetmap.org/node/9001',
  },
  links: {},
};

async function installGoogleEarthMock(page: Page) {
  await page.addInitScript(() => {
    type Point = { lat: number; lng: number; altitude?: number };
    type Callback = (event?: { latLng?: { toJSON: () => Point } }) => void;

    class MockBounds {
      extend() { return this; }
    }

    class MockMap {
      listeners = new Map<string, Set<Callback>>();
      options: Record<string, unknown>;

      constructor(_element: HTMLElement, options: Record<string, unknown>) {
        this.options = options;
        const state = (window as typeof window & { __tracklabEarthState?: { maps2d: MockMap[] } }).__tracklabEarthState;
        state?.maps2d.push(this);
        window.setTimeout(() => this.emit('tilesloaded'), 0);
      }

      addListener(name: string, callback: Callback) {
        const listeners = this.listeners.get(name) ?? new Set<Callback>();
        listeners.add(callback);
        this.listeners.set(name, listeners);
        return { remove: () => listeners.delete(callback) };
      }

      emit(name: string, event?: { latLng?: { toJSON: () => Point } }) {
        this.listeners.get(name)?.forEach((callback) => callback(event));
      }
      emitClick(point: Point) { this.emit('click', { latLng: { toJSON: () => point } }); }
      fitBounds() {}
      setHeading() {}
      setTilt() {}
      setOptions() {}
    }

    class MockMarker {
      constructor(_options: Record<string, unknown>) {}
      addListener() { return { remove() {} }; }
      setIcon() {}
      setMap() {}
      setPosition() {}
      setTitle() {}
    }

    class MockMap3DElement extends HTMLElement {
      center: Point = { lat: 0, lng: 0, altitude: 0 };
      heading = 0;
      mode = 'SATELLITE';
      range = 1_400;
      tilt = 62;

      constructor(options: Record<string, unknown> = {}) {
        super();
        Object.assign(this, options);
      }

      connectedCallback() {
        const state = (window as typeof window & {
          __tracklabEarthState?: { maps: MockMap3DElement[]; markers: MockMarker3DElement[] };
        }).__tracklabEarthState;
        state?.maps.push(this);
        const event = new Event('gmp-steadychange');
        Object.defineProperty(event, 'isSteady', { value: true });
        queueMicrotask(() => this.dispatchEvent(event));
      }

      flyCameraTo(options: { endCamera?: Record<string, unknown> }) {
        Object.assign(this, options.endCamera ?? {});
        this.dispatchEvent(new Event('gmp-centerchange'));
        this.dispatchEvent(new Event('gmp-rangechange'));
      }
    }

    class MockPolyline3DElement extends HTMLElement {}

    class MockMarker3DElement extends HTMLElement {
      altitudeMode = '';
      collisionBehavior = '';
      drawsWhenOccluded = false;
      extruded = false;
      label = '';
      position: Point = { lat: 0, lng: 0 };
      sizePreserved = false;
      title = '';
      zIndex = 0;

      constructor(options: Record<string, unknown> = {}) {
        super();
        Object.assign(this, options);
        const state = (window as typeof window & {
          __tracklabEarthState?: { maps: MockMap3DElement[]; markers: MockMarker3DElement[] };
        }).__tracklabEarthState;
        state?.markers.push(this);
      }

      emitClick() {
        this.dispatchEvent(new Event('gmp-click'));
      }
    }

    class MockPinElement extends HTMLElement {
      background = '';
      borderColor = '';
      glyphColor = '';
      glyphText = '';
      scale = 1;

      constructor(options: Record<string, unknown> = {}) {
        super();
        Object.assign(this, options);
        const state = (window as typeof window & { __tracklabEarthState?: { pins: MockPinElement[] } }).__tracklabEarthState;
        state?.pins.push(this);
      }
    }

    class MockStreetViewCoverageLayer {
      setMap(map: MockMap | null) {
        const state = (window as typeof window & { __tracklabEarthState?: { coverageMap: MockMap | null } }).__tracklabEarthState;
        if (state) state.coverageMap = map;
      }
    }

    class MockStreetViewService {
      async getPanorama(request: { location: Point }) {
        return {
          data: {
            copyright: 'Mock Street View',
            imageDate: '2026-09',
            location: { description: 'Mock blue road', pano: 'mock-pano', point: request.location },
          },
        };
      }
    }

    class MockStreetViewPanorama {
      constructor(_element: HTMLElement, options: Record<string, unknown>) {
        const state = (window as typeof window & { __tracklabEarthState?: { panoramas: Array<Record<string, unknown>> } }).__tracklabEarthState;
        state?.panoramas.push(options);
      }
      focus() {}
      setVisible() {}
    }

    if (!customElements.get('tracklab-public-map-3d')) {
      customElements.define('tracklab-public-map-3d', MockMap3DElement);
      customElements.define('tracklab-public-polyline-3d', MockPolyline3DElement);
      customElements.define('tracklab-public-marker-3d', MockMarker3DElement);
      customElements.define('tracklab-public-pin', MockPinElement);
    }

    const maps3d = {
      Map3DElement: customElements.get('tracklab-public-map-3d'),
      Marker3DElement: customElements.get('tracklab-public-marker-3d'),
      Marker3DInteractiveElement: customElements.get('tracklab-public-marker-3d'),
      Polyline3DElement: customElements.get('tracklab-public-polyline-3d'),
    };
    const markerLibrary = { PinElement: customElements.get('tracklab-public-pin') };
    const streetViewLibrary = {
      StreetViewCoverageLayer: MockStreetViewCoverageLayer,
      StreetViewPanorama: MockStreetViewPanorama,
      StreetViewService: MockStreetViewService,
    };
    const state = {
      coverageMap: null as MockMap | null,
      maps: [] as MockMap3DElement[],
      maps2d: [] as MockMap[],
      markers: [] as MockMarker3DElement[],
      panoramas: [] as Array<Record<string, unknown>>,
      pins: [] as MockPinElement[],
    };
    Object.defineProperty(window, '__tracklabEarthState', { configurable: true, value: state });
    Object.defineProperty(window, 'google', {
      configurable: true,
      value: {
        maps: {
          event: { trigger() {} },
          importLibrary: async (name: string) => name === 'maps3d'
            ? maps3d
            : name === 'marker'
              ? markerLibrary
              : name === 'streetView'
                ? streetViewLibrary
                : {},
          LatLngBounds: MockBounds,
          Map: MockMap,
          Marker: MockMarker,
          SymbolPath: { CIRCLE: 'circle' },
        },
      },
    });
  });
}

async function routePublicDirectory(page: Page) {
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user: null }) });
  });
  await page.route('**/data/track-locator.json', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ generatedAt: '2026-09-02T00:00:00.000Z', tracks }),
    });
  });
  await page.route('**/api/bike-shops/viewport', async (route) => {
    const bounds = route.request().postDataJSON();
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        bounds,
        shops: [bikeShop],
        truncated: true,
        degraded: true,
        notice: 'Showing catalog results while one live source is unavailable.',
        attribution: { text: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright', license: 'ODbL' },
        attributions: [{ text: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright', license: 'ODbL' }],
      }),
    });
  });
  await page.route('**/api/bike-shops/nearby', async (route) => {
    const request = route.request().postDataJSON() as { latitude: number; longitude: number; radiusMiles: number };
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        origin: request,
        shops: [bikeShop],
        attribution: { text: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright', license: 'ODbL' },
      }),
    });
  });
}

test('global 3D explorer starts at one track, reveals tracks with camera range, and returns through TrackLab', async ({ page }) => {
  await installGoogleEarthMock(page);
  await routePublicDirectory(page);
  await page.goto(`/?locator=${tracks[0].id}#track-locator`);

  const locator = page.locator('#track-locator');
  await expect(locator.getByRole('heading', { name: tracks[0].name })).toBeVisible();
  const selectedTrackEarth = locator.getByRole('group', { name: 'Explore in 3D—not directions' });
  await expect(selectedTrackEarth.getByRole('link', {
    name: `Explore ${tracks[0].name} in Google Earth—not turn-by-turn directions`,
  })).toHaveAttribute('href', /earth\.google\.com/);

  const globalExplorer = locator.getByRole('region', { name: 'Global 3D Track Explorer' });
  await expect(globalExplorer.getByText('All BMX tracks in 3D', { exact: true })).toBeVisible();
  await globalExplorer.getByRole('button', {
    name: `Open global 3D track explorer starting at ${tracks[0].name}`,
  }).click();

  const earth = page.getByRole('dialog', { name: `Global 3D track explorer starting at ${tracks[0].name}` });
  await expect(earth).toBeVisible();
  await expect(earth.getByText('1 red track pin loaded')).toBeVisible();
  await expect(earth.getByText(/Turn on shops to add clickable blue bike-shop pins/)).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    type Point = { lat: number; lng: number; altitude?: number };
    const state = (window as typeof window & {
      __tracklabEarthState?: {
        maps: Array<{ center: Point; description: string; mode: string; range: number; tilt: number }>;
        markers: Array<{
          altitudeMode: string;
          collisionBehavior: string;
          extruded: boolean;
          isConnected: boolean;
          label: string;
          position: Point;
          sizePreserved: boolean;
        }>;
        pins: Array<{ background: string; isConnected: boolean }>;
      };
    }).__tracklabEarthState;
    const activeMarkers = state?.markers.filter((marker) => marker.isConnected) ?? [];
    return {
      activeMarkers: activeMarkers.map((marker) => ({
        altitude: marker.position.altitude,
        altitudeMode: marker.altitudeMode,
        collisionBehavior: marker.collisionBehavior,
        extruded: marker.extruded,
        label: marker.label,
        sizePreserved: marker.sizePreserved,
      })),
      activePinColors: state?.pins.filter((pin) => pin.isConnected).map((pin) => pin.background) ?? [],
      map: state?.maps[0] ? {
        center: state.maps[0].center,
        description: state.maps[0].description,
        mode: state.maps[0].mode,
        range: state.maps[0].range,
        tilt: state.maps[0].tilt,
      } : null,
    };
  })).toEqual({
    activePinColors: ['#ff4d4f'],
    activeMarkers: [{
      altitude: expect.any(Number),
      altitudeMode: 'RELATIVE_TO_GROUND',
      collisionBehavior: 'REQUIRED',
      extruded: true,
      label: tracks[0].name,
      sizePreserved: true,
    }],
    map: {
      center: { lat: tracks[0].latitude, lng: tracks[0].longitude, altitude: 0 },
      description: `Interactive global 3D BMX track map starting at ${tracks[0].name}. Zoom out to reveal more named BMX tracks.`,
      mode: 'HYBRID',
      range: 1_400,
      tilt: 62,
    },
  });

  const labelsToggle = earth.getByRole('button', { name: 'Hide map boundaries and labels' });
  await expect(labelsToggle).toHaveAttribute('aria-pressed', 'true');
  await labelsToggle.click();
  await expect(earth.getByRole('button', { name: 'Show map boundaries and labels' })).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => page.evaluate(() => (
    (window as typeof window & { __tracklabEarthState?: { maps: Array<{ mode: string }> } })
      .__tracklabEarthState?.maps[0]?.mode
  ))).toBe('SATELLITE');
  await earth.getByRole('button', { name: 'Show map boundaries and labels' }).click();
  await expect.poll(() => page.evaluate(() => (
    (window as typeof window & { __tracklabEarthState?: { maps: Array<{ mode: string }> } })
      .__tracklabEarthState?.maps[0]?.mode
  ))).toBe('HYBRID');

  await page.evaluate(() => {
    const map = (window as typeof window & {
      __tracklabEarthState?: { maps: Array<{ range: number; dispatchEvent: (event: Event) => boolean }> };
    }).__tracklabEarthState?.maps[0];
    if (!map) throw new Error('Earth map did not mount');
    map.range = 4_200_000;
    map.dispatchEvent(new Event('gmp-rangechange'));
  });
  await expect(earth.getByText('3 red track pins loaded')).toBeVisible();

  await page.evaluate((trackName) => {
    const marker = (window as typeof window & {
      __tracklabEarthState?: { markers: Array<{ emitClick: () => void; isConnected: boolean; label: string }> };
    }).__tracklabEarthState?.markers.find((candidate) => candidate.isConnected && candidate.label === trackName);
    marker?.emitClick();
  }, tracks[1].name);

  await expect(earth).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`locator=${tracks[1].id}.*#track-locator`));
  await expect(locator.getByRole('heading', { name: tracks[1].name })).toBeVisible();
  await expect(locator.locator('.public-track-details p')).toContainText('Melbourne, Victoria, Australia');
  await expect(locator.locator('.public-track-details')).toBeFocused();
});

test('global 3D explorer toggles blue bike-shop pins and opens the exact shop inside TrackLab', async ({ page }) => {
  await installGoogleEarthMock(page);
  await routePublicDirectory(page);
  await page.goto(`/?locator=${tracks[0].id}#track-locator`);
  await page.getByRole('button', {
    name: `Open global 3D track explorer starting at ${tracks[0].name}`,
  }).click();

  const earth = page.getByRole('dialog', { name: `Global 3D track explorer starting at ${tracks[0].name}` });
  const shopToggle = earth.getByRole('button', { name: 'Show blue bike shop pins' });
  await expect(shopToggle).toHaveAttribute('aria-pressed', 'false');
  await shopToggle.click();
  await expect(earth.getByText(/1 bike shop loaded as blue pins.*result limit/)).toBeVisible();
  await expect(earth.getByText('Showing catalog results while one live source is unavailable.')).toBeVisible();
  const attributionLink = earth.getByRole('link', { name: '© OpenStreetMap contributors' });
  await expect(attributionLink).toHaveCSS('pointer-events', 'auto');
  await attributionLink.click({ trial: true });
  await expect(attributionLink).toHaveAttribute(
    'href',
    'https://www.openstreetmap.org/copyright',
  );
  await expect.poll(() => page.evaluate((shopName) => {
    const state = (window as any).__tracklabEarthState;
    return {
      bluePins: state.pins.filter((pin: any) => pin.isConnected && pin.background === '#1687ff').length,
      shopMarkers: state.markers.filter((marker: any) => marker.isConnected && marker.title.includes(shopName)).length,
    };
  }, bikeShop.name)).toEqual({ bluePins: 1, shopMarkers: 1 });

  await page.evaluate((shopName) => {
    const marker = (window as any).__tracklabEarthState.markers
      .find((candidate: any) => candidate.isConnected && candidate.title.includes(shopName));
    marker?.emitClick();
  }, bikeShop.name);

  await expect(earth).toHaveCount(0);
  await expect(page).toHaveURL(/#bike-shop-directory/);
  const directory = page.locator('#bike-shop-directory');
  await expect(directory.getByRole('heading', { name: 'Find a bike shop near you' })).toBeVisible();
  await expect(directory.getByText(bikeShop.name, { exact: true }).first()).toBeVisible();
});

test('Street View person control shows official blue coverage roads and opens a clickable panorama', async ({ page }) => {
  await installGoogleEarthMock(page);
  await routePublicDirectory(page);
  await page.goto(`/?locator=${tracks[0].id}#track-locator`);
  await page.getByRole('button', {
    name: `Open global 3D track explorer starting at ${tracks[0].name}`,
  }).click();

  const earth = page.getByRole('dialog', { name: `Global 3D track explorer starting at ${tracks[0].name}` });
  await earth.getByRole('button', { name: 'Show Street View coverage and Pegman' }).click();
  await expect(earth.getByRole('region', { name: 'Street View coverage in the current map area' })).toBeVisible();
  await expect(earth.getByText(/Blue roads have Street View imagery/)).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const state = (window as any).__tracklabEarthState;
    return {
      coverageActive: Boolean(state.coverageMap),
      streetViewControl: state.coverageMap?.options?.streetViewControl,
    };
  })).toEqual({ coverageActive: true, streetViewControl: true });

  await page.evaluate(() => {
    (window as any).__tracklabEarthState.coverageMap?.emitClick({ lat: 38.299, lng: -122.284 });
  });
  const panorama = earth.getByRole('region', { name: 'Street View in the selected map area' });
  await expect(panorama).toBeVisible();
  await expect(panorama.getByText('Mock blue road')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__tracklabEarthState.panoramas.length)).toBe(1);
  await panorama.getByRole('button', { name: 'Back to blue roads' }).click();
  await expect(panorama).toHaveCount(0);
  await earth.getByRole('button', { name: 'Return to the 3D track map' }).click();
  await expect(earth.getByRole('button', { name: 'Show Street View coverage and Pegman' })).toBeVisible();
});

test('global 3D controls fit tablet and phone viewports and return focus to their separate launcher', async ({ page }) => {
  await installGoogleEarthMock(page);
  await routePublicDirectory(page);
  await page.goto(`/?locator=${tracks[0].id}#track-locator`);
  const search = page.getByLabel('Search tracks');
  const country = page.getByLabel('Country');
  const region = page.getByLabel('State / region');
  await search.fill('Napa');
  await country.selectOption({ label: 'United States' });
  await region.selectOption({ label: 'California' });
  const openButton = page.getByRole('button', {
    name: `Open global 3D track explorer starting at ${tracks[0].name}`,
  });

  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 844, height: 390 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await openButton.click();
    const earth = page.getByRole('dialog', { name: `Global 3D track explorer starting at ${tracks[0].name}` });
    await expect(earth).toBeVisible();
    const geometry = await earth.evaluate((element) => ({
      height: Math.round(element.getBoundingClientRect().height),
      overflow: element.scrollWidth - element.clientWidth,
      width: Math.round(element.getBoundingClientRect().width),
    }));
    expect(geometry).toEqual({ height: viewport.height, overflow: 0, width: viewport.width });
    const buttons = await earth.locator('header button').evaluateAll((items) => items.map((item) => ({
      height: Math.round(item.getBoundingClientRect().height),
      width: Math.round(item.getBoundingClientRect().width),
    })));
    expect(buttons.every(({ height, width }) => height >= 44 && width >= 44)).toBe(true);
    const mapAndGuide = await earth.evaluate((element) => {
      const map = element.querySelector('.public-track-earth-map')!.getBoundingClientRect();
      const guide = element.querySelector('.public-track-earth-guide')!.getBoundingClientRect();
      return { guideTop: Math.round(guide.top), mapBottom: Math.round(map.bottom) };
    });
    expect(mapAndGuide.guideTop).toBeGreaterThanOrEqual(mapAndGuide.mapBottom);

    await earth.getByRole('button', { name: 'Back to TrackLab track details' }).click();
    await expect(earth).toHaveCount(0);
    await expect(openButton).toBeFocused();
    await expect(search).toHaveValue('Napa');
    await expect(country).toHaveValue('United States');
    await expect(region).toHaveValue('California');
  }
});
