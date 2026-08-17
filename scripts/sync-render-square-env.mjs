#!/usr/bin/env node
import { envValue, loadEnvFiles, redacted } from './env-utils.mjs';

const loadedEnv = loadEnvFiles();
const serviceId = envValue('RENDER_SERVICE_ID', loadedEnv) || 'srv-d92ufvcvikkc73b6872g';
const renderApiKey = envValue('RENDER_API_KEY', loadedEnv);
const deployAfterSync = process.argv.includes('--deploy');
const apiBase = 'https://api.render.com/v1';

const squareKeys = [
  'SQUARE_ENVIRONMENT',
  'SQUARE_VERSION',
  'SQUARE_ACCESS_TOKEN',
  'SQUARE_LOCATION_ID',
  'SQUARE_RACER_PLAN_VARIATION_ID',
];

const values = Object.fromEntries(squareKeys.map((key) => [key, envValue(key, loadedEnv)]));
values.SQUARE_ENVIRONMENT ||= 'production';
values.SQUARE_VERSION ||= '2025-10-16';
values.SQUARE_RACER_PLAN_VARIATION_ID ||= envValue('SQUARE_RACER_PLAN_VARIATION_1_BIKE', loadedEnv);

const missing = squareKeys.filter((key) => !values[key]);
if (!renderApiKey) {
  console.error('Missing RENDER_API_KEY. Create a Render API key, then set it in your shell or .env.local.');
  process.exit(1);
}

if (missing.length > 0) {
  console.error(`Missing Square env vars: ${missing.join(', ')}`);
  console.error('Run npm run billing:square:setup first, or add the Square values to .env.local.');
  process.exit(1);
}

async function renderFetch(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${renderApiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...options.headers,
    },
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const message = payload.message || payload.error || payload.raw || `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

async function putEnvVar(key, value) {
  const attempts = [
    {
      method: 'PUT',
      path: `/services/${serviceId}/env-vars/${encodeURIComponent(key)}`,
      body: { value },
    },
    {
      method: 'PATCH',
      path: `/services/${serviceId}/env-vars/${encodeURIComponent(key)}`,
      body: { value },
    },
    {
      method: 'POST',
      path: `/services/${serviceId}/env-vars`,
      body: [{ key, value }],
    },
  ];

  let lastError;
  for (const attempt of attempts) {
    try {
      return await renderFetch(attempt.path, {
        method: attempt.method,
        body: JSON.stringify(attempt.body),
      });
    } catch (error) {
      lastError = error;
      if (![404, 405].includes(Number(error.status))) {
        throw error;
      }
    }
  }

  throw lastError;
}

for (const key of squareKeys) {
  await putEnvVar(key, values[key]);
  const shownValue = key.includes('TOKEN') ? redacted(values[key]) : values[key];
  console.log(`Synced ${key}=${shownValue}`);
}

if (deployAfterSync) {
  await renderFetch(`/services/${serviceId}/deploys`, {
    method: 'POST',
    body: JSON.stringify({ clearCache: 'do_not_clear' }),
  });
  console.log(`Triggered Render deploy for ${serviceId}.`);
} else {
  console.log('Render env sync complete. Redeploy the service so the new values are loaded.');
}
