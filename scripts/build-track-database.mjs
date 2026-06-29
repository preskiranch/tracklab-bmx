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

function normalizeTrack(track) {
  const lengthMeters = Number(track.lengthMeters ?? 350);
  const id = track.id || slug(`${track.country || 'unknown'}-${track.state || 'track'}-${track.name}`);

  return {
    id,
    name: track.name,
    country: track.country,
    countryCode: track.countryCode,
    state: track.state,
    region: track.region,
    source: track.source,
    sourceUrl: track.sourceUrl,
    lengthMeters,
    elevationMeters: Number(track.elevationMeters ?? 0),
    surface: track.surface ?? 'BMX race track',
    outline: Array.isArray(track.outline) ? track.outline : [],
    zones: Array.isArray(track.zones) ? track.zones : createZones(lengthMeters),
    leaderboards: track.leaderboards ?? { rpm: [], speed: [], watts: [] },
  };
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
[...seedTracks, ...importedTracks].map(normalizeTrack).forEach((track) => {
  byId.set(track.id, track);
});

const database = {
  generatedAt: new Date().toISOString(),
  providerCount: providers.length,
  trackCount: byId.size,
  providers,
  tracks: [...byId.values()].sort((a, b) => a.name.localeCompare(b.name)),
};

await mkdir(new URL('../public/data/', import.meta.url), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(database, null, 2)}\n`);

const relativeOutput = path.relative(repoRoot.pathname, outputPath.pathname);
console.log(`Built ${relativeOutput} with ${database.trackCount} tracks from ${database.providerCount} providers.`);
