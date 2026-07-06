#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { envValue, loadEnvFiles, parseEnvText, redacted } from './env-utils.mjs';

const squareVersion = '2025-10-16';
const loadedEnv = loadEnvFiles();
const args = new Set(process.argv.slice(2));
const environment = args.has('--production')
  ? 'production'
  : args.has('--sandbox')
    ? 'sandbox'
    : envValue('SQUARE_ENVIRONMENT', loadedEnv) || 'sandbox';
const apiBase = environment === 'production'
  ? 'https://connect.squareup.com'
  : 'https://connect.squareupsandbox.com';
const accessToken = envValue('SQUARE_ACCESS_TOKEN', loadedEnv);
const writeEnvLocal = args.has('--write-env-local');
const configuredLocationId = envValue('SQUARE_LOCATION_ID', loadedEnv);

const planName = 'TrackLab BMX Racer';
const currency = 'USD';
const variations = [
  { seats: 1, name: 'TrackLab BMX Racer - 1 Wattbike', amount: 999, env: 'SQUARE_RACER_PLAN_VARIATION_1_BIKE' },
  { seats: 2, name: 'TrackLab BMX Racer - 2 Wattbikes', amount: 1498, env: 'SQUARE_RACER_PLAN_VARIATION_2_BIKES' },
  { seats: 3, name: 'TrackLab BMX Racer - 3 Wattbikes', amount: 1997, env: 'SQUARE_RACER_PLAN_VARIATION_3_BIKES' },
  { seats: 4, name: 'TrackLab BMX Racer - 4 Wattbikes', amount: 2496, env: 'SQUARE_RACER_PLAN_VARIATION_4_BIKES' },
];

function usage() {
  console.error(`Usage:
  SQUARE_ACCESS_TOKEN=... npm run billing:square:setup -- --production
  SQUARE_ACCESS_TOKEN=... SQUARE_LOCATION_ID=... npm run billing:square:setup -- --sandbox --write-env-local

Options:
  --production       Use the production Square API.
  --sandbox          Use the Square sandbox API.
  --write-env-local  Update .env.local with the location and plan variation IDs.
`);
}

if (!accessToken) {
  usage();
  console.error('Missing SQUARE_ACCESS_TOKEN. Create or copy a Square access token first.');
  process.exit(1);
}

async function squareFetch(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Square-Version': squareVersion,
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = Array.isArray(payload.errors)
      ? payload.errors.map((error) => error.detail || error.code).filter(Boolean).join('; ')
      : '';
    throw new Error(message || `Square API ${path} failed with HTTP ${response.status}`);
  }

  return payload;
}

async function listLocations() {
  const payload = await squareFetch('/v2/locations');
  return Array.isArray(payload.locations) ? payload.locations : [];
}

async function searchCatalogObjects() {
  const objects = [];
  let cursor;

  do {
    const payload = await squareFetch('/v2/catalog/search', {
      method: 'POST',
      body: JSON.stringify({
        object_types: ['SUBSCRIPTION_PLAN', 'SUBSCRIPTION_PLAN_VARIATION'],
        include_deleted_objects: false,
        cursor,
      }),
    });
    objects.push(...(Array.isArray(payload.objects) ? payload.objects : []));
    cursor = payload.cursor;
  } while (cursor);

  return objects;
}

function findExistingPlan(objects) {
  return objects.find((object) => object.type === 'SUBSCRIPTION_PLAN'
    && object.subscription_plan_data?.name === planName);
}

function phasePriceMoney(phase) {
  return phase?.pricing?.price_money ?? phase?.recurring_price_money ?? null;
}

function findExistingVariation(objects, planId, variation) {
  return objects.find((object) => object.type === 'SUBSCRIPTION_PLAN_VARIATION'
    && object.subscription_plan_variation_data?.subscription_plan_id === planId
    && object.subscription_plan_variation_data?.name === variation.name
    && object.subscription_plan_variation_data?.phases?.some((phase) => (
      phasePriceMoney(phase)?.amount === variation.amount
      && phasePriceMoney(phase)?.currency === currency
    )));
}

function buildPlanObject() {
  return {
    type: 'SUBSCRIPTION_PLAN',
    id: '#tracklab-bmx-racer-plan',
    present_at_all_locations: true,
    subscription_plan_data: {
      name: planName,
      all_items: true,
    },
  };
}

