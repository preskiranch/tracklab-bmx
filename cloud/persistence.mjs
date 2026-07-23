import pg from 'pg';
import { runDatabaseMigrations } from './migrations.mjs';
import { cloudTelemetry } from './telemetry.mjs';

const { Pool } = pg;

const schema = 'tracklab';
const databaseUrl = process.env.DATABASE_URL?.trim();
const databaseConfigured = Boolean(databaseUrl);
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
let persistenceReady = false;
const publicTrackMappingsFallback = new Map();
const memoryUserDataByGuestKey = new Map();
const memoryAuthUsersById = new Map();
const memoryAuthUserIdByEmail = new Map();
const memoryAuthSessionsByToken = new Map();
const memoryBillingCheckoutsByState = new Map();
const memoryMap3DLoadEvents = new Map();
const memoryTrackBriefings = new Map();
const memoryLocalRaceResults = new Map();
let memoryRaceResultSequence = 0;

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

function cloneJson(value, fallback) {
  return fromJson(json(value ?? fallback), fallback);
}

function newestMappingBySavedAt(preferred, candidate) {
  if (!preferred) {
    return candidate;
  }
  if (!candidate) {
    return preferred;
  }

  const preferredAt = Date.parse(preferred.savedAt ?? '');
  const candidateAt = Date.parse(candidate.savedAt ?? '');
  return (Number.isFinite(candidateAt) ? candidateAt : 0) > (Number.isFinite(preferredAt) ? preferredAt : 0)
    ? candidate
    : preferred;
}

function authEmailKey(email) {
  return String(email || '').trim().toLowerCase();
}

function cloneAuthUser(user) {
  return user ? { ...user } : null;
}

function cloneAuthSession(session) {
  return session ? { ...session } : null;
}

export function persistenceEnabled() {
  return Boolean(pool);
}

export function persistenceStatus() {
  return {
    mode: databaseConfigured ? 'postgres' : 'memory',
    configured: databaseConfigured,
    ready: databaseConfigured ? Boolean(pool) && persistenceReady : true,
  };
}

export async function query(text, params = []) {
  if (!pool) {
    return null;
  }

  const ready = await initPersistence();
  if (!ready || !pool) {
    return null;
  }
  const startedAt = Date.now();
  const operation = String(text || '').trim().split(/\s+/, 1)[0]?.toLowerCase() || 'unknown';
  try {
    const result = await pool.query(text, params);
    cloudTelemetry.observe('tracklab_persistence_query_duration_ms', Date.now() - startedAt, { operation });
    cloudTelemetry.increment('tracklab_persistence_queries_total', { operation, outcome: 'success' });
    return result;
  } catch (error) {
    cloudTelemetry.observe('tracklab_persistence_query_duration_ms', Date.now() - startedAt, { operation });
    cloudTelemetry.increment('tracklab_persistence_queries_total', { operation, outcome: 'error' });
    cloudTelemetry.warn('persistence.query_failed', { operation, error });
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
      const migrationResult = await runDatabaseMigrations(pool, { schema });
      const appliedSummary = migrationResult.applied.length > 0
        ? ` Applied: ${migrationResult.applied.map((migration) => migration.version).join(', ')}.`
        : '';
      cloudTelemetry.setGauge('tracklab_persistence_ready', 1);
      cloudTelemetry.info('persistence.ready', {
        schemaVersion: migrationResult.currentVersion,
        appliedVersions: migrationResult.applied.map((migration) => migration.version),
        summary: appliedSummary.trim(),
      });
      persistenceReady = true;
      return true;
    } catch (error) {
      cloudTelemetry.setGauge('tracklab_persistence_ready', 0);
      cloudTelemetry.error('persistence.disabled', { error });
      await pool?.end().catch(() => {});
      pool = null;
      readyPromise = null;
      persistenceReady = false;
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
  if (!pool) {
    const id = memoryAuthUserIdByEmail.get(authEmailKey(email));
    return cloneAuthUser(id ? memoryAuthUsersById.get(id) : null);
  }

  const result = await query(
    `SELECT * FROM ${schema}.auth_users WHERE email = $1 LIMIT 1`,
    [email],
  );
  return authUserFromRow(result?.rows?.[0]);
}

export async function findAuthUserById(id) {
  if (!pool) {
    return cloneAuthUser(memoryAuthUsersById.get(id));
  }

  const result = await query(
    `SELECT * FROM ${schema}.auth_users WHERE id = $1 LIMIT 1`,
    [id],
  );
  return authUserFromRow(result?.rows?.[0]);
}

export async function createAuthUser(user) {
  if (!pool) {
    const now = new Date().toISOString();
    const memoryUser = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      passwordHash: user.passwordHash,
      membershipTier: user.membershipTier,
      bikeSeats: Number(user.bikeSeats) || 1,
      admin: Boolean(user.admin),
      squareCustomerId: '',
      squareSubscriptionId: '',
      createdAt: now,
      updatedAt: now,
      lastLogin: now,
    };
    memoryAuthUsersById.set(memoryUser.id, memoryUser);
    memoryAuthUserIdByEmail.set(authEmailKey(memoryUser.email), memoryUser.id);
    return cloneAuthUser(memoryUser);
  }

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
  if (!pool) {
    const memoryUser = memoryAuthUsersById.get(userId);
    if (!memoryUser) {
      return null;
    }
    const now = new Date().toISOString();
    memoryUser.lastLogin = now;
    memoryUser.updatedAt = now;
    return cloneAuthUser(memoryUser);
  }

  const result = await query(
    `UPDATE ${schema}.auth_users SET last_login = now(), updated_at = now() WHERE id = $1 RETURNING *`,
    [userId],
  );
  return authUserFromRow(result?.rows?.[0]);
}

