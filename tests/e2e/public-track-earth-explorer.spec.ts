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

async function installGoogleTrackMapMock(page: Page) {
  await page.addInitScript(() => {
    type Point = { lat: number; lng: number };
    type Callback = () => void;

    class MockBounds {
      points: Point[] = [];
      extend(point: Point) { this.points.push({ ...point }); return this; }
    }

    const state: {
      fitBoundsPointCounts: number[];
      markers: MockMarker[];
      operationCounts: { setIcon: number; setMap: number; setPosition: number; setTitle: number };
    } = {
      fitBoundsPointCounts: [],
      markers: [],
      operationCounts: { setIcon: 0, setMap: 0, setPosition: 0, setTitle: 0 },
    };

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
      fitBounds(bounds: MockBounds) { state.fitBoundsPointCounts.push(bounds.points.length); }
      setHeading() {}
      setTilt() {}
      setOptions() {}
    }

    class MockMarker {
      icon: Record<string, unknown> = {};
      listeners = new Map<string, Set<Callback>>();
      map: MockMap | null;
      position: Point;
      title = '';

      constructor(options: { map?: MockMap; position: Point }) {
        this.map = options.map ?? null;
        this.position = options.position;
        state.markers.push(this);
      }

      addListener(name: string, callback: Callback) {
        const listeners = this.listeners.get(name) ?? new Set<Callback>();
        listeners.add(callback);
        this.listeners.set(name, listeners);
        return { remove: () => listeners.delete(callback) };
      }

      emit(name: string) { this.listeners.get(name)?.forEach((callback) => callback()); }
      setIcon(icon: Record<string, unknown>) { state.operationCounts.setIcon += 1; this.icon = icon; }
      setMap(map: MockMap | null) { state.operationCounts.setMap += 1; this.map = map; }
      setPosition(position: Point) { state.operationCounts.setPosition += 1; this.position = position; }
      setTitle(title: string) { state.operationCounts.setTitle += 1; this.title = title; }
    }

    Object.defineProperty(window, 'google', {
      configurable: true,
      value: {
        maps: {
          event: { trigger() {} },
          importLibrary: async (name: string) => {
            if (name === 'maps') return { Map: MockMap };
            if (name === 'marker') return { Marker: MockMarker };
            return {};
          },
          LatLngBounds: MockBounds,
          Map: MockMap,
          Marker: MockMarker,
          SymbolPath: { CIRCLE: 'circle' },
        },
      },
    });
    Object.defineProperty(window, '__tracklabPublicTrackMapState', {
      configurable: true,
      value: state,
    });
  });
}

