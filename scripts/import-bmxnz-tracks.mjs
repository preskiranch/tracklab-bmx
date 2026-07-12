import { mkdir, readFile, writeFile } from 'node:fs/promises';

const sourceUrl = 'https://www.bmxnz.co.nz/clubs';
const coordinateDirectoryUrl = 'https://bmx.net.nz/clubs/';
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

function canonicalClubName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\b(?:black gold|thunderbolts|sharks|franklin|taniwha|city|bmx|club|inc)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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

function parseCoordinateDirectory(html) {
  return [...html.matchAll(/class="lmm-geo-tags geo">\s*([^:<]+?):\s*<span class="latitude">(-?[0-9.]+)<\/span>,\s*<span class="longitude">(-?[0-9.]+)<\/span>/g)]
    .map((match) => ({
      name: decodeEntities(match[1]),
      canonicalName: canonicalClubName(match[1]),
      latitude: Number(match[2]),
      longitude: Number(match[3]),
    }))
    .filter((record) => Number.isFinite(record.latitude) && Number.isFinite(record.longitude));
}

function findDirectoryCoordinate(name, coordinateDirectory) {
  const canonicalName = canonicalClubName(name);
  return coordinateDirectory.find((record) => record.canonicalName === canonicalName)
    ?? coordinateDirectory.find((record) => (
      record.canonicalName.includes(canonicalName)
      || canonicalName.includes(record.canonicalName)
    ));
}

const reviewedOverrides = new Map(Object.entries({
  'mountain-raiders-bmx-club': {
    latitude: -36.903543025867215,
    longitude: 174.89565546885504,
    address: '2 Bells Road, Pakuranga Heights, Auckland 2010',
    city: 'Auckland',
    postalCode: '2010',
    coordinateSource: 'Mountain Raiders BMX official club map',
    evidenceUrl: 'https://mtrbmx.co.nz/',
  },
  'north-harbour-bmx-club': {
    latitude: -36.723131480032,
    longitude: 174.703806887709,
    address: 'Hooton Reserve, corner of Appian Way and Oteha Valley Road, Albany, Auckland 0632',
    city: 'Auckland',
    postalCode: '0632',
    coordinateSource: 'Geocode of current North Harbour BMX official club address',
    evidenceUrl: 'https://www.sporty.co.nz/nhbmx/Home',
  },
  'te-aroha-bmx-club': {
    latitude: -37.547022,
    longitude: 175.7032845,
    address: 'Boyd Park, Spur Street, Te Aroha 3320',
    city: 'Te Aroha',
    postalCode: '3320',
    coordinateSource: 'OpenStreetMap BMX track geometry matched to BMXNZ address',
    evidenceUrl: 'https://www.openstreetmap.org/way/1326373956',
  },
}));