export async function updateAuthUserMembership(userId, membershipTier, bikeSeats) {
  if (!pool) {
    const memoryUser = memoryAuthUsersById.get(userId);
    if (!memoryUser) {
      return null;
    }
    memoryUser.membershipTier = membershipTier;
    memoryUser.bikeSeats = Number(bikeSeats) || 1;
    memoryUser.updatedAt = new Date().toISOString();
    return cloneAuthUser(memoryUser);
  }

  const result = await query(
    `UPDATE ${schema}.auth_users
     SET membership_tier = $2, bike_seats = $3, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [userId, membershipTier, bikeSeats],
  );
  return authUserFromRow(result?.rows?.[0]);
}

export async function updateAuthUserAdminAccess(userId, bikeSeats) {
  if (!pool) {
    const memoryUser = memoryAuthUsersById.get(userId);
    if (!memoryUser) {
      return null;
    }
    memoryUser.membershipTier = 'racer';
    memoryUser.bikeSeats = Number(bikeSeats) || 1;
    memoryUser.admin = true;
    memoryUser.updatedAt = new Date().toISOString();
    return cloneAuthUser(memoryUser);
  }

  const result = await query(
    `UPDATE ${schema}.auth_users
     SET membership_tier = 'racer',
       bike_seats = $2,
       admin = true,
       updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [userId, bikeSeats],
  );
  return authUserFromRow(result?.rows?.[0]);
}

