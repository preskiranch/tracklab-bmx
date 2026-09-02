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
        this.north = northEast?.lat ?? -Infinity;
        this.south = southWest?.lat ?? Infinity;
        this.east = northEast?.lng ?? -Infinity;
        this.west = southWest?.lng ?? Infinity;
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

    function storedViewportMatchingCamera(center: Point, zoom: number) {
      try {
        const serialized = window.sessionStorage.getItem('tracklab:public-bike-shop-directory:v1');
        const stored = serialized ? JSON.parse(serialized) as { mapViewport?: Viewport } : null;
        const viewport = stored?.mapViewport;
        if (!viewport || ![
          viewport.north,
          viewport.south,
          viewport.east,
          viewport.west,
          viewport.zoom,
        ].every(Number.isFinite)) return null;
        const longitudeSpan = viewport.east >= viewport.west
          ? viewport.east - viewport.west
          : viewport.east + 360 - viewport.west;
        const rawLongitude = viewport.west + longitudeSpan / 2;
        const expectedCenter = {
          lat: (viewport.north + viewport.south) / 2,
          lng: rawLongitude > 180 ? rawLongitude - 360 : rawLongitude,
        };
        const longitudeDifference = Math.abs(((center.lng - expectedCenter.lng + 540) % 360) - 180);
        return Math.abs(center.lat - expectedCenter.lat) < 1e-9
          && longitudeDifference < 1e-9
          && zoom === viewport.zoom
          ? viewport
          : null;
      } catch {
        return null;
      }
    }

    const state: {
      maps: MockMap[];
      markers: MockMarker[];
    } = { maps: [], markers: [] };

    class MockMap {
      bounds = new MockBounds({ lat: -70, lng: -170 }, { lat: 70, lng: 170 });
      center: Point;
      zoom: number;
      listeners = new Map<string, Set<Callback>>();

      constructor(_element: HTMLElement, options: Record<string, unknown>) {
        this.center = options.center as Point;
        this.zoom = Number(options.zoom ?? 2);
        const restoredViewport = storedViewportMatchingCamera(this.center, this.zoom);
        if (restoredViewport) {
          this.bounds = new MockBounds(
            { lat: restoredViewport.south, lng: restoredViewport.west },
            { lat: restoredViewport.north, lng: restoredViewport.east },
          );
          // LatLngBounds may cross the antimeridian even though its numeric
          // west edge is greater than its east edge.
          this.bounds.west = restoredViewport.west;
          this.bounds.east = restoredViewport.east;
        }
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
        viewport() {
          const map = state.maps.at(-1);
          if (!map) return null;
          return {
            north: map.bounds.north,
            south: map.bounds.south,
            east: map.bounds.east,
            west: map.bounds.west,
            zoom: map.zoom,
          };
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
  await page.route('**/api/bike-shops/hierarchy*', async (route) => {
    const url = new URL(route.request().url());
    const country = url.searchParams.get('countryCode') || '';
    const region = url.searchParams.get('region') || '';
    const response = !country
      ? { level: 'country', items: [{ value: 'AU', count: 3 }, { value: 'CA', count: 1 }, { value: 'US', count: 3 }] }
      : !region
        ? {
            level: 'region',
            items: country === 'US'
              ? [{ value: 'CA', count: 2 }, { value: 'OR', count: 1 }]
              : country === 'AU'
                ? [{ value: 'NSW', count: 2 }, { value: 'VIC', count: 1 }]
                : [{ value: 'BC', count: 1 }],
          }
        : {
            level: 'city',
            items: region === 'CA'
              ? [{ value: 'Oakland', count: 1 }, { value: 'Sacramento', count: 1 }]
              : region === 'OR'
                ? [{ value: 'Portland', count: 1 }]
                : region === 'NSW'
                  ? [{ value: 'Sydney', count: 2 }]
                  : region === 'VIC'
                    ? [{ value: 'Melbourne', count: 1 }]
                : [{ value: 'Vancouver', count: 1 }],
          };
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ...response,
        attributions: [{
          text: 'Overture Maps Foundation',
          url: 'https://docs.overturemaps.org/attribution/',
          license: 'CDLA-Permissive-2.0',
        }],
      }),
    });
  });
  await page.route('**/api/bike-shops/browse', async (route) => {
    const body = route.request().postDataJSON() as {
      countryCode: string;
      region?: string;
      locality?: string;
      offset?: number;
    };
    const areaName = body.locality || body.region || body.countryCode;
    const cityShop = shop(
      'overture:11111111-1111-4111-8111-111111111111',
      `${areaName} Cycle Center`,
      38.58,
      -121.49,
      {
        locality: body.locality || 'Directory',
        region: body.region || 'All regions',
        countryCode: body.countryCode,
      },
    );
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        location: body,
        shops: [cityShop],
        offset: body.offset || 0,
        limit: 1,
        total: 1,
        truncated: false,
        bounds: {
          north: cityShop.latitude,
          south: cityShop.latitude,
          east: cityShop.longitude,
          west: cityShop.longitude,
        },
        attributions: [{
          text: 'Overture Maps Foundation',
          url: 'https://docs.overturemaps.org/attribution/',
          license: 'CDLA-Permissive-2.0',
        }],
      }),
    });
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

