import { createOvertureBikeShopCatalog } from '../cloud/overtureBikeShops.mjs';

const artifactPath = process.argv[2] || undefined;
const expectedRelease = process.env.TRACKLAB_OVERTURE_RELEASE || '2026-08-19.0';
const expectedMinimumConfidence = Number(
  process.env.TRACKLAB_OVERTURE_MINIMUM_CONFIDENCE || 0.50,
);
const minimumGlobalRecords = Number(
  process.env.TRACKLAB_OVERTURE_MINIMUM_RECORDS || 75_000,
);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function semanticName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const catalog = createOvertureBikeShopCatalog(
  artifactPath ? { artifactUrl: artifactPath } : {},
);
const stats = await catalog.stats();
invariant(
  stats.schemaVersion === 2 && stats.format === 'tracklab-overture-bike-shop-ndjson-v1',
  'The catalog must use the bounded-memory schema version 2 artifact format.',
);
invariant(stats.release === expectedRelease, `Expected Overture release ${expectedRelease}; received ${stats.release || 'none'}.`);
invariant(
  stats.minimumConfidence === expectedMinimumConfidence,
  `Expected confidence threshold ${expectedMinimumConfidence}; received ${stats.minimumConfidence}.`,
);
invariant(
  Number.isInteger(stats.count) && stats.count >= minimumGlobalRecords,
  `The catalog has ${stats.count || 0} shops; at least ${minimumGlobalRecords} are required for the global release.`,
);
invariant(/^[0-9a-f]{64}$/u.test(stats.inputSha256 || ''), 'The catalog input SHA-256 is missing or invalid.');
invariant(/^[0-9a-f]{64}$/u.test(stats.catalogSha256 || ''), 'The catalog record SHA-256 is missing or invalid.');
invariant(
  stats.sourceProvenanceEncoding === 'dataset|license|provider|update_time',
  'The catalog source-provenance encoding is missing or unexpected.',
);
invariant(
  stats.licenses?.includes('CDLA-Permissive-2.0')
    && stats.licenses?.includes('Apache-2.0'),
  'The catalog license manifest is incomplete.',
);

const countryHierarchy = await catalog.hierarchy();
invariant(countryHierarchy.items.length >= 50, 'The catalog does not contain a credible global country directory.');
invariant(
  countryHierarchy.items.some((item) => item.value === 'US' && item.count > 1_000),
  'The global hierarchy is missing expected United States coverage.',
);
invariant(
  countryHierarchy.items.some((item) => item.value === 'AU' && item.count > 0),
  'The global hierarchy is missing Australia coverage.',
);

const vacaville = await catalog.search({
  latitude: 38.3566,
  longitude: -121.9877,
  radiusMiles: 20,
});
const byName = new Map(vacaville.map((shop) => [semanticName(shop.name), shop]));
const requiredVacavilleNames = ["Ray's Cycle", 'Precision Bicycle', 'Bike Closet'];
for (const requiredName of requiredVacavilleNames) {
  const shop = byName.get(semanticName(requiredName));
  invariant(shop, `The catalog is missing the known Vacaville-area shop: ${requiredName}.`);
  invariant(
    Array.isArray(shop.source?.catalogProvenance) && shop.source.catalogProvenance.length > 0,
    `${requiredName} is missing its upstream source lineage.`,
  );
}

console.log(JSON.stringify({
  valid: true,
  release: stats.release,
  records: stats.count,
  minimumConfidence: stats.minimumConfidence,
  countries: countryHierarchy.items.length,
  australiaShops: countryHierarchy.items.find((item) => item.value === 'AU')?.count || 0,
  knownVacavilleShops: requiredVacavilleNames,
  inputSha256: stats.inputSha256,
  catalogSha256: stats.catalogSha256,
}, null, 2));