export async function createAuthSession(session) {
  if (!pool) {
    memoryAuthSessionsByToken.set(session.tokenHash, {
      id: session.id,
      userId: session.userId,
      tokenHash: session.tokenHash,
      expiresAt: session.expiresAt,
      createdAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    });
    return;
  }

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
  if (!pool) {
    const session = cloneAuthSession(memoryAuthSessionsByToken.get(tokenHash));
    if (!session || Date.parse(session.expiresAt) <= Date.now()) {
      if (session) {
        memoryAuthSessionsByToken.delete(tokenHash);
      }
      return null;
    }

    const user = cloneAuthUser(memoryAuthUsersById.get(session.userId));
    if (!user) {
      return null;
    }

    return {
      sessionId: session.id,
      expiresAt: session.expiresAt,
      lastSeen: session.lastSeen,
      user,
    };
  }

  const result = await query(
    `SELECT
       session.id AS session_id,
       session.expires_at,
       session.last_seen,
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
    lastSeen: row.last_seen,
    user: authUserFromRow(row),
  };
}

export async function touchAuthSession(tokenHash) {
  if (!pool) {
    const session = memoryAuthSessionsByToken.get(tokenHash);
    if (session && Date.parse(session.expiresAt) > Date.now()) {
      session.lastSeen = new Date().toISOString();
    }
    return;
  }

  await query(
    `UPDATE ${schema}.auth_sessions SET last_seen = now() WHERE token_hash = $1 AND expires_at > now()`,
    [tokenHash],
  );
}

export async function deleteAuthSession(tokenHash) {
  if (!pool) {
    memoryAuthSessionsByToken.delete(tokenHash);
    return;
  }

  await query(
    `DELETE FROM ${schema}.auth_sessions WHERE token_hash = $1`,
    [tokenHash],
  );
}

export async function saveBillingCheckout(checkout) {
  const record = {
    stateHash: checkout.stateHash,
    userId: checkout.userId,
    orderId: checkout.orderId,
    paymentLinkId: checkout.paymentLinkId || '',
    bikeSeats: Math.max(1, Math.min(4, Math.round(Number(checkout.bikeSeats) || 1))),
    expectedAmountCents: Math.max(0, Math.round(Number(checkout.expectedAmountCents) || 0)),
    expiresAt: checkout.expiresAt,
    claimedAt: null,
    createdAt: new Date().toISOString(),
  };

  if (!pool) {
    memoryBillingCheckoutsByState.set(record.stateHash, record);
    return { ...record };
  }

  const result = await query(
    `INSERT INTO ${schema}.billing_checkouts (
       state_hash, user_id, order_id, payment_link_id, bike_seats, expected_amount_cents, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (state_hash) DO NOTHING
     RETURNING *`,
    [
      record.stateHash,
      record.userId,
      record.orderId,
      record.paymentLinkId || null,
      record.bikeSeats,
      record.expectedAmountCents,
      record.expiresAt,
    ],
  );
  return billingCheckoutFromRow(result?.rows?.[0]);
}

function billingCheckoutFromRow(row) {
  if (!row) {
    return null;
  }

  return {
    stateHash: row.state_hash,
    userId: row.user_id,
    orderId: row.order_id,
    paymentLinkId: row.payment_link_id ?? '',
    bikeSeats: Number(row.bike_seats) || 1,
    expectedAmountCents: Number(row.expected_amount_cents) || 0,
    expiresAt: row.expires_at,
    claimedAt: row.claimed_at,
    createdAt: row.created_at,
  };
}

export async function findBillingCheckout(stateHash, userId) {
  if (!pool) {
    const record = memoryBillingCheckoutsByState.get(stateHash);
    if (!record || record.userId !== userId) {
      return null;
    }
    return { ...record };
  }

  const result = await query(
    `SELECT * FROM ${schema}.billing_checkouts
     WHERE state_hash = $1 AND user_id = $2
     LIMIT 1`,
    [stateHash, userId],
  );
  return billingCheckoutFromRow(result?.rows?.[0]);
}

export async function markBillingCheckoutClaimed(stateHash, userId) {
  if (!pool) {
    const record = memoryBillingCheckoutsByState.get(stateHash);
    if (!record || record.userId !== userId) {
      return null;
    }
    record.claimedAt = new Date().toISOString();
    return { ...record };
  }

  const result = await query(
    `UPDATE ${schema}.billing_checkouts
     SET claimed_at = COALESCE(claimed_at, now())
     WHERE state_hash = $1 AND user_id = $2
     RETURNING *`,
    [stateHash, userId],
  );
  return billingCheckoutFromRow(result?.rows?.[0]);
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

export async function closeRoom(roomId) {
  return query(
    `UPDATE ${schema}.rooms SET closed_at = now() WHERE id = $1 AND closed_at IS NULL`,
    [roomId],
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
  if (!pool) {
    const fallback = {
      trackMappings: {},
      customRoutes: [],
      bikeProfiles: [],
      studioRiders: [],
      raceViewPreferences: null,
    };
    const stored = cloneJson(memoryUserDataByGuestKey.get(guestKey), fallback);
    return {
      ...fallback,
      ...stored,
      studioRiders: Array.isArray(stored?.studioRiders) ? stored.studioRiders : [],
      raceViewPreferences: stored?.raceViewPreferences && typeof stored.raceViewPreferences === 'object'
        ? stored.raceViewPreferences
        : null,
    };
  }

  const result = await query(
    `SELECT track_mappings, custom_routes, bike_profiles, studio_riders, race_view_preferences FROM ${schema}.user_data WHERE guest_key = $1`,
    [guestKey],
  );
  const row = result?.rows?.[0];

  return {
    trackMappings: fromJson(row?.track_mappings, {}),
    customRoutes: fromJson(row?.custom_routes, []),
    bikeProfiles: fromJson(row?.bike_profiles, []),
    studioRiders: fromJson(row?.studio_riders, []),
    raceViewPreferences: fromJson(row?.race_view_preferences, null),
  };
}

export async function saveUserData(guestKey, patch) {
  const trackMappings = patch.trackMappings && typeof patch.trackMappings === 'object'
    ? patch.trackMappings
    : null;
  const customRoutes = Array.isArray(patch.customRoutes) ? patch.customRoutes : null;
  const bikeProfiles = Array.isArray(patch.bikeProfiles) ? patch.bikeProfiles : null;
  const studioRiders = Array.isArray(patch.studioRiders) ? patch.studioRiders : null;
  const raceViewPreferences = patch.raceViewPreferences && typeof patch.raceViewPreferences === 'object'
    ? patch.raceViewPreferences
    : null;

  if (!pool) {
    const current = await loadUserData(guestKey);
    const next = {
      trackMappings: trackMappings ?? current.trackMappings,
      customRoutes: customRoutes ?? current.customRoutes,
      bikeProfiles: bikeProfiles ?? current.bikeProfiles,
      studioRiders: studioRiders ?? current.studioRiders,
      raceViewPreferences: raceViewPreferences ?? current.raceViewPreferences,
    };
    memoryUserDataByGuestKey.set(guestKey, cloneJson(next, next));
    return cloneJson(next, next);
  }

  const result = await query(
    `INSERT INTO ${schema}.user_data (guest_key, track_mappings, custom_routes, bike_profiles, studio_riders, race_view_preferences, updated_at)
     VALUES (
       $1,
       COALESCE($2::jsonb, '{}'::jsonb),
       COALESCE($3::jsonb, '[]'::jsonb),
       COALESCE($4::jsonb, '[]'::jsonb),
       COALESCE($5::jsonb, '[]'::jsonb),
       $6::jsonb,
       now()
     )
     ON CONFLICT (guest_key) DO UPDATE SET
       track_mappings = COALESCE($2::jsonb, ${schema}.user_data.track_mappings),
       custom_routes = COALESCE($3::jsonb, ${schema}.user_data.custom_routes),
       bike_profiles = COALESCE($4::jsonb, ${schema}.user_data.bike_profiles),
       studio_riders = COALESCE($5::jsonb, ${schema}.user_data.studio_riders),
       race_view_preferences = COALESCE($6::jsonb, ${schema}.user_data.race_view_preferences),
       updated_at = now()
     RETURNING track_mappings, custom_routes, bike_profiles, studio_riders, race_view_preferences`,
    [
      guestKey,
      trackMappings == null ? null : json(trackMappings),
      customRoutes == null ? null : json(customRoutes),
      bikeProfiles == null ? null : json(bikeProfiles),
      studioRiders == null ? null : json(studioRiders),
      raceViewPreferences == null ? null : json(raceViewPreferences),
    ],
  );
  const row = result?.rows?.[0];
  if (!row) {
    return null;
  }

  return {
    trackMappings: fromJson(row.track_mappings, {}),
    customRoutes: fromJson(row.custom_routes, []),
    bikeProfiles: fromJson(row.bike_profiles, []),
    studioRiders: fromJson(row.studio_riders, []),
    raceViewPreferences: fromJson(row.race_view_preferences, null),
  };
}

export async function saveUserTrackMapping(
  guestKey,
  mapping,
  { publish = false, publishedBy = null } = {},
) {
  if (!mapping?.trackId) {
    return null;
  }

  if (!pool) {
    const current = await loadUserData(guestKey);
    const savedMapping = newestMappingBySavedAt(current.trackMappings[mapping.trackId], mapping);
    const next = {
      ...current,
      trackMappings: {
        ...current.trackMappings,
        [mapping.trackId]: savedMapping,
      },
    };
    memoryUserDataByGuestKey.set(guestKey, cloneJson(next, next));
    let publicMapping = null;
    if (publish) {
      publicMapping = newestMappingBySavedAt(publicTrackMappingsFallback.get(mapping.trackId), savedMapping);
      publicTrackMappingsFallback.set(mapping.trackId, cloneJson(publicMapping, publicMapping));
    }
    return {
      mapping: cloneJson(savedMapping, savedMapping),
      publicMapping: publish ? cloneJson(publicMapping, publicMapping) : null,
    };
  }

  const ready = await initPersistence();
  if (!ready || !pool) {
    return null;
  }

  let client = null;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const userResult = await client.query(
      `INSERT INTO ${schema}.user_data AS target (
         guest_key,
         track_mappings,
         custom_routes,
         bike_profiles,
         updated_at
       )
       VALUES ($1, jsonb_build_object($2::text, $3::jsonb), '[]'::jsonb, '[]'::jsonb, now())
       ON CONFLICT (guest_key) DO UPDATE SET
         track_mappings = CASE
           WHEN COALESCE(target.track_mappings -> $2::text ->> 'savedAt', '')
             <= COALESCE($3::jsonb ->> 'savedAt', '')
           THEN COALESCE(target.track_mappings, '{}'::jsonb) || EXCLUDED.track_mappings
           ELSE target.track_mappings
         END,
         updated_at = now()
       RETURNING track_mappings`,
      [guestKey, mapping.trackId, json(mapping)],
    );
    const savedMappings = fromJson(userResult.rows?.[0]?.track_mappings, {});
    const savedMapping = savedMappings[mapping.trackId];
    if (!savedMapping) {
      throw new Error('Track mapping was not returned after save.');
    }

    let publicMapping = null;
    if (publish) {
      const publicResult = await client.query(
      `INSERT INTO ${schema}.public_track_mappings AS target (
           track_id,
           track_name,
           country,
           state,
           mapping,
           published_by,
           updated_at
         )
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, now())
         ON CONFLICT (track_id) DO UPDATE SET
           track_name = EXCLUDED.track_name,
           country = EXCLUDED.country,
           state = EXCLUDED.state,
           mapping = EXCLUDED.mapping,
           published_by = EXCLUDED.published_by,
           updated_at = now()
         WHERE COALESCE(target.mapping ->> 'savedAt', '')
           <= COALESCE(EXCLUDED.mapping ->> 'savedAt', '')
         RETURNING mapping`,
        [
          savedMapping.trackId,
          savedMapping.trackName,
          savedMapping.country,
          savedMapping.state,
          json(savedMapping),
          publishedBy,
        ],
      );
      publicMapping = fromJson(publicResult.rows?.[0]?.mapping, null);
      if (!publicMapping) {
        const existingPublic = await client.query(
          `SELECT mapping FROM ${schema}.public_track_mappings WHERE track_id = $1`,
          [savedMapping.trackId],
        );
        publicMapping = fromJson(existingPublic.rows?.[0]?.mapping, savedMapping);
      }
    }

    await client.query('COMMIT');
    if (publish && publicMapping) {
      publicTrackMappingsFallback.set(savedMapping.trackId, cloneJson(publicMapping, publicMapping));
    }
    cloudTelemetry.increment('tracklab_track_mapping_saves_total', {
      outcome: 'success',
      published: publish ? 'yes' : 'no',
    });
    return {
      mapping: savedMapping,
      publicMapping: publish ? publicMapping : null,
    };
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => {});
    cloudTelemetry.increment('tracklab_track_mapping_saves_total', { outcome: 'error' });
    cloudTelemetry.warn('persistence.track_mapping_save_failed', { error });
    return null;
  } finally {
    client?.release();
  }
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

  const values = [];
  const placeholders = [];
  entries.forEach(([trackId, mapping], index) => {
    publicTrackMappingsFallback.set(trackId, mapping);
    const base = index * 6;
    values.push(trackId, mapping.trackName, mapping.country, mapping.state, json(mapping), publishedBy);
    placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::jsonb, $${base + 6}, now())`);
  });

  await query(
    `INSERT INTO ${schema}.public_track_mappings (track_id, track_name, country, state, mapping, published_by, updated_at)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (track_id) DO UPDATE SET
       track_name = EXCLUDED.track_name,
       country = EXCLUDED.country,
       state = EXCLUDED.state,
       mapping = EXCLUDED.mapping,
       published_by = EXCLUDED.published_by,
       updated_at = now()`,
    values,
  );

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

