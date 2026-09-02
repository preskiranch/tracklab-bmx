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
          accent TEXT NOT NULL DEFAULT '#178f4d',
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
    {
      version: 11,
      name: 'add secure club connect athlete claims',
      statements: [
        `CREATE TABLE IF NOT EXISTS ${schema}.clubs (
          id TEXT PRIMARY KEY,
          owner_profile_key TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`,
        `CREATE TABLE IF NOT EXISTS ${schema}.club_members (
          club_id TEXT NOT NULL REFERENCES ${schema}.clubs(id) ON DELETE CASCADE,
          studio_rider_id TEXT NOT NULL,
          rider_name TEXT NOT NULL,
          athlete_profile_key TEXT,
          status TEXT NOT NULL DEFAULT 'unclaimed',
          claimed_at TIMESTAMPTZ,
          revoked_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (club_id, studio_rider_id)
        )`,
        `CREATE TABLE IF NOT EXISTS ${schema}.club_invites (
          id TEXT PRIMARY KEY,
          club_id TEXT NOT NULL,
          studio_rider_id TEXT NOT NULL,
          token_hash TEXT UNIQUE NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          claimed_at TIMESTAMPTZ,
          claimed_by_profile_key TEXT,
          revoked_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          FOREIGN KEY (club_id, studio_rider_id)
            REFERENCES ${schema}.club_members(club_id, studio_rider_id) ON DELETE CASCADE
        )`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_club_members_athlete
          ON ${schema}.club_members (athlete_profile_key, status)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_club_invites_member
          ON ${schema}.club_invites (club_id, studio_rider_id, expires_at DESC)`,
      ],
    },
    {
      version: 12,
      name: 'attribute athlete training sessions to clubs',
      statements: [
        `ALTER TABLE ${schema}.training_sessions
          ADD COLUMN IF NOT EXISTS club_id TEXT`,
        `ALTER TABLE ${schema}.training_sessions
          ADD COLUMN IF NOT EXISTS studio_rider_id TEXT`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_training_sessions_club_date
          ON ${schema}.training_sessions (club_id, started_at DESC)
          WHERE club_id IS NOT NULL`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_training_sessions_club_rider_date
          ON ${schema}.training_sessions (club_id, studio_rider_id, started_at DESC)
          WHERE club_id IS NOT NULL`,
      ],
    },
    {
      version: 13,
      name: 'add owner-authorized shared club tablets',
      statements: [
        `CREATE TABLE IF NOT EXISTS ${schema}.club_tablet_devices (
          id TEXT PRIMARY KEY,
          club_id TEXT NOT NULL REFERENCES ${schema}.clubs(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          token_hash TEXT UNIQUE NOT NULL,
          last_seen_at TIMESTAMPTZ,
          revoked_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_club_tablet_devices_club
          ON ${schema}.club_tablet_devices (club_id, revoked_at, created_at)`,
      ],
    },
    {
      version: 14,
      name: 'save account display unit preferences',
      statements: [
        `ALTER TABLE ${schema}.user_data
          ADD COLUMN IF NOT EXISTS unit_preferences JSONB`,
      ],
    },
    {
      version: 15,
      name: 'add authenticated account friend network',
      statements: [
        `ALTER TABLE ${schema}.auth_users
          ADD COLUMN IF NOT EXISTS username TEXT`,
        `ALTER TABLE ${schema}.auth_users
          ADD COLUMN IF NOT EXISTS friend_discoverable BOOLEAN NOT NULL DEFAULT false`,
        `UPDATE ${schema}.auth_users
         SET username = COALESCE(NULLIF(trim(BOTH '-' FROM left(
           regexp_replace(lower(display_name), '[^a-z0-9]+', '-', 'g'),
           20
         )), ''), 'rider') || '-' || substring(md5(id), 1, 12)
         WHERE username IS NULL OR btrim(username) = ''`,
        `ALTER TABLE ${schema}.auth_users
          ALTER COLUMN username SET NOT NULL`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_tracklab_auth_users_username_ci
          ON ${schema}.auth_users (lower(username))`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_auth_users_friend_search
          ON ${schema}.auth_users (friend_discoverable, lower(display_name), lower(username))`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_auth_users_friend_handle_prefix
          ON ${schema}.auth_users (friend_discoverable, lower(username) text_pattern_ops, id)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_auth_users_friend_name_prefix
          ON ${schema}.auth_users (friend_discoverable, lower(display_name) text_pattern_ops, id)`,
        `CREATE TABLE IF NOT EXISTS ${schema}.official_friend_accounts (
          kind TEXT PRIMARY KEY CHECK (kind IN ('club', 'founder')),
          user_id TEXT UNIQUE NOT NULL REFERENCES ${schema}.auth_users(id) ON DELETE RESTRICT,
          reconciled_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`,
        `INSERT INTO ${schema}.official_friend_accounts (kind, user_id)
         SELECT reserved.kind, users.id
         FROM (VALUES
           ('club', 'preskiranch@gmail.com'),
           ('founder', 'rasheen25@gmail.com')
         ) AS reserved(kind, email)
         JOIN ${schema}.auth_users AS users ON lower(users.email) = reserved.email
         ON CONFLICT DO NOTHING`,
        `CREATE TABLE IF NOT EXISTS ${schema}.account_friendships (
          user_id_a TEXT NOT NULL REFERENCES ${schema}.auth_users(id) ON DELETE CASCADE,
          user_id_b TEXT NOT NULL REFERENCES ${schema}.auth_users(id) ON DELETE CASCADE,
          source TEXT NOT NULL DEFAULT 'request'
            CHECK (source IN ('request', 'invite', 'legacy', 'official')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (user_id_a, user_id_b),
          CHECK (user_id_a < user_id_b)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_account_friendships_b
          ON ${schema}.account_friendships (user_id_b, created_at DESC, user_id_a)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_account_friendships_a
          ON ${schema}.account_friendships (user_id_a, created_at DESC, user_id_b)`,
        `CREATE TABLE IF NOT EXISTS ${schema}.account_friend_requests (
          id TEXT PRIMARY KEY,
          from_user_id TEXT NOT NULL REFERENCES ${schema}.auth_users(id) ON DELETE CASCADE,
          to_user_id TEXT NOT NULL REFERENCES ${schema}.auth_users(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'blocked')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          responded_at TIMESTAMPTZ,
          CHECK (from_user_id <> to_user_id)
        )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_tracklab_account_friend_requests_pending_pair
          ON ${schema}.account_friend_requests (
            LEAST(from_user_id, to_user_id),
            GREATEST(from_user_id, to_user_id)
          ) WHERE status = 'pending'`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_account_friend_requests_incoming
          ON ${schema}.account_friend_requests (to_user_id, status, created_at DESC, id DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_account_friend_requests_outgoing
          ON ${schema}.account_friend_requests (from_user_id, status, created_at DESC, id DESC)`,
        `CREATE TABLE IF NOT EXISTS ${schema}.friendship_suppressions (
          user_id_a TEXT NOT NULL REFERENCES ${schema}.auth_users(id) ON DELETE CASCADE,
          user_id_b TEXT NOT NULL REFERENCES ${schema}.auth_users(id) ON DELETE CASCADE,
          actor_user_id TEXT REFERENCES ${schema}.auth_users(id) ON DELETE SET NULL,
          reason TEXT NOT NULL DEFAULT 'removed'
            CHECK (reason IN ('removed', 'blocked')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (user_id_a, user_id_b),
          CHECK (user_id_a < user_id_b)
        )`,
        `CREATE TABLE IF NOT EXISTS ${schema}.friend_blocks (
          blocker_user_id TEXT NOT NULL REFERENCES ${schema}.auth_users(id) ON DELETE CASCADE,
          blocked_user_id TEXT NOT NULL REFERENCES ${schema}.auth_users(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (blocker_user_id, blocked_user_id),
          CHECK (blocker_user_id <> blocked_user_id)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_friend_blocks_blocked
          ON ${schema}.friend_blocks (blocked_user_id, created_at DESC)`,
        `CREATE TABLE IF NOT EXISTS ${schema}.friend_reports (
          id TEXT PRIMARY KEY,
          reporter_user_id TEXT NOT NULL REFERENCES ${schema}.auth_users(id) ON DELETE CASCADE,
          reported_user_id TEXT NOT NULL REFERENCES ${schema}.auth_users(id) ON DELETE CASCADE,
          reason TEXT NOT NULL,
          details TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'open'
            CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          reviewed_at TIMESTAMPTZ,
          CHECK (reporter_user_id <> reported_user_id)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_friend_reports_status
          ON ${schema}.friend_reports (status, created_at DESC)`,
        `CREATE TABLE IF NOT EXISTS ${schema}.friend_invites (
          id TEXT PRIMARY KEY,
          inviter_user_id TEXT NOT NULL REFERENCES ${schema}.auth_users(id) ON DELETE CASCADE,
          token_hash TEXT UNIQUE NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          claimed_by_user_id TEXT REFERENCES ${schema}.auth_users(id) ON DELETE SET NULL,
          claimed_at TIMESTAMPTZ,
          revoked_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_friend_invites_inviter
          ON ${schema}.friend_invites (inviter_user_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_friend_invites_expiry
          ON ${schema}.friend_invites (expires_at) WHERE claimed_at IS NULL AND revoked_at IS NULL`,
        `INSERT INTO ${schema}.account_friendships (user_id_a, user_id_b, source, created_at)
         SELECT
           LEAST(substring(legacy.guest_key_a FROM 6), substring(legacy.guest_key_b FROM 6)),
           GREATEST(substring(legacy.guest_key_a FROM 6), substring(legacy.guest_key_b FROM 6)),
           'legacy',
           legacy.created_at
         FROM ${schema}.friendships AS legacy
         JOIN ${schema}.auth_users AS user_a ON legacy.guest_key_a = 'user:' || user_a.id
         JOIN ${schema}.auth_users AS user_b ON legacy.guest_key_b = 'user:' || user_b.id
         WHERE legacy.guest_key_a <> legacy.guest_key_b
         ON CONFLICT (user_id_a, user_id_b) DO NOTHING`,
        `INSERT INTO ${schema}.account_friend_requests (
           id, from_user_id, to_user_id, status, created_at, responded_at
         )
         SELECT
           legacy_request.id,
           legacy_request.from_user_id,
           legacy_request.to_user_id,
           CASE
             WHEN legacy_request.status IN ('pending', 'accepted', 'declined') THEN legacy_request.status
             ELSE 'cancelled'
           END,
           legacy_request.created_at,
           legacy_request.responded_at
         FROM (
           SELECT
             legacy.*,
             substring(legacy.from_guest_key FROM 6) AS from_user_id,
             substring(legacy.to_guest_key FROM 6) AS to_user_id,
             row_number() OVER (
               PARTITION BY
                 CASE WHEN legacy.status = 'pending'
                   THEN LEAST(legacy.from_guest_key, legacy.to_guest_key)
                   ELSE legacy.id
                 END,
                 CASE WHEN legacy.status = 'pending'
                   THEN GREATEST(legacy.from_guest_key, legacy.to_guest_key)
                   ELSE legacy.id
                 END
               ORDER BY legacy.created_at DESC, legacy.id DESC
             ) AS pair_rank
           FROM ${schema}.friend_requests AS legacy
           JOIN ${schema}.auth_users AS from_user ON legacy.from_guest_key = 'user:' || from_user.id
           JOIN ${schema}.auth_users AS to_user ON legacy.to_guest_key = 'user:' || to_user.id
           WHERE legacy.from_guest_key <> legacy.to_guest_key
         ) AS legacy_request
         WHERE legacy_request.pair_rank = 1
         ON CONFLICT (id) DO NOTHING`,
        `WITH official_pairs AS (
           SELECT DISTINCT
             LEAST(users.id, official.user_id) AS user_id_a,
             GREATEST(users.id, official.user_id) AS user_id_b
           FROM ${schema}.auth_users AS users
           CROSS JOIN ${schema}.official_friend_accounts AS official
           WHERE users.id <> official.user_id
         )
         INSERT INTO ${schema}.account_friendships AS existing (user_id_a, user_id_b, source)
         SELECT pair.user_id_a, pair.user_id_b, 'official'
         FROM official_pairs AS pair
         WHERE NOT EXISTS (
           SELECT 1 FROM ${schema}.friendship_suppressions AS suppression
           WHERE suppression.user_id_a = pair.user_id_a AND suppression.user_id_b = pair.user_id_b
         )
         ON CONFLICT (user_id_a, user_id_b) DO UPDATE SET source = 'official'
         WHERE existing.source = 'legacy'`,
        `UPDATE ${schema}.official_friend_accounts SET reconciled_at = now()`,
      ],
    },
    {
      version: 16,
      name: 'index live ghosts for friend race discovery',
      statements: [
        `CREATE INDEX IF NOT EXISTS idx_tracklab_ghost_laps_live_owner_recent
          ON ${schema}.ghost_laps (owner_key, saved_at DESC, finish_time_ms ASC, id)
          WHERE race_source = 'live'`,
      ],
    },
    {
      version: 17,
      name: 'keep account registration compatible with pre-friends releases',
      statements: [
        `ALTER TABLE ${schema}.auth_users
          ALTER COLUMN username SET DEFAULT (
            'rider-' || replace(gen_random_uuid()::text, '-', '')
          )`,
      ],
    },
    {
      version: 18,
      name: 'store private apple watch heart rate sessions',
      statements: [
        `CREATE TABLE IF NOT EXISTS ${schema}.heart_rate_studio_invitations (
          id TEXT PRIMARY KEY,
          club_id TEXT NOT NULL,
          studio_rider_id TEXT NOT NULL,
          owner_profile_key TEXT NOT NULL,
          athlete_profile_key TEXT NOT NULL,
          session_id TEXT NOT NULL,
          activity_type TEXT NOT NULL CHECK (
            activity_type IN ('bmx-race', 'straight-sprint', 'explore', 'get-pulled', 'monitor-sprint')
          ),
          player_id INTEGER CHECK (player_id IS NULL OR player_id BETWEEN 1 AND 4),
          invite_code_hash TEXT UNIQUE NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          claimed_at TIMESTAMPTZ,
          claimed_by_profile_key TEXT,
          revoked_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          FOREIGN KEY (club_id, studio_rider_id)
            REFERENCES ${schema}.club_members(club_id, studio_rider_id) ON DELETE CASCADE
        )`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_heart_rate_studio_invites_owner
          ON ${schema}.heart_rate_studio_invitations (owner_profile_key, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_heart_rate_studio_invites_athlete
          ON ${schema}.heart_rate_studio_invitations (athlete_profile_key, expires_at DESC)`,
        `CREATE TABLE IF NOT EXISTS ${schema}.heart_rate_pairings (
          id TEXT PRIMARY KEY,
          studio_invitation_id TEXT UNIQUE
            REFERENCES ${schema}.heart_rate_studio_invitations(id) ON DELETE SET NULL,
          owner_profile_key TEXT NOT NULL,
          session_id TEXT NOT NULL,
          activity_type TEXT NOT NULL CHECK (
            activity_type IN ('bmx-race', 'straight-sprint', 'explore', 'get-pulled', 'monitor-sprint')
          ),
          rider_id TEXT NOT NULL,
          player_id INTEGER CHECK (player_id IS NULL OR player_id BETWEEN 1 AND 4),
          club_id TEXT,
          studio_rider_id TEXT,
          pair_code_hash TEXT UNIQUE NOT NULL,
          ingest_token_hash TEXT UNIQUE,
          pair_code_expires_at TIMESTAMPTZ NOT NULL,
          ingest_expires_at TIMESTAMPTZ,
          claimed_at TIMESTAMPTZ,
          revoked_at TIMESTAMPTZ,
          live_studio_consent BOOLEAN NOT NULL DEFAULT false,
          session_studio_consent BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          CHECK (
            (club_id IS NULL AND studio_rider_id IS NULL)
            OR (club_id IS NOT NULL AND studio_rider_id IS NOT NULL)
          ),
          CHECK (
            (claimed_at IS NULL AND ingest_token_hash IS NULL AND ingest_expires_at IS NULL)
            OR (claimed_at IS NOT NULL AND ingest_token_hash IS NOT NULL AND ingest_expires_at IS NOT NULL)
          )
        )`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_heart_rate_pairings_owner_session
          ON ${schema}.heart_rate_pairings (owner_profile_key, session_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_heart_rate_pairings_club
          ON ${schema}.heart_rate_pairings (club_id, studio_rider_id, created_at DESC)
          WHERE club_id IS NOT NULL`,
        `CREATE TABLE IF NOT EXISTS ${schema}.heart_rate_streams (
          id TEXT PRIMARY KEY,
          pairing_id TEXT UNIQUE NOT NULL
            REFERENCES ${schema}.heart_rate_pairings(id) ON DELETE CASCADE,
          owner_profile_key TEXT NOT NULL,
          session_id TEXT NOT NULL,
          activity_type TEXT NOT NULL CHECK (
            activity_type IN ('bmx-race', 'straight-sprint', 'explore', 'get-pulled', 'monitor-sprint')
          ),
          rider_id TEXT NOT NULL,
          player_id INTEGER CHECK (player_id IS NULL OR player_id BETWEEN 1 AND 4),
          club_id TEXT,
          studio_rider_id TEXT,
          live_studio_consent BOOLEAN NOT NULL DEFAULT false,
          session_studio_consent BOOLEAN NOT NULL DEFAULT false,
          source TEXT NOT NULL DEFAULT 'apple-watch',
          started_at TIMESTAMPTZ NOT NULL,
          ended_at TIMESTAMPTZ,
          active_duration_ms BIGINT,
          summary JSONB NOT NULL DEFAULT '{}'::jsonb,
          zone_summaries JSONB NOT NULL DEFAULT '[]'::jsonb,
          finalized_at TIMESTAMPTZ,
          training_profile_key TEXT,
          training_session_id TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          CHECK (active_duration_ms IS NULL OR active_duration_ms BETWEEN 0 AND 604800000),
          CHECK (
            (training_profile_key IS NULL AND training_session_id IS NULL)
            OR (training_profile_key IS NOT NULL AND training_session_id IS NOT NULL)
          ),
          FOREIGN KEY (training_profile_key, training_session_id)
            REFERENCES ${schema}.training_sessions(profile_key, id) ON DELETE CASCADE
        )`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_heart_rate_streams_owner_session
          ON ${schema}.heart_rate_streams (owner_profile_key, session_id, started_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_heart_rate_streams_club_session
          ON ${schema}.heart_rate_streams (club_id, session_id, started_at DESC)
          WHERE club_id IS NOT NULL AND session_studio_consent = true`,
        `CREATE TABLE IF NOT EXISTS ${schema}.heart_rate_samples (
          stream_id TEXT NOT NULL
            REFERENCES ${schema}.heart_rate_streams(id) ON DELETE CASCADE,
          sequence BIGINT NOT NULL CHECK (sequence BETWEEN 0 AND 1000000),
          recorded_at TIMESTAMPTZ NOT NULL,
          active_elapsed_ms BIGINT NOT NULL CHECK (active_elapsed_ms BETWEEN 0 AND 604800000),
          bpm SMALLINT NOT NULL CHECK (bpm BETWEEN 20 AND 260),
          received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (stream_id, sequence)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_heart_rate_samples_stream_clock
          ON ${schema}.heart_rate_samples (stream_id, active_elapsed_ms, sequence)`,
      ],
    },
    {
      version: 19,
      name: 'authorize owner monitor sprints for claimed club athletes',
      statements: [
        `CREATE TABLE IF NOT EXISTS ${schema}.club_monitor_sprint_authorizations (
          id TEXT PRIMARY KEY,
          club_id TEXT NOT NULL,
          studio_rider_id TEXT NOT NULL,
          owner_profile_key TEXT NOT NULL,
          athlete_profile_key TEXT NOT NULL,
          bike_device_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          player_id INTEGER NOT NULL CHECK (player_id BETWEEN 1 AND 4),
          started_at TIMESTAMPTZ NOT NULL,
          token_hash TEXT UNIQUE NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          consumed_at TIMESTAMPTZ,
          revoked_at TIMESTAMPTZ,
          training_profile_key TEXT,
          training_session_id TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (club_id, studio_rider_id, session_id),
          CHECK (
            (training_profile_key IS NULL AND training_session_id IS NULL)
            OR (training_profile_key IS NOT NULL AND training_session_id IS NOT NULL)
          ),
          FOREIGN KEY (club_id, studio_rider_id)
            REFERENCES ${schema}.club_members(club_id, studio_rider_id) ON DELETE CASCADE,
          FOREIGN KEY (training_profile_key, training_session_id)
            REFERENCES ${schema}.training_sessions(profile_key, id) ON DELETE SET NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_monitor_sprint_auth_owner
          ON ${schema}.club_monitor_sprint_authorizations (owner_profile_key, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_monitor_sprint_auth_active_rider
          ON ${schema}.club_monitor_sprint_authorizations (club_id, studio_rider_id, expires_at)
          WHERE consumed_at IS NULL AND revoked_at IS NULL`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_monitor_sprint_auth_active_bike
          ON ${schema}.club_monitor_sprint_authorizations (club_id, bike_device_id, expires_at)
          WHERE consumed_at IS NULL AND revoked_at IS NULL`,
      ],
    },
    {
      version: 20,
      name: 'arm monitor sprints and segment continuous studio heart rate',
      statements: [
        `ALTER TABLE ${schema}.club_monitor_sprint_authorizations
          ADD COLUMN IF NOT EXISTS armed_at TIMESTAMPTZ`,
        `ALTER TABLE ${schema}.club_monitor_sprint_authorizations
          ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ`,
        `UPDATE ${schema}.club_monitor_sprint_authorizations
          SET armed_at = COALESCE(armed_at, started_at),
            activated_at = CASE
              WHEN started_at IS NOT NULL THEN COALESCE(activated_at, created_at)
              ELSE activated_at
            END
          WHERE armed_at IS NULL OR (started_at IS NOT NULL AND activated_at IS NULL)`,
        `ALTER TABLE ${schema}.club_monitor_sprint_authorizations
          ALTER COLUMN armed_at SET NOT NULL`,
        `ALTER TABLE ${schema}.club_monitor_sprint_authorizations
          ALTER COLUMN started_at DROP NOT NULL`,
        `ALTER TABLE ${schema}.heart_rate_studio_invitations
          ADD COLUMN IF NOT EXISTS relay_scope TEXT NOT NULL DEFAULT 'session'
          CHECK (relay_scope IN ('session', 'studio-block'))`,
        `ALTER TABLE ${schema}.heart_rate_pairings
          ADD COLUMN IF NOT EXISTS relay_scope TEXT NOT NULL DEFAULT 'session'
          CHECK (relay_scope IN ('session', 'studio-block'))`,
        `ALTER TABLE ${schema}.heart_rate_pairings
          ADD COLUMN IF NOT EXISTS studio_block_stopped_at TIMESTAMPTZ`,
        `ALTER TABLE ${schema}.heart_rate_pairings
          ADD COLUMN IF NOT EXISTS studio_block_stopped_by_profile_key TEXT`,
        `ALTER TABLE ${schema}.heart_rate_streams
          ADD COLUMN IF NOT EXISTS relay_scope TEXT NOT NULL DEFAULT 'session'
          CHECK (relay_scope IN ('session', 'studio-block'))`,
        `ALTER TABLE ${schema}.heart_rate_streams
          ADD COLUMN IF NOT EXISTS studio_block_stopped_at TIMESTAMPTZ`,
        `ALTER TABLE ${schema}.heart_rate_streams
          ADD COLUMN IF NOT EXISTS relay_expires_at TIMESTAMPTZ`,
        `UPDATE ${schema}.heart_rate_streams AS streams
          SET relay_expires_at = pairings.ingest_expires_at
          FROM ${schema}.heart_rate_pairings AS pairings
          WHERE streams.pairing_id = pairings.id AND streams.relay_expires_at IS NULL`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_heart_rate_streams_active_studio_block
          ON ${schema}.heart_rate_streams (club_id, studio_rider_id, started_at DESC)
          WHERE relay_scope = 'studio-block' AND finalized_at IS NULL`,
        `CREATE TABLE IF NOT EXISTS ${schema}.heart_rate_training_segments (
          id TEXT PRIMARY KEY,
          stream_id TEXT NOT NULL
            REFERENCES ${schema}.heart_rate_streams(id) ON DELETE CASCADE,
          pairing_id TEXT NOT NULL
            REFERENCES ${schema}.heart_rate_pairings(id) ON DELETE CASCADE,
          owner_profile_key TEXT NOT NULL,
          club_id TEXT NOT NULL,
          studio_rider_id TEXT NOT NULL,
          training_profile_key TEXT NOT NULL,
          training_session_id TEXT NOT NULL,
          activity_type TEXT NOT NULL CHECK (
            activity_type IN ('bmx-race', 'straight-sprint', 'explore', 'get-pulled', 'monitor-sprint')
          ),
          player_id INTEGER CHECK (player_id IS NULL OR player_id BETWEEN 1 AND 4),
          started_at TIMESTAMPTZ NOT NULL,
          ended_at TIMESTAMPTZ NOT NULL,
          active_duration_ms BIGINT NOT NULL CHECK (active_duration_ms BETWEEN 0 AND 604800000),
          summary JSONB NOT NULL DEFAULT '{}'::jsonb,
          zone_summaries JSONB NOT NULL DEFAULT '[]'::jsonb,
          finalized_at TIMESTAMPTZ,
          studio_visible BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (training_profile_key, training_session_id),
          CHECK (ended_at >= started_at),
          FOREIGN KEY (training_profile_key, training_session_id)
            REFERENCES ${schema}.training_sessions(profile_key, id) ON DELETE CASCADE,
          FOREIGN KEY (club_id, studio_rider_id)
            REFERENCES ${schema}.club_members(club_id, studio_rider_id) ON DELETE CASCADE
        )`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_heart_rate_segments_owner_session
          ON ${schema}.heart_rate_training_segments
          (owner_profile_key, training_session_id, started_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_heart_rate_segments_club_session
          ON ${schema}.heart_rate_training_segments
          (club_id, training_session_id, started_at DESC)
          WHERE studio_visible = true`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_heart_rate_segments_stream
          ON ${schema}.heart_rate_training_segments (stream_id, started_at, ended_at)`,
        `CREATE TABLE IF NOT EXISTS ${schema}.heart_rate_training_segment_bindings (
          training_profile_key TEXT NOT NULL,
          training_session_id TEXT NOT NULL,
          club_id TEXT NOT NULL,
          studio_rider_id TEXT NOT NULL,
          activity_type TEXT NOT NULL CHECK (
            activity_type IN ('bmx-race', 'straight-sprint', 'explore', 'get-pulled', 'monitor-sprint')
          ),
          player_id INTEGER CHECK (player_id IS NULL OR player_id BETWEEN 1 AND 4),
          started_at TIMESTAMPTZ NOT NULL,
          ended_at TIMESTAMPTZ NOT NULL,
          zone_windows JSONB NOT NULL DEFAULT '[]'::jsonb,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (training_profile_key, training_session_id),
          CHECK (ended_at >= started_at),
          FOREIGN KEY (training_profile_key, training_session_id)
            REFERENCES ${schema}.training_sessions(profile_key, id) ON DELETE CASCADE,
          FOREIGN KEY (club_id, studio_rider_id)
            REFERENCES ${schema}.club_members(club_id, studio_rider_id) ON DELETE CASCADE
        )`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_heart_rate_segment_bindings_match
          ON ${schema}.heart_rate_training_segment_bindings
          (training_profile_key, club_id, studio_rider_id, started_at, ended_at, expires_at)`,
      ],
    },
    {
      version: 21,
      name: 'segment private continuous account heart rate across devices',
      statements: [
        `ALTER TABLE ${schema}.heart_rate_pairings
          DROP CONSTRAINT IF EXISTS heart_rate_pairings_activity_type_check`,
        `ALTER TABLE ${schema}.heart_rate_pairings
          ADD CONSTRAINT heart_rate_pairings_activity_type_check CHECK (
            activity_type IN (
              'bmx-race', 'straight-sprint', 'explore', 'get-pulled',
              'monitor-sprint', 'training-block'
            )
          )`,
        `ALTER TABLE ${schema}.heart_rate_pairings
          DROP CONSTRAINT IF EXISTS heart_rate_pairings_relay_scope_check`,
        `ALTER TABLE ${schema}.heart_rate_pairings
          ADD CONSTRAINT heart_rate_pairings_relay_scope_check CHECK (
            relay_scope IN ('session', 'studio-block', 'account-block')
          )`,
        `ALTER TABLE ${schema}.heart_rate_streams
          DROP CONSTRAINT IF EXISTS heart_rate_streams_activity_type_check`,
        `ALTER TABLE ${schema}.heart_rate_streams
          ADD CONSTRAINT heart_rate_streams_activity_type_check CHECK (
            activity_type IN (
              'bmx-race', 'straight-sprint', 'explore', 'get-pulled',
              'monitor-sprint', 'training-block'
            )
          )`,
        `ALTER TABLE ${schema}.heart_rate_streams
          DROP CONSTRAINT IF EXISTS heart_rate_streams_relay_scope_check`,
        `ALTER TABLE ${schema}.heart_rate_streams
          ADD CONSTRAINT heart_rate_streams_relay_scope_check CHECK (
            relay_scope IN ('session', 'studio-block', 'account-block')
          )`,
        `ALTER TABLE ${schema}.heart_rate_pairings
          ADD COLUMN IF NOT EXISTS account_block_stop_requested_at TIMESTAMPTZ`,
        `ALTER TABLE ${schema}.heart_rate_pairings
          ADD COLUMN IF NOT EXISTS account_block_drain_expires_at TIMESTAMPTZ`,
        `ALTER TABLE ${schema}.heart_rate_streams
          ADD COLUMN IF NOT EXISTS account_block_stop_requested_at TIMESTAMPTZ`,
        `ALTER TABLE ${schema}.heart_rate_streams
          ADD COLUMN IF NOT EXISTS account_block_drain_expires_at TIMESTAMPTZ`,
        `DROP INDEX IF EXISTS ${schema}.idx_tracklab_heart_rate_pairings_one_account_block`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_tracklab_heart_rate_pairings_one_account_block
          ON ${schema}.heart_rate_pairings (owner_profile_key)
          WHERE relay_scope = 'account-block'
            AND revoked_at IS NULL
            AND account_block_stop_requested_at IS NULL`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_heart_rate_pairings_account_block_drain
          ON ${schema}.heart_rate_pairings (account_block_drain_expires_at)
          WHERE relay_scope = 'account-block'
            AND revoked_at IS NULL
            AND account_block_stop_requested_at IS NOT NULL`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_heart_rate_streams_active_account_block
          ON ${schema}.heart_rate_streams (owner_profile_key, started_at DESC)
          WHERE relay_scope = 'account-block' AND finalized_at IS NULL`,
        `ALTER TABLE ${schema}.heart_rate_training_segments
          ADD COLUMN IF NOT EXISTS relay_scope TEXT NOT NULL DEFAULT 'studio-block'`,
        `ALTER TABLE ${schema}.heart_rate_training_segments
          ADD COLUMN IF NOT EXISTS active_clock_segments JSONB NOT NULL DEFAULT '[]'::jsonb`,
        `ALTER TABLE ${schema}.heart_rate_training_segments
          ALTER COLUMN club_id DROP NOT NULL`,
        `ALTER TABLE ${schema}.heart_rate_training_segments
          ALTER COLUMN studio_rider_id DROP NOT NULL`,
        `ALTER TABLE ${schema}.heart_rate_training_segments
          ADD CONSTRAINT heart_rate_training_segments_relay_scope_check CHECK (
            (relay_scope = 'studio-block' AND club_id IS NOT NULL AND studio_rider_id IS NOT NULL)
            OR (relay_scope = 'account-block' AND club_id IS NULL AND studio_rider_id IS NULL)
          )`,
        `ALTER TABLE ${schema}.heart_rate_training_segment_bindings
          ADD COLUMN IF NOT EXISTS relay_scope TEXT NOT NULL DEFAULT 'studio-block'`,
        `ALTER TABLE ${schema}.heart_rate_training_segment_bindings
          ADD COLUMN IF NOT EXISTS active_clock_segments JSONB NOT NULL DEFAULT '[]'::jsonb`,
        `ALTER TABLE ${schema}.heart_rate_training_segment_bindings
          ALTER COLUMN club_id DROP NOT NULL`,
        `ALTER TABLE ${schema}.heart_rate_training_segment_bindings
          ALTER COLUMN studio_rider_id DROP NOT NULL`,
        `ALTER TABLE ${schema}.heart_rate_training_segment_bindings
          ADD CONSTRAINT heart_rate_training_segment_bindings_relay_scope_check CHECK (
            (relay_scope = 'studio-block' AND club_id IS NOT NULL AND studio_rider_id IS NOT NULL)
            OR (relay_scope = 'account-block' AND club_id IS NULL AND studio_rider_id IS NULL)
          )`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_heart_rate_account_segment_bindings_match
          ON ${schema}.heart_rate_training_segment_bindings
          (training_profile_key, started_at, ended_at, expires_at)
          WHERE relay_scope = 'account-block'`,
      ],
    },
    {
      version: 22,
      name: 'atomically save owner assigned multi bike training',
      statements: [
        `CREATE TABLE IF NOT EXISTS ${schema}.club_group_training_authorizations (
          id TEXT PRIMARY KEY,
          club_id TEXT NOT NULL REFERENCES ${schema}.clubs(id) ON DELETE CASCADE,
          owner_profile_key TEXT NOT NULL,
          request_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          activity_type TEXT NOT NULL CHECK (
            activity_type IN ('bmx-race', 'straight-sprint', 'get-pulled', 'explore')
          ),
          armed_at TIMESTAMPTZ NOT NULL,
          token_hash TEXT UNIQUE NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          completion_digest TEXT,
          completed_at TIMESTAMPTZ,
          cancelled_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (owner_profile_key, request_id),
          UNIQUE (club_id, session_id),
          CHECK (completed_at IS NULL OR cancelled_at IS NULL),
          CHECK (
            (completed_at IS NULL AND completion_digest IS NULL)
            OR (completed_at IS NOT NULL AND completion_digest IS NOT NULL)
          )
        )`,
        `CREATE TABLE IF NOT EXISTS ${schema}.club_group_training_assignments (
          id TEXT PRIMARY KEY,
          authorization_id TEXT NOT NULL
            REFERENCES ${schema}.club_group_training_authorizations(id) ON DELETE CASCADE,
          club_id TEXT NOT NULL,
          studio_rider_id TEXT NOT NULL,
          athlete_profile_key TEXT NOT NULL,
          bike_device_id TEXT NOT NULL,
          player_id INTEGER NOT NULL CHECK (player_id BETWEEN 1 AND 4),
          started_at TIMESTAMPTZ,
          activated_at TIMESTAMPTZ,
          ended_at TIMESTAMPTZ,
          released_at TIMESTAMPTZ,
          training_profile_key TEXT,
          training_session_id TEXT,
          heart_rate_attachment_status TEXT NOT NULL DEFAULT 'not-checked' CHECK (
            heart_rate_attachment_status IN (
              'not-checked', 'shared-attached', 'shared-pending', 'not-shared', 'failed'
            )
          ),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (authorization_id, studio_rider_id),
          UNIQUE (authorization_id, athlete_profile_key),
          UNIQUE (authorization_id, bike_device_id),
          UNIQUE (authorization_id, player_id),
          CHECK ((started_at IS NULL) = (activated_at IS NULL)),
          CHECK (ended_at IS NULL OR started_at IS NOT NULL),
          CHECK (
            (training_profile_key IS NULL AND training_session_id IS NULL)
            OR (training_profile_key IS NOT NULL AND training_session_id IS NOT NULL)
          ),
          FOREIGN KEY (club_id, studio_rider_id)
            REFERENCES ${schema}.club_members(club_id, studio_rider_id) ON DELETE CASCADE,
          FOREIGN KEY (training_profile_key, training_session_id)
            REFERENCES ${schema}.training_sessions(profile_key, id) ON DELETE SET NULL
        )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_tracklab_group_training_active_rider
          ON ${schema}.club_group_training_assignments (club_id, studio_rider_id)
          WHERE released_at IS NULL`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_tracklab_group_training_active_bike
          ON ${schema}.club_group_training_assignments (club_id, bike_device_id)
          WHERE released_at IS NULL`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_group_training_owner_recent
          ON ${schema}.club_group_training_authorizations (owner_profile_key, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_group_training_active_expiry
          ON ${schema}.club_group_training_authorizations (club_id, expires_at)
          WHERE completed_at IS NULL AND cancelled_at IS NULL`,
      ],
    },
    {
      version: 23,
      name: 'remember trusted watches and authorize four hour watch connect sessions',
      statements: [
        `CREATE TABLE IF NOT EXISTS ${schema}.heart_rate_watch_enrollments (
          id TEXT PRIMARY KEY,
          owner_profile_key TEXT NOT NULL,
          scope TEXT NOT NULL CHECK (scope IN ('personal', 'studio')),
          club_id TEXT,
          studio_rider_id TEXT,
          install_id_hash TEXT NOT NULL,
          request_id TEXT NOT NULL,
          live_studio_consent BOOLEAN NOT NULL DEFAULT false,
          session_studio_consent BOOLEAN NOT NULL DEFAULT false,
          last_verified_at TIMESTAMPTZ NOT NULL,
          revoked_at TIMESTAMPTZ,
          revoked_reason TEXT CHECK (
            revoked_reason IS NULL OR revoked_reason IN (
              'athlete-disconnected', 'studio-disconnected', 'device-replaced',
              'membership-ended', 'account-revoked'
            )
          ),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (owner_profile_key, request_id),
          CHECK (
            (
              scope = 'personal'
              AND club_id IS NULL
              AND studio_rider_id IS NULL
              AND live_studio_consent = false
              AND session_studio_consent = false
            ) OR (
              scope = 'studio'
              AND club_id IS NOT NULL
              AND studio_rider_id IS NOT NULL
            )
          ),
          FOREIGN KEY (club_id, studio_rider_id)
            REFERENCES ${schema}.club_members(club_id, studio_rider_id) ON DELETE CASCADE
        )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_tracklab_watch_enrollment_active_scope
          ON ${schema}.heart_rate_watch_enrollments
          (owner_profile_key, scope, (COALESCE(club_id, '')))
          WHERE revoked_at IS NULL`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_watch_enrollment_install
          ON ${schema}.heart_rate_watch_enrollments (install_id_hash, updated_at DESC)
          WHERE revoked_at IS NULL`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_watch_enrollment_studio
          ON ${schema}.heart_rate_watch_enrollments
          (club_id, studio_rider_id, updated_at DESC)
          WHERE scope = 'studio' AND revoked_at IS NULL`,
        `CREATE TABLE IF NOT EXISTS ${schema}.heart_rate_watch_connections (
          id TEXT PRIMARY KEY,
          enrollment_id TEXT NOT NULL
            REFERENCES ${schema}.heart_rate_watch_enrollments(id) ON DELETE CASCADE,
          pairing_id TEXT UNIQUE NOT NULL
            REFERENCES ${schema}.heart_rate_pairings(id) ON DELETE CASCADE,
          owner_profile_key TEXT NOT NULL,
          scope TEXT NOT NULL CHECK (scope IN ('personal', 'studio')),
          club_id TEXT,
          studio_rider_id TEXT,
          request_id TEXT NOT NULL,
          connected_at TIMESTAMPTZ NOT NULL,
          connected_until TIMESTAMPTZ NOT NULL,
          stopped_at TIMESTAMPTZ,
          stopped_reason TEXT CHECK (
            stopped_reason IS NULL OR stopped_reason IN (
              'athlete-stopped', 'expired', 'replaced', 'enrollment-revoked',
              'studio-disconnected', 'membership-ended', 'account-revoked'
            )
          ),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (owner_profile_key, request_id),
          CHECK (connected_until = connected_at + interval '4 hours'),
          CHECK (stopped_at IS NULL OR stopped_at >= connected_at),
          CHECK (
            (scope = 'personal' AND club_id IS NULL AND studio_rider_id IS NULL)
            OR (scope = 'studio' AND club_id IS NOT NULL AND studio_rider_id IS NOT NULL)
          ),
          FOREIGN KEY (club_id, studio_rider_id)
            REFERENCES ${schema}.club_members(club_id, studio_rider_id) ON DELETE CASCADE
        )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_tracklab_watch_connection_one_active_scope
          ON ${schema}.heart_rate_watch_connections
          (owner_profile_key, scope, (COALESCE(club_id, '')))
          WHERE stopped_at IS NULL`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_watch_connection_expiry
          ON ${schema}.heart_rate_watch_connections (connected_until)
          WHERE stopped_at IS NULL`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_watch_connection_studio
          ON ${schema}.heart_rate_watch_connections
          (club_id, studio_rider_id, connected_at DESC)
          WHERE scope = 'studio'`,
      ],
    },
    {
      version: 24,
      name: 'add private per account recovery alerts and summary only learning',
      statements: [
        `CREATE TABLE IF NOT EXISTS ${schema}.recovery_alert_preferences (
          owner_profile_key TEXT PRIMARY KEY,
          owner_user_id TEXT UNIQUE NOT NULL
            REFERENCES ${schema}.auth_users(id) ON DELETE CASCADE,
          mode TEXT NOT NULL DEFAULT 'off' CHECK (
            mode IN ('off', 'timer', 'heart-rate', 'smart')
          ),
          timer_seconds INTEGER NOT NULL DEFAULT 120 CHECK (
            timer_seconds BETWEEN 30 AND 1800
          ),
          target_bpm INTEGER NOT NULL DEFAULT 120 CHECK (
            target_bpm BETWEEN 40 AND 220
          ),
          minimum_seconds INTEGER NOT NULL DEFAULT 30 CHECK (
            minimum_seconds BETWEEN 15 AND 600
          ),
          maximum_seconds INTEGER NOT NULL DEFAULT 600 CHECK (
            maximum_seconds BETWEEN 30 AND 1800
          ),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          CHECK (maximum_seconds >= minimum_seconds),
          CHECK (mode <> 'smart' OR maximum_seconds >= timer_seconds)
        )`,
        `CREATE TABLE IF NOT EXISTS ${schema}.recovery_alert_episodes (
          id TEXT PRIMARY KEY,
          owner_profile_key TEXT NOT NULL,
          owner_user_id TEXT NOT NULL
            REFERENCES ${schema}.auth_users(id) ON DELETE CASCADE,
          request_id TEXT NOT NULL,
          request_fingerprint TEXT NOT NULL,
          activity_type TEXT NOT NULL CHECK (
            activity_type IN ('bmx-race', 'straight-sprint', 'get-pulled')
          ),
          session_id TEXT NOT NULL,
          repetition_id TEXT NOT NULL,
          mode TEXT NOT NULL CHECK (mode IN ('timer', 'heart-rate', 'smart')),
          timer_seconds INTEGER NOT NULL CHECK (timer_seconds BETWEEN 30 AND 1800),
          target_bpm INTEGER CHECK (target_bpm BETWEEN 40 AND 220),
          minimum_seconds INTEGER NOT NULL CHECK (minimum_seconds BETWEEN 15 AND 600),
          maximum_seconds INTEGER NOT NULL CHECK (maximum_seconds BETWEEN 30 AND 1800),
          started_at TIMESTAMPTZ NOT NULL,
          not_before_at TIMESTAMPTZ NOT NULL,
          planned_ready_at TIMESTAMPTZ,
          fallback_at TIMESTAMPTZ NOT NULL,
          ready_at TIMESTAMPTZ,
          ready_reason TEXT,
          explanation TEXT NOT NULL,
          confidence TEXT NOT NULL CHECK (confidence IN ('fixed', 'provisional', 'personalized')),
          learning_episode_count INTEGER NOT NULL DEFAULT 0 CHECK (learning_episode_count >= 0),
          effort_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
          recovery_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
          fresh_sample_count INTEGER NOT NULL DEFAULT 0 CHECK (fresh_sample_count >= 0),
          below_target_started_at TIMESTAMPTZ,
          last_hr_recorded_at TIMESTAMPTZ,
          last_hr_stream_id TEXT,
          alerted_at TIMESTAMPTZ,
          alert_trigger TEXT CHECK (
            alert_trigger IS NULL OR alert_trigger IN ('target', 'planned', 'fallback', 'manual')
          ),
          cancelled_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (owner_profile_key, request_id),
          UNIQUE (owner_profile_key, activity_type, session_id, repetition_id),
          CHECK (maximum_seconds >= minimum_seconds),
          CHECK (mode <> 'smart' OR maximum_seconds >= timer_seconds),
          CHECK (not_before_at >= started_at),
          CHECK (fallback_at >= not_before_at),
          CHECK (
            planned_ready_at IS NULL
            OR (planned_ready_at >= not_before_at AND planned_ready_at <= fallback_at)
          ),
          CHECK (ready_at IS NULL OR (ready_at >= started_at AND ready_at <= fallback_at)),
          CHECK (cancelled_at IS NULL OR cancelled_at >= started_at),
          CHECK (
            (mode = 'timer' AND target_bpm IS NULL AND planned_ready_at IS NOT NULL)
            OR (mode = 'heart-rate' AND target_bpm IS NOT NULL AND planned_ready_at IS NULL)
            OR (mode = 'smart' AND target_bpm IS NOT NULL AND planned_ready_at IS NOT NULL)
          )
        )`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_recovery_alert_owner_active
          ON ${schema}.recovery_alert_episodes
          (owner_profile_key, started_at DESC, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_recovery_alert_owner_learning
          ON ${schema}.recovery_alert_episodes
          (owner_profile_key, activity_type, ready_at DESC)
          WHERE ready_reason = 'heart-rate-target' AND cancelled_at IS NULL`,
      ],
    },
    {
      version: 25,
      name: 'add private track favorites and explicit friend track shares',
      statements: [
        `CREATE TABLE IF NOT EXISTS ${schema}.account_track_favorites (
          user_id TEXT NOT NULL
            REFERENCES ${schema}.auth_users(id) ON DELETE CASCADE,
          track_id TEXT NOT NULL CHECK (char_length(track_id) BETWEEN 1 AND 140),
          track_snapshot JSONB NOT NULL CHECK (jsonb_typeof(track_snapshot) = 'object'),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (user_id, track_id)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_account_track_favorites_recent
          ON ${schema}.account_track_favorites (user_id, created_at DESC, track_id)`,
        `CREATE TABLE IF NOT EXISTS ${schema}.account_track_shares (
          id TEXT PRIMARY KEY,
          sender_user_id TEXT NOT NULL
            REFERENCES ${schema}.auth_users(id) ON DELETE CASCADE,
          recipient_user_id TEXT NOT NULL
            REFERENCES ${schema}.auth_users(id) ON DELETE CASCADE,
          track_id TEXT NOT NULL CHECK (char_length(track_id) BETWEEN 1 AND 140),
          track_snapshot JSONB NOT NULL CHECK (jsonb_typeof(track_snapshot) = 'object'),
          opened_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (sender_user_id, recipient_user_id, track_id),
          CHECK (sender_user_id <> recipient_user_id),
          CHECK (opened_at IS NULL OR opened_at >= created_at)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_account_track_shares_recipient_recent
          ON ${schema}.account_track_shares (recipient_user_id, updated_at DESC, id)`,
      ],
    },
    {
      version: 26,
      name: 'add private ios push installations and transactional social alerts',
      statements: [
        `CREATE TABLE IF NOT EXISTS ${schema}.push_installations (
          id TEXT PRIMARY KEY CHECK (char_length(id) BETWEEN 32 AND 64),
          user_id TEXT NOT NULL
            REFERENCES ${schema}.auth_users(id) ON DELETE CASCADE,
          auth_session_token_hash TEXT NOT NULL
            REFERENCES ${schema}.auth_sessions(token_hash) ON DELETE CASCADE,
          credential_hash TEXT NOT NULL CHECK (char_length(credential_hash) BETWEEN 32 AND 180),
          platform TEXT NOT NULL DEFAULT 'ios' CHECK (platform = 'ios'),
          environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
          topic TEXT NOT NULL CHECK (char_length(topic) BETWEEN 3 AND 180),
          token_ciphertext TEXT NOT NULL CHECK (char_length(token_ciphertext) BETWEEN 16 AND 2048),
          token_nonce TEXT NOT NULL CHECK (char_length(token_nonce) BETWEEN 8 AND 180),
          token_tag TEXT NOT NULL CHECK (char_length(token_tag) BETWEEN 8 AND 180),
          token_key_version INTEGER NOT NULL DEFAULT 1 CHECK (token_key_version > 0),
          token_fingerprint TEXT NOT NULL CHECK (char_length(token_fingerprint) BETWEEN 32 AND 180),
          permission_status TEXT NOT NULL DEFAULT 'granted'
            CHECK (permission_status IN ('granted', 'denied', 'prompt')),
          protocol_version INTEGER NOT NULL DEFAULT 1 CHECK (protocol_version BETWEEN 1 AND 1000),
          app_build TEXT NOT NULL DEFAULT '' CHECK (char_length(app_build) <= 80),
          os_version TEXT NOT NULL DEFAULT '' CHECK (char_length(os_version) <= 80),
          revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
          registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          disabled_at TIMESTAMPTZ,
          invalidated_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (topic, environment, token_fingerprint)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_push_installations_user_active
          ON ${schema}.push_installations (user_id, last_seen_at DESC, id)
          WHERE disabled_at IS NULL AND invalidated_at IS NULL
            AND permission_status = 'granted'`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_push_installations_session
          ON ${schema}.push_installations (auth_session_token_hash, id)`,
        `CREATE TABLE IF NOT EXISTS ${schema}.push_preferences (
          user_id TEXT PRIMARY KEY
            REFERENCES ${schema}.auth_users(id) ON DELETE CASCADE,
          live_audio BOOLEAN NOT NULL DEFAULT true,
          friend_requests BOOLEAN NOT NULL DEFAULT true,
          friend_connections BOOLEAN NOT NULL DEFAULT true,
          track_shares BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`,
        `CREATE TABLE IF NOT EXISTS ${schema}.live_audio_friend_invites (
          id TEXT PRIMARY KEY CHECK (char_length(id) BETWEEN 6 AND 64),
          sender_user_id TEXT NOT NULL
            REFERENCES ${schema}.auth_users(id) ON DELETE CASCADE,
          target_user_id TEXT NOT NULL
            REFERENCES ${schema}.auth_users(id) ON DELETE CASCADE,
          room_id TEXT NOT NULL CHECK (char_length(room_id) BETWEEN 6 AND 64),
          origin_instance_id TEXT NOT NULL CHECK (char_length(origin_instance_id) BETWEEN 8 AND 180),
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'accepted', 'joined', 'declined', 'cancelled', 'expired')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          expires_at TIMESTAMPTZ NOT NULL,
          responded_at TIMESTAMPTZ,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          CHECK (sender_user_id <> target_user_id),
          CHECK (expires_at > created_at)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_live_audio_invites_target_pending
          ON ${schema}.live_audio_friend_invites (target_user_id, expires_at, created_at DESC)
          WHERE status = 'pending'`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_live_audio_invites_sender_pending
          ON ${schema}.live_audio_friend_invites (sender_user_id, expires_at, created_at DESC)
          WHERE status = 'pending'`,
        `CREATE TABLE IF NOT EXISTS ${schema}.push_events (
          id TEXT PRIMARY KEY CHECK (char_length(id) BETWEEN 32 AND 64),
          notification_id TEXT UNIQUE NOT NULL CHECK (char_length(notification_id) BETWEEN 32 AND 64),
          recipient_user_id TEXT NOT NULL
            REFERENCES ${schema}.auth_users(id) ON DELETE CASCADE,
          actor_user_id TEXT
            REFERENCES ${schema}.auth_users(id) ON DELETE CASCADE,
          kind TEXT NOT NULL
            CHECK (kind IN ('live_audio_invite', 'friend_request', 'friend_connection', 'track_share')),
          object_id TEXT NOT NULL CHECK (char_length(object_id) BETWEEN 1 AND 180),
          idempotency_key TEXT UNIQUE NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 300),
          collapse_id TEXT NOT NULL CHECK (char_length(collapse_id) BETWEEN 1 AND 64),
          origin_instance_id TEXT CHECK (origin_instance_id IS NULL OR char_length(origin_instance_id) BETWEEN 8 AND 180),
          state TEXT NOT NULL DEFAULT 'pending'
            CHECK (state IN ('pending', 'leased', 'dispatched', 'cancelled', 'dead')),
          not_before TIMESTAMPTZ NOT NULL DEFAULT now(),
          expires_at TIMESTAMPTZ NOT NULL,
          attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
          next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          lease_owner TEXT,
          leased_until TIMESTAMPTZ,
          last_error_code TEXT NOT NULL DEFAULT '' CHECK (char_length(last_error_code) <= 120),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          CHECK (actor_user_id IS NULL OR actor_user_id <> recipient_user_id),
          CHECK (expires_at > created_at)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_push_events_dispatch
          ON ${schema}.push_events (next_attempt_at, created_at, id)
          WHERE state IN ('pending', 'leased')`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_push_events_pair_active
          ON ${schema}.push_events (recipient_user_id, actor_user_id, created_at DESC)
          WHERE state IN ('pending', 'leased')`,
        `CREATE TABLE IF NOT EXISTS ${schema}.push_deliveries (
          event_id TEXT NOT NULL
            REFERENCES ${schema}.push_events(id) ON DELETE CASCADE,
          installation_id TEXT NOT NULL
            REFERENCES ${schema}.push_installations(id) ON DELETE CASCADE,
          apns_id TEXT NOT NULL CHECK (char_length(apns_id) BETWEEN 32 AND 64),
          state TEXT NOT NULL DEFAULT 'pending'
            CHECK (state IN ('pending', 'leased', 'sent', 'cancelled', 'dead')),
          attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
          next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          lease_owner TEXT,
          leased_until TIMESTAMPTZ,
          last_status INTEGER,
          last_error_code TEXT NOT NULL DEFAULT '' CHECK (char_length(last_error_code) <= 120),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (event_id, installation_id)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_push_deliveries_retry
          ON ${schema}.push_deliveries (next_attempt_at, created_at, event_id, installation_id)
          WHERE state IN ('pending', 'leased')`,
      ],
    },
    {
      version: 27,
      name: 'add durable club event tablet lobbies',
      statements: [
        `CREATE TABLE IF NOT EXISTS ${schema}.club_events (
          id TEXT PRIMARY KEY CHECK (char_length(id) BETWEEN 8 AND 180),
          club_id TEXT NOT NULL REFERENCES ${schema}.clubs(id) ON DELETE CASCADE,
          activity_type TEXT NOT NULL
            CHECK (activity_type IN ('bmx-race', 'straight-sprint', 'explore')),
          configuration JSONB NOT NULL DEFAULT '{}'::jsonb
            CHECK (jsonb_typeof(configuration) = 'object'),
          status TEXT NOT NULL DEFAULT 'lobby'
            CHECK (status IN ('lobby', 'active', 'cancelled')),
          start_at TIMESTAMPTZ,
          cancelled_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          CHECK (status <> 'active' OR start_at IS NOT NULL),
          CHECK (status <> 'lobby' OR start_at IS NULL),
          CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL)
        )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_tracklab_club_events_one_current
          ON ${schema}.club_events (club_id)
          WHERE status IN ('lobby', 'active')`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_club_events_history
          ON ${schema}.club_events (club_id, created_at DESC, id)`,
        `CREATE TABLE IF NOT EXISTS ${schema}.club_event_participants (
          event_id TEXT NOT NULL REFERENCES ${schema}.club_events(id) ON DELETE CASCADE,
          seat_number SMALLINT NOT NULL CHECK (seat_number BETWEEN 1 AND 4),
          device_id TEXT NOT NULL REFERENCES ${schema}.club_tablet_devices(id) ON DELETE CASCADE,
          studio_rider_id TEXT NOT NULL CHECK (char_length(studio_rider_id) BETWEEN 1 AND 160),
          rider_name TEXT NOT NULL CHECK (char_length(rider_name) BETWEEN 1 AND 120),
          bike_device_id TEXT NOT NULL CHECK (char_length(bike_device_id) BETWEEN 1 AND 160),
          session_token_hash TEXT NOT NULL CHECK (char_length(session_token_hash) = 64),
          ready BOOLEAN NOT NULL DEFAULT true,
          joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (event_id, seat_number),
          UNIQUE (event_id, device_id),
          UNIQUE (event_id, studio_rider_id),
          UNIQUE (event_id, bike_device_id)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_club_event_participants_device
          ON ${schema}.club_event_participants (device_id, event_id)`,
      ],
    },
    {
      version: 28,
      name: 'harden club event launches and deferred tablet results',
      statements: [
        `ALTER TABLE ${schema}.club_event_participants
          ADD COLUMN IF NOT EXISTS launched_at TIMESTAMPTZ`,
        `CREATE TABLE IF NOT EXISTS ${schema}.club_tablet_result_authorizations (
          token_hash TEXT PRIMARY KEY CHECK (char_length(token_hash) = 64),
          device_id TEXT NOT NULL REFERENCES ${schema}.club_tablet_devices(id) ON DELETE CASCADE,
          club_id TEXT NOT NULL REFERENCES ${schema}.clubs(id) ON DELETE CASCADE,
          studio_rider_id TEXT NOT NULL CHECK (char_length(studio_rider_id) BETWEEN 1 AND 160),
          rider_name TEXT NOT NULL CHECK (char_length(rider_name) BETWEEN 1 AND 120),
          bike_device_id TEXT NOT NULL CHECK (char_length(bike_device_id) BETWEEN 1 AND 160),
          session_token_hash TEXT NOT NULL UNIQUE CHECK (char_length(session_token_hash) = 64),
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_club_tablet_result_authorizations_expiry
          ON ${schema}.club_tablet_result_authorizations (expires_at, device_id)`,
      ],
    },
    {
      version: 29,
      name: 'make verified apple subscriptions authoritative for wattbike seats',
      statements: [
        `ALTER TABLE ${schema}.auth_users
          ADD COLUMN IF NOT EXISTS legacy_membership_tier TEXT`,
        `ALTER TABLE ${schema}.auth_users
          ADD COLUMN IF NOT EXISTS legacy_bike_seats INTEGER`,
        `UPDATE ${schema}.auth_users
          SET legacy_membership_tier = COALESCE(legacy_membership_tier, membership_tier),
              legacy_bike_seats = COALESCE(legacy_bike_seats, bike_seats)
          WHERE legacy_membership_tier IS NULL OR legacy_bike_seats IS NULL`,
        `ALTER TABLE ${schema}.auth_users
          ALTER COLUMN legacy_membership_tier SET DEFAULT 'spectator',
          ALTER COLUMN legacy_membership_tier SET NOT NULL,
          ALTER COLUMN legacy_bike_seats SET DEFAULT 1,
          ALTER COLUMN legacy_bike_seats SET NOT NULL`,
        `ALTER TABLE ${schema}.auth_users
          ADD COLUMN IF NOT EXISTS apple_billing_managed BOOLEAN NOT NULL DEFAULT false`,
        `CREATE TABLE IF NOT EXISTS ${schema}.apple_iap_subscriptions (
          original_transaction_id TEXT PRIMARY KEY
            CHECK (original_transaction_id ~ '^[1-9][0-9]{1,30}$'),
          user_id TEXT NOT NULL REFERENCES ${schema}.auth_users(id) ON DELETE CASCADE,
          app_account_token TEXT NOT NULL
            CHECK (app_account_token ~* '^[0-9a-f-]{36}$'),
          product_id TEXT NOT NULL CHECK (product_id IN (
            'com.preskilranch.tracklabbmx.wattbike.1.monthly',
            'com.preskilranch.tracklabbmx.wattbike.2.monthly',
            'com.preskilranch.tracklabbmx.wattbike.3.monthly',
            'com.preskilranch.tracklabbmx.wattbike.4.monthly'
          )),
          environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
          status TEXT NOT NULL CHECK (status IN (
            'active', 'expired', 'billing_retry', 'grace_period', 'revoked'
          )),
          bike_seats SMALLINT NOT NULL CHECK (bike_seats BETWEEN 1 AND 4),
          active BOOLEAN NOT NULL DEFAULT false,
          latest_transaction_id TEXT NOT NULL,
          purchased_at TIMESTAMPTZ NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          entitlement_expires_at TIMESTAMPTZ NOT NULL,
          signed_at TIMESTAMPTZ NOT NULL,
          revoked_at TIMESTAMPTZ,
          reconciled_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (environment, original_transaction_id),
          CHECK (entitlement_expires_at >= expires_at OR status = 'grace_period')
        )`,
        `CREATE TABLE IF NOT EXISTS ${schema}.apple_iap_transactions (
          transaction_id TEXT PRIMARY KEY CHECK (transaction_id ~ '^[1-9][0-9]{1,30}$'),
          original_transaction_id TEXT NOT NULL
            REFERENCES ${schema}.apple_iap_subscriptions(original_transaction_id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES ${schema}.auth_users(id) ON DELETE CASCADE,
          app_account_token TEXT NOT NULL,
          product_id TEXT NOT NULL,
          environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
          status TEXT NOT NULL CHECK (status IN (
            'active', 'expired', 'billing_retry', 'grace_period', 'revoked'
          )),
          bike_seats SMALLINT NOT NULL CHECK (bike_seats BETWEEN 1 AND 4),
          active BOOLEAN NOT NULL DEFAULT false,
          purchased_at TIMESTAMPTZ NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          entitlement_expires_at TIMESTAMPTZ NOT NULL,
          signed_at TIMESTAMPTZ NOT NULL,
          revoked_at TIMESTAMPTZ,
          revocation_reason INTEGER,
          is_upgraded BOOLEAN NOT NULL DEFAULT false,
          reconciled_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_apple_iap_subscriptions_user
          ON ${schema}.apple_iap_subscriptions (user_id, active, entitlement_expires_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_apple_iap_transactions_original
          ON ${schema}.apple_iap_transactions
          (original_transaction_id, signed_at DESC, transaction_id)`,
        `CREATE TABLE IF NOT EXISTS ${schema}.apple_iap_notifications (
          notification_uuid TEXT PRIMARY KEY CHECK (char_length(notification_uuid) BETWEEN 16 AND 64),
          notification_type TEXT NOT NULL CHECK (char_length(notification_type) BETWEEN 2 AND 80),
          subtype TEXT CHECK (subtype IS NULL OR char_length(subtype) <= 80),
          environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
          original_transaction_id TEXT
            REFERENCES ${schema}.apple_iap_subscriptions(original_transaction_id) ON DELETE SET NULL,
          user_id TEXT REFERENCES ${schema}.auth_users(id) ON DELETE SET NULL,
          signed_at TIMESTAMPTZ NOT NULL,
          signed_payload_sha256 TEXT NOT NULL CHECK (char_length(signed_payload_sha256) = 64),
          processing_state TEXT NOT NULL CHECK (processing_state IN ('processed', 'ignored')),
          received_at TIMESTAMPTZ NOT NULL,
          processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_apple_iap_notifications_original
          ON ${schema}.apple_iap_notifications
          (original_transaction_id, received_at DESC)
          WHERE original_transaction_id IS NOT NULL`,
      ],
    },
    {
      version: 30,
      name: 'enforce account wide wattbike connection capacity',
      statements: [
        `CREATE TABLE IF NOT EXISTS ${schema}.wattbike_connection_leases (
          billing_owner_user_id TEXT NOT NULL
            REFERENCES ${schema}.auth_users(id) ON DELETE CASCADE,
          allocation_key TEXT NOT NULL
            CHECK (char_length(allocation_key) BETWEEN 8 AND 220),
          allocation_kind TEXT NOT NULL
            CHECK (allocation_kind IN ('owner-websocket', 'club-tablet')),
          holder_instance_id TEXT NOT NULL
            CHECK (char_length(holder_instance_id) BETWEEN 8 AND 120),
          holder_id TEXT NOT NULL
            CHECK (char_length(holder_id) BETWEEN 8 AND 220),
          seat_count SMALLINT NOT NULL CHECK (seat_count BETWEEN 1 AND 4),
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (billing_owner_user_id, allocation_key)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_wattbike_connection_leases_expiry
          ON ${schema}.wattbike_connection_leases (expires_at)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_wattbike_connection_leases_owner_order
          ON ${schema}.wattbike_connection_leases
          (billing_owner_user_id, created_at, allocation_kind, allocation_key)`,
      ],
    },
    {
      version: 31,
      name: 'prepare query time apple billing entitlement projection',
      statements: [
        `CREATE INDEX IF NOT EXISTS idx_tracklab_auth_users_apple_billing_projection
          ON ${schema}.auth_users (apple_billing_managed, membership_tier, bike_seats)`,
      ],
    },
    {
      version: 32,
      name: 'add accountable community report moderation',
      statements: [
        `ALTER TABLE ${schema}.friend_reports
          ADD COLUMN IF NOT EXISTS moderation_action TEXT NOT NULL DEFAULT 'none'
            CHECK (moderation_action IN (
              'none', 'investigating', 'protect-reporter', 'warning-issued',
              'safety-escalated', 'no-violation'
            ))`,
        `ALTER TABLE ${schema}.friend_reports
          ADD COLUMN IF NOT EXISTS moderation_note TEXT NOT NULL DEFAULT ''`,
        `ALTER TABLE ${schema}.friend_reports
          ADD COLUMN IF NOT EXISTS reviewed_by_user_id TEXT
            REFERENCES ${schema}.auth_users(id) ON DELETE SET NULL`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_friend_reports_review_queue
          ON ${schema}.friend_reports (status, created_at, id)`,
      ],
    },
    {
      version: 33,
      name: 'retain pseudonymous apple lineage for restore after account deletion',
      statements: [
        `CREATE TABLE IF NOT EXISTS ${schema}.apple_iap_lineage_token_bindings (
          environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
          original_transaction_id TEXT NOT NULL
            CHECK (original_transaction_id ~ '^[1-9][0-9]{1,30}$'),
          app_account_token_sha256 TEXT NOT NULL
            CHECK (app_account_token_sha256 ~ '^[a-f0-9]{64}$'),
          bound_user_id TEXT REFERENCES ${schema}.auth_users(id) ON DELETE SET NULL,
          deleted_at TIMESTAMPTZ,
          rebound_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (environment, original_transaction_id, app_account_token_sha256)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_apple_iap_lineage_bound_user
          ON ${schema}.apple_iap_lineage_token_bindings
          (bound_user_id, updated_at DESC)
          WHERE bound_user_id IS NOT NULL`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_apple_iap_lineage_deleted_restore
          ON ${schema}.apple_iap_lineage_token_bindings
          (environment, original_transaction_id, deleted_at DESC)
          WHERE bound_user_id IS NULL`,
      ],
    },
    {
      version: 34,
      name: 'persist club tablet session assignment holders',
      statements: [
        `ALTER TABLE ${schema}.wattbike_connection_leases
          ADD COLUMN IF NOT EXISTS club_id TEXT
            REFERENCES ${schema}.clubs(id) ON DELETE CASCADE`,
        `ALTER TABLE ${schema}.wattbike_connection_leases
          ADD COLUMN IF NOT EXISTS studio_rider_id TEXT`,
        `ALTER TABLE ${schema}.wattbike_connection_leases
          ADD COLUMN IF NOT EXISTS bike_device_id TEXT`,
        `ALTER TABLE ${schema}.wattbike_connection_leases
          ADD CONSTRAINT wattbike_connection_leases_club_assignment_complete
          CHECK (
            (club_id IS NULL AND studio_rider_id IS NULL AND bike_device_id IS NULL)
            OR (
              allocation_kind = 'club-tablet'
              AND club_id IS NOT NULL
              AND studio_rider_id IS NOT NULL
              AND bike_device_id IS NOT NULL
            )
            OR (
              allocation_kind = 'club-tablet'
              AND club_id IS NULL
              AND studio_rider_id IS NULL
              AND bike_device_id IS NULL
            )
          ) NOT VALID`,
        `ALTER TABLE ${schema}.wattbike_connection_leases
          VALIDATE CONSTRAINT wattbike_connection_leases_club_assignment_complete`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_tracklab_wattbike_leases_club_rider
          ON ${schema}.wattbike_connection_leases (club_id, studio_rider_id)
          WHERE club_id IS NOT NULL`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_tracklab_wattbike_leases_club_bike
          ON ${schema}.wattbike_connection_leases (club_id, bike_device_id)
          WHERE club_id IS NOT NULL`,
      ],
    },
    {
      version: 35,
      name: 'share wattbike capacity with club personal devices',
      statements: [
        `ALTER TABLE ${schema}.wattbike_connection_leases
          DROP CONSTRAINT IF EXISTS wattbike_connection_leases_allocation_kind_check`,
        `ALTER TABLE ${schema}.wattbike_connection_leases
          ADD CONSTRAINT wattbike_connection_leases_allocation_kind_check
          CHECK (allocation_kind IN ('owner-websocket', 'club-tablet', 'club-personal'))`,
        `ALTER TABLE ${schema}.wattbike_connection_leases
          DROP CONSTRAINT IF EXISTS wattbike_connection_leases_club_assignment_complete`,
        `ALTER TABLE ${schema}.wattbike_connection_leases
          ADD CONSTRAINT wattbike_connection_leases_club_assignment_complete
          CHECK (
            (
              allocation_kind = 'owner-websocket'
              AND club_id IS NULL
              AND studio_rider_id IS NULL
              AND bike_device_id IS NULL
            )
            OR (
              allocation_kind = 'club-tablet'
              AND club_id IS NOT NULL
              AND studio_rider_id IS NOT NULL
              AND bike_device_id IS NOT NULL
            )
            OR (
              allocation_kind = 'club-tablet'
              AND club_id IS NULL
              AND studio_rider_id IS NULL
              AND bike_device_id IS NULL
            )
            OR (
              allocation_kind = 'club-personal'
              AND club_id IS NOT NULL
              AND studio_rider_id IS NOT NULL
              AND bike_device_id IS NULL
            )
          ) NOT VALID`,
        `ALTER TABLE ${schema}.wattbike_connection_leases
          VALIDATE CONSTRAINT wattbike_connection_leases_club_assignment_complete`,
      ],
    },
    {
      version: 36,
      name: 'preserve club tablet recovery and paired wattbike identity',
      statements: [
        // Build 20 first shipped credential recovery at 2026-08-28T15:34:02Z.
        // Any device that successfully used its bearer at or after that
        // boundary is already healthy (including Bike 701) and must not be
        // offered to the next iPad as a restore candidate. Older inactive
        // rows remain pending. Later enrollments default to complete.
        `ALTER TABLE ${schema}.club_tablet_devices
          ADD COLUMN IF NOT EXISTS recovery_state TEXT`,
        `UPDATE ${schema}.club_tablet_devices
          SET recovery_state = CASE
            WHEN last_seen_at >= TIMESTAMPTZ '2026-08-28 15:34:00+00' THEN 'restored'
            ELSE 'pending'
          END
          WHERE recovery_state IS NULL`,
        `ALTER TABLE ${schema}.club_tablet_devices
          ALTER COLUMN recovery_state SET DEFAULT 'complete',
          ALTER COLUMN recovery_state SET NOT NULL`,
        `ALTER TABLE ${schema}.club_tablet_devices
          DROP CONSTRAINT IF EXISTS club_tablet_devices_recovery_state_check`,
        `ALTER TABLE ${schema}.club_tablet_devices
          ADD CONSTRAINT club_tablet_devices_recovery_state_check
          CHECK (recovery_state IN ('pending', 'complete', 'restored')) NOT VALID`,
        `ALTER TABLE ${schema}.club_tablet_devices
          VALIDATE CONSTRAINT club_tablet_devices_recovery_state_check`,
        `ALTER TABLE ${schema}.club_tablet_devices
          ADD COLUMN IF NOT EXISTS paired_bike_device_id BIGINT`,
        `ALTER TABLE ${schema}.club_tablet_devices
          ADD COLUMN IF NOT EXISTS paired_bike_label TEXT`,
        `ALTER TABLE ${schema}.club_tablet_devices
          ADD COLUMN IF NOT EXISTS paired_bike_updated_at TIMESTAMPTZ`,
        `ALTER TABLE ${schema}.club_tablet_devices
          DROP CONSTRAINT IF EXISTS club_tablet_devices_paired_bike_complete`,
        `ALTER TABLE ${schema}.club_tablet_devices
          ADD CONSTRAINT club_tablet_devices_paired_bike_complete
          CHECK (
            (
              paired_bike_device_id IS NULL
              AND paired_bike_label IS NULL
              AND paired_bike_updated_at IS NULL
            )
            OR (
              paired_bike_device_id IS NOT NULL
              AND paired_bike_device_id > 0
              AND paired_bike_label IS NOT NULL
              AND char_length(paired_bike_label) BETWEEN 1 AND 120
              AND paired_bike_updated_at IS NOT NULL
            )
          ) NOT VALID`,
        `ALTER TABLE ${schema}.club_tablet_devices
          VALIDATE CONSTRAINT club_tablet_devices_paired_bike_complete`,
      ],
    },
    {
      version: 37,
      name: 'add moderated bike shop ownership claims',
      statements: [
        `CREATE TABLE IF NOT EXISTS ${schema}.bike_shop_claim_requests (
          id TEXT PRIMARY KEY CHECK (char_length(id) BETWEEN 32 AND 64),
          claimant_user_id TEXT NOT NULL
            REFERENCES ${schema}.auth_users(id) ON DELETE CASCADE,
          source TEXT NOT NULL DEFAULT 'openstreetmap'
            CHECK (source = 'openstreetmap'),
          osm_element_type TEXT NOT NULL
            CHECK (osm_element_type IN ('node', 'way', 'relation')),
          osm_element_id TEXT NOT NULL
            CHECK (osm_element_id ~ '^[1-9][0-9]{0,30}$'),
          shop_name TEXT NOT NULL CHECK (char_length(shop_name) BETWEEN 1 AND 180),
          latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
          longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
          shop_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb
            CHECK (jsonb_typeof(shop_snapshot) = 'object'),
          claimant_role TEXT NOT NULL
            CHECK (claimant_role IN ('owner', 'manager', 'authorized-representative')),
          verification_method TEXT NOT NULL
            CHECK (verification_method IN ('business-email', 'business-phone', 'documentation')),
          business_email TEXT NOT NULL DEFAULT '' CHECK (char_length(business_email) <= 254),
          business_phone TEXT NOT NULL DEFAULT '' CHECK (char_length(business_phone) <= 80),
          verification_note TEXT NOT NULL DEFAULT '' CHECK (char_length(verification_note) <= 1000),
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
          reviewer_user_id TEXT
            REFERENCES ${schema}.auth_users(id) ON DELETE SET NULL,
          review_note TEXT NOT NULL DEFAULT '' CHECK (char_length(review_note) <= 1000),
          reviewed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (claimant_user_id, source, osm_element_type, osm_element_id),
          CHECK (
            (status = 'pending' AND reviewer_user_id IS NULL AND reviewed_at IS NULL)
            OR (status = 'withdrawn' AND reviewer_user_id IS NULL AND reviewed_at IS NULL)
            OR (status IN ('approved', 'rejected') AND reviewed_at IS NOT NULL)
          )
        )`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_bike_shop_claim_review_queue
          ON ${schema}.bike_shop_claim_requests (status, created_at, id)`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_bike_shop_claim_claimant_recent
          ON ${schema}.bike_shop_claim_requests (claimant_user_id, updated_at DESC, id)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_tracklab_bike_shop_claim_approved_shop
          ON ${schema}.bike_shop_claim_requests (source, osm_element_type, osm_element_id)
          WHERE status = 'approved'`,
      ],
    },
    {
      version: 38,
      name: 'harden bike shop claim retries and erasure retention',
      statements: [
        `DO $migration$
        DECLARE
          legacy_unique_name TEXT;
        BEGIN
          SELECT constraint_name INTO legacy_unique_name
          FROM information_schema.table_constraints
          WHERE table_schema = '${schema}'
            AND table_name = 'bike_shop_claim_requests'
            AND constraint_type = 'UNIQUE'
          ORDER BY constraint_name
          LIMIT 1;
          IF legacy_unique_name IS NOT NULL THEN
            EXECUTE format(
              'ALTER TABLE %I.%I DROP CONSTRAINT %I',
              '${schema}', 'bike_shop_claim_requests', legacy_unique_name
            );
          END IF;
        END;
        $migration$`,
        `ALTER TABLE ${schema}.bike_shop_claim_requests
          DROP CONSTRAINT IF EXISTS bike_shop_claim_requests_claimant_user_id_fkey`,
        `ALTER TABLE ${schema}.bike_shop_claim_requests
          ALTER COLUMN claimant_user_id DROP NOT NULL`,
        `ALTER TABLE ${schema}.bike_shop_claim_requests
          ADD CONSTRAINT bike_shop_claim_requests_claimant_user_id_fkey
          FOREIGN KEY (claimant_user_id) REFERENCES ${schema}.auth_users(id) ON DELETE SET NULL`,
        `ALTER TABLE ${schema}.bike_shop_claim_requests
          ADD CONSTRAINT bike_shop_claim_requests_pending_claimant_required
          CHECK (status <> 'pending' OR claimant_user_id IS NOT NULL) NOT VALID`,
        `ALTER TABLE ${schema}.bike_shop_claim_requests
          VALIDATE CONSTRAINT bike_shop_claim_requests_pending_claimant_required`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_tracklab_bike_shop_claim_active_claimant_shop
          ON ${schema}.bike_shop_claim_requests (
            claimant_user_id, source, osm_element_type, osm_element_id
          )
          WHERE claimant_user_id IS NOT NULL AND status IN ('pending', 'approved')`,
      ],
    },
    {
      version: 39,
      name: 'support Overture bike shop ownership claims',
      statements: [
        `ALTER TABLE ${schema}.bike_shop_claim_requests
          DROP CONSTRAINT IF EXISTS bike_shop_claim_requests_source_check`,
        `ALTER TABLE ${schema}.bike_shop_claim_requests
          DROP CONSTRAINT IF EXISTS bike_shop_claim_requests_osm_element_type_check`,
        `ALTER TABLE ${schema}.bike_shop_claim_requests
          DROP CONSTRAINT IF EXISTS bike_shop_claim_requests_osm_element_id_check`,
        `ALTER TABLE ${schema}.bike_shop_claim_requests
          ADD CONSTRAINT bike_shop_claim_requests_source_check
          CHECK (source IN ('openstreetmap', 'overture')) NOT VALID`,
        `ALTER TABLE ${schema}.bike_shop_claim_requests
          ADD CONSTRAINT bike_shop_claim_requests_element_type_check
          CHECK (
            (source = 'openstreetmap' AND osm_element_type IN ('node', 'way', 'relation'))
            OR (source = 'overture' AND osm_element_type = 'place')
          ) NOT VALID`,
        `ALTER TABLE ${schema}.bike_shop_claim_requests
          ADD CONSTRAINT bike_shop_claim_requests_element_id_check
          CHECK (
            (source = 'openstreetmap' AND osm_element_id ~ '^[1-9][0-9]{0,30}$')
            OR (
              source = 'overture'
              AND osm_element_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            )
          ) NOT VALID`,
        `ALTER TABLE ${schema}.bike_shop_claim_requests
          VALIDATE CONSTRAINT bike_shop_claim_requests_source_check`,
        `ALTER TABLE ${schema}.bike_shop_claim_requests
          VALIDATE CONSTRAINT bike_shop_claim_requests_element_type_check`,
        `ALTER TABLE ${schema}.bike_shop_claim_requests
          VALIDATE CONSTRAINT bike_shop_claim_requests_element_id_check`,
      ],
    },
    {
      version: 40,
      name: 'preserve equivalent bike shop claim identities',
      statements: [
        `ALTER TABLE ${schema}.bike_shop_claim_requests
          ADD COLUMN IF NOT EXISTS identity_aliases JSONB NOT NULL DEFAULT '[]'::jsonb`,
        `UPDATE ${schema}.bike_shop_claim_requests
          SET identity_aliases = jsonb_build_array(
            source || ':' || osm_element_type || ':' || osm_element_id
          )
          WHERE jsonb_array_length(identity_aliases) = 0`,
        `ALTER TABLE ${schema}.bike_shop_claim_requests
          ADD CONSTRAINT bike_shop_claim_requests_identity_aliases_array
          CHECK (jsonb_typeof(identity_aliases) = 'array') NOT VALID`,
        `ALTER TABLE ${schema}.bike_shop_claim_requests
          VALIDATE CONSTRAINT bike_shop_claim_requests_identity_aliases_array`,
        `CREATE INDEX IF NOT EXISTS idx_tracklab_bike_shop_claim_identity_aliases
          ON ${schema}.bike_shop_claim_requests USING GIN (identity_aliases)`,
      ],
    },
    {
      version: 41,
      name: 'allow consented personal Watch summaries in club training',
      statements: [
        `ALTER TABLE ${schema}.heart_rate_training_segments
          DROP CONSTRAINT IF EXISTS heart_rate_training_segments_relay_scope_check`,
        `ALTER TABLE ${schema}.heart_rate_training_segments
          ADD CONSTRAINT heart_rate_training_segments_relay_scope_check CHECK (
            (relay_scope = 'studio-block' AND club_id IS NOT NULL AND studio_rider_id IS NOT NULL)
            OR (
              relay_scope = 'account-block'
              AND (
                (club_id IS NULL AND studio_rider_id IS NULL)
                OR (club_id IS NOT NULL AND studio_rider_id IS NOT NULL)
              )
            )
          ) NOT VALID`,
        `ALTER TABLE ${schema}.heart_rate_training_segments
          VALIDATE CONSTRAINT heart_rate_training_segments_relay_scope_check`,
        `ALTER TABLE ${schema}.heart_rate_training_segment_bindings
          DROP CONSTRAINT IF EXISTS heart_rate_training_segment_bindings_relay_scope_check`,
        `ALTER TABLE ${schema}.heart_rate_training_segment_bindings
          ADD CONSTRAINT heart_rate_training_segment_bindings_relay_scope_check CHECK (
            (relay_scope = 'studio-block' AND club_id IS NOT NULL AND studio_rider_id IS NOT NULL)
            OR (
              relay_scope = 'account-block'
              AND (
                (club_id IS NULL AND studio_rider_id IS NULL)
                OR (club_id IS NOT NULL AND studio_rider_id IS NOT NULL)
              )
            )
          ) NOT VALID`,
        `ALTER TABLE ${schema}.heart_rate_training_segment_bindings
          VALIDATE CONSTRAINT heart_rate_training_segment_bindings_relay_scope_check`,
      ],
    },
    {
      version: 42,
      name: 'deliver claimed athlete recovery alerts to personal devices',
      statements: [
        `ALTER TABLE ${schema}.push_events
          DROP CONSTRAINT IF EXISTS push_events_kind_check`,
        `ALTER TABLE ${schema}.push_events
          ADD CONSTRAINT push_events_kind_check
          CHECK (kind IN (
            'live_audio_invite', 'friend_request', 'friend_connection',
            'track_share', 'recovery_ready'
          )) NOT VALID`,
        `ALTER TABLE ${schema}.push_events
          VALIDATE CONSTRAINT push_events_kind_check`,
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
