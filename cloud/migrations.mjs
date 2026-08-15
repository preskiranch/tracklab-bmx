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
    {
      version: 4,
      name: 'record photorealistic 3D map loads',
      statements: [
        `CREATE TABLE IF NOT EXISTS ${schema}.map_3d_load_events (
          event_id TEXT PRIMARY KEY,
          user_id TEXT REFERENCES ${schema}.auth_users(id) ON DELETE SET NULL,
          track_id TEXT NOT NULL,
          track_name TEXT NOT NULL,
          context TEXT NOT NULL CHECK (context IN ('view', 'edit', 'race')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_map_3d_loads_created ON ${schema}.map_3d_load_events (created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_map_3d_loads_track_created ON ${schema}.map_3d_load_events (track_id, created_at DESC)`,
      ],
    },
    {
      version: 5,
      name: 'save race view preferences per account',
      statements: [
        `ALTER TABLE ${schema}.user_data ADD COLUMN IF NOT EXISTS race_view_preferences JSONB`,
      ],
    },
    {
      version: 6,
      name: 'cache verified track briefing research',
      statements: [
        `CREATE TABLE IF NOT EXISTS ${schema}.track_briefings (
          track_id TEXT PRIMARY KEY,
          track_name TEXT NOT NULL,
          research JSONB NOT NULL DEFAULT '{"facts":[],"sources":[]}'::jsonb,
          researched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_track_briefings_researched
          ON ${schema}.track_briefings (researched_at DESC)`,
      ],
    },
    {
      version: 7,
      name: 'save personal Explore route history per account',
      statements: [
        `ALTER TABLE ${schema}.user_data ADD COLUMN IF NOT EXISTS explore_routes JSONB NOT NULL DEFAULT '[]'::jsonb`,
      ],
    },
    {
      version: 8,
      name: 'publish developer custom sprint locations',
      statements: [
        `CREATE TABLE IF NOT EXISTS ${schema}.public_custom_routes (
          track_id TEXT PRIMARY KEY,
          route JSONB NOT NULL,
          published_by TEXT,
          published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_public_custom_routes_updated
          ON ${schema}.public_custom_routes (updated_at DESC)`,
        `INSERT INTO ${schema}.public_custom_routes (
           track_id,
           route,
           published_by,
           published_at,
           updated_at
         )
         SELECT
           route ->> 'id',
           route,
           data.guest_key,
           now(),
           now()
         FROM ${schema}.user_data AS data
         JOIN ${schema}.auth_users AS users
           ON data.guest_key = 'user:' || users.id
         CROSS JOIN LATERAL jsonb_array_elements(COALESCE(data.custom_routes, '[]'::jsonb)) AS custom_route(route)
         WHERE users.admin = true
           AND route ->> 'id' LIKE 'custom-%'
           AND route ->> 'id' NOT LIKE 'custom-preview-%'
           AND COALESCE(data.track_mappings, '{}'::jsonb) ? (route ->> 'id')
           AND data.track_mappings -> (route ->> 'id') ->> 'routeStatus' = 'user-mapped'
         ON CONFLICT (track_id) DO UPDATE SET
           route = EXCLUDED.route,
           published_by = EXCLUDED.published_by,
           updated_at = now()`,
        `INSERT INTO ${schema}.public_track_mappings (
           track_id,
           track_name,
           country,
           state,
           mapping,
           published_by,
           published_at,
           updated_at
         )
         SELECT
           mapping.key,
           COALESCE(mapping.value ->> 'trackName', 'Custom sprint'),
           COALESCE(mapping.value ->> 'country', 'Custom Routes'),
           COALESCE(mapping.value ->> 'state', 'Published'),
           mapping.value,
           data.guest_key,
           now(),
           now()
         FROM ${schema}.user_data AS data
         JOIN ${schema}.auth_users AS users
           ON data.guest_key = 'user:' || users.id
         CROSS JOIN LATERAL jsonb_each(COALESCE(data.track_mappings, '{}'::jsonb)) AS mapping
         JOIN ${schema}.public_custom_routes AS route ON route.track_id = mapping.key
         WHERE users.admin = true
           AND mapping.value ->> 'routeStatus' = 'user-mapped'
         ON CONFLICT (track_id) DO UPDATE SET
           track_name = EXCLUDED.track_name,
           country = EXCLUDED.country,
           state = EXCLUDED.state,
           mapping = EXCLUDED.mapping,
           published_by = EXCLUDED.published_by,
           updated_at = now()`,
      ],
    },
    {
      version: 9,
      name: 'recover custom sprint maps saved from location previews',
      statements: [
        `WITH previews AS (
           SELECT
             data.guest_key,
             mapping.key AS preview_id,
             regexp_replace(mapping.key, '^custom-preview-', 'custom-') AS track_id,
             mapping.value AS mapping
           FROM ${schema}.user_data AS data
           JOIN ${schema}.auth_users AS users
             ON data.guest_key = 'user:' || users.id
           CROSS JOIN LATERAL jsonb_each(COALESCE(data.track_mappings, '{}'::jsonb)) AS mapping
           WHERE users.admin = true
             AND mapping.key LIKE 'custom-preview-%'
             AND mapping.value ->> 'routeStatus' = 'user-mapped'
             AND jsonb_array_length(COALESCE(mapping.value -> 'centerline', '[]'::jsonb)) >= 2
         )
         INSERT INTO ${schema}.public_custom_routes (
           track_id,
           route,
           published_by,
           published_at,
           updated_at
         )
         SELECT
           preview.track_id,
           jsonb_build_object(
             'id', preview.track_id,
             'name', COALESCE(preview.mapping ->> 'trackName', 'Recovered custom sprint'),
             'country', 'Custom Routes',
             'countryCode', 'CUSTOM',
             'state', 'Personal',
             'region', 'Personal',
             'source', 'Custom',
             'sourceUrl', 'local://custom-route',
             'sourceType', 'manual',
             'verificationStatus', 'unverified',
             'addressStatus', 'coordinates-only',
             'address', CASE
               WHEN lower(COALESCE(preview.mapping ->> 'trackName', '')) LIKE '%drag strip%'
                 THEN 'Drag Strip, Epping, NH 03042, USA'
               ELSE COALESCE(preview.mapping ->> 'trackName', 'Recovered custom sprint')
             END,
             'latitude', preview.mapping -> 'centerline' -> 0 -> 'lat',
             'longitude', preview.mapping -> 'centerline' -> 0 -> 'lng',
             'coordinateSource', 'Recovered TrackLab developer mapping',
             'coordinateAccuracy', 'developer-confirmed',
             'lengthMeters', COALESCE(preview.mapping -> 'lengthMeters', '1000'::jsonb),
             'elevationMeters', 0,
             'surface', 'Custom sprint route',
             'outline', preview.mapping -> 'centerline',
             'routeStatus', 'locator-only',
             'zones', '[]'::jsonb,
             'leaderboards', jsonb_build_object('rpm', '[]'::jsonb, 'speed', '[]'::jsonb, 'watts', '[]'::jsonb)
           ),
           preview.guest_key,
           now(),
           now()
         FROM previews AS preview
         ON CONFLICT (track_id) DO UPDATE SET
           route = EXCLUDED.route,
           published_by = EXCLUDED.published_by,
           updated_at = now()`,
        `WITH previews AS (
           SELECT
             data.guest_key,
             regexp_replace(mapping.key, '^custom-preview-', 'custom-') AS track_id,
             mapping.value || jsonb_build_object(
               'trackId', regexp_replace(mapping.key, '^custom-preview-', 'custom-'),
               'country', 'Custom Routes',
               'state', 'Personal'
             ) AS mapping
           FROM ${schema}.user_data AS data
           JOIN ${schema}.auth_users AS users
             ON data.guest_key = 'user:' || users.id
           CROSS JOIN LATERAL jsonb_each(COALESCE(data.track_mappings, '{}'::jsonb)) AS mapping
           WHERE users.admin = true
             AND mapping.key LIKE 'custom-preview-%'
             AND mapping.value ->> 'routeStatus' = 'user-mapped'
             AND jsonb_array_length(COALESCE(mapping.value -> 'centerline', '[]'::jsonb)) >= 2
         )
         INSERT INTO ${schema}.public_track_mappings (
           track_id,
           track_name,
           country,
           state,
           mapping,
           published_by,
           published_at,
           updated_at
         )
         SELECT
           preview.track_id,
           COALESCE(preview.mapping ->> 'trackName', 'Recovered custom sprint'),
           'Custom Routes',
           'Personal',
           preview.mapping,
           preview.guest_key,
           now(),
           now()
         FROM previews AS preview
         ON CONFLICT (track_id) DO UPDATE SET
           track_name = EXCLUDED.track_name,
           country = EXCLUDED.country,
           state = EXCLUDED.state,
           mapping = EXCLUDED.mapping,
           published_by = EXCLUDED.published_by,
           updated_at = now()`,
        `UPDATE ${schema}.user_data AS data
         SET
           custom_routes = COALESCE(data.custom_routes, '[]'::jsonb) || COALESCE((
             SELECT jsonb_agg(public_route.route)
             FROM jsonb_each(COALESCE(data.track_mappings, '{}'::jsonb)) AS preview
             JOIN ${schema}.public_custom_routes AS public_route
               ON public_route.track_id = regexp_replace(preview.key, '^custom-preview-', 'custom-')
             WHERE preview.key LIKE 'custom-preview-%'
               AND preview.value ->> 'routeStatus' = 'user-mapped'
               AND NOT EXISTS (
                 SELECT 1
                 FROM jsonb_array_elements(COALESCE(data.custom_routes, '[]'::jsonb)) AS existing(route)
                 WHERE existing.route ->> 'id' = public_route.track_id
               )
           ), '[]'::jsonb),
           track_mappings = (
             COALESCE(data.track_mappings, '{}'::jsonb) - ARRAY(
               SELECT preview.key
               FROM jsonb_each(COALESCE(data.track_mappings, '{}'::jsonb)) AS preview
               WHERE preview.key LIKE 'custom-preview-%'
                 AND preview.value ->> 'routeStatus' = 'user-mapped'
             )
           ) || COALESCE((
             SELECT jsonb_object_agg(
               regexp_replace(preview.key, '^custom-preview-', 'custom-'),
               preview.value || jsonb_build_object(
                 'trackId', regexp_replace(preview.key, '^custom-preview-', 'custom-'),
                 'country', 'Custom Routes',
                 'state', 'Personal'
               )
             )
             FROM jsonb_each(COALESCE(data.track_mappings, '{}'::jsonb)) AS preview
             WHERE preview.key LIKE 'custom-preview-%'
               AND preview.value ->> 'routeStatus' = 'user-mapped'
           ), '{}'::jsonb),
           updated_at = now()
         WHERE data.guest_key IN (
           SELECT 'user:' || users.id
           FROM ${schema}.auth_users AS users
           WHERE users.admin = true
         )
           AND EXISTS (
             SELECT 1
             FROM jsonb_each(COALESCE(data.track_mappings, '{}'::jsonb)) AS preview
             WHERE preview.key LIKE 'custom-preview-%'
               AND preview.value ->> 'routeStatus' = 'user-mapped'
           )`,
      ],
    },
    {
      version: 10,
      name: 'add account profiles and unified training history',
      statements: [
        `ALTER TABLE ${schema}.user_data
          ADD COLUMN IF NOT EXISTS account_profile JSONB NOT NULL DEFAULT '{}'::jsonb`,
        `CREATE TABLE IF NOT EXISTS ${schema}.training_sessions (
          profile_key TEXT NOT NULL,
          id TEXT NOT NULL,
          activity_type TEXT NOT NULL,
          title TEXT NOT NULL,
          started_at TIMESTAMPTZ NOT NULL,
          ended_at TIMESTAMPTZ NOT NULL,
          duration_ms BIGINT NOT NULL DEFAULT 0,
          distance_meters DOUBLE PRECISION NOT NULL DEFAULT 0,
          track_id TEXT,
          track_name TEXT,
          source TEXT NOT NULL DEFAULT 'live',
          details JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (profile_key, id)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_training_sessions_profile_date
          ON ${schema}.training_sessions (profile_key, started_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_training_sessions_profile_type
          ON ${schema}.training_sessions (profile_key, activity_type, started_at DESC)`,
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