export async function loadFriendKeys(guestKey) {
  if (!guestKey) {
    return [];
  }

  const result = await query(
    `SELECT guest_key_a, guest_key_b
     FROM ${schema}.friendships
     WHERE guest_key_a = $1 OR guest_key_b = $1
     LIMIT 250`,
    [guestKey],
  );
  return (result?.rows ?? []).map((row) => (
    row.guest_key_a === guestKey ? row.guest_key_b : row.guest_key_a
  ));
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
         AND group_id IN (
           SELECT group_id
           FROM ${schema}.group_members
           WHERE guest_key = $1 AND left_at IS NULL
         )
       ORDER BY joined_at ASC`,
      [guestKey],
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
  raceState.summary.slice(0, 4).forEach((summary, index) => {
    const base = index * 17;
    const dedupeKey = `${raceState.sessionId}:${client.guestKey}:${summary.playerId}`;
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

export async function saveLocalRaceResults({
  sessionId,
  profileKey,
  trackId,
  trackName,
  summaries,
}) {
  const entries = (Array.isArray(summaries) ? summaries : []).slice(0, 4).map((summary) => ({
    dedupeKey: `local:${sessionId}:${profileKey}:${summary.playerId}`,
    roomId: 'local',
    guestKey: profileKey,
    riderName: summary.riderName,
    playerId: summary.playerId,
    trackId,
    trackName,
    rank: summary.rank,
    finishTimeMs: summary.finishTimeMs,
    distanceMeters: summary.distanceMeters ?? 0,
    topSpeedKph: summary.topSpeedKph,
    averageSpeedKph: summary.averageSpeedKph,
    topCadence: summary.topCadence,
    averageCadence: summary.averageCadence,
    topWatts: summary.topWatts,
    averageWatts: summary.averageWatts,
    summary,
    createdAt: new Date().toISOString(),
    sequence: memoryRaceResultSequence += 1,
  }));
  if (!pool) {
    entries.forEach((entry) => {
      if (!memoryLocalRaceResults.has(entry.dedupeKey)) {
        memoryLocalRaceResults.set(entry.dedupeKey, entry);
      }
    });
    return { rowCount: entries.length };
  }
  if (entries.length === 0) {
    return null;
  }
  const values = [];
  const placeholders = [];
  entries.forEach((entry, index) => {
    const base = index * 17;
    values.push(
      entry.dedupeKey,
      entry.roomId,
      entry.guestKey,
      entry.riderName,
      entry.playerId,
      entry.trackId,
      entry.trackName,
      entry.rank,
      entry.finishTimeMs,
      entry.distanceMeters,
      entry.topSpeedKph,
      entry.averageSpeedKph,
      entry.topCadence,
      entry.averageCadence,
      entry.topWatts,
      entry.averageWatts,
      json(entry.summary),
    );
    placeholders.push(`(
      $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8},
      $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15}, $${base + 16}, $${base + 17}::jsonb
    )`);
  });
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
  const safeLimit = Math.max(1, Math.min(50, Math.round(Number(limit) || 10)));
  const result = await query(
    `WITH cadence_bests AS (
       SELECT DISTINCT ON (guest_key, rider_name)
         rider_name, top_cadence AS value, created_at
       FROM ${schema}.race_results
       WHERE track_id = $1 AND top_cadence IS NOT NULL
       ORDER BY guest_key, rider_name, top_cadence DESC, created_at DESC
     ), speed_bests AS (
       SELECT DISTINCT ON (guest_key, rider_name)
         rider_name, top_speed_kph AS value, created_at
       FROM ${schema}.race_results
       WHERE track_id = $1 AND top_speed_kph IS NOT NULL
       ORDER BY guest_key, rider_name, top_speed_kph DESC, created_at DESC
     ), watt_bests AS (
       SELECT DISTINCT ON (guest_key, rider_name)
         rider_name, top_watts AS value, created_at
       FROM ${schema}.race_results
       WHERE track_id = $1 AND top_watts IS NOT NULL
       ORDER BY guest_key, rider_name, top_watts DESC, created_at DESC
     )
     SELECT 'rpm' AS metric, rider_name, value, created_at
     FROM (SELECT * FROM cadence_bests ORDER BY value DESC LIMIT $2) AS cadence_leaders
     UNION ALL
     SELECT 'speed' AS metric, rider_name, value, created_at
     FROM (SELECT * FROM speed_bests ORDER BY value DESC LIMIT $2) AS speed_leaders
     UNION ALL
     SELECT 'watts' AS metric, rider_name, value, created_at
     FROM (SELECT * FROM watt_bests ORDER BY value DESC LIMIT $2) AS watt_leaders`,
    [trackId, safeLimit],
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
    rpm: boards.rpm.slice(0, safeLimit),
    speed: boards.speed.slice(0, safeLimit),
    watts: boards.watts.slice(0, safeLimit),
  };
}

export async function loadTrackBriefing(trackId) {
  if (!pool) {
    return cloneJson(memoryTrackBriefings.get(trackId), null);
  }
  const result = await query(
    `SELECT track_id, track_name, research, researched_at
     FROM ${schema}.track_briefings
     WHERE track_id = $1
     LIMIT 1`,
    [trackId],
  );
  const row = result?.rows?.[0];
  if (!row) {
    return null;
  }
  return {
    ...fromJson(row.research, { facts: [], sources: [] }),
    trackId: row.track_id,
    trackName: row.track_name,
    researchedAt: new Date(row.researched_at).toISOString(),
  };
}

export async function saveTrackBriefing(trackId, trackName, research) {
  const saved = {
    ...cloneJson(research, { facts: [], sources: [] }),
    trackId,
    trackName,
    researchedAt: research?.researchedAt || new Date().toISOString(),
  };
  if (!pool) {
    memoryTrackBriefings.set(trackId, saved);
    return cloneJson(saved, null);
  }
  const result = await query(
    `INSERT INTO ${schema}.track_briefings (
       track_id, track_name, research, researched_at, updated_at
     )
     VALUES ($1, $2, $3::jsonb, $4, now())
     ON CONFLICT (track_id) DO UPDATE SET
       track_name = EXCLUDED.track_name,
       research = EXCLUDED.research,
       researched_at = EXCLUDED.researched_at,
       updated_at = now()
     RETURNING track_id, track_name, research, researched_at`,
    [trackId, trackName, json(research), saved.researchedAt],
  );
  const row = result?.rows?.[0];
  return row ? {
    ...fromJson(row.research, { facts: [], sources: [] }),
    trackId: row.track_id,
    trackName: row.track_name,
    researchedAt: new Date(row.researched_at).toISOString(),
  } : saved;
}

export async function loadPreRaceRiderStats(trackId, profileKey, riderNames) {
  const names = [...new Set((Array.isArray(riderNames) ? riderNames : [])
    .map((name) => String(name || '').trim())
    .filter(Boolean))]
    .slice(0, 4);
  if (!profileKey || names.length === 0) {
    return [];
  }
  if (!pool) {
    const nameKeys = new Set(names.map((name) => name.toLocaleLowerCase()));
    const matching = [...memoryLocalRaceResults.values()]
      .filter((entry) => (
        entry.trackId === trackId
        && entry.guestKey === profileKey
        && nameKeys.has(entry.riderName.toLocaleLowerCase())
      ))
      .sort((left, right) => (
        (right.sequence ?? 0) - (left.sequence ?? 0)
        || Date.parse(right.createdAt) - Date.parse(left.createdAt)
      ));
    return names.flatMap((name) => {
      const riderEntries = matching.filter((entry) => (
        entry.riderName.toLocaleLowerCase() === name.toLocaleLowerCase()
      ));
      if (riderEntries.length === 0) {
        return [];
      }
      let currentWinStreak = 0;
      for (const entry of riderEntries) {
        if (entry.rank !== 1) {
          break;
        }
        currentWinStreak += 1;
      }
      const finishedTimes = riderEntries
        .map((entry) => Number(entry.finishTimeMs))
        .filter((value) => Number.isFinite(value) && value > 0);
      return [{
        name: riderEntries[0].riderName,
        starts: riderEntries.length,
        wins: riderEntries.filter((entry) => entry.rank === 1).length,
        currentWinStreak,
        ...(finishedTimes.length > 0 ? { bestFinishTimeMs: Math.min(...finishedTimes) } : {}),
      }];
    });
  }
  const result = await query(
    `WITH matching AS (
       SELECT rider_name, rank, finish_time_ms, created_at,
         ROW_NUMBER() OVER (
           PARTITION BY lower(rider_name)
           ORDER BY created_at DESC
         ) AS recent_order
       FROM ${schema}.race_results
       WHERE track_id = $1
         AND guest_key = $2
         AND lower(rider_name) = ANY($3::text[])
     ), aggregates AS (
       SELECT
         lower(rider_name) AS rider_key,
         max(rider_name) AS rider_name,
         count(*)::integer AS starts,
         count(*) FILTER (WHERE rank = 1)::integer AS wins,
         min(finish_time_ms) FILTER (WHERE finish_time_ms IS NOT NULL)::integer AS best_finish_time_ms
       FROM matching
       GROUP BY lower(rider_name)
     ), streaks AS (
       SELECT lower(rider_name) AS rider_key,
         count(*) FILTER (WHERE rank = 1)::integer AS current_win_streak
       FROM matching
       WHERE recent_order <= (
         SELECT COALESCE(min(recent_order), 1000000)
         FROM matching AS first_loss
         WHERE lower(first_loss.rider_name) = lower(matching.rider_name)
           AND first_loss.rank <> 1
       ) - 1
       GROUP BY lower(rider_name)
     )
     SELECT aggregates.*, COALESCE(streaks.current_win_streak, 0) AS current_win_streak
     FROM aggregates
     LEFT JOIN streaks USING (rider_key)`,
    [trackId, profileKey, names.map((name) => name.toLocaleLowerCase())],
  );
  return (result?.rows ?? []).map((row) => ({
    name: row.rider_name,
    starts: Number(row.starts) || 0,
    wins: Number(row.wins) || 0,
    currentWinStreak: Number(row.current_win_streak) || 0,
    ...(row.best_finish_time_ms != null ? { bestFinishTimeMs: Number(row.best_finish_time_ms) } : {}),
  }));
}

export async function pruneExpiredData(now = Date.now()) {
  const cutoff = new Date(now);
  let removedSessions = 0;
  let removedBillingCheckouts = 0;

  for (const [tokenHash, session] of memoryAuthSessionsByToken.entries()) {
    if (Date.parse(session.expiresAt) <= cutoff.getTime()) {
      memoryAuthSessionsByToken.delete(tokenHash);
      removedSessions += 1;
    }
  }

  for (const [stateHash, checkout] of memoryBillingCheckoutsByState.entries()) {
    const claimedAt = checkout.claimedAt ? Date.parse(checkout.claimedAt) : null;
    const expired = Date.parse(checkout.expiresAt) <= cutoff.getTime();
    const claimedLongAgo = claimedAt != null && claimedAt <= cutoff.getTime() - (7 * 24 * 60 * 60 * 1000);
    if (expired || claimedLongAgo) {
      memoryBillingCheckoutsByState.delete(stateHash);
      removedBillingCheckouts += 1;
    }
  }

  if (!pool) {
    return { removedSessions, removedBillingCheckouts };
  }

  const [sessions, checkouts] = await Promise.all([
    query(
      `DELETE FROM ${schema}.auth_sessions
       WHERE expires_at <= $1
       RETURNING id`,
      [cutoff],
    ),
    query(
      `DELETE FROM ${schema}.billing_checkouts
       WHERE expires_at <= $1
          OR (claimed_at IS NOT NULL AND claimed_at <= $1 - interval '7 days')
       RETURNING state_hash`,
      [cutoff],
    ),
  ]);

  return {
    removedSessions: removedSessions + (sessions?.rowCount ?? 0),
    removedBillingCheckouts: removedBillingCheckouts + (checkouts?.rowCount ?? 0),
  };
}

export async function closePersistence() {
  const activePool = pool;
  pool = null;
  readyPromise = null;
  persistenceReady = false;
  if (activePool) {
    await activePool.end();
  }
}

function safeLapCount(value) {
  return Math.max(1, Math.min(20, Math.round(Number(value) || 1)));
}

function routeKey(routeVariantId, lapCount = 1) {
  const variant = routeVariantId === 'amateur' || routeVariantId === 'pro' ? routeVariantId : 'default';
  const laps = safeLapCount(lapCount);
  return laps > 1 ? `${variant}:laps:${laps}` : variant;
}

function ghostFromRow(row, source = 'top', includeAnalytics = false) {
  const medalRank = Number(row.medal_rank);
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
    ...(row.race_source === 'live' || row.race_source === 'demo' ? { raceSource: row.race_source } : {}),
    lapCount: safeLapCount(row.lap_count),
    finishTimeMs: Number(row.finish_time_ms),
    thirtyFootTimeMs: row.thirty_foot_time_ms == null ? null : Number(row.thirty_foot_time_ms),
    savedAt: new Date(row.saved_at).getTime(),
    analyticsPublic: Boolean(row.analytics_public),
    medalRank: medalRank >= 1 && medalRank <= 3 ? medalRank : null,
    summary: includeAnalytics ? fromJson(row.summary, null) : null,
    zoneResults: includeAnalytics ? fromJson(row.zone_results, []) : [],
    points: fromJson(row.points, []),
  };
}

export async function saveGhostLap(ghost) {
  if (!ghost?.id || !ghost.trackId || !ghost.ownerKey || !ghost.riderName || !Number.isFinite(Number(ghost.finishTimeMs))) {
    return null;
  }

  const lapCount = safeLapCount(ghost.lapCount);
  const safeRouteKey = routeKey(ghost.routeVariantId, lapCount);
  return query(
    `INSERT INTO ${schema}.ghost_laps (
      id, owner_key, owner_name, rider_name, track_id, track_name, route_variant_id, route_key,
      finish_time_ms, thirty_foot_time_ms, color_name, accent, race_source, lap_count, analytics_public,
      summary, zone_results, points, saved_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
      $16::jsonb, $17::jsonb, $18::jsonb, to_timestamp($19 / 1000.0), now())
    ON CONFLICT (owner_key, rider_name, track_id, route_key) DO UPDATE SET
      id = EXCLUDED.id,
      owner_name = EXCLUDED.owner_name,
      track_name = EXCLUDED.track_name,
      route_variant_id = EXCLUDED.route_variant_id,
      finish_time_ms = EXCLUDED.finish_time_ms,
      thirty_foot_time_ms = EXCLUDED.thirty_foot_time_ms,
      color_name = EXCLUDED.color_name,
      accent = EXCLUDED.accent,
      race_source = EXCLUDED.race_source,
      lap_count = EXCLUDED.lap_count,
      analytics_public = EXCLUDED.analytics_public,
      summary = EXCLUDED.summary,
      zone_results = EXCLUDED.zone_results,
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
      ghost.raceSource,
      lapCount,
      Boolean(ghost.analyticsPublic),
      json(ghost.summary),
      json(ghost.zoneResults ?? []),
      json(ghost.points),
      Math.round(Number(ghost.savedAt) || Date.now()),
    ],
  );
}

