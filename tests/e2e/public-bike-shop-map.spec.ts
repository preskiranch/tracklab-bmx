import { expect, test, type Page } from '@playwright/test';

type Viewport = {
  north: number;
  south: number;
  east: number;
  west: number;
  zoom: number;
};

const sacramentoViewport: Viewport = {
  north: 38.64,
  south: 38.54,
  east: -121.43,
  west: -121.54,
  zoom: 14,
};

function shop(
  id: string,
  name: string,
  latitude: number,
  longitude: number,
  address: Partial<{
    line1: string;
    locality: string;
    region: string;
    postalCode: string;
    countryCode: string;
  }> = {},
) {
  const line1 = address.line1 ?? `${id.replace(/\D/g, '') || '1'} Test Street`;
  const locality = address.locality ?? 'Sacramento';
  const region = address.region ?? 'CA';
  const postalCode = address.postalCode ?? '95814';
  const countryCode = address.countryCode ?? 'US';
  return {
    id,
    name,
    latitude,
    longitude,
    distanceMiles: 0,
    address: {
      line1,
      locality,
      region,
      postalCode,
      countryCode,
      formatted: [line1, locality, region, postalCode].filter(Boolean).join(', '),
    },
    phone: '',
    website: '',
    openingHours: '',
    services: { sales: true, repair: false, rental: false, ebike: false },
    source: {
      provider: 'OpenStreetMap',
      elementType: 'node',
      elementId: id.replace(/\D/g, '') || '1',
      url: `https://www.openstreetmap.org/node/${id.replace(/\D/g, '') || '1'}`,
    },
    links: {},
  };
}

async function installGoogleMapMock(page: Page) {
  await page.addInitScript(() => {
    type Point = { lat: number; lng: number };
    type Listener = { remove: () => void };
    type Callback = () => void;

    class MockResizeObserver {
      observe() {}
      disconnect() {}
    }

    class MockBounds {
      north: number;
      south: number;
      east: number;
      west: number;

      constructor(southWest?: Point, northEast?: Point) {
        this.north = northEast?.lat ?? 70;
        this.south = southWest?.lat ?? -70;
        this.east = northEast?.lng ?? 170;
        this.west = southWest?.lng ?? -170;
      }

      extend(point: Point) {
        this.north = Math.max(this.north, point.lat);
        this.south = Math.min(this.south, point.lat);
        this.east = Math.max(this.east, point.lng);
        this.west = Math.min(this.west, point.lng);
        return this;
      }

      getNorthEast() {
        return { toJSON: () => ({ lat: this.north, lng: this.east }) };
      }

      getSouthWest() {
        return { toJSON: () => ({ lat: this.south, lng: this.west }) };
      }
    }

    const state: {
      maps: MockMap[];
      markers: MockMarker[];
    } = { maps: [], markers: [] };

    class MockMap {
      bounds = new MockBounds();
      center: Point;
      zoom: number;
      listeners = new Map<string, Set<Callback>>();

      constructor(_element: HTMLElement, options: Record<string, unknown>) {
        this.center = options.center as Point;
        this.zoom = Number(options.zoom ?? 2);
        state.maps.push(this);
        window.setTimeout(() => this.emit('idle'), 0);
      }

      addListener(name: string, callback: Callback): Listener {
        const callbacks = this.listeners.get(name) ?? new Set<Callback>();
        callbacks.add(callback);
        this.listeners.set(name, callbacks);
        return { remove: () => callbacks.delete(callback) };
      }

      emit(name: string) {
        this.listeners.get(name)?.forEach((callback) => callback());
      }

      getBounds() { return this.bounds; }
      getCenter() { return { toJSON: () => ({ ...this.center }) }; }
      getZoom() { return this.zoom; }
      setCenter(point: Point) { this.center = { ...point }; }
      setZoom(zoom: number) { this.zoom = zoom; }
      setHeading() {}
      setTilt() {}
      setOptions() {}
      fitBounds(bounds: MockBounds) {
        this.bounds = bounds;
        const northEast = bounds.getNorthEast().toJSON();
        const southWest = bounds.getSouthWest().toJSON();
        this.center = {
          lat: (northEast.lat + southWest.lat) / 2,
          lng: (northEast.lng + southWest.lng) / 2,
        };
        this.zoom = 14;
        window.setTimeout(() => this.emit('idle'), 0);
      }
    }

    class MockMarker {
      map: MockMap | null;
      options: Record<string, any>;
      listeners = new Map<string, Set<Callback>>();

      constructor(options: Record<string, any>) {
        this.options = { ...options };
        this.map = options.map ?? null;
        state.markers.push(this);
      }

      addListener(name: string, callback: Callback): Listener {
        const callbacks = this.listeners.get(name) ?? new Set<Callback>();
        callbacks.add(callback);
        this.listeners.set(name, callbacks);
        return { remove: () => callbacks.delete(callback) };
      }

      emit(name: string) { this.listeners.get(name)?.forEach((callback) => callback()); }
      setIcon(icon: Record<string, unknown>) { this.options.icon = icon; }
      setLabel(label: unknown) { this.options.label = label; }
      setMap(map: MockMap | null) { this.map = map; }
      setPosition(position: Point) { this.options.position = position; }
      setTitle(title: string) { this.options.title = title; }
    }

    Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: MockResizeObserver });
    Object.defineProperty(window, 'google', {
      configurable: true,
      value: {
        maps: {
          importLibrary: async (name: string) => {
            if (name === 'maps') return { Map: MockMap };
            if (name === 'marker') return { Marker: MockMarker };
            return {};
          },
          LatLngBounds: MockBounds,
          SymbolPath: { CIRCLE: 'circle' },
          event: { trigger: (target: { emit?: (name: string) => void }, name: string) => target.emit?.(name) },
        },
      },
    });

    Object.defineProperty(window, '__tracklabBikeShopMapTest', {
      configurable: true,
      value: {
        mapReady() {
          return state.maps.length > 0;
        },
        setViewport(viewport: Viewport, idleBursts = 1) {
          const map = state.maps.at(-1);
          if (!map) throw new Error('Bike shop map has not been created.');
          map.bounds = new MockBounds(
            { lat: viewport.south, lng: viewport.west },
            { lat: viewport.north, lng: viewport.east },
          );
          // Preserve crossing bounds exactly instead of normalizing them in the mock.
          map.bounds.west = viewport.west;
          map.bounds.east = viewport.east;
          map.zoom = viewport.zoom;
          for (let index = 0; index < idleBursts; index += 1) map.emit('idle');
        },
        activeMarkers() {
          return state.markers.filter((marker) => marker.map !== null).map((marker) => ({
            title: String(marker.options.title ?? ''),
            fillColor: String(marker.options.icon?.fillColor ?? ''),
          }));
        },
        clickMarker(title: string) {
          const marker = [...state.markers].reverse().find((candidate) => (
            candidate.map !== null && candidate.options.title === title
          ));
          if (!marker) throw new Error(`Marker not found: ${title}`);
          marker.emit('click');
        },
      },
    });
  });
}

