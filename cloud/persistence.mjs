import pg from 'pg';
import { runDatabaseMigrations } from './migrations.mjs';
import { cloudTelemetry } from './telemetry.mjs';

const { Pool } = pg;

const schema = 'tracklab';
const maxBillingBikeSeats = 1000;
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
const publicCustomRoutesFallback = new Map();
const memoryUserDataByGuestKey = new Map();
const memoryAuthUsersById = new Map();
const memoryAuthUserIdByEmail = new Map();
const memoryAuthSessionsByToken = new Map();
const memoryBillingCheckoutsByState = new Map();
const memoryMap3DLoadEvents = new Map();
const memoryTrackBriefings = new Map();
const memoryLocalRaceResults = new Map();
const memoryGhostLaps = new Map();
const memoryTrainingSessions = new Map();
const memoryClubsById = new Map();
const memoryClubIdByOwner = new Map();
const memoryClubMembers = new Map();
const memoryClubInvitesByHash = new Map();
const memoryClubTabletDevicesById = new Map();
const memoryClubTabletDeviceIdByTokenHash = new Map();
const memoryAccountFriendships = new Map();
const memoryAccountFriendRequests = new Map();
const memoryFriendshipSuppressions = new Map();
const memoryFriendBlocks = new Map();
const memoryFriendReports = new Map();
const memoryFriendInvitesByHash = new Map();
const memoryOfficialFriendKindByUserId = new Map();
const memoryReconciledOfficialFriendUserIds = new Set();
const memoryGroupsById = new Map();
const memoryGroupMembersByKey = new Map();
const memoryGroupInvitesById = new Map();
let memoryRaceResultSequence = 0;
let memoryFriendInviteSequence = 0;

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

function jsonObjectOrNull(value) {
  const parsed = fromJson(value, null);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
}

function unitPreferenceRevisionSql(jsonExpression) {
  return `(CASE
    WHEN jsonb_typeof((${jsonExpression}) -> 'updatedAt') = 'number'
      THEN ((${jsonExpression}) ->> 'updatedAt')::numeric
    ELSE 0::numeric
  END)`;
}

function userDataUpsertStatement() {
  const storedUnitPreferences = `${schema}.user_data.unit_preferences`;
  const incomingUnitPreferences = '$9::jsonb';
  return `INSERT INTO ${schema}.user_data (guest_key, track_mappings, custom_routes, bike_profiles, studio_riders, explore_routes, account_profile, race_view_preferences, unit_preferences, updated_at)
     VALUES (
       $1,
       COALESCE($2::jsonb, '{}'::jsonb),
       COALESCE($3::jsonb, '[]'::jsonb),
       COALESCE($4::jsonb, '[]'::jsonb),
       COALESCE($5::jsonb, '[]'::jsonb),
       COALESCE($6::jsonb, '[]'::jsonb),
       COALESCE($7::jsonb, '{}'::jsonb),
       $8::jsonb,
       $9::jsonb,
       now()
     )
     ON CONFLICT (guest_key) DO UPDATE SET
       track_mappings = COALESCE($2::jsonb, ${schema}.user_data.track_mappings),
       custom_routes = COALESCE($3::jsonb, ${schema}.user_data.custom_routes),
       bike_profiles = COALESCE($4::jsonb, ${schema}.user_data.bike_profiles),
       studio_riders = COALESCE($5::jsonb, ${schema}.user_data.studio_riders),
       explore_routes = COALESCE($6::jsonb, ${schema}.user_data.explore_routes),
       account_profile = COALESCE($7::jsonb, ${schema}.user_data.account_profile),
       race_view_preferences = COALESCE($8::jsonb, ${schema}.user_data.race_view_preferences),
       unit_preferences = CASE
         WHEN ${incomingUnitPreferences} IS NULL THEN ${storedUnitPreferences}
         WHEN jsonb_typeof(${incomingUnitPreferences}) <> 'object' THEN ${storedUnitPreferences}
         WHEN ${storedUnitPreferences} IS NULL
           OR ${unitPreferenceRevisionSql(incomingUnitPreferences)} >= ${unitPreferenceRevisionSql(storedUnitPreferences)}
           THEN ${incomingUnitPreferences}
         ELSE ${storedUnitPreferences}
       END,
       updated_at = now()
     RETURNING track_mappings, custom_routes, bike_profiles, studio_riders, explore_routes, account_profile, race_view_preferences, unit_preferences`;
}

export const persistenceTestHooks = Object.freeze({
  userDataUpsertStatement,
});

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

function accountPair(userIdA, userIdB) {
  return String(userIdA) < String(userIdB)
    ? [String(userIdA), String(userIdB)]
    : [String(userIdB), String(userIdA)];
}

function accountPairKey(userIdA, userIdB) {
  return accountPair(userIdA, userIdB).join(':');
}

function normalizedUsername(displayName, userId) {
  const base = String(displayName || 'rider')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20) || 'rider';
  const suffix = String(userId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12).toLowerCase() || 'tracklab';
  return `${base}-${suffix}`;
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

async function withPersistenceLock(lockKey, operation) {
  const ready = await initPersistence();
  if (!ready || !pool) {
    return null;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey]);
    const value = await operation(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    cloudTelemetry.warn('persistence.friend_pair_transaction_failed', { error });
    return null;
  } finally {
    client.release();
  }
}

async function withAccountPairTransaction(userIdA, userIdB, operation) {
  return withPersistenceLock(`friend-pair:${accountPair(userIdA, userIdB).join(':')}`, operation);
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
    username: row.username || normalizedUsername(row.display_name, row.id),
    friendDiscoverable: row.friend_discoverable === true,
    officialFriendKind: row.official_friend_kind ?? null,
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
    `SELECT users.*, official.kind AS official_friend_kind
     FROM ${schema}.auth_users AS users
     LEFT JOIN ${schema}.official_friend_accounts AS official ON official.user_id = users.id
     WHERE users.email = $1 LIMIT 1`,
    [email],
  );
  return authUserFromRow(result?.rows?.[0]);
}

