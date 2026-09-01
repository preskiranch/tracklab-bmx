import type { TrackLocatorRecord, TrackRecord } from '../types';

export type BikeShopPoint = {
  latitude: number;
  longitude: number;
};

export type BikeShopAddress = {
  line1: string;
  locality: string;
  region: string;
  postalCode: string;
  countryCode: string;
  formatted: string;
};

export type BikeShopSourceIdentity = {
  provider: string;
  elementType: string;
  elementId: string;
  url: string;
};

export type BikeShopRecord = BikeShopPoint & {
  id: string;
  name: string;
  claimed: boolean;
  distanceMiles: number;
  address: BikeShopAddress;
  phone: string;
  website: string;
  openingHours: string;
  services: {
    sales: boolean;
    repair: boolean;
    rental: boolean;
    ebike: boolean;
  };
  source: BikeShopSourceIdentity & {
    aliases?: BikeShopSourceIdentity[];
    provenance?: string[];
    catalogProvenance?: string[];
  };
  links: {
    maps: string;
    directions: string;
    streetView: string;
  };
};

export type BikeShopAttribution = {
  text: string;
  url: string;
  license: string;
};

export type BikeShopDirectoryResponse = {
  origin: BikeShopPoint & { radiusMiles: number };
  shops: BikeShopRecord[];
  attribution: BikeShopAttribution;
  attributions: BikeShopAttribution[];
  degraded: boolean;
  notice: string;
};

export type BikeShopViewport = {
  north: number;
  south: number;
  east: number;
  west: number;
  zoom: number;
};

export type BikeShopViewportResponse = {
  viewport: BikeShopViewport;
  shops: BikeShopRecord[];
  attribution: BikeShopDirectoryResponse['attribution'];
  attributions: BikeShopAttribution[];
  truncated: boolean;
  degraded: boolean;
  notice: string;
};

export type BikeShopHierarchyLevel = 'country' | 'region' | 'city';

export type BikeShopHierarchyItem = {
  value: string;
  count: number;
};

export type BikeShopHierarchyResponse = {
  level: BikeShopHierarchyLevel;
  items: BikeShopHierarchyItem[];
  attributions: BikeShopAttribution[];
};

export type BikeShopCityBrowseResponse = {
  location: { countryCode: string; region: string; locality: string };
  shops: BikeShopRecord[];
  total: number;
  truncated: boolean;
  bounds: { north: number; south: number; east: number; west: number } | null;
  attributions: BikeShopAttribution[];
};

export type NearbyBikeShopTrack = {
  track: TrackRecord | TrackLocatorRecord;
  distanceMiles: number;
};

export type BikeShopClaimRole = 'owner' | 'manager' | 'authorized-representative';
export type BikeShopClaimVerificationMethod = 'business-email' | 'business-phone' | 'documentation';

export type BikeShopClaimRequest = {
  shop: BikeShopRecord;
  claimantRole: BikeShopClaimRole;
  verificationMethod: BikeShopClaimVerificationMethod;
  businessEmail?: string;
  businessPhone?: string;
  verificationNote?: string;
};

export type BikeShopClaimReceipt = {
  id: string;
  status: 'pending';
  shopName: string;
  createdAt: string;
};

export type BikeShopClaimStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

export type BikeShopClaimSnapshot = {
  id: string;
  name: string;
  address: BikeShopAddress;
  phone: string;
  website: string;
  openingHours: string;
  services: BikeShopRecord['services'];
  source: BikeShopRecord['source'];
};