async function installGoogleMapFailure(page: Page) {
  await page.addInitScript(() => {
    class MockResizeObserver {
      observe() {}
      disconnect() {}
    }

    Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: MockResizeObserver });
    Object.defineProperty(window, 'google', {
      configurable: true,
      value: {
        maps: {
          importLibrary: async () => {
            throw new Error('Test Google Maps unavailable');
          },
        },
      },
    });
  });
}

async function mockPublicDirectoryShell(page: Page) {
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user: null }) });
  });
  await page.route('**/data/track-database.json', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ tracks: [] }) });
  });
  await page.route('**/data/track-locator.json', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ tracks: [] }) });
  });
}

test('global shop map loads by viewport, debounces map idle, and synchronizes markers with the list', async ({ page }) => {
  await installGoogleMapMock(page);
  const viewportRequests: Viewport[] = [];

  await mockPublicDirectoryShell(page);
  await page.route('**/api/bike-shops/viewport', async (route) => {
    const request = route.request();
    expect(request.method()).toBe('POST');
    expect(new URL(request.url()).search).toBe('');
    const body = request.postDataJSON() as Viewport;
    viewportRequests.push(body);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        bounds: body,
        shops: [
          shop('osm:node:101', 'Downtown Bicycle Works', 38.575, -121.505),
          shop('osm:node:202', 'Eastside Cycle Shop', 38.605, -121.455),
        ],
        truncated: false,
        attribution: {
          text: '© OpenStreetMap contributors',
          url: 'https://www.openstreetmap.org/copyright',
          license: 'ODbL',
        },
      }),
    });
  });

  await page.goto('/#bike-shop-directory');
  const directory = page.locator('#bike-shop-directory');
  await expect(directory.getByRole('heading', { name: 'Find a bike shop near you' })).toBeVisible();
  await expect(directory.getByText(/Zoom in \d+ more levels to load bike shops/)).toBeVisible();
  await page.waitForFunction(() => Boolean((window as any).__tracklabBikeShopMapTest?.mapReady()));
  await page.waitForTimeout(600);
  expect(viewportRequests, 'the world view does not query detailed shop data').toEqual([]);

  await page.evaluate((viewport) => {
    (window as any).__tracklabBikeShopMapTest.setViewport(viewport, 4);
  }, sacramentoViewport);
  await expect(directory.getByText('2 mapped bike shops', { exact: true })).toBeVisible();
  expect(viewportRequests, 'one debounced request is made for an idle-event burst').toHaveLength(1);
  expect(viewportRequests[0]).toEqual(sacramentoViewport);

  const results = directory.getByRole('list', { name: 'Loaded bike shop listings' }).getByRole('button');
  await expect(results).toHaveCount(2);
  await expect(results.nth(0)).toContainText('Downtown Bicycle Works');
  await expect(results.nth(0)).toHaveAttribute('aria-pressed', 'true');

  await expect.poll(() => page.evaluate(() => (
    (window as any).__tracklabBikeShopMapTest.activeMarkers().map((marker: any) => marker.title).sort()
  ))).toEqual(['Downtown Bicycle Works', 'Eastside Cycle Shop']);

  await page.evaluate(() => {
    (window as any).__tracklabBikeShopMapTest.clickMarker('Eastside Cycle Shop');
  });
  await expect(results.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => (
    (window as any).__tracklabBikeShopMapTest.activeMarkers()
      .find((marker: any) => marker.title === 'Eastside Cycle Shop')?.fillColor
  ))).toBe('#7dff35');
});

