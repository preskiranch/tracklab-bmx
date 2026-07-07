import pg from 'pg';

const { Pool } = pg;

const schema = 'tracklab';
const databaseUrl = process.env.DATABASE_URL?.trim();
let pool = databaseUrl
  ? new Pool({
    connectionString: databaseUrl,
    max: 6,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    ssl: databaseUrl.includes('render.com') || databaseUrl.includes('oregon-postgres')
      ? { rejectUnauthorized: false }
      : undefined,
  })
  : null;

let readyPromise = null;
const publicTrackMappingsFallback = new Map();

function json(value) {
  return JSON.stringify(value ?? null);
}

function fromJson(value, fallback) {
  if (value == null) {
    return fallback;
  }
  if (typeof value === 'object') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function persistenceEnabled() {
  return Boolean(pool);
}

export async function query(text, params = []) {
  if (!pool) {
    return null;
  }

  const ready = await initPersistence();
  if (!ready || !pool) {
    return null;
  }
  try {
    return await pool.query(text, params);
  } catch (error) {
    console.warn('[cloud] persistence query failed:', error instanceof Error ? error.message : error);
    return null;
  }
}

export async function initPersistence() {
  if (!pool) {
    return false;
  }

  if (readyPromise) {
    return readyPromise;
  }

  readyPromise = (async () => {
    try {
      await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
      await pool.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.profiles (
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
      )
    `);
      await pool.query(`ALTER TABLE ${schema}.profiles ADD COLUMN IF NOT EXISTS email TEXT`);
      await pool.query(`ALTER TABLE ${schema}.profiles ADD COLUMN IF NOT EXISTS membership_tier TEXT NOT NULL DEFAULT 'visitor'`);
      await pool.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.auth_users (
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
      )
    `);
      await pool.query(`ALTER TABLE ${schema}.auth_users ADD COLUMN IF NOT EXISTS membership_tier TEXT NOT NULL DEFAULT 'spectator'`);
      await pool.query(`ALTER TABLE ${schema}.auth_users ADD COLUMN IF NOT EXISTS bike_seats INTEGER NOT NULL DEFAULT 1`);
      await pool.query(`ALTER TABLE ${schema}.auth_users ADD COLUMN IF NOT EXISTS admin BOOLEAN NOT NULL DEFAULT false`);
      await pool.query(`ALTER TABLE ${schema}.auth_users ADD COLUMN IF NOT EXISTS square_customer_id TEXT`);
      await pool.query(`ALTER TABLE ${schema}.auth_users ADD COLUMN IF NOT EXISTS square_subscription_id TEXT`);
      await pool.query(`ALTER TABLE ${schema}.auth_users ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ`);
      await pool.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.auth_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES ${schema}.auth_users(id) ON DELETE CASCADE,
        token_hash TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
      await pool.query(`
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
      await pool.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.room_members (
        room_id TEXT NOT NULL REFERENCES ${schema}.rooms(id) ON DELETE CASCADE,
        guest_key TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'racer',
        seat_count INTEGER NOT NULL DEFAULT 1,
        joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        left_at TIMESTAMPTZ,
        PRIMARY KEY (room_id, guest_key)
      )
    `);
      await pool.query(`ALTER TABLE ${schema}.room_members ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'racer'`);
      await pool.query(`ALTER TABLE ${schema}.room_members ADD COLUMN IF NOT EXISTS seat_count INTEGER NOT NULL DEFAULT 1`);
      await pool.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.room_messages (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES ${schema}.rooms(id) ON DELETE CASCADE,
        author_guest_key TEXT,
        author_name TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
      await pool.query(`
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
      await pool.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.friend_requests (
        id TEXT PRIMARY KEY,
        from_guest_key TEXT NOT NULL,
        from_name TEXT NOT NULL,
        to_guest_key TEXT NOT NULL,
        to_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        responded_at TIMESTAMPTZ
      )
    `);
      await pool.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.friendships (
        guest_key_a TEXT NOT NULL,
        guest_key_b TEXT NOT NULL,
        display_name_a TEXT NOT NULL,
        display_name_b TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (guest_key_a, guest_key_b)
      )
    `);
      await pool.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.groups (
        id TEXT PRIMARY KEY,
        owner_guest_key TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
      await pool.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.group_members (
        group_id TEXT NOT NULL REFERENCES ${schema}.groups(id) ON DELETE CASCADE,
        guest_key TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        left_at TIMESTAMPTZ,
        PRIMARY KEY (group_id, guest_key)
      )
    `);
      await pool.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.group_invites (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL REFERENCES ${schema}.groups(id) ON DELETE CASCADE,
        from_guest_key TEXT NOT NULL,
        from_name TEXT NOT NULL,
        to_guest_key TEXT NOT NULL,
        to_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        responded_at TIMESTAMPTZ
      )
    `);
      await pool.query(`
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
      await pool.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.user_data (
        guest_key TEXT PRIMARY KEY,
        track_mappings JSONB NOT NULL DEFAULT '{}'::jsonb,
        custom_routes JSONB NOT NULL DEFAULT '[]'::jsonb,
        bike_profiles JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
      await pool.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.public_track_mappings (
        track_id TEXT PRIMARY KEY,
        track_name TEXT NOT NULL,
        country TEXT NOT NULL,
        state TEXT NOT NULL,
        mapping JSONB NOT NULL,
        published_by TEXT,
        published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
      await pool.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.ghost_laps (
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
        summary JSONB NOT NULL DEFAULT '{}'::jsonb,
        points JSONB NOT NULL DEFAULT '[]'::jsonb,
        saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (owner_key, rider_name, track_id, route_key)
      )
    `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_tracklab_profiles_available ON ${schema}.profiles (available, last_seen DESC)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_tracklab_rooms_created ON ${schema}.rooms (created_at DESC)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_tracklab_results_track ON ${schema}.race_results (track_id, created_at DESC)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_tracklab_results_speed ON ${schema}.race_results (track_id, top_speed_kph DESC NULLS LAST)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_tracklab_results_rpm ON ${schema}.race_results (track_id, top_cadence DESC NULLS LAST)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_tracklab_results_watts ON ${schema}.race_results (track_id, top_watts DESC NULLS LAST)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_tracklab_public_mappings_updated ON ${schema}.public_track_mappings (updated_at DESC)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_tracklab_ghost_laps_track ON ${schema}.ghost_laps (track_id, route_key, finish_time_ms ASC)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_tracklab_ghost_laps_owner ON ${schema}.ghost_laps (owner_key, updated_at DESC)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_tracklab_auth_users_email ON ${schema}.auth_users (email)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_tracklab_auth_sessions_token ON ${schema}.auth_sessions (token_hash)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_tracklab_auth_sessions_expires ON ${schema}.auth_sessions (expires_at)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_tracklab_friend_requests_to ON ${schema}.friend_requests (to_guest_key, status, created_at DESC)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_tracklab_friend_requests_from ON ${schema}.friend_requests (from_guest_key, status, created_at DESC)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_tracklab_group_members_guest ON ${schema}.group_members (guest_key, left_at)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_tracklab_group_invites_to ON ${schema}.group_invites (to_guest_key, status, created_at DESC)`);
      console.log('[cloud] TrackLab persistence ready.');
      return true;
    } catch (error) {
      console.warn('[cloud] TrackLab persistence disabled:', error instanceof Error ? error.message : error);
      await pool?.end().catch(() => {});
      pool = null;
      readyPromise = null;
      return false;
    }
  })();

  return readyPromise;
}

export async function upsertProfile(client) {
  return query(
    `INSERT INTO ${schema}.profiles (guest_key, display_name, email, membership_tier, available, bike_count, current_track, last_seen, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now(), now())
     ON CONFLICT (guest_key) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       email = EXCLUDED.email,
       membership_tier = EXCLUDED.membership_tier,
       available = EXCLUDED.available,
       bike_count = EXCLUDED.bike_count,
       current_track = EXCLUDED.current_track,
       last_seen = now(),
       updated_at = now()`,
    [client.guestKey, client.name, client.email || null, client.membershipTier, client.available, client.bikeCount, json(client.track)],
  );
}

export async function setProfileOffline(client) {
  return query(
    `UPDATE ${schema}.profiles SET available = false, last_seen = now(), updated_at = now() WHERE guest_key = $1`,
    [client.guestKey],
  );
}

function authUserFromRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    membershipTier: row.membership_tier,
    bikeSeats: Number(row.bike_seats) || 1,
    admin: Boolean(row.admin),
    squareCustomerId: row.square_customer_id ?? '',
    squareSubscriptionId: row.square_subscription_id ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLogin: row.last_login,
  };
}

