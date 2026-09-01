const milesToMeters = 1609.344;
const defaultEndpoints = Object.freeze([
  'https://overpass-api.de/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
]);

export const bikeShopSearchLimits = Object.freeze({
  minimumRadiusMiles: 5,
  maximumRadiusMiles: 50,
  maximumResults: 100,
  maximumUpstreamBytes: 2 * 1024 * 1024,
  upstreamTimeoutMs: 12_000,
  upstreamAttemptTimeoutMs: 7_000,
  upstreamFailureCooldownMs: 2 * 60 * 1000,
  cacheTtlMs: 15 * 60 * 1000,
  staleCacheTtlMs: 30 * 24 * 60 * 60 * 1000,
  degradedCacheTtlMs: 2 * 60 * 1000,
  catalogLiveWaitMs: 900,
  maximumCacheEntries: 256,
  maximumSearchCachedCandidates: 100,
  maximumSearchCacheBytesPerEntry: 256 * 1024,
  maximumSearchCacheBytes: 12 * 1024 * 1024,
  maximumViewportCacheEntries: 32,
  maximumViewportCachedCandidates: 500,
  maximumViewportCacheBytesPerEntry: 512 * 1024,
  maximumConcurrentUpstreamRequests: 4,
  minimumViewportZoom: 11,
  maximumViewportZoom: 22,
  maximumViewportLatitudeSpan: 1.5,
  maximumViewportLongitudeSpan: 2,
  maximumViewportArea: 3,
  maximumViewportDiagonalMiles: 100,
});

const maximumWebMercatorLatitude = 85.051129;

function finiteNumber(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function parseBikeShopSearch(input) {
  const latitude = finiteNumber(input?.latitude ?? input?.lat);
  const longitude = finiteNumber(input?.longitude ?? input?.lng);
  const radiusMiles = finiteNumber(input?.radiusMiles ?? input?.radius);
  if (latitude === null || latitude < -90 || latitude > 90) {
    throw new RangeError('latitude must be a number between -90 and 90.');
  }
  if (longitude === null || longitude < -180 || longitude > 180) {
    throw new RangeError('longitude must be a number between -180 and 180.');
  }
  if (
    radiusMiles === null
    || radiusMiles < bikeShopSearchLimits.minimumRadiusMiles
    || radiusMiles > bikeShopSearchLimits.maximumRadiusMiles
    || !Number.isInteger(radiusMiles)
    || radiusMiles % 5 !== 0
  ) {
    throw new RangeError('radiusMiles must be 5, 10, 15, 20, 25, 30, 35, 40, 45, or 50.');
  }
  return { latitude, longitude, radiusMiles };
}

function strictJsonNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function longitudeSpan(west, east) {
  return west < east ? east - west : (180 - west) + (east + 180);
}

export function parseBikeShopViewport(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new RangeError('A viewport object is required.');
  }
  const north = strictJsonNumber(input.north);
  const south = strictJsonNumber(input.south);
  const east = strictJsonNumber(input.east);
  const west = strictJsonNumber(input.west);
  const zoom = strictJsonNumber(input.zoom);
  if (
    north === null || south === null
    || north > maximumWebMercatorLatitude || north < -maximumWebMercatorLatitude
    || south > maximumWebMercatorLatitude || south < -maximumWebMercatorLatitude
    || north <= south
  ) throw new RangeError('north and south must define a valid Web Mercator latitude span.');
  if (
    east === null || west === null
    || east < -180 || east > 180 || west < -180 || west > 180
    || east === west
  ) throw new RangeError('east and west must define a valid longitude span.');
  if (
    zoom === null
    || zoom < bikeShopSearchLimits.minimumViewportZoom
    || zoom > bikeShopSearchLimits.maximumViewportZoom
  ) {
    throw new RangeError(
      `zoom must be between ${bikeShopSearchLimits.minimumViewportZoom} and ${bikeShopSearchLimits.maximumViewportZoom}.`,
    );
  }
  const latitudeSpan = north - south;
  const viewportLongitudeSpan = longitudeSpan(west, east);
  const diagonalMiles = distanceMiles(
    { latitude: south, longitude: west },
    { latitude: north, longitude: east },
  );
  if (
    viewportLongitudeSpan <= 0
    || latitudeSpan > bikeShopSearchLimits.maximumViewportLatitudeSpan
    || viewportLongitudeSpan > bikeShopSearchLimits.maximumViewportLongitudeSpan
    || latitudeSpan * viewportLongitudeSpan > bikeShopSearchLimits.maximumViewportArea
    || diagonalMiles > bikeShopSearchLimits.maximumViewportDiagonalMiles
  ) throw new RangeError('The map area is too large. Zoom in before searching this viewport.');
  return { north, south, east, west, zoom };
}

const claimantRoles = new Set(['owner', 'manager', 'authorized-representative']);
const verificationMethods = new Set(['business-email', 'business-phone', 'documentation']);