const reviewedAddressCorrections = new Map(Object.entries({
  'east-city-bmx-club': {
    address: 'Merton Reserve, 78 Merton Road, Saint Johns, Auckland 1072',
    city: 'Auckland',
    postalCode: '1072',
    evidenceUrl: 'https://www.aucklandcouncil.govt.nz/en/parks-recreation/find-park-beach/park-detail/130.html',
  },
  'christchurch-city-bmx-club': {
    address: 'Kyle Park, 197 Waterloo Road, Hornby, Christchurch 8042',
    city: 'Christchurch',
    postalCode: '8042',
    evidenceUrl: 'https://www.cinch.org.nz/mobile/2875/entry/3062',
  },
  'north-avon-christchurch-bmx-club': {
    address: 'Bexley Park, 498 Pages Road, Bexley, Christchurch 8061',
    city: 'Christchurch',
    postalCode: '8061',
    evidenceUrl: 'https://www.sporty.co.nz/nacbmx',
  },
  'north-canterbury-bmx-club': {
    address: 'Ashley Picnic Ground, Millton Avenue, Rangiora, Canterbury 7400',
    city: 'Rangiora',
    postalCode: '7400',
    evidenceUrl: 'https://www.sporty.co.nz/northcanterburybmx/home-1',
  },
  'hawkes-bay-bmx-club': {
    address: '33 Romanes Drive, Havelock North 4130',
    city: 'Havelock North',
    postalCode: '4130',
    evidenceUrl: 'https://bmx.net.nz/clubs/',
  },
  'whangarei-bmx-club': {
    address: 'William Fraser Memorial Park, 200 Riverside Drive, Parahaki, Whangarei 0112',
    city: 'Whangarei',
    postalCode: '0112',
    evidenceUrl: 'https://bmx.net.nz/clubs/',
  },
  'cromwell-bmx-club': {
    address: 'Achil Street, Cromwell 9310',
    city: 'Cromwell',
    postalCode: '9310',
    evidenceUrl: 'https://bmx.net.nz/clubs/',
  },
  'kaitangata-bmx-club': {
    address: 'Corner of Eddystone Street and Exmouth Street, Kaitangata 9210',
    city: 'Kaitangata',
    postalCode: '9210',
    evidenceUrl: 'https://bmx.net.nz/clubs/',
  },
  'southland-bmx-club': {
    address: 'Elizabeth Park, Lime Street, Invercargill 9812',
    city: 'Invercargill',
    postalCode: '9812',
    evidenceUrl: 'https://southlandnz.com/listing/elizabeth-park/108/',
  },
  'hamilton-bmx-club': {
    address: 'Minogue Park, Moore Street, Forest Lake, Hamilton 3200',
    city: 'Hamilton',
    postalCode: '3200',
    evidenceUrl: 'https://bmx.net.nz/clubs/',
  },
  'taupo-bmx-club': {
    address: 'Crown Park, 115 Taharepa Road, Taupo 3330',
    city: 'Taupo',
    postalCode: '3330',
    evidenceUrl: 'https://taupobmx.org.nz/welcome/',
  },
  'hutt-valley-thunderbolts-bmx-club': {
    address: 'McLeod Park, 52 McLeod Street, Upper Hutt 5018',
    city: 'Upper Hutt',
    postalCode: '5018',
    evidenceUrl: 'https://bmx.net.nz/clubs/',
  },
  'kapiti-bmx-club': {
    address: 'Atiwa Park, corner of Donovan Road and Percival Road, Paraparaumu 5032',
    city: 'Paraparaumu',
    postalCode: '5032',
    evidenceUrl: 'https://bmx.net.nz/clubs/',
  },
}));

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
  if (cache[query]) {
    return cache[query];
  }

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'nz');
  url.searchParams.set('q', query);

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': userAgent },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      console.warn(`Nominatim geocode failed for "${query}": ${response.status} ${response.statusText}`);
      return null;
    }

    const payload = await response.json();
    cache[query] = normalizeNominatimResult(payload[0], query);
    await sleep(1100);
    return cache[query];
  } catch (error) {
    console.warn(`Nominatim geocode failed for "${query}": ${error.message}`);
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
let coordinateDirectory = [];
try {
  const coordinateResponse = await fetch(coordinateDirectoryUrl, {
    headers: { 'User-Agent': userAgent },
    signal: AbortSignal.timeout(20_000),
  });
  if (coordinateResponse.ok) {
    coordinateDirectory = parseCoordinateDirectory(await coordinateResponse.text());
  } else {
    console.warn(`BMX.NET.NZ coordinate directory failed: ${coordinateResponse.status} ${coordinateResponse.statusText}`);
  }
} catch (error) {
  console.warn(`BMX.NET.NZ coordinate directory failed: ${error.message}`);
}
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

  const recordSlug = slug(parsed.name);
  const reviewedOverride = reviewedOverrides.get(recordSlug);
  const addressCorrection = reviewedAddressCorrections.get(recordSlug);
  const directoryCoordinate = findDirectoryCoordinate(parsed.name, coordinateDirectory);
  const geocodeResult = reviewedOverride || directoryCoordinate ? null : await geocode(parsed, cache);
  const coordinate = reviewedOverride ?? directoryCoordinate ?? geocodeResult;
  const bmxnzRegion = regionFor(entry.index, regions);
  const state = geocodeResult?.state ?? titleCase(bmxnzRegion);
  const coordinateEvidenceUrl = reviewedOverride?.evidenceUrl
    ?? (directoryCoordinate ? coordinateDirectoryUrl : undefined);
  const normalizedAddress = reviewedOverride?.address ?? addressCorrection?.address ?? parsed.address;
  const normalizedCity = reviewedOverride?.city ?? addressCorrection?.city ?? geocodeResult?.city ?? parsed.city;
  const normalizedPostalCode = reviewedOverride?.postalCode ?? addressCorrection?.postalCode ?? geocodeResult?.postcode;

  tracks.push({
    id: `bmxnz-${recordSlug}`,
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
    address: normalizedAddress,
    city: normalizedCity,
    postalCode: normalizedPostalCode,
    latitude: coordinate?.latitude,
    longitude: coordinate?.longitude,
    coordinateSource: reviewedOverride?.coordinateSource
      ?? (directoryCoordinate ? 'BMX.NET.NZ track coordinate directory' : (geocodeResult ? 'Nominatim geocode from BMXNZ address' : undefined)),
    coordinateAccuracy: reviewedOverride
      ? 'reviewed-track-location'
      : (directoryCoordinate ? 'track-center' : (geocodeResult ? `geocoded-${geocodeResult.addresstype ?? geocodeResult.type ?? 'address'}` : 'address-only')),
    lengthMeters: 350,
    elevationMeters: 0,
    surface: 'BMX Racing track',
    routeStatus: coordinate ? 'locator-only' : 'estimated',
    sourceRecord: {
      provider: 'BMXNZ',
      sourcePage: sourceUrl,
      listedRegion: bmxnzRegion,
      listedLine: entry.line,
      normalizedAddressSource: reviewedOverride?.evidenceUrl ?? addressCorrection?.evidenceUrl,
      coordinateEvidence: coordinateEvidenceUrl ? {
        source: reviewedOverride?.coordinateSource ?? 'BMX.NET.NZ coordinate directory',
        url: coordinateEvidenceUrl,
        matchedName: directoryCoordinate?.name,
      } : undefined,
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
  providerId: 'bmxnz',
  source: sourceUrl,
  count: tracks.length,
  generatedAt: new Date().toISOString(),
  notes: 'Official BMXNZ page text says 32 clubs; current visible club list contains 31 club records.',
  tracks,
}, null, 2)}\n`);

console.log(`Imported ${tracks.length} BMXNZ club records into ${outputPath.pathname}`);