test('global shop map preserves an antimeridian viewport, reports truncation, and stays contained on phones', async ({ page }) => {
  await installGoogleMapMock(page);
  const viewportRequests: Viewport[] = [];

  await mockPublicDirectoryShell(page);
  await page.route('**/api/bike-shops/viewport', async (route) => {
    const body = route.request().postDataJSON() as Viewport;
    viewportRequests.push(body);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        bounds: body,
        shops: [
          shop('osm:node:301', 'West Meridian Bikes', 0.02, 179.94),
          shop('osm:node:302', 'East Meridian Bikes', -0.02, -179.94),
        ],
        truncated: true,
        attribution: {
          text: '© OpenStreetMap contributors',
          url: 'https://www.openstreetmap.org/copyright',
          license: 'ODbL',
        },
      }),
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#bike-shop-directory');
  const directory = page.locator('#bike-shop-directory');
  await page.waitForFunction(() => Boolean((window as any).__tracklabBikeShopMapTest?.mapReady()));
  const crossingViewport: Viewport = {
    north: 0.1,
    south: -0.1,
    west: 179.8,
    east: -179.8,
    zoom: 14,
  };
  await page.evaluate((viewport) => {
    (window as any).__tracklabBikeShopMapTest.setViewport(viewport);
  }, crossingViewport);

  await expect(directory.getByText('2 mapped bike shops', { exact: true })).toBeVisible();
  await expect(directory.getByText('This area contains more shops than can be shown at once.')).toBeVisible();
  expect(viewportRequests).toEqual([crossingViewport]);
  const resultList = directory.getByRole('list', { name: 'Loaded bike shop listings' });
  await expect(resultList.getByText('West Meridian Bikes', { exact: true })).toBeVisible();
  await expect(resultList.getByText('East Meridian Bikes', { exact: true })).toBeVisible();

  const overflowing = await directory.evaluate((element) => {
    const selectors = [
      '.public-bike-shop-directory__inner',
      '.public-bike-shop-directory__search',
      '.public-bike-shop-directory__layout',
      '.public-bike-shop-directory__map-panel',
      '.public-bike-shop-map',
      '.public-bike-shop-directory__results',
      '.public-bike-shop-directory__detail',
    ];
    return [document.documentElement, element, ...selectors.map((selector) => element.querySelector(selector))]
      .filter((node): node is Element => Boolean(node))
      .filter((node) => node.scrollWidth > node.clientWidth + 1)
      .map((node) => ({ className: node.className, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth }));
  });
  expect(overflowing).toEqual([]);
});

