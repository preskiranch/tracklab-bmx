import { mkdir, writeFile } from 'node:fs/promises';

const endpoint = 'https://www.usabmx.com/api/backend/bmx-tracks';
const outputPath = new URL('../data/imports/usa-bmx-official.json', import.meta.url);
const countryMap = {
  CAN: { country: 'Canada', countryCode: 'CA', region: 'North America', source: 'USA BMX / BMX Canada' },
  CUW: { country: 'Curacao', countryCode: 'CW', region: 'Caribbean', source: 'USA BMX' },
  USA: { country: 'United States', countryCode: 'US', region: 'North America', source: 'USA BMX' },
};
const idOverrides = {
  'north-bay-bmx': 'north-bay-bmx-napa-valley',
};
const stateNames = {
  AK: 'Alaska',
  AL: 'Alabama',
  AR: 'Arkansas',
  AZ: 'Arizona',
  BC: 'British Columbia',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  IA: 'Iowa',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  MA: 'Massachusetts',
  MD: 'Maryland',
  MI: 'Michigan',
  MN: 'Minnesota',
  MO: 'Missouri',
  MS: 'Mississippi',
  MT: 'Montana',
  NC: 'North Carolina',
  ND: 'North Dakota',
  NE: 'Nebraska',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NV: 'Nevada',
  NY: 'New York',
  OH: 'Ohio',
  OK: 'Oklahoma',
  ON: 'Ontario',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VA: 'Virginia',
  VT: 'Vermont',
  WA: 'Washington',
  WI: 'Wisconsin',
  WY: 'Wyoming',
};

function slug(value) {
  return String(value)
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

function cleanState(record) {
  const abbreviation = String(record.state_abbreviation ?? '').trim().toUpperCase();
  if (stateNames[abbreviation]) {
    return stateNames[abbreviation];
  }

  const state = String(record.state ?? '').trim();
  return state ? titleCase(state) : 'Unspecified';
}

function cleanAddress(record) {
  const locality = [record.city, record.state_abbreviation, record.postal_code].filter(Boolean).join(', ');
  return [record.address_line_1, locality].filter(Boolean).join(', ');
}

function normalize(record) {
  const country = countryMap[record.country] ?? {
    country: titleCase(record.country),
    countryCode: String(record.country ?? '').slice(0, 2).toUpperCase(),
    region: 'Global',
    source: 'USA BMX',
  };
  const baseId = slug(record.name);
  const id = idOverrides[baseId] ?? baseId;
  const latitude = Number(record.latitude);
  const longitude = Number(record.longitude);

  return {
    id,
    name: record.name,
    country: country.country,
    countryCode: country.countryCode,
    state: cleanState(record),
    region: country.region,
    source: country.source,
    sourceUrl: 'https://www.usabmx.com/tracks/find-tracks',
    sourceTrackId: String(record.xref_track_number ?? record.id),
    address: cleanAddress(record),
    city: titleCase(record.city),
    postalCode: String(record.postal_code ?? ''),
    latitude,
    longitude,
    facebookUrl: record.facebook_url ?? undefined,
    instagramUrl: record.instagram_url ?? undefined,
    lengthMeters: 350,
    elevationMeters: 0,
    surface: record.indoor ? 'Indoor BMX race track' : 'Outdoor BMX race track',
    routeStatus: 'locator-only',
    sourceRecord: {
      provider: 'USA BMX',
      endpoint,
      id: record.id,
      xrefTrackNumber: record.xref_track_number,
    },
  };
}

const response = await fetch(`${endpoint}?page=1&limit=0`);
if (!response.ok) {
  throw new Error(`USA BMX track import failed: ${response.status} ${response.statusText}`);
}

const payload = await response.json();
const tracks = (payload.data ?? [])
  .filter((track) => track.active !== false && track.name && track.latitude && track.longitude)
  .map(normalize)
  .sort((a, b) => a.country.localeCompare(b.country) || a.state.localeCompare(b.state) || a.name.localeCompare(b.name));

await mkdir(new URL('../data/imports/', import.meta.url), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({ source: endpoint, count: tracks.length, tracks }, null, 2)}\n`);

console.log(`Imported ${tracks.length} USA BMX/BMX Canada locator records into ${outputPath.pathname}`);