export async function findAuthUserById(id) {
  if (!pool) {
    return cloneAuthUser(memoryAuthUsersById.get(id));
  }

  const result = await query(
    `SELECT users.*, official.kind AS official_friend_kind
     FROM ${schema}.auth_users AS users
     LEFT JOIN ${schema}.official_friend_accounts AS official ON official.user_id = users.id
     WHERE users.id = $1 LIMIT 1`,
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
      username: user.username || normalizedUsername(user.displayName, user.id),
      friendDiscoverable: user.friendDiscoverable === true,
      officialFriendKind: user.officialFriendKind ?? null,
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
    if (memoryUser.officialFriendKind === 'club' || memoryUser.officialFriendKind === 'founder') {
      memoryOfficialFriendKindByUserId.set(memoryUser.id, memoryUser.officialFriendKind);
    }
    return cloneAuthUser(memoryUser);
  }

  const result = await query(
    `WITH created AS (
       INSERT INTO ${schema}.auth_users (id, email, display_name, username, friend_discoverable, password_hash, membership_tier, bike_seats, admin, last_login)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
       RETURNING *
     ), bound AS (
       INSERT INTO ${schema}.official_friend_accounts (kind, user_id)
       SELECT $10, created.id FROM created
       WHERE $10 IN ('club', 'founder')
       ON CONFLICT DO NOTHING
       RETURNING kind, user_id
     )
     SELECT created.*, bound.kind AS official_friend_kind
     FROM created LEFT JOIN bound ON bound.user_id = created.id`,
    [
      user.id,
      user.email,
      user.displayName,
      user.username || normalizedUsername(user.displayName, user.id),
      user.friendDiscoverable === true,
      user.passwordHash,
      user.membershipTier,
      user.bikeSeats,
      Boolean(user.admin),
      user.officialFriendKind ?? null,
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

export async function updateAuthUserDisplayName(userId, displayName) {
  if (!pool) {
    const memoryUser = memoryAuthUsersById.get(userId);
    if (!memoryUser) {
      return null;
    }
    memoryUser.displayName = displayName;
    memoryUser.updatedAt = new Date().toISOString();
    return cloneAuthUser(memoryUser);
  }

  const result = await query(
    `UPDATE ${schema}.auth_users
     SET display_name = $2, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [userId, displayName],
  );
  return authUserFromRow(result?.rows?.[0]);
}

export async function updateFriendDiscoverability(userId, discoverable) {
  if (!pool) {
    const user = memoryAuthUsersById.get(userId);
    if (!user) {
      return null;
    }
    user.friendDiscoverable = Boolean(discoverable);
    user.updatedAt = new Date().toISOString();
    return cloneAuthUser(user);
  }
  const result = await query(
    `UPDATE ${schema}.auth_users
     SET friend_discoverable = $2, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [userId, Boolean(discoverable)],
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
       users.*,
       official.kind AS official_friend_kind
     FROM ${schema}.auth_sessions AS session
     JOIN ${schema}.auth_users AS users ON users.id = session.user_id
     LEFT JOIN ${schema}.official_friend_accounts AS official ON official.user_id = users.id
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
    bikeSeats: Math.max(1, Math.min(maxBillingBikeSeats, Math.round(Number(checkout.bikeSeats) || 1))),
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
      exploreRoutes: [],
      accountProfile: {},
      raceViewPreferences: null,
      unitPreferences: null,
    };
    const stored = cloneJson(memoryUserDataByGuestKey.get(guestKey), fallback);
    return {
      ...fallback,
      ...stored,
      studioRiders: Array.isArray(stored?.studioRiders) ? stored.studioRiders : [],
      exploreRoutes: Array.isArray(stored?.exploreRoutes) ? stored.exploreRoutes : [],
      accountProfile: stored?.accountProfile && typeof stored.accountProfile === 'object'
        ? stored.accountProfile
        : {},
      raceViewPreferences: stored?.raceViewPreferences && typeof stored.raceViewPreferences === 'object'
        ? stored.raceViewPreferences
        : null,
      unitPreferences: jsonObjectOrNull(stored?.unitPreferences),
    };
  }

  const result = await query(
    `SELECT track_mappings, custom_routes, bike_profiles, studio_riders, explore_routes, account_profile, race_view_preferences, unit_preferences FROM ${schema}.user_data WHERE guest_key = $1`,
    [guestKey],
  );
  const row = result?.rows?.[0];

  return {
    trackMappings: fromJson(row?.track_mappings, {}),
    customRoutes: fromJson(row?.custom_routes, []),
    bikeProfiles: fromJson(row?.bike_profiles, []),
    studioRiders: fromJson(row?.studio_riders, []),
    exploreRoutes: fromJson(row?.explore_routes, []),
    accountProfile: fromJson(row?.account_profile, {}),
    raceViewPreferences: fromJson(row?.race_view_preferences, null),
    unitPreferences: jsonObjectOrNull(row?.unit_preferences),
  };
}

export async function saveUserData(guestKey, patch) {
  const trackMappings = patch.trackMappings && typeof patch.trackMappings === 'object'
    ? patch.trackMappings
    : null;
  const customRoutes = Array.isArray(patch.customRoutes) ? patch.customRoutes : null;
  const bikeProfiles = Array.isArray(patch.bikeProfiles) ? patch.bikeProfiles : null;
  const studioRiders = Array.isArray(patch.studioRiders) ? patch.studioRiders : null;
  const exploreRoutes = Array.isArray(patch.exploreRoutes) ? patch.exploreRoutes : null;
  const accountProfile = patch.accountProfile && typeof patch.accountProfile === 'object'
    ? patch.accountProfile
    : null;
  const raceViewPreferences = patch.raceViewPreferences && typeof patch.raceViewPreferences === 'object'
    ? patch.raceViewPreferences
    : null;
  const unitPreferences = patch.unitPreferences
    && typeof patch.unitPreferences === 'object'
    && !Array.isArray(patch.unitPreferences)
    ? patch.unitPreferences
    : null;

  if (!pool) {
    const current = await loadUserData(guestKey);
    const next = {
      trackMappings: trackMappings ?? current.trackMappings,
      customRoutes: customRoutes ?? current.customRoutes,
      bikeProfiles: bikeProfiles ?? current.bikeProfiles,
      studioRiders: studioRiders ?? current.studioRiders,
      exploreRoutes: exploreRoutes ?? current.exploreRoutes,
      accountProfile: accountProfile ?? current.accountProfile,
      raceViewPreferences: raceViewPreferences ?? current.raceViewPreferences,
      unitPreferences: unitPreferences ?? current.unitPreferences,
    };
    memoryUserDataByGuestKey.set(guestKey, cloneJson(next, next));
    return cloneJson(next, next);
  }

  const result = await query(
    userDataUpsertStatement(),
    [
      guestKey,
      trackMappings == null ? null : json(trackMappings),
      customRoutes == null ? null : json(customRoutes),
      bikeProfiles == null ? null : json(bikeProfiles),
      studioRiders == null ? null : json(studioRiders),
      exploreRoutes == null ? null : json(exploreRoutes),
      accountProfile == null ? null : json(accountProfile),
      raceViewPreferences == null ? null : json(raceViewPreferences),
      unitPreferences == null ? null : json(unitPreferences),
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
    exploreRoutes: fromJson(row.explore_routes, []),
    accountProfile: fromJson(row.account_profile, {}),
    raceViewPreferences: fromJson(row.race_view_preferences, null),
    unitPreferences: jsonObjectOrNull(row.unit_preferences),
  };
}

function trainingSessionFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    activityType: row.activity_type,
    title: row.title,
    startedAt: new Date(row.started_at).getTime(),
    endedAt: new Date(row.ended_at).getTime(),
    durationMs: Number(row.duration_ms) || 0,
    distanceMeters: Number(row.distance_meters) || 0,
    ...(row.track_id ? { trackId: row.track_id } : {}),
    ...(row.track_name ? { trackName: row.track_name } : {}),
    source: row.source === 'imported' ? 'imported' : 'live',
    details: fromJson(row.details, {}),
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
    ...(row.profile_key ? { _profileKey: row.profile_key } : {}),
    ...(row.club_id ? { _clubId: row.club_id } : {}),
    ...(row.club_name ? { _clubName: row.club_name } : {}),
    ...(row.studio_rider_id ? { _studioRiderId: row.studio_rider_id } : {}),
    ...(row.club_rider_name ? { _clubRiderName: row.club_rider_name } : {}),
  };
}

function enrichMemoryClubTrainingSession(session) {
  if (!session?._clubId || !session?._studioRiderId) return session;
  const club = memoryClubsById.get(session._clubId);
  const member = memoryClubMembers.get(clubMemberKey(session._clubId, session._studioRiderId));
  return {
    ...session,
    ...(club?.name ? { _clubName: club.name } : {}),
    ...(member?.riderName ? { _clubRiderName: member.riderName } : {}),
  };
}

export async function saveTrainingSession(profileKey, session) {
  const saved = {
    ...cloneJson(session, session),
    _profileKey: profileKey,
    createdAt: Number(session.createdAt) || Date.now(),
    updatedAt: Date.now(),
  };
  if (!pool) {
    memoryTrainingSessions.set(`${profileKey}:${session.id}`, saved);
    return cloneJson(enrichMemoryClubTrainingSession(saved), saved);
  }
  const result = await query(
    `INSERT INTO ${schema}.training_sessions (
       profile_key, id, activity_type, title, started_at, ended_at, duration_ms,
       distance_meters, track_id, track_name, source, details, club_id, studio_rider_id,
       created_at, updated_at
     ) VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0), to_timestamp($6 / 1000.0), $7,
       $8, $9, $10, $11, $12::jsonb, $13, $14, to_timestamp($15 / 1000.0), now())
     ON CONFLICT (profile_key, id) DO UPDATE SET
       activity_type = EXCLUDED.activity_type,
       title = EXCLUDED.title,
       started_at = EXCLUDED.started_at,
       ended_at = EXCLUDED.ended_at,
       duration_ms = EXCLUDED.duration_ms,
       distance_meters = EXCLUDED.distance_meters,
       track_id = EXCLUDED.track_id,
       track_name = EXCLUDED.track_name,
       source = EXCLUDED.source,
       details = EXCLUDED.details,
       club_id = EXCLUDED.club_id,
       studio_rider_id = EXCLUDED.studio_rider_id,
       updated_at = now()
     RETURNING *`,
    [
      profileKey,
      session.id,
      session.activityType,
      session.title,
      session.startedAt,
      session.endedAt,
      session.durationMs,
      session.distanceMeters,
      session.trackId ?? null,
      session.trackName ?? null,
      session.source,
      json(session.details),
      session._clubId ?? null,
      session._studioRiderId ?? null,
      saved.createdAt,
    ],
  );
  const stored = trainingSessionFromRow(result?.rows?.[0]);
  if (!stored) return null;
  return {
    ...stored,
    ...(session._clubName ? { _clubName: session._clubName } : {}),
    ...(session._clubRiderName ? { _clubRiderName: session._clubRiderName } : {}),
  };
}

export async function loadTrainingSessionById(profileKey, id) {
  if (!profileKey || !id) return null;
  if (!pool) {
    const session = memoryTrainingSessions.get(`${profileKey}:${id}`);
    return session ? cloneJson(enrichMemoryClubTrainingSession(session), session) : null;
  }
  const result = await query(
    `SELECT sessions.*, clubs.name AS club_name, members.rider_name AS club_rider_name
     FROM ${schema}.training_sessions AS sessions
     LEFT JOIN ${schema}.clubs AS clubs ON clubs.id = sessions.club_id
     LEFT JOIN ${schema}.club_members AS members
       ON members.club_id = sessions.club_id AND members.studio_rider_id = sessions.studio_rider_id
     WHERE sessions.profile_key = $1 AND sessions.id = $2
     LIMIT 1`,
    [profileKey, id],
  );
  const row = result?.rows?.[0];
  const session = trainingSessionFromRow(row);
  return session ? {
    ...session,
    ...(row.club_name ? { _clubName: row.club_name } : {}),
    ...(row.club_rider_name ? { _clubRiderName: row.club_rider_name } : {}),
  } : null;
}

function legacyRaceSessionId(entry, profileKey) {
  const suffix = `:${profileKey}:${entry.playerId}`;
  const raw = String(entry.dedupeKey || '');
  return (raw.endsWith(suffix) ? raw.slice(0, -suffix.length) : raw).replace(/^local:/, '');
}

function legacyRaceSessions(entries, profileKey) {
  const groups = new Map();
  entries.forEach((entry) => {
    const id = legacyRaceSessionId(entry, profileKey);
    groups.set(id, [...(groups.get(id) ?? []), entry]);
  });
  return [...groups.entries()].map(([id, results]) => {
    const first = results[0];
    const summaries = results.map((result) => result.summary ?? {});
    const sprint = summaries.find((summary) => Number(summary.sprintDistanceFeet) > 0);
    const startedAt = Date.parse(first.createdAt) || Date.now();
    const durationMs = Math.max(0, ...results.map((result) => Number(result.finishTimeMs) || 0));
    const distanceMeters = Math.max(0, ...results.map((result) => Number(result.distanceMeters) || 0));
    const activityType = sprint ? 'straight-sprint' : 'bmx-race';
    return {
      id,
      activityType,
      title: sprint ? `${Number(sprint.sprintDistanceFeet)} ft at ${first.trackName}` : first.trackName,
      startedAt,
      endedAt: startedAt + durationMs,
      durationMs,
      distanceMeters,
      trackId: first.trackId,
      trackName: first.trackName,
      source: 'imported',
      details: {
        summaries,
        ...(sprint ? {
          sprintDistanceFeet: Number(sprint.sprintDistanceFeet),
          sprintAirSetting: Number(sprint.sprintAirSetting) || undefined,
        } : {}),
      },
      createdAt: startedAt,
      updatedAt: startedAt,
    };
  });
}

export async function loadTrainingSessions(profileKey, { from = 0, to = Date.now(), limit = 1000 } = {}) {
  const safeLimit = Math.max(1, Math.min(2000, Math.round(Number(limit) || 1000)));
  let sessions;
  let raceEntries;
  if (!pool) {
    sessions = [...memoryTrainingSessions.entries()]
      .filter(([key, session]) => key.startsWith(`${profileKey}:`) && session.startedAt >= from && session.startedAt <= to)
      .map(([, session]) => cloneJson(enrichMemoryClubTrainingSession(session), session));
    raceEntries = [...memoryLocalRaceResults.values()]
      .filter((entry) => entry.guestKey === profileKey && Date.parse(entry.createdAt) >= from && Date.parse(entry.createdAt) <= to);
  } else {
    const [sessionResult, raceResult] = await Promise.all([
      query(
        `SELECT sessions.*, clubs.name AS club_name, members.rider_name AS club_rider_name
         FROM ${schema}.training_sessions AS sessions
         LEFT JOIN ${schema}.clubs AS clubs ON clubs.id = sessions.club_id
         LEFT JOIN ${schema}.club_members AS members
           ON members.club_id = sessions.club_id AND members.studio_rider_id = sessions.studio_rider_id
         WHERE sessions.profile_key = $1
           AND sessions.started_at >= to_timestamp($2 / 1000.0)
           AND sessions.started_at <= to_timestamp($3 / 1000.0)
         ORDER BY sessions.started_at DESC LIMIT $4`,
        [profileKey, from, to, safeLimit],
      ),
      query(
        `SELECT dedupe_key, guest_key, rider_name, player_id, track_id, track_name, rank,
           finish_time_ms, distance_meters, top_speed_kph, average_speed_kph, top_cadence,
           average_cadence, top_watts, average_watts, summary, created_at
         FROM ${schema}.race_results
         WHERE guest_key = $1 AND created_at >= to_timestamp($2 / 1000.0) AND created_at <= to_timestamp($3 / 1000.0)
         ORDER BY created_at DESC LIMIT $4`,
        [profileKey, from, to, safeLimit * 4],
      ),
    ]);
    sessions = (sessionResult?.rows ?? []).map(trainingSessionFromRow).filter(Boolean);
    raceEntries = (raceResult?.rows ?? []).map((row) => ({
      dedupeKey: row.dedupe_key,
      guestKey: row.guest_key,
      riderName: row.rider_name,
      playerId: Number(row.player_id),
      trackId: row.track_id,
      trackName: row.track_name,
      rank: Number(row.rank),
      finishTimeMs: row.finish_time_ms == null ? null : Number(row.finish_time_ms),
      distanceMeters: Number(row.distance_meters) || 0,
      summary: fromJson(row.summary, {}),
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }
  const byId = new Map(sessions.map((session) => [session.id, session]));
  legacyRaceSessions(raceEntries, profileKey).forEach((session) => {
    if (!byId.has(session.id)) byId.set(session.id, session);
  });
  return [...byId.values()]
    .sort((left, right) => right.startedAt - left.startedAt)
    .slice(0, safeLimit);
}

export async function loadClubTrainingSessions(ownerProfileKey, { from = 0, to = Date.now(), limit = 1000 } = {}) {
  const safeLimit = Math.max(1, Math.min(2000, Math.round(Number(limit) || 1000)));
  if (!pool) {
    const ownedClubId = memoryClubIdByOwner.get(ownerProfileKey);
    if (!ownedClubId) return [];
    return [...memoryTrainingSessions.values()]
      .filter((session) => (
        session._clubId === ownedClubId
        && session._profileKey !== ownerProfileKey
        && session.startedAt >= from
        && session.startedAt <= to
      ))
      .map((session) => cloneJson(enrichMemoryClubTrainingSession(session), session))
      .sort((left, right) => right.startedAt - left.startedAt)
      .slice(0, safeLimit);
  }
  const result = await query(
    `SELECT sessions.*, clubs.name AS club_name, members.rider_name AS club_rider_name
     FROM ${schema}.training_sessions AS sessions
     JOIN ${schema}.clubs AS clubs ON clubs.id = sessions.club_id
     LEFT JOIN ${schema}.club_members AS members
       ON members.club_id = sessions.club_id AND members.studio_rider_id = sessions.studio_rider_id
     WHERE clubs.owner_profile_key = $1
       AND sessions.profile_key <> $1
       AND sessions.started_at >= to_timestamp($2 / 1000.0)
       AND sessions.started_at <= to_timestamp($3 / 1000.0)
     ORDER BY sessions.started_at DESC LIMIT $4`,
    [ownerProfileKey, from, to, safeLimit],
  );
  return (result?.rows ?? []).map(trainingSessionFromRow).filter(Boolean);
}

function clubMemberKey(clubId, studioRiderId) {
  return `${clubId}:${studioRiderId}`;
}

function clubFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerProfileKey: row.owner_profile_key,
    name: row.name,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

function clubMemberFromRow(row) {
  if (!row) return null;
  return {
    clubId: row.club_id,
    studioRiderId: row.studio_rider_id,
    riderName: row.rider_name,
    athleteProfileKey: row.athlete_profile_key || null,
    athleteName: row.athlete_name || null,
    status: row.status === 'claimed' ? 'claimed' : 'unclaimed',
    claimedAt: row.claimed_at ? new Date(row.claimed_at).getTime() : null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at).getTime() : null,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

export async function ensureClub(ownerProfileKey, ownerName, clubId) {
  const now = Date.now();
  if (!pool) {
    const existingId = memoryClubIdByOwner.get(ownerProfileKey);
    const id = existingId || clubId;
    const existing = memoryClubsById.get(id);
    const club = {
      id,
      ownerProfileKey,
      name: ownerName,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    memoryClubsById.set(id, club);
    memoryClubIdByOwner.set(ownerProfileKey, id);
    return cloneJson(club, club);
  }
  const result = await query(
    `INSERT INTO ${schema}.clubs (id, owner_profile_key, name, created_at, updated_at)
     VALUES ($1, $2, $3, now(), now())
     ON CONFLICT (owner_profile_key) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
     RETURNING *`,
    [clubId, ownerProfileKey, ownerName],
  );
  return clubFromRow(result?.rows?.[0]);
}

function clubTabletDeviceFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    clubId: row.club_id,
    clubName: row.club_name,
    ownerProfileKey: row.owner_profile_key,
    name: row.name,
    tokenHash: row.token_hash,
    lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at).getTime() : null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at).getTime() : null,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

function enrichMemoryClubTabletDevice(device) {
  const club = device ? memoryClubsById.get(device.clubId) : null;
  if (!device || !club) return null;
  return {
    ...device,
    clubName: club.name,
    ownerProfileKey: club.ownerProfileKey,
  };
}

export async function enrollClubTabletDevice({
  id,
  ownerProfileKey,
  ownerUserId,
  name,
  tokenHash,
  authSessionTokenHash,
}) {
  const now = Date.now();
  if (!pool) {
    const clubId = memoryClubIdByOwner.get(ownerProfileKey);
    const authSession = memoryAuthSessionsByToken.get(authSessionTokenHash);
    if (
      !clubId
      || memoryClubTabletDeviceIdByTokenHash.has(tokenHash)
      || !authSession
      || authSession.userId !== ownerUserId
      || Date.parse(authSession.expiresAt) <= now
    ) {
      return null;
    }
    const device = {
      id,
      clubId,
      name,
      tokenHash,
      lastSeenAt: now,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    // These synchronous memory mutations are one enrollment boundary: no
    // successful device can coexist with the owner session that authorized it.
    memoryClubTabletDevicesById.set(id, device);
    memoryClubTabletDeviceIdByTokenHash.set(tokenHash, id);
    memoryAuthSessionsByToken.delete(authSessionTokenHash);
    return cloneJson(enrichMemoryClubTabletDevice(device), device);
  }

  const ready = await initPersistence();
  if (!ready || !pool) return null;
  let client = null;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    // Consume the exact browser session first. The row lock ensures that two
    // simultaneous enrollments made with one owner cookie cannot both mint a
    // durable tablet credential. A later insert failure rolls this deletion
    // back with the rest of the transaction.
    const retiredSession = await client.query(
      `DELETE FROM ${schema}.auth_sessions
       WHERE token_hash = $1 AND user_id = $2 AND expires_at > now()
       RETURNING id`,
      [authSessionTokenHash, ownerUserId],
    );
    if (!retiredSession.rows?.[0]) {
      throw new Error('Club Tablet enrollment could not retire its authorizing owner session.');
    }
    const deviceResult = await client.query(
      `INSERT INTO ${schema}.club_tablet_devices (
         id, club_id, name, token_hash, last_seen_at, created_at, updated_at
       )
       SELECT $1, clubs.id, $3, $4, now(), now(), now()
       FROM ${schema}.clubs AS clubs
       WHERE clubs.owner_profile_key = $2
       RETURNING *`,
      [id, ownerProfileKey, name, tokenHash],
    );
    const row = deviceResult.rows?.[0];
    if (!row) throw new Error('Club Tablet enrollment did not create a device.');
    const clubResult = await client.query(
      `SELECT name FROM ${schema}.clubs WHERE id = $1`,
      [row.club_id],
    );
    await client.query('COMMIT');
    cloudTelemetry.increment('tracklab_club_tablet_enrollments_total', { outcome: 'success' });
    return clubTabletDeviceFromRow({
      ...row,
      owner_profile_key: ownerProfileKey,
      club_name: clubResult.rows?.[0]?.name,
    });
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => {});
    cloudTelemetry.increment('tracklab_club_tablet_enrollments_total', { outcome: 'error' });
    cloudTelemetry.warn('persistence.club_tablet_enrollment_failed', { error });
    return null;
  } finally {
    client?.release();
  }
}

export async function loadClubTabletDeviceByTokenHash(deviceTokenHash) {
  if (!pool) {
    const id = memoryClubTabletDeviceIdByTokenHash.get(deviceTokenHash);
    const device = id ? memoryClubTabletDevicesById.get(id) : null;
    if (!device || device.revokedAt) return null;
    device.lastSeenAt = Date.now();
    device.updatedAt = Date.now();
    return cloneJson(enrichMemoryClubTabletDevice(device), device);
  }
  const result = await query(
    `UPDATE ${schema}.club_tablet_devices AS devices
     SET last_seen_at = now(), updated_at = now()
     FROM ${schema}.clubs AS clubs
     WHERE devices.club_id = clubs.id
       AND devices.token_hash = $1
       AND devices.revoked_at IS NULL
     RETURNING devices.*, clubs.name AS club_name, clubs.owner_profile_key`,
    [deviceTokenHash],
  );
  return clubTabletDeviceFromRow(result?.rows?.[0]);
}

export async function listClubTabletDevices(ownerProfileKey) {
  if (!pool) {
    const clubId = memoryClubIdByOwner.get(ownerProfileKey);
    if (!clubId) return [];
    return [...memoryClubTabletDevicesById.values()]
      .filter((device) => device.clubId === clubId && !device.revokedAt)
      .map((device) => cloneJson(enrichMemoryClubTabletDevice(device), device))
      .sort((left, right) => left.createdAt - right.createdAt);
  }
  const result = await query(
    `SELECT devices.*, clubs.name AS club_name, clubs.owner_profile_key
     FROM ${schema}.club_tablet_devices AS devices
     JOIN ${schema}.clubs AS clubs ON clubs.id = devices.club_id
     WHERE clubs.owner_profile_key = $1 AND devices.revoked_at IS NULL
     ORDER BY devices.created_at`,
    [ownerProfileKey],
  );
  return (result?.rows ?? []).map(clubTabletDeviceFromRow).filter(Boolean);
}

export async function revokeClubTabletDevice(ownerProfileKey, deviceId) {
  const now = Date.now();
  if (!pool) {
    const clubId = memoryClubIdByOwner.get(ownerProfileKey);
    const device = memoryClubTabletDevicesById.get(deviceId);
    if (!clubId || !device || device.clubId !== clubId || device.revokedAt) return false;
    device.revokedAt = now;
    device.updatedAt = now;
    memoryClubTabletDeviceIdByTokenHash.delete(device.tokenHash);
    return true;
  }
  const result = await query(
    `UPDATE ${schema}.club_tablet_devices AS devices
     SET revoked_at = now(), updated_at = now()
     FROM ${schema}.clubs AS clubs
     WHERE devices.club_id = clubs.id AND clubs.owner_profile_key = $1
       AND devices.id = $2 AND devices.revoked_at IS NULL
     RETURNING devices.id`,
    [ownerProfileKey, deviceId],
  );
  return Boolean(result?.rows?.[0]);
}

export async function ensureClubRosterMember(ownerProfileKey, studioRiderId, riderName) {
  const now = Date.now();
  if (!pool) {
    const clubId = memoryClubIdByOwner.get(ownerProfileKey);
    if (!clubId) return null;
    const key = clubMemberKey(clubId, studioRiderId);
    const existing = memoryClubMembers.get(key);
    const wasRevoked = Boolean(existing?.revokedAt);
    const member = {
      clubId,
      studioRiderId,
      riderName,
      // Re-adding a studio roster name after Club Connect was revoked must
      // not silently reconnect the previously claimed personal account.
      athleteProfileKey: wasRevoked ? null : existing?.athleteProfileKey ?? null,
      athleteName: wasRevoked ? null : existing?.athleteName ?? null,
      status: !wasRevoked && existing?.status === 'claimed' ? 'claimed' : 'unclaimed',
      claimedAt: wasRevoked ? null : existing?.claimedAt ?? null,
      revokedAt: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    memoryClubMembers.set(key, member);
    return cloneJson(member, member);
  }
  const result = await query(
    `INSERT INTO ${schema}.club_members AS existing (
       club_id, studio_rider_id, rider_name, status, revoked_at, created_at, updated_at
     )
     SELECT clubs.id, $2, $3, 'unclaimed', NULL, now(), now()
     FROM ${schema}.clubs AS clubs
     WHERE clubs.owner_profile_key = $1
     ON CONFLICT (club_id, studio_rider_id) DO UPDATE SET
       rider_name = EXCLUDED.rider_name,
       athlete_profile_key = CASE
         WHEN existing.revoked_at IS NOT NULL THEN NULL
         ELSE existing.athlete_profile_key
       END,
       athlete_name = CASE
         WHEN existing.revoked_at IS NOT NULL THEN NULL
         ELSE existing.athlete_name
       END,
       status = CASE
         WHEN existing.revoked_at IS NOT NULL THEN 'unclaimed'
         ELSE existing.status
       END,
       claimed_at = CASE
         WHEN existing.revoked_at IS NOT NULL THEN NULL
         ELSE existing.claimed_at
       END,
       revoked_at = NULL,
       updated_at = now()
     RETURNING *`,
    [ownerProfileKey, studioRiderId, riderName],
  );
  return clubMemberFromRow(result?.rows?.[0]);
}

export async function saveClubInvite({
  club,
  studioRiderId,
  riderName,
  inviteId,
  tokenHash,
  expiresAt,
}) {
  const now = Date.now();
  if (!pool) {
    const key = clubMemberKey(club.id, studioRiderId);
    const existing = memoryClubMembers.get(key);
    memoryClubMembers.set(key, {
      clubId: club.id,
      studioRiderId,
      riderName,
      athleteProfileKey: existing?.athleteProfileKey ?? null,
      athleteName: existing?.athleteName ?? null,
      status: existing?.status === 'claimed' ? 'claimed' : 'unclaimed',
      claimedAt: existing?.claimedAt ?? null,
      revokedAt: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    for (const invite of memoryClubInvitesByHash.values()) {
      if (invite.clubId === club.id && invite.studioRiderId === studioRiderId && !invite.claimedAt) {
        invite.revokedAt = now;
      }
    }
    memoryClubInvitesByHash.set(tokenHash, {
      id: inviteId,
      clubId: club.id,
      studioRiderId,
      tokenHash,
      expiresAt,
      claimedAt: null,
      claimedByProfileKey: null,
      revokedAt: null,
      createdAt: now,
    });
    return { id: inviteId, expiresAt };
  }
  await query(
    `INSERT INTO ${schema}.club_members (
       club_id, studio_rider_id, rider_name, status, created_at, updated_at
     ) VALUES ($1, $2, $3, 'unclaimed', now(), now())
     ON CONFLICT (club_id, studio_rider_id) DO UPDATE SET
       rider_name = EXCLUDED.rider_name,
       updated_at = now()`,
    [club.id, studioRiderId, riderName],
  );
  await query(
    `UPDATE ${schema}.club_invites SET revoked_at = now()
     WHERE club_id = $1 AND studio_rider_id = $2 AND claimed_at IS NULL AND revoked_at IS NULL`,
    [club.id, studioRiderId],
  );
  const result = await query(
    `INSERT INTO ${schema}.club_invites (
       id, club_id, studio_rider_id, token_hash, expires_at, created_at
     ) VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0), now())
     RETURNING id, expires_at`,
    [inviteId, club.id, studioRiderId, tokenHash, expiresAt],
  );
  const row = result?.rows?.[0];
  return row ? { id: row.id, expiresAt: new Date(row.expires_at).getTime() } : null;
}

export async function claimClubInvite(tokenHash, athleteProfileKey, athleteName) {
  const now = Date.now();
  if (!pool) {
    const invite = memoryClubInvitesByHash.get(tokenHash);
    if (!invite || invite.revokedAt || invite.claimedAt || invite.expiresAt <= now) return null;
    const club = memoryClubsById.get(invite.clubId);
    const key = clubMemberKey(invite.clubId, invite.studioRiderId);
    const member = memoryClubMembers.get(key);
    if (!club || !member || club.ownerProfileKey === athleteProfileKey) return null;
    if (member.athleteProfileKey && member.athleteProfileKey !== athleteProfileKey) return null;
    invite.claimedAt = now;
    invite.claimedByProfileKey = athleteProfileKey;
    memoryClubMembers.set(key, {
      ...member,
      athleteProfileKey,
      athleteName,
      status: 'claimed',
      claimedAt: now,
      revokedAt: null,
      updatedAt: now,
    });
    return { clubId: club.id, studioRiderId: member.studioRiderId };
  }
  const result = await query(
    `WITH eligible AS (
       SELECT invites.id, invites.club_id, invites.studio_rider_id
       FROM ${schema}.club_invites AS invites
       JOIN ${schema}.clubs AS clubs ON clubs.id = invites.club_id
       JOIN ${schema}.club_members AS members
         ON members.club_id = invites.club_id AND members.studio_rider_id = invites.studio_rider_id
       WHERE invites.token_hash = $1
         AND invites.claimed_at IS NULL
         AND invites.revoked_at IS NULL
         AND invites.expires_at > now()
         AND clubs.owner_profile_key <> $2
         AND (members.athlete_profile_key IS NULL OR members.athlete_profile_key = $2)
     ), claimed_invite AS (
       UPDATE ${schema}.club_invites AS invites
       SET claimed_at = now(), claimed_by_profile_key = $2
       FROM eligible
       WHERE invites.id = eligible.id
       RETURNING invites.club_id, invites.studio_rider_id
     )
     UPDATE ${schema}.club_members AS members
     SET athlete_profile_key = $2, status = 'claimed', claimed_at = now(), revoked_at = NULL, updated_at = now()
     FROM claimed_invite
     WHERE members.club_id = claimed_invite.club_id
       AND members.studio_rider_id = claimed_invite.studio_rider_id
     RETURNING members.club_id, members.studio_rider_id`,
    [tokenHash, athleteProfileKey],
  );
  const row = result?.rows?.[0];
  return row ? { clubId: row.club_id, studioRiderId: row.studio_rider_id, athleteName } : null;
}

export async function revokeClubMember(ownerProfileKey, studioRiderId) {
  if (!pool) {
    const clubId = memoryClubIdByOwner.get(ownerProfileKey);
    const key = clubId ? clubMemberKey(clubId, studioRiderId) : '';
    const member = key ? memoryClubMembers.get(key) : null;
    if (!clubId || !member) return false;
    const now = Date.now();
    memoryClubMembers.set(key, {
      ...member,
      athleteProfileKey: null,
      athleteName: null,
      status: 'unclaimed',
      claimedAt: null,
      revokedAt: now,
      updatedAt: now,
    });
    for (const invite of memoryClubInvitesByHash.values()) {
      if (invite.clubId === clubId && invite.studioRiderId === studioRiderId) invite.revokedAt = now;
    }
    return true;
  }
  await query(
    `UPDATE ${schema}.club_invites AS invites SET revoked_at = now()
     FROM ${schema}.clubs AS clubs
     WHERE invites.club_id = clubs.id AND clubs.owner_profile_key = $1
       AND invites.studio_rider_id = $2 AND invites.revoked_at IS NULL`,
    [ownerProfileKey, studioRiderId],
  );
  const result = await query(
    `UPDATE ${schema}.club_members AS members
     SET athlete_profile_key = NULL, status = 'unclaimed', claimed_at = NULL,
       revoked_at = now(), updated_at = now()
     FROM ${schema}.clubs AS clubs
     WHERE members.club_id = clubs.id AND clubs.owner_profile_key = $1
       AND members.studio_rider_id = $2
     RETURNING members.club_id`,
    [ownerProfileKey, studioRiderId],
  );
  return Boolean(result?.rows?.[0]);
}

export async function loadClubConnectState(profileKey) {
  if (!pool) {
    const ownedClubId = memoryClubIdByOwner.get(profileKey);
    const ownedClub = ownedClubId ? memoryClubsById.get(ownedClubId) : null;
    const members = ownedClub
      ? [...memoryClubMembers.values()]
        .filter((member) => member.clubId === ownedClub.id)
        .map((member) => cloneJson(member, member))
      : [];
    const memberships = [...memoryClubMembers.values()]
      .filter((member) => member.athleteProfileKey === profileKey && member.status === 'claimed')
      .flatMap((member) => {
        const club = memoryClubsById.get(member.clubId);
        if (!club) return [];
        return [{
          clubId: club.id,
          clubName: club.name,
          ownerProfileKey: club.ownerProfileKey,
          studioRiderId: member.studioRiderId,
          riderName: member.riderName,
          claimedAt: member.claimedAt,
        }];
      });
    return {
      ownedClub: ownedClub ? { ...cloneJson(ownedClub, ownedClub), members } : null,
      memberships,
    };
  }
  const [ownedResult, memberResult, membershipResult] = await Promise.all([
    query(`SELECT * FROM ${schema}.clubs WHERE owner_profile_key = $1`, [profileKey]),
    query(
      `SELECT members.*,
         users.display_name AS athlete_name
       FROM ${schema}.club_members AS members
       JOIN ${schema}.clubs AS clubs ON clubs.id = members.club_id
       LEFT JOIN ${schema}.auth_users AS users
         ON ('user:' || users.id) = members.athlete_profile_key
       WHERE clubs.owner_profile_key = $1
       ORDER BY lower(members.rider_name), members.created_at`,
      [profileKey],
    ),
    query(
      `SELECT clubs.id AS club_id, clubs.name AS club_name, clubs.owner_profile_key,
         members.studio_rider_id, members.rider_name, members.claimed_at
       FROM ${schema}.club_members AS members
       JOIN ${schema}.clubs AS clubs ON clubs.id = members.club_id
       WHERE members.athlete_profile_key = $1 AND members.status = 'claimed'
       ORDER BY lower(clubs.name), lower(members.rider_name)`,
      [profileKey],
    ),
  ]);
  const ownedClub = clubFromRow(ownedResult?.rows?.[0]);
  return {
    ownedClub: ownedClub ? {
      ...ownedClub,
      members: (memberResult?.rows ?? []).map(clubMemberFromRow).filter(Boolean),
    } : null,
    memberships: (membershipResult?.rows ?? []).map((row) => ({
      clubId: row.club_id,
      clubName: row.club_name,
      ownerProfileKey: row.owner_profile_key,
      studioRiderId: row.studio_rider_id,
      riderName: row.rider_name,
      claimedAt: row.claimed_at ? new Date(row.claimed_at).getTime() : null,
    })),
  };
}

export async function saveUserTrackMapping(
  guestKey,
  mapping,
  { publish = false, publishedBy = null, customRoute = null } = {},
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
      if (customRoute?.id === mapping.trackId) {
        publicCustomRoutesFallback.set(customRoute.id, cloneJson(customRoute, customRoute));
      }
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

      if (customRoute?.id === savedMapping.trackId) {
        await client.query(
          `INSERT INTO ${schema}.public_custom_routes AS target (
             track_id,
             route,
             published_by,
             updated_at
           )
           VALUES ($1, $2::jsonb, $3, now())
           ON CONFLICT (track_id) DO UPDATE SET
             route = EXCLUDED.route,
             published_by = EXCLUDED.published_by,
             updated_at = now()`,
          [customRoute.id, json(customRoute), publishedBy],
        );
      }
    }

    await client.query('COMMIT');
    if (publish && publicMapping) {
      publicTrackMappingsFallback.set(savedMapping.trackId, cloneJson(publicMapping, publicMapping));
      if (customRoute?.id === savedMapping.trackId) {
        publicCustomRoutesFallback.set(customRoute.id, cloneJson(customRoute, customRoute));
      }
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

export async function loadPublicCustomRoutes() {
  const result = await query(
    `SELECT track_id, route FROM ${schema}.public_custom_routes ORDER BY updated_at DESC`,
  );

  if (!result) {
    return [...publicCustomRoutesFallback.values()].map((route) => cloneJson(route, route));
  }

  const routes = (result.rows ?? [])
    .map((row) => fromJson(row.route, null))
    .filter(Boolean);
  routes.forEach((route) => publicCustomRoutesFallback.set(route.id, cloneJson(route, route)));
  return routes;
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

function accountProfileFromRow(row, extras = {}) {
  if (!row) {
    return null;
  }
  return {
    profileId: row.profile_id ?? row.id,
    displayName: row.display_name,
    username: row.username,
    officialType: row.official_type ?? null,
    ...extras,
  };
}

function memoryAccountProfile(user, extras = {}) {
  if (!user) {
    return null;
  }
  return {
    profileId: user.id,
    displayName: user.displayName,
    username: user.username || normalizedUsername(user.displayName, user.id),
    officialType: memoryOfficialFriendKindByUserId.get(user.id) ?? null,
    ...extras,
  };
}

function friendGhostPreviewFromRow(row) {
  if (!row?.id || !row?.track_id || !row?.track_name) return null;
  const finishTimeMs = Math.round(Number(row.finish_time_ms));
  if (!Number.isFinite(finishTimeMs) || finishTimeMs <= 0) return null;
  const storedSummary = fromJson(row.summary, null);
  const distanceFeet = sprintDistanceFeet(storedSummary?.sprintDistanceFeet);
  const airSetting = sprintAirSetting(storedSummary?.sprintAirSetting);
  return {
    id: row.id,
    trackId: row.track_id,
    trackName: row.track_name,
    ...(row.route_variant_id === 'amateur' || row.route_variant_id === 'pro'
      ? { routeVariantId: row.route_variant_id }
      : {}),
    lapCount: safeLapCount(row.lap_count),
    ...(distanceFeet != null && airSetting != null ? {
      sprintDistanceFeet: distanceFeet,
      sprintAirSetting: airSetting,
    } : {}),
    finishTimeMs,
  };
}

function memoryRecentLiveGhostPreview(userId) {
  const ownerKey = `user:${userId}`;
  const recent = [...memoryGhostLaps.values()]
    .filter((ghost) => ghost.owner_key === ownerKey && ghost.race_source === 'live')
    .sort((left, right) => (
      Date.parse(right.saved_at) - Date.parse(left.saved_at)
      || left.finish_time_ms - right.finish_time_ms
      || String(left.id).localeCompare(String(right.id))
    ))[0];
  return friendGhostPreviewFromRow(recent);
}

function memoryUsersAreBlocked(userIdA, userIdB) {
  return memoryFriendBlocks.has(`${userIdA}:${userIdB}`)
    || memoryFriendBlocks.has(`${userIdB}:${userIdA}`);
}

function memoryGuestKeysAreBlocked(guestKeyA, guestKeyB) {
  const userIdA = String(guestKeyA || '').startsWith('user:') ? String(guestKeyA).slice(5) : '';
  const userIdB = String(guestKeyB || '').startsWith('user:') ? String(guestKeyB).slice(5) : '';
  return Boolean(userIdA && userIdB && memoryUsersAreBlocked(userIdA, userIdB));
}

function memoryGroupMemberKey(groupId, guestKey) {
  return `${groupId}:${guestKey}`;
}

function memoryFriendIds(userId, { includeOfficial = true } = {}) {
  const ids = [];
  for (const friendship of memoryAccountFriendships.values()) {
    if (!includeOfficial && friendship.source === 'official') {
      continue;
    }
    if (friendship.userIdA === userId) {
      ids.push(friendship.userIdB);
    } else if (friendship.userIdB === userId) {
      ids.push(friendship.userIdA);
    }
  }
  return ids;
}

function memoryUsersShareClaimedClub(userIdA, userIdB) {
  const profileKeyA = `user:${userIdA}`;
  const profileKeyB = `user:${userIdB}`;
  for (const club of memoryClubsById.values()) {
    const profileKeys = new Set([club.ownerProfileKey]);
    for (const member of memoryClubMembers.values()) {
      if (
        member.clubId === club.id
        && member.status === 'claimed'
        && !member.revokedAt
        && member.athleteProfileKey
      ) {
        profileKeys.add(member.athleteProfileKey);
      }
    }
    if (profileKeys.has(profileKeyA) && profileKeys.has(profileKeyB)) {
      return true;
    }
  }
  return false;
}

export async function ensureOfficialFriendships(userId = '') {
  if (!pool) {
    if (userId && memoryOfficialFriendKindByUserId.has(userId) && memoryReconciledOfficialFriendUserIds.has(userId)) {
      return [];
    }
    const changedUserIds = new Set();
    const officialUsers = [...memoryAuthUsersById.values()]
      .filter((user) => memoryOfficialFriendKindByUserId.has(user.id));
    const candidateUsers = [...memoryAuthUsersById.values()];
    for (const official of officialUsers) {
      for (const candidate of candidateUsers) {
        if (candidate.id === official.id) {
          continue;
        }
        if (userId && candidate.id !== userId && official.id !== userId) {
          continue;
        }
        const [userIdA, userIdB] = accountPair(candidate.id, official.id);
        const pairKey = accountPairKey(userIdA, userIdB);
        if (memoryFriendshipSuppressions.has(pairKey) || memoryUsersAreBlocked(userIdA, userIdB)) {
          continue;
        }
        const existing = memoryAccountFriendships.get(pairKey);
        if (!existing || existing.source === 'legacy') {
          memoryAccountFriendships.set(pairKey, {
            userIdA,
            userIdB,
            source: 'official',
            createdAt: new Date().toISOString(),
          });
          changedUserIds.add(userIdA);
          changedUserIds.add(userIdB);
        }
      }
    }
    if (userId && memoryOfficialFriendKindByUserId.has(userId)) {
      memoryReconciledOfficialFriendUserIds.add(userId);
    }
    return [...changedUserIds];
  }

  const officialLookup = userId ? await query(
    `SELECT kind, reconciled_at FROM ${schema}.official_friend_accounts WHERE user_id = $1 LIMIT 1`,
    [userId],
  ) : null;
  if (officialLookup?.rows?.[0]) {
    if (officialLookup.rows[0].reconciled_at) return [];
    // A late-provisioned Official account may need to connect to every existing
    // rider. Acquire the same pair locks used by accept/remove/block, in a
    // stable order, then perform one set-based insert so block always wins and
    // login does not open one transaction per account.
    const connected = await withPersistenceLock(`official-fanout:${userId}`, async (client) => {
      const alreadyReconciled = await client.query(
        `SELECT 1 FROM ${schema}.official_friend_accounts
         WHERE user_id = $1 AND reconciled_at IS NOT NULL
         LIMIT 1`,
        [userId],
      );
      if (alreadyReconciled.rows[0]) return null;
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext(
           'friend-pair:' || LEAST(users.id, $1) || ':' || GREATEST(users.id, $1)
         ))
         FROM ${schema}.auth_users AS users
         WHERE users.id <> $1
         ORDER BY LEAST(users.id, $1), GREATEST(users.id, $1)`,
        [userId],
      );
      const connected = await client.query(
        `INSERT INTO ${schema}.account_friendships AS existing (user_id_a, user_id_b, source)
         SELECT LEAST(users.id, $1), GREATEST(users.id, $1), 'official'
         FROM ${schema}.auth_users AS users
         WHERE users.id <> $1
           AND NOT EXISTS (
             SELECT 1 FROM ${schema}.friendship_suppressions AS suppression
             WHERE suppression.user_id_a = LEAST(users.id, $1)
               AND suppression.user_id_b = GREATEST(users.id, $1)
           )
           AND NOT EXISTS (
             SELECT 1 FROM ${schema}.friend_blocks AS block
             WHERE (block.blocker_user_id = users.id AND block.blocked_user_id = $1)
                OR (block.blocker_user_id = $1 AND block.blocked_user_id = users.id)
           )
         ON CONFLICT (user_id_a, user_id_b) DO UPDATE SET source = 'official'
         WHERE existing.source = 'legacy'
         RETURNING existing.user_id_a, existing.user_id_b`,
        [userId],
      );
      await client.query(
        `UPDATE ${schema}.official_friend_accounts SET reconciled_at = now() WHERE user_id = $1`,
        [userId],
      );
      return connected;
    });
    return [...new Set((connected?.rows ?? []).flatMap((row) => [row.user_id_a, row.user_id_b]).filter(Boolean))];
  }

  const pairs = await query(
    `SELECT DISTINCT
       LEAST(users.id, official.user_id) AS user_id_a,
       GREATEST(users.id, official.user_id) AS user_id_b
     FROM ${schema}.auth_users AS users
     CROSS JOIN ${schema}.official_friend_accounts AS official
     WHERE users.id <> official.user_id
       AND ($1 = '' OR users.id = $1 OR official.user_id = $1)`,
    [userId],
  );
  const changedUserIds = new Set();
  for (const pair of pairs?.rows ?? []) {
    const connected = await withAccountPairTransaction(pair.user_id_a, pair.user_id_b, (client) => client.query(
      `INSERT INTO ${schema}.account_friendships AS existing (user_id_a, user_id_b, source)
       SELECT $1, $2, 'official'
       WHERE NOT EXISTS (
         SELECT 1 FROM ${schema}.friendship_suppressions AS suppression
         WHERE suppression.user_id_a = $1 AND suppression.user_id_b = $2
       )
         AND NOT EXISTS (
           SELECT 1 FROM ${schema}.friend_blocks AS block
           WHERE (block.blocker_user_id = $1 AND block.blocked_user_id = $2)
              OR (block.blocker_user_id = $2 AND block.blocked_user_id = $1)
       )
       ON CONFLICT (user_id_a, user_id_b) DO UPDATE SET source = 'official'
       WHERE existing.source = 'legacy'
       RETURNING existing.user_id_a, existing.user_id_b`,
      [pair.user_id_a, pair.user_id_b],
    ));
    (connected?.rows ?? []).forEach((row) => {
      if (row.user_id_a) changedUserIds.add(row.user_id_a);
      if (row.user_id_b) changedUserIds.add(row.user_id_b);
    });
  }
  return [...changedUserIds];
}

export async function listAccountFriends(userId, { offset = 0, limit = 25, searchText = '' } = {}) {
  const normalizedSearch = String(searchText || '').trim().toLowerCase();
  if (!pool) {
    return [...memoryAccountFriendships.values()]
      .filter((friendship) => friendship.userIdA === userId || friendship.userIdB === userId)
      .filter((friendship) => {
        if (!normalizedSearch) return true;
        const friendId = friendship.userIdA === userId ? friendship.userIdB : friendship.userIdA;
        const friend = memoryAuthUsersById.get(friendId);
        return String(friend?.username || '').toLowerCase().includes(normalizedSearch)
          || String(friend?.displayName || '').toLowerCase().includes(normalizedSearch);
      })
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(offset, offset + limit)
      .map((friendship) => {
        const friendId = friendship.userIdA === userId ? friendship.userIdB : friendship.userIdA;
        return memoryAccountProfile(memoryAuthUsersById.get(friendId), {
          friendshipSource: friendship.source,
          connectedAt: friendship.createdAt,
          photoUrl: memoryUserDataByGuestKey.get(`user:${friendId}`)?.accountProfile?.photoUrl ?? '',
          ...(friendship.source !== 'official'
            ? { ghostPreview: memoryRecentLiveGhostPreview(friendId) }
            : {}),
        });
      })
      .filter(Boolean);
  }

  const escapedSearch = normalizedSearch.replace(/[\\%_]/g, '\\$&');
  const result = await query(
    `WITH friend_edges AS (
       SELECT user_id_b AS friend_id, source, created_at
       FROM ${schema}.account_friendships WHERE user_id_a = $1
       UNION ALL
       SELECT user_id_a AS friend_id, source, created_at
       FROM ${schema}.account_friendships WHERE user_id_b = $1
     )
     SELECT
       friend.id AS profile_id,
       friend.display_name,
       friend.username,
       official.kind AS official_type,
       profile_data.account_profile ->> 'photoUrl' AS photo_url,
       edge.source AS friendship_source,
       edge.created_at AS connected_at,
       recent_ghost.id AS ghost_id,
       recent_ghost.track_id AS ghost_track_id,
       recent_ghost.track_name AS ghost_track_name,
       recent_ghost.route_variant_id AS ghost_route_variant_id,
       recent_ghost.lap_count AS ghost_lap_count,
       recent_ghost.finish_time_ms AS ghost_finish_time_ms,
       recent_ghost.summary AS ghost_summary
     FROM friend_edges AS edge
     JOIN ${schema}.auth_users AS friend ON friend.id = edge.friend_id
     LEFT JOIN ${schema}.official_friend_accounts AS official ON official.user_id = friend.id
     LEFT JOIN ${schema}.user_data AS profile_data ON profile_data.guest_key = 'user:' || friend.id
     LEFT JOIN LATERAL (
       SELECT id, track_id, track_name, route_variant_id, lap_count, finish_time_ms, summary
       FROM ${schema}.ghost_laps
       WHERE owner_key = 'user:' || friend.id AND race_source = 'live'
       ORDER BY saved_at DESC, finish_time_ms ASC, id
       LIMIT 1
     ) AS recent_ghost ON edge.source <> 'official'
     WHERE $4 = ''
        OR friend.username ILIKE '%' || $4 || '%' ESCAPE '\\'
        OR friend.display_name ILIKE '%' || $4 || '%' ESCAPE '\\'
     ORDER BY edge.created_at DESC, friend.id
     OFFSET $2 LIMIT $3`,
    [userId, offset, limit, escapedSearch],
  );
  return (result?.rows ?? []).map((row) => accountProfileFromRow(row, {
    friendshipSource: row.friendship_source,
    connectedAt: new Date(row.connected_at).toISOString(),
    photoUrl: row.photo_url ?? '',
    ghostPreview: friendGhostPreviewFromRow({
      id: row.ghost_id,
      track_id: row.ghost_track_id,
      track_name: row.ghost_track_name,
      route_variant_id: row.ghost_route_variant_id,
      lap_count: row.ghost_lap_count,
      finish_time_ms: row.ghost_finish_time_ms,
      summary: row.ghost_summary,
    }),
  }));
}

export async function listAccountFriendRequests(userId, direction, { offset = 0, limit = 25, searchText = '' } = {}) {
  const incoming = direction !== 'outgoing';
  const normalizedSearch = String(searchText || '').trim().toLowerCase();
  if (!pool) {
    return [...memoryAccountFriendRequests.values()]
      .filter((request) => request.status === 'pending')
      .filter((request) => incoming ? request.toUserId === userId : request.fromUserId === userId)
      .filter((request) => {
        if (!normalizedSearch) return true;
        const otherId = incoming ? request.fromUserId : request.toUserId;
        const other = memoryAuthUsersById.get(otherId);
        return String(other?.username || '').toLowerCase().includes(normalizedSearch)
          || String(other?.displayName || '').toLowerCase().includes(normalizedSearch);
      })
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(offset, offset + limit)
      .map((request) => {
        const otherId = incoming ? request.fromUserId : request.toUserId;
        return {
          requestId: request.id,
          direction: incoming ? 'incoming' : 'outgoing',
          profile: memoryAccountProfile(memoryAuthUsersById.get(otherId)),
          createdAt: request.createdAt,
        };
      });
  }

  const ownerColumn = incoming ? 'request.to_user_id' : 'request.from_user_id';
  const otherColumn = incoming ? 'request.from_user_id' : 'request.to_user_id';
  const escapedSearch = normalizedSearch.replace(/[\\%_]/g, '\\$&');
  const result = await query(
    `SELECT
       request.id AS request_id,
       request.created_at,
       other.id AS profile_id,
       other.display_name,
       other.username,
       official.kind AS official_type
     FROM ${schema}.account_friend_requests AS request
     JOIN ${schema}.auth_users AS other ON other.id = ${otherColumn}
     LEFT JOIN ${schema}.official_friend_accounts AS official ON official.user_id = other.id
     WHERE ${ownerColumn} = $1 AND request.status = 'pending'
       AND (
         $4 = ''
         OR other.username ILIKE '%' || $4 || '%' ESCAPE '\\'
         OR other.display_name ILIKE '%' || $4 || '%' ESCAPE '\\'
       )
     ORDER BY request.created_at DESC, request.id DESC
     OFFSET $2 LIMIT $3`,
    [userId, offset, limit, escapedSearch],
  );
  return (result?.rows ?? []).map((row) => ({
    requestId: row.request_id,
    direction: incoming ? 'incoming' : 'outgoing',
    profile: accountProfileFromRow(row),
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function searchAccountProfiles(userId, searchText, { offset = 0, limit = 25 } = {}) {
  const normalizedSearch = String(searchText || '').trim().toLowerCase();
  if (!pool) {
    return [...memoryAuthUsersById.values()]
      .filter((user) => user.id !== userId && user.friendDiscoverable === true)
      .filter((user) => !memoryUsersAreBlocked(userId, user.id))
      .filter((user) => (
        String(user.username || '').toLowerCase().startsWith(normalizedSearch)
        || String(user.displayName || '').toLowerCase().startsWith(normalizedSearch)
      ))
      .sort((a, b) => {
        const aExact = a.username.toLowerCase() === normalizedSearch ? 0 : 1;
        const bExact = b.username.toLowerCase() === normalizedSearch ? 0 : 1;
        return aExact - bExact || a.displayName.localeCompare(b.displayName);
      })
      .slice(offset, offset + limit)
      .map((user) => {
        const pairKey = accountPairKey(userId, user.id);
        const friendship = memoryAccountFriendships.get(pairKey);
        const request = [...memoryAccountFriendRequests.values()].find((candidate) => (
          candidate.status === 'pending'
          && accountPairKey(candidate.fromUserId, candidate.toUserId) === pairKey
        ));
        return memoryAccountProfile(user, {
          relationship: friendship
            ? 'friend'
            : request?.fromUserId === userId
              ? 'outgoing-request'
              : request
                ? 'incoming-request'
                : 'none',
          friendshipSource: friendship?.source ?? null,
        });
      });
  }

  const escapedSearch = normalizedSearch.replace(/[\\%_]/g, '\\$&');
  const result = await query(
    `SELECT
       candidate.id AS profile_id,
       candidate.display_name,
       candidate.username,
       official.kind AS official_type,
       friendship.source AS friendship_source,
       CASE
         WHEN friendship.user_id_a IS NOT NULL THEN 'friend'
         WHEN pending.from_user_id = $1 THEN 'outgoing-request'
         WHEN pending.to_user_id = $1 THEN 'incoming-request'
         ELSE 'none'
       END AS relationship
     FROM ${schema}.auth_users AS candidate
     LEFT JOIN ${schema}.official_friend_accounts AS official ON official.user_id = candidate.id
     LEFT JOIN ${schema}.account_friendships AS friendship
       ON friendship.user_id_a = LEAST($1, candidate.id)
      AND friendship.user_id_b = GREATEST($1, candidate.id)
     LEFT JOIN ${schema}.account_friend_requests AS pending
       ON pending.status = 'pending'
      AND LEAST(pending.from_user_id, pending.to_user_id) = LEAST($1, candidate.id)
      AND GREATEST(pending.from_user_id, pending.to_user_id) = GREATEST($1, candidate.id)
     WHERE candidate.id <> $1
       AND candidate.friend_discoverable = true
       AND (
         lower(candidate.username) LIKE $2 || '%' ESCAPE '\\'
         OR lower(candidate.display_name) LIKE $2 || '%' ESCAPE '\\'
       )
       AND NOT EXISTS (
         SELECT 1 FROM ${schema}.friend_blocks AS block
         WHERE (block.blocker_user_id = $1 AND block.blocked_user_id = candidate.id)
            OR (block.blocker_user_id = candidate.id AND block.blocked_user_id = $1)
       )
     ORDER BY
       CASE WHEN lower(candidate.username) = lower($3) THEN 0 ELSE 1 END,
       CASE WHEN lower(candidate.username) LIKE lower($3) || '%' THEN 0 ELSE 1 END,
       lower(candidate.display_name), candidate.id
     OFFSET $4 LIMIT $5`,
    [userId, escapedSearch, normalizedSearch, offset, limit],
  );
  return (result?.rows ?? []).map((row) => accountProfileFromRow(row, {
    relationship: row.relationship,
    friendshipSource: row.friendship_source ?? null,
  }));
}

export async function suggestAccountFriends(userId, { offset = 0, limit = 25 } = {}) {
  if (!pool) {
    const allFriendIds = new Set(memoryFriendIds(userId));
    const ownFriends = new Set(memoryFriendIds(userId, { includeOfficial: false }));
    return [...memoryAuthUsersById.values()]
      .filter((user) => user.id !== userId && user.friendDiscoverable === true)
      .filter((user) => !allFriendIds.has(user.id))
      .filter((user) => !memoryUsersAreBlocked(userId, user.id))
      .filter((user) => !memoryFriendshipSuppressions.has(accountPairKey(userId, user.id)))
      .filter((user) => ![...memoryAccountFriendRequests.values()].some((request) => (
        request.status === 'pending'
        && accountPairKey(request.fromUserId, request.toUserId) === accountPairKey(userId, user.id)
      )))
      .map((user) => {
        const candidateFriends = new Set(memoryFriendIds(user.id, { includeOfficial: false }));
        const mutualFriendCount = [...ownFriends].filter((friendId) => candidateFriends.has(friendId)).length;
        const sharedClub = memoryUsersShareClaimedClub(userId, user.id);
        return memoryAccountProfile(user, {
          mutualFriendCount,
          reason: sharedClub ? 'shared-club' : mutualFriendCount > 0 ? 'mutual-friends' : null,
        });
      })
      .filter((profile) => profile.reason)
      .sort((a, b) => b.mutualFriendCount - a.mutualFriendCount || a.displayName.localeCompare(b.displayName))
      .slice(offset, offset + limit);
  }

  const result = await query(
    `WITH all_friends AS (
       SELECT CASE WHEN friendship.user_id_a = $1 THEN friendship.user_id_b ELSE friendship.user_id_a END AS friend_id
       FROM ${schema}.account_friendships AS friendship
       WHERE friendship.user_id_a = $1 OR friendship.user_id_b = $1
     ), my_friends AS (
       SELECT CASE WHEN friendship.user_id_a = $1 THEN friendship.user_id_b ELSE friendship.user_id_a END AS friend_id
       FROM ${schema}.account_friendships AS friendship
       WHERE friendship.source <> 'official'
         AND (friendship.user_id_a = $1 OR friendship.user_id_b = $1)
     ), my_clubs AS (
       SELECT club.id
       FROM ${schema}.clubs AS club
       WHERE club.owner_profile_key = 'user:' || $1
          OR EXISTS (
            SELECT 1 FROM ${schema}.club_members AS member
            WHERE member.club_id = club.id
              AND member.athlete_profile_key = 'user:' || $1
              AND member.status = 'claimed' AND member.revoked_at IS NULL
          )
     ), candidates AS (
       SELECT
         candidate.id AS profile_id,
         candidate.display_name,
         candidate.username,
         candidate.created_at,
         official.kind AS official_type,
         (
           SELECT count(*)::integer
           FROM my_friends AS mine
           JOIN ${schema}.account_friendships AS candidate_friendship
             ON candidate_friendship.user_id_a = LEAST(mine.friend_id, candidate.id)
            AND candidate_friendship.user_id_b = GREATEST(mine.friend_id, candidate.id)
            AND candidate_friendship.source <> 'official'
         ) AS mutual_friend_count,
         EXISTS (
           SELECT 1
           FROM my_clubs AS mine
           JOIN ${schema}.clubs AS club ON club.id = mine.id
           WHERE club.owner_profile_key = 'user:' || candidate.id
              OR EXISTS (
                SELECT 1 FROM ${schema}.club_members AS member
                WHERE member.club_id = mine.id
                  AND member.athlete_profile_key = 'user:' || candidate.id
                  AND member.status = 'claimed' AND member.revoked_at IS NULL
              )
         ) AS shared_club,
         EXISTS (
           SELECT 1
           FROM ${schema}.race_results AS mine
           JOIN ${schema}.race_results AS theirs ON theirs.room_id = mine.room_id
           WHERE mine.guest_key = 'user:' || $1
             AND theirs.guest_key = 'user:' || candidate.id
             AND mine.room_id <> 'local'
             AND mine.created_at > now() - interval '90 days'
         ) AS recent_race
       FROM ${schema}.auth_users AS candidate
       LEFT JOIN ${schema}.official_friend_accounts AS official ON official.user_id = candidate.id
       WHERE candidate.id <> $1
         AND candidate.friend_discoverable = true
         AND NOT EXISTS (
           SELECT 1 FROM all_friends WHERE friend_id = candidate.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM ${schema}.account_friend_requests AS request
           WHERE request.status = 'pending'
             AND request.from_user_id IN ($1, candidate.id)
             AND request.to_user_id IN ($1, candidate.id)
         )
         AND NOT EXISTS (
           SELECT 1 FROM ${schema}.friend_blocks AS block
           WHERE (block.blocker_user_id = $1 AND block.blocked_user_id = candidate.id)
              OR (block.blocker_user_id = candidate.id AND block.blocked_user_id = $1)
         )
         AND NOT EXISTS (
           SELECT 1 FROM ${schema}.friendship_suppressions AS suppression
           WHERE suppression.user_id_a = LEAST($1, candidate.id)
             AND suppression.user_id_b = GREATEST($1, candidate.id)
         )
     )
     SELECT
       profile_id, display_name, username, official_type,
       mutual_friend_count, shared_club, recent_race
     FROM candidates
     WHERE shared_club OR recent_race OR mutual_friend_count > 0
     ORDER BY shared_club DESC, recent_race DESC, mutual_friend_count DESC,
       created_at DESC, profile_id
     OFFSET $2 LIMIT $3`,
    [userId, offset, limit],
  );
  return (result?.rows ?? []).map((row) => {
    const mutualFriendCount = Number(row.mutual_friend_count) || 0;
    const reason = row.shared_club
      ? 'shared-club'
      : row.recent_race
        ? 'recent-race'
        : mutualFriendCount > 0
          ? 'mutual-friends'
          : 'tracklab-rider';
    return accountProfileFromRow(row, { mutualFriendCount, reason });
  });
}

export async function countAccountFriends(userId, { searchText = '' } = {}) {
  const normalizedSearch = String(searchText || '').trim().toLowerCase();
  if (!pool) {
    return memoryFriendIds(userId).filter((friendId) => {
      if (!normalizedSearch) return true;
      const friend = memoryAuthUsersById.get(friendId);
      return String(friend?.username || '').toLowerCase().includes(normalizedSearch)
        || String(friend?.displayName || '').toLowerCase().includes(normalizedSearch);
    }).length;
  }
  const escapedSearch = normalizedSearch.replace(/[\\%_]/g, '\\$&');
  const result = await query(
    `SELECT count(*)::integer AS total
     FROM ${schema}.account_friendships AS friendship
     JOIN ${schema}.auth_users AS friend
       ON friend.id = CASE
         WHEN friendship.user_id_a = $1 THEN friendship.user_id_b
         ELSE friendship.user_id_a
       END
     WHERE (friendship.user_id_a = $1 OR friendship.user_id_b = $1)
       AND (
         $2 = ''
         OR friend.username ILIKE '%' || $2 || '%' ESCAPE '\\'
         OR friend.display_name ILIKE '%' || $2 || '%' ESCAPE '\\'
       )`,
    [userId, escapedSearch],
  );
  return Number(result?.rows?.[0]?.total) || 0;
}

export async function countAccountFriendRequests(userId, direction, { searchText = '' } = {}) {
  const incoming = direction !== 'outgoing';
  const normalizedSearch = String(searchText || '').trim().toLowerCase();
  if (!pool) {
    return [...memoryAccountFriendRequests.values()].filter((request) => (
      request.status === 'pending'
      && (incoming ? request.toUserId === userId : request.fromUserId === userId)
      && (() => {
        if (!normalizedSearch) return true;
        const otherId = incoming ? request.fromUserId : request.toUserId;
        const other = memoryAuthUsersById.get(otherId);
        return String(other?.username || '').toLowerCase().includes(normalizedSearch)
          || String(other?.displayName || '').toLowerCase().includes(normalizedSearch);
      })()
    )).length;
  }
  const ownerColumn = incoming ? 'request.to_user_id' : 'request.from_user_id';
  const otherColumn = incoming ? 'request.from_user_id' : 'request.to_user_id';
  const escapedSearch = normalizedSearch.replace(/[\\%_]/g, '\\$&');
  const result = await query(
    `SELECT count(*)::integer AS total
     FROM ${schema}.account_friend_requests AS request
     JOIN ${schema}.auth_users AS other ON other.id = ${otherColumn}
     WHERE ${ownerColumn} = $1 AND request.status = 'pending'
       AND (
         $2 = ''
         OR other.username ILIKE '%' || $2 || '%' ESCAPE '\\'
         OR other.display_name ILIKE '%' || $2 || '%' ESCAPE '\\'
       )`,
    [userId, escapedSearch],
  );
  return Number(result?.rows?.[0]?.total) || 0;
}

export async function countAccountProfileSearch(userId, searchText) {
  const normalizedSearch = String(searchText || '').trim().toLowerCase();
  if (!pool) {
    return [...memoryAuthUsersById.values()].filter((user) => (
      user.id !== userId
      && user.friendDiscoverable === true
      && !memoryUsersAreBlocked(userId, user.id)
      && (
        String(user.username || '').toLowerCase().startsWith(normalizedSearch)
        || String(user.displayName || '').toLowerCase().startsWith(normalizedSearch)
      )
    )).length;
  }
  const escapedSearch = normalizedSearch.replace(/[\\%_]/g, '\\$&');
  const result = await query(
    `SELECT count(*)::integer AS total
     FROM ${schema}.auth_users AS candidate
     WHERE candidate.id <> $1
       AND candidate.friend_discoverable = true
       AND (
         lower(candidate.username) LIKE $2 || '%' ESCAPE '\\'
         OR lower(candidate.display_name) LIKE $2 || '%' ESCAPE '\\'
       )
       AND NOT EXISTS (
         SELECT 1 FROM ${schema}.friend_blocks AS block
         WHERE (block.blocker_user_id = $1 AND block.blocked_user_id = candidate.id)
            OR (block.blocker_user_id = candidate.id AND block.blocked_user_id = $1)
       )`,
    [userId, escapedSearch],
  );
  return Number(result?.rows?.[0]?.total) || 0;
}

export async function countAccountFriendSuggestions(userId) {
  if (!pool) {
    const ownFriends = new Set(memoryFriendIds(userId));
    const nonOfficialFriends = new Set(memoryFriendIds(userId, { includeOfficial: false }));
    return [...memoryAuthUsersById.values()].filter((user) => (
      user.id !== userId
      && user.friendDiscoverable === true
      && !ownFriends.has(user.id)
      && !memoryUsersAreBlocked(userId, user.id)
      && !memoryFriendshipSuppressions.has(accountPairKey(userId, user.id))
      && ![...memoryAccountFriendRequests.values()].some((request) => (
        request.status === 'pending'
        && accountPairKey(request.fromUserId, request.toUserId) === accountPairKey(userId, user.id)
      ))
      && (
        memoryUsersShareClaimedClub(userId, user.id)
        || memoryFriendIds(user.id, { includeOfficial: false })
          .some((friendId) => nonOfficialFriends.has(friendId))
      )
    )).length;
  }
  const result = await query(
    `WITH my_friends AS (
       SELECT CASE WHEN friendship.user_id_a = $1 THEN friendship.user_id_b ELSE friendship.user_id_a END AS friend_id
       FROM ${schema}.account_friendships AS friendship
       WHERE friendship.source <> 'official'
         AND (friendship.user_id_a = $1 OR friendship.user_id_b = $1)
     ), my_clubs AS (
       SELECT club.id
       FROM ${schema}.clubs AS club
       WHERE club.owner_profile_key = 'user:' || $1
          OR EXISTS (
            SELECT 1 FROM ${schema}.club_members AS member
            WHERE member.club_id = club.id
              AND member.athlete_profile_key = 'user:' || $1
              AND member.status = 'claimed' AND member.revoked_at IS NULL
          )
     ), candidates AS (
       SELECT candidate.id,
         EXISTS (
           SELECT 1 FROM my_friends AS mine
           JOIN ${schema}.account_friendships AS candidate_friendship
             ON candidate_friendship.user_id_a = LEAST(mine.friend_id, candidate.id)
            AND candidate_friendship.user_id_b = GREATEST(mine.friend_id, candidate.id)
            AND candidate_friendship.source <> 'official'
         ) AS has_mutual_friend,
         EXISTS (
           SELECT 1 FROM my_clubs AS mine
           JOIN ${schema}.clubs AS club ON club.id = mine.id
           WHERE club.owner_profile_key = 'user:' || candidate.id
              OR EXISTS (
                SELECT 1 FROM ${schema}.club_members AS member
                WHERE member.club_id = mine.id
                  AND member.athlete_profile_key = 'user:' || candidate.id
                  AND member.status = 'claimed' AND member.revoked_at IS NULL
              )
         ) AS shared_club,
         EXISTS (
           SELECT 1 FROM ${schema}.race_results AS mine
           JOIN ${schema}.race_results AS theirs ON theirs.room_id = mine.room_id
           WHERE mine.guest_key = 'user:' || $1
             AND theirs.guest_key = 'user:' || candidate.id
             AND mine.room_id <> 'local'
             AND mine.created_at > now() - interval '90 days'
         ) AS recent_race
       FROM ${schema}.auth_users AS candidate
       WHERE candidate.id <> $1
         AND candidate.friend_discoverable = true
         AND NOT EXISTS (
           SELECT 1 FROM ${schema}.account_friendships AS friendship
           WHERE friendship.user_id_a = LEAST($1, candidate.id)
             AND friendship.user_id_b = GREATEST($1, candidate.id)
         )
         AND NOT EXISTS (
           SELECT 1 FROM ${schema}.account_friend_requests AS request
           WHERE request.status = 'pending'
             AND request.from_user_id IN ($1, candidate.id)
             AND request.to_user_id IN ($1, candidate.id)
         )
         AND NOT EXISTS (
           SELECT 1 FROM ${schema}.friend_blocks AS block
           WHERE (block.blocker_user_id = $1 AND block.blocked_user_id = candidate.id)
              OR (block.blocker_user_id = candidate.id AND block.blocked_user_id = $1)
         )
         AND NOT EXISTS (
           SELECT 1 FROM ${schema}.friendship_suppressions AS suppression
           WHERE suppression.user_id_a = LEAST($1, candidate.id)
             AND suppression.user_id_b = GREATEST($1, candidate.id)
         )
     )
     SELECT count(*)::integer AS total
     FROM candidates
     WHERE has_mutual_friend OR shared_club OR recent_race`,
    [userId],
  );
  return Number(result?.rows?.[0]?.total) || 0;
}

export async function countBlockedAccountProfiles(userId) {
  if (!pool) {
    return [...memoryFriendBlocks.values()].filter((block) => block.blockerUserId === userId).length;
  }
  const result = await query(
    `SELECT count(*)::integer AS total
     FROM ${schema}.friend_blocks
     WHERE blocker_user_id = $1`,
    [userId],
  );
  return Number(result?.rows?.[0]?.total) || 0;
}

export async function loadBlockedAccountProfileIds(userId) {
  if (!userId) return [];
  if (!pool) {
    const profileIds = new Set();
    for (const block of memoryFriendBlocks.values()) {
      if (block.blockerUserId === userId) profileIds.add(block.blockedUserId);
      if (block.blockedUserId === userId) profileIds.add(block.blockerUserId);
    }
    return [...profileIds];
  }
  const result = await query(
    `SELECT CASE
       WHEN blocker_user_id = $1 THEN blocked_user_id
       ELSE blocker_user_id
     END AS profile_id
     FROM ${schema}.friend_blocks
     WHERE blocker_user_id = $1 OR blocked_user_id = $1`,
    [userId],
  );
  if (!result) return null;
  return [...new Set((result?.rows ?? []).map((row) => row.profile_id).filter(Boolean))];
}

export async function createAccountFriendRequest({ id, fromUserId, toUserId }) {
  if (!fromUserId || !toUserId || fromUserId === toUserId) {
    return null;
  }
  if (!pool) {
    const target = memoryAuthUsersById.get(toUserId);
    const pairKey = accountPairKey(fromUserId, toUserId);
    const replay = memoryAccountFriendRequests.get(id);
    if (replay?.fromUserId === fromUserId && replay?.toUserId === toUserId && replay?.status === 'pending') {
      return {
        requestId: replay.id,
        direction: 'outgoing',
        profile: memoryAccountProfile(target),
        createdAt: replay.createdAt,
      };
    }
    const now = Date.now();
    const cooldown = [...memoryAccountFriendRequests.values()]
      .filter((request) => request.fromUserId === fromUserId && request.toUserId === toUserId)
      .map((request) => {
        const respondedAt = Date.parse(request.respondedAt ?? '');
        const cooldownMs = request.status === 'declined'
          ? 30 * 24 * 60 * 60 * 1000
          : request.status === 'cancelled'
            ? 24 * 60 * 60 * 1000
            : 0;
        return cooldownMs > 0 && Number.isFinite(respondedAt)
          ? { status: request.status, retryAt: respondedAt + cooldownMs }
          : null;
      })
      .filter((candidate) => candidate && candidate.retryAt > now)
      .sort((left, right) => right.retryAt - left.retryAt)[0];
    if (cooldown) {
      return {
        unavailableReason: cooldown.status === 'declined' ? 'declined-cooldown' : 'cancelled-cooldown',
        retryAt: new Date(cooldown.retryAt).toISOString(),
      };
    }
    if (
      !target
      || target.friendDiscoverable !== true
      || memoryUsersAreBlocked(fromUserId, toUserId)
      || memoryAccountFriendships.has(pairKey)
    ) {
      return null;
    }
    if ([...memoryAccountFriendRequests.values()].some((request) => (
      request.status === 'pending'
      && accountPairKey(request.fromUserId, request.toUserId) === pairKey
    ))) {
      return null;
    }
    const request = {
      id,
      fromUserId,
      toUserId,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    memoryAccountFriendRequests.set(id, request);
    return {
      requestId: id,
      direction: 'outgoing',
      profile: memoryAccountProfile(target),
      createdAt: request.createdAt,
    };
  }

  const result = await withAccountPairTransaction(fromUserId, toUserId, async (client) => {
    const replay = await client.query(
      `SELECT id, to_user_id, created_at
       FROM ${schema}.account_friend_requests
       WHERE id = $1 AND from_user_id = $2 AND to_user_id = $3 AND status = 'pending'
       LIMIT 1`,
      [id, fromUserId, toUserId],
    );
    if (replay.rows[0]) return { request: replay.rows[0] };

    const cooldown = await client.query(
      `SELECT status,
         CASE
           WHEN status = 'declined' THEN responded_at + interval '30 days'
           ELSE responded_at + interval '24 hours'
         END AS retry_at
       FROM ${schema}.account_friend_requests
       WHERE from_user_id = $1 AND to_user_id = $2
         AND responded_at IS NOT NULL
         AND (
           (status = 'declined' AND responded_at > now() - interval '30 days')
           OR (status = 'cancelled' AND responded_at > now() - interval '24 hours')
         )
       ORDER BY retry_at DESC
       LIMIT 1`,
      [fromUserId, toUserId],
    );
    if (cooldown.rows[0]) {
      return {
        unavailableReason: cooldown.rows[0].status === 'declined'
          ? 'declined-cooldown'
          : 'cancelled-cooldown',
        retryAt: new Date(cooldown.rows[0].retry_at).toISOString(),
      };
    }

    const inserted = await client.query(
      `INSERT INTO ${schema}.account_friend_requests (id, from_user_id, to_user_id, status)
       SELECT $1, $2, target.id, 'pending'
       FROM ${schema}.auth_users AS target
       WHERE target.id = $3
         AND target.id <> $2
         AND target.friend_discoverable = true
         AND NOT EXISTS (
           SELECT 1 FROM ${schema}.account_friendships AS friendship
           WHERE friendship.user_id_a = LEAST($2, target.id)
             AND friendship.user_id_b = GREATEST($2, target.id)
         )
         AND NOT EXISTS (
           SELECT 1 FROM ${schema}.friend_blocks AS block
           WHERE (block.blocker_user_id = $2 AND block.blocked_user_id = target.id)
              OR (block.blocker_user_id = target.id AND block.blocked_user_id = $2)
         )
       ON CONFLICT DO NOTHING
       RETURNING id, to_user_id, created_at`,
      [id, fromUserId, toUserId],
    );
    return { request: inserted.rows[0] ?? null };
  });
  if (result?.unavailableReason) return result;
  const request = result?.request;
  if (!request) {
    return null;
  }
  const target = await findAuthUserById(request.to_user_id);
  return {
    requestId: request.id,
    direction: 'outgoing',
    profile: memoryAccountProfile(target),
    createdAt: new Date(request.created_at).toISOString(),
  };
}

export async function respondToAccountFriendRequest(requestId, userId, action) {
  if (!['accept', 'decline', 'cancel'].includes(action)) {
    return null;
  }
  if (!pool) {
    const request = memoryAccountFriendRequests.get(requestId);
    const authorized = action === 'cancel'
      ? request?.fromUserId === userId
      : request?.toUserId === userId;
    if (!request || request.status !== 'pending' || !authorized) {
      return null;
    }
    request.status = action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : 'cancelled';
    request.respondedAt = new Date().toISOString();
    if (action === 'accept') {
      const [userIdA, userIdB] = accountPair(request.fromUserId, request.toUserId);
      const pairKey = accountPairKey(userIdA, userIdB);
      if (memoryUsersAreBlocked(userIdA, userIdB)) {
        request.status = 'blocked';
        return null;
      }
      memoryFriendshipSuppressions.delete(pairKey);
      memoryAccountFriendships.set(pairKey, {
        userIdA,
        userIdB,
        source: 'request',
        createdAt: request.respondedAt,
      });
    }
    const otherUserId = request.fromUserId === userId ? request.toUserId : request.fromUserId;
    return {
      requestId,
      action,
      profile: memoryAccountProfile(memoryAuthUsersById.get(otherUserId)),
    };
  }

  if (action !== 'accept') {
    const ownerColumn = action === 'cancel' ? 'from_user_id' : 'to_user_id';
    const status = action === 'cancel' ? 'cancelled' : 'declined';
    const result = await query(
      `UPDATE ${schema}.account_friend_requests
       SET status = $3, responded_at = now()
       WHERE id = $1 AND ${ownerColumn} = $2 AND status = 'pending'
       RETURNING id, from_user_id, to_user_id`,
      [requestId, userId, status],
    );
    const request = result?.rows?.[0];
    if (!request) {
      return null;
    }
    const otherUserId = request.from_user_id === userId ? request.to_user_id : request.from_user_id;
    return { requestId, action, profile: memoryAccountProfile(await findAuthUserById(otherUserId)) };
  }

  const pending = await query(
    `SELECT from_user_id, to_user_id
     FROM ${schema}.account_friend_requests
     WHERE id = $1 AND to_user_id = $2 AND status = 'pending'
     LIMIT 1`,
    [requestId, userId],
  );
  const pendingRequest = pending?.rows?.[0];
  if (!pendingRequest) {
    return null;
  }
  const result = await withAccountPairTransaction(
    pendingRequest.from_user_id,
    pendingRequest.to_user_id,
    (client) => client.query(
    `WITH accepted AS (
       UPDATE ${schema}.account_friend_requests AS request
       SET status = 'accepted', responded_at = now()
       WHERE request.id = $1
         AND request.to_user_id = $2
         AND request.status = 'pending'
         AND NOT EXISTS (
           SELECT 1 FROM ${schema}.friend_blocks AS block
           WHERE (block.blocker_user_id = request.from_user_id AND block.blocked_user_id = request.to_user_id)
              OR (block.blocker_user_id = request.to_user_id AND block.blocked_user_id = request.from_user_id)
         )
       RETURNING request.id, request.from_user_id, request.to_user_id, request.responded_at
     ), cleared AS (
       DELETE FROM ${schema}.friendship_suppressions AS suppression
       USING accepted
       WHERE suppression.user_id_a = LEAST(accepted.from_user_id, accepted.to_user_id)
         AND suppression.user_id_b = GREATEST(accepted.from_user_id, accepted.to_user_id)
     ), connected AS (
       INSERT INTO ${schema}.account_friendships (user_id_a, user_id_b, source, created_at)
       SELECT LEAST(from_user_id, to_user_id), GREATEST(from_user_id, to_user_id), 'request', responded_at
       FROM accepted
       ON CONFLICT (user_id_a, user_id_b) DO NOTHING
     )
     SELECT * FROM accepted`,
    [requestId, userId],
    ),
  );
  const request = result?.rows?.[0];
  if (!request) {
    return null;
  }
  return {
    requestId,
    action,
    profile: memoryAccountProfile(await findAuthUserById(request.from_user_id)),
  };
}

export async function removeAccountFriend(userId, friendUserId) {
  if (!userId || !friendUserId || userId === friendUserId) {
    return null;
  }
  const [userIdA, userIdB] = accountPair(userId, friendUserId);
  const pairKey = accountPairKey(userIdA, userIdB);
  if (!pool) {
    const friendship = memoryAccountFriendships.get(pairKey);
    if (!friendship) {
      return null;
    }
    memoryAccountFriendships.delete(pairKey);
    if (
      friendship.source === 'official'
      || memoryOfficialFriendKindByUserId.has(userId)
      || memoryOfficialFriendKindByUserId.has(friendUserId)
    ) {
      memoryFriendshipSuppressions.set(pairKey, {
        userIdA,
        userIdB,
        actorUserId: userId,
        reason: 'removed',
        createdAt: new Date().toISOString(),
      });
    }
    return memoryAccountProfile(memoryAuthUsersById.get(friendUserId));
  }

  const result = await withAccountPairTransaction(userIdA, userIdB, (client) => client.query(
     `WITH removed AS (
       DELETE FROM ${schema}.account_friendships
       WHERE user_id_a = $1 AND user_id_b = $2
       RETURNING source
     ), legacy_removed AS (
       DELETE FROM ${schema}.friendships
       WHERE (guest_key_a = 'user:' || $1 AND guest_key_b = 'user:' || $2)
          OR (guest_key_a = 'user:' || $2 AND guest_key_b = 'user:' || $1)
     ), suppressed AS (
       INSERT INTO ${schema}.friendship_suppressions (
         user_id_a, user_id_b, actor_user_id, reason, created_at
       )
       SELECT $1, $2, $3, 'removed', now()
       WHERE EXISTS (
         SELECT 1 FROM removed WHERE source = 'official'
       ) OR EXISTS (
         SELECT 1 FROM ${schema}.official_friend_accounts
         WHERE user_id IN ($1, $2)
       )
       ON CONFLICT (user_id_a, user_id_b) DO UPDATE SET
         actor_user_id = EXCLUDED.actor_user_id,
         reason = EXCLUDED.reason,
         created_at = now()
     )
     SELECT source FROM removed`,
    [userIdA, userIdB, userId],
  ));
  if (!result?.rows?.[0]) {
    return null;
  }
  return memoryAccountProfile(await findAuthUserById(friendUserId));
}

export async function blockAccountProfile(userId, blockedUserId) {
  if (!userId || !blockedUserId || userId === blockedUserId) {
    return null;
  }
  const target = await findAuthUserById(blockedUserId);
  if (!target) {
    return null;
  }
  const [userIdA, userIdB] = accountPair(userId, blockedUserId);
  const pairKey = accountPairKey(userIdA, userIdB);
  if (!pool) {
    memoryFriendBlocks.set(`${userId}:${blockedUserId}`, {
      blockerUserId: userId,
      blockedUserId,
      createdAt: new Date().toISOString(),
    });
    memoryAccountFriendships.delete(pairKey);
    for (const request of memoryAccountFriendRequests.values()) {
      if (request.status === 'pending' && accountPairKey(request.fromUserId, request.toUserId) === pairKey) {
        request.status = 'blocked';
        request.respondedAt = new Date().toISOString();
      }
    }
    for (const invite of memoryGroupInvitesById.values()) {
      if (
        invite.status === 'pending'
        && new Set([invite.fromGuestKey, invite.toGuestKey]).has(`user:${userId}`)
        && new Set([invite.fromGuestKey, invite.toGuestKey]).has(`user:${blockedUserId}`)
      ) {
        invite.status = 'blocked';
        invite.respondedAt = new Date().toISOString();
      }
    }
    memoryFriendshipSuppressions.set(pairKey, {
      userIdA,
      userIdB,
      actorUserId: userId,
      reason: 'blocked',
      createdAt: new Date().toISOString(),
    });
    return memoryAccountProfile(target);
  }

  const result = await withAccountPairTransaction(userId, blockedUserId, (client) => client.query(
     `WITH blocked AS (
       INSERT INTO ${schema}.friend_blocks (blocker_user_id, blocked_user_id)
       VALUES ($1, $2)
       ON CONFLICT (blocker_user_id, blocked_user_id) DO UPDATE SET created_at = now()
       RETURNING blocker_user_id
     ), removed AS (
       DELETE FROM ${schema}.account_friendships
       WHERE user_id_a = LEAST($1, $2) AND user_id_b = GREATEST($1, $2)
     ), legacy_removed AS (
       DELETE FROM ${schema}.friendships
       WHERE (guest_key_a = 'user:' || $1 AND guest_key_b = 'user:' || $2)
          OR (guest_key_a = 'user:' || $2 AND guest_key_b = 'user:' || $1)
     ), requests AS (
       UPDATE ${schema}.account_friend_requests
       SET status = 'blocked', responded_at = now()
       WHERE status = 'pending'
         AND from_user_id IN ($1, $2) AND to_user_id IN ($1, $2)
     ), legacy_requests AS (
       UPDATE ${schema}.friend_requests
       SET status = 'blocked', responded_at = now()
       WHERE status = 'pending'
         AND from_guest_key IN ('user:' || $1, 'user:' || $2)
         AND to_guest_key IN ('user:' || $1, 'user:' || $2)
     ), group_requests AS (
       UPDATE ${schema}.group_invites
       SET status = 'blocked', responded_at = now()
       WHERE status = 'pending'
         AND from_guest_key IN ('user:' || $1, 'user:' || $2)
         AND to_guest_key IN ('user:' || $1, 'user:' || $2)
     ), suppressed AS (
       INSERT INTO ${schema}.friendship_suppressions (
         user_id_a, user_id_b, actor_user_id, reason, created_at
       ) VALUES (LEAST($1, $2), GREATEST($1, $2), $1, 'blocked', now())
       ON CONFLICT (user_id_a, user_id_b) DO UPDATE SET
         actor_user_id = EXCLUDED.actor_user_id,
         reason = 'blocked',
         created_at = now()
     )
     SELECT blocker_user_id FROM blocked`,
    [userId, blockedUserId],
  ));
  return result?.rows?.[0] ? memoryAccountProfile(target) : null;
}

export async function unblockAccountProfile(userId, blockedUserId) {
  if (!pool) {
    return memoryFriendBlocks.delete(`${userId}:${blockedUserId}`);
  }
  const result = await query(
    `DELETE FROM ${schema}.friend_blocks
     WHERE blocker_user_id = $1 AND blocked_user_id = $2
     RETURNING blocker_user_id`,
    [userId, blockedUserId],
  );
  return Boolean(result?.rows?.[0]);
}

export async function listBlockedAccountProfiles(userId, { offset = 0, limit = 25 } = {}) {
  if (!pool) {
    return [...memoryFriendBlocks.values()]
      .filter((block) => block.blockerUserId === userId)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(offset, offset + limit)
      .map((block) => memoryAccountProfile(memoryAuthUsersById.get(block.blockedUserId), {
        blockedAt: block.createdAt,
      }))
      .filter(Boolean);
  }
  const result = await query(
    `SELECT
       blocked.id AS profile_id,
       blocked.display_name,
       blocked.username,
       official.kind AS official_type,
       block.created_at AS blocked_at
     FROM ${schema}.friend_blocks AS block
     JOIN ${schema}.auth_users AS blocked ON blocked.id = block.blocked_user_id
     LEFT JOIN ${schema}.official_friend_accounts AS official ON official.user_id = blocked.id
     WHERE block.blocker_user_id = $1
     ORDER BY block.created_at DESC, blocked.id
     OFFSET $2 LIMIT $3`,
    [userId, offset, limit],
  );
  return (result?.rows ?? []).map((row) => accountProfileFromRow(row, {
    blockedAt: new Date(row.blocked_at).toISOString(),
  }));
}

export async function createFriendReport(report) {
  if (!report.reporterUserId || !report.reportedUserId || report.reporterUserId === report.reportedUserId) {
    return null;
  }
  if (!pool) {
    if (!memoryAuthUsersById.has(report.reportedUserId)) {
      return null;
    }
    const record = { ...report, status: 'open', createdAt: new Date().toISOString() };
    memoryFriendReports.set(record.id, record);
    return { reportId: record.id, status: record.status, createdAt: record.createdAt };
  }
  const result = await query(
    `INSERT INTO ${schema}.friend_reports (
       id, reporter_user_id, reported_user_id, reason, details, status
     )
     SELECT $1, $2, reported.id, $4, $5, 'open'
     FROM ${schema}.auth_users AS reported
     WHERE reported.id = $3 AND reported.id <> $2
     RETURNING id, status, created_at`,
    [report.id, report.reporterUserId, report.reportedUserId, report.reason, report.details],
  );
  const row = result?.rows?.[0];
  return row ? { reportId: row.id, status: row.status, createdAt: new Date(row.created_at).toISOString() } : null;
}

export async function createFriendInvite(invite) {
  if (!pool) {
    const revokedAt = new Date().toISOString();
    [...memoryFriendInvitesByHash.values()]
      .filter((existing) => (
        existing.inviterUserId === invite.inviterUserId
        && !existing.claimedAt
        && !existing.revokedAt
        && Date.parse(existing.expiresAt) > Date.now()
      ))
      .sort((left, right) => (
        Date.parse(right.createdAt) - Date.parse(left.createdAt)
        || Number(right._sequence || 0) - Number(left._sequence || 0)
      ))
      .slice(4)
      .forEach((existing) => {
        existing.revokedAt = revokedAt;
      });
    const record = {
      ...invite,
      claimedByUserId: null,
      claimedAt: null,
      revokedAt: null,
      createdAt: new Date().toISOString(),
      _sequence: ++memoryFriendInviteSequence,
    };
    memoryFriendInvitesByHash.set(invite.tokenHash, record);
    return { inviteId: record.id, expiresAt: record.expiresAt, createdAt: record.createdAt };
  }
  const result = await withPersistenceLock(`friend-invite:${invite.inviterUserId}`, async (client) => {
    await client.query(
      `UPDATE ${schema}.friend_invites AS invite
       SET revoked_at = now()
       WHERE invite.id IN (
         SELECT stale.id
         FROM ${schema}.friend_invites AS stale
         WHERE stale.inviter_user_id = $1
           AND stale.claimed_at IS NULL
           AND stale.revoked_at IS NULL
           AND stale.expires_at > now()
         ORDER BY stale.created_at DESC, stale.id DESC
         OFFSET 4
       )`,
      [invite.inviterUserId],
    );
    return client.query(
      `INSERT INTO ${schema}.friend_invites (id, inviter_user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, expires_at, created_at`,
      [invite.id, invite.inviterUserId, invite.tokenHash, invite.expiresAt],
    );
  });
  const row = result?.rows?.[0];
  return row ? {
    inviteId: row.id,
    expiresAt: new Date(row.expires_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
  } : null;
}

export async function listActiveFriendInvites(inviterUserId) {
  if (!inviterUserId) return [];
  if (!pool) {
    return [...memoryFriendInvitesByHash.values()]
      .filter((invite) => (
        invite.inviterUserId === inviterUserId
        && !invite.claimedAt
        && !invite.revokedAt
        && Date.parse(invite.expiresAt) > Date.now()
      ))
      .sort((left, right) => (
        Date.parse(right.createdAt) - Date.parse(left.createdAt)
        || Number(right._sequence || 0) - Number(left._sequence || 0)
      ))
      .map((invite) => ({
        id: invite.id,
        createdAt: invite.createdAt,
        expiresAt: invite.expiresAt,
      }));
  }
  const result = await query(
    `SELECT id, created_at, expires_at
     FROM ${schema}.friend_invites
     WHERE inviter_user_id = $1
       AND claimed_at IS NULL
       AND revoked_at IS NULL
       AND expires_at > now()
     ORDER BY created_at DESC, id DESC
     LIMIT 5`,
    [inviterUserId],
  );
  return (result?.rows ?? []).map((row) => ({
    id: row.id,
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
  }));
}

export async function revokeAllFriendInvites(inviterUserId) {
  if (!inviterUserId) return 0;
  if (!pool) {
    const revokedAt = new Date().toISOString();
    let revoked = 0;
    for (const invite of memoryFriendInvitesByHash.values()) {
      if (
        invite.inviterUserId === inviterUserId
        && !invite.claimedAt
        && !invite.revokedAt
        && Date.parse(invite.expiresAt) > Date.now()
      ) {
        invite.revokedAt = revokedAt;
        revoked += 1;
      }
    }
    return revoked;
  }
  const result = await withPersistenceLock(`friend-invite:${inviterUserId}`, (client) => client.query(
    `UPDATE ${schema}.friend_invites
     SET revoked_at = now()
     WHERE inviter_user_id = $1
       AND claimed_at IS NULL
       AND revoked_at IS NULL
       AND expires_at > now()
     RETURNING id`,
    [inviterUserId],
  ));
  return result?.rowCount ?? result?.rows?.length ?? 0;
}

export async function previewFriendInvite(tokenHashValue) {
  if (!pool) {
    const invite = memoryFriendInvitesByHash.get(tokenHashValue);
    if (!invite || invite.claimedAt || invite.revokedAt || Date.parse(invite.expiresAt) <= Date.now()) {
      return null;
    }
    return {
      inviteId: invite.id,
      expiresAt: invite.expiresAt,
      profile: memoryAccountProfile(memoryAuthUsersById.get(invite.inviterUserId)),
    };
  }
  const result = await query(
    `SELECT
       invite.id,
       invite.expires_at,
       inviter.id AS profile_id,
       inviter.display_name,
       inviter.username,
       official.kind AS official_type
     FROM ${schema}.friend_invites AS invite
     JOIN ${schema}.auth_users AS inviter ON inviter.id = invite.inviter_user_id
     LEFT JOIN ${schema}.official_friend_accounts AS official ON official.user_id = inviter.id
     WHERE invite.token_hash = $1
       AND invite.claimed_at IS NULL
       AND invite.revoked_at IS NULL
       AND invite.expires_at > now()
     LIMIT 1`,
    [tokenHashValue],
  );
  const row = result?.rows?.[0];
  return row ? {
    inviteId: row.id,
    expiresAt: new Date(row.expires_at).toISOString(),
    profile: accountProfileFromRow(row),
  } : null;
}

export async function claimFriendInvite(tokenHashValue, claimantUserId) {
  if (!pool) {
    const invite = memoryFriendInvitesByHash.get(tokenHashValue);
    if (
      !invite
      || invite.claimedAt
      || invite.revokedAt
      || Date.parse(invite.expiresAt) <= Date.now()
      || invite.inviterUserId === claimantUserId
      || memoryUsersAreBlocked(invite.inviterUserId, claimantUserId)
    ) {
      return null;
    }
    const [userIdA, userIdB] = accountPair(invite.inviterUserId, claimantUserId);
    const pairKey = accountPairKey(userIdA, userIdB);
    const claimedAt = new Date().toISOString();
    invite.claimedByUserId = claimantUserId;
    invite.claimedAt = claimedAt;
    memoryFriendshipSuppressions.delete(pairKey);
    const existingFriendship = memoryAccountFriendships.get(pairKey);
    if (!existingFriendship || ['official', 'legacy'].includes(existingFriendship.source)) {
      memoryAccountFriendships.set(pairKey, { userIdA, userIdB, source: 'invite', createdAt: claimedAt });
    }
    const friendshipSource = memoryAccountFriendships.get(pairKey)?.source ?? 'invite';
    return {
      inviteId: invite.id,
      connectedAt: claimedAt,
      profile: memoryAccountProfile(memoryAuthUsersById.get(invite.inviterUserId), { friendshipSource }),
    };
  }

  const inviteLookup = await query(
    `SELECT inviter_user_id
     FROM ${schema}.friend_invites
     WHERE token_hash = $1 AND claimed_at IS NULL AND revoked_at IS NULL AND expires_at > now()
     LIMIT 1`,
    [tokenHashValue],
  );
  const inviterUserId = inviteLookup?.rows?.[0]?.inviter_user_id;
  if (!inviterUserId || inviterUserId === claimantUserId) {
    return null;
  }
  const result = await withAccountPairTransaction(inviterUserId, claimantUserId, (client) => client.query(
    `WITH claimed AS (
       UPDATE ${schema}.friend_invites AS invite
       SET claimed_by_user_id = $2, claimed_at = now()
       WHERE invite.token_hash = $1
         AND invite.claimed_at IS NULL
         AND invite.revoked_at IS NULL
         AND invite.expires_at > now()
         AND invite.inviter_user_id <> $2
         AND NOT EXISTS (
           SELECT 1 FROM ${schema}.friend_blocks AS block
           WHERE (block.blocker_user_id = invite.inviter_user_id AND block.blocked_user_id = $2)
              OR (block.blocker_user_id = $2 AND block.blocked_user_id = invite.inviter_user_id)
         )
       RETURNING invite.id, invite.inviter_user_id, invite.claimed_at
     ), cleared AS (
       DELETE FROM ${schema}.friendship_suppressions AS suppression
       USING claimed
       WHERE suppression.user_id_a = LEAST(claimed.inviter_user_id, $2)
         AND suppression.user_id_b = GREATEST(claimed.inviter_user_id, $2)
     ), connected AS (
       INSERT INTO ${schema}.account_friendships AS existing (user_id_a, user_id_b, source, created_at)
       SELECT LEAST(inviter_user_id, $2), GREATEST(inviter_user_id, $2), 'invite', claimed_at
       FROM claimed
       ON CONFLICT (user_id_a, user_id_b) DO UPDATE SET
         source = 'invite',
         created_at = EXCLUDED.created_at
       WHERE existing.source IN ('official', 'legacy')
       RETURNING source
     )
     SELECT claimed.id, claimed.inviter_user_id, claimed.claimed_at,
       inviter.display_name, inviter.username,
       official.kind AS official_type,
       COALESCE(
         (SELECT source FROM connected LIMIT 1),
         (SELECT friendship.source
          FROM ${schema}.account_friendships AS friendship
          WHERE friendship.user_id_a = LEAST(claimed.inviter_user_id, $2)
            AND friendship.user_id_b = GREATEST(claimed.inviter_user_id, $2)
          LIMIT 1),
         'invite'
       ) AS friendship_source
     FROM claimed
     JOIN ${schema}.auth_users AS inviter ON inviter.id = claimed.inviter_user_id
     LEFT JOIN ${schema}.official_friend_accounts AS official ON official.user_id = inviter.id`,
    [tokenHashValue, claimantUserId],
  ));
  const row = result?.rows?.[0];
  return row ? {
    inviteId: row.id,
    connectedAt: new Date(row.claimed_at).toISOString(),
    profile: accountProfileFromRow(
      { ...row, profile_id: row.inviter_user_id },
      { friendshipSource: row.friendship_source ?? 'invite' },
    ),
  } : null;
}

export async function revokeFriendInvite(inviteId, inviterUserId) {
  if (!pool) {
    const invite = [...memoryFriendInvitesByHash.values()].find((candidate) => (
      candidate.id === inviteId && candidate.inviterUserId === inviterUserId
    ));
    if (!invite || invite.claimedAt || invite.revokedAt) {
      return false;
    }
    invite.revokedAt = new Date().toISOString();
    return true;
  }
  const result = await query(
    `UPDATE ${schema}.friend_invites
     SET revoked_at = now()
     WHERE id = $1 AND inviter_user_id = $2 AND claimed_at IS NULL AND revoked_at IS NULL
     RETURNING id`,
    [inviteId, inviterUserId],
  );
  return Boolean(result?.rows?.[0]);
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

  const accountUserId = String(guestKey).startsWith('user:') ? String(guestKey).slice(5) : '';
  if (!pool) {
    return accountUserId
      ? memoryFriendIds(accountUserId, { includeOfficial: false }).map((userId) => `user:${userId}`)
      : [];
  }

  const result = await query(
    `SELECT friend_key
     FROM (
       SELECT CASE
         WHEN legacy.guest_key_a = $1 THEN legacy.guest_key_b
         ELSE legacy.guest_key_a
       END AS friend_key,
       legacy.created_at
       FROM ${schema}.friendships AS legacy
       WHERE (legacy.guest_key_a = $1 OR legacy.guest_key_b = $1)
         AND NOT EXISTS (
           SELECT 1 FROM ${schema}.official_friend_accounts AS official
           WHERE ('user:' || official.user_id) IN (legacy.guest_key_a, legacy.guest_key_b)
         )

       UNION

       SELECT 'user:' || CASE
         WHEN friendship.user_id_a = $2 THEN friendship.user_id_b
         ELSE friendship.user_id_a
       END AS friend_key,
       friendship.created_at
       FROM ${schema}.account_friendships AS friendship
       WHERE friendship.source <> 'official'
         AND (friendship.user_id_a = $2 OR friendship.user_id_b = $2)
     ) AS private_friends
     ORDER BY created_at DESC
     LIMIT 250`,
    [guestKey, accountUserId],
  );
  return (result?.rows ?? []).map((row) => row.friend_key);
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
  if (!pool) {
    const createdAt = new Date().toISOString();
    const saved = {
      id: group.id,
      name: group.name,
      ownerGuestKey: ownerClient.guestKey,
      createdAt,
    };
    memoryGroupsById.set(group.id, saved);
    memoryGroupMembersByKey.set(memoryGroupMemberKey(group.id, ownerClient.guestKey), {
      groupId: group.id,
      guestKey: ownerClient.guestKey,
      displayName: ownerClient.name,
      role: 'owner',
      joinedAt: createdAt,
      leftAt: null,
    });
    return group;
  }
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
  if (!pool) {
    const member = memoryGroupMembersByKey.get(memoryGroupMemberKey(groupId, guestKey));
    return Boolean(member && !member.leftAt);
  }
  const result = await query(
    `SELECT 1 FROM ${schema}.group_members WHERE group_id = $1 AND guest_key = $2 AND left_at IS NULL LIMIT 1`,
    [groupId, guestKey],
  );
  return Boolean(result?.rows?.[0]);
}

export async function createGroupInvite(invite, fromClient, targetClient) {
  if (!pool) {
    if (
      memoryGuestKeysAreBlocked(fromClient.guestKey, targetClient.guestKey)
      || !(await isGroupMember(invite.groupId, fromClient.guestKey))
      || await isGroupMember(invite.groupId, targetClient.guestKey)
      || [...memoryGroupInvitesById.values()].some((candidate) => (
        candidate.groupId === invite.groupId
        && candidate.toGuestKey === targetClient.guestKey
        && candidate.status === 'pending'
      ))
    ) {
      return null;
    }
    memoryGroupInvitesById.set(invite.id, {
      ...invite,
      fromGuestKey: fromClient.guestKey,
      fromName: fromClient.name,
      toGuestKey: targetClient.guestKey,
      toName: targetClient.name,
      status: 'pending',
      createdAt: new Date().toISOString(),
      respondedAt: null,
    });
    return invite;
  }
  const blockState = await query(
    `SELECT 1 FROM ${schema}.friend_blocks AS block
     WHERE ('user:' || block.blocker_user_id = $1 AND 'user:' || block.blocked_user_id = $2)
        OR ('user:' || block.blocker_user_id = $2 AND 'user:' || block.blocked_user_id = $1)
     LIMIT 1`,
    [fromClient.guestKey, targetClient.guestKey],
  );
  if (!blockState || blockState.rows[0]) return null;
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
  if (!pool) {
    const invite = memoryGroupInvitesById.get(inviteId);
    if (
      !invite
      || invite.toGuestKey !== client.guestKey
      || invite.status !== 'pending'
      || memoryGuestKeysAreBlocked(invite.fromGuestKey, invite.toGuestKey)
    ) {
      return null;
    }
    invite.status = accepted ? 'accepted' : 'declined';
    invite.respondedAt = new Date().toISOString();
    if (accepted) {
      const memberKey = memoryGroupMemberKey(invite.groupId, client.guestKey);
      const existing = memoryGroupMembersByKey.get(memberKey);
      memoryGroupMembersByKey.set(memberKey, {
        groupId: invite.groupId,
        guestKey: client.guestKey,
        displayName: client.name,
        role: existing?.role === 'owner' ? 'owner' : 'member',
        joinedAt: existing?.joinedAt ?? invite.respondedAt,
        leftAt: null,
      });
    }
    return {
      id: invite.id,
      groupId: invite.groupId,
      fromGuestKey: invite.fromGuestKey,
      toGuestKey: invite.toGuestKey,
      accepted,
    };
  }
  const result = await query(
    `UPDATE ${schema}.group_invites
     SET status = $3, responded_at = now()
     WHERE id = $1 AND to_guest_key = $2 AND status = 'pending'
       AND NOT EXISTS (
         SELECT 1 FROM ${schema}.friend_blocks AS block
         WHERE ('user:' || block.blocker_user_id = $2 AND 'user:' || block.blocked_user_id = ${schema}.group_invites.from_guest_key)
            OR ('user:' || block.blocked_user_id = $2 AND 'user:' || block.blocker_user_id = ${schema}.group_invites.from_guest_key)
       )
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

  if (!pool) {
    const groups = [...memoryGroupMembersByKey.values()]
      .filter((member) => member.guestKey === guestKey && !member.leftAt)
      .map((member) => ({ member, group: memoryGroupsById.get(member.groupId) }))
      .filter(({ group }) => group && !memoryGuestKeysAreBlocked(guestKey, group.ownerGuestKey))
      .sort((left, right) => Date.parse(right.group.createdAt) - Date.parse(left.group.createdAt))
      .slice(0, 25)
      .map(({ member, group }) => ({
        id: group.id,
        name: group.name,
        ownerGuestKey: group.ownerGuestKey,
        role: member.role,
        members: [...memoryGroupMembersByKey.values()]
          .filter((candidate) => (
            candidate.groupId === group.id
            && !candidate.leftAt
            && !memoryGuestKeysAreBlocked(guestKey, candidate.guestKey)
          ))
          .sort((left, right) => Date.parse(left.joinedAt) - Date.parse(right.joinedAt))
          .map((candidate) => ({
            guestKey: candidate.guestKey,
            name: candidate.displayName,
            role: candidate.role,
          })),
        createdAt: group.createdAt,
      }));
    const incomingGroupInvites = [...memoryGroupInvitesById.values()]
      .filter((invite) => (
        invite.toGuestKey === guestKey
        && invite.status === 'pending'
        && !memoryGuestKeysAreBlocked(invite.fromGuestKey, guestKey)
      ))
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, 25)
      .map((invite) => ({
        id: invite.id,
        groupId: invite.groupId,
        groupName: memoryGroupsById.get(invite.groupId)?.name ?? 'TrackLab group',
        fromGuestKey: invite.fromGuestKey,
        fromName: invite.fromName,
        toGuestKey: invite.toGuestKey,
        toName: invite.toName,
        createdAt: invite.createdAt,
      }));
    return {
      friends: [],
      incomingFriendRequests: [],
      outgoingFriendRequests: [],
      groups,
      incomingGroupInvites,
    };
  }

  const [friends, incomingFriendRequests, outgoingFriendRequests, groups, groupMembers, incomingGroupInvites] = await Promise.all([
    query(
      `SELECT guest_key_a, guest_key_b, display_name_a, display_name_b, created_at
       FROM ${schema}.friendships
       WHERE (guest_key_a = $1 OR guest_key_b = $1)
         AND NOT EXISTS (
           SELECT 1 FROM ${schema}.official_friend_accounts AS official
           WHERE ('user:' || official.user_id) IN (guest_key_a, guest_key_b)
         )
       ORDER BY created_at DESC`,
      [guestKey],
    ),
    query(
      `SELECT id, from_guest_key, from_name, to_guest_key, to_name, created_at
       FROM ${schema}.friend_requests
       WHERE to_guest_key = $1 AND status = 'pending'
         AND NOT EXISTS (
           SELECT 1 FROM ${schema}.friend_blocks AS block
           WHERE ('user:' || block.blocker_user_id = $1 AND 'user:' || block.blocked_user_id = from_guest_key)
              OR ('user:' || block.blocked_user_id = $1 AND 'user:' || block.blocker_user_id = from_guest_key)
         )
       ORDER BY created_at DESC
       LIMIT 25`,
      [guestKey],
    ),
    query(
      `SELECT id, from_guest_key, from_name, to_guest_key, to_name, created_at
       FROM ${schema}.friend_requests
       WHERE from_guest_key = $1 AND status = 'pending'
         AND NOT EXISTS (
           SELECT 1 FROM ${schema}.friend_blocks AS block
           WHERE ('user:' || block.blocker_user_id = $1 AND 'user:' || block.blocked_user_id = to_guest_key)
              OR ('user:' || block.blocked_user_id = $1 AND 'user:' || block.blocker_user_id = to_guest_key)
         )
       ORDER BY created_at DESC
       LIMIT 25`,
      [guestKey],
    ),
    query(
      `SELECT group_table.id, group_table.name, group_table.owner_guest_key, member.role, group_table.created_at
       FROM ${schema}.groups AS group_table
       JOIN ${schema}.group_members AS member ON member.group_id = group_table.id
       WHERE member.guest_key = $1 AND member.left_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM ${schema}.friend_blocks AS block
           WHERE ('user:' || block.blocker_user_id = $1 AND 'user:' || block.blocked_user_id = group_table.owner_guest_key)
              OR ('user:' || block.blocked_user_id = $1 AND 'user:' || block.blocker_user_id = group_table.owner_guest_key)
         )
       ORDER BY group_table.created_at DESC
       LIMIT 25`,
      [guestKey],
    ),
    query(
      `SELECT group_id, guest_key, display_name, role
       FROM ${schema}.group_members
       WHERE left_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM ${schema}.friend_blocks AS block
           WHERE ('user:' || block.blocker_user_id = $1 AND 'user:' || block.blocked_user_id = guest_key)
              OR ('user:' || block.blocked_user_id = $1 AND 'user:' || block.blocker_user_id = guest_key)
         )
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
         AND NOT EXISTS (
           SELECT 1 FROM ${schema}.friend_blocks AS block
           WHERE ('user:' || block.blocker_user_id = $1 AND 'user:' || block.blocked_user_id = invite.from_guest_key)
              OR ('user:' || block.blocked_user_id = $1 AND 'user:' || block.blocker_user_id = invite.from_guest_key)
         )
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
    const photoUrl = raceState.riders?.find((rider) => rider.playerId === summary.playerId)?.photoUrl;
    const storedSummary = {
      ...summary,
      ...(photoUrl ? { photoUrl } : {}),
    };
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
      json(storedSummary),
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
    let inserted = 0;
    entries.forEach((entry) => {
      if (!memoryLocalRaceResults.has(entry.dedupeKey)) {
        memoryLocalRaceResults.set(entry.dedupeKey, entry);
        inserted += 1;
      }
    });
    return { rowCount: inserted };
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
  if (!pool) {
    const metricDefinitions = {
      rpm: { field: 'topCadence', unit: 'RPM', factor: 1 },
      speed: { field: 'topSpeedKph', unit: 'MPH', factor: 0.621371 },
    };
    return Object.fromEntries(Object.entries(metricDefinitions).map(([metric, definition]) => {
      const bestByRider = new Map();
      [...memoryLocalRaceResults.values()]
        .filter((entry) => entry.trackId === trackId)
        .forEach((entry) => {
          const rawValue = Number(entry[definition.field]);
          if (!Number.isFinite(rawValue)) {
            return;
          }
          const riderKey = `${entry.guestKey}:${entry.riderName.toLocaleLowerCase()}`;
          const current = bestByRider.get(riderKey);
          if (!current || rawValue > current.rawValue) {
            bestByRider.set(riderKey, { entry, rawValue });
          }
        });
      return [metric, [...bestByRider.values()]
        .sort((left, right) => right.rawValue - left.rawValue)
        .slice(0, safeLimit)
        .map(({ entry, rawValue }) => ({
          rider: entry.riderName,
          ...(entry.summary?.photoUrl ? { photoUrl: entry.summary.photoUrl } : {}),
          value: rawValue * definition.factor,
          unit: definition.unit,
          date: new Date(entry.createdAt).toISOString().slice(0, 10),
        }))];
    }));
  }
  const result = await query(
    `WITH cadence_bests AS (
       SELECT DISTINCT ON (guest_key, rider_name)
         rider_name, top_cadence AS value, created_at, summary->>'photoUrl' AS photo_url
       FROM ${schema}.race_results
       WHERE track_id = $1 AND top_cadence IS NOT NULL
       ORDER BY guest_key, rider_name, top_cadence DESC, created_at DESC
     ), speed_bests AS (
       SELECT DISTINCT ON (guest_key, rider_name)
         rider_name, top_speed_kph AS value, created_at, summary->>'photoUrl' AS photo_url
       FROM ${schema}.race_results
       WHERE track_id = $1 AND top_speed_kph IS NOT NULL
       ORDER BY guest_key, rider_name, top_speed_kph DESC, created_at DESC
     )
     SELECT 'rpm' AS metric, rider_name, value, created_at, photo_url
     FROM (SELECT * FROM cadence_bests ORDER BY value DESC LIMIT $2) AS cadence_leaders
     UNION ALL
     SELECT 'speed' AS metric, rider_name, value, created_at, photo_url
     FROM (SELECT * FROM speed_bests ORDER BY value DESC LIMIT $2) AS speed_leaders`,
    [trackId, safeLimit],
  );

  const boards = { rpm: [], speed: [] };
  for (const row of result?.rows ?? []) {
    boards[row.metric]?.push({
      rider: row.rider_name,
      ...(row.photo_url ? { photoUrl: row.photo_url } : {}),
      value: row.metric === 'speed' ? Number(row.value) * 0.621371 : Number(row.value),
      unit: row.metric === 'rpm' ? 'RPM' : 'MPH',
      date: new Date(row.created_at).toISOString().slice(0, 10),
    });
  }

  boards.rpm.sort((a, b) => b.value - a.value);
  boards.speed.sort((a, b) => b.value - a.value);

  return {
    rpm: boards.rpm.slice(0, safeLimit),
    speed: boards.speed.slice(0, safeLimit),
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

export async function loadPreRaceRiderStats(trackId, profileKeys, riderNames) {
  const personalKeys = [...new Set((Array.isArray(profileKeys) ? profileKeys : [profileKeys])
    .map((key) => String(key || '').trim())
    .filter(Boolean))]
    .slice(0, 32);
  const names = [...new Set((Array.isArray(riderNames) ? riderNames : [])
    .map((name) => String(name || '').trim())
    .filter(Boolean))]
    .slice(0, 4);
  if (personalKeys.length === 0 || names.length === 0) {
    return [];
  }
  if (!pool) {
    const nameKeys = new Set(names.map((name) => name.toLocaleLowerCase()));
    const matching = [...memoryLocalRaceResults.values()]
      .filter((entry) => (
        entry.trackId === trackId
        && personalKeys.includes(entry.guestKey)
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
         AND guest_key = ANY($2::text[])
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
    [trackId, personalKeys, names.map((name) => name.toLocaleLowerCase())],
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

function sprintDistanceFeet(value) {
  const numeric = Math.round(Number(value));
  return numeric === 30 || numeric === 145 || (numeric >= 100 && numeric <= 1500 && numeric % 100 === 0) ? numeric : null;
}

function sprintAirSetting(value) {
  const numeric = Math.round(Number(value));
  return numeric >= 1 && numeric <= 10 ? numeric : null;
}

function routeKey(routeVariantId, lapCount = 1, distanceFeet, airSetting) {
  const variant = routeVariantId === 'amateur' || routeVariantId === 'pro' ? routeVariantId : 'default';
  const laps = safeLapCount(lapCount);
  const base = laps > 1 ? `${variant}:laps:${laps}` : variant;
  const distance = sprintDistanceFeet(distanceFeet);
  const air = sprintAirSetting(airSetting);
  return distance != null && air != null ? `${base}:sprint:${distance}ft:air:${air}` : base;
}

function redactPrivatePower(value) {
  if (Array.isArray(value)) return value.map(redactPrivatePower);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, nested]) => (
    /(?:watts?|power)/i.test(key) ? [] : [[key, redactPrivatePower(nested)]]
  )));
}

function ghostFromRow(row, source = 'top', includeAnalytics = false) {
  const medalRank = Number(row.medal_rank);
  const storedSummary = fromJson(row.summary, null);
  const visibleSummary = includeAnalytics
    ? (source === 'personal' ? storedSummary : redactPrivatePower(storedSummary))
    : null;
  const storedZoneResults = includeAnalytics ? fromJson(row.zone_results, []) : [];
  const visibleZoneResults = source === 'personal'
    ? storedZoneResults
    : redactPrivatePower(storedZoneResults);
  return {
    version: 1,
    id: row.id,
    trackId: row.track_id,
    trackName: row.track_name,
    ...(row.route_variant_id ? { routeVariantId: row.route_variant_id } : {}),
    ...(sprintDistanceFeet(storedSummary?.sprintDistanceFeet) != null
      && sprintAirSetting(storedSummary?.sprintAirSetting) != null ? {
        sprintDistanceFeet: sprintDistanceFeet(storedSummary.sprintDistanceFeet),
        sprintAirSetting: sprintAirSetting(storedSummary.sprintAirSetting),
      } : {}),
    riderName: row.rider_name,
    ...(storedSummary?.photoUrl ? { photoUrl: storedSummary.photoUrl } : {}),
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
    summary: visibleSummary,
    zoneResults: visibleZoneResults,
    points: fromJson(row.points, []),
  };
}

export async function saveGhostLap(ghost) {
  if (!ghost?.id || !ghost.trackId || !ghost.ownerKey || !ghost.riderName || !Number.isFinite(Number(ghost.finishTimeMs))) {
    return null;
  }

  const lapCount = safeLapCount(ghost.lapCount);
  const safeRouteKey = routeKey(
    ghost.routeVariantId,
    lapCount,
    ghost.sprintDistanceFeet,
    ghost.sprintAirSetting,
  );
  if (!pool) {
    const key = `${ghost.ownerKey}:${ghost.riderName.toLocaleLowerCase()}:${ghost.trackId}:${safeRouteKey}`;
    const next = {
      id: ghost.id,
      owner_key: ghost.ownerKey,
      owner_name: ghost.ownerName,
      rider_name: ghost.riderName,
      track_id: ghost.trackId,
      track_name: ghost.trackName,
      route_variant_id: ghost.routeVariantId ?? null,
      route_key: safeRouteKey,
      finish_time_ms: Math.round(Number(ghost.finishTimeMs)),
      thirty_foot_time_ms: ghost.thirtyFootTimeMs == null ? null : Math.round(Number(ghost.thirtyFootTimeMs)),
      color_name: ghost.colorName,
      accent: ghost.accent,
      race_source: ghost.raceSource,
      lap_count: lapCount,
      analytics_public: Boolean(ghost.analyticsPublic),
      summary: {
        ...(ghost.summary && typeof ghost.summary === 'object' ? cloneJson(ghost.summary, {}) : {}),
        ...(ghost.photoUrl ? { photoUrl: ghost.photoUrl } : {}),
        ...(sprintDistanceFeet(ghost.sprintDistanceFeet) != null
          && sprintAirSetting(ghost.sprintAirSetting) != null ? {
            sprintDistanceFeet: sprintDistanceFeet(ghost.sprintDistanceFeet),
            sprintAirSetting: sprintAirSetting(ghost.sprintAirSetting),
          } : {}),
      },
      zone_results: cloneJson(ghost.zoneResults ?? [], []),
      points: cloneJson(ghost.points ?? [], []),
      saved_at: new Date(Math.round(Number(ghost.savedAt) || Date.now())).toISOString(),
    };
    const current = memoryGhostLaps.get(key);
    let changed = false;
    if (
      !current
      || next.finish_time_ms < current.finish_time_ms
      || (next.finish_time_ms === current.finish_time_ms
        && Date.parse(next.saved_at) > Date.parse(current.saved_at))
    ) {
      memoryGhostLaps.set(key, next);
      changed = true;
    }
    return changed ? cloneJson(next, null) : null;
  }
  const result = await query(
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
      json({
        ...(ghost.summary && typeof ghost.summary === 'object' ? ghost.summary : {}),
        ...(ghost.photoUrl ? { photoUrl: ghost.photoUrl } : {}),
        ...(sprintDistanceFeet(ghost.sprintDistanceFeet) != null
          && sprintAirSetting(ghost.sprintAirSetting) != null ? {
            sprintDistanceFeet: sprintDistanceFeet(ghost.sprintDistanceFeet),
            sprintAirSetting: sprintAirSetting(ghost.sprintAirSetting),
          } : {}),
      }),
      json(ghost.zoneResults ?? []),
      json(ghost.points),
      Math.round(Number(ghost.savedAt) || Date.now()),
    ],
  );
  return result?.rows?.[0] ?? null;
}

export async function loadGhostLaps(
  trackId,
  profileKey = '',
  friendKeys = [],
  limit = 30,
  sprintConfiguration = null,
  personalProfileKeys = [],
  focusedFriendGhost = null,
) {
  const safeLimit = Math.max(1, Math.min(60, Math.round(Number(limit) || 30)));
  const friendLimit = 50;
  const personalLimit = 30;
  const requestedSprintRouteSuffix = sprintConfiguration
    ? `%:sprint:${sprintDistanceFeet(sprintConfiguration.distanceFeet)}ft:air:${sprintAirSetting(sprintConfiguration.airSetting)}`
    : null;
  const personalKeys = [...new Set([
    profileKey,
    ...(Array.isArray(personalProfileKeys) ? personalProfileKeys : []),
  ].map((value) => String(value || '').trim()).filter(Boolean))].slice(0, 8);
  const personal = new Set(personalKeys);
  const authorizedFriends = new Set((Array.isArray(friendKeys) ? friendKeys : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean));
  const focusedGhostId = String(focusedFriendGhost?.ghostId || '').trim().slice(0, 180);
  const focusedFriendId = String(focusedFriendGhost?.profileId || '').trim().slice(0, 180);
  const focusedOwnerKey = focusedFriendId ? `user:${focusedFriendId}` : '';
  const focusMatches = (row) => Boolean(
    focusedGhostId
    && row.id === focusedGhostId
    && (!focusedOwnerKey || row.owner_key === focusedOwnerKey),
  );

  let globalRows = [];
  let friendRows = [];
  let personalRows = [];
  if (!pool) {
    const allRows = [...memoryGhostLaps.values()]
      .filter((row) => (
        row.track_id === trackId
        && row.race_source === 'live'
        && (!requestedSprintRouteSuffix
          || row.route_key.endsWith(requestedSprintRouteSuffix.slice(1)))
      ))
      .sort((left, right) => (
        left.finish_time_ms - right.finish_time_ms
        || Date.parse(right.saved_at) - Date.parse(left.saved_at)
        || String(left.id).localeCompare(String(right.id))
      ));
    const rankByRouteAndTime = new Map();
    for (const row of allRows) {
      const routeRanks = rankByRouteAndTime.get(row.route_key) ?? new Map();
      if (!routeRanks.has(row.finish_time_ms)) routeRanks.set(row.finish_time_ms, routeRanks.size + 1);
      rankByRouteAndTime.set(row.route_key, routeRanks);
      row.medal_rank = routeRanks.get(row.finish_time_ms);
    }
    globalRows = allRows.slice(0, safeLimit);
    friendRows = allRows
      .filter((row) => authorizedFriends.has(row.owner_key))
      .sort((left, right) => (
        Number(focusMatches(right)) - Number(focusMatches(left))
        || left.finish_time_ms - right.finish_time_ms
        || Date.parse(right.saved_at) - Date.parse(left.saved_at)
      ))
      .slice(0, friendLimit);
    personalRows = allRows.filter((row) => personal.has(row.owner_key)).slice(0, personalLimit);
  } else {
    const accountUserId = profileKey.startsWith('user:') ? profileKey.slice(5) : '';
    const [globalResult, friendResult, personalResult] = await Promise.all([
      query(
        `SELECT ranked.*
         FROM (
           SELECT ghost_laps.*,
             DENSE_RANK() OVER (PARTITION BY route_key ORDER BY finish_time_ms ASC) AS medal_rank
           FROM ${schema}.ghost_laps AS ghost_laps
           WHERE track_id = $1 AND race_source = 'live'
             AND ($3::text IS NULL OR route_key LIKE $3)
         ) AS ranked
         ORDER BY finish_time_ms ASC, saved_at DESC, id
         LIMIT $2`,
        [trackId, safeLimit, requestedSprintRouteSuffix],
      ),
      profileKey ? query(
        `WITH explicit_friend_keys AS (
           SELECT 'user:' || CASE
             WHEN friendship.user_id_a = $2 THEN friendship.user_id_b
             ELSE friendship.user_id_a
           END AS friend_key
           FROM ${schema}.account_friendships AS friendship
           WHERE $2::text <> ''
             AND friendship.source <> 'official'
             AND (friendship.user_id_a = $2 OR friendship.user_id_b = $2)

           UNION

           SELECT CASE
             WHEN legacy.guest_key_a = $3 THEN legacy.guest_key_b
             ELSE legacy.guest_key_a
           END AS friend_key
           FROM ${schema}.friendships AS legacy
           WHERE (legacy.guest_key_a = $3 OR legacy.guest_key_b = $3)
             AND NOT EXISTS (
               SELECT 1 FROM ${schema}.official_friend_accounts AS official
               WHERE ('user:' || official.user_id) IN (legacy.guest_key_a, legacy.guest_key_b)
             )
         )
         SELECT ghost_laps.*, NULL::integer AS medal_rank
         FROM ${schema}.ghost_laps AS ghost_laps
         JOIN explicit_friend_keys AS friend ON friend.friend_key = ghost_laps.owner_key
         WHERE ghost_laps.track_id = $1 AND ghost_laps.race_source = 'live'
           AND ($4::text IS NULL OR ghost_laps.route_key LIKE $4)
         ORDER BY
           CASE WHEN ghost_laps.id = $5::text
             AND ($6::text = '' OR ghost_laps.owner_key = $6::text) THEN 0 ELSE 1 END,
           ghost_laps.finish_time_ms ASC,
           ghost_laps.saved_at DESC,
           ghost_laps.id
         LIMIT $7`,
        [
          trackId,
          accountUserId,
          profileKey,
          requestedSprintRouteSuffix,
          focusedGhostId,
          focusedOwnerKey,
          friendLimit,
        ],
      ) : Promise.resolve(null),
      personalKeys.length > 0 ? query(
        `SELECT ghost_laps.*, NULL::integer AS medal_rank
         FROM ${schema}.ghost_laps AS ghost_laps
         WHERE ghost_laps.track_id = $1 AND ghost_laps.race_source = 'live'
           AND ghost_laps.owner_key = ANY($2::text[])
           AND ($3::text IS NULL OR ghost_laps.route_key LIKE $3)
         ORDER BY ghost_laps.finish_time_ms ASC, ghost_laps.saved_at DESC, ghost_laps.id
         LIMIT $4`,
        [trackId, personalKeys, requestedSprintRouteSuffix, personalLimit],
      ) : Promise.resolve(null),
    ]);
    globalRows = globalResult?.rows ?? [];
    friendRows = friendResult?.rows ?? [];
    personalRows = personalResult?.rows ?? [];
    for (const row of friendRows) authorizedFriends.add(row.owner_key);
  }

  const rowsById = new Map();
  for (const row of [...globalRows, ...friendRows, ...personalRows]) {
    if (!rowsById.has(row.id)) rowsById.set(row.id, row);
  }
  const rows = [...rowsById.values()].sort((left, right) => (
    left.finish_time_ms - right.finish_time_ms
    || Date.parse(right.saved_at) - Date.parse(left.saved_at)
    || String(left.id).localeCompare(String(right.id))
  ));
  return rows.map((row) => {
    const source = personal.has(row.owner_key)
      ? 'personal'
      : authorizedFriends.has(row.owner_key)
        ? 'friend'
        : 'top';
    const includeAnalytics = personal.has(row.owner_key) || Boolean(row.analytics_public);
    return ghostFromRow(row, source, includeAnalytics);
  });
}

export async function loadPersonalGhostLaps(
  trackId,
  profileKeys = [],
  limit = 30,
  sprintConfiguration = null,
) {
  const personalKeys = [...new Set((Array.isArray(profileKeys) ? profileKeys : [profileKeys])
    .map((value) => String(value || '').trim())
    .filter(Boolean))]
    .slice(0, 8);
  if (!trackId || personalKeys.length === 0) return [];

  const safeLimit = Math.max(1, Math.min(60, Math.round(Number(limit) || 30)));
  const requestedSprintRouteSuffix = sprintConfiguration
    ? `%:sprint:${sprintDistanceFeet(sprintConfiguration.distanceFeet)}ft:air:${sprintAirSetting(sprintConfiguration.airSetting)}`
    : null;
  const result = !pool ? null : await query(
    `SELECT ranked.*
     FROM (
       SELECT ghost_laps.*,
         DENSE_RANK() OVER (PARTITION BY route_key ORDER BY finish_time_ms ASC) AS medal_rank
       FROM ${schema}.ghost_laps AS ghost_laps
       WHERE track_id = $1 AND race_source = 'live'
         AND ($3::text IS NULL OR route_key LIKE $3)
     ) AS ranked
     WHERE owner_key = ANY($2::text[])
     ORDER BY finish_time_ms ASC, saved_at DESC
     LIMIT $4`,
    [trackId, personalKeys, requestedSprintRouteSuffix, safeLimit],
  );

  let rows;
  if (!pool) {
    const allRows = [...memoryGhostLaps.values()]
      .filter((row) => (
        row.track_id === trackId
        && row.race_source === 'live'
        && (!requestedSprintRouteSuffix
          || row.route_key.endsWith(requestedSprintRouteSuffix.slice(1)))
      ))
      .sort((left, right) => (
        left.finish_time_ms - right.finish_time_ms
        || Date.parse(right.saved_at) - Date.parse(left.saved_at)
      ));
    const rankByRouteAndTime = new Map();
    for (const row of allRows) {
      const routeRanks = rankByRouteAndTime.get(row.route_key) ?? new Map();
      if (!routeRanks.has(row.finish_time_ms)) routeRanks.set(row.finish_time_ms, routeRanks.size + 1);
      rankByRouteAndTime.set(row.route_key, routeRanks);
      row.medal_rank = routeRanks.get(row.finish_time_ms);
    }
    const selected = new Set(personalKeys);
    rows = allRows.filter((row) => selected.has(row.owner_key)).slice(0, safeLimit);
  } else {
    rows = result?.rows ?? [];
  }
  return rows.map((row) => ghostFromRow(row, 'personal', true));
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