export async function findAuthUserByEmail(email) {
  const result = await query(
    `SELECT * FROM ${schema}.auth_users WHERE email = $1 LIMIT 1`,
    [email],
  );
  return authUserFromRow(result?.rows?.[0]);
}

export async function findAuthUserById(id) {
  const result = await query(
    `SELECT * FROM ${schema}.auth_users WHERE id = $1 LIMIT 1`,
    [id],
  );
  return authUserFromRow(result?.rows?.[0]);
}

export async function createAuthUser(user) {
  const result = await query(
    `INSERT INTO ${schema}.auth_users (id, email, display_name, password_hash, membership_tier, bike_seats, admin, last_login)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     RETURNING *`,
    [
      user.id,
      user.email,
      user.displayName,
      user.passwordHash,
      user.membershipTier,
      user.bikeSeats,
      Boolean(user.admin),
    ],
  );
  return authUserFromRow(result?.rows?.[0]);
}

export async function touchAuthUserLogin(userId) {
  const result = await query(
    `UPDATE ${schema}.auth_users SET last_login = now(), updated_at = now() WHERE id = $1 RETURNING *`,
    [userId],
  );
  return authUserFromRow(result?.rows?.[0]);
}

export async function updateAuthUserMembership(userId, membershipTier, bikeSeats) {
  const result = await query(
    `UPDATE ${schema}.auth_users
     SET membership_tier = $2, bike_seats = $3, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [userId, membershipTier, bikeSeats],
  );
  return authUserFromRow(result?.rows?.[0]);
}

export async function createAuthSession(session) {
  await query(
    `INSERT INTO ${schema}.auth_sessions (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (token_hash) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       expires_at = EXCLUDED.expires_at,
       last_seen = now()`,
    [session.id, session.userId, session.tokenHash, session.expiresAt],
  );
}

export async function findAuthSession(tokenHash) {
  const result = await query(
    `SELECT
       session.id AS session_id,
       session.expires_at,
       users.*
     FROM ${schema}.auth_sessions AS session
     JOIN ${schema}.auth_users AS users ON users.id = session.user_id
     WHERE session.token_hash = $1 AND session.expires_at > now()
     LIMIT 1`,
    [tokenHash],
  );
  const row = result?.rows?.[0];
  if (!row) {
    return null;
  }

  return {
    sessionId: row.session_id,
    expiresAt: row.expires_at,
    user: authUserFromRow(row),
  };
}

export async function touchAuthSession(tokenHash) {
  await query(
    `UPDATE ${schema}.auth_sessions SET last_seen = now() WHERE token_hash = $1 AND expires_at > now()`,
    [tokenHash],
  );
}

export async function deleteAuthSession(tokenHash) {
  await query(
    `DELETE FROM ${schema}.auth_sessions WHERE token_hash = $1`,
    [tokenHash],
  );
}

export async function saveRoom(room, host) {
  return query(
    `INSERT INTO ${schema}.rooms (id, host_guest_key, host_name, private, track)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       track = EXCLUDED.track,
       private = EXCLUDED.private,
       closed_at = null`,
    [room.id, host.guestKey, host.name, room.private, json(room.track)],
  );
}

export async function updateRoomTrack(room) {
  return query(
    `UPDATE ${schema}.rooms SET track = $2::jsonb WHERE id = $1`,
    [room.id, json(room.track)],
  );
}

export async function saveRoomJoin(room, client, role = 'racer', seatCount = 1) {
  const safeSeatCount = Math.max(0, Math.min(4, Math.round(Number(seatCount) || 0)));
  return query(
    `INSERT INTO ${schema}.room_members (room_id, guest_key, display_name, role, seat_count, joined_at, left_at)
     VALUES ($1, $2, $3, $4, $5, now(), null)
     ON CONFLICT (room_id, guest_key) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       role = EXCLUDED.role,
       seat_count = EXCLUDED.seat_count,
       joined_at = now(),
       left_at = null`,
    [room.id, client.guestKey, client.name, role, safeSeatCount],
  );
}

export async function saveRoomLeave(roomId, client) {
  return query(
    `UPDATE ${schema}.room_members SET left_at = now() WHERE room_id = $1 AND guest_key = $2`,
    [roomId, client.guestKey],
  );
}

export async function saveRoomMessage(roomId, client, message) {
  return query(
    `INSERT INTO ${schema}.room_messages (id, room_id, author_guest_key, author_name, body, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [message.id, roomId, client?.guestKey ?? null, message.author, message.text, message.at],
  );
}

export async function loadRoom(roomId) {
  const result = await query(
    `SELECT id, host_guest_key, private, track, created_at FROM ${schema}.rooms WHERE id = $1 AND closed_at IS NULL`,
    [roomId],
  );
  const row = result?.rows?.[0];
  if (!row) {
    return null;
  }

  const messages = await query(
    `SELECT id, author_name, body, created_at FROM ${schema}.room_messages WHERE room_id = $1 ORDER BY created_at DESC LIMIT 40`,
    [roomId],
  );

  return {
    id: row.id,
    hostId: null,
    hostGuestKey: row.host_guest_key,
    private: row.private,
    track: fromJson(row.track, null),
    createdAt: new Date(row.created_at).getTime(),
    members: new Set(),
    raceStates: new Map(),
    messages: (messages?.rows ?? [])
      .reverse()
      .map((message) => ({
        id: message.id,
        author: message.author_name,
        text: message.body,
        at: new Date(message.created_at).toISOString(),
      })),
  };
}

export async function loadUserData(guestKey) {
  const result = await query(
    `SELECT track_mappings, custom_routes, bike_profiles FROM ${schema}.user_data WHERE guest_key = $1`,
    [guestKey],
  );
  const row = result?.rows?.[0];

  return {
    trackMappings: fromJson(row?.track_mappings, {}),
    customRoutes: fromJson(row?.custom_routes, []),
    bikeProfiles: fromJson(row?.bike_profiles, []),
  };
}

export async function saveUserData(guestKey, patch) {
  const current = await loadUserData(guestKey);
  const next = {
    trackMappings: patch.trackMappings && typeof patch.trackMappings === 'object'
      ? patch.trackMappings
      : current.trackMappings,
    customRoutes: Array.isArray(patch.customRoutes)
      ? patch.customRoutes
      : current.customRoutes,
    bikeProfiles: Array.isArray(patch.bikeProfiles)
      ? patch.bikeProfiles
      : current.bikeProfiles,
  };

  await query(
    `INSERT INTO ${schema}.user_data (guest_key, track_mappings, custom_routes, bike_profiles, updated_at)
     VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, now())
     ON CONFLICT (guest_key) DO UPDATE SET
       track_mappings = EXCLUDED.track_mappings,
       custom_routes = EXCLUDED.custom_routes,
       bike_profiles = EXCLUDED.bike_profiles,
       updated_at = now()`,
    [guestKey, json(next.trackMappings), json(next.customRoutes), json(next.bikeProfiles)],
  );

  return next;
}

export async function loadPublicTrackMappings() {
  const result = await query(
    `SELECT track_id, mapping FROM ${schema}.public_track_mappings ORDER BY updated_at DESC`,
  );

  if (!result) {
    return Object.fromEntries(publicTrackMappingsFallback.entries());
  }

  return Object.fromEntries(
    (result.rows ?? []).map((row) => [row.track_id, fromJson(row.mapping, null)]).filter((entry) => entry[1]),
  );
}

export async function savePublicTrackMappings(mappings, publishedBy = null) {
  const entries = Object.entries(mappings ?? {}).filter(([, mapping]) => mapping?.trackId);
  if (entries.length === 0) {
    return loadPublicTrackMappings();
  }

  for (const [trackId, mapping] of entries) {
    publicTrackMappingsFallback.set(trackId, mapping);
    await query(
      `INSERT INTO ${schema}.public_track_mappings (track_id, track_name, country, state, mapping, published_by, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, now())
       ON CONFLICT (track_id) DO UPDATE SET
         track_name = EXCLUDED.track_name,
         country = EXCLUDED.country,
         state = EXCLUDED.state,
         mapping = EXCLUDED.mapping,
         published_by = EXCLUDED.published_by,
         updated_at = now()`,
      [
        trackId,
        mapping.trackName,
        mapping.country,
        mapping.state,
        json(mapping),
        publishedBy,
      ],
    );
  }

  return loadPublicTrackMappings();
}

export async function saveChallenge(challenge, fromClient, targetClient) {
  return query(
    `INSERT INTO ${schema}.challenges (id, from_guest_key, from_name, to_guest_key, to_name, track, status)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'pending')
     ON CONFLICT (id) DO NOTHING`,
    [challenge.id, fromClient.guestKey, fromClient.name, targetClient.guestKey, targetClient.name, json(challenge.track)],
  );
}

function sortFriendKeys(a, b) {
  return String(a) < String(b) ? [a, b] : [b, a];
}

export async function areFriends(guestKeyA, guestKeyB) {
  const [keyA, keyB] = sortFriendKeys(guestKeyA, guestKeyB);
  const result = await query(
    `SELECT 1 FROM ${schema}.friendships WHERE guest_key_a = $1 AND guest_key_b = $2 LIMIT 1`,
    [keyA, keyB],
  );
  return Boolean(result?.rows?.[0]);
}

export async function createFriendRequest(request, fromClient, targetClient) {
  if (await areFriends(fromClient.guestKey, targetClient.guestKey)) {
    return null;
  }

  const existing = await query(
    `SELECT id FROM ${schema}.friend_requests
     WHERE status = 'pending'
       AND ((from_guest_key = $1 AND to_guest_key = $2) OR (from_guest_key = $2 AND to_guest_key = $1))
     LIMIT 1`,
    [fromClient.guestKey, targetClient.guestKey],
  );
  if (existing?.rows?.[0]) {
    return null;
  }

  await query(
    `INSERT INTO ${schema}.friend_requests (id, from_guest_key, from_name, to_guest_key, to_name, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')`,
    [request.id, fromClient.guestKey, fromClient.name, targetClient.guestKey, targetClient.name],
  );
  return request;
}

export async function respondToFriendRequest(requestId, client, accepted) {
  const result = await query(
    `UPDATE ${schema}.friend_requests
     SET status = $3, responded_at = now()
     WHERE id = $1 AND to_guest_key = $2 AND status = 'pending'
     RETURNING *`,
    [requestId, client.guestKey, accepted ? 'accepted' : 'declined'],
  );
  const request = result?.rows?.[0];
  if (!request) {
    return null;
  }

  if (accepted) {
    const [keyA, keyB] = sortFriendKeys(request.from_guest_key, request.to_guest_key);
    const nameA = keyA === request.from_guest_key ? request.from_name : request.to_name;
    const nameB = keyB === request.from_guest_key ? request.from_name : request.to_name;
    await query(
      `INSERT INTO ${schema}.friendships (guest_key_a, guest_key_b, display_name_a, display_name_b)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (guest_key_a, guest_key_b) DO UPDATE SET
         display_name_a = EXCLUDED.display_name_a,
         display_name_b = EXCLUDED.display_name_b`,
      [keyA, keyB, nameA, nameB],
    );
  }

  return {
    id: request.id,
    fromGuestKey: request.from_guest_key,
    fromName: request.from_name,
    toGuestKey: request.to_guest_key,
    toName: request.to_name,
    accepted,
  };
}

export async function createGroup(group, ownerClient) {
  await query(
    `INSERT INTO ${schema}.groups (id, owner_guest_key, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [group.id, ownerClient.guestKey, group.name],
  );
  await query(
    `INSERT INTO ${schema}.group_members (group_id, guest_key, display_name, role, joined_at, left_at)
     VALUES ($1, $2, $3, 'owner', now(), null)
     ON CONFLICT (group_id, guest_key) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       role = 'owner',
       left_at = null`,
    [group.id, ownerClient.guestKey, ownerClient.name],
  );
  return group;
}

export async function isGroupMember(groupId, guestKey) {
  const result = await query(
    `SELECT 1 FROM ${schema}.group_members WHERE group_id = $1 AND guest_key = $2 AND left_at IS NULL LIMIT 1`,
    [groupId, guestKey],
  );
  return Boolean(result?.rows?.[0]);
}

export async function createGroupInvite(invite, fromClient, targetClient) {
  if (!(await isGroupMember(invite.groupId, fromClient.guestKey))) {
    return null;
  }

  if (await isGroupMember(invite.groupId, targetClient.guestKey)) {
    return null;
  }

  const existing = await query(
    `SELECT id FROM ${schema}.group_invites
     WHERE group_id = $1 AND to_guest_key = $2 AND status = 'pending'
     LIMIT 1`,
    [invite.groupId, targetClient.guestKey],
  );
  if (existing?.rows?.[0]) {
    return null;
  }

  await query(
    `INSERT INTO ${schema}.group_invites (id, group_id, from_guest_key, from_name, to_guest_key, to_name, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
    [invite.id, invite.groupId, fromClient.guestKey, fromClient.name, targetClient.guestKey, targetClient.name],
  );
  return invite;
}

export async function respondToGroupInvite(inviteId, client, accepted) {
  const result = await query(
    `UPDATE ${schema}.group_invites
     SET status = $3, responded_at = now()
     WHERE id = $1 AND to_guest_key = $2 AND status = 'pending'
     RETURNING *`,
    [inviteId, client.guestKey, accepted ? 'accepted' : 'declined'],
  );
  const invite = result?.rows?.[0];
  if (!invite) {
    return null;
  }

  if (accepted) {
    await query(
      `INSERT INTO ${schema}.group_members (group_id, guest_key, display_name, role, joined_at, left_at)
       VALUES ($1, $2, $3, 'member', now(), null)
       ON CONFLICT (group_id, guest_key) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         role = CASE WHEN ${schema}.group_members.role = 'owner' THEN 'owner' ELSE 'member' END,
         left_at = null`,
      [invite.group_id, client.guestKey, client.name],
    );
  }

  return {
    id: invite.id,
    groupId: invite.group_id,
    fromGuestKey: invite.from_guest_key,
    toGuestKey: invite.to_guest_key,
    accepted,
  };
}

export async function loadSocialState(guestKey) {
  if (!guestKey) {
    return {
      friends: [],
      incomingFriendRequests: [],
      outgoingFriendRequests: [],
      groups: [],
      incomingGroupInvites: [],
    };
  }

  const [friends, incomingFriendRequests, outgoingFriendRequests, groups, groupMembers, incomingGroupInvites] = await Promise.all([
    query(
      `SELECT guest_key_a, guest_key_b, display_name_a, display_name_b, created_at
       FROM ${schema}.friendships
       WHERE guest_key_a = $1 OR guest_key_b = $1
       ORDER BY created_at DESC`,
      [guestKey],
    ),
    query(
      `SELECT id, from_guest_key, from_name, to_guest_key, to_name, created_at
       FROM ${schema}.friend_requests
       WHERE to_guest_key = $1 AND status = 'pending'
       ORDER BY created_at DESC
       LIMIT 25`,
      [guestKey],
    ),
    query(
      `SELECT id, from_guest_key, from_name, to_guest_key, to_name, created_at
       FROM ${schema}.friend_requests
       WHERE from_guest_key = $1 AND status = 'pending'
       ORDER BY created_at DESC
       LIMIT 25`,
      [guestKey],
    ),
    query(
      `SELECT group_table.id, group_table.name, group_table.owner_guest_key, member.role, group_table.created_at
       FROM ${schema}.groups AS group_table
       JOIN ${schema}.group_members AS member ON member.group_id = group_table.id
       WHERE member.guest_key = $1 AND member.left_at IS NULL
       ORDER BY group_table.created_at DESC
       LIMIT 25`,
      [guestKey],
    ),
    query(
      `SELECT group_id, guest_key, display_name, role
       FROM ${schema}.group_members
       WHERE left_at IS NULL
       ORDER BY joined_at ASC`,
    ),
    query(
      `SELECT invite.id, invite.group_id, invite.from_guest_key, invite.from_name, invite.to_guest_key, invite.to_name,
              group_table.name AS group_name, invite.created_at
       FROM ${schema}.group_invites AS invite
       JOIN ${schema}.groups AS group_table ON group_table.id = invite.group_id
       WHERE invite.to_guest_key = $1 AND invite.status = 'pending'
       ORDER BY invite.created_at DESC
       LIMIT 25`,
      [guestKey],
    ),
  ]);

  const membersByGroup = new Map();
  (groupMembers?.rows ?? []).forEach((row) => {
    const list = membersByGroup.get(row.group_id) ?? [];
    list.push({
      guestKey: row.guest_key,
      name: row.display_name,
      role: row.role,
    });
    membersByGroup.set(row.group_id, list);
  });

  return {
    friends: (friends?.rows ?? []).map((row) => {
      const friendIsA = row.guest_key_a !== guestKey;
      return {
        guestKey: friendIsA ? row.guest_key_a : row.guest_key_b,
        name: friendIsA ? row.display_name_a : row.display_name_b,
        createdAt: new Date(row.created_at).toISOString(),
      };
    }),
    incomingFriendRequests: (incomingFriendRequests?.rows ?? []).map((row) => ({
      id: row.id,
      fromGuestKey: row.from_guest_key,
      fromName: row.from_name,
      toGuestKey: row.to_guest_key,
      toName: row.to_name,
      createdAt: new Date(row.created_at).toISOString(),
    })),
    outgoingFriendRequests: (outgoingFriendRequests?.rows ?? []).map((row) => ({
      id: row.id,
      fromGuestKey: row.from_guest_key,
      fromName: row.from_name,
      toGuestKey: row.to_guest_key,
      toName: row.to_name,
      createdAt: new Date(row.created_at).toISOString(),
    })),
    groups: (groups?.rows ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      ownerGuestKey: row.owner_guest_key,
      role: row.role,
      members: membersByGroup.get(row.id) ?? [],
      createdAt: new Date(row.created_at).toISOString(),
    })),
    incomingGroupInvites: (incomingGroupInvites?.rows ?? []).map((row) => ({
      id: row.id,
      groupId: row.group_id,
      groupName: row.group_name,
      fromGuestKey: row.from_guest_key,
      fromName: row.from_name,
      toGuestKey: row.to_guest_key,
      toName: row.to_name,
      createdAt: new Date(row.created_at).toISOString(),
    })),
  };
}

export async function updateChallenge(challengeId, status, roomId = null) {
  return query(
    `UPDATE ${schema}.challenges SET status = $2, room_id = $3, responded_at = now() WHERE id = $1`,
    [challengeId, status, roomId],
  );
}

export async function saveRaceResults(room, client, raceState) {
  if (raceState.raceState !== 'finished' || !Array.isArray(raceState.summary) || raceState.summary.length === 0) {
    return null;
  }

  const values = [];
  const placeholders = [];
  raceState.summary.slice(0, 8).forEach((summary, index) => {
    const base = index * 17;
    const dedupeKey = `${room.id}:${client.guestKey}:${raceState.trackId}:${summary.playerId}:${summary.finishTimeMs ?? 'open'}:${Math.round(raceState.at / 1000)}`;
    values.push(
      dedupeKey,
      room.id,
      client.guestKey,
      summary.riderName,
      summary.playerId,
      raceState.trackId,
      room.track.name,
      summary.rank,
      summary.finishTimeMs,
      summary.distanceMeters ?? 0,
      summary.topSpeedKph,
      summary.averageSpeedKph,
      summary.topCadence,
      summary.averageCadence,
      summary.topWatts,
      summary.averageWatts,
      json(summary),
    );
    placeholders.push(`(
      $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8},
      $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15}, $${base + 16}, $${base + 17}::jsonb
    )`);
  });

  if (placeholders.length === 0) {
    return null;
  }

  return query(
    `INSERT INTO ${schema}.race_results (
      dedupe_key, room_id, guest_key, rider_name, player_id, track_id, track_name, rank,
      finish_time_ms, distance_meters, top_speed_kph, average_speed_kph, top_cadence, average_cadence,
      top_watts, average_watts, summary
    ) VALUES ${placeholders.join(', ')}
    ON CONFLICT (dedupe_key) DO NOTHING`,
    values,
  );
}

export async function loadLeaderboards(trackId, limit = 10) {
  const result = await query(
    `WITH latest AS (
       SELECT DISTINCT ON (track_id, guest_key, rider_name)
         track_id, rider_name, top_cadence, top_speed_kph, top_watts, created_at
       FROM ${schema}.race_results
       WHERE track_id = $1
       ORDER BY track_id, guest_key, rider_name, created_at DESC
     )
     SELECT 'rpm' AS metric, rider_name, top_cadence AS value, created_at FROM latest WHERE top_cadence IS NOT NULL
     UNION ALL
     SELECT 'speed' AS metric, rider_name, top_speed_kph AS value, created_at FROM latest WHERE top_speed_kph IS NOT NULL
     UNION ALL
     SELECT 'watts' AS metric, rider_name, top_watts AS value, created_at FROM latest WHERE top_watts IS NOT NULL`,
    [trackId],
  );

  const boards = { rpm: [], speed: [], watts: [] };
  for (const row of result?.rows ?? []) {
    boards[row.metric]?.push({
      rider: row.rider_name,
      value: row.metric === 'speed' ? Number(row.value) * 0.621371 : Number(row.value),
      unit: row.metric === 'rpm' ? 'RPM' : row.metric === 'speed' ? 'MPH' : 'W',
      date: new Date(row.created_at).toISOString().slice(0, 10),
    });
  }

  boards.rpm.sort((a, b) => b.value - a.value);
  boards.speed.sort((a, b) => b.value - a.value);
  boards.watts.sort((a, b) => b.value - a.value);

  return {
    rpm: boards.rpm.slice(0, limit),
    speed: boards.speed.slice(0, limit),
    watts: boards.watts.slice(0, limit),
  };
}

function routeKey(routeVariantId) {
  return routeVariantId === 'amateur' || routeVariantId === 'pro' ? routeVariantId : 'default';
}

function ghostFromRow(row, source = 'top') {
  return {
    version: 1,
    id: row.id,
    trackId: row.track_id,
    trackName: row.track_name,
    ...(row.route_variant_id ? { routeVariantId: row.route_variant_id } : {}),
    riderName: row.rider_name,
    ownerKey: row.owner_key,
    ownerName: row.owner_name,
    colorName: row.color_name,
    accent: row.accent,
    source,
    finishTimeMs: Number(row.finish_time_ms),
    thirtyFootTimeMs: row.thirty_foot_time_ms == null ? null : Number(row.thirty_foot_time_ms),
    savedAt: new Date(row.saved_at).getTime(),
    summary: fromJson(row.summary, {}),
    points: fromJson(row.points, []),
  };
}

export async function saveGhostLap(ghost) {
  if (!ghost?.id || !ghost.trackId || !ghost.ownerKey || !ghost.riderName || !Number.isFinite(Number(ghost.finishTimeMs))) {
    return null;
  }

  const safeRouteKey = routeKey(ghost.routeVariantId);
  return query(
    `INSERT INTO ${schema}.ghost_laps (
      id, owner_key, owner_name, rider_name, track_id, track_name, route_variant_id, route_key,
      finish_time_ms, thirty_foot_time_ms, color_name, accent, summary, points, saved_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, to_timestamp($15 / 1000.0), now())
    ON CONFLICT (owner_key, rider_name, track_id, route_key) DO UPDATE SET
      id = EXCLUDED.id,
      owner_name = EXCLUDED.owner_name,
      track_name = EXCLUDED.track_name,
      route_variant_id = EXCLUDED.route_variant_id,
      finish_time_ms = EXCLUDED.finish_time_ms,
      thirty_foot_time_ms = EXCLUDED.thirty_foot_time_ms,
      color_name = EXCLUDED.color_name,
      accent = EXCLUDED.accent,
      summary = EXCLUDED.summary,
      points = EXCLUDED.points,
      saved_at = EXCLUDED.saved_at,
      updated_at = now()
    WHERE EXCLUDED.finish_time_ms < ${schema}.ghost_laps.finish_time_ms
       OR (EXCLUDED.finish_time_ms = ${schema}.ghost_laps.finish_time_ms AND EXCLUDED.saved_at > ${schema}.ghost_laps.saved_at)
    RETURNING *`,
    [
      ghost.id,
      ghost.ownerKey,
      ghost.ownerName,
      ghost.riderName,
      ghost.trackId,
      ghost.trackName,
      ghost.routeVariantId ?? null,
      safeRouteKey,
      Math.round(Number(ghost.finishTimeMs)),
      ghost.thirtyFootTimeMs == null ? null : Math.round(Number(ghost.thirtyFootTimeMs)),
      ghost.colorName,
      ghost.accent,
      json(ghost.summary),
      json(ghost.points),
      Math.round(Number(ghost.savedAt) || Date.now()),
    ],
  );
}

export async function loadGhostLaps(trackId, profileKey = '', friendKeys = [], limit = 30) {
  const result = await query(
    `SELECT *
     FROM ${schema}.ghost_laps
     WHERE track_id = $1
     ORDER BY finish_time_ms ASC, saved_at DESC
     LIMIT $2`,
    [trackId, Math.max(1, Math.min(60, Math.round(Number(limit) || 30)))],
  );

  const friends = new Set(friendKeys);
  return (result?.rows ?? []).map((row) => {
    const source = row.owner_key === profileKey
      ? 'personal'
      : friends.has(row.owner_key)
        ? 'friend'
        : 'top';
    return ghostFromRow(row, source);
  });
}
