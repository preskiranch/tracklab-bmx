import { createHash } from 'node:crypto';

export const TRACKLAB_SCHEMA = 'tracklab';

const identifierPattern = /^[a-z_][a-z0-9_]*$/i;

function validatedSchema(schema) {
  if (!identifierPattern.test(schema)) {
    throw new Error(`Invalid PostgreSQL schema identifier: ${schema}`);
  }
  return schema;
}

export function migrationChecksum(migration) {
  return createHash('sha256')
    .update(JSON.stringify({
      version: migration.version,
      name: migration.name,
      statements: migration.statements,
    }))
    .digest('hex');
}

export function databaseMigrations(schemaName = TRACKLAB_SCHEMA) {
  const schema = validatedSchema(schemaName);

  return [
    {
      version: 1,
      name: 'create TrackLab application tables',
      statements: [
        `CREATE TABLE IF NOT EXISTS ${schema}.profiles (
          guest_key TEXT PRIMARY KEY,
          display_name TEXT NOT NULL,
          email TEXT,
          membership_tier TEXT NOT NULL DEFAULT 'visitor',
          available BOOLEAN NOT NULL DEFAULT false,
          bike_count INTEGER NOT NULL DEFAULT 0,
          current_track JSONB NOT NULL DEFAULT '{}'::jsonb,
          last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`,
        `CREATE TABLE IF NOT EXISTS ${schema}.auth_users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          display_name TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          membership_tier TEXT NOT NULL DEFAULT 'spectator',
          bike_seats INTEGER NOT NULL DEFAULT 1,
          admin BOOLEAN NOT NULL DEFAULT false,
          square_customer_id TEXT,
          square_subscription_id TEXT,
          last_login TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`,
        `CREATE TABLE IF NOT EXISTS ${schema}.auth_sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES ${schema}.auth_users(id) ON DELETE CASCADE,
          token_hash TEXT UNIQUE NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
        )`,
        `CREATE TABLE IF NOT EXISTS ${schema}.billing_checkouts (
          state_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES ${schema}.auth_users(id) ON DELETE CASCADE,
          order_id TEXT UNIQUE NOT NULL,
          payment_link_id TEXT,
          bike_seats INTEGER NOT NULL,
          expected_amount_cents INTEGER NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          claimed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`,
        `CREATE TABLE IF NOT EXISTS ${schema}.rooms (
          id TEXT PRIMARY KEY,
          host_guest_key TEXT,
          host_name TEXT,
          private BOOLEAN NOT NULL DEFAULT true,
          track JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          closed_at TIMESTAMPTZ
        )`,
        `CREATE TABLE IF NOT EXISTS ${schema}.room_members (
          room_id TEXT NOT NULL REFERENCES ${schema}.rooms(id) ON DELETE CASCADE,
          guest_key TEXT NOT NULL,
          display_name TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'racer',
          seat_count INTEGER NOT NULL DEFAULT 1,
          joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          left_at TIMESTAMPTZ,
          PRIMARY KEY (room_id, guest_key)
        )`,
        `CREATE TABLE IF NOT EXISTS ${schema}.room_messages (
          id TEXT PRIMARY KEY,
          room_id TEXT NOT NULL REFERENCES ${schema}.rooms(id) ON DELETE CASCADE,
          author_guest_key TEXT,
          author_name TEXT NOT NULL,
          body TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`,
        `CREATE TABLE IF NOT EXISTS ${schema}.challenges (
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
        )`,
        `CREATE TABLE IF NOT EXISTS ${schema}.friend_requests (
          id TEXT PRIMARY KEY,
          from_guest_key TEXT NOT NULL,
          from_name TEXT NOT NULL,
          to_guest_key TEXT NOT NULL,
          to_name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          responded_at TIMESTAMPTZ
        )`,
        `CREATE TABLE IF NOT EXISTS ${schema}.friendships (
          guest_key_a TEXT NOT NULL,
          guest_key_b TEXT NOT NULL,
          display_name_a TEXT NOT NULL,
          display_name_b TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (guest_key_a, guest_key_b)
        )`,
        `CREATE TABLE IF NOT EXISTS ${schema}.groups (
          id TEXT PRIMARY KEY,
          owner_guest_key TEXT NOT NULL,
          name TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`,
        `CREATE TABLE IF NOT EXISTS ${schema}.group_members (
          group_id TEXT NOT NULL REFERENCES ${schema}.groups(id) ON DELETE CASCADE,
          guest_key TEXT NOT NULL,
          display_name TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'member',
          joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          left_at TIMESTAMPTZ,
          PRIMARY KEY (group_id, guest_key)
        )`,
        `CREATE TABLE IF NOT EXISTS ${schema}.group_invites (
          id TEXT PRIMARY KEY,
          group_id TEXT NOT NULL REFERENCES ${schema}.groups(id) ON DELETE CASCADE,
          from_guest_key TEXT NOT NULL,
          from_name TEXT NOT NULL,
          to_guest_key TEXT NOT NULL,
          to_name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          responded_at TIMESTAMPTZ
        )`,
        `CREATE TABLE IF NOT EXISTS ${schema}.race_results (
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
        )`,
        `CREATE TABLE IF NOT EXISTS ${schema}.user_data (
          guest_key TEXT PRIMARY KEY,
          track_mappings JSONB NOT NULL DEFAULT '{}'::jsonb,
          custom_routes JSONB NOT NULL DEFAULT '[]'::jsonb,
          bike_profiles JSONB NOT NULL DEFAULT '[]'::jsonb,
          studio_riders JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`,
        `CREATE TABLE IF NOT EXISTS ${schema}.public_track_mappings (
          track_id TEXT PRIMARY KEY,
          track_name TEXT NOT NULL,
          country TEXT NOT NULL,
          state TEXT NOT NULL,
          mapping JSONB NOT NULL,
          published_by TEXT,
          published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`,
        `CREATE TABLE IF NOT EXISTS ${schema}.ghost_laps (
          id TEXT PRIMARY KEY,
          owner_key TEXT NOT NULL,
          owner_name TEXT NOT NULL,
          rider_name TEXT NOT NULL,
          track_id TEXT NOT NULL,
          track_name TEXT NOT NULL,
          route_variant_id TEXT,
          route_key TEXT NOT NULL DEFAULT 'default',
          finish_time_ms INTEGER NOT NULL,
          thirty_foot_time_ms INTEGER,
          color_name TEXT NOT NULL DEFAULT 'lime',
          accent TEXT NOT NULL DEFAULT '#7ade36',
          race_source TEXT NOT NULL DEFAULT 'live',
          lap_count INTEGER NOT NULL DEFAULT 1,
          analytics_public BOOLEAN NOT NULL DEFAULT false,
          summary JSONB NOT NULL DEFAULT '{}'::jsonb,
          zone_results JSONB NOT NULL DEFAULT '[]'::jsonb,
          points JSONB NOT NULL DEFAULT '[]'::jsonb,
          saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (owner_key, rider_name, track_id, route_key)
        )`,
      ],
    },
    {
      version: 2,
      name: 'upgrade legacy schemas and remove demo ghosts',
      statements: [
        `ALTER TABLE ${schema}.profiles ADD COLUMN IF NOT EXISTS email TEXT`,
        `ALTER TABLE ${schema}.profiles ADD COLUMN IF NOT EXISTS membership_tier TEXT NOT NULL DEFAULT 'visitor'`,
        `ALTER TABLE ${schema}.auth_users ADD COLUMN IF NOT EXISTS membership_tier TEXT NOT NULL DEFAULT 'spectator'`,
        `ALTER TABLE ${schema}.auth_users ADD COLUMN IF NOT EXISTS bike_seats INTEGER NOT NULL DEFAULT 1`,
        `ALTER TABLE ${schema}.auth_users ADD COLUMN IF NOT EXISTS admin BOOLEAN NOT NULL DEFAULT false`,
        `ALTER TABLE ${schema}.auth_users ADD COLUMN IF NOT EXISTS square_customer_id TEXT`,
        `ALTER TABLE ${schema}.auth_users ADD COLUMN IF NOT EXISTS square_subscription_id TEXT`,
        `ALTER TABLE ${schema}.auth_users ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ`,
        `ALTER TABLE ${schema}.room_members ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'racer'`,
        `ALTER TABLE ${schema}.room_members ADD COLUMN IF NOT EXISTS seat_count INTEGER NOT NULL DEFAULT 1`,
        `ALTER TABLE ${schema}.user_data ADD COLUMN IF NOT EXISTS studio_riders JSONB NOT NULL DEFAULT '[]'::jsonb`,
        `ALTER TABLE ${schema}.ghost_laps ADD COLUMN IF NOT EXISTS lap_count INTEGER NOT NULL DEFAULT 1`,
        `ALTER TABLE ${schema}.ghost_laps ADD COLUMN IF NOT EXISTS race_source TEXT`,
        `UPDATE ${schema}.ghost_laps
         SET race_source = CASE WHEN rider_name ILIKE 'Demo Rider %' THEN 'demo' ELSE 'live' END
         WHERE race_source IS NULL`,
        `ALTER TABLE ${schema}.ghost_laps ALTER COLUMN race_source SET DEFAULT 'live'`,
        `ALTER TABLE ${schema}.ghost_laps ALTER COLUMN race_source SET NOT NULL`,
        `DELETE FROM ${schema}.ghost_laps WHERE race_source = 'demo'`,
        `ALTER TABLE ${schema}.ghost_laps ADD COLUMN IF NOT EXISTS analytics_public BOOLEAN NOT NULL DEFAULT false`,
        `ALTER TABLE ${schema}.ghost_laps ADD COLUMN IF NOT EXISTS zone_results JSONB NOT NULL DEFAULT '[]'::jsonb`,
      ],
    },
    {
      version: 3,
      name: 'create production query indexes',
      statements: [
        `CREATE INDEX IF NOT EXISTS idx_tracklab_profiles_available ON ${schema}.profiles (available, last_seen DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_rooms_created ON ${schema}.rooms (created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_room_messages_room_created ON ${schema}.room_messages (room_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_challenges_to_status ON ${schema}.challenges (to_guest_key, status, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_results_track ON ${schema}.race_results (track_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_results_speed ON ${schema}.race_results (track_id, top_speed_kph DESC NULLS LAST)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_results_rpm ON ${schema}.race_results (track_id, top_cadence DESC NULLS LAST)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_results_watts ON ${schema}.race_results (track_id, top_watts DESC NULLS LAST)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_results_rider_rpm ON ${schema}.race_results (track_id, guest_key, rider_name, top_cadence DESC NULLS LAST)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_results_rider_speed ON ${schema}.race_results (track_id, guest_key, rider_name, top_speed_kph DESC NULLS LAST)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_results_rider_watts ON ${schema}.race_results (track_id, guest_key, rider_name, top_watts DESC NULLS LAST)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_public_mappings_updated ON ${schema}.public_track_mappings (updated_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_ghost_laps_track ON ${schema}.ghost_laps (track_id, route_key, finish_time_ms ASC)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_ghost_laps_owner ON ${schema}.ghost_laps (owner_key, updated_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_auth_users_email ON ${schema}.auth_users (email)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_auth_sessions_token ON ${schema}.auth_sessions (token_hash)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_auth_sessions_expires ON ${schema}.auth_sessions (expires_at)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_billing_checkouts_user ON ${schema}.billing_checkouts (user_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_billing_checkouts_expires ON ${schema}.billing_checkouts (expires_at) WHERE claimed_at IS NULL`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_friend_requests_to ON ${schema}.friend_requests (to_guest_key, status, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_friend_requests_from ON ${schema}.friend_requests (from_guest_key, status, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_friendships_guest_b ON ${schema}.friendships (guest_key_b, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_group_members_guest ON ${schema}.group_members (guest_key, left_at)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_group_invites_to ON ${schema}.group_invites (to_guest_key, status, created_at DESC)`,
      ],
    },
  ];
}

function validateMigrations(migrations) {
  let previousVersion = 0;
  for (const migration of migrations) {
    if (!Number.isInteger(migration.version) || migration.version <= previousVersion) {
      throw new Error('Database migration versions must be positive, unique, and ordered.');
    }
    if (!migration.name || !Array.isArray(migration.statements) || migration.statements.length === 0) {
      throw new Error(`Database migration ${migration.version} is incomplete.`);
    }
    previousVersion = migration.version;
  }
}

export async function runDatabaseMigrations(pool, options = {}) {
  const schema = validatedSchema(options.schema ?? TRACKLAB_SCHEMA);
  const migrations = options.migrations ?? databaseMigrations(schema);
  const lockKey = `${schema}:schema-migrations`;
  validateMigrations(migrations);

  const client = await pool.connect();
  let lockAcquired = false;
  let transactionOpen = false;

  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [lockKey]);
    lockAcquired = true;
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const result = await client.query(
      `SELECT version, name, checksum FROM ${schema}.schema_migrations ORDER BY version`,
    );
    const appliedByVersion = new Map(result.rows.map((row) => [Number(row.version), row]));
    const newestKnownVersion = migrations.at(-1)?.version ?? 0;
    const newerAppliedVersion = Math.max(0, ...appliedByVersion.keys());
    if (newerAppliedVersion > newestKnownVersion) {
      throw new Error(
        `Database schema version ${newerAppliedVersion} is newer than this server supports (${newestKnownVersion}).`,
      );
    }

    const applied = [];
    for (const migration of migrations) {
      const checksum = migrationChecksum(migration);
      const existing = appliedByVersion.get(migration.version);
      if (existing) {
        if (existing.checksum !== checksum || existing.name !== migration.name) {
          throw new Error(`Database migration ${migration.version} no longer matches its applied checksum.`);
        }
        continue;
      }

      await client.query('BEGIN');
      transactionOpen = true;
      for (const statement of migration.statements) {
        await client.query(statement);
      }
      await client.query(
        `INSERT INTO ${schema}.schema_migrations (version, name, checksum) VALUES ($1, $2, $3)`,
        [migration.version, migration.name, checksum],
      );
      await client.query('COMMIT');
      transactionOpen = false;
      applied.push({ version: migration.version, name: migration.name });
    }

    return {
      applied,
      currentVersion: migrations.at(-1)?.version ?? 0,
    };
  } catch (error) {
    if (transactionOpen) {
      await client.query('ROLLBACK').catch(() => {});
    }
    throw error;
  } finally {
    if (lockAcquired) {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]).catch(() => {});
    }
    client.release();
  }
}
