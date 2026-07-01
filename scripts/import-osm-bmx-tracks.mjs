import { mkdir, readFile, writeFile } from 'node:fs/promises';

const outputPath = new URL('../data/imports/openstreetmap-bmx-global.json', import.meta.url);
const cachePath = new URL('../data/geocode-cache/openstreetmap-bmx-global.json', import.meta.url);
const userAgent = 'TrackLabBMX/0.1 (global BMX locator import; https://github.com/preskiranch/tracklab-bmx)';
const overpassEndpoint = 'https://overpass-api.de/api/interpreter';
const nominatimEndpoint = 'https://nominatim.openstreetmap.org/reverse';

const countryQueries = [
  { name: 'Aruba', countryCode: 'AW', region: 'Caribbean', bbox: [12.36, -70.08, 12.68, -69.83], acceptedCodes: ['aw', 'nl-aw', 'nl'] },
  { name: 'Mexico', countryCode: 'MX', region: 'North America', bbox: [14, -118, 33, -86], acceptedCodes: ['mx'], requireReverseFilter: true },
  { name: 'United Kingdom', countryCode: 'GB', region: 'Europe', bbox: [49.8, -8.7, 60.9, 2.1], acceptedCodes: ['gb'] },
  { name: 'Ireland', countryCode: 'IE', region: 'Europe', bbox: [51.3, -10.7, 55.5, -5.4], acceptedCodes: ['ie'] },
  { name: 'Netherlands', countryCode: 'NL', region: 'Europe', bbox: [50.7, 3.2, 53.7, 7.3], acceptedCodes: ['nl'] },
  { name: 'Belgium', countryCode: 'BE', region: 'Europe', bbox: [49.4, 2.5, 51.6, 6.5], acceptedCodes: ['be'] },
  { name: 'Germany', countryCode: 'DE', region: 'Europe', bbox: [47.2, 5.8, 55.1, 10.6], acceptedCodes: ['de'] },
  { name: 'Germany', countryCode: 'DE', region: 'Europe', bbox: [47.2, 10.4, 55.1, 15.2], acceptedCodes: ['de'] },
  { name: 'Spain', countryCode: 'ES', region: 'Europe', bbox: [35.8, -9.5, 43.9, 4.4], acceptedCodes: ['es'] },
  { name: 'Portugal', countryCode: 'PT', region: 'Europe', bbox: [36.8, -9.6, 42.3, -6.1], acceptedCodes: ['pt'] },
  { name: 'Italy', countryCode: 'IT', region: 'Europe', bbox: [44.0, 6.4, 47.2, 13.8], acceptedCodes: ['it', 'sm'] },
  { name: 'Italy', countryCode: 'IT', region: 'Europe', bbox: [36.5, 7.0, 44.2, 18.7], acceptedCodes: ['it', 'sm'] },
  { name: 'Switzerland', countryCode: 'CH', region: 'Europe', bbox: [45.7, 5.7, 47.9, 10.6], acceptedCodes: ['ch'] },
  { name: 'Austria', countryCode: 'AT', region: 'Europe', bbox: [46.3, 9.4, 49.1, 17.2], acceptedCodes: ['at'] },
  { name: 'Denmark', countryCode: 'DK', region: 'Europe', bbox: [54.4, 7.9, 57.9, 15.3], acceptedCodes: ['dk'] },
  { name: 'Sweden', countryCode: 'SE', region: 'Europe', bbox: [55.0, 10.6, 69.1, 24.2], acceptedCodes: ['se'] },
  { name: 'Norway', countryCode: 'NO', region: 'Europe', bbox: [57.8, 4.5, 71.4, 31.5], acceptedCodes: ['no'] },
  { name: 'Finland', countryCode: 'FI', region: 'Europe', bbox: [59.7, 20.5, 64.5, 31.6], acceptedCodes: ['fi'] },
  { name: 'Finland', countryCode: 'FI', region: 'Europe', bbox: [64.4, 20.5, 70.2, 31.6], acceptedCodes: ['fi'] },
  { name: 'Poland', countryCode: 'PL', region: 'Europe', bbox: [49.0, 14.1, 54.9, 24.2], acceptedCodes: ['pl'] },
  { name: 'Czech Republic', countryCode: 'CZ', region: 'Europe', bbox: [48.5, 12.1, 51.1, 18.9], acceptedCodes: ['cz'] },
  { name: 'Latvia', countryCode: 'LV', region: 'Europe', bbox: [55.6, 20.8, 58.2, 28.3], acceptedCodes: ['lv'] },
  { name: 'Lithuania', countryCode: 'LT', region: 'Europe', bbox: [53.9, 20.9, 56.5, 26.9], acceptedCodes: ['lt'] },
  { name: 'Estonia', countryCode: 'EE', region: 'Europe', bbox: [57.5, 21.5, 59.9, 28.3], acceptedCodes: ['ee'] },
  { name: 'Hungary', countryCode: 'HU', region: 'Europe', bbox: [45.7, 16.1, 48.7, 22.9], acceptedCodes: ['hu'] },
  { name: 'Brazil', countryCode: 'BR', region: 'South America', bbox: [-34.2, -74.1, -15.0, -45.0], acceptedCodes: ['br'] },
  { name: 'Brazil', countryCode: 'BR', region: 'South America', bbox: [-16.0, -60.0, 5.4, -34.7], acceptedCodes: ['br'] },
  { name: 'Argentina', countryCode: 'AR', region: 'South America', bbox: [-55.2, -73.8, -21.7, -53.6], acceptedCodes: ['ar'] },
  { name: 'Colombia', countryCode: 'CO', region: 'South America', bbox: [-4.3, -79.1, 13.5, -66.8], acceptedCodes: ['co'] },
  { name: 'Chile', countryCode: 'CL', region: 'South America', bbox: [-56.0, -76.0, -17.3, -66.3], acceptedCodes: ['cl'] },
  { name: 'Ecuador', countryCode: 'EC', region: 'South America', bbox: [-5.2, -81.2, 1.8, -75.0], acceptedCodes: ['ec'] },
  { name: 'Japan', countryCode: 'JP', region: 'Asia', bbox: [24.0, 122.0, 46.0, 146.0], acceptedCodes: ['jp'] },
  { name: 'China', countryCode: 'CN', region: 'Asia', bbox: [18.0, 73.0, 54.0, 135.0], acceptedCodes: ['cn', 'hk'], requireReverseFilter: true },
  { name: 'Singapore', countryCode: 'SG', region: 'Asia', bbox: [1.16, 103.57, 1.49, 104.10], acceptedCodes: ['sg'] },
  { name: 'Malaysia', countryCode: 'MY', region: 'Asia', bbox: [0.8, 99.5, 7.5, 119.5], acceptedCodes: ['my'] },
  { name: 'Indonesia', countryCode: 'ID', region: 'Asia', bbox: [-11.2, 94.5, 6.3, 141.1], acceptedCodes: ['id'] },
  { name: 'Thailand', countryCode: 'TH', region: 'Asia', bbox: [5.6, 97.3, 20.5, 105.7], acceptedCodes: ['th'] },
  { name: 'Philippines', countryCode: 'PH', region: 'Asia', bbox: [4.4, 116.8, 21.2, 127.0], acceptedCodes: ['ph'] },
  { name: 'India', countryCode: 'IN', region: 'Asia', bbox: [6.5, 68.0, 35.7, 97.4], acceptedCodes: ['in'] },
  { name: 'Australia', countryCode: 'AU', region: 'Oceania', bbox: [-44.0, 112.0, -25.0, 129.5], acceptedCodes: ['au'] },
  { name: 'Australia', countryCode: 'AU', region: 'Oceania', bbox: [-44.0, 129.0, -10.0, 154.0], acceptedCodes: ['au'] },
  { name: 'South Africa', countryCode: 'ZA', region: 'Africa', bbox: [-35.0, 16.0, -22.0, 33.0], acceptedCodes: ['za'] },
  { name: 'Morocco', countryCode: 'MA', region: 'Africa', bbox: [27.5, -13.5, 36.1, -1.0], acceptedCodes: ['ma'] },
  { name: 'Egypt', countryCode: 'EG', region: 'Africa', bbox: [22.0, 24.6, 31.8, 36.9], acceptedCodes: ['eg'] },
  { name: 'United Arab Emirates', countryCode: 'AE', region: 'Middle East', bbox: [22.5, 51.4, 26.5, 56.5], acceptedCodes: ['ae'] },
];

