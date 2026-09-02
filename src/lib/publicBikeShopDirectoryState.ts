import type { BikeShopRecord, BikeShopViewport } from './bikeShops';

/**
 * Public-directory browsing state is intentionally scoped to the browser tab.
 * It is not account data and must survive a same-origin full-page trip to a
 * track (then Back) without leaking to a different browser session.
 */
export const publicBikeShopDirectoryStateStorageKey = 'tracklab:public-bike-shop-directory:v1';

export type PublicBikeShopDirectoryResultMode = 'none' | 'nearby' | 'viewport' | 'hierarchy' | 'name';

export type PublicBikeShopDirectoryState = {
  version: 1;
  locationInput: string;
  shopSearchMode: 'location' | 'name';
  radiusMiles: number;
  shops: BikeShopRecord[];
  selectedShopId: string;
  hasSearched: boolean;
  resultMode: PublicBikeShopDirectoryResultMode;
  nearbyContext: { label: string; radiusMiles: number } | null;
  mapViewport: BikeShopViewport | null;
  viewportTruncated: boolean;
  countryFilter: string;
  regionFilter: string;
  cityFilter: string;
  hierarchyTotal: number;
  hierarchyOffset: number;
  nameSearchTerm: string;
  nameSearchTotal: number;
  nameSearchOffset: number;
  pageScrollY: number;
  resultListScrollTop: number;
};

