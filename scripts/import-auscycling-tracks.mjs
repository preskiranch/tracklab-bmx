import { mkdir, writeFile } from 'node:fs/promises';

const sourceUrl = 'https://auscycling.org.au/find-a-club';
const apiBase = 'https://func-prod-finder-api.azurewebsites.net/api/v2/public-api/club-finder';
const outputPath = new URL('../data/imports/auscycling-official.json', import.meta.url);
const perPage = 100;

function slug(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function primaryLocation(club) {
  return club.locations?.find((location) => location.isPrimary) ?? club.locations?.[0];
}

function addressFor(location) {
  const address = location?.address ?? {};
  const street = [address.addressLine1, address.addressLine2].map(clean).filter(Boolean).join(', ');
  const locality = [address.suburb, address.state, address.postcode, address.country]
    .map(clean)
    .filter(Boolean)
    .join(', ');
  return [street, locality].filter(Boolean).join(', ');
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'TrackLabBMX/0.1 (official AusCycling club import; https://github.com/preskiranch/tracklab-bmx)',
    },
  });
  if (!response.ok) {
    throw new Error(`AusCycling import failed: ${response.status} ${response.statusText}`);
  }
  return { payload: await response.json(), headers: response.headers };
}

const { payload: filterPayload } = await fetchJson(`${apiBase}/filters?page=1&perPage=${perPage}`);
const bmxTag = filterPayload.data?.find((filter) => filter.type === 'discipline' && filter.name === 'BMX');
if (!bmxTag?.id) {
  throw new Error('AusCycling BMX discipline filter was not found.');
}

const clubs = [];
let page = 1;
let totalPages = 1;
do {
  const url = new URL(`${apiBase}/clubs`);
  url.searchParams.set('page', page);
  url.searchParams.set('perPage', perPage);
  url.searchParams.set('tags', bmxTag.id);
  const { payload, headers } = await fetchJson(url);
  clubs.push(...(payload.data ?? []));
  totalPages = Number(headers.get('x-total-pages') ?? 1);
  page += 1;
} while (page <= totalPages);

const tracks = clubs
  .map((club) => {
    const location = primaryLocation(club);
    const [longitude, latitude] = location?.geometry?.coordinates ?? [];
    const address = location?.address ?? {};
    if (!club.id || !club.name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }

    return {
      id: `auscycling-${slug(club.name)}-${club.id.slice(-6)}`,
      name: clean(club.name),
      country: 'Australia',
      countryCode: 'AU',
      state: clean(address.state) || 'Unspecified',
      region: 'Oceania',
      providerId: 'auscycling',
      source: 'AusCycling',
      sourceUrl,
      sourceTrackId: club.id,
      sourceType: 'national-federation-club-directory',
      verificationStatus: 'federation-directory',
      addressStatus: location.isApproximate ? 'provider-approximate' : 'provider-address',
      address: addressFor(location) || clean(location.name),
      city: clean(address.suburb),
      postalCode: clean(address.postcode),
      latitude,
      longitude,
      coordinateSource: 'AusCycling Club Finder API',
      coordinateAccuracy: location.isApproximate ? 'provider-approximate' : 'provider-coordinate',
      websiteUrl: clean(club.website) || undefined,
      lengthMeters: 350,
      elevationMeters: 0,
      surface: 'BMX Racing club location',
      routeStatus: 'locator-only',
      sourceRecord: {
        provider: 'AusCycling',
        api: apiBase,
        clubId: club.id,
        locationId: location.id,
        locationName: location.name,
        isPrimary: location.isPrimary,
        isApproximate: location.isApproximate,
        tags: club.tags,
      },
    };
  })
  .filter(Boolean)
  .sort((left, right) => left.state.localeCompare(right.state) || left.name.localeCompare(right.name));

await mkdir(new URL('../data/imports/', import.meta.url), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({
  providerId: 'auscycling',
  source: sourceUrl,
  api: apiBase,
  count: tracks.length,
  generatedAt: new Date().toISOString(),
  notes: 'Official AusCycling BMX-affiliated club locations. A club directory record identifies an affiliated BMX location; riders still verify and map the racing centerline in TrackLab.',
  tracks,
}, null, 2)}\n`);

console.log(`Imported ${tracks.length} AusCycling BMX club records into ${outputPath.pathname}`);