export async function loadGhostLaps(trackId, profileKey = '', friendKeys = [], limit = 30) {
  const result = await query(
    `SELECT ranked.*
     FROM (
       SELECT ghost_laps.*,
         DENSE_RANK() OVER (PARTITION BY route_key ORDER BY finish_time_ms ASC) AS medal_rank
       FROM ${schema}.ghost_laps AS ghost_laps
       WHERE track_id = $1 AND race_source = 'live'
     ) AS ranked
     ORDER BY
       CASE
         WHEN owner_key = $2 THEN 0
         WHEN owner_key = ANY($3::text[]) THEN 1
         ELSE 2
       END,
       finish_time_ms ASC,
       saved_at DESC
     LIMIT $4`,
    [trackId, profileKey, friendKeys, Math.max(1, Math.min(60, Math.round(Number(limit) || 30)))],
  );

  const friends = new Set(friendKeys);
  return (result?.rows ?? []).map((row) => {
    const source = row.owner_key === profileKey
      ? 'personal'
      : friends.has(row.owner_key)
        ? 'friend'
        : 'top';
    const includeAnalytics = row.owner_key === profileKey || Boolean(row.analytics_public);
    return ghostFromRow(row, source, includeAnalytics);
  });
}

function map3DUsageWindow(now = new Date()) {
  const current = new Date(now);
  const monthStart = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1));
  const dayStart = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate()));
  const activityStart = new Date(dayStart);
  activityStart.setUTCDate(activityStart.getUTCDate() - 13);
  return { current, monthStart, dayStart, activityStart };
}