export function parseBikeShopClaimRequest(input) {
  const shop = input?.shop && typeof input.shop === 'object' ? input.shop : {};
  const osmMatch = /^osm:(node|way|relation):([1-9][0-9]{0,30})$/u.exec(String(shop.id || ''));
  const overtureMatch = /^overture:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/iu.exec(String(shop.id || ''));
  if (!osmMatch && !overtureMatch) throw new RangeError('A valid directory bike shop ID is required.');
  const claimantRole = safeText(input?.claimantRole, 40);
  const verificationMethod = safeText(input?.verificationMethod, 40);
  if (!claimantRoles.has(claimantRole)) throw new RangeError('claimantRole is invalid.');
  if (!verificationMethods.has(verificationMethod)) throw new RangeError('verificationMethod is invalid.');
  const businessEmail = safeText(input?.businessEmail, 254).toLowerCase();
  const businessPhone = safeText(input?.businessPhone, 80);
  const verificationNote = safeText(input?.verificationNote, 1000);
  if (verificationMethod === 'business-email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(businessEmail)) {
    throw new RangeError('A valid businessEmail is required for email verification.');
  }
  if (verificationMethod === 'business-phone' && businessPhone.replace(/\D/g, '').length < 7) {
    throw new RangeError('A valid businessPhone is required for phone verification.');
  }
  if (verificationMethod === 'documentation' && verificationNote.length < 20) {
    throw new RangeError('Describe the ownership documentation in verificationNote.');
  }
  return {
    source: osmMatch ? 'openstreetmap' : 'overture',
    osmElementType: osmMatch ? osmMatch[1] : 'place',
    osmElementId: osmMatch ? osmMatch[2] : overtureMatch[1].toLowerCase(),
    claimantRole,
    verificationMethod,
    businessEmail,
    businessPhone,
    verificationNote,
  };
}

function safeText(value, maximumLength = 240) {
  return typeof value === 'string' ? value.trim().slice(0, maximumLength) : '';
}

function osmElementPoint(element) {
  const latitude = finiteNumber(element?.lat ?? element?.center?.lat);
  const longitude = finiteNumber(element?.lon ?? element?.center?.lon);
  return latitude === null || longitude === null ? null : { latitude, longitude };
}

function distanceMiles(from, to) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const startLatitude = radians(from.latitude);
  const endLatitude = radians(to.latitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function addressFromTags(tags) {
  const line = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  const locality = tags['addr:city']
    || tags['addr:town']
    || tags['addr:village']
    || tags['is_in:city']
    || tags['is_in:town'];
  const region = tags['addr:state']
    || tags['addr:province']
    || tags['is_in:state']
    || tags['is_in:province'];
  const countryCode = [
    tags['addr:country'],
    tags['is_in:country_code'],
    tags['ISO3166-1:alpha2'],
  ].map((value) => safeText(value, 8).toUpperCase())
    .find((value) => /^[A-Z]{2}$/u.test(value)) || '';
  return {
    line1: safeText(line),
    locality: safeText(locality),
    region: safeText(region),
    postalCode: safeText(tags['addr:postcode'], 40),
    countryCode,
    formatted: safeText([line, locality, region, tags['addr:postcode']].filter(Boolean).join(', ')),
  };
}

function tagsDescribeBikeShop(tags) {
  return tags?.shop === 'bicycle'
    || ['yes', 'only'].includes(tags?.['service:bicycle:repair']);
}

function googleLinks(shop) {
  const coordinates = `${shop.latitude},${shop.longitude}`;
  return {
    maps: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${shop.name} ${coordinates}`)}`,
    directions: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(coordinates)}`,
    streetView: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${encodeURIComponent(coordinates)}`,
  };
}

function normalizeOverpassBikeShopCandidates(payload) {
  const shops = [];
  const seen = new Set();
  for (const element of Array.isArray(payload?.elements) ? payload.elements : []) {
    const tags = element?.tags && typeof element.tags === 'object' ? element.tags : {};
    const point = osmElementPoint(element);
    // Match the persisted claim schema limit so a valid canonical listing can
    // never turn into a misleading storage-outage response at claim time.
    const name = safeText(tags.name || tags.brand || 'Bike shop', 180);
    const elementType = safeText(element?.type, 16);
    const elementId = String(element?.id ?? '');
    if (
      !point
      || !tagsDescribeBikeShop(tags)
      || point.latitude < -90 || point.latitude > 90
      || point.longitude < -180 || point.longitude > 180
      || !['node', 'way', 'relation'].includes(elementType)
      || !/^[1-9][0-9]{0,30}$/u.test(elementId)
    ) continue;
    const sourceId = `${elementType}:${elementId}`;
    if (seen.has(sourceId)) continue;
    seen.add(sourceId);
    const shop = {
      id: `osm:${sourceId}`,
      name,
      latitude: point.latitude,
      longitude: point.longitude,
      address: addressFromTags(tags),
      phone: safeText(tags.phone || tags['contact:phone'], 80),
      website: safeText(tags.website || tags['contact:website'], 500),
      openingHours: safeText(tags.opening_hours, 300),
      services: {
        sales: tags.shop === 'bicycle',
        repair: ['yes', 'only'].includes(tags['service:bicycle:repair']),
        rental: tags['service:bicycle:rental'] === 'yes' || tags.rental === 'bicycle',
        ebike: tags['service:bicycle:ebike'] === 'yes',
      },
      source: {
        provider: 'OpenStreetMap',
        elementType,
        elementId,
        url: `https://www.openstreetmap.org/${encodeURIComponent(elementType)}/${encodeURIComponent(elementId)}`,
        provenance: ['OpenStreetMap'],
      },
    };
    shops.push({ ...shop, links: googleLinks(shop) });
  }
  return shops;
}

