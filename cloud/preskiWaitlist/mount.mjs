import { createApp } from './server/app.mjs';
import { loadConfig } from './server/config.mjs';
import { createDatabasePool } from './server/database.mjs';
import { runMigrations } from './server/migrate.mjs';
import { InMemoryIpRateLimiter } from './server/security.mjs';

const prefix = '/api/preski-labs/';

// Isolated additive schema and bounded pool. Never changes TrackLab accounts,
// beta grants, Apple groups, billing, or the TrackLab migration ledger.
async function initialize(environment) {
  const config = loadConfig({ ...environment, WAITLIST_DB_POOL_SIZE: '2', TRUST_PROXY: '1' });
  const pool = createDatabasePool(config);
  try {
    await runMigrations(pool);
    return createApp({ pool, config, rateLimiter: new InMemoryIpRateLimiter({
      maxRequests: config.rateLimitMax,
      windowMs: config.rateLimitWindowMs,
      trustProxy: config.trustProxy,
    }) });
  } catch (error) {
    await pool.end();
    throw error;
  }
}

export function createPreskiWaitlistMount(environment = process.env, setup = initialize) {
  const enabled = environment.PRESKI_WAITLIST_ENABLED === '1';
  // A waitlist failure must not interrupt live races or the main application's health.
  const ready = enabled ? setup(environment).catch(() => {
    console.error('Preski Labs waitlist initialization failed; waitlist unavailable.');
    return null;
  }) : Promise.resolve(null);

  return function routePreskiWaitlist(request, response) {
    if (!String(request.url || '').startsWith(prefix)) return false;
    void ready.then(async (handler) => {
      if (!handler) {
        response.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ ok: false, message: 'The waitlist is temporarily unavailable. Please try again.' }));
        return;
      }
      request.url = '/api/' + request.url.slice(prefix.length);
      await handler(request, response);
    }).catch(() => {
      if (!response.headersSent && !response.destroyed) {
        response.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ ok: false, message: 'The waitlist is temporarily unavailable. Please try again.' }));
      }
    });
    return true;
  };
}
