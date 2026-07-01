import { mkdir, readFile, writeFile } from 'node:fs/promises';

const ffcPageUrl = 'https://velo.ffc.fr/equipements-sportifs/';
const myMapsId = '153KgH42LVTz7idX20eFbCBeBV-5NkLc';
const kmlUrl = `https://www.google.com/maps/d/kml?mid=${myMapsId}&forcekml=1`;
const outputPath = new URL('../data/imports/ffc-bmx-racing-official.json', import.meta.url);
const cachePath = new URL('../data/geocode-cache/france-api-adresse.json', import.meta.url);

const classificationByStyle = {
  'icon-1899-C2185B-nodesc': { level: 'Interchampionnat', color: 'red' },
  'icon-1899-000000-nodesc': { level: 'Interchallenge', color: 'black' },
  'icon-1899-FFD600-nodesc': { level: 'Niveau 1', color: 'yellow' },
  'icon-1899-FFEA00-nodesc': { level: 'Niveau 1', color: 'yellow' },
  'icon-1899-0288D1-nodesc': { level: 'Niveau 2', color: 'blue' },
  'icon-1899-558B2F-nodesc': { level: 'Niveau 3', color: 'green' },
  'icon-1899-7CB342-nodesc': { level: 'Niveau 3', color: 'green' },
  'icon-1899-0F9D58-nodesc': { level: 'Niveau 3', color: 'green' },
};

function slug(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function decodeEntities(value) {
  return String(value ?? '')
    .replace(/^<!\[CDATA\[/, '')
    .replace(/\]\]>$/, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function tagValue(block, tagName) {
  const match = block.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`));
  return match ? decodeEntities(match[1]) : undefined;
}

function parseCoordinates(block) {
  const raw = tagValue(block, 'coordinates');
  if (!raw) {
    return null;
  }

  const [longitude, latitude] = raw.split(',').map(Number);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude, raw };
}

function parseFrenchContext(context) {
  const [departmentCode, department, region] = String(context ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  return { departmentCode, department, region };
}

async function readJson(pathUrl, fallback) {
  try {
    return JSON.parse(await readFile(pathUrl, 'utf8'));
  } catch {
    return fallback;
  }
}

async function reverseGeocode(latitude, longitude, cache) {
  const key = `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
  if (cache[key]) {
    return cache[key];
  }

  const url = new URL('https://api-adresse.data.gouv.fr/reverse/');
  url.searchParams.set('lat', String(latitude));
  url.searchParams.set('lon', String(longitude));
  url.searchParams.set('limit', '1');

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`French address reverse geocode failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const feature = payload.features?.[0];
  const properties = feature?.properties ?? {};
  const context = parseFrenchContext(properties.context);
  const result = {
    label: properties.label,
    city: properties.city,
    postcode: properties.postcode,
    citycode: properties.citycode,
    department: context.department,
    departmentCode: context.departmentCode,
    region: context.region,
    type: properties.type,
    distanceMeters: properties.distance,
    score: properties.score,
  };

  cache[key] = result;
  return result;
}

function normalizePlacemark(block, index, geocode) {
  const name = tagValue(block, 'name');
  const styleUrl = tagValue(block, 'styleUrl')?.replace(/^#/, '');
  const coordinates = parseCoordinates(block);

  if (!name || !coordinates) {
    return null;
  }

  const classification = classificationByStyle[styleUrl] ?? { level: 'Unclassified', color: 'unknown' };
  const cityFromName = name
    .replace(/\bBMX\b/gi, '')
    .replace(/\bPiste\b/gi, '')
    .replace(/\bRace\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    id: `ffc-${slug(name)}-${index + 1}`,
    name,
    country: 'France',
    countryCode: 'FR',
    state: geocode.region ?? 'Unspecified',
    county: geocode.department,
    district: geocode.departmentCode,
    region: 'Europe',
    source: 'Fédération Française de Cyclisme',
    sourceUrl: ffcPageUrl,
    sourceTrackId: `${myMapsId}:${index + 1}`,
    address: geocode.label,
    city: geocode.city ?? cityFromName,
    postalCode: geocode.postcode,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    coordinateSource: 'FFC BMX Racing Google My Maps KML',
    coordinateAccuracy: 'provider-map-marker',
    lengthMeters: 350,
    elevationMeters: 0,
    surface: 'BMX Racing track',
    routeStatus: 'locator-only',
    sourceRecord: {
      provider: 'FFC',
      sourcePage: ffcPageUrl,
      kmlUrl,
      myMapsId,
      placemarkIndex: index,
      styleUrl,
      classification,
      kmlCoordinate: coordinates.raw,
      addressEnrichment: {
        provider: 'Base Adresse Nationale API',
        type: geocode.type,
        distanceMeters: geocode.distanceMeters,
        score: geocode.score,
      },
    },
  };
}

const response = await fetch(kmlUrl);
if (!response.ok) {
  throw new Error(`FFC KML import failed: ${response.status} ${response.statusText}`);
}

const kml = await response.text();
const placemarks = [...kml.matchAll(/<Placemark>[\s\S]*?<\/Placemark>/g)].map((match) => match[0]);
const cache = await readJson(cachePath, {});
const tracks = [];

for (const [index, block] of placemarks.entries()) {
  const coordinates = parseCoordinates(block);
  if (!coordinates) {
    continue;
  }

  const geocode = await reverseGeocode(coordinates.latitude, coordinates.longitude, cache);
  const track = normalizePlacemark(block, index, geocode);
  if (track) {
    tracks.push(track);
  }
}

tracks.sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));

await mkdir(new URL('../data/imports/', import.meta.url), { recursive: true });
await mkdir(new URL('../data/geocode-cache/', import.meta.url), { recursive: true });
await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
await writeFile(outputPath, `${JSON.stringify({
  source: ffcPageUrl,
  kml: kmlUrl,
  count: tracks.length,
  notes: 'Official FFC page states 264 classified BMX Racing tracks; current KML export contains 266 placemarks.',
  tracks,
}, null, 2)}\n`);

console.log(`Imported ${tracks.length} FFC BMX Racing records into ${outputPath.pathname}`);