function emptyMap3DUsage(monthlyAllowance, now = new Date()) {
  const { current, monthStart } = map3DUsageWindow(now);
  return {
    generatedAt: current.toISOString(),
    monthlyAllowance,
    thisMonth: {
      count: 0,
      remaining: monthlyAllowance,
      percentUsed: 0,
      startsAt: monthStart.toISOString(),
    },
    today: 0,
    lifetime: 0,
    byContext: [],
    topTracks: [],
    daily: [],
  };
}

function finalizeMap3DUsage(usage, monthlyAllowance) {
  const monthCount = Number(usage.thisMonth?.count) || 0;
  return {
    ...usage,
    thisMonth: {
      ...usage.thisMonth,
      count: monthCount,
      remaining: Math.max(0, monthlyAllowance - monthCount),
      percentUsed: monthlyAllowance > 0 ? Math.min(100, (monthCount / monthlyAllowance) * 100) : 0,
    },
  };
}

export async function recordMap3DLoad(event) {
  if (!event?.eventId || !event.trackId || !event.trackName || !['view', 'edit', 'race'].includes(event.context)) {
    return false;
  }

  const normalized = {
    eventId: event.eventId,
    userId: event.userId || null,
    trackId: event.trackId,
    trackName: event.trackName,
    context: event.context,
    createdAt: event.createdAt || new Date().toISOString(),
  };

  if (!pool) {
    if (!memoryMap3DLoadEvents.has(normalized.eventId)) {
      memoryMap3DLoadEvents.set(normalized.eventId, normalized);
    }
    return true;
  }

  const result = await query(
    `INSERT INTO ${schema}.map_3d_load_events (
      event_id, user_id, track_id, track_name, context, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (event_id) DO NOTHING
    RETURNING event_id`,
    [
      normalized.eventId,
      normalized.userId,
      normalized.trackId,
      normalized.trackName,
      normalized.context,
      normalized.createdAt,
    ],
  );
  return Boolean(result);
}