const reverseAll = process.env.OSM_REVERSE_GEOCODE === '1';

const manualTracks = [
  {
    id: 'jaburibari-bmx-track',
    name: 'Jaburibari BMX Track',
    country: 'Aruba',
    countryCode: 'AW',
    state: 'Aruba',
    region: 'Caribbean',
    source: '297 Sports Aruba / OpenStreetMap',
    sourceUrl: 'https://297sportsaruba.com/jaburibari-bmx-track-na-parke-curason-a-keda-una-beyesa/',
    sourceTrackId: 'osm-way/563399534',
    address: 'Parke Curazon, Jaburibari, Paradera, Aruba',
    city: 'Paradera',
    district: 'Jaburibari',
    latitude: 12.547678,
    longitude: -70.0033569,
    coordinateSource: 'OpenStreetMap geometry center',
    coordinateAccuracy: 'osm-center',
    lengthMeters: 350,
    elevationMeters: 0,
    surface: 'BMX Racing track (dirt)',
    routeStatus: 'locator-only',
    sourceRecord: {
      provider: 'OpenStreetMap / 297 Sports Aruba',
      osmType: 'way',
      osmId: 563399534,
    },
  },
  {
    id: 'street-wise-bmx-track',
    name: 'Street Wise BMX Track',
    country: 'Aruba',
    countryCode: 'AW',
    state: 'Aruba',
    region: 'Caribbean',
    source: 'OpenStreetMap / Mapcarta',
    sourceUrl: 'https://mapcarta.com/W620434279',
    sourceTrackId: 'osm-way/620434279',
    address: 'Weg Sero Preto, Lago Heights, Aruba',
    city: 'Lago Heights',
    district: 'Sero Preto',
    latitude: 12.4443693,
    longitude: -69.9083942,
    coordinateSource: 'OpenStreetMap geometry center',
    coordinateAccuracy: 'osm-center',
    lengthMeters: 350,
    elevationMeters: 0,
    surface: 'BMX Racing track (dirt)',
    routeStatus: 'locator-only',
    sourceRecord: {
      provider: 'OpenStreetMap / Mapcarta',
      osmType: 'way',
      osmId: 620434279,
    },
  },
  {
    id: 'hong-kong-jockey-club-international-bmx-park',
    name: 'Hong Kong Jockey Club International BMX Park',
    country: 'China',
    countryCode: 'CN',
    state: 'Hong Kong',
    region: 'Asia',
    source: 'Hong Kong Facilities Portal / OpenStreetMap',
    sourceUrl: 'https://fpf.ccidahk.gov.hk/en/location/detail.php?id=1861',
    sourceTrackId: 'osm-way/138674604',
    address: '91 Kwai Hei Street, Gin Drinkers Bay, Kwai Chung, Hong Kong',
    city: 'Hong Kong',
    district: 'Kwai Tsing',
    latitude: 22.3525858,
    longitude: 114.1171897,
    coordinateSource: 'OpenStreetMap geometry center',
    coordinateAccuracy: 'osm-center',
    lengthMeters: 350,
    elevationMeters: 0,
    surface: 'International BMX Racing track',
    routeStatus: 'locator-only',
    sourceRecord: {
      provider: 'Hong Kong Facilities Portal / OpenStreetMap',
      osmType: 'way',
      osmId: 138674604,
    },
  },
];