export type BikeShopClaimRecord = {
  id: string;
  source: 'openstreetmap' | 'overture';
  osmElementType: 'node' | 'way' | 'relation' | 'place';
  osmElementId: string;
  shopName: string;
  latitude: number;
  longitude: number;
  shopSnapshot: BikeShopClaimSnapshot | null;
  claimantRole: BikeShopClaimRole;
  verificationMethod: BikeShopClaimVerificationMethod;
  businessEmail: string;
  businessPhone: string;
  verificationNote: string;
  status: BikeShopClaimStatus;
  reviewNote: string;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BikeShopAdminClaimRecord = BikeShopClaimRecord & {
  claimant: {
    displayName: string;
    email: string;
  };
};

export type BikeShopAdminClaimPage = {
  items: BikeShopAdminClaimRecord[];
  total: number;
  offset: number;
  limit: number;
  status: BikeShopClaimStatus | 'all';
};

const minimumRadiusMiles = 5;
const maximumRadiusMiles = 50;
const maximumResponseShops = 100;
const maximumViewportResponseShops = 500;
const earthRadiusMiles = 3958.7613;

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanText(value: unknown, maximumLength = 240) {
  return typeof value === 'string' ? value.trim().slice(0, maximumLength) : '';
}

function normalizeSourceIdentity(value: unknown): BikeShopSourceIdentity | null {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const provider = cleanText(record.provider, 80);
  const elementType = cleanText(record.elementType, 24);
  const elementId = cleanText(record.elementId, 80);
  const source = provider === 'Overture Maps'
    ? 'overture'
    : provider === 'OpenStreetMap'
      ? 'openstreetmap'
      : '';
  const validIdentity = (
    source === 'openstreetmap'
    && ['node', 'way', 'relation'].includes(elementType)
    && /^[1-9][0-9]{0,30}$/.test(elementId)
  ) || (
    source === 'overture'
    && elementType === 'place'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(elementId)
  );
  if (!validIdentity) return null;
  return { provider, elementType, elementId, url: cleanExternalUrl(record.url) };
}

function normalizeShopSource(value: unknown): BikeShopRecord['source'] {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const primary = normalizeSourceIdentity(record);
  const aliases = new Map<string, BikeShopSourceIdentity>();
  for (const aliasValue of Array.isArray(record.aliases) ? record.aliases : []) {
    const alias = normalizeSourceIdentity(aliasValue);
    if (!alias) continue;
    const key = `${alias.provider}:${alias.elementType}:${alias.elementId}`;
    if (!primary || key !== `${primary.provider}:${primary.elementType}:${primary.elementId}`) {
      aliases.set(key, alias);
    }
  }
  return {
    provider: primary?.provider || cleanText(record.provider, 80) || 'OpenStreetMap',
    elementType: primary?.elementType || cleanText(record.elementType, 24),
    elementId: primary?.elementId || cleanText(record.elementId, 80),
    url: primary?.url || cleanExternalUrl(record.url),
    aliases: [...aliases.values()].slice(0, 8),
    provenance: [...new Set((Array.isArray(record.provenance)
      ? record.provenance
      : [record.provider])
      .map((entry) => cleanText(entry, 80))
      .filter(Boolean))].slice(0, 8),
    catalogProvenance: [...new Set((Array.isArray(record.catalogProvenance)
      ? record.catalogProvenance
      : [])
      .map((entry) => cleanText(entry, 500))
      .filter(Boolean))].slice(0, 32),
  };
}

function cleanExternalUrl(value: unknown) {
  const candidate = cleanText(value, 1_000);
  if (!candidate) return '';
  try {
    const url = new URL(candidate);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.toString()
      : '';
  } catch {
    return '';
  }
}

function validPoint(value: unknown): BikeShopPoint | null {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const latitude = finiteNumber(record.latitude ?? record.lat);
  const longitude = finiteNumber(record.longitude ?? record.lng ?? record.lon);
  return latitude !== null && latitude >= -90 && latitude <= 90
    && longitude !== null && longitude >= -180 && longitude <= 180
    ? { latitude, longitude }
    : null;
}

function googleShopLinks(shop: BikeShopPoint & { name: string }) {
  const coordinatePair = `${shop.latitude},${shop.longitude}`;
  const maps = new URL('https://www.google.com/maps/search/');
  maps.searchParams.set('api', '1');
  maps.searchParams.set('query', `${shop.name} ${coordinatePair}`);
  const directions = new URL('https://www.google.com/maps/dir/');
  directions.searchParams.set('api', '1');
  directions.searchParams.set('destination', coordinatePair);
  const streetView = new URL('https://www.google.com/maps/@');
  streetView.searchParams.set('api', '1');
  streetView.searchParams.set('map_action', 'pano');
  streetView.searchParams.set('viewpoint', coordinatePair);
  return {
    maps: maps.toString(),
    directions: directions.toString(),
    streetView: streetView.toString(),
  };
}

function normalizeShop(value: unknown): BikeShopRecord | null {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const point = validPoint(record);
  const id = cleanText(record.id, 180);
  const name = cleanText(record.name, 180);
  if (!point || !id || !name) return null;
  const rawAddress = record.address && typeof record.address === 'object'
    ? record.address as Record<string, unknown>
    : {};
  const rawServices = record.services && typeof record.services === 'object'
    ? record.services as Record<string, unknown>
    : {};
  const rawSource = record.source && typeof record.source === 'object'
    ? record.source as Record<string, unknown>
    : {};
  const rawLinks = record.links && typeof record.links === 'object'
    ? record.links as Record<string, unknown>
    : {};
  const fallbackLinks = googleShopLinks({ ...point, name });
  const distance = finiteNumber(record.distanceMiles);
  return {
    id,
    name,
    claimed: record.claimed === true,
    ...point,
    distanceMiles: distance !== null && distance >= 0 ? Math.round(distance * 10) / 10 : 0,
    address: {
      line1: cleanText(rawAddress.line1),
      locality: cleanText(rawAddress.locality),
      region: cleanText(rawAddress.region),
      postalCode: cleanText(rawAddress.postalCode, 40),
      countryCode: cleanText(rawAddress.countryCode, 8).toUpperCase(),
      formatted: cleanText(rawAddress.formatted, 500),
    },
    phone: cleanText(record.phone, 80),
    website: cleanExternalUrl(record.website),
    openingHours: cleanText(record.openingHours, 300),
    services: {
      sales: rawServices.sales === true,
      repair: rawServices.repair === true,
      rental: rawServices.rental === true,
      ebike: rawServices.ebike === true,
    },
    source: normalizeShopSource(rawSource),
    links: {
      maps: cleanExternalUrl(rawLinks.maps) || fallbackLinks.maps,
      directions: cleanExternalUrl(rawLinks.directions) || fallbackLinks.directions,
      streetView: cleanExternalUrl(rawLinks.streetView) || fallbackLinks.streetView,
    },
  };
}

function normalizeClaimSnapshot(value: unknown): BikeShopClaimSnapshot | null {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const rawAddress = record.address && typeof record.address === 'object'
    ? record.address as Record<string, unknown>
    : {};
  const rawServices = record.services && typeof record.services === 'object'
    ? record.services as Record<string, unknown>
    : {};
  const id = cleanText(record.id, 180);
  const name = cleanText(record.name, 180);
  if (!id || !name) return null;
  return {
    id,
    name,
    address: {
      line1: cleanText(rawAddress.line1),
      locality: cleanText(rawAddress.locality),
      region: cleanText(rawAddress.region),
      postalCode: cleanText(rawAddress.postalCode, 40),
      countryCode: cleanText(rawAddress.countryCode, 8).toUpperCase(),
      formatted: cleanText(rawAddress.formatted, 500),
    },
    phone: cleanText(record.phone, 80),
    website: cleanExternalUrl(record.website),
    openingHours: cleanText(record.openingHours, 300),
    services: {
      sales: rawServices.sales === true,
      repair: rawServices.repair === true,
      rental: rawServices.rental === true,
      ebike: rawServices.ebike === true,
    },
    source: normalizeShopSource(record.source),
  };
}

function normalizeClaimRecord(value: unknown): BikeShopClaimRecord | null {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const id = cleanText(record.id, 80);
  const source = cleanText(record.source, 40);
  const osmElementType = cleanText(record.osmElementType, 24);
  const osmElementId = cleanText(record.osmElementId, 40);
  const claimantRole = cleanText(record.claimantRole, 40);
  const verificationMethod = cleanText(record.verificationMethod, 40);
  const status = cleanText(record.status, 20);
  const point = validPoint(record);
  const validSourceIdentity = (
    source === 'openstreetmap'
    && ['node', 'way', 'relation'].includes(osmElementType)
    && /^[1-9][0-9]{0,30}$/.test(osmElementId)
  ) || (
    source === 'overture'
    && osmElementType === 'place'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(osmElementId)
  );
  if (
    !id
    || !validSourceIdentity
    || !['owner', 'manager', 'authorized-representative'].includes(claimantRole)
    || !['business-email', 'business-phone', 'documentation'].includes(verificationMethod)
    || !['pending', 'approved', 'rejected', 'withdrawn'].includes(status)
    || !point
  ) return null;
  return {
    id,
    source: source as BikeShopClaimRecord['source'],
    osmElementType: osmElementType as BikeShopClaimRecord['osmElementType'],
    osmElementId,
    shopName: cleanText(record.shopName, 180),
    ...point,
    shopSnapshot: normalizeClaimSnapshot(record.shopSnapshot),
    claimantRole: claimantRole as BikeShopClaimRole,
    verificationMethod: verificationMethod as BikeShopClaimVerificationMethod,
    businessEmail: cleanText(record.businessEmail, 254),
    businessPhone: cleanText(record.businessPhone, 80),
    verificationNote: cleanText(record.verificationNote, 1_000),
    status: status as BikeShopClaimStatus,
    reviewNote: cleanText(record.reviewNote, 1_000),
    reviewedAt: cleanText(record.reviewedAt, 80) || null,
    createdAt: cleanText(record.createdAt, 80),
    updatedAt: cleanText(record.updatedAt, 80),
  };
}

function claimApiError(payload: Record<string, unknown>, status: number) {
  return new BikeShopDirectoryError(
    cleanText(payload.error, 240) || `The shop claim service returned ${status}.`,
    status,
  );
}

export async function listMyBikeShopClaimRequests(
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  const response = await fetcher('/api/bike-shops/claim-requests', {
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
    ...(signal ? { signal } : {}),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw claimApiError(payload, response.status);
  return (Array.isArray(payload.claims) ? payload.claims : [])
    .map(normalizeClaimRecord)
    .filter((claim): claim is BikeShopClaimRecord => Boolean(claim));
}

export async function withdrawBikeShopClaimRequest(claimId: string, fetcher: typeof fetch = fetch) {
  if (!/^[a-f0-9-]{36}$/iu.test(claimId)) {
    throw new BikeShopDirectoryError('A valid claim request ID is required.', 400);
  }
  const response = await fetcher(`/api/bike-shops/claim-requests/${encodeURIComponent(claimId)}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    throw claimApiError(payload, response.status);
  }
}

export async function listBikeShopClaimsForAdmin(
  status: BikeShopClaimStatus | 'all' = 'pending',
  options: {
    offset?: number;
    limit?: number;
    fetcher?: typeof fetch;
    signal?: AbortSignal;
  } = {},
) {
  const offset = Math.max(0, Math.min(10_000, Math.round(Number(options.offset)) || 0));
  const limit = Math.max(1, Math.min(100, Math.round(Number(options.limit)) || 25));
  const fetcher = options.fetcher ?? fetch;
  const query = new URLSearchParams({ status, offset: String(offset), limit: String(limit) });
  const response = await fetcher(`/api/admin/bike-shop-claims?${query}`, {
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw claimApiError(payload, response.status);
  const items = (Array.isArray(payload.items) ? payload.items : [])
    .map((value) => {
      const claim = normalizeClaimRecord(value);
      const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
      const rawClaimant = record.claimant && typeof record.claimant === 'object'
        ? record.claimant as Record<string, unknown>
        : {};
      return claim ? {
        ...claim,
        claimant: {
          displayName: cleanText(rawClaimant.displayName, 180),
          email: cleanText(rawClaimant.email, 254),
        },
      } satisfies BikeShopAdminClaimRecord : null;
    })
    .filter((claim): claim is BikeShopAdminClaimRecord => Boolean(claim));
  const normalizedStatus = cleanText(payload.status, 20);
  const responseOffset = Math.max(0, Math.min(10_000, Math.round(finiteNumber(payload.offset) ?? offset)));
  const responseLimit = Math.max(1, Math.min(100, Math.round(finiteNumber(payload.limit) ?? limit)));
  const responseTotal = Math.max(
    responseOffset + items.length,
    Math.round(finiteNumber(payload.total) ?? responseOffset + items.length),
  );
  return {
    items,
    total: Math.min(1_000_000, responseTotal),
    offset: responseOffset,
    limit: responseLimit,
    status: ['pending', 'approved', 'rejected', 'withdrawn', 'all'].includes(normalizedStatus)
      ? normalizedStatus as BikeShopClaimStatus | 'all'
      : status,
  } satisfies BikeShopAdminClaimPage;
}

export function bikeShopClaimSourceUrl(
  claim: Pick<BikeShopClaimRecord, 'source' | 'osmElementType' | 'osmElementId'>,
) {
  if (
    claim.source === 'openstreetmap'
    && ['node', 'way', 'relation'].includes(claim.osmElementType)
    && /^[1-9][0-9]{0,30}$/.test(claim.osmElementId)
  ) return `https://www.openstreetmap.org/${claim.osmElementType}/${claim.osmElementId}`;
  if (
    claim.source === 'overture'
    && claim.osmElementType === 'place'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claim.osmElementId)
  ) return 'https://docs.overturemaps.org/guides/places/';
  return '';
}

export async function reviewBikeShopClaimRequest(
  claimId: string,
  decision: 'approved' | 'rejected',
  reviewNote: string,
  fetcher: typeof fetch = fetch,
) {
  if (!/^[a-f0-9-]{36}$/iu.test(claimId) || !['approved', 'rejected'].includes(decision)) {
    throw new BikeShopDirectoryError('Choose a valid claim and review decision.', 400);
  }
  const note = cleanText(reviewNote, 1_000);
  if (note.length < 3) throw new BikeShopDirectoryError('Add a concise review note.', 400);
  const response = await fetcher(`/api/admin/bike-shop-claims/${encodeURIComponent(claimId)}`, {
    method: 'PATCH',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ decision, reviewNote: note }),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw claimApiError(payload, response.status);
  const rawClaim = payload.claim && typeof payload.claim === 'object' ? payload.claim : null;
  const claims = await (async () => {
    const claim = normalizeClaimRecord(rawClaim);
    const record = rawClaim && typeof rawClaim === 'object' ? rawClaim as Record<string, unknown> : {};
    const rawClaimant = record.claimant && typeof record.claimant === 'object'
      ? record.claimant as Record<string, unknown>
      : {};
    return claim ? {
      ...claim,
      claimant: {
        displayName: cleanText(rawClaimant.displayName, 180),
        email: cleanText(rawClaimant.email, 254),
      },
    } satisfies BikeShopAdminClaimRecord : null;
  })();
  if (!claims) throw new BikeShopDirectoryError('TrackLab received an invalid review confirmation.', 502);
  return claims;
}

function normalizeShops(value: unknown, maximumShops = maximumResponseShops) {
  const rawShops = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  return rawShops
    .map(normalizeShop)
    .filter((shop): shop is BikeShopRecord => Boolean(shop))
    .filter((shop) => {
      if (seen.has(shop.id)) return false;
      seen.add(shop.id);
      return true;
    })
    .slice(0, maximumShops);
}

function normalizeAttribution(value: unknown) {
  const rawAttribution = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  return {
    text: cleanText(rawAttribution.text, 120) || '© OpenStreetMap contributors',
    url: cleanExternalUrl(rawAttribution.url) || 'https://www.openstreetmap.org/copyright',
    license: cleanText(rawAttribution.license, 40) || 'ODbL',
  };
}

function normalizeAttributions(value: unknown, fallback?: BikeShopAttribution) {
  const seen = new Set<string>();
  const normalized = (Array.isArray(value) ? value : [])
    .map((entry) => normalizeAttribution(entry))
    .filter((entry) => {
      const key = `${entry.text}\u0000${entry.url}\u0000${entry.license}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
  return normalized.length > 0 ? normalized : [fallback ?? normalizeAttribution(null)];
}

function normalizeDirectoryResponse(value: unknown, requestedOrigin: BikeShopPoint & { radiusMiles: number }) {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const attribution = normalizeAttribution(record.attribution);
  return {
    origin: requestedOrigin,
    shops: normalizeShops(record.shops),
    attribution,
    attributions: normalizeAttributions(record.attributions, attribution),
    degraded: record.degraded === true,
    notice: cleanText(record.notice, 240),
  } satisfies BikeShopDirectoryResponse;
}

export async function listBikeShopHierarchy(
  input: { countryCode?: string; region?: string } = {},
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  const countryCode = cleanText(input.countryCode, 8).toUpperCase();
  const region = cleanText(input.region, 160);
  if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) {
    throw new BikeShopDirectoryError('Choose a valid country.', 400);
  }
  if (region && !countryCode) {
    throw new BikeShopDirectoryError('Choose a country before choosing a state or province.', 400);
  }
  const query = new URLSearchParams();
  if (countryCode) query.set('countryCode', countryCode);
  if (region) query.set('region', region);
  const response = await fetcher(`/api/bike-shops/hierarchy${query.size ? `?${query}` : ''}`, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    ...(signal ? { signal } : {}),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new BikeShopDirectoryError(
      cleanText(payload.error, 240) || `The bike shop location directory returned ${response.status}.`,
      response.status,
    );
  }
  const expectedLevel: BikeShopHierarchyLevel = region ? 'city' : countryCode ? 'region' : 'country';
  if (payload.level !== expectedLevel || !Array.isArray(payload.items)) {
    throw new BikeShopDirectoryError('TrackLab received an invalid bike shop location directory.', 502);
  }
  const seen = new Set<string>();
  const items = payload.items.map((entry) => {
    const record = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
    const value = cleanText(record.value, 160);
    const count = Math.round(finiteNumber(record.count) ?? -1);
    return value && count >= 0 && count <= 200_000 ? { value, count } : null;
  }).filter((entry): entry is BikeShopHierarchyItem => {
    if (!entry || seen.has(entry.value)) return false;
    seen.add(entry.value);
    return true;
  }).slice(0, 5_000);
  return {
    level: expectedLevel,
    items,
    attributions: normalizeAttributions(payload.attributions),
  } satisfies BikeShopHierarchyResponse;
}

export async function browseBikeShopsByCity(
  location: { countryCode: string; region: string; locality: string },
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  const countryCode = cleanText(location.countryCode, 8).toUpperCase();
  const region = cleanText(location.region, 160);
  const locality = cleanText(location.locality, 160);
  if (!/^[A-Z]{2}$/.test(countryCode) || !region || !locality) {
    throw new BikeShopDirectoryError('Choose a country, state or province, and city.', 400);
  }
  const response = await fetcher('/api/bike-shops/browse', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ countryCode, region, locality }),
    ...(signal ? { signal } : {}),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new BikeShopDirectoryError(
      cleanText(payload.error, 240) || `The bike shop city directory returned ${response.status}.`,
      response.status,
    );
  }
  const rawBounds = payload.bounds && typeof payload.bounds === 'object'
    ? payload.bounds as Record<string, unknown>
    : {};
  const north = finiteNumber(rawBounds.north);
  const south = finiteNumber(rawBounds.south);
  const east = finiteNumber(rawBounds.east);
  const west = finiteNumber(rawBounds.west);
  const bounds = north !== null && south !== null && east !== null && west !== null
    && north >= south && north <= 90 && south >= -90
    && east >= -180 && east <= 180 && west >= -180 && west <= 180
    ? { north, south, east, west }
    : null;
  const shops = normalizeShops(payload.shops, maximumViewportResponseShops);
  const total = Math.max(shops.length, Math.min(200_000, Math.round(finiteNumber(payload.total) ?? shops.length)));
  return {
    location: { countryCode, region, locality },
    shops,
    total,
    truncated: payload.truncated === true || total > shops.length,
    bounds,
    attributions: normalizeAttributions(payload.attributions),
  } satisfies BikeShopCityBrowseResponse;
}

export class BikeShopDirectoryError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'BikeShopDirectoryError';
    this.status = status;
  }
}

function claimShopIdentity(shop: BikeShopRecord) {
  const elementType = shop.source.elementType;
  const elementId = shop.source.elementId;
  const source = shop.source.provider === 'Overture Maps' ? 'overture' : 'openstreetmap';
  const valid = source === 'openstreetmap'
    ? ['node', 'way', 'relation'].includes(elementType) && /^[1-9][0-9]{0,30}$/.test(elementId)
    : elementType === 'place'
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(elementId);
  if (!valid) {
    throw new BikeShopDirectoryError('This open-directory listing cannot be claimed yet.', 400);
  }
  return { source, elementType, elementId };
}

export async function submitBikeShopClaimRequest(
  request: BikeShopClaimRequest,
  fetcher: typeof fetch = fetch,
) {
  const { source, elementType, elementId } = claimShopIdentity(request.shop);
  const businessEmail = cleanText(request.businessEmail, 254).toLowerCase();
  const businessPhone = cleanText(request.businessPhone, 80);
  const verificationNote = cleanText(request.verificationNote, 1_000);
  if (!['owner', 'manager', 'authorized-representative'].includes(request.claimantRole)) {
    throw new BikeShopDirectoryError('Choose your relationship to this shop.', 400);
  }
  if (!['business-email', 'business-phone', 'documentation'].includes(request.verificationMethod)) {
    throw new BikeShopDirectoryError('Choose how TrackLab can verify this claim.', 400);
  }
  if (request.verificationMethod === 'business-email'
    && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(businessEmail)) {
    throw new BikeShopDirectoryError('Enter a valid business email address.', 400);
  }
  if (request.verificationMethod === 'business-phone' && businessPhone.replace(/\D/g, '').length < 7) {
    throw new BikeShopDirectoryError('Enter a valid business phone number.', 400);
  }
  if (request.verificationMethod === 'documentation' && verificationNote.length < 20) {
    throw new BikeShopDirectoryError('Explain which ownership documentation you can provide.', 400);
  }
  const response = await fetcher('/api/bike-shops/claim-requests', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      shop: {
        id: source === 'overture'
          ? `overture:${elementId}`
          : `osm:${elementType}:${elementId}`,
        name: request.shop.name,
        latitude: request.shop.latitude,
        longitude: request.shop.longitude,
        address: request.shop.address,
        phone: request.shop.phone,
        website: request.shop.website,
        services: request.shop.services,
      },
      claimantRole: request.claimantRole,
      verificationMethod: request.verificationMethod,
      businessEmail,
      businessPhone,
      verificationNote,
    }),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new BikeShopDirectoryError(
      cleanText(payload.error, 240) || `The shop claim service returned ${response.status}.`,
      response.status,
    );
  }
  const rawClaim = payload.claim && typeof payload.claim === 'object'
    ? payload.claim as Record<string, unknown>
    : payload;
  const id = cleanText(rawClaim.id, 80);
  if (!id) throw new BikeShopDirectoryError('TrackLab received an invalid claim confirmation.', 502);
  return {
    id,
    status: 'pending',
    shopName: cleanText(rawClaim.shopName, 180) || request.shop.name,
    createdAt: cleanText(rawClaim.createdAt, 80),
  } satisfies BikeShopClaimReceipt;
}

export async function searchNearbyBikeShops(
  point: BikeShopPoint,
  radiusMiles: number,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  const origin = validPoint(point);
  if (!origin) throw new BikeShopDirectoryError('Choose a valid starting location.', 400);
  if (!Number.isInteger(radiusMiles)
    || radiusMiles < minimumRadiusMiles
    || radiusMiles > maximumRadiusMiles
    || radiusMiles % 5 !== 0) {
    throw new BikeShopDirectoryError('Choose a search radius from 5 to 50 miles.', 400);
  }
  const response = await fetcher('/api/bike-shops/nearby', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      latitude: origin.latitude,
      longitude: origin.longitude,
      radiusMiles,
    }),
    ...(signal ? { signal } : {}),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new BikeShopDirectoryError(
      cleanText(payload.error, 240) || `The bike shop directory returned ${response.status}.`,
      response.status,
    );
  }
  return normalizeDirectoryResponse(payload, { ...origin, radiusMiles });
}

function normalizeBikeShopViewport(viewport: BikeShopViewport) {
  const north = finiteNumber(viewport.north);
  const south = finiteNumber(viewport.south);
  const east = finiteNumber(viewport.east);
  const west = finiteNumber(viewport.west);
  const zoom = finiteNumber(viewport.zoom);
  if (
    north === null || north < -90 || north > 90
    || south === null || south < -90 || south > 90
    || north <= south
    || east === null || east < -180 || east > 180
    || west === null || west < -180 || west > 180
    || zoom === null || zoom < 0 || zoom > 24
  ) {
    throw new BikeShopDirectoryError('Move or zoom the map to choose a valid search area.', 400);
  }
  return {
    north,
    south,
    east,
    west,
    zoom: Math.round(zoom * 10) / 10,
  } satisfies BikeShopViewport;
}

export async function searchBikeShopsInViewport(
  requestedViewport: BikeShopViewport,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  const viewport = normalizeBikeShopViewport(requestedViewport);
  const response = await fetcher('/api/bike-shops/viewport', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(viewport),
    ...(signal ? { signal } : {}),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new BikeShopDirectoryError(
      cleanText(payload.error, 240) || `The bike shop directory returned ${response.status}.`,
      response.status,
    );
  }
  const attribution = normalizeAttribution(payload.attribution);
  return {
    viewport,
    shops: normalizeShops(payload.shops, maximumViewportResponseShops),
    attribution,
    attributions: normalizeAttributions(payload.attributions, attribution),
    truncated: payload.truncated === true,
    degraded: payload.degraded === true,
    notice: cleanText(payload.notice, 240),
  } satisfies BikeShopViewportResponse;
}

export function distanceBetweenMiles(from: BikeShopPoint, to: BikeShopPoint) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const startLatitude = radians(from.latitude);
  const endLatitude = radians(to.latitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function trackPoint(track: TrackRecord | TrackLocatorRecord): BikeShopPoint | null {
  const direct = validPoint(track);
  if (direct) return direct;
  if (!('outline' in track) || !Array.isArray(track.outline) || track.outline.length === 0) return null;
  const valid = track.outline.filter((point) => (
    Number.isFinite(point.lat) && Math.abs(point.lat) <= 90
    && Number.isFinite(point.lng) && Math.abs(point.lng) <= 180
  ));
  if (valid.length === 0) return null;
  return {
    latitude: valid.reduce((sum, point) => sum + point.lat, 0) / valid.length,
    longitude: valid.reduce((sum, point) => sum + point.lng, 0) / valid.length,
  };
}

export function nearbyTracksForShop(
  shop: Pick<BikeShopRecord, 'latitude' | 'longitude'>,
  tracks: ReadonlyArray<TrackRecord | TrackLocatorRecord>,
  maximumMiles = maximumRadiusMiles,
) {
  const origin = validPoint(shop);
  if (!origin) return [];
  return tracks
    .map((track) => {
      const point = trackPoint(track);
      return point ? { track, distanceMiles: distanceBetweenMiles(origin, point) } : null;
    })
    .filter((entry): entry is NearbyBikeShopTrack => Boolean(entry && entry.distanceMiles <= maximumMiles))
    .sort((left, right) => left.distanceMiles - right.distanceMiles || left.track.name.localeCompare(right.track.name));
}

export function bikeShopAddress(shop: BikeShopRecord) {
  return shop.address.formatted
    || [shop.address.line1, shop.address.locality, shop.address.region, shop.address.postalCode]
      .filter(Boolean)
      .join(', ')
    || `${shop.latitude.toFixed(5)}, ${shop.longitude.toFixed(5)}`;
}
