import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  normalizePublicBikeShopDirectoryState,
  publicBikeShopDirectoryStateStorageKey,
  readPublicBikeShopDirectoryState,
  writePublicBikeShopDirectoryState,
  type PublicBikeShopDirectoryState,
} from '../../src/lib/publicBikeShopDirectoryState';

function storedState(): PublicBikeShopDirectoryState {
  return {
    version: 1,
    locationInput: 'Sydney, NSW',
    shopSearchMode: 'location',
    radiusMiles: 35,
    shops: [{
      id: 'overture:sydney-cycles',
      name: 'Sydney Cycles',
      latitude: -33.8688,
      longitude: 151.2093,
      claimed: false,
      distanceMiles: 3.2,
      address: {
        line1: '1 Harbour Road', locality: 'Sydney', region: 'NSW', postalCode: '2000', countryCode: 'AU', formatted: '1 Harbour Road, Sydney NSW 2000',
      },
      phone: '+61 2 5555 0100',
      website: 'https://sydney-cycles.example/',
      openingHours: 'Mo-Sa 09:00-18:00',
      services: { sales: true, repair: true, rental: false, ebike: true },
      source: { provider: 'Overture Maps', elementType: 'place', elementId: 'sydney-cycles', url: 'https://example.test/source' },
      links: {
        maps: 'https://maps.example/sydney-cycles',
        directions: 'https://maps.example/directions/sydney-cycles',
        streetView: 'https://maps.example/streetview/sydney-cycles',
      },
    }],
    selectedShopId: 'overture:sydney-cycles',
    hasSearched: true,
    resultMode: 'hierarchy',
    nearbyContext: null,
    mapViewport: { north: -33.7, south: -34.0, east: 151.4, west: 151.0, zoom: 12 },
    viewportTruncated: false,
    countryFilter: 'AU',
    regionFilter: 'NSW',
    cityFilter: 'Sydney',
    hierarchyTotal: 2,
    hierarchyOffset: 1,
    nameSearchTerm: '',
    nameSearchTotal: 0,
    nameSearchOffset: 0,
    pageScrollY: 640,
    resultListScrollTop: 120,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('public bike shop directory state', () => {
  it('sanitizes and retains the complete country-to-city browsing context', () => {
    const restored = normalizePublicBikeShopDirectoryState(storedState());

    expect(restored).toMatchObject({
      shopSearchMode: 'location',
      locationInput: 'Sydney, NSW',
      radiusMiles: 35,
      resultMode: 'hierarchy',
      countryFilter: 'AU',
      regionFilter: 'NSW',
      cityFilter: 'Sydney',
      selectedShopId: 'overture:sydney-cycles',
      mapViewport: { north: -33.7, south: -34, east: 151.4, west: 151, zoom: 12 },
      pageScrollY: 640,
      resultListScrollTop: 120,
    });
    expect(restored?.shops).toHaveLength(1);
    expect(restored?.shops[0]).toMatchObject({
      name: 'Sydney Cycles',
      address: { countryCode: 'AU', region: 'NSW', locality: 'Sydney' },
    });
  });

  it('rewinds paging offsets to the retained result prefix when storage caps a multi-page listing', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
    const state = storedState();
    const shops = Array.from({ length: 1_000 }, (_, index) => ({
      ...state.shops[0],
      id: `overture:shop-${index}`,
      name: `Stored shop ${index}`,
      source: { ...state.shops[0].source, elementId: `shop-${index}` },
    }));
    writePublicBikeShopDirectoryState({
      ...state,
      shops,
      hierarchyTotal: 1_500,
      hierarchyOffset: 1_000,
      nameSearchTotal: 1_500,
      nameSearchOffset: 1_000,
    });
    const persisted = JSON.parse(values.get(publicBikeShopDirectoryStateStorageKey) ?? '{}') as PublicBikeShopDirectoryState;
    const restored = readPublicBikeShopDirectoryState();

    expect(persisted.shops).toHaveLength(500);
    expect(persisted.hierarchyOffset).toBe(500);
    expect(persisted.nameSearchOffset).toBe(500);
    expect(restored?.shops).toHaveLength(500);
    expect(restored?.shops.at(-1)?.id).toBe('overture:shop-499');
    expect(restored).toMatchObject({
      hierarchyTotal: 1_500,
      hierarchyOffset: 500,
      nameSearchTotal: 1_500,
      nameSearchOffset: 500,
    });
  });

  it('uses versioned session storage and rejects unsafe cameras without losing the valid listing', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
    const state = storedState();
    writePublicBikeShopDirectoryState(state);
    expect(values.get(publicBikeShopDirectoryStateStorageKey)).toBeTruthy();
    expect(readPublicBikeShopDirectoryState()).toMatchObject({
      countryFilter: 'AU',
      regionFilter: 'NSW',
      cityFilter: 'Sydney',
      selectedShopId: 'overture:sydney-cycles',
    });

    values.set(publicBikeShopDirectoryStateStorageKey, JSON.stringify({
      ...state,
      mapViewport: { north: 90, south: -90, east: 400, west: -400, zoom: 99 },
    }));
    expect(readPublicBikeShopDirectoryState()).toMatchObject({
      shops: [{ id: 'overture:sydney-cycles' }],
      mapViewport: null,
    });
  });
});
