import { readFile } from 'node:fs/promises';
import { validateFederationPair, validateFederationRegistry } from './lib/track-federations.mjs';

const databasePath = new URL('../public/data/track-database.json', import.meta.url);
const locatorDatabasePath = new URL('../public/data/track-locator.json', import.meta.url);
const federationsPath = new URL('../data/federations.json', import.meta.url);
const database = JSON.parse(await readFile(databasePath, 'utf8'));
const locatorDatabase = JSON.parse(await readFile(locatorDatabasePath, 'utf8'));
const federationRegistry = JSON.parse(await readFile(federationsPath, 'utf8'));
const providers = new Map((database.providers ?? []).map((provider) => [provider.id, provider]));
const tracks = database.tracks ?? [];
const errors = [];
const warnings = [];
const ids = new Set();

errors.push(...validateFederationRegistry(federationRegistry));

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isServiceUrl(value, service) {
  if (!isHttpUrl(value)) {
    return false;
  }

  const hostname = new URL(value).hostname.toLowerCase();
  return hostname === `${service}.com` || hostname.endsWith(`.${service}.com`);
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
  if (track.facebookUrl && !isHttpUrl(track.facebookUrl)) {
    errors.push(`${label}: invalid facebookUrl`);
  }
  if (track.facebookUrl && !isServiceUrl(track.facebookUrl, 'facebook')) {
    errors.push(`${label}: facebookUrl is not hosted by Facebook`);
  }
  if (track.instagramUrl && !isServiceUrl(track.instagramUrl, 'instagram')) {
    errors.push(`${label}: invalid instagramUrl`);
  }
  errors.push(...validateFederationPair(track, label));
  if (!String(track.federationName ?? '').trim()) {
    errors.push(`${label}: missing federation assignment`);
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
const locatorTracksById = new Map(locatorTracks.map((track) => [track.id, track]));
for (const track of tracks) {
  const locatorTrack = locatorTracksById.get(track.id);
  if (!locatorTrack) {
    errors.push(`${track.id}: missing from public locator`);
    continue;
  }
  for (const field of ['websiteUrl', 'facebookUrl', 'instagramUrl', 'federationName', 'federationUrl']) {
    if (locatorTrack[field] !== track[field]) {
      errors.push(`${track.id}: public locator does not preserve ${field}`);
    }
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
  if (track.facebookUrl && !isHttpUrl(track.facebookUrl)) {
    errors.push(`${label}: public locator has invalid facebookUrl`);
  }
  if (track.facebookUrl && !isServiceUrl(track.facebookUrl, 'facebook')) {
    errors.push(`${label}: public locator facebookUrl is not hosted by Facebook`);
  }
  if (track.instagramUrl && !isServiceUrl(track.instagramUrl, 'instagram')) {
    errors.push(`${label}: public locator has invalid instagramUrl`);
  }
  errors.push(...validateFederationPair(track, `public locator ${label}`));
  if (!String(track.federationName ?? '').trim()) {
    errors.push(`${label}: public locator is missing federation assignment`);
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