function bikeShopCandidatesForOrigin(candidates, origin, maximumResults = bikeShopSearchLimits.maximumResults) {
  const radiusMiles = finiteNumber(origin?.radiusMiles);
  return candidates.map((shop) => ({ shop, exactDistanceMiles: distanceMiles(origin, shop) }))
    .filter(({ exactDistanceMiles }) => radiusMiles === null || exactDistanceMiles <= radiusMiles)
    .sort((a, b) => (
      a.exactDistanceMiles - b.exactDistanceMiles
      || a.shop.name.localeCompare(b.shop.name)
    ))
    .slice(0, maximumResults)
    .map(({ shop, exactDistanceMiles }) => ({
      ...shop,
      distanceMiles: Math.round(exactDistanceMiles * 10) / 10,
    }));
}

function viewportContains(viewport, shop) {
  const latitudeInside = shop.latitude >= viewport.south && shop.latitude <= viewport.north;
  const longitudeInside = viewport.west < viewport.east
    ? shop.longitude >= viewport.west && shop.longitude <= viewport.east
    : shop.longitude >= viewport.west || shop.longitude <= viewport.east;
  return latitudeInside && longitudeInside;
}

function viewportCenter(viewport) {
  const span = longitudeSpan(viewport.west, viewport.east);
  let longitude = viewport.west + span / 2;
  if (longitude > 180) longitude -= 360;
  return {
    latitude: (viewport.north + viewport.south) / 2,
    longitude,
  };
}

function bikeShopCandidatesForViewport(
  candidates,
  viewport,
  maximumResults = bikeShopSearchLimits.maximumResults,
) {
  const center = viewportCenter(viewport);
  const matches = candidates
    .filter((shop) => viewportContains(viewport, shop))
    .map((shop) => ({ shop, exactDistanceMiles: distanceMiles(center, shop) }))
    .sort((a, b) => (
      a.exactDistanceMiles - b.exactDistanceMiles
      || a.shop.name.localeCompare(b.shop.name)
      || a.shop.id.localeCompare(b.shop.id)
    ));
  return {
    shops: matches.slice(0, maximumResults).map(({ shop }) => shop),
    truncated: matches.length > maximumResults,
  };
}

export function normalizeOverpassBikeShops(payload, origin, maximumResults = bikeShopSearchLimits.maximumResults) {
  return bikeShopCandidatesForOrigin(normalizeOverpassBikeShopCandidates(payload), origin, maximumResults);
}

export function applyApprovedBikeShopClaims(shops, approvedClaims) {
  const approvedKeys = new Set((Array.isArray(approvedClaims) ? approvedClaims : []).map((claim) => (
    `${String(claim?.source || '')}:${String(claim?.osmElementType || '')}:${String(claim?.osmElementId || '')}`
  )));
  return (Array.isArray(shops) ? shops : []).map((shop) => {
    return {
      ...shop,
      claimed: bikeShopClaimIdentities(shop).some((identity) => approvedKeys.has(
        `${identity.source}:${identity.osmElementType}:${identity.osmElementId}`,
      )),
    };
  });
}

export function bikeShopClaimIdentity(shop) {
  return bikeShopClaimIdentityFromSource(shop?.source);
}

function bikeShopClaimIdentityFromSource(sourceRecord) {
  const source = sourceRecord?.provider === 'Overture Maps'
    ? 'overture'
    : sourceRecord?.provider === 'OpenStreetMap'
      ? 'openstreetmap'
      : '';
  return {
    source,
    osmElementType: safeText(sourceRecord?.elementType, 16),
    osmElementId: safeText(sourceRecord?.elementId, 80),
  };
}

function validBikeShopClaimIdentity(identity) {
  return (
    identity?.source === 'openstreetmap'
    && ['node', 'way', 'relation'].includes(identity?.osmElementType)
    && /^[1-9][0-9]{0,30}$/u.test(String(identity?.osmElementId || ''))
  ) || (
    identity?.source === 'overture'
    && identity?.osmElementType === 'place'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      String(identity?.osmElementId || ''),
    )
  );
}

export function bikeShopClaimIdentities(shop) {
  const rawSources = [shop?.source, ...(Array.isArray(shop?.source?.aliases) ? shop.source.aliases : [])];
  const byKey = new Map();
  for (const rawSource of rawSources) {
    const identity = bikeShopClaimIdentityFromSource(rawSource);
    if (!validBikeShopClaimIdentity(identity)) continue;
    const key = `${identity.source}:${identity.osmElementType}:${identity.osmElementId}`;
    if (!byKey.has(key)) byKey.set(key, identity);
  }
  return [...byKey.values()];
}

