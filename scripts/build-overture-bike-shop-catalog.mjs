import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';

const inputPath = process.argv[2];
const outputPath = process.argv[3] || 'data/bike-shops/overture-bicycle-shops.json.gz';
const minimumConfidence = Number(process.env.TRACKLAB_OVERTURE_MINIMUM_CONFIDENCE || 0.50);
const release = process.env.TRACKLAB_OVERTURE_RELEASE || '2026-08-19.0';

if (!inputPath) {
  console.error('Usage: node scripts/build-overture-bike-shop-catalog.mjs <extract.ndjson[.gz]> [output.json.gz]');
  process.exit(1);
}
if (!Number.isFinite(minimumConfidence) || minimumConfidence < 0 || minimumConfidence > 1) {
  throw new Error('TRACKLAB_OVERTURE_MINIMUM_CONFIDENCE must be between 0 and 1.');
}

function text(value, maximumLength = 500) {
  return typeof value === 'string' ? value.trim().slice(0, maximumLength) : '';
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstText(value, maximumLength) {
  return (Array.isArray(value) ? value : [value])
    .map((entry) => text(entry, maximumLength))
    .find(Boolean) || '';
}

function sourceProvenance(value) {
  return [...new Set((Array.isArray(value) ? value : [value])
    .map((entry) => text(entry, 500))
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 32);
}

function safeWebsite(value) {
  for (const candidate of Array.isArray(value) ? value : [value]) {
    try {
      const url = new URL(text(candidate, 500));
      if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) {
        return url.toString();
      }
    } catch {
      // Continue to another public website candidate.
    }
  }
  return '';
}

function semanticName(value) {
  return text(value, 180)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    // The directory is global. Preserve letters and numbers from every
    // writing system so valid non-Latin business names are not discarded.
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function radians(degrees) {
  return degrees * Math.PI / 180;
}

function distanceMeters(left, right) {
  const latitudeDelta = radians(right.latitude - left.latitude);
  const longitudeDelta = radians(right.longitude - left.longitude);
  const startLatitude = radians(left.latitude);
  const endLatitude = radians(right.latitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_008.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function candidateFromExtract(record) {
  const id = text(record?.id, 160);
  const name = text(record?.name, 180);
  const latitude = number(record?.latitude);
  const longitude = number(record?.longitude);
  const category = text(record?.category, 80);
  const confidence = number(record?.confidence);
  const status = text(record?.operating_status, 80).toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(id)
    || !name || !semanticName(name)
    || latitude === null || latitude < -90 || latitude > 90
    || longitude === null || longitude < -180 || longitude > 180
    || !['bike_store', 'bike_repair_maintenance'].includes(category)
    || confidence === null || confidence < minimumConfidence || confidence > 1
    || ['closed', 'permanently_closed'].includes(status)
  ) return null;
  return {
    id,
    name,
    latitude,
    longitude,
    line1: text(record?.address, 240),
    locality: text(record?.locality, 160),
    region: text(record?.region, 160),
    postalCode: text(record?.postal_code, 40),
    countryCode: text(record?.country_code, 8).toUpperCase(),
    website: safeWebsite(record?.websites ?? record?.website),
    phone: firstText(record?.phones ?? record?.phone, 80),
    category,
    confidence,
    sourceProvenance: sourceProvenance(record?.source_provenance),
  };
}

function richness(candidate) {
  return [
    candidate.line1,
    candidate.locality,
    candidate.region,
    candidate.postalCode,
    candidate.countryCode,
    candidate.website,
    candidate.phone,
  ].filter(Boolean).length;
}

function priority(left, right) {
  return right.confidence - left.confidence
    || richness(right) - richness(left)
    || left.id.localeCompare(right.id);
}

function combineCategory(left, right) {
  return left === right ? left : 'bike_store_and_repair';
}

function cellKey(latitude, longitude) {
  return `${Math.floor(latitude * 500)}:${Math.floor(longitude * 500)}`;
}

function nearbyCellKeys(candidate) {
  const latitudeCell = Math.floor(candidate.latitude * 500);
  const longitudeCell = Math.floor(candidate.longitude * 500);
  const keys = [];
  for (let latitudeOffset = -1; latitudeOffset <= 1; latitudeOffset += 1) {
    for (let longitudeOffset = -1; longitudeOffset <= 1; longitudeOffset += 1) {
      keys.push(`${latitudeCell + latitudeOffset}:${longitudeCell + longitudeOffset}`);
    }
  }
  return keys;
}

const input = createReadStream(inputPath);
const inputHash = createHash('sha256');
input.on('data', (chunk) => inputHash.update(chunk));
const decoded = inputPath.endsWith('.gz') ? input.pipe(createGunzip()) : input;
const lines = createInterface({ input: decoded, crlfDelay: Infinity });
const candidates = [];
let rejected = 0;
for await (const line of lines) {
  if (!line.trim()) continue;
  try {
    const candidate = candidateFromExtract(JSON.parse(line));
    if (candidate) candidates.push(candidate);
    else rejected += 1;
  } catch {
    rejected += 1;
  }
}

candidates.sort(priority);
const accepted = [];
const cells = new Map();
let duplicates = 0;
for (const candidate of candidates) {
  const name = semanticName(candidate.name);
  let duplicateIndex = -1;
  for (const key of nearbyCellKeys(candidate)) {
    for (const index of cells.get(key) ?? []) {
      const existing = accepted[index];
      if (semanticName(existing.name) === name && distanceMeters(existing, candidate) <= 50) {
        duplicateIndex = index;
        break;
      }
    }
    if (duplicateIndex >= 0) break;
  }
  if (duplicateIndex >= 0) {
    const existing = accepted[duplicateIndex];
    existing.category = combineCategory(existing.category, candidate.category);
    for (const field of ['line1', 'locality', 'region', 'postalCode', 'countryCode', 'website', 'phone']) {
      if (!existing[field] && candidate[field]) existing[field] = candidate[field];
    }
    existing.sourceProvenance = [...new Set([
      ...existing.sourceProvenance,
      ...candidate.sourceProvenance,
    ])].sort((left, right) => left.localeCompare(right)).slice(0, 32);
    duplicates += 1;
    continue;
  }
  const index = accepted.length;
  accepted.push(candidate);
  const key = cellKey(candidate.latitude, candidate.longitude);
  const indexes = cells.get(key);
  if (indexes) indexes.push(index);
  else cells.set(key, [index]);
}

accepted.sort((left, right) => left.id.localeCompare(right.id));
function compactTuple(shop) {
  return [
    shop.id,
    shop.name,
    shop.latitude,
    shop.longitude,
    shop.line1,
    shop.locality,
    shop.region,
    shop.postalCode,
    shop.countryCode,
    shop.website,
    shop.phone,
    shop.category,
    Number(shop.confidence.toFixed(6)),
    shop.sourceProvenance,
  ];
}

const sourceQuery = "taxonomy.primary IN ('bike_store','bike_repair_maintenance') AND operating_status NOT IN ('closed','permanently_closed') AND confidence >= minimumConfidence";
const catalogHash = createHash('sha256');
catalogHash.update('[');
accepted.forEach((shop, index) => {
  if (index > 0) catalogHash.update(',');
  catalogHash.update(JSON.stringify(compactTuple(shop)));
});
catalogHash.update(']');
const catalogSha256 = catalogHash.digest('hex');
const artifact = {
  schemaVersion: 2,
  format: 'tracklab-overture-bike-shop-ndjson-v1',
  release,
  generatedAt: new Date().toISOString(),
  minimumConfidence,
  inputRecords: candidates.length + rejected,
  acceptedRecordsBeforeDedupe: candidates.length,
  recordCount: accepted.length,
  duplicatesMerged: duplicates,
  inputSha256: inputHash.digest('hex'),
  catalogSha256,
  sourceQuery,
  reproduction: 'See data/bike-shops/README.md and scripts/extract-overture-bike-shops.sql.',
  license: 'Overture Maps data: CDLA-Permissive-2.0 and compatible source licenses; see NOTICE.',
  licenses: ['CDLA-Permissive-2.0', 'Apache-2.0', 'CC0-1.0'],
  notices: ['data/bike-shops/NOTICE.md', 'data/bike-shops/Foursquare-NOTICE.txt'],
  sourceProvenanceEncoding: 'dataset|license|provider|update_time',
};

async function* artifactLines() {
  yield `${JSON.stringify(artifact)}\n`;
  for (const shop of accepted) yield `${JSON.stringify(compactTuple(shop))}\n`;
}

await mkdir(path.dirname(outputPath), { recursive: true });
await pipeline(
  Readable.from(artifactLines()),
  createGzip({ level: 9 }),
  createWriteStream(outputPath),
);
console.log(JSON.stringify({
  inputCandidates: candidates.length,
  outputShops: accepted.length,
  duplicatesMerged: duplicates,
  rejected,
  minimumConfidence,
  inputSha256: artifact.inputSha256,
  catalogSha256,
  release,
  outputPath,
}, null, 2));