function buildVariationObject(variation, planId) {
  return {
    type: 'SUBSCRIPTION_PLAN_VARIATION',
    id: `#tracklab-bmx-racer-${variation.seats}-bike-monthly`,
    present_at_all_locations: true,
    subscription_plan_variation_data: {
      name: variation.name,
      subscription_plan_id: planId,
      phases: [
        {
          ordinal: 0,
          cadence: 'MONTHLY',
          pricing: {
            type: 'STATIC',
            price_money: {
              amount: variation.amount,
              currency,
            },
          },
        },
      ],
    },
  };
}

async function upsertCatalogObjects(objects) {
  if (objects.length === 0) {
    return [];
  }

  const payload = await squareFetch('/v2/catalog/batch-upsert', {
    method: 'POST',
    body: JSON.stringify({
      idempotency_key: randomUUID(),
      batches: [{ objects }],
    }),
  });

  return Array.isArray(payload.objects) ? payload.objects : [];
}

function updateEnvLocal(values) {
  const path = '.env.local';
  const existingText = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const existing = parseEnvText(existingText);
  const next = {
    ...existing,
    SQUARE_ENVIRONMENT: environment,
    SQUARE_VERSION: squareVersion,
    ...values,
  };
  const orderedKeys = [
    ...Object.keys(existing),
    'SQUARE_ENVIRONMENT',
    'SQUARE_VERSION',
    'SQUARE_LOCATION_ID',
    ...variations.map((variation) => variation.env),
  ].filter((key, index, all) => all.indexOf(key) === index);

  const text = `${orderedKeys
    .filter((key) => Object.prototype.hasOwnProperty.call(next, key))
    .map((key) => `${key}=${next[key] ?? ''}`)
    .join('\n')}\n`;

  writeFileSync(path, text);
}

const locations = await listLocations();
const activeLocations = locations.filter((location) => location.status === 'ACTIVE');
const selectedLocation = configuredLocationId
  ? locations.find((location) => location.id === configuredLocationId)
  : activeLocations[0] ?? locations[0];

if (!selectedLocation?.id) {
  throw new Error('No Square location was found for this access token.');
}

const catalogObjects = await searchCatalogObjects();
let plan = findExistingPlan(catalogObjects);
let currentObjects = catalogObjects;

if (!plan) {
  const created = await upsertCatalogObjects([buildPlanObject()]);
  plan = findExistingPlan(created) ?? created.find((object) => object.type === 'SUBSCRIPTION_PLAN');
  currentObjects = [...currentObjects, ...created];
}

if (!plan?.id) {
  throw new Error('Square did not return a subscription plan ID.');
}

const missingVariations = variations.filter((variation) => !findExistingVariation(currentObjects, plan.id, variation));
const createdVariations = await upsertCatalogObjects(
  missingVariations.map((variation) => buildVariationObject(variation, plan.id)),
);
currentObjects = [...currentObjects, ...createdVariations];

const envValues = {
  SQUARE_LOCATION_ID: selectedLocation.id,
};
for (const variation of variations) {
  const object = findExistingVariation(currentObjects, plan.id, variation);
  if (!object?.id) {
    throw new Error(`Square did not return a plan variation ID for ${variation.name}.`);
  }
  envValues[variation.env] = object.id;
}

if (writeEnvLocal) {
  updateEnvLocal(envValues);
}

console.log(`Square billing setup complete for ${environment}.`);
console.log(`Access token: ${redacted(accessToken)}`);
console.log(`Location: ${selectedLocation.name || selectedLocation.id} (${selectedLocation.id})`);
console.log(`Created/reused plan: ${planName} (${plan.id})`);
console.log('');
console.log('Add these server-only env vars to Render:');
console.log(`SQUARE_ENVIRONMENT=${environment}`);
console.log(`SQUARE_VERSION=${squareVersion}`);
console.log('SQUARE_ACCESS_TOKEN=<the Square access token you used>');
for (const [key, value] of Object.entries(envValues)) {
  console.log(`${key}=${value}`);
}

if (writeEnvLocal) {
  console.log('');
  console.log('Updated .env.local with the non-token Square values.');
}