export async function applyApprovedBikeShopClaimsBestEffort(
  shops,
  loadApprovedClaims,
  onLookupError = () => {},
) {
  const publicShops = Array.isArray(shops) ? shops : [];
  try {
    const approvedClaims = await loadApprovedClaims(publicShops.flatMap(bikeShopClaimIdentities));
    return applyApprovedBikeShopClaims(publicShops, approvedClaims);
  } catch (error) {
    try {
      onLookupError(error);
    } catch {
      // Diagnostics are best effort and cannot become a directory dependency.
    }
    // Claim badges are optional public metadata. A database outage must not
    // hide the durable shop directory, and an unverifiable badge must never be
    // carried forward as though it were current.
    return publicShops.map((shop) => ({ ...shop, claimed: false }));
  }
}

export function canonicalBikeShopClaimCandidate(candidate, canonicalShop) {
  const claimAliases = bikeShopClaimIdentities(canonicalShop);
  const candidateMatchesCanonicalIdentity = claimAliases.some((identity) => (
    identity.source === candidate?.source
    && identity.osmElementType === candidate?.osmElementType
    && identity.osmElementId === candidate?.osmElementId
  ));
  if (
    !['openstreetmap', 'overture'].includes(candidate?.source)
    || !candidateMatchesCanonicalIdentity
  ) {
    throw new RangeError('The bike shop directory listing could not be verified.');
  }
  return {
    ...candidate,
    shopName: canonicalShop.name,
    latitude: canonicalShop.latitude,
    longitude: canonicalShop.longitude,
    shopSnapshot: {
      id: canonicalShop.id,
      name: canonicalShop.name,
      address: canonicalShop.address,
      phone: canonicalShop.phone,
      website: canonicalShop.website,
      openingHours: canonicalShop.openingHours,
      services: canonicalShop.services,
      source: canonicalShop.source,
    },
    claimAliases,
  };
}

