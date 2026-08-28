import pg from 'pg';
import { runDatabaseMigrations } from '../cloud/migrations.mjs';

const { Pool } = pg;

const schema = 'tracklab';
const tables = [
  'profiles',
  'auth_users',
  'auth_sessions',
  'billing_checkouts',
  'apple_iap_lineage_token_bindings',
  'apple_iap_subscriptions',
  'apple_iap_transactions',
  'apple_iap_notifications',
  'wattbike_connection_leases',
  'rooms',
  'room_members',
  'room_messages',
  'challenges',
  'friend_requests',
  'friendships',
  'groups',
  'group_members',
  'group_invites',
  'race_results',
  'user_data',
  'public_track_mappings',
  'ghost_laps',
];
const sourceUrl = process.env.TRACKLAB_SOURCE_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
const targetUrl = process.env.TRACKLAB_TARGET_DATABASE_URL?.trim();

if (!sourceUrl || !targetUrl) {
  throw new Error('Set TRACKLAB_SOURCE_DATABASE_URL or DATABASE_URL, plus TRACKLAB_TARGET_DATABASE_URL.');
}

if (sourceUrl === targetUrl) {
  throw new Error('Source and target database URLs are identical.');
}

function poolFor(connectionString) {
  return new Pool({
    connectionString,
    max: 4,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    ssl: connectionString.includes('render.com') || connectionString.includes('oregon-postgres')
      ? { rejectUnauthorized: false }
      : undefined,
  });
}

async function tableExists(client, table) {
  const result = await client.query('SELECT to_regclass($1) AS name', [`${schema}.${table}`]);
  return Boolean(result.rows[0]?.name);
}

async function columnsFor(client, table) {
  const result = await client.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2
     ORDER BY ordinal_position`,
    [schema, table],
  );

  return result.rows.map((row) => row.column_name);
}

function normalizeValue(value) {
  if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    return JSON.stringify(value);
  }

  return value;
}

async function migrate() {
  const sourcePool = poolFor(sourceUrl);
  const targetPool = poolFor(targetUrl);
  let sourceClient = null;
  let targetClient = null;
  let transactionOpen = false;

  try {
    const schemaMigration = await runDatabaseMigrations(targetPool, { schema });
    sourceClient = await sourcePool.connect();
    targetClient = await targetPool.connect();
    await targetClient.query('BEGIN');
    transactionOpen = true;

    const copied = [];
    for (const table of tables) {
      if (!(await tableExists(sourceClient, table))) {
        copied.push({ table, sourceRows: 0, inserted: 0, skipped: true });
        continue;
      }

      const columns = await columnsFor(sourceClient, table);
      const quotedColumns = columns.map((column) => `"${column}"`).join(', ');
      const sourceRows = await sourceClient.query(`SELECT ${quotedColumns} FROM ${schema}.${table}`);

      let inserted = 0;
      for (const row of sourceRows.rows) {
        const values = columns.map((column) => normalizeValue(row[column]));
        const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
        const insertResult = await targetClient.query(
          `INSERT INTO ${schema}.${table} (${quotedColumns}) VALUES (${placeholders}) ON CONFLICT DO NOTHING RETURNING 1`,
          values,
        );
        inserted += insertResult.rowCount ?? 0;
      }

      copied.push({ table, sourceRows: sourceRows.rowCount ?? sourceRows.rows.length, inserted });
    }

    await targetClient.query(
      `SELECT setval(
        pg_get_serial_sequence('${schema}.race_results', 'id'),
        COALESCE((SELECT MAX(id) FROM ${schema}.race_results), 1),
        EXISTS (SELECT 1 FROM ${schema}.race_results)
      )`,
    );
    await targetClient.query('COMMIT');
    transactionOpen = false;

    const verify = [];
    for (const table of tables) {
      const result = await targetClient.query(`SELECT COUNT(*)::int AS count FROM ${schema}.${table}`);
      verify.push({ table, count: result.rows[0].count });
    }

    console.log(JSON.stringify({ ok: true, schemaMigration, copied, verify }, null, 2));
  } catch (error) {
    if (transactionOpen) {
      await targetClient?.query('ROLLBACK').catch(() => {});
    }
    throw error;
  } finally {
    sourceClient?.release();
    targetClient?.release();
    await sourcePool.end();
    await targetPool.end();
  }
}

migrate().catch((error) => {
  console.error(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