test('loaded shops can be narrowed country to state or province to city, then reset with markers kept in sync', async ({ page }) => {
  await installGoogleMapMock(page);
  await mockPublicDirectoryShell(page);
  const loadedShops = [
    shop('osm:node:401', 'Sacramento Cycle Center', 38.58, -121.49),
    shop('osm:node:402', 'Oakland Bicycle Works', 37.80, -122.27, {
      locality: 'Oakland',
      region: 'CA',
      postalCode: '94607',
    }),
    shop('osm:node:403', 'Portland Pedal House', 45.52, -122.67, {
      locality: 'Portland',
      region: 'OR',
      postalCode: '97205',
    }),
    shop('osm:node:404', 'Vancouver Bike Studio', 49.28, -123.12, {
      locality: 'Vancouver',
      region: 'BC',
      postalCode: 'V6B 1A1',
      countryCode: 'CA',
    }),
  ];

  await page.route('**/api/bike-shops/viewport', async (route) => {
    const body = route.request().postDataJSON() as Viewport;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        bounds: body,
        shops: loadedShops,
        truncated: false,
        attribution: {
          text: '© OpenStreetMap contributors',
          url: 'https://www.openstreetmap.org/copyright',
          license: 'ODbL',
        },
      }),
    });
  });

  await page.goto('/#bike-shop-directory');
  const directory = page.locator('#bike-shop-directory');
  await page.waitForFunction(() => Boolean((window as any).__tracklabBikeShopMapTest?.mapReady()));
  await page.evaluate((viewport) => {
    (window as any).__tracklabBikeShopMapTest.setViewport(viewport);
  }, sacramentoViewport);
  await expect(directory.getByText('4 mapped bike shops', { exact: true })).toBeVisible();

  const country = directory.getByLabel('Country');
  const region = directory.getByLabel('State / province');
  const city = directory.getByLabel('City');
  const results = directory.getByRole('list', { name: 'Loaded bike shop listings' }).getByRole('button');
  await expect(country.getByRole('option', { name: 'United States', exact: true })).toHaveAttribute('value', 'US');
  await expect(country.getByRole('option', { name: 'Canada', exact: true })).toHaveAttribute('value', 'CA');
  await expect(region).toBeDisabled();
  await expect(city).toBeDisabled();

  await country.selectOption('US');
  await expect(directory.getByText('3 of 4 mapped bike shops', { exact: true })).toBeVisible();
  await expect(region).toBeEnabled();
  await expect(city).toBeDisabled();
  await expect(results).toHaveCount(3);
  await expect.poll(() => page.evaluate(() => (
    (window as any).__tracklabBikeShopMapTest.activeMarkers().map((marker: any) => marker.title).sort()
  ))).toEqual(['Oakland Bicycle Works', 'Portland Pedal House', 'Sacramento Cycle Center']);

  await region.selectOption('CA');
  await expect(directory.getByText('2 of 4 mapped bike shops', { exact: true })).toBeVisible();
  await expect(city).toBeEnabled();
  await expect(city.getByRole('option', { name: 'Oakland', exact: true })).toHaveAttribute('value', 'Oakland');
  await expect(city.getByRole('option', { name: 'Sacramento', exact: true })).toHaveAttribute('value', 'Sacramento');
  await expect(results).toHaveCount(2);

  await city.selectOption('Sacramento');
  await expect(directory.getByText('1 of 4 mapped bike shop', { exact: true })).toBeVisible();
  await expect(results).toHaveCount(1);
  await expect(results.first()).toContainText('Sacramento Cycle Center');
  await expect.poll(() => page.evaluate(() => (
    (window as any).__tracklabBikeShopMapTest.activeMarkers().map((marker: any) => marker.title)
  ))).toEqual(['Sacramento Cycle Center']);

  await directory.getByRole('button', { name: 'Full visible area' }).click();
  await expect(country).toHaveValue('__all__');
  await expect(region).toHaveValue('__all__');
  await expect(region).toBeDisabled();
  await expect(city).toHaveValue('__all__');
  await expect(city).toBeDisabled();
  await expect(directory.getByText('4 mapped bike shops', { exact: true })).toBeVisible();
  await expect(results).toHaveCount(4);
  await expect.poll(() => page.evaluate(() => (
    (window as any).__tracklabBikeShopMapTest.activeMarkers().map((marker: any) => marker.title).sort()
  ))).toEqual([
    'Oakland Bicycle Works',
    'Portland Pedal House',
    'Sacramento Cycle Center',
    'Vancouver Bike Studio',
  ]);
});

