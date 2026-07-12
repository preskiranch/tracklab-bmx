import { readFile } from 'node:fs/promises';

const databasePath = new URL('../public/data/track-database.json', import.meta.url);
const locatorDatabasePath = new URL('../public/data/track-locator.json', import.meta.url);
const database = JSON.parse(await readFile(databasePath, 'utf8'));
const locatorDatabase = JSON.parse(await readFile(locatorDatabasePath, 'utf8'));
const providers = new Map((database.providers ?? []).map((provider) => [provider.id, provider]));
const tracks = database.tracks ?? [];
const errors = [];
const warnings = [];
const ids = new Set();

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isOfficial(track) {
  return ['official-track-directory', 'federation-directory'].includes(track.verificationStatus);
}

for (const track of tracks) {
  const label = track.id || track.name || 'unknown track';
  if (!track.id) {
    errors.push(`${label}: missing id`);
  } else if (ids.has(track.id)) {
    errors.push(`${label}: duplicate id`);
  } else {
    ids.add(track.id);
  }

  for (const field of ['name', 'country', 'countryCode', 'state', 'source', 'sourceUrl']) {
    if (!String(track[field] ?? '').trim()) {
      errors.push(`${label}: missing ${field}`);
    }
  }

  const latitude = Number(track.latitude);
  const longitude = Number(track.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    errors.push(`${label}: invalid latitude`);
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    errors.push(`${label}: invalid longitude`);
  }
  if (!isHttpUrl(track.sourceUrl)) {
    errors.push(`${label}: invalid sourceUrl`);
  }
  if (track.websiteUrl && !isHttpUrl(track.websiteUrl)) {
    errors.push(`${label}: invalid websiteUrl`);
  }
  if (track.providerId && !providers.has(track.providerId)) {
    errors.push(`${label}: unknown providerId ${track.providerId}`);
  }

  if (isOfficial(track)) {
    if (!track.providerId) {
      errors.push(`${label}: official record is missing providerId`);
    }
    if (!String(track.address ?? '').trim()) {
      errors.push(`${label}: official record is missing an address`);
    }
    if (!['provider-address', 'provider-approximate', 'reverse-geocoded'].includes(track.addressStatus)) {
      errors.push(`${label}: official record has unsupported addressStatus ${track.addressStatus ?? 'missing'}`);
    }
  }

  if (track.verificationStatus === 'supplemental' && track.addressStatus === 'unverified') {
    warnings.push(`${label}: supplemental location still needs address verification`);
  }
}

if (Number(database.trackCount) !== tracks.length) {
  errors.push(`trackCount is ${database.trackCount}, but tracks contains ${tracks.length} records`);
}

const locatorTracks = Array.isArray(locatorDatabase.tracks) ? locatorDatabase.tracks : [];
if (Number(locatorDatabase.trackCount) !== tracks.length || locatorTracks.length !== tracks.length) {
  errors.push(`public locator contains ${locatorTracks.length} of ${tracks.length} tracks`);
}
const locatorIds = new Set(locatorTracks.map((track) => track.id));
for (const track of tracks) {
  if (!locatorIds.has(track.id)) {
    errors.push(`${track.id}: missing from public locator`);
  }
}
for (const track of locatorTracks) {
  const label = track.id || track.name || 'unknown locator track';
  if (!String(track.name ?? '').trim() || !String(track.country ?? '').trim()) {
    errors.push(`${label}: public locator is missing identifying fields`);
  }
  if (!Number.isFinite(Number(track.latitude)) || !Number.isFinite(Number(track.longitude))) {
    errors.push(`${label}: public locator is missing coordinates`);
  }
  if (track.websiteUrl && !isHttpUrl(track.websiteUrl)) {
    errors.push(`${label}: public locator has invalid websiteUrl`);
  }
}

const summary = tracks.reduce((result, track) => {
  const status = track.verificationStatus ?? 'unverified';
  result[status] = (result[status] ?? 0) + 1;
  return result;
}, {});

console.log(`Validated ${tracks.length} tracks across ${database.coverage?.countries ?? 'unknown'} countries.`);
console.table(summary);
if (warnings.length > 0) {
  console.warn(`${warnings.length} catalog warnings (first 20):`);
  warnings.slice(0, 20).forEach((warning) => console.warn(`- ${warning}`));
}
if (errors.length > 0) {
  console.error(`${errors.length} catalog validation errors:`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exitCode = 1;
}
