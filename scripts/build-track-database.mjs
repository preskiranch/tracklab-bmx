import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants as zlibConstants, gzip } from 'node:zlib';
import ts from 'typescript';

const repoRoot = new URL('..', import.meta.url);
const importsDir = new URL('../data/imports/', import.meta.url);
const providersPath = new URL('../data/providers.json', import.meta.url);
const seedCatalogPath = new URL('../src/data/trackCatalog.ts', import.meta.url);
const outputPath = new URL('../public/data/track-database.json', import.meta.url);
const brotliOutputPath = new URL('../public/data/track-database.json.br', import.meta.url);
const gzipOutputPath = new URL('../public/data/track-database.json.gz', import.meta.url);
const locatorOutputPath = new URL('../public/data/track-locator.json', import.meta.url);
const locatorBrotliOutputPath = new URL('../public/data/track-locator.json.br', import.meta.url);
const locatorGzipOutputPath = new URL('../public/data/track-locator.json.gz', import.meta.url);
const brotliCompressAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

function slug(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function createZones(lengthMeters) {
  const template = [
    ['z1', 'Start hill', 0, 0.12, 'pedal'],
    ['z2', 'First straight', 0.12, 0.28, 'pedal'],
    ['z3', 'First turn', 0.28, 0.39, 'technical'],
    ['z4', 'Rhythm section', 0.39, 0.58, 'pedal'],
    ['z5', 'Second turn', 0.58, 0.7, 'technical'],
    ['z6', 'Final straight', 0.7, 0.9, 'pedal'],
    ['z7', 'Finish', 0.9, 1, 'recovery'],
  ];

  return template.map(([id, name, start, end, type]) => ({
    id,
    name,
    startMeter: Math.round(lengthMeters * start),
    endMeter: Math.round(lengthMeters * end),
    type,
  }));
}

function fallbackGeometry(track) {
  const lat = Number(track.latitude);
  const lng = Number(track.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { outline: [], centerline: [] };
  }

  const lngScale = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const latRadius = 0.00022;
  const lngRadius = latRadius / lngScale;
  const centerline = [
    { lat: lat - latRadius * 0.72, lng: lng + lngRadius * 0.62 },
    { lat: lat - latRadius * 0.95, lng },
    { lat: lat - latRadius * 0.48, lng: lng - lngRadius * 0.72 },
    { lat: lat + latRadius * 0.38, lng: lng - lngRadius * 0.8 },
    { lat: lat + latRadius * 0.88, lng: lng - lngRadius * 0.12 },
    { lat: lat + latRadius * 0.58, lng: lng + lngRadius * 0.74 },
    { lat: lat - latRadius * 0.15, lng: lng + lngRadius * 0.86 },
  ];
  const outline = [
    { lat: lat - latRadius * 1.18, lng: lng + lngRadius * 0.86 },
    { lat: lat - latRadius * 1.22, lng: lng - lngRadius * 0.54 },
    { lat: lat - latRadius * 0.28, lng: lng - lngRadius * 1.22 },
    { lat: lat + latRadius * 1.16, lng: lng - lngRadius * 0.72 },
    { lat: lat + latRadius * 1.2, lng: lng + lngRadius * 0.72 },
    { lat: lat + latRadius * 0.08, lng: lng + lngRadius * 1.24 },
    { lat: lat - latRadius * 1.18, lng: lng + lngRadius * 0.86 },
  ];

  return { outline, centerline };
}

function normalizeHttpUrl(value) {
  if (!value) {
    return undefined;
  }

  const trimmed = String(value).trim();
  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : /^(?:www\.)?facebook\.com\//i.test(trimmed)
      ? `https://${trimmed}`
      : undefined;
  if (!candidate) {
    return undefined;
  }

  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:' ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function isFacebookUrl(value) {
  const normalized = normalizeHttpUrl(value);
  if (!normalized) {
    return false;
  }

  const hostname = new URL(normalized).hostname.toLowerCase();
  return hostname === 'facebook.com' || hostname.endsWith('.facebook.com');
}

function normalizeTrack(track) {
  const lengthMeters = Number(track.lengthMeters ?? 350);
  const id = track.id || slug(`${track.country || 'unknown'}-${track.state || 'track'}-${track.name}`);
  const geometry = fallbackGeometry(track);
  const outline = Array.isArray(track.outline) && track.outline.length > 0 ? track.outline : geometry.outline;
  const centerline = Array.isArray(track.centerline) && track.centerline.length > 1 ? track.centerline : geometry.centerline;
  const locatorPoint = track.startGate ?? centerline[0] ?? outline[0];
  const latitude = Number.isFinite(Number(track.latitude)) ? Number(track.latitude) : Number(locatorPoint?.lat);
  const longitude = Number.isFinite(Number(track.longitude)) ? Number(track.longitude) : Number(locatorPoint?.lng);
  const normalizedWebsiteUrl = normalizeHttpUrl(track.websiteUrl);
  const normalizedFacebookUrl = normalizeHttpUrl(track.facebookUrl);
  const websiteUrl = isFacebookUrl(normalizedWebsiteUrl) ? undefined : normalizedWebsiteUrl;
  const facebookUrl = normalizedFacebookUrl
    ?? (isFacebookUrl(normalizedWebsiteUrl) ? normalizedWebsiteUrl : undefined);

  return {
    id,
    name: track.name,
    country: track.country,
    countryCode: track.countryCode,
    state: track.state,
    region: track.region,
    source: track.source,
    sourceUrl: track.sourceUrl,
    sourceTrackId: track.sourceTrackId,
    providerId: track.providerId,
    sourceType: track.sourceType,
    verificationStatus: track.verificationStatus,
    addressStatus: track.addressStatus,
    lastVerifiedAt: track.lastVerifiedAt,
    address: track.address,
    city: track.city,
    county: track.county,
    district: track.district,
    postalCode: track.postalCode,
    latitude: Number.isFinite(latitude) ? latitude : undefined,
    longitude: Number.isFinite(longitude) ? longitude : undefined,
    coordinateSource: track.coordinateSource,
    coordinateAccuracy: track.coordinateAccuracy,
    websiteUrl,
    facebookUrl,
    instagramUrl: track.instagramUrl,
    lengthMeters,
    elevationMeters: Number(track.elevationMeters ?? 0),
    surface: track.surface ?? 'BMX race track',
    outline,
    centerline,
    startGate: track.startGate ?? centerline[0] ?? outline[0],
    finishLine: track.finishLine ?? centerline[centerline.length - 1] ?? outline[outline.length - 1],
    routeStatus: track.routeStatus ?? (track.latitude && track.longitude ? 'locator-only' : 'estimated'),
    zones: Array.isArray(track.zones) ? track.zones : createZones(lengthMeters),
    leaderboards: track.leaderboards ?? { rpm: [], speed: [], watts: [] },
    sourceRecord: track.sourceRecord,
  };
}

function meaningfulGeometry(track) {
  return track.routeStatus && track.routeStatus !== 'locator-only';
}

const verificationRanks = {
  unverified: 0,
  supplemental: 1,
  'reference-only': 2,
  'federation-directory': 3,
  'official-track-directory': 4,
};

const provenanceFields = [
  'id',
  'name',
  'country',
  'countryCode',
  'state',
  'region',
  'source',
  'sourceUrl',
  'sourceTrackId',
  'providerId',
  'sourceType',
  'verificationStatus',
  'addressStatus',
  'lastVerifiedAt',
  'address',
  'city',
  'county',
  'district',
  'postalCode',
  'latitude',
  'longitude',
  'coordinateSource',
  'coordinateAccuracy',
  'websiteUrl',
  'facebookUrl',
  'instagramUrl',
  'sourceRecord',
];

function verificationRank(track) {
  return verificationRanks[track.verificationStatus] ?? 0;
}

function provenanceQuality(track) {
  return verificationRank(track) * 100
    + (track.address ? 12 : 0)
    + (Number.isFinite(Number(track.latitude)) && Number.isFinite(Number(track.longitude)) ? 8 : 0)
    + (track.sourceTrackId ? 4 : 0)
    + (track.lastVerifiedAt ? 2 : 0)
    + (track.coordinateSource ? 1 : 0);
}

function mergeTrack(existing, incoming) {
  const existingHasRoute = meaningfulGeometry(existing);
  const incomingHasRoute = meaningfulGeometry(incoming);
  const merged = { ...existing };
  Object.entries(incoming).forEach(([key, value]) => {
    if (value !== undefined) {
      merged[key] = value;
    }
  });
  merged.leaderboards = Object.values(incoming.leaderboards ?? {}).some((entries) => entries.length > 0)
    ? incoming.leaderboards
    : existing.leaderboards;

  if (existingHasRoute && !incomingHasRoute) {
    merged.outline = existing.outline;
    merged.centerline = existing.centerline;
    merged.startGate = existing.startGate;
    merged.finishLine = existing.finishLine;
    merged.routeStatus = existing.routeStatus;
    merged.lengthMeters = existing.lengthMeters;
    merged.elevationMeters = existing.elevationMeters;
    merged.surface = existing.surface;
    merged.zones = existing.zones;
  }

  const authoritative = provenanceQuality(incoming) > provenanceQuality(existing) ? incoming : existing;
  provenanceFields.forEach((field) => {
    if (authoritative[field] !== undefined) {
      merged[field] = authoritative[field];
    }
  });

  if (existingHasRoute !== incomingHasRoute) {
    merged.id = existingHasRoute ? existing.id : incoming.id;
  }

  return merged;
}

const genericFacilityWords = new Set([
  'arena',
  'bmx',
  'centre',
  'center',
  'club',
  'course',
  'circuit',
  'piste',
  'pista',
  'race',
  'racing',
  'stadium',
  'track',
]);

function facilityTokens(name) {
  return slug(name)
    .split('-')
    .filter((token) => token && !genericFacilityWords.has(token));
}

function namesIdentifySameFacility(left, right) {
  const leftTokens = facilityTokens(left);
  const rightTokens = facilityTokens(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return false;
  }
  const leftSet = new Set(leftTokens);
  const shared = rightTokens.filter((token) => leftSet.has(token)).length;
  return shared / Math.min(leftTokens.length, rightTokens.length) >= 0.75;
}

function namesStronglyIdentifySameFacility(left, right) {
  const leftTokens = facilityTokens(left).sort();
  const rightTokens = facilityTokens(right).sort();
  return leftTokens.length >= 2
    && leftTokens.length === rightTokens.length
    && leftTokens.every((token, index) => token === rightTokens[index]);
}

function distanceMeters(left, right) {
  const latitude1 = Number(left.latitude) * Math.PI / 180;
  const latitude2 = Number(right.latitude) * Math.PI / 180;
  const deltaLatitude = latitude2 - latitude1;
  const deltaLongitude = (Number(right.longitude) - Number(left.longitude)) * Math.PI / 180;
  const a = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(deltaLongitude / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function dedupeCatalogTracks(tracks) {
  const reconciled = [];
  const ordered = [...tracks].sort((left, right) => verificationRank(right) - verificationRank(left));
  for (const track of ordered) {
    const duplicateIndex = reconciled.findIndex((candidate) => {
      if (candidate.countryCode !== track.countryCode) {
        return false;
      }
      if (
        String(candidate.state ?? '').toLowerCase() === String(track.state ?? '').toLowerCase()
        && namesStronglyIdentifySameFacility(candidate.name, track.name)
      ) {
        return true;
      }
      const distance = distanceMeters(candidate, track);
      return distance <= 30
        || (distance <= 250 && namesIdentifySameFacility(candidate.name, track.name));
    });
    if (duplicateIndex < 0) {
      reconciled.push(track);
      continue;
    }
    reconciled[duplicateIndex] = mergeTrack(reconciled[duplicateIndex], track);
  }
  return reconciled;
}

async function loadSeedCatalog() {
  const source = await readFile(seedCatalogPath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString('base64')}`;
  const module = await import(moduleUrl);
  return module.trackCatalog ?? [];
}

async function loadImportedTracks() {
  const files = await readdir(importsDir);
  const jsonFiles = files.filter((file) => file.endsWith('.json'));
  const imports = await Promise.all(jsonFiles.map(async (file) => {
    const content = await readFile(new URL(file, importsDir), 'utf8');
    const parsed = JSON.parse(content);
    const tracks = Array.isArray(parsed) ? parsed : parsed.tracks ?? [];
    return tracks.map((track) => ({
      ...track,
      providerId: track.providerId ?? parsed.providerId,
      lastVerifiedAt: track.lastVerifiedAt ?? parsed.generatedAt,
    }));
  }));

  return imports.flat();
}

const [providers, seedTracks, importedTracks] = await Promise.all([
  readFile(providersPath, 'utf8').then(JSON.parse),
  loadSeedCatalog(),
  loadImportedTracks(),
]);

const providersById = new Map(providers.map((provider) => [provider.id, provider]));
const sourceProviderIds = new Map([
  ['USA BMX', 'usabmx'],
  ['USA BMX / BMX Canada', 'usabmx'],
  ['Fédération Française de Cyclisme', 'ffc-bmx-racing'],
  ['BMX New Zealand', 'bmxnz'],
  ['AusCycling', 'auscycling'],
  ['British Cycling', 'british-cycling'],
  ['Cycling Canada', 'cycling-canada'],
  ['UCI', 'uci'],
  ['OpenStreetMap Overpass', 'openstreetmap-overpass'],
]);

function applyProviderMetadata(track) {
  const providerId = track.providerId ?? sourceProviderIds.get(track.source);
  const provider = providersById.get(providerId);
  return {
    ...track,
    providerId,
    sourceType: track.sourceType ?? provider?.sourceType,
    verificationStatus: track.verificationStatus ?? provider?.verificationStatus ?? 'unverified',
    addressStatus: track.addressStatus ?? (track.address
      ? track.coordinateAccuracy?.startsWith('provider') ? 'provider-address' : 'reverse-geocoded'
      : track.latitude && track.longitude ? 'coordinates-only' : 'unverified'),
  };
}

const byId = new Map();
[...importedTracks, ...seedTracks].map(applyProviderMetadata).map(normalizeTrack).forEach((track) => {
  const existing = byId.get(track.id);
  byId.set(track.id, existing ? mergeTrack(existing, track) : track);
});

const catalogTracks = dedupeCatalogTracks([...byId.values()]);

const databaseBody = {
  providerCount: providers.length,
  trackCount: catalogTracks.length,
  providers,
  coverage: {
    countries: new Set(catalogTracks.map((track) => track.country)).size,
    officialRecords: catalogTracks.filter((track) => ['official-track-directory', 'federation-directory'].includes(track.verificationStatus)).length,
    supplementalRecords: catalogTracks.filter((track) => track.verificationStatus === 'supplemental').length,
    recordsByCountry: Object.fromEntries(catalogTracks.reduce((counts, track) => {
      counts.set(track.country, (counts.get(track.country) ?? 0) + 1);
      return counts;
    }, new Map()).entries()),
  },
  tracks: catalogTracks.sort((a, b) => a.name.localeCompare(b.name)),
};
const existingDatabase = await readFile(outputPath, 'utf8').then(JSON.parse).catch(() => null);
const existingBody = existingDatabase
  ? { ...existingDatabase, generatedAt: undefined }
  : null;
const nextBody = { ...databaseBody, generatedAt: undefined };
const generatedAt = existingBody && JSON.stringify(existingBody) === JSON.stringify(nextBody)
  ? existingDatabase.generatedAt
  : new Date().toISOString();
const database = {
  generatedAt,
  ...databaseBody,
};
const locatorFields = [
  'id',
  'name',
  'country',
  'countryCode',
  'state',
  'region',
  'source',
  'address',
  'city',
  'county',
  'district',
  'postalCode',
  'latitude',
  'longitude',
  'websiteUrl',
  'facebookUrl',
];
const locatorDatabase = {
  generatedAt,
  trackCount: database.trackCount,
  coverage: database.coverage,
  tracks: database.tracks.map((track) => Object.fromEntries(
    locatorFields
      .filter((field) => track[field] !== undefined)
      .map((field) => [field, track[field]]),
  )),
};

await mkdir(new URL('../public/data/', import.meta.url), { recursive: true });
const serializedDatabase = `${JSON.stringify(database, null, 2)}\n`;
const databaseBytes = Buffer.from(serializedDatabase);
const locatorBytes = Buffer.from(`${JSON.stringify(locatorDatabase)}\n`);
const [brotliBytes, gzipBytes, locatorBrotliBytes, locatorGzipBytes] = await Promise.all([
  brotliCompressAsync(databaseBytes, {
    params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
  }),
  gzipAsync(databaseBytes, { level: 9 }),
  brotliCompressAsync(locatorBytes, {
    params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
  }),
  gzipAsync(locatorBytes, { level: 9 }),
]);
await Promise.all([
  writeFile(outputPath, databaseBytes),
  writeFile(brotliOutputPath, brotliBytes),
  writeFile(gzipOutputPath, gzipBytes),
  writeFile(locatorOutputPath, locatorBytes),
  writeFile(locatorBrotliOutputPath, locatorBrotliBytes),
  writeFile(locatorGzipOutputPath, locatorGzipBytes),
]);

const relativeOutput = path.relative(repoRoot.pathname, outputPath.pathname);
console.log(
  `Built ${relativeOutput} with ${database.trackCount} tracks from ${database.providerCount} providers `
  + `(${databaseBytes.length} raw / ${brotliBytes.length} br / ${gzipBytes.length} gzip bytes).`,
);
console.log(
  `Built public/data/track-locator.json for public search `
  + `(${locatorBytes.length} raw / ${locatorBrotliBytes.length} br / ${locatorGzipBytes.length} gzip bytes).`,
);