const recordOverrides = {
  'way/563399534': {
    id: 'jaburibari-bmx-track',
    name: 'Jaburibari BMX Track',
    source: 'OpenStreetMap / Aruba public BMX reports',
    sourceUrl: 'https://297sportsaruba.com/jaburibari-bmx-track-na-parke-curason-a-keda-una-beyesa/',
    address: 'Parke Curazon, Jaburibari, Paradera, Aruba',
    city: 'Paradera',
    state: 'Aruba',
    country: 'Aruba',
    countryCode: 'AW',
    region: 'Caribbean',
  },
  'way/620434279': {
    id: 'street-wise-bmx-track',
    name: 'Street Wise BMX Track',
    source: 'OpenStreetMap / Mapcarta',
    sourceUrl: 'https://mapcarta.com/W620434279',
    address: 'Weg Sero Preto, Lago Heights, Aruba',
    city: 'Lago Heights',
    state: 'Aruba',
    country: 'Aruba',
    countryCode: 'AW',
    region: 'Caribbean',
  },
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(pathUrl, fallback) {
  try {
    return JSON.parse(await readFile(pathUrl, 'utf8'));
  } catch {
    return fallback;
  }
}

function slug(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function titleCase(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function coordinateFor(element) {
  const lat = Number(element.lat ?? element.center?.lat);
  const longitude = Number(element.lon ?? element.center?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(longitude)) {
    return null;
  }
  return { latitude: lat, longitude };
}

function hasBmxSport(tags) {
  return String(tags.sport ?? '')
    .toLowerCase()
    .split(/[;,]/)
    .map((sport) => sport.trim())
    .includes('bmx');
}

function looksTrackLike(tags) {
  const leisure = String(tags.leisure ?? '').toLowerCase();
  const amenity = String(tags.amenity ?? '').toLowerCase();
  return ['track', 'pitch', 'sports_centre', 'stadium'].includes(leisure)
    || (leisure === 'park' && hasBmxSport(tags))
    || (amenity === 'training' && hasBmxSport(tags));
}

function candidateName(element, config) {
  const key = `${element.type}/${element.id}`;
  if (recordOverrides[key]?.name) {
    return recordOverrides[key].name;
  }
  const name = String(element.tags?.name ?? '').trim();
  if (name) {
    return name;
  }
  return `BMX Track - ${config.name}`;
}

function isCandidate(element, config) {
  const tags = element.tags ?? {};
  const name = candidateName(element, config);
  const lowerName = name.toLowerCase();
  const hasBmxInName = lowerName.includes('bmx');
  const trackLike = looksTrackLike(tags);

  if (!(hasBmxSport(tags) || (hasBmxInName && trackLike))) {
    return false;
  }

  if (tags.shop || tags.office || tags.tourism === 'hotel') {
    return false;
  }

  if (/(bike shop|bmx shop|pro shop|store|only bmx|loop|trailhead)/i.test(name)) {
    return false;
  }

  if (/(pump|freestyle|skatepark|skate park|jump line)/i.test(name)
    && !/(race|racing|track|pista|circuit|stadium|centre|center|course)/i.test(name)) {
    return false;
  }

  return true;
}

function overpassQuery(config) {
  const bbox = config.bbox.join(',');
  return `[out:json][timeout:80][bbox:${bbox}];
(
  way["sport"="bmx"];
  node["sport"="bmx"];
  way["leisure"="track"]["name"~"BMX|Bmx|bmx"];
  node["leisure"="track"]["name"~"BMX|Bmx|bmx"];
  way["leisure"="pitch"]["name"~"BMX|Bmx|bmx"];
  node["leisure"="pitch"]["name"~"BMX|Bmx|bmx"];
  way["leisure"="sports_centre"]["name"~"BMX|Bmx|bmx"];
  node["leisure"="sports_centre"]["name"~"BMX|Bmx|bmx"];
  way["leisure"="stadium"]["name"~"BMX|Bmx|bmx"];
  node["leisure"="stadium"]["name"~"BMX|Bmx|bmx"];
);
out tags center;`;
}

async function fetchOverpass(config, cache) {
  const cacheKey = `overpass:${config.countryCode}:${config.bbox.join(',')}`;
  if (cache[cacheKey]) {
    return cache[cacheKey];
  }

  const response = await fetch(overpassEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': userAgent,
    },
    body: `data=${encodeURIComponent(overpassQuery(config))}`,
  });
  const text = await response.text();
  if (!response.ok) {
    console.warn(`Overpass failed for ${config.name}: ${response.status} ${response.statusText}`);
    return { elements: [], error: `${response.status} ${response.statusText}`, body: text.slice(0, 300) };
  }

  const payload = JSON.parse(text);
  cache[cacheKey] = {
    timestamp: payload.osm3s?.timestamp_osm_base,
    elements: payload.elements ?? [],
  };
  await sleep(600);
  return cache[cacheKey];
}

function reverseKey(latitude, longitude) {
  return `reverse:${latitude.toFixed(6)},${longitude.toFixed(6)}`;
}

async function reverseGeocode(latitude, longitude, cache) {
  const key = reverseKey(latitude, longitude);
  if (Object.hasOwn(cache, key)) {
    return cache[key];
  }

  const url = new URL(nominatimEndpoint);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('lat', latitude);
  url.searchParams.set('lon', longitude);

  try {
    const response = await fetch(url, { headers: { 'User-Agent': userAgent } });
    if (!response.ok) {
      console.warn(`Nominatim reverse failed for ${latitude},${longitude}: ${response.status} ${response.statusText}`);
      cache[key] = null;
      return null;
    }

    const result = await response.json();
    const address = result.address ?? {};
    cache[key] = {
      displayName: result.display_name,
      category: result.category,
      type: result.type,
      addresstype: result.addresstype,
      osmType: result.osm_type,
      osmId: result.osm_id,
      road: address.road,
      suburb: address.suburb ?? address.neighbourhood,
      city: address.city ?? address.town ?? address.village ?? address.municipality ?? address.suburb,
      county: address.county,
      district: address.city_district ?? address.district,
      state: address.state ?? address.region ?? address.province,
      postcode: address.postcode,
      country: address.country,
      countryCode: address.country_code,
      isoSubdivision: address['ISO3166-2-lvl3'] ?? address['ISO3166-2-lvl4'] ?? address['ISO3166-2-lvl6'],
    };
    await sleep(1100);
    return cache[key];
  } catch (error) {
    console.warn(`Nominatim reverse failed for ${latitude},${longitude}: ${error.message}`);
    cache[key] = null;
    return null;
  }
}

function normalizedReverseCountry(reverse, config) {
  const lower = String(reverse?.countryCode ?? '').toLowerCase();
  const iso = String(reverse?.isoSubdivision ?? '').toLowerCase();

  if (reverse?.country === 'Aruba' || iso === 'nl-aw') {
    return { country: 'Aruba', countryCode: 'AW', state: 'Aruba', region: 'Caribbean', acceptedCode: 'aw' };
  }

  if (lower === 'hk' || /hong kong/i.test(String(reverse?.country ?? ''))) {
    return { country: 'China', countryCode: 'CN', state: 'Hong Kong', region: 'Asia', acceptedCode: 'hk' };
  }

  return {
    country: config.name,
    countryCode: config.countryCode,
    state: reverse?.state,
    region: config.region,
    acceptedCode: lower,
  };
}

function isAcceptedCountry(reverse, config) {
  if (!reverse) {
    return true;
  }
  const normalized = normalizedReverseCountry(reverse, config);
  return config.acceptedCodes.includes(normalized.acceptedCode)
    || config.acceptedCodes.includes(String(normalized.countryCode).toLowerCase());
}

function tagAddress(tags, reverse) {
  const parts = [
    [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '),
    tags['addr:city'] ?? reverse?.city,
    tags['addr:postcode'] ?? reverse?.postcode,
    tags['addr:country'] ?? reverse?.country,
  ].filter(Boolean);

  return parts.length >= 2 ? parts.join(', ') : reverse?.displayName;
}

function fallbackAddress(tags, reverse, config, coords) {
  return tagAddress(tags, reverse)
    ?? [tags['addr:city'], reverse?.city, reverse?.state, config.name].filter(Boolean).slice(0, 2).join(', ')
    ?? `${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}`;
}

function sourceUrlFor(element) {
  if (element.type && element.id) {
    return `https://www.openstreetmap.org/${element.type}/${element.id}`;
  }
  return 'https://www.openstreetmap.org/';
}

function normalizedTrack(element, config, reverse) {
  const tags = element.tags ?? {};
  const coords = coordinateFor(element);
  const key = `${element.type}/${element.id}`;
  const override = recordOverrides[key] ?? {};
  const country = normalizedReverseCountry(reverse, config);
  const name = override.name ?? candidateName(element, config);
  const city = override.city ?? reverse?.city ?? tags['addr:city'];
  const state = override.state ?? country.state ?? reverse?.state ?? city ?? config.name;
  const address = override.address ?? fallbackAddress(tags, reverse, config, coords);
  const source = override.source ?? 'OpenStreetMap Overpass';

  return {
    id: override.id ?? `osm-${slug(country.countryCode)}-${slug(name)}-${element.type}-${element.id}`,
    name,
    country: override.country ?? country.country,
    countryCode: override.countryCode ?? country.countryCode,
    state: titleCase(state) || config.name,
    region: override.region ?? country.region,
    source,
    sourceUrl: override.sourceUrl ?? sourceUrlFor(element),
    sourceTrackId: `${element.type}/${element.id}`,
    address,
    city: titleCase(city),
    county: reverse?.county,
    district: reverse?.district ?? reverse?.suburb,
    postalCode: tags['addr:postcode'] ?? reverse?.postcode,
    latitude: coords.latitude,
    longitude: coords.longitude,
    coordinateSource: 'OpenStreetMap Overpass geometry center',
    coordinateAccuracy: element.type === 'node' ? 'osm-node' : 'osm-center',
    websiteUrl: tags.website,
    lengthMeters: 350,
    elevationMeters: 0,
    surface: tags.surface ? `BMX Racing track (${tags.surface})` : 'BMX Racing track',
    routeStatus: 'locator-only',
    sourceRecord: {
      provider: 'OpenStreetMap',
      overpassEndpoint,
      reverseGeocoder: reverse ? 'OpenStreetMap Nominatim' : undefined,
      osmType: element.type,
      osmId: element.id,
      osmTags: tags,
      reverseGeocode: reverse,
    },
  };
}

function nearbyKey(track) {
  return [
    track.countryCode,
    slug(track.name.replace(/^BMX Track - /, 'BMX Track')),
    Number(track.latitude).toFixed(3),
    Number(track.longitude).toFixed(3),
  ].join(':');
}

function locationKey(track) {
  return [
    track.countryCode,
    Number(track.latitude).toFixed(3),
    Number(track.longitude).toFixed(3),
  ].join(':');
}

function sourceRank(track) {
  return /Facilities Portal|297 Sports|Mapcarta|public BMX reports/i.test(track.source ?? '') ? 3 : 1;
}

function dedupeTracks(tracks) {
  const byKey = new Map();
  for (const track of tracks) {
    const key = nearbyKey(track);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, track);
      continue;
    }

    const existingNamed = !/^BMX Track - /.test(existing.name);
    const trackNamed = !/^BMX Track - /.test(track.name);
    if (sourceRank(track) > sourceRank(existing)
      || (!existingNamed && trackNamed)
      || (String(track.address ?? '').length > String(existing.address ?? '').length)) {
      byKey.set(key, track);
    }
  }

  const byLocation = new Map();
  for (const track of byKey.values()) {
    const key = locationKey(track);
    const existing = byLocation.get(key);
    if (!existing || sourceRank(track) > sourceRank(existing)) {
      byLocation.set(key, track);
    }
  }

  return [...byLocation.values()];
}

