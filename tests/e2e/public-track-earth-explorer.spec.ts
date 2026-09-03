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

async function installGoogleEarthMock(page: Page) {
  await page.addInitScript(() => {
    type Point = { lat: number; lng: number; altitude?: number };
    type Callback = () => void;

    class MockBounds {
      extend() { return this; }
    }

    class MockMap {
      listeners = new Map<string, Set<Callback>>();

      constructor(_element: HTMLElement, _options: Record<string, unknown>) {
        window.setTimeout(() => this.emit('tilesloaded'), 0);
      }

      addListener(name: string, callback: Callback) {
        const listeners = this.listeners.get(name) ?? new Set<Callback>();
        listeners.add(callback);
        this.listeners.set(name, listeners);
        return { remove: () => listeners.delete(callback) };
      }

      emit(name: string) { this.listeners.get(name)?.forEach((callback) => callback()); }
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

    if (!customElements.get('tracklab-public-map-3d')) {
      customElements.define('tracklab-public-map-3d', MockMap3DElement);
      customElements.define('tracklab-public-polyline-3d', MockPolyline3DElement);
      customElements.define('tracklab-public-marker-3d', MockMarker3DElement);
    }

    const maps3d = {
      Map3DElement: customElements.get('tracklab-public-map-3d'),
      Marker3DElement: customElements.get('tracklab-public-marker-3d'),
      Marker3DInteractiveElement: customElements.get('tracklab-public-marker-3d'),
      Polyline3DElement: customElements.get('tracklab-public-polyline-3d'),
    };
    const state = { maps: [] as MockMap3DElement[], markers: [] as MockMarker3DElement[] };
    Object.defineProperty(window, '__tracklabEarthState', { configurable: true, value: state });
    Object.defineProperty(window, 'google', {
      configurable: true,
      value: {
        maps: {
          event: { trigger() {} },
          importLibrary: async (name: string) => name === 'maps3d' ? maps3d : {},
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
}

test('Google Earth starts at one track, reveals tracks with camera range, and returns through TrackLab', async ({ page }) => {
  await installGoogleEarthMock(page);
  await routePublicDirectory(page);
  await page.goto(`/?locator=${tracks[0].id}#track-locator`);

  const locator = page.locator('#track-locator');
  await expect(locator.getByRole('heading', { name: tracks[0].name })).toBeVisible();
  await expect(locator.getByRole('button', { name: 'Explore all tracks' })).toHaveCount(0);

  const earthGroup = locator.getByRole('group', { name: `Google Earth view for ${tracks[0].name}` });
  await expect(earthGroup.getByText('Explore this track', { exact: true })).toBeVisible();
  await earthGroup.getByRole('button', { name: `Open Google Earth view at ${tracks[0].name}` }).click();

  const earth = page.getByRole('dialog', { name: `Google Earth track view starting at ${tracks[0].name}` });
  await expect(earth).toBeVisible();
  await expect(earth.getByText('1 track pin loaded')).toBeVisible();
  await expect(earth.getByText('Zoom out to reveal more BMX tracks. Select any named pin to open that track in TrackLab.')).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    type Point = { lat: number; lng: number; altitude?: number };
    const state = (window as typeof window & {
      __tracklabEarthState?: {
        maps: Array<{ center: Point; description: string; range: number; tilt: number }>;
        markers: Array<{
          altitudeMode: string;
          collisionBehavior: string;
          extruded: boolean;
          isConnected: boolean;
          label: string;
          position: Point;
          sizePreserved: boolean;
        }>;
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
      map: state?.maps[0] ? {
        center: state.maps[0].center,
        description: state.maps[0].description,
        range: state.maps[0].range,
        tilt: state.maps[0].tilt,
      } : null,
    };
  })).toEqual({
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
      description: `Interactive 3D satellite view centered on ${tracks[0].name}. Zoom out to reveal more named BMX tracks.`,
      range: 1_400,
      tilt: 62,
    },
  });

  await page.evaluate(() => {
    const map = (window as typeof window & {
      __tracklabEarthState?: { maps: Array<{ range: number; dispatchEvent: (event: Event) => boolean }> };
    }).__tracklabEarthState?.maps[0];
    if (!map) throw new Error('Earth map did not mount');
    map.range = 4_200_000;
    map.dispatchEvent(new Event('gmp-rangechange'));
  });
  await expect(earth.getByText('3 track pins loaded')).toBeVisible();

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
  await expect(locator.getByRole('button', { name: `Open Google Earth view at ${tracks[1].name}` })).toBeFocused();
});
test('Earth controls fit tablet and phone viewports and return focus to the selected track action', async ({ page }) => {
  await installGoogleEarthMock(page);
  await routePublicDirectory(page);
  await page.goto(`/?locator=${tracks[0].id}#track-locator`);
  const openButton = page.getByRole('button', { name: `Open Google Earth view at ${tracks[0].name}` });

  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 844, height: 390 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await openButton.click();
    const earth = page.getByRole('dialog', { name: `Google Earth track view starting at ${tracks[0].name}` });
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
  }
});
