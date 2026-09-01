const milesToMeters = 1609.344;
const defaultEndpoint = 'https://overpass-api.de/api/interpreter';

export const bikeShopSearchLimits = Object.freeze({
  minimumRadiusMiles: 5,
  maximumRadiusMiles: 50,
  maximumResults: 100,
  maximumUpstreamBytes: 2 * 1024 * 1024,
  upstreamTimeoutMs: 12_000,
  cacheTtlMs: 15 * 60 * 1000,
  maximumCacheEntries: 256,
  maximumConcurrentUpstreamRequests: 4,
});

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

const claimantRoles = new Set(['owner', 'manager', 'authorized-representative']);
const verificationMethods = new Set(['business-email', 'business-phone', 'documentation']);

export function parseBikeShopClaimRequest(input) {
  const shop = input?.shop && typeof input.shop === 'object' ? input.shop : {};
  const match = /^osm:(node|way|relation):([1-9][0-9]{0,30})$/u.exec(String(shop.id || ''));
  if (!match) throw new RangeError('A valid OpenStreetMap bike shop ID is required.');
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
    source: 'openstreetmap',
    osmElementType: match[1],
    osmElementId: match[2],
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
  const locality = tags['addr:city'] || tags['addr:town'] || tags['addr:village'];
  const region = tags['addr:state'] || tags['addr:province'];
  return {
    line1: safeText(line),
    locality: safeText(locality),
    region: safeText(region),
    postalCode: safeText(tags['addr:postcode'], 40),
    countryCode: safeText(tags['addr:country'], 8).toUpperCase(),
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

export function normalizeOverpassBikeShops(payload, origin, maximumResults = bikeShopSearchLimits.maximumResults) {
  return bikeShopCandidatesForOrigin(normalizeOverpassBikeShopCandidates(payload), origin, maximumResults);
}

export function applyApprovedBikeShopClaims(shops, approvedClaims) {
  const approvedKeys = new Set((Array.isArray(approvedClaims) ? approvedClaims : []).map((claim) => (
    `${String(claim?.source || '')}:${String(claim?.osmElementType || '')}:${String(claim?.osmElementId || '')}`
  )));
  return (Array.isArray(shops) ? shops : []).map((shop) => ({
    ...shop,
    claimed: approvedKeys.has(`openstreetmap:${shop?.source?.elementType}:${shop?.source?.elementId}`),
  }));
}

export function canonicalBikeShopClaimCandidate(candidate, canonicalShop) {
  const expectedId = `osm:${candidate?.osmElementType}:${candidate?.osmElementId}`;
  if (
    candidate?.source !== 'openstreetmap'
    || canonicalShop?.id !== expectedId
    || canonicalShop?.source?.provider !== 'OpenStreetMap'
  ) {
    throw new RangeError('The OpenStreetMap bike shop listing could not be verified.');
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
  };
}

export function createBikeShopDirectory(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const endpoint = options.endpoint ?? defaultEndpoint;
  const now = options.now ?? Date.now;
  const cache = new Map();
  const inFlight = new Map();
  let activeUpstreamRequests = 0;

  function cacheKey(search) {
    // Keep the exact caller origin in the key. Reusing a nearby caller's
    // Overpass circle can omit shops that sit on the new circle's boundary.
    return `search:${search.latitude}:${search.longitude}:${search.radiusMiles}`;
  }

  function pruneCache() {
    const timestamp = now();
    for (const [key, entry] of cache) if (entry.expiresAt <= timestamp) cache.delete(key);
    while (cache.size > bikeShopSearchLimits.maximumCacheEntries) cache.delete(cache.keys().next().value);
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), bikeShopSearchLimits.upstreamTimeoutMs);
    let payload;
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
      if (!upstream?.ok) throw new Error(`OpenStreetMap directory request failed (${upstream?.status || 503}).`);
      payload = await readBoundedJson(upstream);
    } finally {
      clearTimeout(timeout);
      activeUpstreamRequests -= 1;
    }
    return payload;
  }

  async function loadSearch(search, key) {
    // The upstream circle must never be smaller than the requested radius.
    // Exact post-filtering below removes any sub-meter overfetch.
    const radiusMeters = Math.ceil(search.radiusMiles * milesToMeters);
    const query = `[out:json][timeout:10];(nwr["shop"="bicycle"](around:${radiusMeters},${search.latitude},${search.longitude});nwr["service:bicycle:repair"~"^(yes|only)$"](around:${radiusMeters},${search.latitude},${search.longitude}););out center tags;`;
    const payload = await fetchOverpass(query);
    // Cache only origin-independent shop data. The cache key intentionally groups
    // identical searches, so distances are still computed per response.
    const value = {
      shops: normalizeOverpassBikeShopCandidates(payload),
      attribution: {
        text: '© OpenStreetMap contributors',
        url: 'https://www.openstreetmap.org/copyright',
        license: 'ODbL',
      },
    };
    cache.set(key, { value, expiresAt: now() + bikeShopSearchLimits.cacheTtlMs });
    pruneCache();
    return value;
  }

  function responseForSearch(search, value) {
    return {
      origin: { ...search },
      shops: bikeShopCandidatesForOrigin(value.shops, search),
      attribution: value.attribution,
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
    cache.set(key, { value: shop, expiresAt: now() + bikeShopSearchLimits.cacheTtlMs });
    pruneCache();
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
      if (cached) return responseForSearch(search, cached.value);
      return responseForSearch(search, await loadOnce(key, () => loadSearch(search, key)));
    },
    async resolveClaim(candidate) {
      const osmElementType = safeText(candidate?.osmElementType, 16);
      const osmElementId = safeText(candidate?.osmElementId, 31);
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
        ? cached.value
        : await loadOnce(key, () => loadCanonicalShop(identity, key));
      return canonicalBikeShopClaimCandidate(candidate, shop);
    },
  };
}