test('restores a public directory browse after a full-page track trip without replacing its saved map view', async ({ page }) => {
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
          shop('osm:node:711', 'First Saved Shop', 38.575, -121.505),
          shop('osm:node:712', 'Second Saved Shop', 38.605, -121.455),
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
  await page.waitForFunction(() => Boolean((window as any).__tracklabBikeShopMapTest?.mapReady()));
  await page.evaluate((viewport) => {
    (window as any).__tracklabBikeShopMapTest.setViewport(viewport);
  }, sacramentoViewport);
  await expect(directory.getByText('2 mapped bike shops', { exact: true })).toBeVisible();
  const results = directory.getByRole('list', { name: 'Loaded bike shop listings' }).getByRole('button');
  await results.nth(1).click();
  await expect(results.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await directory.locator('.public-bike-shop-directory__radius select').selectOption('35');
  await directory.locator('input[type="search"]').fill('Sacramento saved search');
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, left: 0 }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  const nearbyTracks = directory.getByRole('region', { name: 'BMX tracks within 50 miles' });
  const nearbyTrackLink = nearbyTracks.getByRole('link').first();
  await expect(nearbyTrackLink).toHaveAttribute('href', /\?locator=.*#track-locator$/);
  // This is a full-page same-origin navigation, not a tab switch.
  await nearbyTrackLink.click();
  await expect(page).toHaveURL(/\?locator=.*#track-locator$/);
  await page.goBack();
  await expect(page).toHaveURL(/#bike-shop-directory$/);
  await expect(directory).toBeVisible();
  await expect(directory.locator('.public-bike-shop-directory__radius select')).toHaveValue('35');
  await expect(directory.locator('input[type="search"]')).toHaveValue('Sacramento saved search');
  await expect(results).toHaveCount(2);
  await expect(results.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => (window as any).__tracklabBikeShopMapTest.viewport()))
    .toEqual(sacramentoViewport);
  await page.waitForTimeout(800);
  expect(viewportRequests, 'a delayed restored camera idle never replaces the saved result').toEqual([sacramentoViewport]);
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

  await page.reload();
  await page.waitForFunction(() => Boolean((window as any).__tracklabBikeShopMapTest?.mapReady()));
  await expect(directory.getByText('2 mapped bike shops', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__tracklabBikeShopMapTest.viewport()))
    .toEqual(crossingViewport);
  await page.waitForTimeout(800);
  expect(viewportRequests, 'restoring a crossing camera neither expands it nor reloads the saved results')
    .toEqual([crossingViewport]);

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

test('global hierarchy browses country to state or province to city, then returns to synchronized map browsing', async ({ page }) => {
  await installGoogleMapMock(page);
  await mockPublicDirectoryShell(page);
  let viewportRequestCount = 0;
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
    viewportRequestCount += 1;
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

  const country = directory.getByRole('combobox', { name: 'Country', exact: true });
  const region = directory.getByRole('combobox', { name: 'State / province', exact: true });
  const city = directory.getByRole('combobox', { name: 'City', exact: true });
  const results = directory.getByRole('list', { name: 'Loaded bike shop listings' }).getByRole('button');
  await expect(country.getByRole('option', { name: 'United States (3)', exact: true })).toHaveAttribute('value', 'US');
  await expect(country.getByRole('option', { name: 'Canada (1)', exact: true })).toHaveAttribute('value', 'CA');
  await expect(region).toBeDisabled();
  await expect(city).toBeDisabled();

  await country.selectOption('US');
  await expect(region).toBeEnabled();
  await expect(city).toBeDisabled();
  await expect(region.getByRole('option', { name: 'CA (2)', exact: true })).toHaveAttribute('value', 'CA');
  await expect(region.getByRole('option', { name: 'OR (1)', exact: true })).toHaveAttribute('value', 'OR');
  await expect(results).toHaveCount(1);
  await expect(results.first()).toContainText('US Cycle Center');
  await expect.poll(() => page.evaluate(() => (
    (window as any).__tracklabBikeShopMapTest.activeMarkers().map((marker: any) => marker.title).sort()
  ))).toEqual(['US Cycle Center']);

  await region.selectOption('CA');
  await expect(city).toBeEnabled();
  await expect(city.getByRole('option', { name: 'Oakland (1)', exact: true })).toHaveAttribute('value', 'Oakland');
  await expect(city.getByRole('option', { name: 'Sacramento (1)', exact: true })).toHaveAttribute('value', 'Sacramento');

  await city.selectOption('Sacramento');
  await expect(directory.getByText('1 mapped bike shop', { exact: true })).toBeVisible();
  await expect(results).toHaveCount(1);
  await expect(results.first()).toContainText('Sacramento Cycle Center');
  await expect.poll(() => page.evaluate(() => (
    (window as any).__tracklabBikeShopMapTest.activeMarkers().map((marker: any) => marker.title)
  ))).toEqual(['Sacramento Cycle Center']);
  await page.waitForTimeout(800);
  expect(viewportRequestCount, 'programmatic city fit does not replace the hierarchy result').toBe(1);
  await expect(directory.getByText('1 mapped bike shop', { exact: true })).toBeVisible();
  await expect(results).toHaveCount(1);

  await directory.getByRole('button', { name: 'Return to map browsing' }).click();
  await expect(country).toHaveValue('__all__');
  await expect(region).toHaveValue('__all__');
  await expect(region).toBeDisabled();
  await expect(city).toHaveValue('__all__');
  await expect(city).toBeDisabled();
  await expect(results).toHaveCount(0);
  await page.evaluate((viewport) => {
    (window as any).__tracklabBikeShopMapTest.setViewport(viewport);
  }, sacramentoViewport);
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

test('country selection immediately lists Australian catalog shops before a city is chosen', async ({ page }) => {
  await installGoogleMapMock(page);
  await mockPublicDirectoryShell(page);
  const browseBodies: Array<Record<string, unknown>> = [];
  await page.route('**/api/bike-shops/browse', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    browseBodies.push(body);
    const areaName = body.locality || body.region || body.countryCode;
    const listing = shop(
      'overture:99999999-9999-4999-8999-999999999999',
      `${areaName} Bicycle Works`,
      -33.87,
      151.21,
      {
        locality: String(body.locality || 'Sydney'),
        region: String(body.region || 'NSW'),
        countryCode: String(body.countryCode || 'AU'),
      },
    );
    const listings = body.locality ? [
      listing,
      ...Array.from({ length: 17 }, (_, index) => shop(
        `osm:node:${9_100 + index}`,
        `${areaName} Bicycle Works ${index + 2}`,
        -33.869 + index * 0.001,
        151.211 + index * 0.001,
        {
          locality: String(body.locality),
          region: String(body.region || 'NSW'),
          countryCode: String(body.countryCode || 'AU'),
        },
      )),
    ] : [listing];
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        location: body,
        shops: listings,
        offset: body.offset || 0,
        limit: listings.length,
        total: listings.length,
        truncated: false,
        bounds: {
          north: Math.max(...listings.map((shopRecord) => shopRecord.latitude)),
          south: Math.min(...listings.map((shopRecord) => shopRecord.latitude)),
          east: Math.max(...listings.map((shopRecord) => shopRecord.longitude)),
          west: Math.min(...listings.map((shopRecord) => shopRecord.longitude)),
        },
        attributions: [],
      }),
    });
  });

  await page.goto('/#bike-shop-directory');
  const directory = page.locator('#bike-shop-directory');
  const country = directory.getByRole('combobox', { name: 'Country', exact: true });
  const region = directory.getByRole('combobox', { name: 'State / province', exact: true });
  const city = directory.getByRole('combobox', { name: 'City', exact: true });
  const resultList = directory.getByRole('list', { name: 'Loaded bike shop listings' });
  const results = resultList.getByRole('button');
  await expect(country.locator('option').nth(1)).toHaveText(/United States/);
  await country.selectOption('AU');
  await expect(directory.getByText('1 mapped bike shop', { exact: true })).toBeVisible();
  await expect(results).toHaveCount(1);
  await expect(results.first()).toContainText('AU Bicycle Works');
  await expect(region.getByRole('option', { name: 'NSW (2)', exact: true })).toHaveAttribute('value', 'NSW');
  await region.selectOption('NSW');
  await expect(city.getByRole('option', { name: 'Sydney (2)', exact: true })).toHaveAttribute('value', 'Sydney');
  await city.selectOption('Sydney');
  await expect(results.first()).toContainText('Sydney Bicycle Works');
  await expect(results).toHaveCount(18);
  const savedResultListScrollTop = 173;
  await expect.poll(() => resultList.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await resultList.evaluate((element, scrollTop) => {
    element.scrollTop = scrollTop;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  }, savedResultListScrollTop);
  await expect.poll(() => resultList.evaluate((element) => element.scrollTop)).toBe(savedResultListScrollTop);

  const navigation = page.getByRole('navigation', { name: 'TrackLab home navigation' });
  await navigation.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(directory).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    const serialized = window.sessionStorage.getItem('tracklab:public-bike-shop-directory:v1');
    return serialized ? JSON.parse(serialized).resultListScrollTop : null;
  })).toBe(savedResultListScrollTop);
  await navigation.getByRole('button', { name: 'Bike Shops', exact: true }).click();
  await expect(directory).toBeVisible();
  await expect(country).toHaveValue('AU');
  await expect(region).toHaveValue('NSW');
  await expect(city).toHaveValue('Sydney');
  await expect(results.first()).toContainText('Sydney Bicycle Works');
  await expect.poll(() => resultList.evaluate((element) => element.scrollTop)).toBe(savedResultListScrollTop);
  expect(browseBodies).toEqual([
    { countryCode: 'AU' },
    { countryCode: 'AU', region: 'NSW' },
    { countryCode: 'AU', region: 'NSW', locality: 'Sydney' },
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