test('current-location nearby search still returns an accessible shop list when Google Maps fails to load', async ({ page, context }) => {
  await installGoogleMapFailure(page);
  await mockPublicDirectoryShell(page);
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 38.5816, longitude: -121.4944 });
  const nearbyRequests: Array<Record<string, unknown>> = [];
  const fallbackShop = shop('osm:node:501', 'Fallback Bicycle Service', 38.585, -121.489);

  await page.route('**/api/bike-shops/nearby*', async (route) => {
    expect(route.request().method()).toBe('POST');
    expect(new URL(route.request().url()).search).toBe('');
    const body = route.request().postDataJSON() as Record<string, unknown>;
    nearbyRequests.push(body);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        origin: {
          latitude: body.latitude,
          longitude: body.longitude,
          radiusMiles: body.radiusMiles,
        },
        shops: [fallbackShop],
        attribution: {
          text: '© OpenStreetMap contributors',
          url: 'https://www.openstreetmap.org/copyright',
          license: 'ODbL',
        },
      }),
    });
  });

  await page.goto('/#bike-shop-directory');
  const directory = page.locator('#bike-shop-directory');
  await expect(directory.getByText('Test Google Maps unavailable', { exact: true })).toBeVisible();
  await directory.getByRole('button', { name: 'Use current location' }).click();

  await expect(directory.getByText('1 mapped bike shop', { exact: true })).toBeVisible();
  await expect(directory.getByText('Near Current location · within 25 miles', { exact: true })).toBeVisible();
  const results = directory.getByRole('list', { name: 'Loaded bike shop listings' }).getByRole('button');
  await expect(results).toHaveCount(1);
  await expect(results.first()).toContainText('Fallback Bicycle Service');
  await expect(directory.getByRole('heading', { name: 'Fallback Bicycle Service', exact: true })).toBeVisible();
  expect(nearbyRequests).toHaveLength(1);
  expect(Number(nearbyRequests[0].latitude)).toBeCloseTo(38.5816, 4);
  expect(Number(nearbyRequests[0].longitude)).toBeCloseTo(-121.4944, 4);
  expect(nearbyRequests[0].radiusMiles).toBe(25);
});

test('zooming back out aborts an in-flight viewport result so stale shops cannot replace the world view', async ({ page }) => {
  await installGoogleMapMock(page);
  await mockPublicDirectoryShell(page);
  let viewportRequestCount = 0;
  let markRequestStarted: () => void = () => {};
  const requestStarted = new Promise<void>((resolve) => { markRequestStarted = resolve; });
  let releaseResponse: () => void = () => {};
  const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });

  await page.route('**/api/bike-shops/viewport', async (route) => {
    viewportRequestCount += 1;
    const body = route.request().postDataJSON() as Viewport;
    markRequestStarted();
    await responseGate;
    try {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          bounds: body,
          shops: [shop('osm:node:601', 'Stale Response Cycles', 38.58, -121.49)],
          truncated: false,
          attribution: {
            text: '© OpenStreetMap contributors',
            url: 'https://www.openstreetmap.org/copyright',
            license: 'ODbL',
          },
        }),
      });
    } catch {
      // Chromium may retire an intercepted request immediately after AbortController.abort().
      // Either network outcome is valid; the UI assertion below proves the stale data is ignored.
    }
  });

  await page.goto('/#bike-shop-directory');
  const directory = page.locator('#bike-shop-directory');
  await page.waitForFunction(() => Boolean((window as any).__tracklabBikeShopMapTest?.mapReady()));
  await page.evaluate((viewport) => {
    (window as any).__tracklabBikeShopMapTest.setViewport(viewport);
  }, sacramentoViewport);
  await requestStarted;

  await page.evaluate(() => {
    (window as any).__tracklabBikeShopMapTest.setViewport({
      north: 70,
      south: -70,
      east: 170,
      west: -170,
      zoom: 2,
    });
  });
  await expect(directory.getByText(/Zoom in \d+ more levels to load bike shops/)).toBeVisible();
  await expect(directory.getByText('Explore the map', { exact: true })).toBeVisible();
  releaseResponse();

  await page.waitForTimeout(250);
  expect(viewportRequestCount).toBe(1);
  await expect(directory.getByText('Stale Response Cycles', { exact: true })).toHaveCount(0);
  await expect(directory.getByRole('list', { name: 'Loaded bike shop listings' }).getByRole('button')).toHaveCount(0);
});