export function createBikeShopDirectory(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const configuredEndpoints = Array.isArray(options.endpoints)
    ? options.endpoints
    : options.endpoint
      ? [options.endpoint]
      : defaultEndpoints;
  const endpoints = [...new Set(configuredEndpoints
    .map((value) => safeText(value, 500))
    .filter((value) => (
      /^https:\/\//u.test(value)
      || /^http:\/\/(?:127(?:\.[0-9]{1,3}){3}|localhost|\[::1\])(?::[0-9]{1,5})?(?:\/|$)/iu.test(value)
    )))];
  if (endpoints.length === 0) throw new Error('At least one secure OpenStreetMap directory endpoint is required.');
  const now = options.now ?? Date.now;
  const loadPersistedForSearch = typeof options.loadSearch === 'function' ? options.loadSearch : null;
  const loadPersistedForViewport = typeof options.loadViewport === 'function' ? options.loadViewport : null;
  const savePersistedShops = typeof options.saveShops === 'function' ? options.saveShops : null;
  const resolveCatalogShop = typeof options.resolveCatalogShop === 'function'
    ? options.resolveCatalogShop
    : null;
  const cache = new Map();
  const viewportCache = new Map();
  const inFlight = new Map();
  const endpointRetryAt = new Map();
  let cacheBytes = 0;
  let activeUpstreamRequests = 0;

  const attribution = Object.freeze({
    text: '© OpenStreetMap contributors',
    url: 'https://www.openstreetmap.org/copyright',
    license: 'ODbL',
  });
  const catalogAttribution = Object.freeze({
    text: 'Overture Maps Foundation',
    url: 'https://docs.overturemaps.org/attribution/',
    license: 'CDLA-Permissive-2.0 and compatible source licenses',
  });
  const attributions = Object.freeze([
    ...(loadPersistedForSearch || loadPersistedForViewport ? [catalogAttribution] : []),
    attribution,
  ]);
  const degradedNotice = 'Showing recently known listings while the live open directory refresh is unavailable.';

  function semanticShopName(value) {
    return safeText(value, 180)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/gu, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  }

  function combineDuplicateShop(fallback, preferred) {
    // Keep one complete source record instead of producing a field-level
    // derivative across independently licensed catalogs. The durable Overture
    // catalog is canonical whenever it is present; live OpenStreetMap remains
    // a claim identity alias and provenance source. OSM-only listings remain
    // canonical OSM records.
    const canonical = fallback?.source?.provider === 'Overture Maps'
      ? fallback
      : preferred?.source?.provider === 'Overture Maps'
        ? preferred
        : preferred;
    const alternate = canonical === fallback ? preferred : fallback;
    const canonicalIdentity = bikeShopClaimIdentity(canonical);
    const aliases = new Map();
    for (const sourceRecord of [
      alternate?.source,
      ...(Array.isArray(alternate?.source?.aliases) ? alternate.source.aliases : []),
      ...(Array.isArray(canonical?.source?.aliases) ? canonical.source.aliases : []),
    ]) {
      const identity = bikeShopClaimIdentityFromSource(sourceRecord);
      if (!validBikeShopClaimIdentity(identity)) continue;
      if (
        identity.source === canonicalIdentity.source
        && identity.osmElementType === canonicalIdentity.osmElementType
        && identity.osmElementId === canonicalIdentity.osmElementId
      ) continue;
      const key = `${identity.source}:${identity.osmElementType}:${identity.osmElementId}`;
      aliases.set(key, {
        provider: sourceRecord.provider,
        elementType: sourceRecord.elementType,
        elementId: sourceRecord.elementId,
        url: sourceRecord.url,
      });
    }
    return {
      ...canonical,
      source: {
        ...(canonical.source ?? {}),
        provenance: [...new Set([
          ...(Array.isArray(fallback.source?.provenance)
            ? fallback.source.provenance
            : [fallback.source?.provider]),
          ...(Array.isArray(preferred.source?.provenance)
            ? preferred.source.provenance
            : [preferred.source?.provider]),
        ].filter(Boolean))],
        catalogProvenance: [...new Set([
          ...(Array.isArray(fallback.source?.catalogProvenance)
            ? fallback.source.catalogProvenance
            : []),
          ...(Array.isArray(preferred.source?.catalogProvenance)
            ? preferred.source.catalogProvenance
            : []),
        ].filter(Boolean))],
        aliases: [...aliases.values()].slice(0, 16),
      },
    };
  }

  function mergeShops(...groups) {
    const merged = [];
    const indexById = new Map();
    const indexesByNameAndCell = new Map();
    const duplicateDistanceMiles = 50 / milesToMeters;

    function spatialPoint(shop) {
      const latitude = Number(shop?.latitude) * Math.PI / 180;
      const longitude = Number(shop?.longitude) * Math.PI / 180;
      const radius = 3958.7613;
      const latitudeCosine = Math.cos(latitude);
      return {
        x: radius * latitudeCosine * Math.cos(longitude),
        y: radius * latitudeCosine * Math.sin(longitude),
        z: radius * Math.sin(latitude),
      };
    }

    function spatialCell(point) {
      return `${Math.floor(point.x / duplicateDistanceMiles)}:${Math.floor(point.y / duplicateDistanceMiles)}:${Math.floor(point.z / duplicateDistanceMiles)}`;
    }

    function spatialKeys(shop) {
      const point = spatialPoint(shop);
      const x = Math.floor(point.x / duplicateDistanceMiles);
      const y = Math.floor(point.y / duplicateDistanceMiles);
      const z = Math.floor(point.z / duplicateDistanceMiles);
      const keys = [];
      for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
        for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
          for (let zOffset = -1; zOffset <= 1; zOffset += 1) {
            keys.push(`${x + xOffset}:${y + yOffset}:${z + zOffset}`);
          }
        }
      }
      return keys;
    }

    function indexShop(shop, index) {
      indexById.set(shop.id, index);
      const name = semanticShopName(shop.name);
      if (!name) return;
      const cell = spatialCell(spatialPoint(shop));
      const cellMap = indexesByNameAndCell.get(name) ?? new Map();
      const indexes = cellMap.get(cell) ?? new Set();
      indexes.add(index);
      cellMap.set(cell, indexes);
      indexesByNameAndCell.set(name, cellMap);
    }

    function unindexShop(shop, index) {
      if (indexById.get(shop.id) === index) indexById.delete(shop.id);
      const name = semanticShopName(shop.name);
      const cellMap = indexesByNameAndCell.get(name);
      if (!cellMap) return;
      const cell = spatialCell(spatialPoint(shop));
      const indexes = cellMap.get(cell);
      indexes?.delete(index);
      if (indexes?.size === 0) cellMap.delete(cell);
      if (cellMap.size === 0) indexesByNameAndCell.delete(name);
    }

    function semanticDuplicateIndex(shop) {
      const name = semanticShopName(shop.name);
      const cellMap = indexesByNameAndCell.get(name);
      if (!name || !cellMap) return -1;
      for (const key of spatialKeys(shop)) {
        for (const index of cellMap.get(key) ?? []) {
          if (distanceMiles(merged[index], shop) <= duplicateDistanceMiles) return index;
        }
      }
      return -1;
    }

    function replaceShop(index, shop) {
      unindexShop(merged[index], index);
      merged[index] = shop;
      indexShop(shop, index);
    }

    for (const group of groups) {
      for (const shop of Array.isArray(group) ? group : []) {
        if (!shop?.id) continue;
        const byId = indexById.get(shop.id);
        if (byId !== undefined) {
          replaceShop(byId, combineDuplicateShop(merged[byId], shop));
          continue;
        }
        const semanticDuplicate = semanticDuplicateIndex(shop);
        if (semanticDuplicate >= 0) {
          // Exact-name listings within 50 m retain the durable catalog identity
          // while the alternate source remains an independently claimable alias.
          replaceShop(
            semanticDuplicate,
            combineDuplicateShop(merged[semanticDuplicate], shop),
          );
        } else {
          const index = merged.length;
          merged.push(shop);
          indexShop(shop, index);
        }
      }
    }
    return merged;
  }

  async function safelyLoadPersisted(loader, input) {
    if (!loader) return [];
    try {
      const shops = await loader(input);
      return Array.isArray(shops) ? shops : [];
    } catch {
      // Directory cache storage is an availability aid. A cache outage must
      // never turn a healthy live OpenStreetMap response into a public error.
      return [];
    }
  }

  async function safelySavePersisted(shops) {
    if (!savePersistedShops || shops.length === 0) return;
    try {
      await savePersistedShops(shops);
    } catch {
      // Best-effort cache write; the live response remains authoritative.
    }
  }

  async function liveResultOrCatalogFallback(persisted, loadLive, acceptBackgroundResult) {
    const livePromise = loadLive();
    if (persisted.length === 0) return { live: await livePromise, fellBack: false };
    const timeoutToken = Symbol('catalog-fallback');
    let timeout;
    const budget = Math.max(
      25,
      Math.min(2_000, Number(options.catalogLiveWaitMs) || bikeShopSearchLimits.catalogLiveWaitMs),
    );
    const settled = await Promise.race([
      livePromise.then((live) => ({ live })).catch((error) => ({ error })),
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve(timeoutToken), budget);
        timeout.unref?.();
      }),
    ]);
    if (timeout) clearTimeout(timeout);
    if (settled === timeoutToken) {
      // The bundled catalog is immediately useful. Complete live OSM
      // enrichment in the background so a slow public mirror never blocks the
      // directory while later requests still benefit from community updates.
      void livePromise.then(acceptBackgroundResult).catch(() => {});
      return { live: [], fellBack: true };
    }
    if (settled.error) return { live: [], fellBack: true };
    return { live: settled.live, fellBack: false };
  }

  function cacheKey(search) {
    // Keep the exact caller origin in the key. Reusing a nearby caller's
    // Overpass circle can omit shops that sit on the new circle's boundary.
    return `search:${search.latitude}:${search.longitude}:${search.radiusMiles}`;
  }

  function viewportCacheEnvelope(viewport) {
    const grid = 100;
    const down = (value) => Number((Math.floor(value * grid) / grid).toFixed(2));
    const up = (value) => Number((Math.ceil(value * grid) / grid).toFixed(2));
    // Query an outward-rounded envelope and cache that envelope, never the first
    // request's exact box. Nearby viewports can then safely reuse the candidate
    // set while responseForViewport still applies their exact requested bounds.
    return {
      north: up(viewport.north),
      south: down(viewport.south),
      east: up(viewport.east),
      west: down(viewport.west),
    };
  }

  function viewportCacheKey(envelope) {
    return `viewport:${envelope.north}:${envelope.south}:${envelope.east}:${envelope.west}`;
  }

  function deleteCacheEntry(key) {
    const entry = cache.get(key);
    if (!entry) return false;
    cache.delete(key);
    cacheBytes = Math.max(0, cacheBytes - (Number(entry.serializedBytes) || 0));
    return true;
  }

  function pruneCache() {
    const timestamp = now();
    for (const [key, entry] of cache) if (entry.staleAt <= timestamp) deleteCacheEntry(key);
    for (const [key, entry] of viewportCache) {
      if (entry.staleAt <= timestamp) viewportCache.delete(key);
    }
    while (
      cache.size > bikeShopSearchLimits.maximumCacheEntries
      || cacheBytes > bikeShopSearchLimits.maximumSearchCacheBytes
    ) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey === undefined || !deleteCacheEntry(oldestKey)) {
        cacheBytes = 0;
        break;
      }
    }
    while (viewportCache.size > bikeShopSearchLimits.maximumViewportCacheEntries) {
      viewportCache.delete(viewportCache.keys().next().value);
    }
  }

  function setCacheEntry(key, value, expiresAt, staleAt) {
    let serializedBytes;
    try {
      serializedBytes = Buffer.byteLength(JSON.stringify(value));
    } catch {
      return value;
    }
    if (serializedBytes > bikeShopSearchLimits.maximumSearchCacheBytesPerEntry) return value;
    deleteCacheEntry(key);
    cache.set(key, { value, expiresAt, staleAt, serializedBytes });
    cacheBytes += serializedBytes;
    pruneCache();
    return value;
  }

  async function readBoundedJson(response) {
    const declaredLength = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > bikeShopSearchLimits.maximumUpstreamBytes) {
      throw new Error('OpenStreetMap directory response exceeded the size limit.');
    }
    if (!response.body?.getReader) return response.json();
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += chunk.value.byteLength;
      if (received > bikeShopSearchLimits.maximumUpstreamBytes) {
        await reader.cancel();
        throw new Error('OpenStreetMap directory response exceeded the size limit.');
      }
      chunks.push(chunk.value);
    }
    const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
    return JSON.parse(body);
  }

  async function fetchOverpass(query) {
    if (activeUpstreamRequests >= bikeShopSearchLimits.maximumConcurrentUpstreamRequests) {
      const error = new Error('The open bike shop directory is busy. Please retry shortly.');
      error.code = 'OVERPASS_BUSY';
      error.retryAfterSeconds = 3;
      throw error;
    }
    activeUpstreamRequests += 1;
    try {
      const timestamp = now();
      const eligible = endpoints.filter((endpoint) => (endpointRetryAt.get(endpoint) ?? 0) <= timestamp);
      if (eligible.length === 0) {
        const earliestRetryAt = Math.min(...endpoints.map((endpoint) => endpointRetryAt.get(endpoint) ?? timestamp));
        const error = new Error('OpenStreetMap directory mirrors are cooling down after recent failures.');
        error.code = 'OVERPASS_COOLDOWN';
        error.retryAfterSeconds = Math.max(1, Math.ceil((earliestRetryAt - timestamp) / 1000));
        throw error;
      }
      const orderedEndpoints = eligible;
      let lastError = null;
      for (const endpoint of orderedEndpoints) {
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          Number(options.upstreamAttemptTimeoutMs) || bikeShopSearchLimits.upstreamAttemptTimeoutMs,
        );
        try {
          const upstream = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'User-Agent': 'TrackLabBMX/1.0 https://tracklab-bmx.onrender.com https://github.com/preskiranch/tracklab-bmx',
          },
          body: new URLSearchParams({ data: query }),
          signal: controller.signal,
          });
          if (!upstream?.ok) {
            throw new Error(`OpenStreetMap directory request failed (${upstream?.status || 503}).`);
          }
          const payload = await readBoundedJson(upstream);
          endpointRetryAt.delete(endpoint);
          return payload;
        } catch (error) {
          lastError = error;
          endpointRetryAt.set(
            endpoint,
            now() + bikeShopSearchLimits.upstreamFailureCooldownMs,
          );
        } finally {
          clearTimeout(timeout);
        }
      }
      throw lastError ?? new Error('The OpenStreetMap directory is unavailable.');
    } finally {
      activeUpstreamRequests -= 1;
    }
  }

  async function loadSearch(search, key) {
    // The upstream circle must never be smaller than the requested radius.
    // Exact post-filtering below removes any sub-meter overfetch.
    const radiusMeters = Math.ceil(search.radiusMiles * milesToMeters);
    const query = `[out:json][timeout:10];(nwr["shop"="bicycle"](around:${radiusMeters},${search.latitude},${search.longitude});nwr["service:bicycle:repair"~"^(yes|only)$"](around:${radiusMeters},${search.latitude},${search.longitude}););out center tags;`;
    const persisted = loadPersistedForSearch
      ? await safelyLoadPersisted(loadPersistedForSearch, search)
      : [];
    const exactSearchValue = (shops, extra = {}) => ({
      shops: bikeShopCandidatesForOrigin(
        shops,
        search,
        bikeShopSearchLimits.maximumSearchCachedCandidates,
      ),
      attribution,
      attributions,
      ...extra,
    });
    const cacheExactSearchValue = (value, ttlMs) => {
      const timestamp = now();
      return setCacheEntry(
        key,
        value,
        timestamp + ttlMs,
        timestamp + bikeShopSearchLimits.staleCacheTtlMs,
      );
    };
    const cacheSuccessfulValue = async (live) => {
      await safelySavePersisted(live);
      return cacheExactSearchValue(
        exactSearchValue(mergeShops(persisted, live)),
        bikeShopSearchLimits.cacheTtlMs,
      );
    };
    try {
      const result = await liveResultOrCatalogFallback(
        persisted,
        async () => normalizeOverpassBikeShopCandidates(await fetchOverpass(query)),
        cacheSuccessfulValue,
      );
      if (!result.fellBack) return cacheSuccessfulValue(result.live);
      const value = exactSearchValue(persisted, {
        degraded: true,
        notice: degradedNotice,
      });
      return cacheExactSearchValue(value, bikeShopSearchLimits.degradedCacheTtlMs);
    } catch (error) {
      if (persisted.length === 0) throw error;
      const value = exactSearchValue(persisted, {
        degraded: true,
        notice: degradedNotice,
      });
      return cacheExactSearchValue(value, bikeShopSearchLimits.degradedCacheTtlMs);
    }
  }

  function overpassViewportClauses(viewport) {
    const boxes = viewport.west < viewport.east
      ? [[viewport.south, viewport.west, viewport.north, viewport.east]]
      : [
        [viewport.south, viewport.west, viewport.north, 180],
        [viewport.south, -180, viewport.north, viewport.east],
      ];
    return boxes.flatMap((box) => {
      const bounds = box.join(',');
      return [
        `nwr["shop"="bicycle"](${bounds});`,
        `nwr["service:bicycle:repair"~"^(yes|only)$"](${bounds});`,
      ];
    }).join('');
  }

  async function loadViewport(viewport, key) {
    const query = `[out:json][timeout:10];(${overpassViewportClauses(viewport)});out center tags;`;
    const persisted = loadPersistedForViewport
      ? await safelyLoadPersisted(loadPersistedForViewport, viewport)
      : [];
    const cacheViewportValue = (value) => {
      const serializedBytes = Buffer.byteLength(JSON.stringify(value));
      if (
        value.shops.length > bikeShopSearchLimits.maximumViewportCachedCandidates
        || serializedBytes > bikeShopSearchLimits.maximumViewportCacheBytesPerEntry
      ) return value;
      const timestamp = now();
      viewportCache.set(key, {
        value,
        expiresAt: timestamp + (value.degraded
          ? bikeShopSearchLimits.degradedCacheTtlMs
          : bikeShopSearchLimits.cacheTtlMs),
        staleAt: timestamp + bikeShopSearchLimits.staleCacheTtlMs,
      });
      pruneCache();
      return value;
    };
    const cacheSuccessfulValue = async (live) => {
      await safelySavePersisted(live);
      return cacheViewportValue({ shops: mergeShops(persisted, live), attribution, attributions });
    };
    try {
      const result = await liveResultOrCatalogFallback(
        persisted,
        async () => normalizeOverpassBikeShopCandidates(await fetchOverpass(query)),
        cacheSuccessfulValue,
      );
      if (!result.fellBack) return cacheSuccessfulValue(result.live);
      return cacheViewportValue({
        shops: persisted,
        attribution,
        attributions,
        degraded: true,
        notice: degradedNotice,
      });
    } catch (error) {
      if (persisted.length === 0) throw error;
      return cacheViewportValue({
        shops: persisted,
        attribution,
        attributions,
        degraded: true,
        notice: degradedNotice,
      });
    }
  }

  function responseForSearch(search, value) {
    return {
      origin: { ...search },
      shops: bikeShopCandidatesForOrigin(value.shops, search),
      attribution: value.attribution,
      attributions: value.attributions ?? [value.attribution],
      ...(value.degraded ? { degraded: true, notice: value.notice || degradedNotice } : {}),
    };
  }

  function responseForViewport(viewport, value) {
    const matches = bikeShopCandidatesForViewport(value.shops, viewport);
    return {
      bounds: { ...viewport },
      shops: matches.shops,
      truncated: matches.truncated,
      attribution: value.attribution,
      attributions: value.attributions ?? [value.attribution],
      ...(value.degraded ? { degraded: true, notice: value.notice || degradedNotice } : {}),
    };
  }

  async function loadCanonicalShop(identity, key) {
    const query = `[out:json][timeout:10];${identity.osmElementType}(${identity.osmElementId});out center tags;`;
    const payload = await fetchOverpass(query);
    const expectedId = `osm:${identity.osmElementType}:${identity.osmElementId}`;
    const shop = normalizeOverpassBikeShopCandidates(payload)
      .find((candidate) => candidate.id === expectedId);
    if (!shop) {
      throw new RangeError('The OpenStreetMap listing no longer identifies a bicycle shop or repair business.');
    }
    const timestamp = now();
    setCacheEntry(
      key,
      shop,
      timestamp + bikeShopSearchLimits.cacheTtlMs,
      timestamp + bikeShopSearchLimits.cacheTtlMs,
    );
    return shop;
  }

  function loadOnce(key, loader) {
    const existing = inFlight.get(key);
    if (existing) return existing;
    const pending = loader().finally(() => {
      if (inFlight.get(key) === pending) inFlight.delete(key);
    });
    inFlight.set(key, pending);
    return pending;
  }

  return {
    async search(input) {
      const search = parseBikeShopSearch(input);
      pruneCache();
      const key = cacheKey(search);
      const cached = cache.get(key);
      if (cached?.expiresAt > now()) return responseForSearch(search, cached.value);
      try {
        return responseForSearch(search, await loadOnce(key, () => loadSearch(search, key)));
      } catch (error) {
        if (!cached) throw error;
        return responseForSearch(search, {
          ...cached.value,
          degraded: true,
          notice: degradedNotice,
        });
      }
    },
    async searchViewport(input) {
      const viewport = parseBikeShopViewport(input);
      pruneCache();
      const envelope = viewportCacheEnvelope(viewport);
      const key = viewportCacheKey(envelope);
      const cached = viewportCache.get(key);
      if (cached?.expiresAt > now()) return responseForViewport(viewport, cached.value);
      try {
        return responseForViewport(
          viewport,
          await loadOnce(key, () => loadViewport(envelope, key)),
        );
      } catch (error) {
        if (!cached) throw error;
        return responseForViewport(viewport, {
          ...cached.value,
          degraded: true,
          notice: degradedNotice,
        });
      }
    },
    async resolveClaim(candidate) {
      const osmElementType = safeText(candidate?.osmElementType, 16);
      const osmElementId = safeText(candidate?.osmElementId, 80);
      if (candidate?.source === 'overture') {
        if (
          osmElementType !== 'place'
          || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(osmElementId)
          || !resolveCatalogShop
        ) throw new RangeError('A valid Overture Maps bike shop ID is required.');
        const shop = await resolveCatalogShop(osmElementId);
        if (!shop) throw new RangeError('The Overture Maps listing no longer identifies a bike shop.');
        return canonicalBikeShopClaimCandidate(candidate, shop);
      }
      if (
        candidate?.source !== 'openstreetmap'
        || !['node', 'way', 'relation'].includes(osmElementType)
        || !/^[1-9][0-9]{0,30}$/u.test(osmElementId)
      ) throw new RangeError('A valid OpenStreetMap bike shop ID is required.');
      pruneCache();
      const identity = { osmElementType, osmElementId };
      const key = `identity:${osmElementType}:${osmElementId}`;
      const cached = cache.get(key);
      const shop = cached
        && cached.expiresAt > now()
        ? cached.value
        : await loadOnce(key, () => loadCanonicalShop(identity, key));
      const nearbyCatalogShops = await safelyLoadPersisted(loadPersistedForSearch, {
        latitude: shop.latitude,
        longitude: shop.longitude,
        radiusMiles: bikeShopSearchLimits.minimumRadiusMiles,
      });
      const canonicalShop = mergeShops(nearbyCatalogShops, [shop]).find((candidateShop) => (
        bikeShopClaimIdentities(candidateShop).some((claimIdentity) => (
          claimIdentity.source === 'openstreetmap'
          && claimIdentity.osmElementType === osmElementType
          && claimIdentity.osmElementId === osmElementId
        ))
      )) ?? shop;
      return canonicalBikeShopClaimCandidate(candidate, canonicalShop);
    },
  };
}