const maxStoredShops = 500;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown, maxLength = 500) {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function finiteNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nonNegativeNumber(value: unknown) {
  return Math.max(0, finiteNumber(value));
}

function retainedPagingOffset(value: unknown, retainedShopCount: number) {
  return Math.min(retainedShopCount, Math.max(0, Math.floor(finiteNumber(value))));
}

function validRadius(value: unknown) {
  const radius = finiteNumber(value, 25);
  return radius >= 5 && radius <= 50 && radius % 5 === 0 ? radius : 25;
}

function validViewport(value: unknown): BikeShopViewport | null {
  const viewport = asRecord(value);
  if (!viewport) return null;
  const north = finiteNumber(viewport.north, Number.NaN);
  const south = finiteNumber(viewport.south, Number.NaN);
  const east = finiteNumber(viewport.east, Number.NaN);
  const west = finiteNumber(viewport.west, Number.NaN);
  const zoom = finiteNumber(viewport.zoom, Number.NaN);
  if (
    !Number.isFinite(north)
    || !Number.isFinite(south)
    || !Number.isFinite(east)
    || !Number.isFinite(west)
    || !Number.isFinite(zoom)
    || north <= south
    || north > 85.05112878
    || south < -85.05112878
    || east < -180
    || east > 180
    || west < -180
    || west > 180
    || zoom < 2
    || zoom > 20
  ) return null;
  return { north, south, east, west, zoom };
}

function validShop(value: unknown): BikeShopRecord | null {
  const shop = asRecord(value);
  const address = asRecord(shop?.address);
  const services = asRecord(shop?.services);
  const source = asRecord(shop?.source);
  const links = asRecord(shop?.links);
  const latitude = finiteNumber(shop?.latitude, Number.NaN);
  const longitude = finiteNumber(shop?.longitude, Number.NaN);
  const id = text(shop?.id, 300);
  const name = text(shop?.name, 500);
  if (!id || !name || !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

  const aliases = Array.isArray(source?.aliases)
    ? source.aliases.map((alias) => asRecord(alias)).filter((alias): alias is Record<string, unknown> => Boolean(alias)).slice(0, 20).map((alias) => ({
      provider: text(alias.provider),
      elementType: text(alias.elementType),
      elementId: text(alias.elementId),
      url: text(alias.url, 2_000),
    }))
    : undefined;
  const provenance = Array.isArray(source?.provenance)
    ? source.provenance.filter((entry): entry is string => typeof entry === 'string').slice(0, 20)
    : undefined;
  const catalogProvenance = Array.isArray(source?.catalogProvenance)
    ? source.catalogProvenance.filter((entry): entry is string => typeof entry === 'string').slice(0, 20)
    : undefined;

  return {
    id,
    name,
    latitude,
    longitude,
    claimed: Boolean(shop?.claimed),
    distanceMiles: nonNegativeNumber(shop?.distanceMiles),
    address: {
      line1: text(address?.line1),
      locality: text(address?.locality),
      region: text(address?.region),
      postalCode: text(address?.postalCode),
      countryCode: text(address?.countryCode, 16),
      formatted: text(address?.formatted),
    },
    phone: text(shop?.phone),
    website: text(shop?.website, 2_000),
    openingHours: text(shop?.openingHours),
    services: {
      sales: Boolean(services?.sales),
      repair: Boolean(services?.repair),
      rental: Boolean(services?.rental),
      ebike: Boolean(services?.ebike),
    },
    source: {
      provider: text(source?.provider),
      elementType: text(source?.elementType),
      elementId: text(source?.elementId),
      url: text(source?.url, 2_000),
      ...(aliases && aliases.length > 0 ? { aliases } : {}),
      ...(provenance && provenance.length > 0 ? { provenance } : {}),
      ...(catalogProvenance && catalogProvenance.length > 0 ? { catalogProvenance } : {}),
    },
    links: {
      maps: text(links?.maps, 2_000),
      directions: text(links?.directions, 2_000),
      streetView: text(links?.streetView, 2_000),
    },
  };
}

export function normalizePublicBikeShopDirectoryState(value: unknown): PublicBikeShopDirectoryState | null {
  const state = asRecord(value);
  if (!state || state.version !== 1) return null;
  const resultMode = state.resultMode;
  if (!['none', 'nearby', 'viewport', 'hierarchy', 'name'].includes(String(resultMode))) return null;
  const nearbyContext = asRecord(state.nearbyContext);
  const shops = Array.isArray(state.shops)
    ? state.shops.map(validShop).filter((shop): shop is BikeShopRecord => Boolean(shop)).slice(0, maxStoredShops)
    : [];
  const selectedShopId = text(state.selectedShopId, 300);
  return {
    version: 1,
    locationInput: text(state.locationInput, 240),
    shopSearchMode: state.shopSearchMode === 'name' ? 'name' : 'location',
    radiusMiles: validRadius(state.radiusMiles),
    shops,
    selectedShopId: shops.some((shop) => shop.id === selectedShopId) ? selectedShopId : shops[0]?.id ?? '',
    hasSearched: Boolean(state.hasSearched),
    resultMode: resultMode as PublicBikeShopDirectoryResultMode,
    nearbyContext: nearbyContext && text(nearbyContext.label, 240)
      ? { label: text(nearbyContext.label, 240), radiusMiles: validRadius(nearbyContext.radiusMiles) }
      : null,
    mapViewport: validViewport(state.mapViewport),
    viewportTruncated: Boolean(state.viewportTruncated),
    countryFilter: text(state.countryFilter, 120) || '__all__',
    regionFilter: text(state.regionFilter, 180) || '__all__',
    cityFilter: text(state.cityFilter, 180) || '__all__',
    hierarchyTotal: nonNegativeNumber(state.hierarchyTotal),
    // Stored result sets are capped for session-storage safety. A cursor beyond
    // the retained prefix would skip the discarded page when the visitor next
    // chooses "Load more", so resume from the end of what we actually kept.
    hierarchyOffset: retainedPagingOffset(state.hierarchyOffset, shops.length),
    nameSearchTerm: text(state.nameSearchTerm, 240),
    nameSearchTotal: nonNegativeNumber(state.nameSearchTotal),
    nameSearchOffset: retainedPagingOffset(state.nameSearchOffset, shops.length),
    pageScrollY: nonNegativeNumber(state.pageScrollY),
    resultListScrollTop: nonNegativeNumber(state.resultListScrollTop),
  };
}

export function readPublicBikeShopDirectoryState(): PublicBikeShopDirectoryState | null {
  if (typeof window === 'undefined') return null;
  try {
    const serialized = window.sessionStorage.getItem(publicBikeShopDirectoryStateStorageKey);
    return serialized ? normalizePublicBikeShopDirectoryState(JSON.parse(serialized)) : null;
  } catch {
    return null;
  }
}

export function writePublicBikeShopDirectoryState(state: PublicBikeShopDirectoryState) {
  if (typeof window === 'undefined') return;
  try {
    const normalized = normalizePublicBikeShopDirectoryState(state);
    if (!normalized) return;
    window.sessionStorage.setItem(publicBikeShopDirectoryStateStorageKey, JSON.stringify(normalized));
  } catch {
    // Browsing the public directory remains fully functional if storage is blocked.
  }
}