const cache = await readJson(cachePath, {});
const tracks = [...manualTracks];
const stats = [];

for (const config of countryQueries) {
  console.log(`Importing OSM BMX records for ${config.name} (${config.bbox.join(', ')})...`);
  const overpass = await fetchOverpass(config, cache);
  const candidates = [];

  for (const element of overpass.elements ?? []) {
    const coords = coordinateFor(element);
    if (!coords || !isCandidate(element, config)) {
      continue;
    }
    candidates.push(element);
  }

  let accepted = 0;
  for (const element of candidates) {
    const coords = coordinateFor(element);
    const shouldReverse = reverseAll || config.requireReverseFilter;
    const reverse = shouldReverse ? await reverseGeocode(coords.latitude, coords.longitude, cache) : null;
    if (shouldReverse && !isAcceptedCountry(reverse, config)) {
      continue;
    }
    tracks.push(normalizedTrack(element, config, reverse));
    accepted += 1;
  }

  stats.push({
    country: config.name,
    overpassElements: overpass.elements?.length ?? 0,
    candidates: candidates.length,
    accepted,
    error: overpass.error,
  });
}

const deduped = dedupeTracks(tracks)
  .sort((a, b) => a.country.localeCompare(b.country)
    || a.state.localeCompare(b.state)
    || a.city.localeCompare(b.city)
    || a.name.localeCompare(b.name));

await mkdir(new URL('../data/imports/', import.meta.url), { recursive: true });
await mkdir(new URL('../data/geocode-cache/', import.meta.url), { recursive: true });
await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
await writeFile(outputPath, `${JSON.stringify({
  source: 'https://www.openstreetmap.org/',
  sourceLicense: 'Open Database License (ODbL)',
  count: deduped.length,
  generatedAt: new Date().toISOString(),
  stats,
  tracks: deduped,
}, null, 2)}\n`);

console.log(`Imported ${deduped.length} OpenStreetMap BMX locator records into ${outputPath.pathname}`);
console.table(stats);