export async function loadMap3DUsage({ monthlyAllowance = 5000, now = new Date() } = {}) {
  const safeAllowance = Math.max(0, Math.round(Number(monthlyAllowance) || 0));
  const { current, monthStart, dayStart, activityStart } = map3DUsageWindow(now);

  if (!pool) {
    const events = [...memoryMap3DLoadEvents.values()]
      .filter((event) => Date.parse(event.createdAt) <= current.getTime());
    const monthEvents = events.filter((event) => Date.parse(event.createdAt) >= monthStart.getTime());
    const todayEvents = events.filter((event) => Date.parse(event.createdAt) >= dayStart.getTime());
    const contextCounts = new Map();
    const trackCounts = new Map();
    const dailyCounts = new Map();

    for (const event of monthEvents) {
      contextCounts.set(event.context, (contextCounts.get(event.context) || 0) + 1);
      const existingTrack = trackCounts.get(event.trackId) || {
        trackId: event.trackId,
        trackName: event.trackName,
        count: 0,
      };
      existingTrack.count += 1;
      trackCounts.set(event.trackId, existingTrack);
    }
    for (const event of events) {
      const createdAt = Date.parse(event.createdAt);
      if (createdAt < activityStart.getTime()) {
        continue;
      }
      const date = new Date(createdAt).toISOString().slice(0, 10);
      dailyCounts.set(date, (dailyCounts.get(date) || 0) + 1);
    }

    return finalizeMap3DUsage({
      ...emptyMap3DUsage(safeAllowance, current),
      thisMonth: { count: monthEvents.length, startsAt: monthStart.toISOString() },
      today: todayEvents.length,
      lifetime: events.length,
      byContext: [...contextCounts.entries()]
        .map(([context, count]) => ({ context, count }))
        .sort((left, right) => right.count - left.count),
      topTracks: [...trackCounts.values()]
        .sort((left, right) => right.count - left.count)
        .slice(0, 10),
      daily: [...dailyCounts.entries()]
        .map(([date, count]) => ({ date, count }))
        .sort((left, right) => left.date.localeCompare(right.date)),
    }, safeAllowance);
  }

  const result = await query(
    `WITH scoped AS (
       SELECT * FROM ${schema}.map_3d_load_events WHERE created_at <= $1
     ), month_events AS (
       SELECT * FROM scoped WHERE created_at >= $2
     )
     SELECT
       (SELECT count(*)::integer FROM month_events) AS month_count,
       (SELECT count(*)::integer FROM scoped WHERE created_at >= $3) AS today_count,
       (SELECT count(*)::integer FROM scoped) AS lifetime_count,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object('context', context, 'count', count) ORDER BY count DESC)
         FROM (SELECT context, count(*)::integer AS count FROM month_events GROUP BY context) contexts
       ), '[]'::jsonb) AS by_context,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object('trackId', track_id, 'trackName', track_name, 'count', count) ORDER BY count DESC)
         FROM (
           SELECT track_id, max(track_name) AS track_name, count(*)::integer AS count
           FROM month_events GROUP BY track_id ORDER BY count DESC LIMIT 10
         ) tracks
       ), '[]'::jsonb) AS top_tracks,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object('date', day, 'count', count) ORDER BY day)
         FROM (
           SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
             count(*)::integer AS count
           FROM scoped WHERE created_at >= $4 GROUP BY day ORDER BY day
         ) days
       ), '[]'::jsonb) AS daily`,
    [current, monthStart, dayStart, activityStart],
  );

  const row = result?.rows?.[0];
  if (!row) {
    return emptyMap3DUsage(safeAllowance, current);
  }

  return finalizeMap3DUsage({
    generatedAt: current.toISOString(),
    monthlyAllowance: safeAllowance,
    thisMonth: { count: Number(row.month_count) || 0, startsAt: monthStart.toISOString() },
    today: Number(row.today_count) || 0,
    lifetime: Number(row.lifetime_count) || 0,
    byContext: fromJson(row.by_context, []),
    topTracks: fromJson(row.top_tracks, []),
    daily: fromJson(row.daily, []),
  }, safeAllowance);
}
