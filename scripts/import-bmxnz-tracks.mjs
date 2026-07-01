import { mkdir, readFile, writeFile } from 'node:fs/promises';

const sourceUrl = 'https://www.bmxnz.co.nz/clubs';
const outputPath = new URL('../data/imports/bmxnz-official.json', import.meta.url);
const cachePath = new URL('../data/geocode-cache/bmxnz-nominatim.json', import.meta.url);
const userAgent = 'TrackLabBMX/0.1 (global BMX track import; https://github.com/preskiranch/tracklab-bmx)';

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

function decodeEntities(value) {
  return String(value ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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

function regionFor(index, regions) {
  return [...regions]
    .reverse()
    .find((region) => region.index < index)?.name;
}

function parseClubLine(line) {
  const parts = line.split(',').map((part) => part.trim()).filter(Boolean);
  const name = parts.shift();
  const address = parts.join(', ');
  const city = parts.at(-1);

  return {
    name,
    address,
    city,
  };
}

function geocodeQueries(record) {
  const normalizedAddress = record.address
    .replace(/\bcnr\b/gi, 'corner')
    .replace(/\bR D\b/gi, 'RD');
  const city = record.city ? `${record.city}, ` : '';

  return [
    `${normalizedAddress}, New Zealand`,
    `${record.name}, ${city}New Zealand`,
    `BMX track, ${city}New Zealand`,
  ].filter((query, index, queries) => query.trim() && queries.indexOf(query) === index);
}

function normalizeNominatimResult(result, query) {
  if (!result) {
    return null;
  }

  const address = result.address ?? {};
  return {
    latitude: Number(result.lat),
    longitude: Number(result.lon),
    label: result.display_name,
    query,
    category: result.category,
    type: result.type,
    addresstype: result.addresstype,
    importance: result.importance,
    osmType: result.osm_type,
    osmId: result.osm_id,
    city: address.city ?? address.town ?? address.village ?? address.suburb,
    county: address.county,
    state: address.state,
    postcode: address.postcode,
  };
}

async function fetchNominatim(query, cache) {
  if (Object.hasOwn(cache, query)) {
    return cache[query];
  }

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'nz');
  url.searchParams.set('q', query);

  try {
    const response = await fetch(url, { headers: { 'User-Agent': userAgent } });
    if (!response.ok) {
      console.warn(`Nominatim geocode failed for "${query}": ${response.status} ${response.statusText}`);
      cache[query] = null;
      return null;
    }

    const payload = await response.json();
    cache[query] = normalizeNominatimResult(payload[0], query);
    await sleep(1100);
    return cache[query];
  } catch (error) {
    console.warn(`Nominatim geocode failed for "${query}": ${error.message}`);
    cache[query] = null;
    return null;
  }
}

async function geocode(record, cache) {
  for (const query of geocodeQueries(record)) {
    const result = await fetchNominatim(query, cache);
    if (result?.latitude && result?.longitude) {
      return result;
    }
  }

  return null;
}

const response = await fetch(sourceUrl);
if (!response.ok) {
  throw new Error(`BMXNZ club import failed: ${response.status} ${response.statusText}`);
}

const html = await response.text();
const regions = [...html.matchAll(/<h2 class="site-secondary-heading"><strong>([^<]+)<\/strong><\/h2>/g)]
  .map((match) => ({ index: match.index, name: decodeEntities(match[1]) }))
  .filter((region) => region.name === region.name.toUpperCase() && region.name !== 'WHERE CAN I RACE?');
const clubMatches = [...html.matchAll(/>\s*([^<>]*BMX\s+(?:Club|club)[^<>]*)\s*</g)];
const clubLines = [...new Map(clubMatches
  .map((match) => [decodeEntities(match[1]), { line: decodeEntities(match[1]), index: match.index }])
  .filter(([line]) => line.includes(','))
  .map(([line, value]) => [line.toLowerCase(), value])).values()];
const cache = await readJson(cachePath, {});
const tracks = [];

for (const [index, entry] of clubLines.entries()) {
  const parsed = parseClubLine(entry.line);
  if (!parsed.name) {
    continue;
  }

  const geocodeResult = await geocode(parsed, cache);
  const bmxnzRegion = regionFor(entry.index, regions);
  const state = geocodeResult?.state ?? titleCase(bmxnzRegion);

  tracks.push({
    id: `bmxnz-${slug(parsed.name)}`,
    name: parsed.name,
    country: 'New Zealand',
    countryCode: 'NZ',
    state,
    county: geocodeResult?.county,
    district: bmxnzRegion,
    region: 'Oceania',
    source: 'BMX New Zealand',
    sourceUrl,
    sourceTrackId: `bmxnz-clubs:${index + 1}`,
    address: parsed.address,
    city: geocodeResult?.city ?? parsed.city,
    postalCode: geocodeResult?.postcode,
    latitude: geocodeResult?.latitude,
    longitude: geocodeResult?.longitude,
    coordinateSource: geocodeResult ? 'Nominatim geocode from BMXNZ address' : undefined,
    coordinateAccuracy: geocodeResult ? `geocoded-${geocodeResult.addresstype ?? geocodeResult.type ?? 'address'}` : 'address-only',
    lengthMeters: 350,
    elevationMeters: 0,
    surface: 'BMX Racing track',
    routeStatus: geocodeResult ? 'locator-only' : 'estimated',
    sourceRecord: {
      provider: 'BMXNZ',
      sourcePage: sourceUrl,
      listedRegion: bmxnzRegion,
      listedLine: entry.line,
      geocode: geocodeResult ? {
        provider: 'OpenStreetMap Nominatim',
        query: geocodeResult.query,
        category: geocodeResult.category,
        type: geocodeResult.type,
        addresstype: geocodeResult.addresstype,
        importance: geocodeResult.importance,
        osmType: geocodeResult.osmType,
        osmId: geocodeResult.osmId,
      } : undefined,
    },
  });
}

tracks.sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));

await mkdir(new URL('../data/imports/', import.meta.url), { recursive: true });
await mkdir(new URL('../data/geocode-cache/', import.meta.url), { recursive: true });
await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
await writeFile(outputPath, `${JSON.stringify({
  source: sourceUrl,
  count: tracks.length,
  notes: 'Official BMXNZ page text says 32 clubs; current visible club list contains 31 club records.',
  tracks,
}, null, 2)}\n`);

console.log(`Imported ${tracks.length} BMXNZ club records into ${outputPath.pathname}`);
