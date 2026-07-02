import pg from 'pg';

const { Pool } = pg;

const schema = 'tracklab';
const tables = ['profiles', 'rooms', 'room_members', 'room_messages', 'challenges', 'race_results'];
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

async function createSchema(client) {
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.profiles (
      guest_key TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      available BOOLEAN NOT NULL DEFAULT false,
      bike_count INTEGER NOT NULL DEFAULT 0,
      current_track JSONB NOT NULL DEFAULT '{}'::jsonb,
      last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.rooms (
      id TEXT PRIMARY KEY,
      host_guest_key TEXT,
      host_name TEXT,
      private BOOLEAN NOT NULL DEFAULT true,
      track JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      closed_at TIMESTAMPTZ
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.room_members (
      room_id TEXT NOT NULL REFERENCES ${schema}.rooms(id) ON DELETE CASCADE,
      guest_key TEXT NOT NULL,
      display_name TEXT NOT NULL,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      left_at TIMESTAMPTZ,
      PRIMARY KEY (room_id, guest_key)
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.room_messages (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES ${schema}.rooms(id) ON DELETE CASCADE,
      author_guest_key TEXT,
      author_name TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.challenges (
      id TEXT PRIMARY KEY,
      from_guest_key TEXT NOT NULL,
      from_name TEXT NOT NULL,
      to_guest_key TEXT NOT NULL,
      to_name TEXT NOT NULL,
      track JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      room_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      responded_at TIMESTAMPTZ
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.race_results (
      id BIGSERIAL PRIMARY KEY,
      dedupe_key TEXT UNIQUE NOT NULL,
      room_id TEXT NOT NULL,
      guest_key TEXT NOT NULL,
      rider_name TEXT NOT NULL,
      player_id INTEGER NOT NULL,
      track_id TEXT NOT NULL,
      track_name TEXT NOT NULL,
      rank INTEGER NOT NULL,
      finish_time_ms INTEGER,
      distance_meters DOUBLE PRECISION NOT NULL DEFAULT 0,
      top_speed_kph DOUBLE PRECISION,
      average_speed_kph DOUBLE PRECISION,
      top_cadence DOUBLE PRECISION,
      average_cadence DOUBLE PRECISION,
      top_watts DOUBLE PRECISION,
      average_watts DOUBLE PRECISION,
      summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_tracklab_profiles_available ON ${schema}.profiles (available, last_seen DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_tracklab_rooms_created ON ${schema}.rooms (created_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_tracklab_results_track ON ${schema}.race_results (track_id, created_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_tracklab_results_speed ON ${schema}.race_results (track_id, top_speed_kph DESC NULLS LAST)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_tracklab_results_rpm ON ${schema}.race_results (track_id, top_cadence DESC NULLS LAST)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_tracklab_results_watts ON ${schema}.race_results (track_id, top_watts DESC NULLS LAST)`);
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
  const sourceClient = await sourcePool.connect();
  const targetClient = await targetPool.connect();

  try {
    await createSchema(targetClient);
    await targetClient.query('BEGIN');

    const copied = [];
    for (const table of tables) {
      if (!(await tableExists(sourceClient, table))) {
        copied.push({ table, copied: 0, skipped: true });
        continue;
      }

      const columns = await columnsFor(sourceClient, table);
      const quotedColumns = columns.map((column) => `"${column}"`).join(', ');
      const sourceRows = await sourceClient.query(`SELECT ${quotedColumns} FROM ${schema}.${table}`);

      let count = 0;
      for (const row of sourceRows.rows) {
        const values = columns.map((column) => normalizeValue(row[column]));
        const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
        await targetClient.query(
          `INSERT INTO ${schema}.${table} (${quotedColumns}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
          values,
        );
        count += 1;
      }

      copied.push({ table, copied: count });
    }

    await targetClient.query(
      `SELECT setval(pg_get_serial_sequence('${schema}.race_results', 'id'), COALESCE((SELECT MAX(id) FROM ${schema}.race_results), 1), true)`,
    );
    await targetClient.query('COMMIT');

    const verify = [];
    for (const table of tables) {
      const result = await targetClient.query(`SELECT COUNT(*)::int AS count FROM ${schema}.${table}`);
      verify.push({ table, count: result.rows[0].count });
    }

    console.log(JSON.stringify({ ok: true, copied, verify }, null, 2));
  } catch (error) {
    await targetClient.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    sourceClient.release();
    targetClient.release();
    await sourcePool.end();
    await targetPool.end();
  }
}

migrate().catch((error) => {
  console.error(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
