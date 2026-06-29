import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const repoRoot = new URL('..', import.meta.url);
const importsDir = new URL('../data/imports/', import.meta.url);
const providersPath = new URL('../data/providers.json', import.meta.url);
const seedCatalogPath = new URL('../src/data/trackCatalog.ts', import.meta.url);
const outputPath = new URL('../public/data/track-database.json', import.meta.url);

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

function normalizeTrack(track) {
  const lengthMeters = Number(track.lengthMeters ?? 350);
  const id = track.id || slug(`${track.country || 'unknown'}-${track.state || 'track'}-${track.name}`);
  const geometry = fallbackGeometry(track);
  const outline = Array.isArray(track.outline) && track.outline.length > 0 ? track.outline : geometry.outline;
  const centerline = Array.isArray(track.centerline) && track.centerline.length > 1 ? track.centerline : geometry.centerline;

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
    address: track.address,
    city: track.city,
    postalCode: track.postalCode,
    latitude: Number.isFinite(Number(track.latitude)) ? Number(track.latitude) : undefined,
    longitude: Number.isFinite(Number(track.longitude)) ? Number(track.longitude) : undefined,
    websiteUrl: track.websiteUrl,
    facebookUrl: track.facebookUrl,
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
  };
}

function meaningfulGeometry(track) {
  return track.routeStatus && track.routeStatus !== 'locator-only';
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

  return merged;
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
    return Array.isArray(parsed) ? parsed : parsed.tracks ?? [];
  }));

  return imports.flat();
}

const [providers, seedTracks, importedTracks] = await Promise.all([
  readFile(providersPath, 'utf8').then(JSON.parse),
  loadSeedCatalog(),
  loadImportedTracks(),
]);

const byId = new Map();
[...importedTracks, ...seedTracks].map(normalizeTrack).forEach((track) => {
  const existing = byId.get(track.id);
  byId.set(track.id, existing ? mergeTrack(existing, track) : track);
});

const databaseBody = {
  providerCount: providers.length,
  trackCount: byId.size,
  providers,
  tracks: [...byId.values()].sort((a, b) => a.name.localeCompare(b.name)),
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

await mkdir(new URL('../public/data/', import.meta.url), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(database, null, 2)}\n`);

const relativeOutput = path.relative(repoRoot.pathname, outputPath.pathname);
console.log(`Built ${relativeOutput} with ${database.trackCount} tracks from ${database.providerCount} providers.`);
