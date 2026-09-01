const milesToMeters = 1609.344;
const defaultEndpoint = 'https://overpass-api.de/api/interpreter';

export const bikeShopSearchLimits = Object.freeze({
  minimumRadiusMiles: 5,
  maximumRadiusMiles: 50,
  maximumResults: 100,
  upstreamTimeoutMs: 12_000,
  cacheTtlMs: 15 * 60 * 1000,
  maximumCacheEntries: 256,
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
  ) {
    throw new RangeError('radiusMiles must be between 5 and 50.');
  }
  return { latitude, longitude, radiusMiles };
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

function googleLinks(shop) {
  const coordinates = `${shop.latitude},${shop.longitude}`;
  return {
    maps: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${shop.name} ${coordinates}`)}`,
    directions: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(coordinates)}`,
    streetView: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${encodeURIComponent(coordinates)}`,
  };
}

export function normalizeOverpassBikeShops(payload, origin, maximumResults = bikeShopSearchLimits.maximumResults) {
  const shops = [];
  const seen = new Set();
  for (const element of Array.isArray(payload?.elements) ? payload.elements : []) {
    const tags = element?.tags && typeof element.tags === 'object' ? element.tags : {};
    const point = osmElementPoint(element);
    const name = safeText(tags.name || tags.brand || 'Bike shop');
    const sourceId = `${safeText(element?.type, 16)}:${String(element?.id ?? '')}`;
    if (!point || !sourceId.includes(':') || seen.has(sourceId)) continue;
    seen.add(sourceId);
    const shop = {
      id: `osm:${sourceId}`,
      name,
      latitude: point.latitude,
      longitude: point.longitude,
      distanceMiles: Math.round(distanceMiles(origin, point) * 10) / 10,
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
        elementType: safeText(element?.type, 16),
        elementId: String(element?.id ?? ''),
        url: `https://www.openstreetmap.org/${encodeURIComponent(element?.type)}/${encodeURIComponent(element?.id)}`,
      },
    };
    shops.push({ ...shop, links: googleLinks(shop) });
  }
  return shops.sort((a, b) => a.distanceMiles - b.distanceMiles || a.name.localeCompare(b.name))
    .slice(0, maximumResults);
}

export function createBikeShopDirectory(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const endpoint = options.endpoint ?? defaultEndpoint;
  const now = options.now ?? Date.now;
  const cache = new Map();

  function cacheKey(search) {
    return `${search.latitude.toFixed(4)}:${search.longitude.toFixed(4)}:${search.radiusMiles.toFixed(1)}`;
  }

  function pruneCache() {
    const timestamp = now();
    for (const [key, entry] of cache) if (entry.expiresAt <= timestamp) cache.delete(key);
    while (cache.size > bikeShopSearchLimits.maximumCacheEntries) cache.delete(cache.keys().next().value);
  }

  return {
    async search(input) {
      const search = parseBikeShopSearch(input);
      pruneCache();
      const key = cacheKey(search);
      const cached = cache.get(key);
      if (cached) return { ...cached.value, cache: 'hit' };

      const radiusMeters = Math.round(search.radiusMiles * milesToMeters);
      const query = `[out:json][timeout:10];(nwr["shop"="bicycle"](around:${radiusMeters},${search.latitude},${search.longitude});nwr["service:bicycle:repair"~"^(yes|only)$"](around:${radiusMeters},${search.latitude},${search.longitude}););out center tags;`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), bikeShopSearchLimits.upstreamTimeoutMs);
      let upstream;
      try {
        upstream = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'User-Agent': 'TrackLab-BMX/1.0 bike-shop-directory',
          },
          body: new URLSearchParams({ data: query }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      if (!upstream?.ok) throw new Error(`OpenStreetMap directory request failed (${upstream?.status || 503}).`);
      const payload = await upstream.json();
      const value = {
        origin: search,
        shops: normalizeOverpassBikeShops(payload, search),
        attribution: {
          text: '© OpenStreetMap contributors',
          url: 'https://www.openstreetmap.org/copyright',
          license: 'ODbL',
        },
        fetchedAt: new Date(now()).toISOString(),
        cache: 'miss',
      };
      cache.set(key, { value, expiresAt: now() + bikeShopSearchLimits.cacheTtlMs });
      pruneCache();
      return value;
    },
  };
}