test('Earth view shows the full catalog and opens marker-selected TrackLab details', async ({ page }) => {
  await installGoogleTrackMapMock(page);
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user: null }) });
  });
  await page.route('**/data/track-locator.json', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ generatedAt: '2026-09-02T00:00:00.000Z', tracks }),
    });
  });

  await page.goto(`/?locator=${tracks[0].id}#track-locator`);
  const locator = page.locator('#track-locator');
  await expect(locator.getByRole('heading', { name: tracks[0].name })).toBeVisible();
  const earthGroup = locator.getByRole('group', { name: 'Global satellite explorer—not directions' });
  const exploreButton = earthGroup.getByRole('button', { name: 'Explore all tracks' });
  await exploreButton.click();

  await expect(locator.getByRole('status')).toContainText('3 TrackLab track markers on the satellite map');
  await expect(earthGroup.getByRole('button', { name: 'Show selected track only' })).toHaveAttribute('aria-pressed', 'true');
  await expect(earthGroup.getByRole('link', { name: /Google Earth—not turn-by-turn directions/ })).toHaveAttribute(
    'href',
    /earth\.google\.com/,
  );
  await expect.poll(() => page.evaluate(() => {
    const state = (window as typeof window & {
      __tracklabPublicTrackMapState?: {
        fitBoundsPointCounts: number[];
        markers: Array<{ map: unknown; title: string }>;
      };
    }).__tracklabPublicTrackMapState;
    return {
      activeMarkers: state?.markers.filter((marker) => marker.map !== null).length ?? 0,
      largestBounds: Math.max(...(state?.fitBoundsPointCounts ?? [0])),
      titles: state?.markers.filter((marker) => marker.map !== null).map((marker) => marker.title).sort() ?? [],
    };
  })).toEqual({
    activeMarkers: 3,
    largestBounds: 3,
    titles: [
      'London Track BMX — London, England, United Kingdom. Open TrackLab track details',
      'Melbourne Track BMX — Melbourne, Victoria, Australia. Open TrackLab track details',
      'Napa Track BMX — Napa, California, United States. Open TrackLab track details',
    ],
  });

  await page.evaluate((trackName) => {
    const state = (window as typeof window & {
      __tracklabPublicTrackMapState?: {
        markers: Array<{ emit: (name: string) => void; map: unknown; title: string }>;
      };
    }).__tracklabPublicTrackMapState;
    state?.markers.find((marker) => marker.map !== null && marker.title.startsWith(trackName))?.emit('click');
  }, tracks[1].name);

  await expect(locator.getByRole('heading', { name: tracks[1].name })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`locator=${tracks[1].id}`));
  await expect(locator.locator('.public-track-details p')).toContainText('Melbourne, Victoria, Australia');
  await expect(locator.getByRole('status')).toContainText('3 TrackLab track markers on the satellite map');
  await expect.poll(() => page.evaluate((selectedTitle) => {
    const state = (window as typeof window & {
      __tracklabPublicTrackMapState?: {
        markers: Array<{
          icon: { fillColor?: string; scale?: number };
          map: unknown;
          title: string;
        }>;
      };
    }).__tracklabPublicTrackMapState;
    const marker = state?.markers.find((candidate) => candidate.map !== null && candidate.title === selectedTitle);
    return marker?.icon;
  }, 'Melbourne Track BMX — Melbourne, Victoria, Australia. Open TrackLab track details')).toMatchObject({
    fillColor: '#65d636',
    scale: 9,
  });
});

test('selecting among 1,305 global markers updates only the old and new selection', async ({ page }) => {
  await installGoogleTrackMapMock(page);
  const largeCatalog = Array.from({ length: 1_305 }, (_, index) => ({
    ...tracks[index % tracks.length],
    id: `global-track-${index}`,
    name: `Global Track ${index}`,
    latitude: -60 + (index % 120),
    longitude: -170 + (index * 37 % 340),
  }));
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user: null }) });
  });
  await page.route('**/data/track-locator.json', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ generatedAt: '2026-09-02T00:00:00.000Z', tracks: largeCatalog }),
    });
  });

  await page.goto(`/?locator=${largeCatalog[0].id}#track-locator`);
  const locator = page.locator('#track-locator');
  await locator.getByRole('button', { name: 'Explore all tracks' }).click();
  await expect(locator.getByRole('status')).toContainText('1,305 TrackLab track markers');
  await expect.poll(() => page.evaluate(() => {
    const state = (window as typeof window & {
      __tracklabPublicTrackMapState?: { markers: Array<{ map: unknown }> };
    }).__tracklabPublicTrackMapState;
    return state?.markers.filter((marker) => marker.map !== null).length ?? 0;
  })).toBe(1_305);

  await page.evaluate((trackName) => {
    const state = (window as typeof window & {
      __tracklabPublicTrackMapState?: {
        markers: Array<{ emit: (name: string) => void; map: unknown; title: string }>;
        operationCounts: { setIcon: number; setMap: number; setPosition: number; setTitle: number };
      };
    }).__tracklabPublicTrackMapState;
    if (!state) return;
    state.operationCounts = { setIcon: 0, setMap: 0, setPosition: 0, setTitle: 0 };
    state.markers.find((marker) => marker.map !== null && marker.title.startsWith(trackName))?.emit('click');
  }, largeCatalog[777].name);

  await expect(page).toHaveURL(new RegExp(`locator=${largeCatalog[777].id}`));
  await expect(locator.getByRole('heading', { name: largeCatalog[777].name })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const state = (window as typeof window & {
      __tracklabPublicTrackMapState?: {
        operationCounts: { setIcon: number; setMap: number; setPosition: number; setTitle: number };
      };
    }).__tracklabPublicTrackMapState;
    return state?.operationCounts;
  })).toEqual({ setIcon: 2, setMap: 0, setPosition: 0, setTitle: 0 });
});
