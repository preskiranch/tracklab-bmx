import pg from 'pg';
import { runDatabaseMigrations } from './migrations.mjs';
import { cloudTelemetry } from './telemetry.mjs';

const { Pool } = pg;

const schema = 'tracklab';
const maxBillingBikeSeats = 1000;
// A completion credential can finish uploading a session for one day after the
// reservation lease expires. This does not reactivate seats or permit a new
// start: every assignment must already have been activated, and every result
// clock must end no later than the original immutable expiry.
export const clubGroupTrainingCompletionGraceMs = 24 * 60 * 60 * 1000;
export const heartRateWatchConnectDurationMs = 4 * 60 * 60 * 1000;
export const heartRateWatchConnectDrainMs = 24 * 60 * 60 * 1000;
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
const memoryHeartRateStudioInvitations = new Map();
const memoryHeartRateStudioInvitationIdByCodeHash = new Map();
const memoryHeartRatePairings = new Map();
const memoryHeartRatePairingIdByCodeHash = new Map();
const memoryHeartRatePairingIdByTokenHash = new Map();
const memoryHeartRateStreams = new Map();
const memoryHeartRateStreamIdByPairingId = new Map();
const memoryHeartRateSamplesByStreamId = new Map();
const memoryHeartRateTrainingSegments = new Map();
const memoryHeartRateTrainingSegmentBindings = new Map();
const memoryHeartRateWatchEnrollments = new Map();
const memoryHeartRateWatchConnections = new Map();
const memoryRecoveryAlertPreferences = new Map();
const memoryRecoveryAlertEpisodes = new Map();
const memoryClubMonitorSprintAuthorizations = new Map();
const memoryClubMonitorSprintAuthorizationIdByTokenHash = new Map();
const memoryClubGroupTrainingAuthorizations = new Map();
const memoryClubGroupTrainingAuthorizationIdByTokenHash = new Map();
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
  accountFriendsPageStatement,
  accountFriendRequestsPageStatement,
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
    cloudTelemetry.warn('persistence.transaction_failed', { error });
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
    studioInvitationId: row.studio_invitation_id ?? null,
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
    return true;
  }

  const result = await query(
    `INSERT INTO ${schema}.auth_sessions (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (token_hash) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       expires_at = EXCLUDED.expires_at,
       last_seen = now()`,
    [session.id, session.userId, session.tokenHash, session.expiresAt],
  );
  return Boolean(result);
}

export async function findAuthSession(tokenHash) {
  cloudTelemetry.increment('tracklab_auth_session_lookups_total', {
    backend: pool ? 'postgres' : 'memory',
  });
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
    await linkHeartRateStreamsToTrainingSession(profileKey, session.id);
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
  await linkHeartRateStreamsToTrainingSession(profileKey, session.id);
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

function heartRateStudioInvitationFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    clubId: row.club_id,
    studioRiderId: row.studio_rider_id,
    ownerProfileKey: row.owner_profile_key,
    athleteProfileKey: row.athlete_profile_key,
    sessionId: row.session_id,
    activityType: row.activity_type,
    relayScope: row.relay_scope || 'session',
    playerId: row.player_id == null ? null : Number(row.player_id),
    expiresAt: new Date(row.expires_at).getTime(),
    claimedAt: row.claimed_at ? new Date(row.claimed_at).getTime() : null,
    claimedByProfileKey: row.claimed_by_profile_key ?? null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at).getTime() : null,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

function publicMemoryHeartRateStudioInvitation(invitation) {
  if (!invitation) return null;
  const { inviteCodeHash: _inviteCodeHash, ...publicInvitation } = invitation;
  return cloneJson(publicInvitation, publicInvitation);
}

export async function createHeartRateStudioInvitation(invitation) {
  const now = Number(invitation.createdAt) || Date.now();
  if (!pool) {
    if (
      memoryHeartRateStudioInvitations.has(invitation.id)
      || memoryHeartRateStudioInvitationIdByCodeHash.has(invitation.inviteCodeHash)
    ) return null;
    const stored = {
      ...cloneJson(invitation, invitation),
      inviteCodeHash: invitation.inviteCodeHash,
      claimedAt: null,
      claimedByProfileKey: null,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    memoryHeartRateStudioInvitations.set(stored.id, stored);
    memoryHeartRateStudioInvitationIdByCodeHash.set(stored.inviteCodeHash, stored.id);
    return publicMemoryHeartRateStudioInvitation(stored);
  }
  const result = await query(
    `INSERT INTO ${schema}.heart_rate_studio_invitations (
       id, club_id, studio_rider_id, owner_profile_key, athlete_profile_key,
       session_id, activity_type, relay_scope, player_id, invite_code_hash, expires_at,
       created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, to_timestamp($11 / 1000.0),
       to_timestamp($12 / 1000.0), to_timestamp($12 / 1000.0)
     )
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [
      invitation.id,
      invitation.clubId,
      invitation.studioRiderId,
      invitation.ownerProfileKey,
      invitation.athleteProfileKey,
      invitation.sessionId,
      invitation.activityType,
      invitation.relayScope || 'session',
      invitation.playerId ?? null,
      invitation.inviteCodeHash,
      invitation.expiresAt,
      now,
    ],
  );
  return heartRateStudioInvitationFromRow(result?.rows?.[0]);
}

export async function loadHeartRateStudioInvitations(ownerProfileKey) {
  if (!pool) {
    return [...memoryHeartRateStudioInvitations.values()]
      .filter((invitation) => invitation.ownerProfileKey === ownerProfileKey)
      .sort((left, right) => right.createdAt - left.createdAt)
      .map(publicMemoryHeartRateStudioInvitation);
  }
  const result = await query(
    `SELECT * FROM ${schema}.heart_rate_studio_invitations
     WHERE owner_profile_key = $1
     ORDER BY created_at DESC, id DESC
     LIMIT 500`,
    [ownerProfileKey],
  );
  return (result?.rows ?? []).map(heartRateStudioInvitationFromRow).filter(Boolean);
}

export async function previewHeartRateStudioInvitation(
  inviteCodeHash,
  athleteProfileKey,
  now = Date.now(),
) {
  if (!pool) {
    const invitationId = memoryHeartRateStudioInvitationIdByCodeHash.get(inviteCodeHash);
    const invitation = invitationId ? memoryHeartRateStudioInvitations.get(invitationId) : null;
    const club = invitation ? memoryClubsById.get(invitation.clubId) : null;
    const member = invitation
      ? memoryClubMembers.get(clubMemberKey(invitation.clubId, invitation.studioRiderId))
      : null;
    if (
      !invitation
      || invitation.athleteProfileKey !== athleteProfileKey
      || invitation.claimedAt != null
      || invitation.revokedAt != null
      || invitation.expiresAt <= now
      || !club
      || club.ownerProfileKey !== invitation.ownerProfileKey
      || member?.status !== 'claimed'
      || member.athleteProfileKey !== athleteProfileKey
    ) return null;
    return {
      clubName: club.name,
      riderName: member.riderName,
      sessionId: invitation.sessionId,
      activityType: invitation.activityType,
      relayScope: invitation.relayScope || 'session',
      playerId: invitation.playerId,
      expiresAt: invitation.expiresAt,
    };
  }
  const result = await query(
    `SELECT clubs.name AS club_name, members.rider_name,
       invitations.session_id, invitations.activity_type, invitations.relay_scope,
       invitations.player_id,
       invitations.expires_at
     FROM ${schema}.heart_rate_studio_invitations AS invitations
     JOIN ${schema}.clubs AS clubs
       ON clubs.id = invitations.club_id
       AND clubs.owner_profile_key = invitations.owner_profile_key
     JOIN ${schema}.club_members AS members
       ON members.club_id = invitations.club_id
       AND members.studio_rider_id = invitations.studio_rider_id
     WHERE invitations.invite_code_hash = $1
       AND invitations.athlete_profile_key = $2
       AND invitations.claimed_at IS NULL
       AND invitations.revoked_at IS NULL
       AND invitations.expires_at > to_timestamp($3 / 1000.0)
       AND members.status = 'claimed'
       AND members.athlete_profile_key = $2
     LIMIT 1`,
    [inviteCodeHash, athleteProfileKey, now],
  );
  const row = result?.rows?.[0];
  return row ? {
    clubName: row.club_name,
    riderName: row.rider_name,
    sessionId: row.session_id,
    activityType: row.activity_type,
    relayScope: row.relay_scope || 'session',
    playerId: row.player_id == null ? null : Number(row.player_id),
    expiresAt: new Date(row.expires_at).getTime(),
  } : null;
}

export async function revokeHeartRateStudioInvitation(ownerProfileKey, invitationId, revokedAt = Date.now()) {
  if (!pool) {
    const invitation = memoryHeartRateStudioInvitations.get(invitationId);
    if (!invitation || invitation.ownerProfileKey !== ownerProfileKey || invitation.claimedAt != null) return null;
    invitation.revokedAt = invitation.revokedAt ?? revokedAt;
    invitation.updatedAt = revokedAt;
    return publicMemoryHeartRateStudioInvitation(invitation);
  }
  const result = await query(
    `UPDATE ${schema}.heart_rate_studio_invitations
     SET revoked_at = COALESCE(revoked_at, to_timestamp($3 / 1000.0)), updated_at = now()
     WHERE id = $1 AND owner_profile_key = $2 AND claimed_at IS NULL
     RETURNING *`,
    [invitationId, ownerProfileKey, revokedAt],
  );
  return heartRateStudioInvitationFromRow(result?.rows?.[0]);
}

function heartRateStudioBlockState({ invitation, pairing, stream, lastSampleReceivedAt }, now) {
  if (invitation.revokedAt != null || pairing?.studioBlockStoppedAt != null) return 'stopped';
  if (invitation.claimedAt == null) return invitation.expiresAt <= now ? 'expired' : 'waiting-athlete';
  if (!pairing || pairing.claimedAt == null) {
    return pairing && pairing.pairCodeExpiresAt <= now ? 'expired' : 'waiting-watch';
  }
  if (stream?.finalizedAt != null) return 'ended';
  if ((pairing.ingestExpiresAt ?? 0) <= now) return 'expired';
  return stream && (lastSampleReceivedAt ?? 0) >= now - 15_000
    ? 'watch-ready'
    : 'waiting-watch';
}

function memoryHeartRateStudioBlockStatus(invitation, now = Date.now()) {
  const pairing = [...memoryHeartRatePairings.values()].find((candidate) => (
    candidate.studioInvitationId === invitation.id
  )) ?? null;
  const streamId = pairing ? memoryHeartRateStreamIdByPairingId.get(pairing.id) : null;
  const stream = streamId ? memoryHeartRateStreams.get(streamId) : null;
  const samples = streamId ? [...(memoryHeartRateSamplesByStreamId.get(streamId)?.values() ?? [])] : [];
  const latestSample = samples.sort((left, right) => right.sequence - left.sequence)[0] ?? null;
  const lastSampleReceivedAt = latestSample ? stream?.updatedAt ?? null : null;
  return {
    invitationId: invitation.id,
    clubId: invitation.clubId,
    studioRiderId: invitation.studioRiderId,
    anchorSessionId: invitation.sessionId,
    activityType: invitation.activityType,
    relayScope: 'studio-block',
    playerId: invitation.playerId,
    state: heartRateStudioBlockState({ invitation, pairing, stream, lastSampleReceivedAt }, now),
    invitationExpiresAt: invitation.expiresAt,
    pairCodeExpiresAt: pairing?.pairCodeExpiresAt ?? null,
    blockExpiresAt: pairing?.ingestExpiresAt ?? null,
    streamStartedAt: stream?.startedAt ?? null,
    lastSampleAt: latestSample?.recordedAt ?? null,
    lastSampleReceivedAt,
  };
}

function heartRateStudioBlockStatusFromRow(row, now = Date.now()) {
  const invitation = heartRateStudioInvitationFromRow(row);
  const pairing = row.pairing_id ? heartRatePairingFromRow({
    id: row.pairing_id,
    owner_profile_key: row.pairing_owner_profile_key,
    session_id: row.pairing_session_id,
    activity_type: row.pairing_activity_type,
    relay_scope: row.pairing_relay_scope,
    rider_id: row.pairing_rider_id,
    player_id: row.pairing_player_id,
    club_id: row.pairing_club_id,
    studio_rider_id: row.pairing_studio_rider_id,
    pair_code_expires_at: row.pair_code_expires_at,
    ingest_expires_at: row.ingest_expires_at,
    claimed_at: row.pairing_claimed_at,
    revoked_at: row.pairing_revoked_at,
    live_studio_consent: row.pairing_live_studio_consent,
    session_studio_consent: row.pairing_session_studio_consent,
    studio_block_stopped_at: row.pairing_studio_block_stopped_at,
    created_at: row.pairing_created_at,
    updated_at: row.pairing_updated_at,
  }) : null;
  const stream = row.stream_id ? {
    id: row.stream_id,
    startedAt: row.stream_started_at ? new Date(row.stream_started_at).getTime() : null,
    finalizedAt: row.stream_finalized_at ? new Date(row.stream_finalized_at).getTime() : null,
  } : null;
  const lastSampleReceivedAt = row.last_sample_received_at
    ? new Date(row.last_sample_received_at).getTime()
    : null;
  return {
    invitationId: invitation.id,
    clubId: invitation.clubId,
    studioRiderId: invitation.studioRiderId,
    anchorSessionId: invitation.sessionId,
    activityType: invitation.activityType,
    relayScope: 'studio-block',
    playerId: invitation.playerId,
    state: heartRateStudioBlockState({ invitation, pairing, stream, lastSampleReceivedAt }, now),
    invitationExpiresAt: invitation.expiresAt,
    pairCodeExpiresAt: pairing?.pairCodeExpiresAt ?? null,
    blockExpiresAt: pairing?.ingestExpiresAt ?? null,
    streamStartedAt: stream?.startedAt ?? null,
    lastSampleAt: row.last_sample_recorded_at
      ? new Date(row.last_sample_recorded_at).getTime()
      : null,
    lastSampleReceivedAt,
  };
}

export async function loadHeartRateStudioBlockStatuses(ownerProfileKey, clubId, now = Date.now()) {
  if (!pool) {
    return [...memoryHeartRateStudioInvitations.values()]
      .filter((invitation) => (
        invitation.ownerProfileKey === ownerProfileKey
        && invitation.clubId === clubId
        && invitation.relayScope === 'studio-block'
        && ![...memoryHeartRateWatchConnections.values()].some((connection) => {
          const pairing = memoryHeartRatePairings.get(connection.pairingId);
          return pairing?.studioInvitationId === invitation.id;
        })
      ))
      .sort((left, right) => right.createdAt - left.createdAt)
      .map((invitation) => memoryHeartRateStudioBlockStatus(invitation, now));
  }
  const result = await query(
    `SELECT invitations.*,
       pairings.id AS pairing_id,
       pairings.owner_profile_key AS pairing_owner_profile_key,
       pairings.session_id AS pairing_session_id,
       pairings.activity_type AS pairing_activity_type,
       pairings.relay_scope AS pairing_relay_scope,
       pairings.rider_id AS pairing_rider_id,
       pairings.player_id AS pairing_player_id,
       pairings.club_id AS pairing_club_id,
       pairings.studio_rider_id AS pairing_studio_rider_id,
       pairings.pair_code_expires_at,
       pairings.ingest_expires_at,
       pairings.claimed_at AS pairing_claimed_at,
       pairings.revoked_at AS pairing_revoked_at,
       pairings.live_studio_consent AS pairing_live_studio_consent,
       pairings.session_studio_consent AS pairing_session_studio_consent,
       pairings.studio_block_stopped_at AS pairing_studio_block_stopped_at,
       pairings.created_at AS pairing_created_at,
       pairings.updated_at AS pairing_updated_at,
       streams.id AS stream_id,
       streams.started_at AS stream_started_at,
       streams.finalized_at AS stream_finalized_at,
       latest.recorded_at AS last_sample_recorded_at,
       latest.received_at AS last_sample_received_at
     FROM ${schema}.heart_rate_studio_invitations AS invitations
     LEFT JOIN ${schema}.heart_rate_pairings AS pairings
       ON pairings.studio_invitation_id = invitations.id
     LEFT JOIN ${schema}.heart_rate_streams AS streams ON streams.pairing_id = pairings.id
     LEFT JOIN LATERAL (
       SELECT samples.recorded_at, samples.received_at
       FROM ${schema}.heart_rate_samples AS samples
       WHERE samples.stream_id = streams.id
       ORDER BY samples.sequence DESC
       LIMIT 1
     ) AS latest ON true
     WHERE invitations.owner_profile_key = $1
       AND invitations.club_id = $2
       AND invitations.relay_scope = 'studio-block'
       AND NOT EXISTS (
         SELECT 1
         FROM ${schema}.heart_rate_pairings AS watch_pairings
         JOIN ${schema}.heart_rate_watch_connections AS watch_connections
           ON watch_connections.pairing_id = watch_pairings.id
         WHERE watch_pairings.studio_invitation_id = invitations.id
       )
     ORDER BY invitations.created_at DESC, invitations.id DESC
     LIMIT 500`,
    [ownerProfileKey, clubId],
  );
  return (result?.rows ?? []).map((row) => heartRateStudioBlockStatusFromRow(row, now));
}

export async function stopHeartRateStudioBlock(
  ownerProfileKey,
  invitationId,
  stoppedAt = Date.now(),
) {
  if (!pool) {
    const invitation = memoryHeartRateStudioInvitations.get(invitationId);
    if (
      !invitation
      || invitation.ownerProfileKey !== ownerProfileKey
      || invitation.relayScope !== 'studio-block'
    ) return null;
    const watchMappedPairing = [...memoryHeartRatePairings.values()].find((pairing) => (
      pairing.studioInvitationId === invitation.id
      && [...memoryHeartRateWatchConnections.values()].some((connection) => (
        connection.pairingId === pairing.id
      ))
    ));
    if (watchMappedPairing) return null;
    invitation.revokedAt = invitation.revokedAt ?? stoppedAt;
    invitation.updatedAt = stoppedAt;
    const pairing = [...memoryHeartRatePairings.values()].find((candidate) => (
      candidate.studioInvitationId === invitation.id
    ));
    if (pairing) {
      pairing.studioBlockStoppedAt = pairing.studioBlockStoppedAt ?? stoppedAt;
      pairing.studioBlockStoppedByProfileKey = ownerProfileKey;
      pairing.liveStudioConsent = false;
      pairing.sessionStudioConsent = false;
      pairing.updatedAt = stoppedAt;
      const streamId = memoryHeartRateStreamIdByPairingId.get(pairing.id);
      const stream = streamId ? memoryHeartRateStreams.get(streamId) : null;
      if (stream) {
        stream.studioBlockStoppedAt = stream.studioBlockStoppedAt ?? stoppedAt;
        stream.liveStudioConsent = false;
        stream.sessionStudioConsent = false;
        stream.updatedAt = stoppedAt;
      }
      memoryHeartRateTrainingSegments.forEach((segment) => {
        if (segment.pairingId === pairing.id) {
          segment.studioVisible = false;
          segment.updatedAt = stoppedAt;
        }
      });
    }
    return memoryHeartRateStudioBlockStatus(invitation, stoppedAt);
  }
  return withPersistenceLock(`heart-rate-studio-block-stop:${invitationId}`, async (client) => {
    const invitationResult = await client.query(
      `SELECT invitations.* FROM ${schema}.heart_rate_studio_invitations AS invitations
       WHERE invitations.id = $1 AND invitations.owner_profile_key = $2
         AND invitations.relay_scope = 'studio-block'
         AND NOT EXISTS (
           SELECT 1
           FROM ${schema}.heart_rate_pairings AS watch_pairings
           JOIN ${schema}.heart_rate_watch_connections AS watch_connections
             ON watch_connections.pairing_id = watch_pairings.id
           WHERE watch_pairings.studio_invitation_id = invitations.id
         )
       FOR UPDATE`,
      [invitationId, ownerProfileKey],
    );
    const invitation = invitationResult.rows[0];
    if (!invitation) return null;
    await client.query(
      `UPDATE ${schema}.heart_rate_studio_invitations
       SET revoked_at = COALESCE(revoked_at, to_timestamp($2 / 1000.0)), updated_at = now()
       WHERE id = $1`,
      [invitationId, stoppedAt],
    );
    const pairingResult = await client.query(
      `UPDATE ${schema}.heart_rate_pairings
       SET studio_block_stopped_at = COALESCE(
           studio_block_stopped_at,
           to_timestamp($3 / 1000.0)
         ),
         studio_block_stopped_by_profile_key = $2,
         live_studio_consent = false,
         session_studio_consent = false,
         updated_at = now()
       WHERE studio_invitation_id = $1 AND relay_scope = 'studio-block'
       RETURNING id`,
      [invitationId, ownerProfileKey, stoppedAt],
    );
    const pairingId = pairingResult.rows[0]?.id;
    if (pairingId) {
      await client.query(
        `UPDATE ${schema}.heart_rate_streams
         SET studio_block_stopped_at = COALESCE(
             studio_block_stopped_at,
             to_timestamp($2 / 1000.0)
           ),
           live_studio_consent = false,
           session_studio_consent = false,
           updated_at = now()
         WHERE pairing_id = $1`,
        [pairingId, stoppedAt],
      );
      await client.query(
        `UPDATE ${schema}.heart_rate_training_segments
         SET studio_visible = false, updated_at = now()
         WHERE pairing_id = $1`,
        [pairingId],
      );
    }
    return {
      invitationId,
      clubId: invitation.club_id,
      studioRiderId: invitation.studio_rider_id,
      anchorSessionId: invitation.session_id,
      activityType: invitation.activity_type,
      relayScope: 'studio-block',
      playerId: invitation.player_id == null ? null : Number(invitation.player_id),
      state: 'stopped',
      invitationExpiresAt: new Date(invitation.expires_at).getTime(),
      pairCodeExpiresAt: null,
      blockExpiresAt: null,
      streamStartedAt: null,
      lastSampleAt: null,
      lastSampleReceivedAt: null,
    };
  });
}

export async function claimHeartRateStudioInvitationAndCreatePairing(
  inviteCodeHash,
  athleteProfileKey,
  pairing,
  now = Date.now(),
) {
  if (!pool) {
    const invitationId = memoryHeartRateStudioInvitationIdByCodeHash.get(inviteCodeHash);
    const invitation = invitationId ? memoryHeartRateStudioInvitations.get(invitationId) : null;
    const member = invitation
      ? memoryClubMembers.get(clubMemberKey(invitation.clubId, invitation.studioRiderId))
      : null;
    if (
      !invitation
      || invitation.athleteProfileKey !== athleteProfileKey
      || member?.status !== 'claimed'
      || member?.athleteProfileKey !== athleteProfileKey
      || invitation.claimedAt != null
      || invitation.revokedAt != null
      || invitation.expiresAt <= now
      || memoryHeartRatePairings.has(pairing.id)
      || memoryHeartRatePairingIdByCodeHash.has(pairing.pairCodeHash)
    ) return null;
    invitation.claimedAt = now;
    invitation.claimedByProfileKey = athleteProfileKey;
    invitation.updatedAt = now;
    const storedPairing = {
      ...cloneJson(pairing, pairing),
      studioInvitationId: invitation.id,
      ownerProfileKey: athleteProfileKey,
      sessionId: invitation.sessionId,
      activityType: invitation.activityType,
      relayScope: invitation.relayScope || 'session',
      playerId: invitation.playerId,
      clubId: invitation.clubId,
      studioRiderId: invitation.studioRiderId,
      pairCodeHash: pairing.pairCodeHash,
      ingestTokenHash: null,
      ingestExpiresAt: null,
      claimedAt: null,
      revokedAt: null,
      studioBlockStoppedAt: null,
      accountBlockStopRequestedAt: null,
      accountBlockDrainExpiresAt: null,
      createdAt: now,
      updatedAt: now,
    };
    memoryHeartRatePairings.set(storedPairing.id, storedPairing);
    memoryHeartRatePairingIdByCodeHash.set(storedPairing.pairCodeHash, storedPairing.id);
    return {
      invitation: publicMemoryHeartRateStudioInvitation(invitation),
      pairing: publicMemoryHeartRatePairing(storedPairing),
    };
  }
  return withPersistenceLock(`heart-rate-studio-invite:${inviteCodeHash}`, async (client) => {
    const invitationResult = await client.query(
      `SELECT invitations.*
       FROM ${schema}.heart_rate_studio_invitations AS invitations
       JOIN ${schema}.club_members AS members
         ON members.club_id = invitations.club_id
         AND members.studio_rider_id = invitations.studio_rider_id
       WHERE invitations.invite_code_hash = $1
         AND invitations.athlete_profile_key = $2
         AND members.athlete_profile_key = $2
         AND members.status = 'claimed'
         AND invitations.claimed_at IS NULL
         AND invitations.revoked_at IS NULL
         AND invitations.expires_at > to_timestamp($3 / 1000.0)
       FOR UPDATE`,
      [inviteCodeHash, athleteProfileKey, now],
    );
    const invitation = invitationResult.rows[0];
    if (!invitation) return null;
    const pairingResult = await client.query(
      `INSERT INTO ${schema}.heart_rate_pairings (
         id, studio_invitation_id, owner_profile_key, session_id, activity_type,
         relay_scope, rider_id, player_id, club_id, studio_rider_id, pair_code_hash,
         pair_code_expires_at, live_studio_consent, session_studio_consent,
         created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
         to_timestamp($12 / 1000.0), $13, $14,
         to_timestamp($15 / 1000.0), to_timestamp($15 / 1000.0)
       )
       RETURNING *`,
      [
        pairing.id,
        invitation.id,
        athleteProfileKey,
        invitation.session_id,
        invitation.activity_type,
        invitation.relay_scope || 'session',
        pairing.riderId,
        invitation.player_id,
        invitation.club_id,
        invitation.studio_rider_id,
        pairing.pairCodeHash,
        pairing.pairCodeExpiresAt,
        Boolean(pairing.liveStudioConsent),
        Boolean(pairing.sessionStudioConsent),
        now,
      ],
    );
    await client.query(
      `UPDATE ${schema}.heart_rate_studio_invitations
       SET claimed_at = to_timestamp($2 / 1000.0), claimed_by_profile_key = $3, updated_at = now()
       WHERE id = $1`,
      [invitation.id, now, athleteProfileKey],
    );
    return {
      invitation: heartRateStudioInvitationFromRow({
        ...invitation,
        claimed_at: new Date(now),
        claimed_by_profile_key: athleteProfileKey,
        updated_at: new Date(now),
      }),
      pairing: heartRatePairingFromRow(pairingResult.rows[0]),
    };
  });
}

function heartRatePairingFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerProfileKey: row.owner_profile_key,
    sessionId: row.session_id,
    activityType: row.activity_type,
    relayScope: row.relay_scope || 'session',
    studioBlockStoppedAt: row.studio_block_stopped_at
      ? new Date(row.studio_block_stopped_at).getTime()
      : null,
    accountBlockStopRequestedAt: row.account_block_stop_requested_at
      ? new Date(row.account_block_stop_requested_at).getTime()
      : null,
    accountBlockDrainExpiresAt: row.account_block_drain_expires_at
      ? new Date(row.account_block_drain_expires_at).getTime()
      : null,
    riderId: row.rider_id,
    playerId: row.player_id == null ? null : Number(row.player_id),
    clubId: row.club_id ?? null,
    studioRiderId: row.studio_rider_id ?? null,
    pairCodeExpiresAt: new Date(row.pair_code_expires_at).getTime(),
    ingestExpiresAt: row.ingest_expires_at ? new Date(row.ingest_expires_at).getTime() : null,
    claimedAt: row.claimed_at ? new Date(row.claimed_at).getTime() : null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at).getTime() : null,
    liveStudioConsent: Boolean(row.live_studio_consent),
    sessionStudioConsent: Boolean(row.session_studio_consent),
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

function publicMemoryHeartRatePairing(pairing) {
  if (!pairing) return null;
  const { pairCodeHash: _pairCodeHash, ingestTokenHash: _ingestTokenHash, ...publicPairing } = pairing;
  return cloneJson(publicPairing, publicPairing);
}

function heartRateStreamFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    pairingId: row.pairing_id,
    ownerProfileKey: row.owner_profile_key,
    sessionId: row.session_id,
    activityType: row.activity_type,
    relayScope: row.relay_scope || 'session',
    relayExpiresAt: row.relay_expires_at ? new Date(row.relay_expires_at).getTime() : null,
    studioBlockStoppedAt: row.studio_block_stopped_at
      ? new Date(row.studio_block_stopped_at).getTime()
      : null,
    accountBlockStopRequestedAt: row.account_block_stop_requested_at
      ? new Date(row.account_block_stop_requested_at).getTime()
      : null,
    accountBlockDrainExpiresAt: row.account_block_drain_expires_at
      ? new Date(row.account_block_drain_expires_at).getTime()
      : null,
    riderId: row.rider_id,
    playerId: row.player_id == null ? null : Number(row.player_id),
    clubId: row.club_id ?? null,
    studioRiderId: row.studio_rider_id ?? null,
    liveStudioConsent: Boolean(row.live_studio_consent),
    sessionStudioConsent: Boolean(row.session_studio_consent),
    source: row.source || 'apple-watch',
    startedAt: new Date(row.started_at).getTime(),
    endedAt: row.ended_at ? new Date(row.ended_at).getTime() : null,
    activeDurationMs: row.active_duration_ms == null ? null : Number(row.active_duration_ms),
    summary: fromJson(row.summary, {}),
    zoneSummaries: fromJson(row.zone_summaries, []),
    finalizedAt: row.finalized_at ? new Date(row.finalized_at).getTime() : null,
    trainingSessionId: row.training_session_id ?? null,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

function heartRateSampleFromRow(row) {
  if (!row) return null;
  return {
    sequence: Number(row.sequence),
    recordedAt: new Date(row.recorded_at).getTime(),
    activeElapsedMs: Number(row.active_elapsed_ms),
    bpm: Number(row.bpm),
  };
}

function heartRateTrainingSegmentFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    streamId: row.stream_id,
    pairingId: row.pairing_id,
    ownerProfileKey: row.owner_profile_key,
    relayScope: row.relay_scope || 'studio-block',
    clubId: row.club_id ?? null,
    studioRiderId: row.studio_rider_id ?? null,
    trainingSessionId: row.training_session_id,
    activityType: row.activity_type,
    playerId: row.player_id == null ? null : Number(row.player_id),
    startedAt: new Date(row.started_at).getTime(),
    endedAt: new Date(row.ended_at).getTime(),
    activeDurationMs: Number(row.active_duration_ms),
    activeClockSegments: fromJson(row.active_clock_segments, []),
    summary: fromJson(row.summary, {}),
    zoneSummaries: fromJson(row.zone_summaries, []),
    finalizedAt: row.finalized_at ? new Date(row.finalized_at).getTime() : null,
    studioVisible: Boolean(row.studio_visible),
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

function summarizeHeartRateElapsedSamples(samples, activeDurationMs) {
  const sorted = [...samples]
    .filter((sample) => sample.activeElapsedMs >= 0 && sample.activeElapsedMs <= activeDurationMs)
    .sort((left, right) => left.activeElapsedMs - right.activeElapsedMs || left.sequence - right.sequence);
  if (sorted.length === 0) {
    return {
      sampleCount: 0,
      coverageMs: 0,
      coveragePercent: 0,
      firstSampleElapsedMs: null,
      lastSampleElapsedMs: null,
      minimumBpm: null,
      averageBpm: null,
      peakBpm: null,
    };
  }
  let coverageMs = 0;
  let weightedBpmMs = 0;
  sorted.forEach((sample, index) => {
    const nextElapsed = index + 1 < sorted.length
      ? sorted[index + 1].activeElapsedMs
      : activeDurationMs;
    const covered = Math.max(
      0,
      Math.min(10_000, activeDurationMs - sample.activeElapsedMs, nextElapsed - sample.activeElapsedMs),
    );
    coverageMs += covered;
    weightedBpmMs += sample.bpm * covered;
  });
  const arithmeticAverage = sorted.reduce((total, sample) => total + sample.bpm, 0) / sorted.length;
  const average = coverageMs > 0 ? weightedBpmMs / coverageMs : arithmeticAverage;
  return {
    sampleCount: sorted.length,
    coverageMs,
    coveragePercent: activeDurationMs > 0
      ? Math.round(Math.min(100, (coverageMs / activeDurationMs) * 100) * 10) / 10
      : 0,
    firstSampleElapsedMs: sorted[0].activeElapsedMs,
    lastSampleElapsedMs: sorted[sorted.length - 1].activeElapsedMs,
    minimumBpm: Math.min(...sorted.map((sample) => sample.bpm)),
    averageBpm: Math.round(average * 10) / 10,
    peakBpm: Math.max(...sorted.map((sample) => sample.bpm)),
  };
}

function heartRateTrainingSegmentSummaries(
  samples,
  startedAt,
  endedAt,
  zoneWindows = [],
  activeClockSegments = [],
) {
  const clockSegments = activeClockSegments.length > 0
    ? activeClockSegments
    : [{ startedAt, endedAt, activeElapsedAtStartMs: 0 }];
  const activeDurationMs = clockSegments.reduce((duration, segment) => Math.max(
    duration,
    segment.activeElapsedAtStartMs + Math.max(0, segment.endedAt - segment.startedAt),
  ), 0);
  const elapsedSamples = samples.flatMap((sample) => {
    const segment = clockSegments.find((candidate) => (
      sample.recordedAt >= candidate.startedAt
      && (
        sample.recordedAt < candidate.endedAt
        || (candidate.endedAt === endedAt && sample.recordedAt === endedAt)
      )
    ));
    if (!segment) return [];
    return [{
      ...sample,
      activeElapsedMs: Math.max(0, Math.min(
        activeDurationMs,
        segment.activeElapsedAtStartMs + sample.recordedAt - segment.startedAt,
      )),
    }];
  });
  const zoneSummaries = zoneWindows.map((window) => {
    const durationMs = window.endElapsedMs - window.startElapsedMs;
    const zoneSamples = elapsedSamples
      .filter((sample) => (
        sample.activeElapsedMs >= window.startElapsedMs
        && sample.activeElapsedMs < window.endElapsedMs
      ))
      .map((sample) => ({
        ...sample,
        activeElapsedMs: sample.activeElapsedMs - window.startElapsedMs,
      }));
    return {
      ...window,
      ...summarizeHeartRateElapsedSamples(zoneSamples, durationMs),
    };
  });
  return {
    activeDurationMs,
    summary: summarizeHeartRateElapsedSamples(elapsedSamples, activeDurationMs),
    zoneSummaries,
  };
}

function publicMemoryHeartRateWatchEnrollment(enrollment) {
  if (!enrollment) return null;
  const { installIdHash: _installIdHash, ...visible } = enrollment;
  return cloneJson(visible, visible);
}

function heartRateWatchEnrollmentFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerProfileKey: row.owner_profile_key,
    scope: row.scope,
    clubId: row.club_id ?? null,
    studioRiderId: row.studio_rider_id ?? null,
    liveStudioConsent: Boolean(row.live_studio_consent),
    sessionStudioConsent: Boolean(row.session_studio_consent),
    lastVerifiedAt: new Date(row.last_verified_at).getTime(),
    revokedAt: row.revoked_at ? new Date(row.revoked_at).getTime() : null,
    revokedReason: row.revoked_reason ?? null,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

function publicMemoryHeartRateWatchConnection(connection, enrollment = null) {
  if (!connection) return null;
  const pairing = memoryHeartRatePairings.get(connection.pairingId);
  const streamId = memoryHeartRateStreamIdByPairingId.get(connection.pairingId);
  const stream = streamId ? memoryHeartRateStreams.get(streamId) : null;
  return cloneJson({
    ...connection,
    pairingMissing: !pairing,
    pairingRevokedAt: pairing?.revokedAt ?? null,
    liveStudioConsent: Boolean(enrollment?.liveStudioConsent),
    sessionStudioConsent: Boolean(enrollment?.sessionStudioConsent),
    streamStartedAt: stream?.startedAt ?? null,
    streamFinalizedAt: stream?.finalizedAt ?? null,
  }, connection);
}

function heartRateWatchConnectionFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    enrollmentId: row.enrollment_id,
    pairingId: row.pairing_id,
    ownerProfileKey: row.owner_profile_key,
    scope: row.scope,
    clubId: row.club_id ?? null,
    studioRiderId: row.studio_rider_id ?? null,
    connectedAt: new Date(row.connected_at).getTime(),
    connectedUntil: new Date(row.connected_until).getTime(),
    stoppedAt: row.stopped_at ? new Date(row.stopped_at).getTime() : null,
    stoppedReason: row.stopped_reason ?? null,
    liveStudioConsent: Boolean(row.enrollment_live_studio_consent ?? row.live_studio_consent),
    sessionStudioConsent: Boolean(
      row.enrollment_session_studio_consent ?? row.session_studio_consent,
    ),
    streamStartedAt: row.stream_started_at ? new Date(row.stream_started_at).getTime() : null,
    streamFinalizedAt: row.stream_finalized_at ? new Date(row.stream_finalized_at).getTime() : null,
    pairingMissing: Boolean(row.pairing_missing),
    pairingRevokedAt: row.pairing_revoked_at ? new Date(row.pairing_revoked_at).getTime() : null,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

function memoryHeartRateWatchMembershipActive(enrollment) {
  if (enrollment.scope !== 'studio') return true;
  const member = memoryClubMembers.get(clubMemberKey(enrollment.clubId, enrollment.studioRiderId));
  return member?.status === 'claimed' && member.athleteProfileKey === enrollment.ownerProfileKey;
}

function stopMemoryHeartRateWatchConnection(connection, stoppedAt, stoppedReason) {
  if (!connection) return;
  connection.stoppedAt ??= stoppedAt;
  connection.stoppedReason ??= stoppedReason;
  connection.updatedAt = stoppedAt;
  const pairing = memoryHeartRatePairings.get(connection.pairingId);
  if (!pairing) return;
  pairing.accountBlockStopRequestedAt = Math.min(
    pairing.accountBlockStopRequestedAt ?? stoppedAt,
    stoppedAt,
  );
  pairing.accountBlockDrainExpiresAt = Math.min(
    pairing.accountBlockDrainExpiresAt ?? stoppedAt + heartRateWatchConnectDrainMs,
    stoppedAt + heartRateWatchConnectDrainMs,
  );
  pairing.liveStudioConsent = false;
  pairing.updatedAt = stoppedAt;
  const streamId = memoryHeartRateStreamIdByPairingId.get(pairing.id);
  const stream = streamId ? memoryHeartRateStreams.get(streamId) : null;
  if (stream) {
    stream.liveStudioConsent = false;
    stream.accountBlockStopRequestedAt = pairing.accountBlockStopRequestedAt;
    stream.accountBlockDrainExpiresAt = pairing.accountBlockDrainExpiresAt;
    stream.updatedAt = stoppedAt;
  }
}

function revokeMemoryHeartRateWatchEnrollment(enrollment, revokedAt, revokedReason) {
  if (!enrollment) return;
  enrollment.revokedAt ??= revokedAt;
  enrollment.revokedReason ??= revokedReason;
  enrollment.updatedAt = revokedAt;
  memoryHeartRateWatchConnections.forEach((connection) => {
    if (connection.enrollmentId === enrollment.id && connection.stoppedAt == null) {
      stopMemoryHeartRateWatchConnection(connection, revokedAt, 'enrollment-revoked');
    }
  });
}

export async function createOrRefreshHeartRateWatchEnrollment(options) {
  const now = Number(options.now) || Date.now();
  if (!pool) {
    const replay = [...memoryHeartRateWatchEnrollments.values()].find((candidate) => (
      candidate.ownerProfileKey === options.ownerProfileKey
      && candidate.requestId === options.requestId
    ));
    if (replay) {
      const exactReplay = replay.scope === options.scope
        && replay.clubId === (options.clubId ?? null)
        && replay.studioRiderId === (options.studioRiderId ?? null)
        && replay.installIdHash === options.installIdHash;
      return {
        status: exactReplay ? 'replayed' : 'conflict',
        enrollment: exactReplay ? publicMemoryHeartRateWatchEnrollment(replay) : null,
      };
    }
    const installOwnerConflict = [...memoryHeartRateWatchEnrollments.values()].some((candidate) => (
      candidate.installIdHash === options.installIdHash
      && candidate.ownerProfileKey !== options.ownerProfileKey
      && candidate.revokedAt == null
    ));
    if (installOwnerConflict) return { status: 'device-conflict', enrollment: null };
    if (options.scope === 'studio') {
      const member = memoryClubMembers.get(clubMemberKey(options.clubId, options.studioRiderId));
      if (member?.status !== 'claimed' || member.athleteProfileKey !== options.ownerProfileKey) {
        return { status: 'membership-required', enrollment: null };
      }
    }
    const existing = [...memoryHeartRateWatchEnrollments.values()].find((candidate) => (
      candidate.ownerProfileKey === options.ownerProfileKey
      && candidate.scope === options.scope
      && candidate.clubId === (options.clubId ?? null)
      && candidate.revokedAt == null
    ));
    if (existing?.installIdHash === options.installIdHash) {
      existing.liveStudioConsent = options.scope === 'studio'
        ? Boolean(options.liveStudioConsent)
        : false;
      existing.sessionStudioConsent = options.scope === 'studio'
        ? Boolean(options.sessionStudioConsent)
        : false;
      existing.lastVerifiedAt = now;
      existing.updatedAt = now;
      // Enrollment consent is authoritative for the still-running four-hour
      // connection. Propagate it to that connection's ingest projection so a
      // concurrent upload cannot keep emitting the former club consent.
      for (const connection of memoryHeartRateWatchConnections.values()) {
        if (connection.enrollmentId !== existing.id || connection.stoppedAt != null) continue;
        const pairing = memoryHeartRatePairings.get(connection.pairingId);
        if (pairing && pairing.revokedAt == null) {
          pairing.liveStudioConsent = existing.liveStudioConsent;
          pairing.sessionStudioConsent = existing.sessionStudioConsent;
          pairing.updatedAt = now;
        }
        const streamId = memoryHeartRateStreamIdByPairingId.get(connection.pairingId);
        const stream = streamId ? memoryHeartRateStreams.get(streamId) : null;
        if (stream && stream.finalizedAt == null) {
          stream.liveStudioConsent = existing.liveStudioConsent;
          stream.sessionStudioConsent = existing.sessionStudioConsent;
          stream.updatedAt = now;
        }
      }
      return { status: 'trusted', enrollment: publicMemoryHeartRateWatchEnrollment(existing) };
    }
    if (existing) revokeMemoryHeartRateWatchEnrollment(existing, now, 'device-replaced');
    if (memoryHeartRateWatchEnrollments.has(options.id)) {
      return { status: 'conflict', enrollment: null };
    }
    const enrollment = {
      id: options.id,
      ownerProfileKey: options.ownerProfileKey,
      scope: options.scope,
      clubId: options.clubId ?? null,
      studioRiderId: options.studioRiderId ?? null,
      installIdHash: options.installIdHash,
      requestId: options.requestId,
      liveStudioConsent: options.scope === 'studio' && Boolean(options.liveStudioConsent),
      sessionStudioConsent: options.scope === 'studio' && Boolean(options.sessionStudioConsent),
      lastVerifiedAt: now,
      revokedAt: null,
      revokedReason: null,
      createdAt: now,
      updatedAt: now,
    };
    memoryHeartRateWatchEnrollments.set(enrollment.id, enrollment);
    return { status: 'created', enrollment: publicMemoryHeartRateWatchEnrollment(enrollment) };
  }
  return withPersistenceLock(
    `heart-rate-watch-enrollment:${options.ownerProfileKey}:${options.scope}:${options.clubId ?? ''}`,
    async (client) => {
      const replayResult = await client.query(
        `SELECT * FROM ${schema}.heart_rate_watch_enrollments
         WHERE owner_profile_key = $1 AND request_id = $2
         LIMIT 1 FOR UPDATE`,
        [options.ownerProfileKey, options.requestId],
      );
      if (replayResult.rows[0]) {
        const row = replayResult.rows[0];
        const exactReplay = row.scope === options.scope
          && (row.club_id ?? null) === (options.clubId ?? null)
          && (row.studio_rider_id ?? null) === (options.studioRiderId ?? null)
          && row.install_id_hash === options.installIdHash;
        return {
          status: exactReplay ? 'replayed' : 'conflict',
          enrollment: exactReplay ? heartRateWatchEnrollmentFromRow(row) : null,
        };
      }
      const installConflict = await client.query(
        `SELECT id FROM ${schema}.heart_rate_watch_enrollments
         WHERE install_id_hash = $1 AND owner_profile_key <> $2 AND revoked_at IS NULL
         LIMIT 1`,
        [options.installIdHash, options.ownerProfileKey],
      );
      if (installConflict.rows[0]) return { status: 'device-conflict', enrollment: null };
      if (options.scope === 'studio') {
        const memberResult = await client.query(
          `SELECT 1 FROM ${schema}.club_members
           WHERE club_id = $1 AND studio_rider_id = $2
             AND athlete_profile_key = $3 AND status = 'claimed'
           LIMIT 1 FOR UPDATE`,
          [options.clubId, options.studioRiderId, options.ownerProfileKey],
        );
        if (!memberResult.rows[0]) return { status: 'membership-required', enrollment: null };
      }
      const existingResult = await client.query(
        `SELECT * FROM ${schema}.heart_rate_watch_enrollments
         WHERE owner_profile_key = $1 AND scope = $2
           AND club_id IS NOT DISTINCT FROM $3 AND revoked_at IS NULL
         LIMIT 1 FOR UPDATE`,
        [options.ownerProfileKey, options.scope, options.clubId ?? null],
      );
      const existing = existingResult.rows[0];
      if (existing?.install_id_hash === options.installIdHash) {
        const liveStudioConsent = options.scope === 'studio' && Boolean(options.liveStudioConsent);
        const sessionStudioConsent = options.scope === 'studio' && Boolean(options.sessionStudioConsent);
        const refreshed = await client.query(
          `UPDATE ${schema}.heart_rate_watch_enrollments
           SET live_studio_consent = $2, session_studio_consent = $3,
             last_verified_at = to_timestamp($4 / 1000.0),
             updated_at = to_timestamp($4 / 1000.0)
           WHERE id = $1 RETURNING *`,
          [
            existing.id,
            liveStudioConsent,
            sessionStudioConsent,
            now,
          ],
        );
        await client.query(
          `UPDATE ${schema}.heart_rate_pairings AS pairings
           SET live_studio_consent = $2, session_studio_consent = $3,
             updated_at = to_timestamp($4 / 1000.0)
           FROM ${schema}.heart_rate_watch_connections AS connections
           WHERE connections.enrollment_id = $1
             AND connections.stopped_at IS NULL
             AND pairings.id = connections.pairing_id
             AND pairings.revoked_at IS NULL`,
          [existing.id, liveStudioConsent, sessionStudioConsent, now],
        );
        await client.query(
          `UPDATE ${schema}.heart_rate_streams AS streams
           SET live_studio_consent = $2, session_studio_consent = $3,
             updated_at = to_timestamp($4 / 1000.0)
           FROM ${schema}.heart_rate_watch_connections AS connections
           WHERE connections.enrollment_id = $1
             AND connections.stopped_at IS NULL
             AND streams.pairing_id = connections.pairing_id
             AND streams.finalized_at IS NULL`,
          [existing.id, liveStudioConsent, sessionStudioConsent, now],
        );
        return { status: 'trusted', enrollment: heartRateWatchEnrollmentFromRow(refreshed.rows[0]) };
      }
      if (existing) {
        await client.query(
          `UPDATE ${schema}.heart_rate_watch_connections
           SET stopped_at = COALESCE(stopped_at, to_timestamp($2 / 1000.0)),
             stopped_reason = COALESCE(stopped_reason, 'enrollment-revoked'),
             updated_at = to_timestamp($2 / 1000.0)
           WHERE enrollment_id = $1 AND stopped_at IS NULL`,
          [existing.id, now],
        );
        await client.query(
          `UPDATE ${schema}.heart_rate_pairings AS pairings
           SET revoked_at = COALESCE(pairings.revoked_at, to_timestamp($2 / 1000.0)),
             live_studio_consent = false, session_studio_consent = false,
             updated_at = to_timestamp($2 / 1000.0)
           FROM ${schema}.heart_rate_watch_connections AS connections
           WHERE connections.enrollment_id = $1 AND pairings.id = connections.pairing_id`,
          [existing.id, now],
        );
        await client.query(
          `UPDATE ${schema}.heart_rate_watch_enrollments
           SET revoked_at = to_timestamp($2 / 1000.0), revoked_reason = 'device-replaced',
             updated_at = to_timestamp($2 / 1000.0)
           WHERE id = $1`,
          [existing.id, now],
        );
      }
      const inserted = await client.query(
        `INSERT INTO ${schema}.heart_rate_watch_enrollments (
           id, owner_profile_key, scope, club_id, studio_rider_id, install_id_hash,
           request_id, live_studio_consent, session_studio_consent,
           last_verified_at, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9,
           to_timestamp($10 / 1000.0), to_timestamp($10 / 1000.0), to_timestamp($10 / 1000.0)
         )
         ON CONFLICT DO NOTHING RETURNING *`,
        [
          options.id,
          options.ownerProfileKey,
          options.scope,
          options.clubId ?? null,
          options.studioRiderId ?? null,
          options.installIdHash,
          options.requestId,
          options.scope === 'studio' && Boolean(options.liveStudioConsent),
          options.scope === 'studio' && Boolean(options.sessionStudioConsent),
          now,
        ],
      );
      return inserted.rows[0]
        ? { status: 'created', enrollment: heartRateWatchEnrollmentFromRow(inserted.rows[0]) }
        : { status: 'conflict', enrollment: null };
    },
  );
}

export async function loadHeartRateWatchEnrollments(ownerProfileKey) {
  if (!pool) {
    return [...memoryHeartRateWatchEnrollments.values()]
      .filter((enrollment) => enrollment.ownerProfileKey === ownerProfileKey)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((enrollment) => ({
        ...publicMemoryHeartRateWatchEnrollment(enrollment),
        membershipActive: memoryHeartRateWatchMembershipActive(enrollment),
      }));
  }
  const result = await query(
    `SELECT enrollments.*,
       CASE WHEN enrollments.scope = 'personal' THEN true
         ELSE members.status = 'claimed'
           AND members.athlete_profile_key = enrollments.owner_profile_key
       END AS membership_active
     FROM ${schema}.heart_rate_watch_enrollments AS enrollments
     LEFT JOIN ${schema}.club_members AS members
       ON members.club_id = enrollments.club_id
       AND members.studio_rider_id = enrollments.studio_rider_id
     WHERE enrollments.owner_profile_key = $1
     ORDER BY enrollments.updated_at DESC, enrollments.id DESC
     LIMIT 100`,
    [ownerProfileKey],
  );
  return result.rows.map((row) => ({
    ...heartRateWatchEnrollmentFromRow(row),
    membershipActive: Boolean(row.membership_active),
  }));
}

export async function createHeartRateWatchConnection(options) {
  const now = Number(options.now) || Date.now();
  const connectedUntil = Number(options.connectedUntil);
  if (connectedUntil !== now + heartRateWatchConnectDurationMs) {
    return { status: 'invalid-duration', enrollment: null, connection: null, pairing: null };
  }
  if (!pool) {
    const enrollment = memoryHeartRateWatchEnrollments.get(options.enrollmentId);
    if (
      !enrollment
      || enrollment.ownerProfileKey !== options.ownerProfileKey
      || enrollment.installIdHash !== options.installIdHash
      || enrollment.revokedAt != null
    ) return { status: 'not-trusted', enrollment: null, connection: null, pairing: null };
    if (!memoryHeartRateWatchMembershipActive(enrollment)) {
      revokeMemoryHeartRateWatchEnrollment(enrollment, now, 'membership-ended');
      return {
        status: 'membership-required',
        enrollment: publicMemoryHeartRateWatchEnrollment(enrollment),
        connection: null,
        pairing: null,
      };
    }
    const replay = [...memoryHeartRateWatchConnections.values()].find((candidate) => (
      candidate.ownerProfileKey === options.ownerProfileKey && candidate.requestId === options.requestId
    ));
    if (replay) {
      if (replay.enrollmentId !== enrollment.id) {
        return { status: 'conflict', enrollment: null, connection: null, pairing: null };
      }
      if (replay.connectedUntil <= now || replay.stoppedAt != null) {
        return {
          status: 'expired',
          enrollment: publicMemoryHeartRateWatchEnrollment(enrollment),
          connection: publicMemoryHeartRateWatchConnection(replay, enrollment),
          pairing: publicMemoryHeartRatePairing(memoryHeartRatePairings.get(replay.pairingId)),
        };
      }
      const replayPairing = memoryHeartRatePairings.get(replay.pairingId);
      if (!replayPairing || replayPairing.revokedAt != null) {
        return { status: 'conflict', enrollment: null, connection: null, pairing: null };
      }
      if (
        memoryHeartRatePairingIdByTokenHash.has(options.ingestTokenHash)
        && memoryHeartRatePairingIdByTokenHash.get(options.ingestTokenHash) !== replayPairing.id
      ) return { status: 'conflict', enrollment: null, connection: null, pairing: null };
      memoryHeartRatePairingIdByTokenHash.delete(replayPairing.ingestTokenHash);
      replayPairing.ingestTokenHash = options.ingestTokenHash;
      replayPairing.updatedAt = now;
      memoryHeartRatePairingIdByTokenHash.set(options.ingestTokenHash, replayPairing.id);
      return replay.enrollmentId === enrollment.id
        ? {
          status: 'replayed',
          enrollment: publicMemoryHeartRateWatchEnrollment(enrollment),
          connection: publicMemoryHeartRateWatchConnection(replay, enrollment),
          pairing: publicMemoryHeartRatePairing(replayPairing),
        }
        : { status: 'conflict', enrollment: null, connection: null, pairing: null };
    }
    const active = [...memoryHeartRateWatchConnections.values()].find((candidate) => (
      candidate.ownerProfileKey === options.ownerProfileKey
      && candidate.scope === enrollment.scope
      && candidate.clubId === enrollment.clubId
      && candidate.stoppedAt == null
    ));
    if (active && active.connectedUntil > now) {
      const activePairing = memoryHeartRatePairings.get(active.pairingId);
      if (!activePairing || activePairing.revokedAt != null) {
        return { status: 'conflict', enrollment: null, connection: null, pairing: null };
      }
      if (
        memoryHeartRatePairingIdByTokenHash.has(options.ingestTokenHash)
        && memoryHeartRatePairingIdByTokenHash.get(options.ingestTokenHash) !== activePairing.id
      ) return { status: 'conflict', enrollment: null, connection: null, pairing: null };
      memoryHeartRatePairingIdByTokenHash.delete(activePairing.ingestTokenHash);
      activePairing.ingestTokenHash = options.ingestTokenHash;
      activePairing.updatedAt = now;
      memoryHeartRatePairingIdByTokenHash.set(options.ingestTokenHash, activePairing.id);
      return {
        status: 'active',
        enrollment: publicMemoryHeartRateWatchEnrollment(enrollment),
        connection: publicMemoryHeartRateWatchConnection(active, enrollment),
        pairing: publicMemoryHeartRatePairing(activePairing),
      };
    }
    if (active) stopMemoryHeartRateWatchConnection(active, active.connectedUntil, 'expired');
    const watchConnectionPairingIds = new Set(
      [...memoryHeartRateWatchConnections.values()].map((connection) => connection.pairingId),
    );
    for (const legacy of memoryHeartRatePairings.values()) {
      if (
        watchConnectionPairingIds.has(legacy.id)
        ||
        legacy.ownerProfileKey !== options.ownerProfileKey
        || legacy.relayScope !== (enrollment.scope === 'studio' ? 'studio-block' : 'account-block')
        || legacy.clubId !== enrollment.clubId
        || legacy.revokedAt != null
      ) continue;
      legacy.revokedAt = now;
      legacy.liveStudioConsent = false;
      legacy.sessionStudioConsent = false;
      legacy.updatedAt = now;
    }
    if (
      memoryHeartRatePairings.has(options.pairingId)
      || memoryHeartRatePairingIdByCodeHash.has(options.pairCodeHash)
      || memoryHeartRatePairingIdByTokenHash.has(options.ingestTokenHash)
      || memoryHeartRateWatchConnections.has(options.id)
    ) return { status: 'conflict', enrollment: null, connection: null, pairing: null };
    const pairing = {
      id: options.pairingId,
      studioInvitationId: null,
      ownerProfileKey: options.ownerProfileKey,
      sessionId: options.relaySessionId,
      activityType: 'training-block',
      relayScope: enrollment.scope === 'studio' ? 'studio-block' : 'account-block',
      studioBlockStoppedAt: null,
      accountBlockStopRequestedAt: connectedUntil,
      accountBlockDrainExpiresAt: connectedUntil + heartRateWatchConnectDrainMs,
      riderId: options.riderId,
      playerId: null,
      clubId: enrollment.clubId,
      studioRiderId: enrollment.studioRiderId,
      pairCodeHash: options.pairCodeHash,
      pairCodeExpiresAt: now,
      ingestTokenHash: options.ingestTokenHash,
      ingestExpiresAt: connectedUntil + heartRateWatchConnectDrainMs,
      claimedAt: now,
      revokedAt: null,
      liveStudioConsent: enrollment.scope === 'studio' && enrollment.liveStudioConsent,
      sessionStudioConsent: enrollment.scope === 'studio' && enrollment.sessionStudioConsent,
      createdAt: now,
      updatedAt: now,
    };
    const connection = {
      id: options.id,
      enrollmentId: enrollment.id,
      pairingId: pairing.id,
      ownerProfileKey: options.ownerProfileKey,
      scope: enrollment.scope,
      clubId: enrollment.clubId,
      studioRiderId: enrollment.studioRiderId,
      requestId: options.requestId,
      connectedAt: now,
      connectedUntil,
      stoppedAt: null,
      stoppedReason: null,
      createdAt: now,
      updatedAt: now,
    };
    memoryHeartRatePairings.set(pairing.id, pairing);
    memoryHeartRatePairingIdByCodeHash.set(pairing.pairCodeHash, pairing.id);
    memoryHeartRatePairingIdByTokenHash.set(pairing.ingestTokenHash, pairing.id);
    memoryHeartRateWatchConnections.set(connection.id, connection);
    enrollment.lastVerifiedAt = now;
    enrollment.updatedAt = now;
    return {
      status: 'created',
      enrollment: publicMemoryHeartRateWatchEnrollment(enrollment),
      connection: publicMemoryHeartRateWatchConnection(connection, enrollment),
      pairing: publicMemoryHeartRatePairing(pairing),
    };
  }
  return withPersistenceLock(
    `heart-rate-watch-connection:${options.ownerProfileKey}:${options.enrollmentId}`,
    async (client) => {
      const enrollmentResult = await client.query(
        `SELECT enrollments.*,
           CASE WHEN enrollments.scope = 'personal' THEN true
             ELSE members.status = 'claimed'
               AND members.athlete_profile_key = enrollments.owner_profile_key
           END AS membership_active
         FROM ${schema}.heart_rate_watch_enrollments AS enrollments
         LEFT JOIN ${schema}.club_members AS members
           ON members.club_id = enrollments.club_id
           AND members.studio_rider_id = enrollments.studio_rider_id
         WHERE enrollments.id = $1 AND enrollments.owner_profile_key = $2
           AND enrollments.install_id_hash = $3
         LIMIT 1 FOR UPDATE OF enrollments`,
        [options.enrollmentId, options.ownerProfileKey, options.installIdHash],
      );
      const enrollmentRow = enrollmentResult.rows[0];
      if (!enrollmentRow || enrollmentRow.revoked_at) {
        return { status: 'not-trusted', enrollment: null, connection: null, pairing: null };
      }
      if (!enrollmentRow.membership_active) {
        await client.query(
          `UPDATE ${schema}.heart_rate_watch_enrollments
           SET revoked_at = to_timestamp($2 / 1000.0), revoked_reason = 'membership-ended',
             updated_at = to_timestamp($2 / 1000.0)
           WHERE id = $1 AND revoked_at IS NULL`,
          [enrollmentRow.id, now],
        );
        return {
          status: 'membership-required',
          enrollment: heartRateWatchEnrollmentFromRow({
            ...enrollmentRow,
            revoked_at: new Date(now),
            revoked_reason: 'membership-ended',
          }),
          connection: null,
          pairing: null,
        };
      }
      const enrollment = heartRateWatchEnrollmentFromRow(enrollmentRow);
      const replayResult = await client.query(
        `SELECT connections.*,
           $3::boolean AS enrollment_live_studio_consent,
           $4::boolean AS enrollment_session_studio_consent
         FROM ${schema}.heart_rate_watch_connections AS connections
         WHERE connections.owner_profile_key = $1 AND connections.request_id = $2
         LIMIT 1 FOR UPDATE`,
        [
          options.ownerProfileKey,
          options.requestId,
          enrollment.liveStudioConsent,
          enrollment.sessionStudioConsent,
        ],
      );
      if (replayResult.rows[0]) {
        if (replayResult.rows[0].enrollment_id !== enrollment.id) {
          return { status: 'conflict', enrollment: null, connection: null, pairing: null };
        }
        if (
          new Date(replayResult.rows[0].connected_until).getTime() <= now
          || replayResult.rows[0].stopped_at
        ) {
          return {
            status: 'expired',
            enrollment,
            connection: heartRateWatchConnectionFromRow(replayResult.rows[0]),
            pairing: null,
          };
        }
        const pairingResult = await client.query(
          `UPDATE ${schema}.heart_rate_pairings
           SET ingest_token_hash = $2, updated_at = to_timestamp($3 / 1000.0)
           WHERE id = $1 AND revoked_at IS NULL
             AND ingest_expires_at > to_timestamp($3 / 1000.0)
           RETURNING *`,
          [replayResult.rows[0].pairing_id, options.ingestTokenHash, now],
        );
        if (!pairingResult.rows[0]) {
          return { status: 'conflict', enrollment: null, connection: null, pairing: null };
        }
        return {
          status: 'replayed',
          enrollment,
          connection: heartRateWatchConnectionFromRow(replayResult.rows[0]),
          pairing: heartRatePairingFromRow(pairingResult.rows[0]),
        };
      }
      const activeResult = await client.query(
        `SELECT connections.*,
           $4::boolean AS enrollment_live_studio_consent,
           $5::boolean AS enrollment_session_studio_consent
         FROM ${schema}.heart_rate_watch_connections AS connections
         WHERE connections.owner_profile_key = $1 AND connections.scope = $2
           AND connections.club_id IS NOT DISTINCT FROM $3
           AND connections.stopped_at IS NULL
         ORDER BY connections.connected_at DESC LIMIT 1 FOR UPDATE`,
        [
          options.ownerProfileKey,
          enrollment.scope,
          enrollment.clubId,
          enrollment.liveStudioConsent,
          enrollment.sessionStudioConsent,
        ],
      );
      const activeRow = activeResult.rows[0];
      if (activeRow && new Date(activeRow.connected_until).getTime() > now) {
        const pairingResult = await client.query(
          `UPDATE ${schema}.heart_rate_pairings
           SET ingest_token_hash = $2, updated_at = to_timestamp($3 / 1000.0)
           WHERE id = $1 AND revoked_at IS NULL
             AND ingest_expires_at > to_timestamp($3 / 1000.0)
           RETURNING *`,
          [activeRow.pairing_id, options.ingestTokenHash, now],
        );
        if (!pairingResult.rows[0]) {
          return { status: 'conflict', enrollment: null, connection: null, pairing: null };
        }
        return {
          status: 'active',
          enrollment,
          connection: heartRateWatchConnectionFromRow(activeRow),
          pairing: heartRatePairingFromRow(pairingResult.rows[0]),
        };
      }
      if (activeRow) {
        await client.query(
          `UPDATE ${schema}.heart_rate_watch_connections
           SET stopped_at = connected_until, stopped_reason = COALESCE(stopped_reason, 'expired'),
             updated_at = to_timestamp($2 / 1000.0)
           WHERE id = $1`,
          [activeRow.id, now],
        );
        await client.query(
          `UPDATE ${schema}.heart_rate_pairings AS pairings
           SET account_block_stop_requested_at = COALESCE(
               pairings.account_block_stop_requested_at,
               pairings.ingest_expires_at - interval '24 hours'
             ),
             account_block_drain_expires_at = COALESCE(
               pairings.account_block_drain_expires_at,
               pairings.ingest_expires_at
             ),
             live_studio_consent = false,
             updated_at = to_timestamp($2 / 1000.0)
           WHERE pairings.id = $1`,
          [activeRow.pairing_id, now],
        );
      }
      const relayScope = enrollment.scope === 'studio' ? 'studio-block' : 'account-block';
      await client.query(
        `UPDATE ${schema}.heart_rate_pairings AS pairings
         SET revoked_at = COALESCE(revoked_at, to_timestamp($5 / 1000.0)),
           live_studio_consent = false, session_studio_consent = false,
           updated_at = to_timestamp($5 / 1000.0)
         WHERE pairings.owner_profile_key = $1 AND pairings.relay_scope = $2
           AND pairings.club_id IS NOT DISTINCT FROM $3
           AND pairings.studio_rider_id IS NOT DISTINCT FROM $4
           AND pairings.revoked_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM ${schema}.heart_rate_watch_connections AS watch_connections
             WHERE watch_connections.pairing_id = pairings.id
           )`,
        [
          options.ownerProfileKey,
          relayScope,
          enrollment.clubId,
          enrollment.studioRiderId,
          now,
        ],
      );
      const pairingResult = await client.query(
        `INSERT INTO ${schema}.heart_rate_pairings (
           id, owner_profile_key, session_id, activity_type, relay_scope, rider_id,
           player_id, club_id, studio_rider_id, pair_code_hash, pair_code_expires_at,
           ingest_token_hash, ingest_expires_at, claimed_at,
           account_block_stop_requested_at, account_block_drain_expires_at,
           live_studio_consent, session_studio_consent, created_at, updated_at
         ) VALUES (
           $1, $2, $3, 'training-block', $4, $5, NULL, $6, $7, $8,
           to_timestamp($9 / 1000.0), $10, to_timestamp($14 / 1000.0),
           to_timestamp($9 / 1000.0), to_timestamp($11 / 1000.0),
           to_timestamp($14 / 1000.0), $12, $13,
           to_timestamp($9 / 1000.0), to_timestamp($9 / 1000.0)
         ) RETURNING *`,
        [
          options.pairingId,
          options.ownerProfileKey,
          options.relaySessionId,
          relayScope,
          options.riderId,
          enrollment.clubId,
          enrollment.studioRiderId,
          options.pairCodeHash,
          now,
          options.ingestTokenHash,
          connectedUntil,
          enrollment.scope === 'studio' && enrollment.liveStudioConsent,
          enrollment.scope === 'studio' && enrollment.sessionStudioConsent,
          connectedUntil + heartRateWatchConnectDrainMs,
        ],
      );
      const connectionResult = await client.query(
        `INSERT INTO ${schema}.heart_rate_watch_connections (
           id, enrollment_id, pairing_id, owner_profile_key, scope, club_id,
           studio_rider_id, request_id, connected_at, connected_until, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8,
           to_timestamp($9 / 1000.0), to_timestamp($10 / 1000.0),
           to_timestamp($9 / 1000.0), to_timestamp($9 / 1000.0)
         ) RETURNING *,
           $11::boolean AS enrollment_live_studio_consent,
           $12::boolean AS enrollment_session_studio_consent`,
        [
          options.id,
          enrollment.id,
          options.pairingId,
          options.ownerProfileKey,
          enrollment.scope,
          enrollment.clubId,
          enrollment.studioRiderId,
          options.requestId,
          now,
          connectedUntil,
          enrollment.liveStudioConsent,
          enrollment.sessionStudioConsent,
        ],
      );
      await client.query(
        `UPDATE ${schema}.heart_rate_watch_enrollments
         SET last_verified_at = to_timestamp($2 / 1000.0), updated_at = to_timestamp($2 / 1000.0)
         WHERE id = $1`,
        [enrollment.id, now],
      );
      return {
        status: 'created',
        enrollment,
        connection: heartRateWatchConnectionFromRow(connectionResult.rows[0]),
        pairing: heartRatePairingFromRow(pairingResult.rows[0]),
      };
    },
  );
}

export async function loadHeartRateWatchConnections(ownerProfileKey) {
  if (!pool) {
    return [...memoryHeartRateWatchConnections.values()]
      .filter((connection) => connection.ownerProfileKey === ownerProfileKey)
      .sort((left, right) => right.connectedAt - left.connectedAt)
      .slice(0, 100)
      .map((connection) => publicMemoryHeartRateWatchConnection(
        connection,
        memoryHeartRateWatchEnrollments.get(connection.enrollmentId),
      ));
  }
  const result = await query(
    `SELECT connections.*,
       enrollments.live_studio_consent AS enrollment_live_studio_consent,
       enrollments.session_studio_consent AS enrollment_session_studio_consent,
       pairings.revoked_at AS pairing_revoked_at,
       (pairings.id IS NULL) AS pairing_missing,
       streams.started_at AS stream_started_at,
       streams.finalized_at AS stream_finalized_at
     FROM ${schema}.heart_rate_watch_connections AS connections
     JOIN ${schema}.heart_rate_watch_enrollments AS enrollments
       ON enrollments.id = connections.enrollment_id
     LEFT JOIN ${schema}.heart_rate_pairings AS pairings
       ON pairings.id = connections.pairing_id
     LEFT JOIN ${schema}.heart_rate_streams AS streams
       ON streams.pairing_id = connections.pairing_id
     WHERE connections.owner_profile_key = $1
     ORDER BY connections.connected_at DESC, connections.id DESC
     LIMIT 100`,
    [ownerProfileKey],
  );
  return result.rows.map(heartRateWatchConnectionFromRow).filter(Boolean);
}

export async function stopHeartRateWatchConnection(
  ownerProfileKey,
  connectionId,
  stoppedAt = Date.now(),
  stoppedReason = 'athlete-stopped',
) {
  if (!pool) {
    const connection = memoryHeartRateWatchConnections.get(connectionId);
    if (!connection || connection.ownerProfileKey !== ownerProfileKey) return null;
    const effectiveStoppedAt = Math.min(
      connection.connectedUntil,
      Math.max(connection.connectedAt, stoppedAt),
    );
    stopMemoryHeartRateWatchConnection(connection, effectiveStoppedAt, stoppedReason);
    return publicMemoryHeartRateWatchConnection(
      connection,
      memoryHeartRateWatchEnrollments.get(connection.enrollmentId),
    );
  }
  return withPersistenceLock(`heart-rate-watch-stop:${connectionId}`, async (client) => {
    const result = await client.query(
      `UPDATE ${schema}.heart_rate_watch_connections AS connections
       SET stopped_at = COALESCE(
           connections.stopped_at,
           LEAST(
             connections.connected_until,
             GREATEST(connections.connected_at, to_timestamp($3 / 1000.0))
           )
         ),
         stopped_reason = COALESCE(connections.stopped_reason, $4),
         updated_at = to_timestamp($3 / 1000.0)
       FROM ${schema}.heart_rate_watch_enrollments AS enrollments
       WHERE connections.id = $1 AND connections.owner_profile_key = $2
         AND enrollments.id = connections.enrollment_id
       RETURNING connections.*,
         enrollments.live_studio_consent AS enrollment_live_studio_consent,
         enrollments.session_studio_consent AS enrollment_session_studio_consent`,
      [connectionId, ownerProfileKey, stoppedAt, stoppedReason],
    );
    const connection = result.rows[0];
    if (!connection) return null;
    const effectiveStoppedAt = new Date(connection.stopped_at).getTime();
    await client.query(
      `UPDATE ${schema}.heart_rate_pairings
       SET account_block_stop_requested_at = LEAST(
           COALESCE(account_block_stop_requested_at, to_timestamp($2 / 1000.0)),
           to_timestamp($2 / 1000.0)
         ),
         account_block_drain_expires_at = LEAST(
           COALESCE(
             account_block_drain_expires_at,
             to_timestamp($3 / 1000.0)
           ),
           to_timestamp($3 / 1000.0)
         ),
         live_studio_consent = false,
         updated_at = to_timestamp($2 / 1000.0)
       WHERE id = $1`,
      [
        connection.pairing_id,
        effectiveStoppedAt,
        effectiveStoppedAt + heartRateWatchConnectDrainMs,
      ],
    );
    await client.query(
      `UPDATE ${schema}.heart_rate_streams AS streams
       SET account_block_stop_requested_at = pairings.account_block_stop_requested_at,
         account_block_drain_expires_at = pairings.account_block_drain_expires_at,
         live_studio_consent = false,
         updated_at = to_timestamp($2 / 1000.0)
       FROM ${schema}.heart_rate_pairings AS pairings
       WHERE streams.pairing_id = $1 AND pairings.id = streams.pairing_id`,
      [connection.pairing_id, effectiveStoppedAt],
    );
    return heartRateWatchConnectionFromRow(connection);
  });
}

export async function stopHeartRateWatchConnectionForPairing(pairingId, endedAt) {
  if (!pool) {
    const connection = [...memoryHeartRateWatchConnections.values()].find((candidate) => (
      candidate.pairingId === pairingId
    ));
    if (!connection) return null;
    const reason = endedAt >= connection.connectedUntil ? 'expired' : 'athlete-stopped';
    return stopHeartRateWatchConnection(
      connection.ownerProfileKey,
      connection.id,
      Math.min(endedAt, connection.connectedUntil),
      reason,
    );
  }
  const result = await query(
    `SELECT id, owner_profile_key, connected_until
     FROM ${schema}.heart_rate_watch_connections
     WHERE pairing_id = $1 LIMIT 1`,
    [pairingId],
  );
  const row = result?.rows?.[0];
  if (!row) return null;
  const connectedUntil = new Date(row.connected_until).getTime();
  return stopHeartRateWatchConnection(
    row.owner_profile_key,
    row.id,
    Math.min(endedAt, connectedUntil),
    endedAt >= connectedUntil ? 'expired' : 'athlete-stopped',
  );
}

export async function revokeHeartRateWatchEnrollment(
  ownerProfileKey,
  enrollmentId,
  revokedAt = Date.now(),
) {
  if (!pool) {
    const enrollment = memoryHeartRateWatchEnrollments.get(enrollmentId);
    if (!enrollment || enrollment.ownerProfileKey !== ownerProfileKey) return null;
    revokeMemoryHeartRateWatchEnrollment(enrollment, revokedAt, 'athlete-disconnected');
    return publicMemoryHeartRateWatchEnrollment(enrollment);
  }
  return withPersistenceLock(`heart-rate-watch-enrollment-revoke:${enrollmentId}`, async (client) => {
    const result = await client.query(
      `UPDATE ${schema}.heart_rate_watch_enrollments
       SET revoked_at = COALESCE(revoked_at, to_timestamp($3 / 1000.0)),
         revoked_reason = COALESCE(revoked_reason, 'athlete-disconnected'),
         updated_at = to_timestamp($3 / 1000.0)
       WHERE id = $1 AND owner_profile_key = $2 RETURNING *`,
      [enrollmentId, ownerProfileKey, revokedAt],
    );
    const enrollment = result.rows[0];
    if (!enrollment) return null;
    await client.query(
      `UPDATE ${schema}.heart_rate_watch_connections
       SET stopped_at = COALESCE(stopped_at, to_timestamp($2 / 1000.0)),
         stopped_reason = COALESCE(stopped_reason, 'enrollment-revoked'),
         updated_at = to_timestamp($2 / 1000.0)
       WHERE enrollment_id = $1`,
      [enrollmentId, revokedAt],
    );
    await client.query(
      `UPDATE ${schema}.heart_rate_pairings AS pairings
       SET account_block_stop_requested_at = LEAST(
           COALESCE(account_block_stop_requested_at, to_timestamp($2 / 1000.0)),
           to_timestamp($2 / 1000.0)
         ),
         account_block_drain_expires_at = LEAST(
           COALESCE(account_block_drain_expires_at, to_timestamp($3 / 1000.0)),
           to_timestamp($3 / 1000.0)
         ),
         live_studio_consent = false,
         updated_at = to_timestamp($2 / 1000.0)
       FROM ${schema}.heart_rate_watch_connections AS connections
       WHERE connections.enrollment_id = $1 AND pairings.id = connections.pairing_id`,
      [enrollmentId, revokedAt, revokedAt + heartRateWatchConnectDrainMs],
    );
    await client.query(
      `UPDATE ${schema}.heart_rate_streams AS streams
       SET account_block_stop_requested_at = pairings.account_block_stop_requested_at,
         account_block_drain_expires_at = pairings.account_block_drain_expires_at,
         live_studio_consent = false,
         updated_at = to_timestamp($2 / 1000.0)
       FROM ${schema}.heart_rate_pairings AS pairings,
         ${schema}.heart_rate_watch_connections AS connections
       WHERE connections.enrollment_id = $1
         AND pairings.id = connections.pairing_id
         AND streams.pairing_id = pairings.id`,
      [enrollmentId, revokedAt],
    );
    return heartRateWatchEnrollmentFromRow(enrollment);
  });
}

export async function revokeHeartRateWatchStudioEnrollmentByOwner(
  ownerProfileKey,
  clubId,
  enrollmentId,
  revokedAt = Date.now(),
) {
  if (!pool) {
    if (memoryClubIdByOwner.get(ownerProfileKey) !== clubId) return null;
    const enrollment = memoryHeartRateWatchEnrollments.get(enrollmentId);
    if (
      !enrollment
      || enrollment.scope !== 'studio'
      || enrollment.clubId !== clubId
    ) return null;
    enrollment.revokedAt ??= revokedAt;
    enrollment.revokedReason ??= 'studio-disconnected';
    enrollment.liveStudioConsent = false;
    enrollment.sessionStudioConsent = false;
    enrollment.updatedAt = revokedAt;
    for (const connection of memoryHeartRateWatchConnections.values()) {
      if (connection.enrollmentId !== enrollment.id) continue;
      const effectiveStoppedAt = connection.stoppedAt ?? Math.min(
        connection.connectedUntil,
        Math.max(connection.connectedAt, revokedAt),
      );
      stopMemoryHeartRateWatchConnection(
        connection,
        effectiveStoppedAt,
        'studio-disconnected',
      );
      const pairing = memoryHeartRatePairings.get(connection.pairingId);
      if (pairing) {
        pairing.liveStudioConsent = false;
        pairing.sessionStudioConsent = false;
        pairing.updatedAt = revokedAt;
      }
      const streamId = memoryHeartRateStreamIdByPairingId.get(connection.pairingId);
      const stream = streamId ? memoryHeartRateStreams.get(streamId) : null;
      if (stream) {
        stream.liveStudioConsent = false;
        stream.sessionStudioConsent = false;
        stream.updatedAt = revokedAt;
      }
      memoryHeartRateTrainingSegments.forEach((segment) => {
        if (segment.pairingId === connection.pairingId) {
          segment.studioVisible = false;
          segment.updatedAt = revokedAt;
        }
      });
    }
    return {
      enrollment: publicMemoryHeartRateWatchEnrollment(enrollment),
      studioRiderId: enrollment.studioRiderId,
    };
  }
  return withPersistenceLock(
    `heart-rate-watch-studio-owner-revoke:${clubId}:${enrollmentId}`,
    async (client) => {
      const enrollmentResult = await client.query(
        `SELECT enrollments.*
         FROM ${schema}.heart_rate_watch_enrollments AS enrollments
         JOIN ${schema}.clubs AS clubs ON clubs.id = enrollments.club_id
         WHERE enrollments.id = $1
           AND enrollments.scope = 'studio'
           AND enrollments.club_id = $2
           AND clubs.owner_profile_key = $3
         LIMIT 1
         FOR UPDATE OF enrollments`,
        [enrollmentId, clubId, ownerProfileKey],
      );
      if (!enrollmentResult.rows[0]) return null;
      const updatedEnrollment = await client.query(
        `UPDATE ${schema}.heart_rate_watch_enrollments
         SET revoked_at = COALESCE(revoked_at, to_timestamp($2 / 1000.0)),
           revoked_reason = COALESCE(revoked_reason, 'studio-disconnected'),
           live_studio_consent = false, session_studio_consent = false,
           updated_at = to_timestamp($2 / 1000.0)
         WHERE id = $1
         RETURNING *`,
        [enrollmentId, revokedAt],
      );
      await client.query(
        `UPDATE ${schema}.heart_rate_watch_connections
         SET stopped_at = COALESCE(
             stopped_at,
             LEAST(connected_until, GREATEST(connected_at, to_timestamp($2 / 1000.0)))
           ),
           stopped_reason = COALESCE(stopped_reason, 'studio-disconnected'),
           updated_at = to_timestamp($2 / 1000.0)
         WHERE enrollment_id = $1`,
        [enrollmentId, revokedAt],
      );
      await client.query(
        `UPDATE ${schema}.heart_rate_pairings AS pairings
         SET account_block_stop_requested_at = LEAST(
             COALESCE(pairings.account_block_stop_requested_at, connections.stopped_at),
             connections.stopped_at
           ),
           account_block_drain_expires_at = LEAST(
             COALESCE(
               pairings.account_block_drain_expires_at,
               connections.stopped_at + interval '24 hours'
             ),
             connections.stopped_at + interval '24 hours'
           ),
           live_studio_consent = false, session_studio_consent = false,
           updated_at = to_timestamp($2 / 1000.0)
         FROM ${schema}.heart_rate_watch_connections AS connections
         WHERE connections.enrollment_id = $1
           AND pairings.id = connections.pairing_id`,
        [enrollmentId, revokedAt],
      );
      await client.query(
        `UPDATE ${schema}.heart_rate_streams AS streams
         SET account_block_stop_requested_at = pairings.account_block_stop_requested_at,
           account_block_drain_expires_at = pairings.account_block_drain_expires_at,
           live_studio_consent = false, session_studio_consent = false,
           updated_at = to_timestamp($2 / 1000.0)
         FROM ${schema}.heart_rate_pairings AS pairings,
           ${schema}.heart_rate_watch_connections AS connections
         WHERE connections.enrollment_id = $1
           AND pairings.id = connections.pairing_id
           AND streams.pairing_id = pairings.id`,
        [enrollmentId, revokedAt],
      );
      await client.query(
        `UPDATE ${schema}.heart_rate_training_segments AS segments
         SET studio_visible = false, updated_at = to_timestamp($2 / 1000.0)
         FROM ${schema}.heart_rate_watch_connections AS connections
         WHERE connections.enrollment_id = $1
           AND segments.pairing_id = connections.pairing_id`,
        [enrollmentId, revokedAt],
      );
      const enrollment = heartRateWatchEnrollmentFromRow(updatedEnrollment.rows[0]);
      return { enrollment, studioRiderId: enrollment.studioRiderId };
    },
  );
}

export async function loadHeartRateWatchStudioProjection(ownerProfileKey, clubId) {
  if (!pool) {
    const ownedClubId = memoryClubIdByOwner.get(ownerProfileKey);
    if (ownedClubId !== clubId) return null;
    return [...memoryClubMembers.values()]
      .filter((member) => member.clubId === clubId && member.status === 'claimed')
      .map((member) => {
        const enrollment = [...memoryHeartRateWatchEnrollments.values()]
          .filter((candidate) => (
            candidate.ownerProfileKey === member.athleteProfileKey
            && candidate.clubId === clubId
            && candidate.studioRiderId === member.studioRiderId
          ))
          .sort((left, right) => (
            Number(left.revokedAt != null) - Number(right.revokedAt != null)
            || right.updatedAt - left.updatedAt
          ))[0] ?? null;
        const connection = enrollment
          ? [...memoryHeartRateWatchConnections.values()]
            .filter((candidate) => candidate.enrollmentId === enrollment.id)
            .sort((left, right) => (
              Number(left.stoppedAt != null) - Number(right.stoppedAt != null)
              || right.connectedAt - left.connectedAt
            ))[0] ?? null
          : null;
        return {
          clubId,
          studioRiderId: member.studioRiderId,
          riderName: member.riderName,
          enrollment: publicMemoryHeartRateWatchEnrollment(enrollment),
          connection: publicMemoryHeartRateWatchConnection(connection, enrollment),
        };
      });
  }
  const ownership = await query(
    `SELECT 1 FROM ${schema}.clubs WHERE id = $1 AND owner_profile_key = $2 LIMIT 1`,
    [clubId, ownerProfileKey],
  );
  if (!ownership?.rows?.[0]) return null;
  const result = await query(
    `SELECT members.club_id, members.studio_rider_id, members.athlete_profile_key,
       members.rider_name, enrollments.id AS enrollment_id,
       enrollments.scope AS enrollment_scope, enrollments.live_studio_consent,
       enrollments.session_studio_consent, enrollments.last_verified_at,
       enrollments.revoked_at AS enrollment_revoked_at,
       enrollments.revoked_reason, enrollments.created_at AS enrollment_created_at,
       enrollments.updated_at AS enrollment_updated_at,
       connections.id AS connection_id, connections.pairing_id,
       connections.connected_at, connections.connected_until, connections.stopped_at,
       connections.stopped_reason, connections.created_at AS connection_created_at,
       connections.updated_at AS connection_updated_at,
       pairings.revoked_at AS pairing_revoked_at,
       (pairings.id IS NULL) AS pairing_missing,
       streams.started_at AS stream_started_at,
       streams.finalized_at AS stream_finalized_at
     FROM ${schema}.club_members AS members
     JOIN ${schema}.clubs AS clubs ON clubs.id = members.club_id
     LEFT JOIN LATERAL (
       SELECT watch_enrollments.*
       FROM ${schema}.heart_rate_watch_enrollments AS watch_enrollments
       WHERE watch_enrollments.owner_profile_key = members.athlete_profile_key
         AND watch_enrollments.scope = 'studio'
         AND watch_enrollments.club_id = members.club_id
         AND watch_enrollments.studio_rider_id = members.studio_rider_id
       ORDER BY (watch_enrollments.revoked_at IS NULL) DESC,
         watch_enrollments.updated_at DESC, watch_enrollments.id DESC
       LIMIT 1
     ) AS enrollments ON true
     LEFT JOIN LATERAL (
       SELECT watch_connections.*
       FROM ${schema}.heart_rate_watch_connections AS watch_connections
       WHERE watch_connections.enrollment_id = enrollments.id
       ORDER BY (watch_connections.stopped_at IS NULL) DESC,
         watch_connections.connected_at DESC, watch_connections.id DESC
       LIMIT 1
     ) AS connections ON true
     LEFT JOIN ${schema}.heart_rate_pairings AS pairings
       ON pairings.id = connections.pairing_id
     LEFT JOIN ${schema}.heart_rate_streams AS streams
       ON streams.pairing_id = connections.pairing_id
     WHERE clubs.owner_profile_key = $1 AND clubs.id = $2
       AND members.status = 'claimed' AND members.athlete_profile_key IS NOT NULL
     ORDER BY lower(members.rider_name), members.studio_rider_id`,
    [ownerProfileKey, clubId],
  );
  return result.rows.map((row) => {
    const enrollment = row.enrollment_id ? heartRateWatchEnrollmentFromRow({
      id: row.enrollment_id,
      owner_profile_key: row.athlete_profile_key,
      scope: row.enrollment_scope,
      club_id: row.club_id,
      studio_rider_id: row.studio_rider_id,
      live_studio_consent: row.live_studio_consent,
      session_studio_consent: row.session_studio_consent,
      last_verified_at: row.last_verified_at,
      revoked_at: row.enrollment_revoked_at,
      revoked_reason: row.revoked_reason,
      created_at: row.enrollment_created_at,
      updated_at: row.enrollment_updated_at,
    }) : null;
    const connection = row.connection_id ? heartRateWatchConnectionFromRow({
      id: row.connection_id,
      enrollment_id: row.enrollment_id,
      pairing_id: row.pairing_id,
      owner_profile_key: row.athlete_profile_key,
      scope: 'studio',
      club_id: row.club_id,
      studio_rider_id: row.studio_rider_id,
      connected_at: row.connected_at,
      connected_until: row.connected_until,
      stopped_at: row.stopped_at,
      stopped_reason: row.stopped_reason,
      enrollment_live_studio_consent: row.live_studio_consent,
      enrollment_session_studio_consent: row.session_studio_consent,
      pairing_revoked_at: row.pairing_revoked_at,
      pairing_missing: row.pairing_missing,
      stream_started_at: row.stream_started_at,
      stream_finalized_at: row.stream_finalized_at,
      created_at: row.connection_created_at,
      updated_at: row.connection_updated_at,
    }) : null;
    return {
      clubId: row.club_id,
      studioRiderId: row.studio_rider_id,
      riderName: row.rider_name,
      enrollment,
      connection,
    };
  });
}

export async function createHeartRatePairing(pairing) {
  const now = Number(pairing.createdAt) || Date.now();
  if (!pool) {
    if (
      memoryHeartRatePairings.has(pairing.id)
      || memoryHeartRatePairingIdByCodeHash.has(pairing.pairCodeHash)
    ) return null;
    const stored = {
      ...cloneJson(pairing, pairing),
      pairCodeHash: pairing.pairCodeHash,
      ingestTokenHash: null,
      ingestExpiresAt: null,
      claimedAt: null,
      revokedAt: null,
      studioBlockStoppedAt: null,
      accountBlockStopRequestedAt: null,
      accountBlockDrainExpiresAt: null,
      createdAt: now,
      updatedAt: now,
    };
    memoryHeartRatePairings.set(stored.id, stored);
    memoryHeartRatePairingIdByCodeHash.set(stored.pairCodeHash, stored.id);
    return publicMemoryHeartRatePairing(stored);
  }
  const result = await query(
    `INSERT INTO ${schema}.heart_rate_pairings (
       id, studio_invitation_id, owner_profile_key, session_id, activity_type, rider_id, player_id,
       relay_scope, club_id, studio_rider_id, pair_code_hash, pair_code_expires_at,
       live_studio_consent, session_studio_consent, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, to_timestamp($12 / 1000.0),
       $13, $14, to_timestamp($15 / 1000.0), to_timestamp($15 / 1000.0)
     )
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [
      pairing.id,
      pairing.studioInvitationId ?? null,
      pairing.ownerProfileKey,
      pairing.sessionId,
      pairing.activityType,
      pairing.riderId,
      pairing.playerId ?? null,
      pairing.relayScope || 'session',
      pairing.clubId ?? null,
      pairing.studioRiderId ?? null,
      pairing.pairCodeHash,
      pairing.pairCodeExpiresAt,
      Boolean(pairing.liveStudioConsent),
      Boolean(pairing.sessionStudioConsent),
      now,
    ],
  );
  return heartRatePairingFromRow(result?.rows?.[0]);
}

export async function createHeartRateAccountBlockPairing(pairing) {
  const now = Number(pairing.createdAt) || Date.now();
  if (!pool) {
    const existing = [...memoryHeartRatePairings.values()].find((candidate) => (
      candidate.ownerProfileKey === pairing.ownerProfileKey
      && candidate.sessionId === pairing.sessionId
      && candidate.relayScope === 'account-block'
      && ![...memoryHeartRateWatchConnections.values()].some((connection) => (
        connection.pairingId === candidate.id
      ))
    ));
    if (existing) {
      return existing.revokedAt == null
        ? { status: 'replayed', pairing: publicMemoryHeartRatePairing(existing) }
        : { status: 'conflict', pairing: null };
    }
    if (
      memoryHeartRatePairings.has(pairing.id)
      || memoryHeartRatePairingIdByCodeHash.has(pairing.pairCodeHash)
    ) return { status: 'conflict', pairing: null };
    for (const candidate of memoryHeartRatePairings.values()) {
      if (candidate.ownerProfileKey !== pairing.ownerProfileKey || candidate.relayScope !== 'account-block') continue;
      if ([...memoryHeartRateWatchConnections.values()].some((connection) => (
        connection.pairingId === candidate.id
      ))) continue;
      const candidateStreamId = memoryHeartRateStreamIdByPairingId.get(candidate.id);
      const candidateStream = candidateStreamId ? memoryHeartRateStreams.get(candidateStreamId) : null;
      const effectiveExpiresAt = candidate.ingestExpiresAt ?? candidate.pairCodeExpiresAt;
      if (
        candidate.revokedAt == null
        && (
          effectiveExpiresAt <= now
          || candidateStream?.finalizedAt != null
          || (
            candidate.accountBlockStopRequestedAt != null
            && (candidate.accountBlockDrainExpiresAt ?? 0) <= now
          )
        )
      ) {
        candidate.revokedAt = now;
        candidate.updatedAt = now;
      }
    }
    const active = [...memoryHeartRatePairings.values()].find((candidate) => (
      candidate.ownerProfileKey === pairing.ownerProfileKey
      && candidate.relayScope === 'account-block'
      && ![...memoryHeartRateWatchConnections.values()].some((connection) => (
        connection.pairingId === candidate.id
      ))
      && candidate.revokedAt == null
      && candidate.accountBlockStopRequestedAt == null
    ));
    if (active) return { status: 'active', pairing: publicMemoryHeartRatePairing(active) };
    const stored = {
      ...cloneJson(pairing, pairing),
      relayScope: 'account-block',
      activityType: 'training-block',
      playerId: null,
      clubId: null,
      studioRiderId: null,
      liveStudioConsent: false,
      sessionStudioConsent: false,
      pairCodeHash: pairing.pairCodeHash,
      ingestTokenHash: null,
      ingestExpiresAt: null,
      claimedAt: null,
      revokedAt: null,
      studioBlockStoppedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    memoryHeartRatePairings.set(stored.id, stored);
    memoryHeartRatePairingIdByCodeHash.set(stored.pairCodeHash, stored.id);
    return { status: 'created', pairing: publicMemoryHeartRatePairing(stored) };
  }
  return withPersistenceLock(`heart-rate-account-block:${pairing.ownerProfileKey}`, async (client) => {
    const existingResult = await client.query(
      `SELECT pairings.* FROM ${schema}.heart_rate_pairings AS pairings
       WHERE pairings.owner_profile_key = $1 AND pairings.session_id = $2
         AND pairings.relay_scope = 'account-block'
         AND NOT EXISTS (
           SELECT 1 FROM ${schema}.heart_rate_watch_connections AS watch_connections
           WHERE watch_connections.pairing_id = pairings.id
         )
       LIMIT 1 FOR UPDATE`,
      [pairing.ownerProfileKey, pairing.sessionId],
    );
    if (existingResult.rows[0]) {
      const existing = heartRatePairingFromRow(existingResult.rows[0]);
      return existing.revokedAt == null
        ? { status: 'replayed', pairing: existing }
        : { status: 'conflict', pairing: null };
    }
    await client.query(
      `UPDATE ${schema}.heart_rate_pairings AS pairings
       SET revoked_at = COALESCE(revoked_at, to_timestamp($2 / 1000.0)),
         updated_at = to_timestamp($2 / 1000.0)
       WHERE pairings.owner_profile_key = $1
         AND pairings.relay_scope = 'account-block'
         AND pairings.revoked_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM ${schema}.heart_rate_watch_connections AS watch_connections
           WHERE watch_connections.pairing_id = pairings.id
         )
         AND (
           COALESCE(pairings.ingest_expires_at, pairings.pair_code_expires_at) <= to_timestamp($2 / 1000.0)
           OR (
             pairings.account_block_stop_requested_at IS NOT NULL
             AND pairings.account_block_drain_expires_at <= to_timestamp($2 / 1000.0)
           )
           OR EXISTS (
             SELECT 1 FROM ${schema}.heart_rate_streams AS streams
             WHERE streams.pairing_id = pairings.id
               AND streams.finalized_at IS NOT NULL
           )
         )`,
      [pairing.ownerProfileKey, now],
    );
    const activeResult = await client.query(
      `SELECT pairings.* FROM ${schema}.heart_rate_pairings AS pairings
       WHERE pairings.owner_profile_key = $1
         AND pairings.relay_scope = 'account-block'
         AND pairings.revoked_at IS NULL
         AND pairings.account_block_stop_requested_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM ${schema}.heart_rate_watch_connections AS watch_connections
           WHERE watch_connections.pairing_id = pairings.id
         )
       ORDER BY pairings.created_at DESC, pairings.id DESC
       LIMIT 1
       FOR UPDATE`,
      [pairing.ownerProfileKey],
    );
    if (activeResult.rows[0]) {
      return { status: 'active', pairing: heartRatePairingFromRow(activeResult.rows[0]) };
    }
    const result = await client.query(
      `INSERT INTO ${schema}.heart_rate_pairings (
         id, owner_profile_key, session_id, activity_type, rider_id, player_id,
         relay_scope, club_id, studio_rider_id, pair_code_hash, pair_code_expires_at,
         live_studio_consent, session_studio_consent, created_at, updated_at
       ) VALUES (
         $1, $2, $3, 'training-block', $4, NULL, 'account-block', NULL, NULL,
         $5, to_timestamp($6 / 1000.0), false, false,
         to_timestamp($7 / 1000.0), to_timestamp($7 / 1000.0)
       )
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [
        pairing.id,
        pairing.ownerProfileKey,
        pairing.sessionId,
        pairing.riderId,
        pairing.pairCodeHash,
        pairing.pairCodeExpiresAt,
        now,
      ],
    );
    const created = heartRatePairingFromRow(result.rows[0]);
    return created
      ? { status: 'created', pairing: created }
      : { status: 'conflict', pairing: null };
  });
}

export async function rotateHeartRateAccountBlockPairCode({
  ownerProfileKey,
  pairingId,
  pairCodeHash,
  pairCodeExpiresAt,
  now = Date.now(),
}) {
  if (!pool) {
    const pairing = memoryHeartRatePairings.get(pairingId);
    if (
      !pairing
      || pairing.ownerProfileKey !== ownerProfileKey
      || pairing.relayScope !== 'account-block'
      || [...memoryHeartRateWatchConnections.values()].some((connection) => (
        connection.pairingId === pairing.id
      ))
    ) return { status: 'not-found', pairing: null };
    if (pairing.claimedAt != null || pairing.ingestTokenHash) {
      return { status: 'claimed', pairing: publicMemoryHeartRatePairing(pairing) };
    }
    if (pairing.revokedAt != null || pairing.accountBlockStopRequestedAt != null) {
      return { status: 'inactive', pairing: null };
    }
    const collisionId = memoryHeartRatePairingIdByCodeHash.get(pairCodeHash);
    if (collisionId && collisionId !== pairing.id) return null;
    memoryHeartRatePairingIdByCodeHash.delete(pairing.pairCodeHash);
    pairing.pairCodeHash = pairCodeHash;
    pairing.pairCodeExpiresAt = pairCodeExpiresAt;
    pairing.updatedAt = now;
    memoryHeartRatePairingIdByCodeHash.set(pairCodeHash, pairing.id);
    return { status: 'rotated', pairing: publicMemoryHeartRatePairing(pairing) };
  }
  return withPersistenceLock(`heart-rate-account-block:${ownerProfileKey}`, async (client) => {
    const result = await client.query(
      `SELECT pairings.* FROM ${schema}.heart_rate_pairings AS pairings
       WHERE pairings.id = $1 AND pairings.owner_profile_key = $2
         AND pairings.relay_scope = 'account-block'
         AND NOT EXISTS (
           SELECT 1 FROM ${schema}.heart_rate_watch_connections AS watch_connections
           WHERE watch_connections.pairing_id = pairings.id
         )
       FOR UPDATE`,
      [pairingId, ownerProfileKey],
    );
    const row = result.rows[0];
    if (!row) return { status: 'not-found', pairing: null };
    if (row.claimed_at || row.ingest_token_hash) {
      return { status: 'claimed', pairing: heartRatePairingFromRow(row) };
    }
    if (row.revoked_at || row.account_block_stop_requested_at) {
      return { status: 'inactive', pairing: null };
    }
    const rotated = await client.query(
      `UPDATE ${schema}.heart_rate_pairings AS pairings
       SET pair_code_hash = $2,
         pair_code_expires_at = to_timestamp($3 / 1000.0),
         updated_at = to_timestamp($4 / 1000.0)
       WHERE pairings.id = $1 AND pairings.owner_profile_key = $5
         AND pairings.relay_scope = 'account-block'
         AND pairings.claimed_at IS NULL AND pairings.ingest_token_hash IS NULL
         AND pairings.revoked_at IS NULL AND pairings.account_block_stop_requested_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM ${schema}.heart_rate_watch_connections AS watch_connections
           WHERE watch_connections.pairing_id = pairings.id
         )
       RETURNING *`,
      [pairingId, pairCodeHash, pairCodeExpiresAt, now, ownerProfileKey],
    );
    return rotated.rows[0]
      ? { status: 'rotated', pairing: heartRatePairingFromRow(rotated.rows[0]) }
      : { status: 'inactive', pairing: null };
  });
}

function heartRateAccountBlockStatus(pairing, stream, latestSample, now = Date.now()) {
  if (!pairing || pairing.relayScope !== 'account-block') return null;
  const credentialExpiresAt = pairing.ingestExpiresAt ?? pairing.pairCodeExpiresAt;
  const effectiveExpiresAt = pairing.accountBlockStopRequestedAt != null
    ? Math.min(credentialExpiresAt, pairing.accountBlockDrainExpiresAt ?? credentialExpiresAt)
    : credentialExpiresAt;
  const lastSampleReceivedAt = latestSample?.receivedAt ?? null;
  const state = pairing.revokedAt != null
    ? 'revoked'
    : stream?.finalizedAt != null
      ? 'ended'
      : effectiveExpiresAt <= now
        ? 'expired'
        : pairing.claimedAt == null
          ? 'waiting-watch'
          : lastSampleReceivedAt != null && lastSampleReceivedAt >= now - 15_000
            ? 'live'
            : 'stale';
  return {
    pairingId: pairing.id,
    blockId: pairing.sessionId,
    relayScope: 'account-block',
    state,
    pairCodeExpiresAt: pairing.pairCodeExpiresAt,
    ingestExpiresAt: pairing.ingestExpiresAt ?? null,
    effectiveExpiresAt,
    claimedAt: pairing.claimedAt ?? null,
    revokedAt: pairing.revokedAt ?? null,
    stopRequestedAt: pairing.accountBlockStopRequestedAt ?? null,
    drainExpiresAt: pairing.accountBlockDrainExpiresAt ?? null,
    streamStartedAt: stream?.startedAt ?? null,
    streamEndedAt: stream?.endedAt ?? null,
    lastSampleAt: latestSample?.recordedAt ?? null,
    lastSampleReceivedAt,
    freshUntil: lastSampleReceivedAt == null ? null : lastSampleReceivedAt + 15_000,
    createdAt: pairing.createdAt,
    updatedAt: Math.max(pairing.updatedAt, stream?.updatedAt ?? 0),
  };
}

export async function loadHeartRateAccountBlockStatuses(ownerProfileKey, now = Date.now()) {
  if (!pool) {
    return [...memoryHeartRatePairings.values()]
      .filter((pairing) => (
        pairing.ownerProfileKey === ownerProfileKey
        && pairing.relayScope === 'account-block'
        && ![...memoryHeartRateWatchConnections.values()].some((connection) => (
          connection.pairingId === pairing.id
        ))
      ))
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, 20)
      .map((pairing) => {
        const streamId = memoryHeartRateStreamIdByPairingId.get(pairing.id);
        const stream = streamId ? memoryHeartRateStreams.get(streamId) : null;
        const latestStoredSample = streamId
          ? [...(memoryHeartRateSamplesByStreamId.get(streamId)?.values() ?? [])]
            .sort((left, right) => right.sequence - left.sequence)[0] ?? null
          : null;
        const latestSample = latestStoredSample
          ? { ...latestStoredSample, receivedAt: stream?.updatedAt ?? null }
          : null;
        return heartRateAccountBlockStatus(pairing, stream, latestSample, now);
      })
      .filter(Boolean);
  }
  const result = await query(
    `SELECT pairings.*,
       streams.id AS stream_id, streams.started_at AS stream_started_at,
       streams.ended_at AS stream_ended_at, streams.finalized_at AS stream_finalized_at,
       streams.updated_at AS stream_updated_at,
       latest.recorded_at AS latest_recorded_at, latest.received_at AS latest_received_at
     FROM ${schema}.heart_rate_pairings AS pairings
     LEFT JOIN ${schema}.heart_rate_streams AS streams ON streams.pairing_id = pairings.id
     LEFT JOIN LATERAL (
       SELECT samples.recorded_at, samples.received_at
       FROM ${schema}.heart_rate_samples AS samples
       WHERE samples.stream_id = streams.id
       ORDER BY samples.sequence DESC
       LIMIT 1
     ) AS latest ON true
     WHERE pairings.owner_profile_key = $1 AND pairings.relay_scope = 'account-block'
       AND NOT EXISTS (
         SELECT 1 FROM ${schema}.heart_rate_watch_connections AS watch_connections
         WHERE watch_connections.pairing_id = pairings.id
       )
     ORDER BY pairings.created_at DESC, pairings.id DESC
     LIMIT 20`,
    [ownerProfileKey],
  );
  return result.rows.map((row) => heartRateAccountBlockStatus(
    heartRatePairingFromRow(row),
    row.stream_id ? heartRateStreamFromRow({
      ...row,
      id: row.stream_id,
      started_at: row.stream_started_at,
      ended_at: row.stream_ended_at,
      finalized_at: row.stream_finalized_at,
      updated_at: row.stream_updated_at,
    }) : null,
    row.latest_recorded_at ? {
      recordedAt: new Date(row.latest_recorded_at).getTime(),
      receivedAt: new Date(row.latest_received_at).getTime(),
    } : null,
    now,
  )).filter(Boolean);
}

export async function loadHeartRatePairings(ownerProfileKey) {
  if (!pool) {
    return [...memoryHeartRatePairings.values()]
      .filter((pairing) => pairing.ownerProfileKey === ownerProfileKey)
      .sort((left, right) => right.createdAt - left.createdAt)
      .map(publicMemoryHeartRatePairing);
  }
  const result = await query(
    `SELECT * FROM ${schema}.heart_rate_pairings
     WHERE owner_profile_key = $1
     ORDER BY created_at DESC, id DESC
     LIMIT 500`,
    [ownerProfileKey],
  );
  return (result?.rows ?? []).map(heartRatePairingFromRow).filter(Boolean);
}

export async function loadHeartRatePairingById(ownerProfileKey, pairingId) {
  if (!pool) {
    const pairing = memoryHeartRatePairings.get(pairingId);
    return pairing?.ownerProfileKey === ownerProfileKey ? publicMemoryHeartRatePairing(pairing) : null;
  }
  const result = await query(
    `SELECT * FROM ${schema}.heart_rate_pairings
     WHERE id = $1 AND owner_profile_key = $2
     LIMIT 1`,
    [pairingId, ownerProfileKey],
  );
  return heartRatePairingFromRow(result?.rows?.[0]);
}

export async function loadHeartRatePairingClaimOwner(pairCodeHash, now = Date.now()) {
  if (!pool) {
    const pairingId = memoryHeartRatePairingIdByCodeHash.get(pairCodeHash);
    const pairing = pairingId ? memoryHeartRatePairings.get(pairingId) : null;
    if (
      !pairing
      || pairing.claimedAt != null
      || pairing.revokedAt != null
      || pairing.pairCodeExpiresAt <= now
    ) return null;
    return pairing.ownerProfileKey;
  }
  const result = await query(
    `SELECT owner_profile_key
     FROM ${schema}.heart_rate_pairings
     WHERE pair_code_hash = $1
       AND claimed_at IS NULL
       AND revoked_at IS NULL
       AND pair_code_expires_at > to_timestamp($2 / 1000.0)
     LIMIT 1`,
    [pairCodeHash, now],
  );
  return typeof result?.rows?.[0]?.owner_profile_key === 'string'
    ? result.rows[0].owner_profile_key
    : null;
}

export async function claimHeartRatePairing(
  pairCodeHash,
  ingestTokenHash,
  now,
  ingestExpiresAt,
  studioBlockIngestExpiresAt = ingestExpiresAt,
  expectedOwnerProfileKey = null,
) {
  if (!pool) {
    const pairingId = memoryHeartRatePairingIdByCodeHash.get(pairCodeHash);
    const pairing = pairingId ? memoryHeartRatePairings.get(pairingId) : null;
    if (
      !pairing
      || pairing.claimedAt != null
      || pairing.revokedAt != null
      || pairing.pairCodeExpiresAt <= now
      || (expectedOwnerProfileKey && pairing.ownerProfileKey !== expectedOwnerProfileKey)
      || memoryHeartRatePairingIdByTokenHash.has(ingestTokenHash)
    ) return null;
    pairing.ingestTokenHash = ingestTokenHash;
    pairing.ingestExpiresAt = (
      pairing.relayScope === 'studio-block'
      || pairing.relayScope === 'account-block'
    )
      ? studioBlockIngestExpiresAt
      : ingestExpiresAt;
    pairing.claimedAt = now;
    pairing.updatedAt = now;
    memoryHeartRatePairingIdByTokenHash.set(ingestTokenHash, pairing.id);
    return publicMemoryHeartRatePairing(pairing);
  }
  const result = await query(
    `UPDATE ${schema}.heart_rate_pairings
     SET ingest_token_hash = $2,
       ingest_expires_at = to_timestamp((CASE
         WHEN relay_scope IN ('studio-block', 'account-block') THEN $5
         ELSE $4
       END) / 1000.0),
       claimed_at = to_timestamp($3 / 1000.0),
       updated_at = now()
     WHERE pair_code_hash = $1
       AND ($6::text IS NULL OR owner_profile_key = $6)
       AND claimed_at IS NULL
       AND revoked_at IS NULL
       AND pair_code_expires_at > to_timestamp($3 / 1000.0)
     RETURNING *`,
    [
      pairCodeHash,
      ingestTokenHash,
      now,
      ingestExpiresAt,
      studioBlockIngestExpiresAt,
      expectedOwnerProfileKey,
    ],
  );
  return heartRatePairingFromRow(result?.rows?.[0]);
}

export async function loadHeartRatePairingByIngestTokenHash(ingestTokenHash, now = Date.now()) {
  if (!pool) {
    const pairingId = memoryHeartRatePairingIdByTokenHash.get(ingestTokenHash);
    const pairing = pairingId ? memoryHeartRatePairings.get(pairingId) : null;
    if (
      !pairing
      || pairing.revokedAt != null
      || !pairing.ingestExpiresAt
      || pairing.ingestExpiresAt <= now
      || (
        pairing.accountBlockStopRequestedAt != null
        && (pairing.accountBlockDrainExpiresAt ?? 0) <= now
      )
    ) return null;
    return publicMemoryHeartRatePairing(pairing);
  }
  const result = await query(
    `SELECT * FROM ${schema}.heart_rate_pairings
     WHERE ingest_token_hash = $1
       AND claimed_at IS NOT NULL
       AND revoked_at IS NULL
       AND ingest_expires_at > to_timestamp($2 / 1000.0)
       AND (
         account_block_stop_requested_at IS NULL
         OR account_block_drain_expires_at > to_timestamp($2 / 1000.0)
       )
     LIMIT 1`,
    [ingestTokenHash, now],
  );
  return heartRatePairingFromRow(result?.rows?.[0]);
}

export async function updateHeartRatePairingConsent(
  ownerProfileKey,
  pairingId,
  { liveStudioConsent, sessionStudioConsent },
) {
  if (!pool) {
    const pairing = memoryHeartRatePairings.get(pairingId);
    if (!pairing || pairing.ownerProfileKey !== ownerProfileKey || pairing.revokedAt != null) return null;
    if (
      (pairing.studioBlockStoppedAt != null || pairing.accountBlockStopRequestedAt != null)
      && (liveStudioConsent || sessionStudioConsent)
    ) return null;
    pairing.liveStudioConsent = Boolean(liveStudioConsent);
    pairing.sessionStudioConsent = Boolean(sessionStudioConsent);
    pairing.updatedAt = Date.now();
    const streamId = memoryHeartRateStreamIdByPairingId.get(pairing.id);
    const stream = streamId ? memoryHeartRateStreams.get(streamId) : null;
    if (stream) {
      stream.liveStudioConsent = pairing.liveStudioConsent;
      stream.sessionStudioConsent = pairing.sessionStudioConsent;
      stream.updatedAt = pairing.updatedAt;
    }
    memoryHeartRateTrainingSegments.forEach((segment) => {
      if (segment.pairingId === pairing.id) {
        segment.studioVisible = pairing.sessionStudioConsent;
        segment.updatedAt = pairing.updatedAt;
      }
    });
    return publicMemoryHeartRatePairing(pairing);
  }
  return withPersistenceLock(`heart-rate-pairing:${pairingId}`, async (client) => {
    const pairingResult = await client.query(
      `UPDATE ${schema}.heart_rate_pairings
       SET live_studio_consent = $3, session_studio_consent = $4, updated_at = now()
       WHERE id = $1 AND owner_profile_key = $2 AND revoked_at IS NULL
         AND (
           studio_block_stopped_at IS NULL
           OR ($3 = false AND $4 = false)
         )
         AND (
           account_block_stop_requested_at IS NULL
           OR ($3 = false AND $4 = false)
         )
       RETURNING *`,
      [pairingId, ownerProfileKey, Boolean(liveStudioConsent), Boolean(sessionStudioConsent)],
    );
    if (!pairingResult.rows[0]) return null;
    await client.query(
      `UPDATE ${schema}.heart_rate_streams
       SET live_studio_consent = $2, session_studio_consent = $3, updated_at = now()
       WHERE pairing_id = $1`,
      [pairingId, Boolean(liveStudioConsent), Boolean(sessionStudioConsent)],
    );
    await client.query(
      `UPDATE ${schema}.heart_rate_training_segments
       SET studio_visible = $2, updated_at = now()
       WHERE pairing_id = $1`,
      [pairingId, Boolean(sessionStudioConsent)],
    );
    return heartRatePairingFromRow(pairingResult.rows[0]);
  });
}

export async function revokeHeartRatePairing(ownerProfileKey, pairingId, revokedAt = Date.now()) {
  if (!pool) {
    const pairing = memoryHeartRatePairings.get(pairingId);
    if (!pairing || pairing.ownerProfileKey !== ownerProfileKey) return null;
    pairing.revokedAt = pairing.revokedAt ?? revokedAt;
    pairing.liveStudioConsent = false;
    pairing.sessionStudioConsent = false;
    pairing.updatedAt = revokedAt;
    const watchConnection = [...memoryHeartRateWatchConnections.values()].find((connection) => (
      connection.pairingId === pairing.id
    ));
    if (watchConnection) {
      stopMemoryHeartRateWatchConnection(watchConnection, revokedAt, 'account-revoked');
    }
    const streamId = memoryHeartRateStreamIdByPairingId.get(pairing.id);
    const stream = streamId ? memoryHeartRateStreams.get(streamId) : null;
    if (stream) {
      stream.liveStudioConsent = false;
      stream.sessionStudioConsent = false;
      stream.updatedAt = revokedAt;
    }
    memoryHeartRateTrainingSegments.forEach((segment) => {
      if (segment.pairingId === pairing.id) {
        segment.studioVisible = false;
        segment.updatedAt = revokedAt;
      }
    });
    return publicMemoryHeartRatePairing(pairing);
  }
  return withPersistenceLock(`heart-rate-pairing:${pairingId}`, async (client) => {
    const result = await client.query(
      `UPDATE ${schema}.heart_rate_pairings
       SET revoked_at = COALESCE(revoked_at, to_timestamp($3 / 1000.0)),
         live_studio_consent = false, session_studio_consent = false,
         updated_at = now()
       WHERE id = $1 AND owner_profile_key = $2
       RETURNING *`,
      [pairingId, ownerProfileKey, revokedAt],
    );
    if (!result.rows[0]) return null;
    await client.query(
      `UPDATE ${schema}.heart_rate_watch_connections
       SET stopped_at = COALESCE(
           stopped_at,
           LEAST(connected_until, GREATEST(connected_at, to_timestamp($2 / 1000.0)))
         ),
         stopped_reason = COALESCE(stopped_reason, 'account-revoked'),
         updated_at = to_timestamp($2 / 1000.0)
       WHERE pairing_id = $1`,
      [pairingId, revokedAt],
    );
    await client.query(
      `UPDATE ${schema}.heart_rate_streams
       SET live_studio_consent = false, session_studio_consent = false,
         updated_at = to_timestamp($2 / 1000.0)
       WHERE pairing_id = $1`,
      [pairingId, revokedAt],
    );
    await client.query(
      `UPDATE ${schema}.heart_rate_training_segments
       SET studio_visible = false, updated_at = now()
       WHERE pairing_id = $1`,
      [pairingId],
    );
    return heartRatePairingFromRow(result.rows[0]);
  });
}

export async function requestHeartRateAccountBlockStop(
  ownerProfileKey,
  pairingId,
  requestedAt = Date.now(),
  drainExpiresAt = requestedAt + 10 * 60 * 1000,
) {
  if (!pool) {
    const pairing = memoryHeartRatePairings.get(pairingId);
    if (
      !pairing
      || pairing.ownerProfileKey !== ownerProfileKey
      || pairing.relayScope !== 'account-block'
      || [...memoryHeartRateWatchConnections.values()].some((connection) => (
        connection.pairingId === pairing.id
      ))
    ) return null;
    if (pairing.revokedAt != null) {
      return { pairing: publicMemoryHeartRatePairing(pairing), draining: false };
    }
    const streamId = memoryHeartRateStreamIdByPairingId.get(pairing.id);
    const stream = streamId ? memoryHeartRateStreams.get(streamId) : null;
    if (!stream || stream.finalizedAt != null) {
      pairing.revokedAt = pairing.revokedAt ?? requestedAt;
      pairing.updatedAt = requestedAt;
      return { pairing: publicMemoryHeartRatePairing(pairing), draining: false };
    }
    pairing.accountBlockStopRequestedAt ??= requestedAt;
    pairing.accountBlockDrainExpiresAt ??= drainExpiresAt;
    pairing.updatedAt = requestedAt;
    stream.accountBlockStopRequestedAt = pairing.accountBlockStopRequestedAt;
    stream.accountBlockDrainExpiresAt = pairing.accountBlockDrainExpiresAt;
    stream.updatedAt = requestedAt;
    return { pairing: publicMemoryHeartRatePairing(pairing), draining: true };
  }
  return withPersistenceLock(`heart-rate-account-block-stop:${pairingId}`, async (client) => {
    const pairingResult = await client.query(
      `SELECT pairings.* FROM ${schema}.heart_rate_pairings AS pairings
       WHERE pairings.id = $1 AND pairings.owner_profile_key = $2
         AND pairings.relay_scope = 'account-block'
         AND NOT EXISTS (
           SELECT 1 FROM ${schema}.heart_rate_watch_connections AS watch_connections
           WHERE watch_connections.pairing_id = pairings.id
         )
       LIMIT 1 FOR UPDATE`,
      [pairingId, ownerProfileKey],
    );
    const pairing = heartRatePairingFromRow(pairingResult.rows[0]);
    if (!pairing) return null;
    if (pairing.revokedAt != null) return { pairing, draining: false };
    const streamResult = await client.query(
      `SELECT * FROM ${schema}.heart_rate_streams
       WHERE pairing_id = $1 LIMIT 1 FOR UPDATE`,
      [pairingId],
    );
    const stream = heartRateStreamFromRow(streamResult.rows[0]);
    if (!stream || stream.finalizedAt != null) {
      const revoked = await client.query(
        `UPDATE ${schema}.heart_rate_pairings
         SET revoked_at = COALESCE(revoked_at, to_timestamp($3 / 1000.0)),
           updated_at = to_timestamp($3 / 1000.0)
         WHERE id = $1 AND owner_profile_key = $2
         RETURNING *`,
        [pairingId, ownerProfileKey, requestedAt],
      );
      return {
        pairing: heartRatePairingFromRow(revoked.rows[0]),
        draining: false,
      };
    }
    const stopped = await client.query(
      `UPDATE ${schema}.heart_rate_pairings
       SET account_block_stop_requested_at = COALESCE(
           account_block_stop_requested_at,
           to_timestamp($3 / 1000.0)
         ),
         account_block_drain_expires_at = COALESCE(
           account_block_drain_expires_at,
           to_timestamp($4 / 1000.0)
         ),
         updated_at = to_timestamp($3 / 1000.0)
       WHERE id = $1 AND owner_profile_key = $2
       RETURNING *`,
      [pairingId, ownerProfileKey, requestedAt, drainExpiresAt],
    );
    await client.query(
      `UPDATE ${schema}.heart_rate_streams AS streams
       SET account_block_stop_requested_at = stopped.account_block_stop_requested_at,
         account_block_drain_expires_at = stopped.account_block_drain_expires_at,
         updated_at = to_timestamp($2 / 1000.0)
       FROM ${schema}.heart_rate_pairings AS stopped
       WHERE streams.pairing_id = $1 AND stopped.id = streams.pairing_id`,
      [pairingId, requestedAt],
    );
    return {
      pairing: heartRatePairingFromRow(stopped.rows[0]),
      draining: true,
    };
  });
}

export async function createHeartRateStream(pairingId, ingestTokenHash, streamId, startedAt, now = Date.now()) {
  if (!pool) {
    const pairingIdForToken = memoryHeartRatePairingIdByTokenHash.get(ingestTokenHash);
    const pairing = memoryHeartRatePairings.get(pairingId);
    if (
      !pairing
      || pairingIdForToken !== pairing.id
      || pairing.revokedAt != null
      || !pairing.ingestExpiresAt
      || pairing.ingestExpiresAt <= now
      || (
        pairing.accountBlockStopRequestedAt != null
        && (pairing.accountBlockDrainExpiresAt ?? 0) <= now
      )
      || (
        pairing.accountBlockStopRequestedAt != null
        && startedAt > pairing.accountBlockStopRequestedAt
      )
    ) return null;
    const existingId = memoryHeartRateStreamIdByPairingId.get(pairing.id);
    if (existingId) return cloneJson(memoryHeartRateStreams.get(existingId), null);
    const stream = {
      id: streamId,
      pairingId: pairing.id,
      ownerProfileKey: pairing.ownerProfileKey,
      sessionId: pairing.sessionId,
      activityType: pairing.activityType,
      relayScope: pairing.relayScope || 'session',
      relayExpiresAt: pairing.ingestExpiresAt,
      studioBlockStoppedAt: pairing.studioBlockStoppedAt ?? null,
      accountBlockStopRequestedAt: pairing.accountBlockStopRequestedAt ?? null,
      accountBlockDrainExpiresAt: pairing.accountBlockDrainExpiresAt ?? null,
      riderId: pairing.riderId,
      playerId: pairing.playerId,
      clubId: pairing.clubId,
      studioRiderId: pairing.studioRiderId,
      liveStudioConsent: pairing.liveStudioConsent,
      sessionStudioConsent: pairing.sessionStudioConsent,
      source: 'apple-watch',
      startedAt,
      endedAt: null,
      activeDurationMs: null,
      summary: {},
      zoneSummaries: [],
      finalizedAt: null,
      trainingSessionId: memoryTrainingSessions.has(`${pairing.ownerProfileKey}:${pairing.sessionId}`)
        ? pairing.sessionId
        : null,
      createdAt: now,
      updatedAt: now,
    };
    memoryHeartRateStreams.set(stream.id, stream);
    memoryHeartRateStreamIdByPairingId.set(pairing.id, stream.id);
    memoryHeartRateSamplesByStreamId.set(stream.id, new Map());
    await reconcileHeartRateTrainingSegmentBindingsForStream(stream.id, now);
    return cloneJson(stream, stream);
  }
  const inserted = await query(
    `INSERT INTO ${schema}.heart_rate_streams (
       id, pairing_id, owner_profile_key, session_id, activity_type, rider_id, player_id,
       relay_scope, relay_expires_at, studio_block_stopped_at, club_id, studio_rider_id,
       account_block_stop_requested_at, account_block_drain_expires_at,
       live_studio_consent, session_studio_consent,
       started_at, created_at, updated_at
     )
     SELECT $3, pairings.id, pairings.owner_profile_key, pairings.session_id,
       pairings.activity_type, pairings.rider_id, pairings.player_id, pairings.relay_scope,
       pairings.ingest_expires_at, pairings.studio_block_stopped_at,
       pairings.club_id, pairings.studio_rider_id,
       pairings.account_block_stop_requested_at, pairings.account_block_drain_expires_at,
       pairings.live_studio_consent,
       pairings.session_studio_consent, to_timestamp($4 / 1000.0),
       to_timestamp($5 / 1000.0), to_timestamp($5 / 1000.0)
     FROM ${schema}.heart_rate_pairings AS pairings
     WHERE pairings.id = $1
       AND pairings.ingest_token_hash = $2
       AND pairings.revoked_at IS NULL
       AND pairings.ingest_expires_at > to_timestamp($5 / 1000.0)
       AND (
         pairings.account_block_stop_requested_at IS NULL
         OR to_timestamp($4 / 1000.0) <= pairings.account_block_stop_requested_at
       )
     ON CONFLICT (pairing_id) DO NOTHING
     RETURNING *`,
    [pairingId, ingestTokenHash, streamId, startedAt, now],
  );
  if (inserted?.rows?.[0]) {
    const created = heartRateStreamFromRow(inserted.rows[0]);
    await linkHeartRateStreamsToTrainingSession(created.ownerProfileKey, created.sessionId);
    await reconcileHeartRateTrainingSegmentBindingsForStream(created.id, now);
    return loadHeartRateStreamForIngestToken(created.id, ingestTokenHash, now);
  }
  return loadHeartRateStreamForIngestToken(null, ingestTokenHash, now, pairingId);
}

export async function loadHeartRateStreamForIngestToken(
  streamId,
  ingestTokenHash,
  now = Date.now(),
  pairingId = null,
) {
  if (!pool) {
    const pairingIdForToken = memoryHeartRatePairingIdByTokenHash.get(ingestTokenHash);
    const pairing = pairingIdForToken ? memoryHeartRatePairings.get(pairingIdForToken) : null;
    const resolvedStreamId = streamId || (pairing ? memoryHeartRateStreamIdByPairingId.get(pairing.id) : null);
    const stream = resolvedStreamId ? memoryHeartRateStreams.get(resolvedStreamId) : null;
    if (
      !pairing
      || !stream
      || stream.pairingId !== pairing.id
      || (pairingId && stream.pairingId !== pairingId)
      || pairing.revokedAt != null
      || !pairing.ingestExpiresAt
      || pairing.ingestExpiresAt <= now
      || (
        pairing.accountBlockStopRequestedAt != null
        && (pairing.accountBlockDrainExpiresAt ?? 0) <= now
      )
    ) return null;
    return cloneJson(stream, stream);
  }
  const result = await query(
    `SELECT streams.*
     FROM ${schema}.heart_rate_streams AS streams
     JOIN ${schema}.heart_rate_pairings AS pairings ON pairings.id = streams.pairing_id
     WHERE ($1::text IS NULL OR streams.id = $1)
       AND ($4::text IS NULL OR streams.pairing_id = $4)
       AND pairings.ingest_token_hash = $2
       AND pairings.revoked_at IS NULL
       AND pairings.ingest_expires_at > to_timestamp($3 / 1000.0)
       AND (
         pairings.account_block_stop_requested_at IS NULL
         OR pairings.account_block_drain_expires_at > to_timestamp($3 / 1000.0)
       )
     ORDER BY streams.created_at DESC
     LIMIT 1`,
    [streamId || null, ingestTokenHash, now, pairingId],
  );
  return heartRateStreamFromRow(result?.rows?.[0]);
}

export async function insertHeartRateSamples(streamId, ingestTokenHash, samples, now = Date.now()) {
  if (!Array.isArray(samples) || samples.length === 0) return [];
  if (!pool) {
    const stream = await loadHeartRateStreamForIngestToken(streamId, ingestTokenHash, now);
    if (!stream || stream.finalizedAt != null) return [];
    const stored = memoryHeartRateSamplesByStreamId.get(streamId) ?? new Map();
    const accepted = [];
    samples.forEach((sample) => {
      if (stored.has(sample.sequence)) return;
      stored.set(sample.sequence, {
        ...cloneJson(sample, sample),
        // Kept internal so a second signed-in device can bootstrap the same
        // freshness window as the live event without exposing server metadata
        // through the raw-sample history endpoint.
        _receivedAt: now,
      });
      accepted.push(sample.sequence);
    });
    memoryHeartRateSamplesByStreamId.set(streamId, stored);
    if (accepted.length > 0) {
      const memoryStream = memoryHeartRateStreams.get(streamId);
      if (memoryStream) memoryStream.updatedAt = now;
    }
    return accepted;
  }
  const params = [streamId, ingestTokenHash, now];
  const values = samples.map((sample) => {
    const offset = params.length;
    params.push(sample.sequence, sample.recordedAt, sample.activeElapsedMs, sample.bpm);
    return `($${offset + 1}::bigint, to_timestamp($${offset + 2} / 1000.0), $${offset + 3}::bigint, $${offset + 4}::smallint)`;
  });
  const result = await query(
    `WITH active_stream AS (
       SELECT streams.id
       FROM ${schema}.heart_rate_streams AS streams
       JOIN ${schema}.heart_rate_pairings AS pairings ON pairings.id = streams.pairing_id
       WHERE streams.id = $1
         AND streams.finalized_at IS NULL
         AND pairings.ingest_token_hash = $2
         AND pairings.revoked_at IS NULL
         AND pairings.ingest_expires_at > to_timestamp($3 / 1000.0)
         AND (
           pairings.account_block_stop_requested_at IS NULL
           OR pairings.account_block_drain_expires_at > to_timestamp($3 / 1000.0)
         )
     ), incoming(sequence, recorded_at, active_elapsed_ms, bpm) AS (
       VALUES ${values.join(', ')}
     )
     INSERT INTO ${schema}.heart_rate_samples (
       stream_id, sequence, recorded_at, active_elapsed_ms, bpm
     )
     SELECT active_stream.id, incoming.sequence, incoming.recorded_at,
       incoming.active_elapsed_ms, incoming.bpm
     FROM active_stream CROSS JOIN incoming
     ON CONFLICT (stream_id, sequence) DO NOTHING
     RETURNING sequence`,
    params,
  );
  const accepted = (result?.rows ?? []).map((row) => Number(row.sequence));
  if (accepted.length > 0) {
    await query(
      `UPDATE ${schema}.heart_rate_streams
       SET updated_at = to_timestamp($2 / 1000.0)
       WHERE id = $1`,
      [streamId, now],
    );
  }
  return accepted;
}

export async function loadHeartRateSamples(streamId) {
  if (!pool) {
    return [...(memoryHeartRateSamplesByStreamId.get(streamId)?.values() ?? [])]
      .sort((left, right) => left.activeElapsedMs - right.activeElapsedMs || left.sequence - right.sequence)
      .map((sample) => {
        const { _receivedAt: _privateReceivedAt, ...visible } = sample;
        return cloneJson(visible, visible);
      });
  }
  const result = await query(
    `SELECT sequence, recorded_at, active_elapsed_ms, bpm
     FROM ${schema}.heart_rate_samples
     WHERE stream_id = $1
     ORDER BY active_elapsed_ms, sequence`,
    [streamId],
  );
  return (result?.rows ?? []).map(heartRateSampleFromRow).filter(Boolean);
}

export async function loadLatestHeartRateSample(streamId) {
  if (!pool) {
    const samples = [...(memoryHeartRateSamplesByStreamId.get(streamId)?.values() ?? [])];
    if (samples.length === 0) return null;
    const latest = samples.reduce((current, sample) => (
      sample.sequence > current.sequence ? sample : current
    ), samples[0]);
    const { _receivedAt: _privateReceivedAt, ...visible } = latest;
    return cloneJson(visible, visible);
  }
  const result = await query(
    `SELECT sequence, recorded_at, active_elapsed_ms, bpm
     FROM ${schema}.heart_rate_samples
     WHERE stream_id = $1
     ORDER BY sequence DESC
     LIMIT 1`,
    [streamId],
  );
  return heartRateSampleFromRow(result?.rows?.[0]);
}

const recentHeartRateSamplesSql = `SELECT sequence, recorded_at, active_elapsed_ms, bpm, received_at
  FROM (
    SELECT DISTINCT ON (recorded_at)
      sequence, recorded_at, active_elapsed_ms, bpm, received_at
    FROM ${schema}.heart_rate_samples
    WHERE stream_id = $1
      AND recorded_at >= received_at - interval '10 seconds'
      AND recorded_at <= received_at + interval '2 seconds'
      AND (
        $3::double precision IS NULL
        OR recorded_at < to_timestamp($3 / 1000.0)
        OR ($4::boolean AND recorded_at = to_timestamp($3 / 1000.0))
      )
      AND NOT (sequence = ANY($5::bigint[]))
    ORDER BY recorded_at, received_at, sequence
  ) AS valid_unique_clock
  ORDER BY recorded_at DESC, sequence DESC
  LIMIT $2`;

function recentHeartRateSamplesFromRows(rows) {
  return (rows ?? []).map((row) => {
    const sample = heartRateSampleFromRow(row);
    return sample ? { ...sample, _receivedAt: new Date(row.received_at).getTime() } : null;
  }).filter(Boolean).reverse();
}

async function loadRecentHeartRateSamplesWithQuery(
  execute,
  streamId,
  boundedLimit,
  upperRecordedAt,
  includeUpperBound,
  excludedSequences,
) {
  const result = await execute(recentHeartRateSamplesSql, [
    streamId,
    boundedLimit,
    upperRecordedAt,
    includeUpperBound,
    excludedSequences,
  ]);
  return recentHeartRateSamplesFromRows(result?.rows);
}

/** Private bounded window used for server/Watch recovery-decision parity. */
export async function loadRecentHeartRateSamples(
  streamId,
  limit = 5,
  upperRecordedAt = null,
  includeUpperBound = false,
  excludedSequences = [],
) {
  const boundedLimit = Math.max(2, Math.min(5, Math.round(Number(limit) || 5)));
  const boundedUpperRecordedAt = Number.isFinite(Number(upperRecordedAt))
    ? Number(upperRecordedAt)
    : null;
  const excluded = new Set(
    excludedSequences.filter((sequence) => Number.isSafeInteger(Number(sequence))).map(Number),
  );
  if (!pool) {
    const valid = [...(memoryHeartRateSamplesByStreamId.get(streamId)?.values() ?? [])]
      .filter((sample) => {
        const originalReceivedAt = Number(sample._receivedAt);
        return (
          boundedUpperRecordedAt == null
          || sample.recordedAt < boundedUpperRecordedAt
          || (includeUpperBound && sample.recordedAt === boundedUpperRecordedAt)
        )
          && !excluded.has(Number(sample.sequence))
          && Number.isFinite(originalReceivedAt)
          && sample.recordedAt >= originalReceivedAt - recoveryHeartRateFreshnessMs
          && sample.recordedAt <= originalReceivedAt + recoveryHeartRateFutureSkewMs;
      }).sort((left, right) => (
        left.recordedAt - right.recordedAt
        || Number(left._receivedAt) - Number(right._receivedAt)
        || left.sequence - right.sequence
      ));
    const firstValidByRecordedAt = new Map();
    valid.forEach((sample) => {
      if (!firstValidByRecordedAt.has(sample.recordedAt)) {
        firstValidByRecordedAt.set(sample.recordedAt, sample);
      }
    });
    return [...firstValidByRecordedAt.values()]
      .sort((left, right) => right.recordedAt - left.recordedAt || right.sequence - left.sequence)
      .slice(0, boundedLimit)
      .reverse()
      .map((sample) => cloneJson(sample, sample));
  }
  return loadRecentHeartRateSamplesWithQuery(
    query,
    streamId,
    boundedLimit,
    boundedUpperRecordedAt,
    Boolean(includeUpperBound),
    [...excluded],
  );
}

/**
 * Returns one freshness-bounded owner reading for cross-device recovery.
 * This deliberately projects one sample only: no pairing/enrollment identity,
 * ingest credential, profile key, or raw sample history leaves persistence.
 */
export async function loadLatestHeartRateLiveReading(
  ownerProfileKey,
  freshAfter,
  now = Date.now(),
) {
  if (!pool) {
    const candidates = [];
    for (const stream of memoryHeartRateStreams.values()) {
      if (
        stream.ownerProfileKey !== ownerProfileKey
        || stream.finalizedAt != null
        || stream.studioBlockStoppedAt != null
        || (stream.relayExpiresAt ?? 0) <= now
        || (
          stream.accountBlockStopRequestedAt != null
          && stream.accountBlockStopRequestedAt <= now
        )
      ) continue;
      const pairing = memoryHeartRatePairings.get(stream.pairingId);
      if (
        !pairing
        || pairing.ownerProfileKey !== ownerProfileKey
        || pairing.claimedAt == null
        || pairing.revokedAt != null
        || (pairing.ingestExpiresAt ?? 0) <= now
        || pairing.studioBlockStoppedAt != null
        || (
          pairing.accountBlockStopRequestedAt != null
          && pairing.accountBlockStopRequestedAt <= now
        )
      ) continue;
      const samples = [...(memoryHeartRateSamplesByStreamId.get(stream.id)?.values() ?? [])];
      if (samples.length === 0) continue;
      const sample = samples.reduce((current, candidate) => (
        candidate.sequence > current.sequence ? candidate : current
      ), samples[0]);
      const receivedAt = Number(sample._receivedAt);
      if (
        !Number.isFinite(receivedAt)
        || receivedAt > now + 60_000
        || sample.recordedAt <= receivedAt - 10_000
        || sample.recordedAt > receivedAt + 2_000
        || sample.recordedAt <= freshAfter
        || sample.recordedAt > now + 2_000
      ) continue;
      candidates.push({ stream, sample, receivedAt });
    }
    const latest = candidates.sort((left, right) => (
      right.receivedAt - left.receivedAt
      || right.sample.sequence - left.sample.sequence
    ))[0];
    if (!latest) return null;
    return cloneJson({
      streamId: latest.stream.id,
      sessionId: latest.stream.sessionId,
      relayScope: latest.stream.relayScope || 'session',
      riderId: latest.stream.riderId,
      playerId: latest.stream.playerId ?? null,
      bpm: latest.sample.bpm,
      recordedAt: latest.sample.recordedAt,
      activeElapsedMs: latest.sample.activeElapsedMs,
      receivedAt: latest.receivedAt,
    }, null);
  }

  const result = await query(
    `SELECT streams.id AS stream_id, streams.session_id, streams.relay_scope,
       streams.rider_id, streams.player_id, samples.bpm, samples.recorded_at,
       samples.active_elapsed_ms, samples.received_at
     FROM ${schema}.heart_rate_streams AS streams
     JOIN ${schema}.heart_rate_pairings AS pairings
       ON pairings.id = streams.pairing_id
     JOIN LATERAL (
       SELECT bpm, recorded_at, active_elapsed_ms, received_at, sequence
       FROM ${schema}.heart_rate_samples
       WHERE stream_id = streams.id
       ORDER BY sequence DESC
       LIMIT 1
     ) AS samples ON true
     WHERE streams.owner_profile_key = $1
       AND pairings.owner_profile_key = $1
       AND streams.finalized_at IS NULL
       AND streams.studio_block_stopped_at IS NULL
       AND pairings.studio_block_stopped_at IS NULL
       AND pairings.claimed_at IS NOT NULL
       AND pairings.revoked_at IS NULL
       AND COALESCE(streams.relay_expires_at, pairings.ingest_expires_at) > to_timestamp($3 / 1000.0)
       AND pairings.ingest_expires_at > to_timestamp($3 / 1000.0)
       AND (
         streams.account_block_stop_requested_at IS NULL
         OR streams.account_block_stop_requested_at > to_timestamp($3 / 1000.0)
       )
       AND (
         pairings.account_block_stop_requested_at IS NULL
         OR pairings.account_block_stop_requested_at > to_timestamp($3 / 1000.0)
       )
       AND samples.recorded_at > to_timestamp($2 / 1000.0)
       AND samples.recorded_at <= to_timestamp(($3 + 2000) / 1000.0)
       AND samples.recorded_at > samples.received_at - interval '10 seconds'
       AND samples.recorded_at <= samples.received_at + interval '2 seconds'
       AND samples.received_at <= to_timestamp(($3 + 60000) / 1000.0)
     ORDER BY samples.received_at DESC, samples.sequence DESC
     LIMIT 1`,
    [ownerProfileKey, freshAfter, now],
  );
  const row = result?.rows?.[0];
  if (!row) return null;
  return {
    streamId: row.stream_id,
    sessionId: row.session_id,
    relayScope: row.relay_scope || 'session',
    riderId: row.rider_id,
    playerId: row.player_id == null ? null : Number(row.player_id),
    bpm: Number(row.bpm),
    recordedAt: new Date(row.recorded_at).getTime(),
    activeElapsedMs: Number(row.active_elapsed_ms),
    receivedAt: new Date(row.received_at).getTime(),
  };
}

/**
 * Consent-gated projection for one claimed athlete selected on one active club
 * tablet session. Account rider IDs and all personal-scope streams are omitted.
 */
export async function loadLatestStudioTabletHeartRateReading({
  athleteProfileKey,
  clubId,
  studioRiderId,
  freshAfter,
  now = Date.now(),
}) {
  if (!pool) {
    const member = memoryClubMembers.get(clubMemberKey(clubId, studioRiderId));
    if (
      member?.status !== 'claimed'
      || member.athleteProfileKey !== athleteProfileKey
    ) return null;
    const candidates = [];
    for (const stream of memoryHeartRateStreams.values()) {
      if (
        stream.ownerProfileKey !== athleteProfileKey
        || stream.relayScope !== 'studio-block'
        || stream.clubId !== clubId
        || stream.studioRiderId !== studioRiderId
        || !stream.liveStudioConsent
        || stream.finalizedAt != null
        || stream.studioBlockStoppedAt != null
        || (stream.relayExpiresAt ?? 0) <= now
        || (
          stream.accountBlockStopRequestedAt != null
          && stream.accountBlockStopRequestedAt <= now
        )
      ) continue;
      const pairing = memoryHeartRatePairings.get(stream.pairingId);
      if (
        !pairing
        || pairing.ownerProfileKey !== athleteProfileKey
        || pairing.relayScope !== 'studio-block'
        || pairing.clubId !== clubId
        || pairing.studioRiderId !== studioRiderId
        || !pairing.liveStudioConsent
        || pairing.claimedAt == null
        || pairing.revokedAt != null
        || pairing.studioBlockStoppedAt != null
        || (pairing.ingestExpiresAt ?? 0) <= now
        || (
          pairing.accountBlockStopRequestedAt != null
          && pairing.accountBlockStopRequestedAt <= now
        )
      ) continue;
      const samples = [...(memoryHeartRateSamplesByStreamId.get(stream.id)?.values() ?? [])];
      if (samples.length === 0) continue;
      const sample = samples.reduce((current, candidate) => (
        candidate.sequence > current.sequence ? candidate : current
      ), samples[0]);
      const receivedAt = Number(sample._receivedAt);
      if (
        !Number.isFinite(receivedAt)
        || receivedAt > now + 60_000
        || sample.recordedAt <= receivedAt - 10_000
        || sample.recordedAt > receivedAt + 2_000
        || sample.recordedAt <= freshAfter
        || sample.recordedAt > now + 2_000
      ) continue;
      candidates.push({ sample, receivedAt });
    }
    const latest = candidates.sort((left, right) => (
      right.receivedAt - left.receivedAt
      || right.sample.sequence - left.sample.sequence
    ))[0];
    return latest ? cloneJson({
      studioRiderId,
      bpm: latest.sample.bpm,
      recordedAt: latest.sample.recordedAt,
      receivedAt: latest.receivedAt,
    }, null) : null;
  }

  const result = await query(
    `SELECT samples.bpm, samples.recorded_at, samples.received_at, samples.sequence
     FROM ${schema}.heart_rate_streams AS streams
     JOIN ${schema}.heart_rate_pairings AS pairings
       ON pairings.id = streams.pairing_id
     JOIN ${schema}.club_members AS members
       ON members.club_id = streams.club_id
       AND members.studio_rider_id = streams.studio_rider_id
     JOIN LATERAL (
       SELECT bpm, recorded_at, received_at, sequence
       FROM ${schema}.heart_rate_samples
       WHERE stream_id = streams.id
       ORDER BY sequence DESC
       LIMIT 1
     ) AS samples ON true
     WHERE streams.owner_profile_key = $1
       AND streams.relay_scope = 'studio-block'
       AND streams.club_id = $2
       AND streams.studio_rider_id = $3
       AND streams.live_studio_consent = true
       AND streams.finalized_at IS NULL
       AND streams.studio_block_stopped_at IS NULL
       AND pairings.owner_profile_key = $1
       AND pairings.relay_scope = 'studio-block'
       AND pairings.club_id = $2
       AND pairings.studio_rider_id = $3
       AND pairings.live_studio_consent = true
       AND pairings.claimed_at IS NOT NULL
       AND pairings.revoked_at IS NULL
       AND pairings.studio_block_stopped_at IS NULL
       AND COALESCE(streams.relay_expires_at, pairings.ingest_expires_at) > to_timestamp($5 / 1000.0)
       AND pairings.ingest_expires_at > to_timestamp($5 / 1000.0)
       AND (
         streams.account_block_stop_requested_at IS NULL
         OR streams.account_block_stop_requested_at > to_timestamp($5 / 1000.0)
       )
       AND (
         pairings.account_block_stop_requested_at IS NULL
         OR pairings.account_block_stop_requested_at > to_timestamp($5 / 1000.0)
       )
       AND members.status = 'claimed'
       AND members.athlete_profile_key = $1
       AND samples.recorded_at > to_timestamp($4 / 1000.0)
       AND samples.recorded_at <= to_timestamp(($5 + 2000) / 1000.0)
       AND samples.recorded_at > samples.received_at - interval '10 seconds'
       AND samples.recorded_at <= samples.received_at + interval '2 seconds'
       AND samples.received_at <= to_timestamp(($5 + 60000) / 1000.0)
     ORDER BY samples.received_at DESC, samples.sequence DESC
     LIMIT 1`,
    [athleteProfileKey, clubId, studioRiderId, freshAfter, now],
  );
  const row = result?.rows?.[0];
  return row ? {
    studioRiderId,
    bpm: Number(row.bpm),
    recordedAt: new Date(row.recorded_at).getTime(),
    receivedAt: new Date(row.received_at).getTime(),
  } : null;
}

export async function finalizeHeartRateStream(
  streamId,
  ingestTokenHash,
  { endedAt, activeDurationMs, summary, zoneSummaries = [], finalizedAt = Date.now() },
) {
  if (!pool) {
    const stream = await loadHeartRateStreamForIngestToken(streamId, ingestTokenHash, finalizedAt);
    if (!stream) return null;
    const stored = memoryHeartRateStreams.get(streamId);
    if (stored.finalizedAt == null) {
      stored.endedAt = endedAt;
      stored.activeDurationMs = activeDurationMs;
      stored.summary = cloneJson(summary, summary);
      stored.zoneSummaries = cloneJson(zoneSummaries, []);
      stored.finalizedAt = finalizedAt;
      stored.updatedAt = finalizedAt;
      if (memoryTrainingSessions.has(`${stored.ownerProfileKey}:${stored.sessionId}`)) {
        stored.trainingSessionId = stored.sessionId;
      }
    }
    await stopHeartRateWatchConnectionForPairing(stored.pairingId, endedAt);
    return cloneJson(stored, stored);
  }
  const result = await query(
    `UPDATE ${schema}.heart_rate_streams AS streams
     SET ended_at = to_timestamp($3 / 1000.0), active_duration_ms = $4,
       summary = $5::jsonb, zone_summaries = $6::jsonb,
       finalized_at = to_timestamp($7 / 1000.0),
       updated_at = now()
     FROM ${schema}.heart_rate_pairings AS pairings
     WHERE streams.id = $1
       AND streams.pairing_id = pairings.id
       AND pairings.ingest_token_hash = $2
       AND pairings.revoked_at IS NULL
       AND pairings.ingest_expires_at > to_timestamp($7 / 1000.0)
       AND (
         pairings.account_block_stop_requested_at IS NULL
         OR pairings.account_block_drain_expires_at > to_timestamp($7 / 1000.0)
       )
       AND streams.finalized_at IS NULL
     RETURNING streams.*`,
    [streamId, ingestTokenHash, endedAt, activeDurationMs, json(summary), json(zoneSummaries), finalizedAt],
  );
  if (result?.rows?.[0]) {
    const finalized = heartRateStreamFromRow(result.rows[0]);
    await linkHeartRateStreamsToTrainingSession(finalized.ownerProfileKey, finalized.sessionId);
    await stopHeartRateWatchConnectionForPairing(finalized.pairingId, endedAt);
    return loadHeartRateStreamForIngestToken(streamId, ingestTokenHash, finalizedAt);
  }
  return loadHeartRateStreamForIngestToken(streamId, ingestTokenHash, finalizedAt);
}

export async function loadHeartRateStreams(ownerProfileKey, sessionId = null) {
  if (!pool) {
    return [...memoryHeartRateStreams.values()]
      .filter((stream) => stream.ownerProfileKey === ownerProfileKey && (!sessionId || stream.sessionId === sessionId))
      .sort((left, right) => right.startedAt - left.startedAt)
      .map((stream) => cloneJson(stream, stream));
  }
  const result = await query(
    `SELECT * FROM ${schema}.heart_rate_streams
     WHERE owner_profile_key = $1 AND ($2::text IS NULL OR session_id = $2)
     ORDER BY started_at DESC, id DESC
     LIMIT 1000`,
    [ownerProfileKey, sessionId || null],
  );
  return (result?.rows ?? []).map(heartRateStreamFromRow).filter(Boolean);
}

export async function loadHeartRateStreamById(ownerProfileKey, streamId) {
  if (!pool) {
    const stream = memoryHeartRateStreams.get(streamId);
    return stream?.ownerProfileKey === ownerProfileKey ? cloneJson(stream, stream) : null;
  }
  const result = await query(
    `SELECT * FROM ${schema}.heart_rate_streams
     WHERE id = $1 AND owner_profile_key = $2
     LIMIT 1`,
    [streamId, ownerProfileKey],
  );
  return heartRateStreamFromRow(result?.rows?.[0]);
}

export async function deleteHeartRateStream(ownerProfileKey, streamId) {
  if (!pool) {
    const stream = memoryHeartRateStreams.get(streamId);
    if (!stream || stream.ownerProfileKey !== ownerProfileKey) return false;
    memoryHeartRateStreams.delete(streamId);
    memoryHeartRateStreamIdByPairingId.delete(stream.pairingId);
    memoryHeartRateSamplesByStreamId.delete(streamId);
    [...memoryHeartRateTrainingSegments.entries()].forEach(([key, segment]) => {
      if (segment.streamId === streamId) memoryHeartRateTrainingSegments.delete(key);
    });
    return true;
  }
  const result = await query(
    `DELETE FROM ${schema}.heart_rate_streams
     WHERE id = $1 AND owner_profile_key = $2
     RETURNING id`,
    [streamId, ownerProfileKey],
  );
  return Boolean(result?.rows?.[0]);
}

export async function loadClubHeartRateStreamSummaries(clubId, sessionId) {
  if (!pool) {
    return [...memoryHeartRateStreams.values()]
      .filter((stream) => (
        stream.clubId === clubId
        && stream.sessionId === sessionId
        && stream.relayScope === 'session'
        && stream.sessionStudioConsent
        && stream.finalizedAt != null
      ))
      .sort((left, right) => left.playerId - right.playerId)
      .map((stream) => cloneJson(stream, stream));
  }
  const result = await query(
    `SELECT * FROM ${schema}.heart_rate_streams
     WHERE club_id = $1 AND session_id = $2
       AND relay_scope = 'session'
       AND session_studio_consent = true AND finalized_at IS NOT NULL
     ORDER BY player_id NULLS LAST, started_at, id`,
    [clubId, sessionId],
  );
  return (result?.rows ?? []).map(heartRateStreamFromRow).filter(Boolean);
}

function heartRateTrainingSegmentId(streamId, trainingSessionId) {
  return `hrseg_${streamId}_${trainingSessionId}`;
}

function memoryHeartRateTrainingSegmentKey(profileKey, trainingSessionId) {
  return `${profileKey}:${trainingSessionId}`;
}

const heartRateTrainingSegmentBindingTtlMs = 24 * 60 * 60 * 1000;

function heartRateTrainingSegmentBinding(options, now = Date.now()) {
  return {
    athleteProfileKey: options.athleteProfileKey,
    relayScope: options.relayScope === 'account-block' ? 'account-block' : 'studio-block',
    clubId: options.clubId ?? null,
    studioRiderId: options.studioRiderId ?? null,
    trainingSessionId: options.trainingSessionId,
    activityType: options.activityType,
    playerId: options.playerId ?? null,
    startedAt: options.startedAt,
    endedAt: options.endedAt,
    zoneWindows: cloneJson(options.zoneWindows ?? [], []),
    activeClockSegments: cloneJson(options.activeClockSegments ?? [], []),
    expiresAt: Math.max(now, options.endedAt) + heartRateTrainingSegmentBindingTtlMs,
    createdAt: now,
    updatedAt: now,
  };
}

function heartRateTrainingSegmentBindingMatches(left, right) {
  return left.athleteProfileKey === right.athleteProfileKey
    && left.relayScope === right.relayScope
    && left.clubId === right.clubId
    && left.studioRiderId === right.studioRiderId
    && left.trainingSessionId === right.trainingSessionId
    && left.activityType === right.activityType
    && left.playerId === right.playerId
    && left.startedAt === right.startedAt
    && left.endedAt === right.endedAt
    && json(left.activeClockSegments ?? []) === json(right.activeClockSegments ?? []);
}

function saveMemoryHeartRateTrainingSegmentBinding(options) {
  const now = options.now ?? Date.now();
  const next = heartRateTrainingSegmentBinding(options, now);
  const key = memoryHeartRateTrainingSegmentKey(next.athleteProfileKey, next.trainingSessionId);
  const existing = memoryHeartRateTrainingSegmentBindings.get(key);
  if (existing && !heartRateTrainingSegmentBindingMatches(existing, next)) return null;
  const saved = existing ?? next;
  saved.zoneWindows = cloneJson(next.zoneWindows, []);
  saved.activeClockSegments = cloneJson(next.activeClockSegments, []);
  saved.expiresAt = Math.max(saved.expiresAt, next.expiresAt);
  saved.updatedAt = now;
  memoryHeartRateTrainingSegmentBindings.set(key, saved);
  return cloneJson(saved, saved);
}

async function upsertHeartRateTrainingSegmentBindingWithClient(client, options) {
  const now = options.now ?? Date.now();
  const expiresAt = Math.max(now, options.endedAt) + heartRateTrainingSegmentBindingTtlMs;
  const result = await client.query(
    `INSERT INTO ${schema}.heart_rate_training_segment_bindings (
       training_profile_key, training_session_id, relay_scope, club_id, studio_rider_id,
       activity_type, player_id, started_at, ended_at, zone_windows,
       active_clock_segments, expires_at, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, to_timestamp($8 / 1000.0),
       to_timestamp($9 / 1000.0), $10::jsonb, $11::jsonb, to_timestamp($12 / 1000.0),
       to_timestamp($13 / 1000.0), to_timestamp($13 / 1000.0)
     )
     ON CONFLICT (training_profile_key, training_session_id) DO UPDATE SET
       zone_windows = EXCLUDED.zone_windows,
       active_clock_segments = EXCLUDED.active_clock_segments,
       expires_at = GREATEST(
         ${schema}.heart_rate_training_segment_bindings.expires_at,
         EXCLUDED.expires_at
       ),
       updated_at = EXCLUDED.updated_at
     WHERE ${schema}.heart_rate_training_segment_bindings.relay_scope = EXCLUDED.relay_scope
       AND ${schema}.heart_rate_training_segment_bindings.club_id IS NOT DISTINCT FROM EXCLUDED.club_id
       AND ${schema}.heart_rate_training_segment_bindings.studio_rider_id IS NOT DISTINCT FROM EXCLUDED.studio_rider_id
       AND ${schema}.heart_rate_training_segment_bindings.activity_type = EXCLUDED.activity_type
       AND ${schema}.heart_rate_training_segment_bindings.player_id IS NOT DISTINCT FROM EXCLUDED.player_id
       AND ${schema}.heart_rate_training_segment_bindings.started_at = EXCLUDED.started_at
       AND ${schema}.heart_rate_training_segment_bindings.ended_at = EXCLUDED.ended_at
       AND ${schema}.heart_rate_training_segment_bindings.active_clock_segments = EXCLUDED.active_clock_segments
     RETURNING *`,
    [
      options.athleteProfileKey,
      options.trainingSessionId,
      options.relayScope === 'account-block' ? 'account-block' : 'studio-block',
      options.clubId ?? null,
      options.studioRiderId ?? null,
      options.activityType,
      options.playerId ?? null,
      options.startedAt,
      options.endedAt,
      json(options.zoneWindows ?? []),
      json(options.activeClockSegments ?? []),
      expiresAt,
      now,
    ],
  );
  return result.rows[0] ?? null;
}

function eligibleMemoryStudioBlockStream({
  athleteProfileKey,
  clubId,
  studioRiderId,
  startedAt,
  endedAt,
  now,
}) {
  const member = memoryClubMembers.get(clubMemberKey(clubId, studioRiderId));
  if (
    member?.status !== 'claimed'
    || member.athleteProfileKey !== athleteProfileKey
  ) return null;
  return [...memoryHeartRateStreams.values()]
    .filter((stream) => {
      const pairing = memoryHeartRatePairings.get(stream.pairingId);
      return stream.ownerProfileKey === athleteProfileKey
        && stream.clubId === clubId
        && stream.studioRiderId === studioRiderId
        && stream.relayScope === 'studio-block'
        && stream.startedAt <= endedAt
        && (stream.endedAt == null || stream.endedAt >= startedAt)
        && pairing?.claimedAt != null
        && pairing.revokedAt == null
        && pairing.studioBlockStoppedAt == null
        && stream.studioBlockStoppedAt == null
        && (
          pairing.accountBlockStopRequestedAt == null
          || startedAt < pairing.accountBlockStopRequestedAt
        )
        && stream.sessionStudioConsent
        && (
          stream.finalizedAt != null
          || (
            (stream.relayExpiresAt ?? pairing.ingestExpiresAt ?? 0) > now
            && stream.updatedAt >= now - 30_000
          )
        );
    })
    .sort((left, right) => right.startedAt - left.startedAt)[0] ?? null;
}

function eligibleMemoryAccountBlockStream({
  athleteProfileKey,
  startedAt,
  endedAt,
  now,
}) {
  return [...memoryHeartRateStreams.values()]
    .filter((stream) => {
      const pairing = memoryHeartRatePairings.get(stream.pairingId);
      return stream.ownerProfileKey === athleteProfileKey
        && stream.clubId == null
        && stream.studioRiderId == null
        && stream.relayScope === 'account-block'
        && stream.startedAt <= endedAt
        && (stream.endedAt == null || stream.endedAt >= startedAt)
        && pairing?.ownerProfileKey === athleteProfileKey
        && pairing.relayScope === 'account-block'
        && pairing.claimedAt != null
        && pairing.revokedAt == null
        && (
          pairing.accountBlockStopRequestedAt == null
          || startedAt < pairing.accountBlockStopRequestedAt
        )
        && !pairing.liveStudioConsent
        && !pairing.sessionStudioConsent
        && !stream.liveStudioConsent
        && !stream.sessionStudioConsent
        && (
          stream.finalizedAt != null
          || (
            (stream.relayExpiresAt ?? pairing.ingestExpiresAt ?? 0) > now
            && stream.updatedAt >= now - 30_000
          )
        );
    })
    .sort((left, right) => right.startedAt - left.startedAt)[0] ?? null;
}

function memoryHeartRateAccountBlockPairingAvailable({
  athleteProfileKey,
  startedAt,
  endedAt,
  now = Date.now(),
}) {
  return [...memoryHeartRatePairings.values()].some((pairing) => (
    pairing.ownerProfileKey === athleteProfileKey
    && pairing.relayScope === 'account-block'
    && pairing.clubId == null
    && pairing.studioRiderId == null
    && !pairing.liveStudioConsent
    && !pairing.sessionStudioConsent
    && pairing.revokedAt == null
    && pairing.createdAt <= endedAt
    && (
      pairing.accountBlockStopRequestedAt == null
      || startedAt < pairing.accountBlockStopRequestedAt
    )
    && (
      pairing.claimedAt == null
        ? pairing.pairCodeExpiresAt > now
        : (pairing.ingestExpiresAt ?? 0) > now
    )
  ));
}

function memoryHeartRateStudioBlockPairingAvailable({
  athleteProfileKey,
  clubId,
  studioRiderId,
  startedAt,
  endedAt,
  now = Date.now(),
}) {
  return [...memoryHeartRatePairings.values()].some((pairing) => (
    pairing.ownerProfileKey === athleteProfileKey
    && pairing.relayScope === 'studio-block'
    && pairing.clubId === clubId
    && pairing.studioRiderId === studioRiderId
    && pairing.sessionStudioConsent
    && pairing.claimedAt != null
    && pairing.revokedAt == null
    && pairing.studioBlockStoppedAt == null
    && pairing.createdAt <= endedAt
    && (
      pairing.accountBlockStopRequestedAt == null
      || startedAt < pairing.accountBlockStopRequestedAt
    )
    && (pairing.ingestExpiresAt ?? 0) > now
  ));
}

async function heartRateAccountBlockPairingAvailableWithClient(client, {
  athleteProfileKey,
  startedAt,
  endedAt,
  now = Date.now(),
}) {
  const result = await client.query(
    `SELECT pairings.id
     FROM ${schema}.heart_rate_pairings AS pairings
     WHERE pairings.owner_profile_key = $1
       AND pairings.relay_scope = 'account-block'
       AND pairings.club_id IS NULL
       AND pairings.studio_rider_id IS NULL
       AND pairings.live_studio_consent = false
       AND pairings.session_studio_consent = false
       AND pairings.revoked_at IS NULL
       AND pairings.created_at <= to_timestamp($2 / 1000.0)
       AND (
         pairings.account_block_stop_requested_at IS NULL
         OR to_timestamp($3 / 1000.0) < pairings.account_block_stop_requested_at
       )
       AND (
         (pairings.claimed_at IS NULL AND pairings.pair_code_expires_at > to_timestamp($4 / 1000.0))
         OR (pairings.claimed_at IS NOT NULL AND pairings.ingest_expires_at > to_timestamp($4 / 1000.0))
       )
     ORDER BY pairings.created_at DESC, pairings.id DESC
     LIMIT 1`,
    [athleteProfileKey, endedAt, startedAt, now],
  );
  return Boolean(result.rows[0]);
}

async function heartRateStudioBlockPairingAvailableWithClient(client, {
  athleteProfileKey,
  clubId,
  studioRiderId,
  startedAt,
  endedAt,
  now = Date.now(),
}) {
  const result = await client.query(
    `SELECT pairings.id
     FROM ${schema}.heart_rate_pairings AS pairings
     JOIN ${schema}.club_members AS members
       ON members.club_id = pairings.club_id
       AND members.studio_rider_id = pairings.studio_rider_id
     WHERE pairings.owner_profile_key = $1
       AND pairings.relay_scope = 'studio-block'
       AND pairings.club_id = $2
       AND pairings.studio_rider_id = $3
       AND pairings.session_studio_consent = true
       AND pairings.claimed_at IS NOT NULL
       AND pairings.revoked_at IS NULL
       AND pairings.studio_block_stopped_at IS NULL
       AND pairings.created_at <= to_timestamp($4 / 1000.0)
       AND (
         pairings.account_block_stop_requested_at IS NULL
         OR to_timestamp($5 / 1000.0) < pairings.account_block_stop_requested_at
       )
       AND pairings.ingest_expires_at > to_timestamp($6 / 1000.0)
       AND members.status = 'claimed'
       AND members.athlete_profile_key = $1
     ORDER BY pairings.created_at DESC, pairings.id DESC
     LIMIT 1`,
    [athleteProfileKey, clubId, studioRiderId, endedAt, startedAt, now],
  );
  return Boolean(result.rows[0]);
}

function upsertMemoryHeartRateTrainingSegment({
  relayScope = 'studio-block',
  athleteProfileKey,
  clubId,
  studioRiderId,
  trainingSessionId,
  activityType,
  playerId,
  startedAt,
  endedAt,
  zoneWindows = [],
  activeClockSegments = [],
  now = Date.now(),
}) {
  const stream = relayScope === 'account-block'
    ? eligibleMemoryAccountBlockStream({ athleteProfileKey, startedAt, endedAt, now })
    : eligibleMemoryStudioBlockStream({
      athleteProfileKey,
      clubId,
      studioRiderId,
      startedAt,
      endedAt,
      now,
    });
  if (!stream) return { status: 'no-stream', segment: null };
  const key = memoryHeartRateTrainingSegmentKey(athleteProfileKey, trainingSessionId);
  const existing = memoryHeartRateTrainingSegments.get(key);
  if (existing && existing.streamId !== stream.id) return { status: 'conflict', segment: null };
  const samples = [...(memoryHeartRateSamplesByStreamId.get(stream.id)?.values() ?? [])];
  const summaries = heartRateTrainingSegmentSummaries(
    samples,
    startedAt,
    endedAt,
    zoneWindows,
    activeClockSegments,
  );
  const latestRecordedAt = samples.reduce(
    (latest, sample) => Math.max(latest, sample.recordedAt),
    0,
  );
  const segment = existing ?? {
    id: heartRateTrainingSegmentId(stream.id, trainingSessionId),
    streamId: stream.id,
    pairingId: stream.pairingId,
    ownerProfileKey: athleteProfileKey,
    relayScope,
    clubId: relayScope === 'account-block' ? null : clubId,
    studioRiderId: relayScope === 'account-block' ? null : studioRiderId,
    trainingSessionId,
    activityType,
    playerId,
    startedAt,
    endedAt,
    activeDurationMs: summaries.activeDurationMs,
    activeClockSegments: cloneJson(activeClockSegments, []),
    summary: {},
    zoneSummaries: [],
    finalizedAt: null,
    studioVisible: relayScope === 'studio-block' && Boolean(stream.sessionStudioConsent),
    createdAt: now,
    updatedAt: now,
  };
  Object.assign(segment, {
    activeDurationMs: summaries.activeDurationMs,
    summary: summaries.summary,
    zoneSummaries: summaries.zoneSummaries,
    finalizedAt: segment.finalizedAt ?? (
      stream.finalizedAt != null || latestRecordedAt >= endedAt || now >= endedAt + 15_000
        ? now
        : null
    ),
    studioVisible: relayScope === 'studio-block' && Boolean(stream.sessionStudioConsent),
    updatedAt: now,
  });
  memoryHeartRateTrainingSegments.set(key, segment);
  return { status: existing ? 'updated' : 'created', segment: cloneJson(segment, segment) };
}

async function upsertHeartRateTrainingSegmentWithClient(client, {
  relayScope = 'studio-block',
  athleteProfileKey,
  clubId,
  studioRiderId,
  trainingSessionId,
  activityType,
  playerId,
  startedAt,
  endedAt,
  zoneWindows = [],
  activeClockSegments = [],
  now = Date.now(),
}) {
  const streamResult = relayScope === 'account-block'
    ? await client.query(
      `SELECT streams.*
       FROM ${schema}.heart_rate_streams AS streams
       JOIN ${schema}.heart_rate_pairings AS pairings ON pairings.id = streams.pairing_id
       WHERE streams.owner_profile_key = $1
         AND streams.club_id IS NULL
         AND streams.studio_rider_id IS NULL
         AND streams.relay_scope = 'account-block'
         AND streams.started_at <= to_timestamp($3 / 1000.0)
         AND (streams.ended_at IS NULL OR streams.ended_at >= to_timestamp($2 / 1000.0))
         AND streams.live_studio_consent = false
         AND streams.session_studio_consent = false
         AND pairings.owner_profile_key = $1
         AND pairings.relay_scope = 'account-block'
         AND pairings.club_id IS NULL
         AND pairings.studio_rider_id IS NULL
         AND pairings.live_studio_consent = false
         AND pairings.session_studio_consent = false
         AND pairings.claimed_at IS NOT NULL
         AND pairings.revoked_at IS NULL
         AND (
           pairings.account_block_stop_requested_at IS NULL
           OR to_timestamp($2 / 1000.0) < pairings.account_block_stop_requested_at
         )
         AND (
           streams.finalized_at IS NOT NULL
           OR (
             COALESCE(streams.relay_expires_at, pairings.ingest_expires_at) > to_timestamp($4 / 1000.0)
             AND streams.updated_at >= to_timestamp(($4 - 30000) / 1000.0)
           )
         )
       ORDER BY streams.started_at DESC, streams.id DESC
       LIMIT 1
       FOR UPDATE OF streams`,
      [athleteProfileKey, startedAt, endedAt, now],
    )
    : await client.query(
      `SELECT streams.*
       FROM ${schema}.heart_rate_streams AS streams
       JOIN ${schema}.heart_rate_pairings AS pairings ON pairings.id = streams.pairing_id
       JOIN ${schema}.club_members AS members
         ON members.club_id = streams.club_id
         AND members.studio_rider_id = streams.studio_rider_id
       WHERE streams.owner_profile_key = $1
         AND streams.club_id = $2
         AND streams.studio_rider_id = $3
         AND streams.relay_scope = 'studio-block'
         AND streams.started_at <= to_timestamp($5 / 1000.0)
         AND (streams.ended_at IS NULL OR streams.ended_at >= to_timestamp($4 / 1000.0))
         AND pairings.claimed_at IS NOT NULL
         AND pairings.revoked_at IS NULL
         AND pairings.studio_block_stopped_at IS NULL
         AND streams.studio_block_stopped_at IS NULL
         AND (
           pairings.account_block_stop_requested_at IS NULL
           OR to_timestamp($4 / 1000.0) < pairings.account_block_stop_requested_at
         )
         AND streams.session_studio_consent = true
         AND (
           streams.finalized_at IS NOT NULL
           OR (
             COALESCE(streams.relay_expires_at, pairings.ingest_expires_at) > to_timestamp($6 / 1000.0)
             AND streams.updated_at >= to_timestamp(($6 - 30000) / 1000.0)
           )
         )
         AND members.status = 'claimed'
         AND members.athlete_profile_key = $1
       ORDER BY streams.started_at DESC, streams.id DESC
       LIMIT 1
       FOR UPDATE OF streams`,
      [athleteProfileKey, clubId, studioRiderId, startedAt, endedAt, now],
    );
  const streamRow = streamResult.rows[0];
  if (!streamRow) return { status: 'no-stream', segment: null };
  const stream = heartRateStreamFromRow(streamRow);
  const sampleResult = await client.query(
    `SELECT sequence, recorded_at, active_elapsed_ms, bpm
     FROM ${schema}.heart_rate_samples
     WHERE stream_id = $1
       AND recorded_at >= to_timestamp($2 / 1000.0)
       AND recorded_at <= to_timestamp($3 / 1000.0)
     ORDER BY recorded_at, sequence`,
    [stream.id, startedAt, endedAt],
  );
  const latestSampleResult = await client.query(
    `SELECT recorded_at
     FROM ${schema}.heart_rate_samples
     WHERE stream_id = $1
     ORDER BY recorded_at DESC, sequence DESC
     LIMIT 1`,
    [stream.id],
  );
  const samples = sampleResult.rows.map(heartRateSampleFromRow).filter(Boolean);
  const summaries = heartRateTrainingSegmentSummaries(
    samples,
    startedAt,
    endedAt,
    zoneWindows,
    activeClockSegments,
  );
  const latestRecordedAt = latestSampleResult.rows[0]?.recorded_at
    ? new Date(latestSampleResult.rows[0].recorded_at).getTime()
    : null;
  const finalizedAt = stream.finalizedAt != null
    || (latestRecordedAt != null && latestRecordedAt >= endedAt)
    || now >= endedAt + 15_000
    ? now
    : null;
  const segmentResult = await client.query(
    `INSERT INTO ${schema}.heart_rate_training_segments (
       id, stream_id, pairing_id, owner_profile_key, relay_scope, club_id, studio_rider_id,
       training_profile_key, training_session_id, activity_type, player_id,
       started_at, ended_at, active_duration_ms, active_clock_segments, summary, zone_summaries,
       finalized_at, studio_visible, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $4, $8, $9, $10,
       to_timestamp($11 / 1000.0), to_timestamp($12 / 1000.0), $13, $14::jsonb,
       $15::jsonb, $16::jsonb,
       CASE WHEN $17::bigint IS NULL THEN NULL ELSE to_timestamp($17 / 1000.0) END,
       $18, to_timestamp($19 / 1000.0), to_timestamp($19 / 1000.0)
     )
     ON CONFLICT (training_profile_key, training_session_id) DO UPDATE
       SET summary = EXCLUDED.summary,
         zone_summaries = EXCLUDED.zone_summaries,
         finalized_at = COALESCE(
           ${schema}.heart_rate_training_segments.finalized_at,
           EXCLUDED.finalized_at
         ),
         studio_visible = EXCLUDED.studio_visible,
         updated_at = EXCLUDED.updated_at
       WHERE ${schema}.heart_rate_training_segments.stream_id = EXCLUDED.stream_id
         AND ${schema}.heart_rate_training_segments.active_clock_segments = EXCLUDED.active_clock_segments
     RETURNING *, (xmax = 0) AS inserted`,
    [
      heartRateTrainingSegmentId(stream.id, trainingSessionId),
      stream.id,
      stream.pairingId,
      athleteProfileKey,
      relayScope,
      relayScope === 'account-block' ? null : clubId,
      relayScope === 'account-block' ? null : studioRiderId,
      trainingSessionId,
      activityType,
      playerId ?? null,
      startedAt,
      endedAt,
      summaries.activeDurationMs,
      json(activeClockSegments),
      json(summaries.summary),
      json(summaries.zoneSummaries),
      finalizedAt,
      relayScope === 'studio-block' && Boolean(stream.sessionStudioConsent),
      now,
    ],
  );
  const row = segmentResult.rows[0];
  return row
    ? { status: row.inserted ? 'created' : 'updated', segment: heartRateTrainingSegmentFromRow(row) }
    : { status: 'conflict', segment: null };
}

async function createHeartRateTrainingSegmentForBlockWithClient(client, options) {
  const materialized = await upsertHeartRateTrainingSegmentWithClient(client, options);
  if (materialized.segment) {
    await client.query(
      `DELETE FROM ${schema}.heart_rate_training_segment_bindings
       WHERE training_profile_key = $1 AND training_session_id = $2`,
      [options.athleteProfileKey, options.trainingSessionId],
    );
    return materialized;
  }
  if (materialized.status !== 'no-stream') return materialized;
  if (
    options.relayScope === 'account-block'
    && !(await heartRateAccountBlockPairingAvailableWithClient(client, options))
  ) return { status: 'no-block', segment: null };
  const binding = await upsertHeartRateTrainingSegmentBindingWithClient(client, options);
  return binding
    ? { status: 'pending', segment: null }
    : { status: 'conflict', segment: null };
}

async function createHeartRateTrainingSegmentForBlock(options) {
  if (!pool) {
    const materialized = upsertMemoryHeartRateTrainingSegment(options);
    if (materialized.segment) {
      memoryHeartRateTrainingSegmentBindings.delete(
        memoryHeartRateTrainingSegmentKey(options.athleteProfileKey, options.trainingSessionId),
      );
      return materialized;
    }
    if (materialized.status !== 'no-stream') return materialized;
    if (
      options.relayScope === 'account-block'
      && !memoryHeartRateAccountBlockPairingAvailable(options)
    ) return { status: 'no-block', segment: null };
    const binding = saveMemoryHeartRateTrainingSegmentBinding(options);
    return binding
      ? { status: 'pending', segment: null }
      : { status: 'conflict', segment: null };
  }
  return withPersistenceLock(
    `heart-rate-training-segment:${options.athleteProfileKey}:${options.trainingSessionId}`,
    (client) => createHeartRateTrainingSegmentForBlockWithClient(client, options),
  );
}

export async function createHeartRateTrainingSegmentForClubSession(options) {
  return createHeartRateTrainingSegmentForBlock({
    ...options,
    relayScope: 'studio-block',
  });
}

export async function createHeartRateTrainingSegmentForAccountSession(options) {
  return createHeartRateTrainingSegmentForBlock({
    ...options,
    relayScope: 'account-block',
    clubId: null,
    studioRiderId: null,
  });
}

export async function reconcileHeartRateTrainingSegmentBindingsForStream(streamId, now = Date.now()) {
  if (!pool) {
    const stream = memoryHeartRateStreams.get(streamId);
    if (!stream || !['studio-block', 'account-block'].includes(stream.relayScope)) return [];
    const reconciled = [];
    for (const [key, binding] of memoryHeartRateTrainingSegmentBindings.entries()) {
      if (binding.expiresAt <= now) {
        memoryHeartRateTrainingSegmentBindings.delete(key);
        continue;
      }
      if (
        binding.athleteProfileKey !== stream.ownerProfileKey
        || binding.relayScope !== stream.relayScope
        || (
          stream.relayScope === 'studio-block'
            ? binding.clubId !== stream.clubId || binding.studioRiderId !== stream.studioRiderId
            : binding.clubId != null || binding.studioRiderId != null
        )
        || stream.startedAt > binding.endedAt
        || (stream.endedAt != null && stream.endedAt < binding.startedAt)
      ) continue;
      const materialized = upsertMemoryHeartRateTrainingSegment({ ...binding, now });
      if (materialized.segment) {
        memoryHeartRateTrainingSegmentBindings.delete(key);
        reconciled.push(materialized.segment);
      }
    }
    return reconciled;
  }
  return withPersistenceLock(`heart-rate-segment-reconcile:${streamId}`, async (client) => {
    await client.query(
      `DELETE FROM ${schema}.heart_rate_training_segment_bindings
       WHERE expires_at <= to_timestamp($1 / 1000.0)`,
      [now],
    );
    const bindingResult = await client.query(
      `SELECT bindings.*
       FROM ${schema}.heart_rate_training_segment_bindings AS bindings
       JOIN ${schema}.heart_rate_streams AS streams
         ON streams.id = $1
         AND streams.relay_scope IN ('studio-block', 'account-block')
         AND streams.relay_scope = bindings.relay_scope
         AND streams.owner_profile_key = bindings.training_profile_key
         AND (
           (
             streams.relay_scope = 'studio-block'
             AND streams.club_id = bindings.club_id
             AND streams.studio_rider_id = bindings.studio_rider_id
           ) OR (
             streams.relay_scope = 'account-block'
             AND streams.club_id IS NULL
             AND streams.studio_rider_id IS NULL
             AND bindings.club_id IS NULL
             AND bindings.studio_rider_id IS NULL
           )
         )
         AND streams.started_at <= bindings.ended_at
         AND (streams.ended_at IS NULL OR streams.ended_at >= bindings.started_at)
       WHERE bindings.expires_at > to_timestamp($2 / 1000.0)
       ORDER BY bindings.started_at, bindings.training_session_id
       FOR UPDATE OF bindings`,
      [streamId, now],
    );
    const reconciled = [];
    for (const row of bindingResult.rows) {
      const options = {
        athleteProfileKey: row.training_profile_key,
        relayScope: row.relay_scope || 'studio-block',
        clubId: row.club_id,
        studioRiderId: row.studio_rider_id,
        trainingSessionId: row.training_session_id,
        activityType: row.activity_type,
        playerId: row.player_id == null ? null : Number(row.player_id),
        startedAt: new Date(row.started_at).getTime(),
        endedAt: new Date(row.ended_at).getTime(),
        zoneWindows: fromJson(row.zone_windows, []),
        activeClockSegments: fromJson(row.active_clock_segments, []),
        now,
      };
      const materialized = await upsertHeartRateTrainingSegmentWithClient(client, options);
      if (!materialized.segment) continue;
      await client.query(
        `DELETE FROM ${schema}.heart_rate_training_segment_bindings
         WHERE training_profile_key = $1 AND training_session_id = $2`,
        [options.athleteProfileKey, options.trainingSessionId],
      );
      reconciled.push(materialized.segment);
    }
    return reconciled;
  });
}

export async function refreshHeartRateTrainingSegmentsForStream(streamId, now = Date.now()) {
  if (!pool) {
    const stream = memoryHeartRateStreams.get(streamId);
    if (!stream) return [];
    const segments = [...memoryHeartRateTrainingSegments.values()]
      .filter((segment) => segment.streamId === streamId);
    const samples = [...(memoryHeartRateSamplesByStreamId.get(streamId)?.values() ?? [])];
    const latestRecordedAt = samples.reduce(
      (latest, sample) => Math.max(latest, sample.recordedAt),
      0,
    );
    return segments.map((segment) => {
      const summaries = heartRateTrainingSegmentSummaries(
        samples,
        segment.startedAt,
        segment.endedAt,
        segment.zoneSummaries.map((zone) => ({
          zoneId: zone.zoneId,
          zoneName: zone.zoneName,
          startElapsedMs: zone.startElapsedMs,
          endElapsedMs: zone.endElapsedMs,
        })),
        segment.activeClockSegments ?? [],
      );
      segment.summary = summaries.summary;
      segment.zoneSummaries = summaries.zoneSummaries;
      segment.finalizedAt = segment.finalizedAt ?? (
        stream.finalizedAt != null
        || latestRecordedAt >= segment.endedAt
        || now >= segment.endedAt + 15_000
          ? now
          : null
      );
      segment.studioVisible = stream.relayScope === 'studio-block' && Boolean(stream.sessionStudioConsent);
      segment.updatedAt = now;
      return cloneJson(segment, segment);
    });
  }
  return withPersistenceLock(`heart-rate-segment-refresh:${streamId}`, async (client) => {
    const [streamResult, segmentResult, sampleResult] = await Promise.all([
      client.query(`SELECT * FROM ${schema}.heart_rate_streams WHERE id = $1`, [streamId]),
      client.query(
        `SELECT * FROM ${schema}.heart_rate_training_segments
         WHERE stream_id = $1 ORDER BY started_at, id FOR UPDATE`,
        [streamId],
      ),
      client.query(
        `SELECT sequence, recorded_at, active_elapsed_ms, bpm
         FROM ${schema}.heart_rate_samples
         WHERE stream_id = $1 ORDER BY recorded_at, sequence`,
        [streamId],
      ),
    ]);
    const stream = heartRateStreamFromRow(streamResult.rows[0]);
    if (!stream) return [];
    const samples = sampleResult.rows.map(heartRateSampleFromRow).filter(Boolean);
    const latestRecordedAt = samples.reduce(
      (latest, sample) => Math.max(latest, sample.recordedAt),
      0,
    );
    const refreshed = [];
    for (const row of segmentResult.rows) {
      const existing = heartRateTrainingSegmentFromRow(row);
      const zoneWindows = existing.zoneSummaries.map((zone) => ({
        zoneId: zone.zoneId,
        zoneName: zone.zoneName,
        startElapsedMs: zone.startElapsedMs,
        endElapsedMs: zone.endElapsedMs,
      }));
      const summaries = heartRateTrainingSegmentSummaries(
        samples,
        existing.startedAt,
        existing.endedAt,
        zoneWindows,
        existing.activeClockSegments ?? [],
      );
      const finalizedAt = existing.finalizedAt ?? (
        stream.finalizedAt != null
        || latestRecordedAt >= existing.endedAt
        || now >= existing.endedAt + 15_000
          ? now
          : null
      );
      const updated = await client.query(
        `UPDATE ${schema}.heart_rate_training_segments
         SET summary = $2::jsonb, zone_summaries = $3::jsonb,
           finalized_at = CASE
             WHEN $4::bigint IS NULL THEN finalized_at
             ELSE COALESCE(finalized_at, to_timestamp($4 / 1000.0))
           END,
           studio_visible = $5, updated_at = to_timestamp($6 / 1000.0)
         WHERE id = $1 RETURNING *`,
        [
          existing.id,
          json(summaries.summary),
          json(summaries.zoneSummaries),
          finalizedAt,
          stream.relayScope === 'studio-block' && Boolean(stream.sessionStudioConsent),
          now,
        ],
      );
      refreshed.push(heartRateTrainingSegmentFromRow(updated.rows[0]));
    }
    return refreshed.filter(Boolean);
  });
}

export async function loadHeartRateTrainingSegments(ownerProfileKey, sessionId = null) {
  if (!pool) {
    const now = Date.now();
    memoryHeartRateTrainingSegments.forEach((segment) => {
      if (
        segment.ownerProfileKey === ownerProfileKey
        && segment.finalizedAt == null
        && now >= segment.endedAt + 15_000
      ) {
        segment.finalizedAt = now;
        segment.updatedAt = now;
      }
    });
    return [...memoryHeartRateTrainingSegments.values()]
      .filter((segment) => (
        segment.ownerProfileKey === ownerProfileKey
        && (!sessionId || segment.trainingSessionId === sessionId)
      ))
      .sort((left, right) => right.startedAt - left.startedAt)
      .map((segment) => cloneJson(segment, segment));
  }
  await query(
    `UPDATE ${schema}.heart_rate_training_segments
     SET finalized_at = now(), updated_at = now()
     WHERE owner_profile_key = $1 AND finalized_at IS NULL
       AND ended_at <= now() - interval '15 seconds'`,
    [ownerProfileKey],
  );
  const result = await query(
    `SELECT * FROM ${schema}.heart_rate_training_segments
     WHERE owner_profile_key = $1
       AND ($2::text IS NULL OR training_session_id = $2)
     ORDER BY started_at DESC, id DESC
     LIMIT 1000`,
    [ownerProfileKey, sessionId || null],
  );
  return (result?.rows ?? []).map(heartRateTrainingSegmentFromRow).filter(Boolean);
}

export async function loadClubHeartRateTrainingSegments(clubId, sessionId = null) {
  if (!pool) {
    const now = Date.now();
    memoryHeartRateTrainingSegments.forEach((segment) => {
      if (
        segment.clubId === clubId
        && segment.finalizedAt == null
        && now >= segment.endedAt + 15_000
      ) {
        segment.finalizedAt = now;
        segment.updatedAt = now;
      }
    });
    return [...memoryHeartRateTrainingSegments.values()]
      .filter((segment) => (
        segment.clubId === clubId
        && segment.relayScope === 'studio-block'
        && segment.studioVisible
        && (!sessionId || segment.trainingSessionId === sessionId)
      ))
      .sort((left, right) => right.startedAt - left.startedAt)
      .map((segment) => cloneJson(segment, segment));
  }
  await query(
    `UPDATE ${schema}.heart_rate_training_segments
     SET finalized_at = now(), updated_at = now()
     WHERE club_id = $1 AND finalized_at IS NULL
       AND ended_at <= now() - interval '15 seconds'`,
    [clubId],
  );
  const result = await query(
    `SELECT segments.*
     FROM ${schema}.heart_rate_training_segments AS segments
     JOIN ${schema}.heart_rate_pairings AS pairings ON pairings.id = segments.pairing_id
     WHERE segments.club_id = $1
       AND segments.relay_scope = 'studio-block'
       AND segments.studio_visible = true
       AND pairings.revoked_at IS NULL
       AND ($2::text IS NULL OR segments.training_session_id = $2)
     ORDER BY segments.started_at DESC, segments.id DESC
     LIMIT 1000`,
    [clubId, sessionId || null],
  );
  return (result?.rows ?? []).map(heartRateTrainingSegmentFromRow).filter(Boolean);
}

async function linkHeartRateStreamsToTrainingSession(profileKey, sessionId) {
  if (!pool) {
    memoryHeartRateStreams.forEach((stream) => {
      if (
        stream.ownerProfileKey === profileKey
        && stream.sessionId === sessionId
        && stream.relayScope === 'session'
      ) {
        stream.trainingSessionId = sessionId;
        stream.updatedAt = Date.now();
      }
    });
    return;
  }
  await query(
    `UPDATE ${schema}.heart_rate_streams
     SET training_profile_key = $1, training_session_id = $2, updated_at = now()
     WHERE owner_profile_key = $1 AND session_id = $2
       AND relay_scope = 'session'
       AND EXISTS (
         SELECT 1 FROM ${schema}.training_sessions
         WHERE profile_key = $1 AND id = $2
       )`,
    [profileKey, sessionId],
  );
}

function clubMonitorSprintAuthorizationFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    clubId: row.club_id,
    studioRiderId: row.studio_rider_id,
    ownerProfileKey: row.owner_profile_key,
    athleteProfileKey: row.athlete_profile_key,
    bikeDeviceId: row.bike_device_id,
    sessionId: row.session_id,
    playerId: Number(row.player_id),
    armedAt: new Date(row.armed_at ?? row.started_at).getTime(),
    startedAt: row.started_at ? new Date(row.started_at).getTime() : null,
    activatedAt: row.activated_at ? new Date(row.activated_at).getTime() : null,
    expiresAt: new Date(row.expires_at).getTime(),
    consumedAt: row.consumed_at ? new Date(row.consumed_at).getTime() : null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at).getTime() : null,
    trainingSessionId: row.training_session_id ?? null,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

function publicMemoryClubMonitorSprintAuthorization(authorization) {
  if (!authorization) return null;
  const { tokenHash: _tokenHash, ...publicAuthorization } = authorization;
  return cloneJson(publicAuthorization, publicAuthorization);
}

function clubMonitorTrainingSession(authorization, { clubName, riderName }, result, now) {
  const rider = {
    playerId: authorization.playerId,
    riderId: authorization.studioRiderId,
    studioRiderId: authorization.studioRiderId,
    name: riderName,
    riderName,
    distanceMeters: result.distanceMeters,
    averageWatts: result.averageWatts,
    peakWatts: result.peakWatts,
    averageCadence: result.averageCadence,
    peakCadence: result.peakCadence,
    averageSpeedKph: result.averageSpeedKph,
    peakSpeedKph: result.peakSpeedKph,
  };
  return {
    id: authorization.sessionId,
    activityType: 'monitor-sprint',
    title: 'Monitor View sprint',
    startedAt: result.startedAt,
    endedAt: result.endedAt,
    durationMs: result.endedAt - result.startedAt,
    distanceMeters: result.distanceMeters,
    trackId: 'tracklab-monitor-sprint',
    trackName: 'Monitor View',
    source: 'live',
    details: {
      monitor: {
        source: 'club-owner-assignment',
        bikeDeviceId: authorization.bikeDeviceId,
      },
      riders: [rider],
    },
    createdAt: result.startedAt,
    updatedAt: now,
    _profileKey: authorization.athleteProfileKey,
    _clubId: authorization.clubId,
    _clubName: clubName,
    _studioRiderId: authorization.studioRiderId,
    _clubRiderName: riderName,
  };
}

function clubMonitorSessionMatchesAuthorization(session, authorization) {
  return session?.id === authorization.sessionId
    && session?.activityType === 'monitor-sprint'
    && session?._clubId === authorization.clubId
    && session?._studioRiderId === authorization.studioRiderId;
}

export async function createClubMonitorSprintAuthorization({
  id,
  ownerProfileKey,
  clubId,
  studioRiderId,
  bikeDeviceId,
  sessionId,
  playerId,
  armedAt,
  startedAt = null,
  activatedAt = null,
  tokenHash: authorizationTokenHash,
  expiresAt,
  maximumActiveAssignments,
  now = Date.now(),
}) {
  const maximumActive = Math.max(0, Math.round(Number(maximumActiveAssignments) || 0));
  if (!pool) {
    const club = memoryClubsById.get(clubId);
    const member = memoryClubMembers.get(clubMemberKey(clubId, studioRiderId));
    if (
      !club
      || club.ownerProfileKey !== ownerProfileKey
      || member?.status !== 'claimed'
      || !member.athleteProfileKey
    ) return { status: 'not-claimed', authorization: null };
    const existing = [...memoryClubMonitorSprintAuthorizations.values()].find((candidate) => (
      candidate.clubId === clubId
      && candidate.studioRiderId === studioRiderId
      && candidate.sessionId === sessionId
    ));
    if (existing) {
      if (existing.consumedAt != null || existing.revokedAt != null) {
        return { status: 'session-used', authorization: publicMemoryClubMonitorSprintAuthorization(existing) };
      }
      if (
        existing.ownerProfileKey !== ownerProfileKey
        || existing.bikeDeviceId !== bikeDeviceId
        || existing.playerId !== playerId
        || existing.armedAt !== armedAt
        || (startedAt != null && existing.startedAt != null && existing.startedAt !== startedAt)
        || existing.athleteProfileKey !== member.athleteProfileKey
      ) return { status: 'binding-conflict', authorization: null };
      memoryClubMonitorSprintAuthorizationIdByTokenHash.delete(existing.tokenHash);
      existing.tokenHash = authorizationTokenHash;
      existing.expiresAt = expiresAt;
      existing.updatedAt = now;
      memoryClubMonitorSprintAuthorizationIdByTokenHash.set(authorizationTokenHash, existing.id);
      return { status: 'created', authorization: publicMemoryClubMonitorSprintAuthorization(existing) };
    }
    const activeMonitorAssignments = [...memoryClubMonitorSprintAuthorizations.values()].filter((candidate) => (
      candidate.clubId === clubId
      && candidate.consumedAt == null
      && candidate.revokedAt == null
      && candidate.expiresAt > now
    ));
    releaseExpiredMemoryClubGroupTrainingAuthorizations(clubId, now);
    const activeGroupAssignments = [...memoryClubGroupTrainingAuthorizations.values()]
      .filter((candidate) => (
        candidate.clubId === clubId
        && candidate.completedAt == null
        && candidate.cancelledAt == null
        && candidate.expiresAt > now
      ))
      .flatMap((candidate) => candidate.assignments.filter((assignment) => assignment.releasedAt == null));
    const active = [...activeMonitorAssignments, ...activeGroupAssignments];
    if (active.some((candidate) => candidate.studioRiderId === studioRiderId)) {
      return { status: 'rider-active', authorization: null };
    }
    if (active.some((candidate) => candidate.bikeDeviceId === bikeDeviceId)) {
      return { status: 'bike-active', authorization: null };
    }
    if (active.length >= maximumActive) return { status: 'capacity', authorization: null };
    if (memoryClubMonitorSprintAuthorizationIdByTokenHash.has(authorizationTokenHash)) return null;
    const authorization = {
      id,
      ownerProfileKey,
      clubId,
      studioRiderId,
      athleteProfileKey: member.athleteProfileKey,
      bikeDeviceId,
      sessionId,
      playerId,
      armedAt,
      startedAt,
      activatedAt,
      tokenHash: authorizationTokenHash,
      expiresAt,
      consumedAt: null,
      revokedAt: null,
      trainingSessionId: null,
      createdAt: now,
      updatedAt: now,
    };
    memoryClubMonitorSprintAuthorizations.set(id, authorization);
    memoryClubMonitorSprintAuthorizationIdByTokenHash.set(authorizationTokenHash, id);
    return { status: 'created', authorization: publicMemoryClubMonitorSprintAuthorization(authorization) };
  }

  return withPersistenceLock(`club-monitor-assignments:${clubId}`, async (client) => {
    const memberResult = await client.query(
      `SELECT clubs.name AS club_name, members.*
       FROM ${schema}.clubs AS clubs
       JOIN ${schema}.club_members AS members ON members.club_id = clubs.id
       WHERE clubs.id = $1 AND clubs.owner_profile_key = $2
         AND members.studio_rider_id = $3
         AND members.status = 'claimed'
         AND members.athlete_profile_key IS NOT NULL
       FOR UPDATE`,
      [clubId, ownerProfileKey, studioRiderId],
    );
    const member = memberResult.rows[0];
    if (!member) return { status: 'not-claimed', authorization: null };
    const existingResult = await client.query(
      `SELECT * FROM ${schema}.club_monitor_sprint_authorizations
       WHERE club_id = $1 AND studio_rider_id = $2 AND session_id = $3
       FOR UPDATE`,
      [clubId, studioRiderId, sessionId],
    );
    const existing = existingResult.rows[0];
    if (existing) {
      const publicExisting = clubMonitorSprintAuthorizationFromRow(existing);
      if (existing.consumed_at || existing.revoked_at) {
        return { status: 'session-used', authorization: publicExisting };
      }
      if (
        existing.owner_profile_key !== ownerProfileKey
        || existing.bike_device_id !== bikeDeviceId
        || Number(existing.player_id) !== playerId
        || new Date(existing.armed_at ?? existing.started_at).getTime() !== armedAt
        || (
          startedAt != null
          && existing.started_at != null
          && new Date(existing.started_at).getTime() !== startedAt
        )
        || existing.athlete_profile_key !== member.athlete_profile_key
      ) return { status: 'binding-conflict', authorization: null };
      const rotated = await client.query(
        `UPDATE ${schema}.club_monitor_sprint_authorizations
         SET token_hash = $2, expires_at = to_timestamp($3 / 1000.0), updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [existing.id, authorizationTokenHash, expiresAt],
      );
      return { status: 'created', authorization: clubMonitorSprintAuthorizationFromRow(rotated.rows[0]) };
    }
    const activeResult = await client.query(
      `SELECT studio_rider_id, bike_device_id
       FROM ${schema}.club_monitor_sprint_authorizations
       WHERE club_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL
         AND expires_at > to_timestamp($2 / 1000.0)
       FOR UPDATE`,
      [clubId, now],
    );
    await releaseExpiredClubGroupTrainingAuthorizationsWithClient(client, clubId, now);
    const groupActiveResult = await client.query(
      `SELECT assignments.studio_rider_id, assignments.bike_device_id
       FROM ${schema}.club_group_training_assignments AS assignments
       JOIN ${schema}.club_group_training_authorizations AS authorizations
         ON authorizations.id = assignments.authorization_id
       WHERE assignments.club_id = $1
         AND assignments.released_at IS NULL
         AND authorizations.completed_at IS NULL
         AND authorizations.cancelled_at IS NULL
         AND authorizations.expires_at > to_timestamp($2 / 1000.0)
       FOR UPDATE OF assignments`,
      [clubId, now],
    );
    const activeRows = [...activeResult.rows, ...groupActiveResult.rows];
    if (activeRows.some((candidate) => candidate.studio_rider_id === studioRiderId)) {
      return { status: 'rider-active', authorization: null };
    }
    if (activeRows.some((candidate) => candidate.bike_device_id === bikeDeviceId)) {
      return { status: 'bike-active', authorization: null };
    }
    if (activeRows.length >= maximumActive) return { status: 'capacity', authorization: null };
    const inserted = await client.query(
      `INSERT INTO ${schema}.club_monitor_sprint_authorizations (
         id, club_id, studio_rider_id, owner_profile_key, athlete_profile_key,
         bike_device_id, session_id, player_id, armed_at, started_at, activated_at,
         token_hash, expires_at, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8,
         to_timestamp($9 / 1000.0),
         CASE WHEN $10::bigint IS NULL THEN NULL ELSE to_timestamp($10 / 1000.0) END,
         CASE WHEN $11::bigint IS NULL THEN NULL ELSE to_timestamp($11 / 1000.0) END,
         $12, to_timestamp($13 / 1000.0),
         to_timestamp($14 / 1000.0), to_timestamp($14 / 1000.0)
       )
       RETURNING *`,
      [
        id,
        clubId,
        studioRiderId,
        ownerProfileKey,
        member.athlete_profile_key,
        bikeDeviceId,
        sessionId,
        playerId,
        armedAt,
        startedAt,
        activatedAt,
        authorizationTokenHash,
        expiresAt,
        now,
      ],
    );
    return { status: 'created', authorization: clubMonitorSprintAuthorizationFromRow(inserted.rows[0]) };
  });
}

export async function loadActiveClubMonitorSprintAuthorizations(clubId, now = Date.now()) {
  if (!pool) {
    return [...memoryClubMonitorSprintAuthorizations.values()]
      .filter((authorization) => (
        authorization.clubId === clubId
        && authorization.consumedAt == null
        && authorization.revokedAt == null
        && authorization.expiresAt > now
      ))
      .sort((left, right) => left.createdAt - right.createdAt)
      .map(publicMemoryClubMonitorSprintAuthorization);
  }
  const result = await query(
    `SELECT * FROM ${schema}.club_monitor_sprint_authorizations
     WHERE club_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL
       AND expires_at > to_timestamp($2 / 1000.0)
     ORDER BY created_at, id`,
    [clubId, now],
  );
  return result ? result.rows.map(clubMonitorSprintAuthorizationFromRow).filter(Boolean) : null;
}

export async function activateClubMonitorSprintAuthorization({
  ownerProfileKey,
  authorizationId,
  tokenHash: authorizationTokenHash,
  startedAt,
  now = Date.now(),
}) {
  if (!pool) {
    const authorization = memoryClubMonitorSprintAuthorizations.get(authorizationId);
    const tokenAuthorizationId = memoryClubMonitorSprintAuthorizationIdByTokenHash.get(
      authorizationTokenHash,
    );
    if (!authorization || tokenAuthorizationId !== authorization.id) {
      return { status: 'invalid', authorization: null };
    }
    if (authorization.ownerProfileKey !== ownerProfileKey) {
      return { status: 'binding-conflict', authorization: null };
    }
    if (startedAt < authorization.armedAt) {
      return { status: 'binding-conflict', authorization: null };
    }
    if (authorization.consumedAt != null) return { status: 'consumed', authorization: null };
    if (authorization.revokedAt != null || authorization.expiresAt <= now) {
      return { status: 'expired', authorization: null };
    }
    const member = memoryClubMembers.get(clubMemberKey(
      authorization.clubId,
      authorization.studioRiderId,
    ));
    if (
      member?.status !== 'claimed'
      || member.athleteProfileKey !== authorization.athleteProfileKey
    ) return { status: 'member-inactive', authorization: null };
    if (authorization.startedAt != null) {
      return authorization.startedAt === startedAt
        ? { status: 'active', authorization: publicMemoryClubMonitorSprintAuthorization(authorization) }
        : { status: 'binding-conflict', authorization: null };
    }
    authorization.startedAt = startedAt;
    authorization.activatedAt = now;
    authorization.updatedAt = now;
    return { status: 'active', authorization: publicMemoryClubMonitorSprintAuthorization(authorization) };
  }
  return withPersistenceLock(`club-monitor-activate:${authorizationId}`, async (client) => {
    const result = await client.query(
      `SELECT authorizations.*, members.status AS member_status,
         members.athlete_profile_key AS current_athlete_profile_key
       FROM ${schema}.club_monitor_sprint_authorizations AS authorizations
       JOIN ${schema}.club_members AS members
         ON members.club_id = authorizations.club_id
         AND members.studio_rider_id = authorizations.studio_rider_id
       WHERE authorizations.id = $1 AND authorizations.token_hash = $2
       FOR UPDATE`,
      [authorizationId, authorizationTokenHash],
    );
    const row = result.rows[0];
    if (!row) return { status: 'invalid', authorization: null };
    if (row.owner_profile_key !== ownerProfileKey) {
      return { status: 'binding-conflict', authorization: null };
    }
    if (startedAt < new Date(row.armed_at ?? row.started_at).getTime()) {
      return { status: 'binding-conflict', authorization: null };
    }
    if (row.consumed_at) return { status: 'consumed', authorization: null };
    if (row.revoked_at || new Date(row.expires_at).getTime() <= now) {
      return { status: 'expired', authorization: null };
    }
    if (
      row.member_status !== 'claimed'
      || row.current_athlete_profile_key !== row.athlete_profile_key
    ) return { status: 'member-inactive', authorization: null };
    if (row.started_at) {
      return new Date(row.started_at).getTime() === startedAt
        ? { status: 'active', authorization: clubMonitorSprintAuthorizationFromRow(row) }
        : { status: 'binding-conflict', authorization: null };
    }
    const activated = await client.query(
      `UPDATE ${schema}.club_monitor_sprint_authorizations
       SET started_at = to_timestamp($2 / 1000.0),
         activated_at = to_timestamp($3 / 1000.0), updated_at = now()
       WHERE id = $1 AND started_at IS NULL
       RETURNING *`,
      [authorizationId, startedAt, now],
    );
    return activated.rows[0]
      ? { status: 'active', authorization: clubMonitorSprintAuthorizationFromRow(activated.rows[0]) }
      : { status: 'binding-conflict', authorization: null };
  });
}

export async function revokeClubMonitorSprintAuthorization(
  ownerProfileKey,
  authorizationId,
  revokedAt = Date.now(),
) {
  if (!pool) {
    const authorization = memoryClubMonitorSprintAuthorizations.get(authorizationId);
    if (
      !authorization
      || authorization.ownerProfileKey !== ownerProfileKey
      || authorization.consumedAt != null
    ) return null;
    authorization.revokedAt = authorization.revokedAt ?? revokedAt;
    authorization.updatedAt = revokedAt;
    return publicMemoryClubMonitorSprintAuthorization(authorization);
  }
  const result = await query(
    `UPDATE ${schema}.club_monitor_sprint_authorizations
     SET revoked_at = COALESCE(revoked_at, to_timestamp($3 / 1000.0)), updated_at = now()
     WHERE id = $1 AND owner_profile_key = $2 AND consumed_at IS NULL
     RETURNING *`,
    [authorizationId, ownerProfileKey, revokedAt],
  );
  return clubMonitorSprintAuthorizationFromRow(result?.rows?.[0]);
}

export async function consumeClubMonitorSprintAuthorizationAndSave({
  tokenHash: authorizationTokenHash,
  ownerProfileKey,
  clubId,
  studioRiderId,
  bikeDeviceId,
  sessionId,
  playerId,
  result,
  now = Date.now(),
}) {
  if (!pool) {
    const authorizationId = memoryClubMonitorSprintAuthorizationIdByTokenHash.get(authorizationTokenHash);
    const authorization = authorizationId
      ? memoryClubMonitorSprintAuthorizations.get(authorizationId)
      : null;
    if (!authorization) return { status: 'invalid', session: null };
    if (authorization.consumedAt != null) return { status: 'consumed', session: null };
    if (authorization.revokedAt != null || authorization.expiresAt <= now) {
      return { status: 'expired', session: null };
    }
    if (authorization.startedAt == null || authorization.activatedAt == null) {
      return { status: 'not-activated', session: null };
    }
    if (
      authorization.ownerProfileKey !== ownerProfileKey
      || authorization.clubId !== clubId
      || authorization.studioRiderId !== studioRiderId
      || authorization.bikeDeviceId !== bikeDeviceId
      || authorization.sessionId !== sessionId
      || authorization.playerId !== playerId
      || authorization.startedAt !== result.startedAt
    ) return { status: 'binding-conflict', session: null };
    const member = memoryClubMembers.get(clubMemberKey(clubId, studioRiderId));
    const club = memoryClubsById.get(clubId);
    if (
      !club
      || club.ownerProfileKey !== ownerProfileKey
      || member?.status !== 'claimed'
      || member.athleteProfileKey !== authorization.athleteProfileKey
    ) return { status: 'member-inactive', session: null };
    const existing = memoryTrainingSessions.get(`${authorization.athleteProfileKey}:${sessionId}`);
    authorization.consumedAt = now;
    authorization.updatedAt = now;
    authorization.trainingSessionId = sessionId;
    if (existing) {
      if (!clubMonitorSessionMatchesAuthorization(existing, authorization)) {
        return { status: 'session-conflict', session: null };
      }
      return {
        status: 'duplicate',
        session: cloneJson(enrichMemoryClubTrainingSession(existing), existing),
        heartRateSegment: await createHeartRateTrainingSegmentForClubSession({
          athleteProfileKey: authorization.athleteProfileKey,
          clubId,
          studioRiderId,
          trainingSessionId: sessionId,
          activityType: 'monitor-sprint',
          playerId,
          startedAt: result.startedAt,
          endedAt: result.endedAt,
          zoneWindows: [],
          now,
        }),
      };
    }
    const stored = clubMonitorTrainingSession(
      authorization,
      { clubName: club.name, riderName: member.riderName },
      result,
      now,
    );
    memoryTrainingSessions.set(`${authorization.athleteProfileKey}:${sessionId}`, stored);
    memoryHeartRateStreams.forEach((stream) => {
      if (
        stream.ownerProfileKey === authorization.athleteProfileKey
        && stream.sessionId === sessionId
        && stream.relayScope !== 'studio-block'
      ) {
        stream.trainingSessionId = sessionId;
        stream.updatedAt = now;
      }
    });
    const heartRateSegment = await createHeartRateTrainingSegmentForClubSession({
      athleteProfileKey: authorization.athleteProfileKey,
      clubId,
      studioRiderId,
      trainingSessionId: sessionId,
      activityType: 'monitor-sprint',
      playerId,
      startedAt: result.startedAt,
      endedAt: result.endedAt,
      zoneWindows: [],
      now,
    });
    return {
      status: 'saved',
      session: cloneJson(stored, stored),
      heartRateSegment,
    };
  }

  return withPersistenceLock(`club-monitor-save:${authorizationTokenHash}`, async (client) => {
    const authorizationResult = await client.query(
      `SELECT authorizations.*, clubs.name AS club_name,
         clubs.owner_profile_key AS current_owner_profile_key, members.rider_name,
         members.status AS member_status, members.athlete_profile_key AS current_athlete_profile_key
       FROM ${schema}.club_monitor_sprint_authorizations AS authorizations
       JOIN ${schema}.clubs AS clubs ON clubs.id = authorizations.club_id
       JOIN ${schema}.club_members AS members
         ON members.club_id = authorizations.club_id
         AND members.studio_rider_id = authorizations.studio_rider_id
       WHERE authorizations.token_hash = $1
       FOR UPDATE`,
      [authorizationTokenHash],
    );
    const row = authorizationResult.rows[0];
    if (!row) return { status: 'invalid', session: null };
    if (row.consumed_at) return { status: 'consumed', session: null };
    if (row.revoked_at || new Date(row.expires_at).getTime() <= now) {
      return { status: 'expired', session: null };
    }
    if (!row.started_at || !row.activated_at) return { status: 'not-activated', session: null };
    if (
      row.current_owner_profile_key !== ownerProfileKey
      || row.current_owner_profile_key !== row.owner_profile_key
      || row.club_id !== clubId
      || row.studio_rider_id !== studioRiderId
      || row.bike_device_id !== bikeDeviceId
      || row.session_id !== sessionId
      || Number(row.player_id) !== playerId
      || new Date(row.started_at).getTime() !== result.startedAt
    ) return { status: 'binding-conflict', session: null };
    if (
      row.member_status !== 'claimed'
      || !row.current_athlete_profile_key
      || row.current_athlete_profile_key !== row.athlete_profile_key
    ) return { status: 'member-inactive', session: null };

    const authorization = clubMonitorSprintAuthorizationFromRow(row);
    const stored = clubMonitorTrainingSession(
      authorization,
      { clubName: row.club_name, riderName: row.rider_name },
      result,
      now,
    );
    const existingResult = await client.query(
      `SELECT * FROM ${schema}.training_sessions
       WHERE profile_key = $1 AND id = $2
       FOR UPDATE`,
      [authorization.athleteProfileKey, sessionId],
    );
    let trainingRow = existingResult.rows[0];
    let status = 'duplicate';
    if (trainingRow) {
      const existing = trainingSessionFromRow(trainingRow);
      const existingMatches = existing.activityType === 'monitor-sprint'
        && trainingRow.club_id === clubId
        && trainingRow.studio_rider_id === studioRiderId;
      if (!existingMatches) {
        await client.query(
          `UPDATE ${schema}.club_monitor_sprint_authorizations
           SET consumed_at = to_timestamp($2 / 1000.0), updated_at = now()
           WHERE id = $1`,
          [authorization.id, now],
        );
        return { status: 'session-conflict', session: null };
      }
    } else {
      const inserted = await client.query(
        `INSERT INTO ${schema}.training_sessions (
           profile_key, id, activity_type, title, started_at, ended_at, duration_ms,
           distance_meters, track_id, track_name, source, details, club_id,
           studio_rider_id, created_at, updated_at
         ) VALUES (
           $1, $2, 'monitor-sprint', $3, to_timestamp($4 / 1000.0),
           to_timestamp($5 / 1000.0), $6, $7, $8, $9, 'live', $10::jsonb,
           $11, $12, to_timestamp($13 / 1000.0), to_timestamp($14 / 1000.0)
         )
         RETURNING *`,
        [
          authorization.athleteProfileKey,
          stored.id,
          stored.title,
          stored.startedAt,
          stored.endedAt,
          stored.durationMs,
          stored.distanceMeters,
          stored.trackId,
          stored.trackName,
          json(stored.details),
          clubId,
          studioRiderId,
          stored.createdAt,
          now,
        ],
      );
      trainingRow = inserted.rows[0];
      status = 'saved';
    }
    await client.query(
      `UPDATE ${schema}.club_monitor_sprint_authorizations
       SET consumed_at = to_timestamp($2 / 1000.0), training_profile_key = $3,
         training_session_id = $4, updated_at = now()
       WHERE id = $1`,
      [authorization.id, now, authorization.athleteProfileKey, sessionId],
    );
    await client.query(
      `UPDATE ${schema}.heart_rate_streams
       SET training_profile_key = $1, training_session_id = $2, updated_at = now()
       WHERE owner_profile_key = $1 AND session_id = $2
         AND relay_scope = 'session'`,
      [authorization.athleteProfileKey, sessionId],
    );
    const heartRateSegment = await createHeartRateTrainingSegmentForBlockWithClient(client, {
      relayScope: 'studio-block',
      athleteProfileKey: authorization.athleteProfileKey,
      clubId,
      studioRiderId,
      trainingSessionId: sessionId,
      activityType: 'monitor-sprint',
      playerId,
      startedAt: result.startedAt,
      endedAt: result.endedAt,
      zoneWindows: [],
      now,
    });
    const session = trainingSessionFromRow({
      ...trainingRow,
      club_name: row.club_name,
      club_rider_name: row.rider_name,
    });
    return { status, session, heartRateSegment };
  });
}

function clubGroupTrainingAuthorizationFromRows(row, assignmentRows = []) {
  if (!row) return null;
  return {
    id: row.id,
    clubId: row.club_id,
    clubName: row.club_name ?? null,
    ownerProfileKey: row.owner_profile_key,
    requestId: row.request_id,
    sessionId: row.session_id,
    activityType: row.activity_type,
    armedAt: new Date(row.armed_at).getTime(),
    expiresAt: new Date(row.expires_at).getTime(),
    completionDigest: row.completion_digest ?? null,
    completedAt: row.completed_at ? new Date(row.completed_at).getTime() : null,
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at).getTime() : null,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
    assignments: assignmentRows.map((assignment) => ({
      id: assignment.id,
      authorizationId: assignment.authorization_id,
      clubId: assignment.club_id,
      studioRiderId: assignment.studio_rider_id,
      athleteProfileKey: assignment.athlete_profile_key,
      riderName: assignment.rider_name ?? null,
      currentMemberStatus: assignment.current_member_status ?? null,
      currentAthleteProfileKey: assignment.current_athlete_profile_key ?? null,
      bikeDeviceId: assignment.bike_device_id,
      playerId: Number(assignment.player_id),
      startedAt: assignment.started_at ? new Date(assignment.started_at).getTime() : null,
      activatedAt: assignment.activated_at ? new Date(assignment.activated_at).getTime() : null,
      endedAt: assignment.ended_at ? new Date(assignment.ended_at).getTime() : null,
      releasedAt: assignment.released_at ? new Date(assignment.released_at).getTime() : null,
      trainingSessionId: assignment.training_session_id ?? null,
      heartRateAttachmentStatus: assignment.heart_rate_attachment_status ?? 'not-checked',
      createdAt: new Date(assignment.created_at).getTime(),
      updatedAt: new Date(assignment.updated_at).getTime(),
    })).sort((left, right) => left.playerId - right.playerId),
  };
}

function cloneMemoryClubGroupTrainingAuthorization(authorization) {
  return authorization ? cloneJson(authorization, authorization) : null;
}

function clubGroupBindingTuples(assignments) {
  return assignments.map((assignment) => ({
    studioRiderId: assignment.studioRiderId,
    bikeDeviceId: assignment.bikeDeviceId,
    playerId: Number(assignment.playerId),
  })).sort((left, right) => left.playerId - right.playerId);
}

function clubGroupBindingMatches(authorization, binding) {
  return authorization
    && authorization.clubId === binding.clubId
    && authorization.requestId === binding.requestId
    && authorization.sessionId === binding.sessionId
    && authorization.activityType === binding.activityType
    && authorization.armedAt === binding.armedAt
    && json(clubGroupBindingTuples(authorization.assignments))
      === json(clubGroupBindingTuples(binding.assignments));
}

function releaseExpiredMemoryClubGroupTrainingAuthorizations(clubId, now) {
  for (const authorization of memoryClubGroupTrainingAuthorizations.values()) {
    if (
      authorization.clubId !== clubId
      || authorization.completedAt != null
      || authorization.cancelledAt != null
      || authorization.expiresAt > now
    ) continue;
    authorization.updatedAt = now;
    authorization.assignments.forEach((assignment) => {
      assignment.releasedAt = assignment.releasedAt ?? authorization.expiresAt;
      assignment.updatedAt = now;
    });
  }
}

async function releaseExpiredClubGroupTrainingAuthorizationsWithClient(client, clubId, now) {
  await client.query(
    `UPDATE ${schema}.club_group_training_assignments AS assignments
     SET released_at = COALESCE(assignments.released_at, authorizations.expires_at),
       updated_at = now()
     FROM ${schema}.club_group_training_authorizations AS authorizations
     WHERE assignments.authorization_id = authorizations.id
       AND authorizations.club_id = $1
       AND assignments.released_at IS NULL
       AND (
         authorizations.completed_at IS NOT NULL
         OR authorizations.cancelled_at IS NOT NULL
         OR authorizations.expires_at <= to_timestamp($2 / 1000.0)
       )`,
    [clubId, now],
  );
}

export function clubGroupCompletionIsTimely(authorization, completions, now) {
  if (authorization.cancelledAt != null) return false;
  if (now <= authorization.expiresAt) return true;
  return now <= authorization.expiresAt + clubGroupTrainingCompletionGraceMs
    && authorization.assignments.every((assignment) => (
      assignment.startedAt != null
      && assignment.startedAt <= authorization.expiresAt
      && assignment.activatedAt != null
      && assignment.activatedAt <= authorization.expiresAt
    ))
    && completions.every((completion) => completion.session?.endedAt <= authorization.expiresAt);
}

export async function createClubGroupTrainingAuthorization({
  id,
  ownerProfileKey,
  clubId,
  requestId,
  sessionId,
  activityType,
  armedAt,
  tokenHash: completionTokenHash,
  expiresAt,
  assignments,
  maximumActiveAssignments,
  now = Date.now(),
}) {
  const maximumActive = Math.max(0, Math.round(Number(maximumActiveAssignments) || 0));
  if (!pool) {
    releaseExpiredMemoryClubGroupTrainingAuthorizations(clubId, now);
    const club = memoryClubsById.get(clubId);
    if (!club || club.ownerProfileKey !== ownerProfileKey) {
      return { status: 'not-owner', authorization: null };
    }
    const members = assignments.map((assignment) => (
      memoryClubMembers.get(clubMemberKey(clubId, assignment.studioRiderId))
    ));
    if (members.some((member) => (
      member?.status !== 'claimed' || !member.athleteProfileKey || member.revokedAt
    ))) return { status: 'not-claimed', authorization: null };
    if (new Set(members.map((member) => member.athleteProfileKey)).size !== members.length) {
      return { status: 'duplicate-athlete', authorization: null };
    }
    const existing = [...memoryClubGroupTrainingAuthorizations.values()].find((candidate) => (
      candidate.ownerProfileKey === ownerProfileKey && candidate.requestId === requestId
    ));
    if (existing) {
      if (!clubGroupBindingMatches(existing, {
        clubId, requestId, sessionId, activityType, armedAt, assignments,
      })) return { status: 'binding-conflict', authorization: null };
      return {
        status: existing.completedAt != null || existing.cancelledAt != null
          ? 'session-used'
          : 'replay',
        authorization: cloneMemoryClubGroupTrainingAuthorization(existing),
      };
    }
    const sessionCollision = [...memoryClubGroupTrainingAuthorizations.values()].find((candidate) => (
      candidate.clubId === clubId && candidate.sessionId === sessionId
    ));
    if (sessionCollision) return { status: 'session-used', authorization: null };
    const activeGroupAssignments = [...memoryClubGroupTrainingAuthorizations.values()]
      .filter((candidate) => (
        candidate.clubId === clubId
        && candidate.completedAt == null
        && candidate.cancelledAt == null
        && candidate.expiresAt > now
      ))
      .flatMap((candidate) => candidate.assignments.filter((assignment) => assignment.releasedAt == null));
    const activeMonitorAssignments = [...memoryClubMonitorSprintAuthorizations.values()].filter((candidate) => (
      candidate.clubId === clubId
      && candidate.consumedAt == null
      && candidate.revokedAt == null
      && candidate.expiresAt > now
    ));
    const activeAssignments = [...activeGroupAssignments, ...activeMonitorAssignments];
    if (assignments.some((assignment) => activeAssignments.some((active) => (
      active.studioRiderId === assignment.studioRiderId
    )))) return { status: 'rider-active', authorization: null };
    if (assignments.some((assignment) => activeAssignments.some((active) => (
      active.bikeDeviceId === assignment.bikeDeviceId
    )))) return { status: 'bike-active', authorization: null };
    if (activeAssignments.length + assignments.length > maximumActive) {
      return { status: 'capacity', authorization: null };
    }
    if (memoryClubGroupTrainingAuthorizationIdByTokenHash.has(completionTokenHash)) return null;
    const authorization = {
      id,
      clubId,
      clubName: club.name,
      ownerProfileKey,
      requestId,
      sessionId,
      activityType,
      armedAt,
      tokenHash: completionTokenHash,
      expiresAt,
      completionDigest: null,
      completedAt: null,
      cancelledAt: null,
      createdAt: now,
      updatedAt: now,
      assignments: assignments.map((assignment, index) => ({
        ...assignment,
        authorizationId: id,
        clubId,
        athleteProfileKey: members[index].athleteProfileKey,
        riderName: members[index].riderName,
        currentMemberStatus: members[index].status,
        currentAthleteProfileKey: members[index].athleteProfileKey,
        startedAt: null,
        activatedAt: null,
        endedAt: null,
        releasedAt: null,
        trainingSessionId: null,
        heartRateAttachmentStatus: 'not-checked',
        createdAt: now,
        updatedAt: now,
      })).sort((left, right) => left.playerId - right.playerId),
    };
    memoryClubGroupTrainingAuthorizations.set(id, authorization);
    memoryClubGroupTrainingAuthorizationIdByTokenHash.set(completionTokenHash, id);
    return { status: 'created', authorization: cloneMemoryClubGroupTrainingAuthorization(authorization) };
  }

  return withPersistenceLock(`club-monitor-assignments:${clubId}`, async (client) => {
    await releaseExpiredClubGroupTrainingAuthorizationsWithClient(client, clubId, now);
    const clubResult = await client.query(
      `SELECT id, name, owner_profile_key
       FROM ${schema}.clubs
       WHERE id = $1 AND owner_profile_key = $2
       FOR UPDATE`,
      [clubId, ownerProfileKey],
    );
    const club = clubResult.rows[0];
    if (!club) return { status: 'not-owner', authorization: null };
    const memberIds = assignments.map((assignment) => assignment.studioRiderId);
    const memberResult = await client.query(
      `SELECT * FROM ${schema}.club_members
       WHERE club_id = $1 AND studio_rider_id = ANY($2::text[])
       FOR UPDATE`,
      [clubId, memberIds],
    );
    const membersById = new Map(memberResult.rows.map((member) => [member.studio_rider_id, member]));
    if (assignments.some((assignment) => {
      const member = membersById.get(assignment.studioRiderId);
      return member?.status !== 'claimed' || !member.athlete_profile_key || member.revoked_at;
    })) return { status: 'not-claimed', authorization: null };
    if (new Set(assignments.map((assignment) => (
      membersById.get(assignment.studioRiderId).athlete_profile_key
    ))).size !== assignments.length) {
      return { status: 'duplicate-athlete', authorization: null };
    }

    const existingResult = await client.query(
      `SELECT * FROM ${schema}.club_group_training_authorizations
       WHERE owner_profile_key = $1 AND request_id = $2
       FOR UPDATE`,
      [ownerProfileKey, requestId],
    );
    const existingRow = existingResult.rows[0];
    if (existingRow) {
      const assignmentResult = await client.query(
        `SELECT assignments.*, members.rider_name,
           members.status AS current_member_status,
           members.athlete_profile_key AS current_athlete_profile_key
         FROM ${schema}.club_group_training_assignments AS assignments
         LEFT JOIN ${schema}.club_members AS members
           ON members.club_id = assignments.club_id
           AND members.studio_rider_id = assignments.studio_rider_id
         WHERE assignments.authorization_id = $1
         ORDER BY assignments.player_id`,
        [existingRow.id],
      );
      const existing = clubGroupTrainingAuthorizationFromRows({
        ...existingRow,
        club_name: club.name,
      }, assignmentResult.rows);
      if (!clubGroupBindingMatches(existing, {
        clubId, requestId, sessionId, activityType, armedAt, assignments,
      })) return { status: 'binding-conflict', authorization: null };
      return {
        status: existing.completedAt != null || existing.cancelledAt != null
          ? 'session-used'
          : 'replay',
        authorization: existing,
      };
    }
    const sessionResult = await client.query(
      `SELECT id FROM ${schema}.club_group_training_authorizations
       WHERE club_id = $1 AND session_id = $2
       LIMIT 1`,
      [clubId, sessionId],
    );
    if (sessionResult.rows[0]) return { status: 'session-used', authorization: null };
    const groupActiveResult = await client.query(
      `SELECT assignments.studio_rider_id, assignments.bike_device_id
       FROM ${schema}.club_group_training_assignments AS assignments
       JOIN ${schema}.club_group_training_authorizations AS authorizations
         ON authorizations.id = assignments.authorization_id
       WHERE assignments.club_id = $1
         AND assignments.released_at IS NULL
         AND authorizations.completed_at IS NULL
         AND authorizations.cancelled_at IS NULL
         AND authorizations.expires_at > to_timestamp($2 / 1000.0)
       FOR UPDATE OF assignments`,
      [clubId, now],
    );
    const monitorActiveResult = await client.query(
      `SELECT studio_rider_id, bike_device_id
       FROM ${schema}.club_monitor_sprint_authorizations
       WHERE club_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL
         AND expires_at > to_timestamp($2 / 1000.0)
       FOR UPDATE`,
      [clubId, now],
    );
    const activeAssignments = [...groupActiveResult.rows, ...monitorActiveResult.rows];
    if (assignments.some((assignment) => activeAssignments.some((active) => (
      active.studio_rider_id === assignment.studioRiderId
    )))) return { status: 'rider-active', authorization: null };
    if (assignments.some((assignment) => activeAssignments.some((active) => (
      active.bike_device_id === assignment.bikeDeviceId
    )))) return { status: 'bike-active', authorization: null };
    if (activeAssignments.length + assignments.length > maximumActive) {
      return { status: 'capacity', authorization: null };
    }
    const inserted = await client.query(
      `INSERT INTO ${schema}.club_group_training_authorizations (
         id, club_id, owner_profile_key, request_id, session_id, activity_type,
         armed_at, token_hash, expires_at, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0), $8,
         to_timestamp($9 / 1000.0), to_timestamp($10 / 1000.0), to_timestamp($10 / 1000.0)
       ) RETURNING *`,
      [
        id, clubId, ownerProfileKey, requestId, sessionId, activityType,
        armedAt, completionTokenHash, expiresAt, now,
      ],
    );
    const insertedAssignments = [];
    for (const assignment of assignments) {
      const member = membersById.get(assignment.studioRiderId);
      const assignmentResult = await client.query(
        `INSERT INTO ${schema}.club_group_training_assignments (
           id, authorization_id, club_id, studio_rider_id, athlete_profile_key,
           bike_device_id, player_id, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7,
           to_timestamp($8 / 1000.0), to_timestamp($8 / 1000.0))
         RETURNING *`,
        [
          assignment.id,
          id,
          clubId,
          assignment.studioRiderId,
          member.athlete_profile_key,
          assignment.bikeDeviceId,
          assignment.playerId,
          now,
        ],
      );
      insertedAssignments.push({
        ...assignmentResult.rows[0],
        rider_name: member.rider_name,
        current_member_status: member.status,
        current_athlete_profile_key: member.athlete_profile_key,
      });
    }
    return {
      status: 'created',
      authorization: clubGroupTrainingAuthorizationFromRows({
        ...inserted.rows[0],
        club_name: club.name,
      }, insertedAssignments),
    };
  });
}

export async function recoverClubGroupTrainingAuthorization({
  ownerProfileKey,
  authorizationId,
  binding,
  tokenHash: completionTokenHash,
  now = Date.now(),
}) {
  if (!pool) {
    const authorization = memoryClubGroupTrainingAuthorizations.get(authorizationId);
    if (!authorization) return { status: 'invalid', authorization: null };
    if (authorization.ownerProfileKey !== ownerProfileKey) {
      return { status: 'not-owner', authorization: null };
    }
    if (!clubGroupBindingMatches(authorization, binding)) {
      return { status: 'binding-conflict', authorization: null };
    }
    if (authorization.completedAt != null) return { status: 'completed', authorization: null };
    if (authorization.cancelledAt != null || authorization.expiresAt <= now) {
      return { status: 'expired', authorization: null };
    }
    const previousHash = authorization.tokenHash;
    if (
      memoryClubGroupTrainingAuthorizationIdByTokenHash.has(completionTokenHash)
      && memoryClubGroupTrainingAuthorizationIdByTokenHash.get(completionTokenHash) !== authorization.id
    ) return null;
    memoryClubGroupTrainingAuthorizationIdByTokenHash.delete(previousHash);
    authorization.tokenHash = completionTokenHash;
    authorization.updatedAt = now;
    memoryClubGroupTrainingAuthorizationIdByTokenHash.set(completionTokenHash, authorization.id);
    return { status: 'recovered', authorization: cloneMemoryClubGroupTrainingAuthorization(authorization) };
  }
  return withPersistenceLock(`club-monitor-assignments:${binding.clubId}`, async (client) => {
    const result = await client.query(
      `SELECT authorizations.*, clubs.name AS club_name
       FROM ${schema}.club_group_training_authorizations AS authorizations
       JOIN ${schema}.clubs AS clubs ON clubs.id = authorizations.club_id
       WHERE authorizations.id = $1
       FOR UPDATE`,
      [authorizationId],
    );
    const row = result.rows[0];
    if (!row) return { status: 'invalid', authorization: null };
    if (row.owner_profile_key !== ownerProfileKey || row.club_id !== binding.clubId) {
      return { status: 'not-owner', authorization: null };
    }
    const assignmentResult = await client.query(
      `SELECT assignments.*, members.rider_name,
         members.status AS current_member_status,
         members.athlete_profile_key AS current_athlete_profile_key
       FROM ${schema}.club_group_training_assignments AS assignments
       LEFT JOIN ${schema}.club_members AS members
         ON members.club_id = assignments.club_id
         AND members.studio_rider_id = assignments.studio_rider_id
       WHERE assignments.authorization_id = $1
       ORDER BY assignments.player_id
       FOR UPDATE OF assignments`,
      [authorizationId],
    );
    const authorization = clubGroupTrainingAuthorizationFromRows(row, assignmentResult.rows);
    if (!clubGroupBindingMatches(authorization, binding)) {
      return { status: 'binding-conflict', authorization: null };
    }
    if (authorization.completedAt != null) return { status: 'completed', authorization: null };
    if (authorization.cancelledAt != null || authorization.expiresAt <= now) {
      return { status: 'expired', authorization: null };
    }
    const rotated = await client.query(
      `UPDATE ${schema}.club_group_training_authorizations
       SET token_hash = $2, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [authorizationId, completionTokenHash],
    );
    return {
      status: 'recovered',
      authorization: clubGroupTrainingAuthorizationFromRows({
        ...rotated.rows[0],
        club_name: row.club_name,
      }, assignmentResult.rows),
    };
  });
}

export async function loadActiveClubGroupTrainingAuthorizations(clubId, now = Date.now()) {
  if (!pool) {
    releaseExpiredMemoryClubGroupTrainingAuthorizations(clubId, now);
    return [...memoryClubGroupTrainingAuthorizations.values()]
      .filter((authorization) => (
        authorization.clubId === clubId
        && authorization.completedAt == null
        && authorization.cancelledAt == null
        && authorization.expiresAt > now
      ))
      .map(cloneMemoryClubGroupTrainingAuthorization)
      .sort((left, right) => left.createdAt - right.createdAt);
  }
  const result = await query(
    `SELECT authorizations.*, clubs.name AS club_name,
       assignments.id AS assignment_id, assignments.authorization_id,
       assignments.club_id AS assignment_club_id,
       assignments.studio_rider_id, assignments.athlete_profile_key,
       assignments.bike_device_id, assignments.player_id,
       assignments.started_at, assignments.activated_at, assignments.ended_at,
       assignments.released_at, assignments.training_session_id,
       assignments.heart_rate_attachment_status,
       assignments.created_at AS assignment_created_at,
       assignments.updated_at AS assignment_updated_at,
       members.rider_name, members.status AS current_member_status,
       members.athlete_profile_key AS current_athlete_profile_key
     FROM ${schema}.club_group_training_authorizations AS authorizations
     JOIN ${schema}.clubs AS clubs ON clubs.id = authorizations.club_id
     JOIN ${schema}.club_group_training_assignments AS assignments
       ON assignments.authorization_id = authorizations.id
     LEFT JOIN ${schema}.club_members AS members
       ON members.club_id = assignments.club_id
       AND members.studio_rider_id = assignments.studio_rider_id
     WHERE authorizations.club_id = $1
       AND authorizations.completed_at IS NULL
       AND authorizations.cancelled_at IS NULL
       AND authorizations.expires_at > to_timestamp($2 / 1000.0)
     ORDER BY authorizations.created_at, authorizations.id, assignments.player_id`,
    [clubId, now],
  );
  if (!result) return null;
  const grouped = new Map();
  for (const row of result.rows) {
    const existing = grouped.get(row.id) ?? { row, assignments: [] };
    existing.assignments.push({
      id: row.assignment_id,
      authorization_id: row.authorization_id,
      club_id: row.assignment_club_id,
      studio_rider_id: row.studio_rider_id,
      athlete_profile_key: row.athlete_profile_key,
      bike_device_id: row.bike_device_id,
      player_id: row.player_id,
      started_at: row.started_at,
      activated_at: row.activated_at,
      ended_at: row.ended_at,
      released_at: row.released_at,
      training_session_id: row.training_session_id,
      heart_rate_attachment_status: row.heart_rate_attachment_status,
      created_at: row.assignment_created_at,
      updated_at: row.assignment_updated_at,
      rider_name: row.rider_name,
      current_member_status: row.current_member_status,
      current_athlete_profile_key: row.current_athlete_profile_key,
    });
    grouped.set(row.id, existing);
  }
  return [...grouped.values()].map(({ row, assignments }) => (
    clubGroupTrainingAuthorizationFromRows(row, assignments)
  ));
}

export async function loadClubGroupTrainingAuthorizationForOwner({
  ownerProfileKey,
  authorizationId,
  tokenHash: completionTokenHash,
}) {
  if (!pool) {
    const tokenAuthorizationId = memoryClubGroupTrainingAuthorizationIdByTokenHash.get(
      completionTokenHash,
    );
    const authorization = memoryClubGroupTrainingAuthorizations.get(authorizationId);
    if (!authorization || tokenAuthorizationId !== authorization.id) return null;
    if (authorization.ownerProfileKey !== ownerProfileKey) return null;
    authorization.assignments.forEach((assignment) => {
      const member = memoryClubMembers.get(clubMemberKey(
        assignment.clubId,
        assignment.studioRiderId,
      ));
      assignment.currentMemberStatus = member?.status ?? null;
      assignment.currentAthleteProfileKey = member?.athleteProfileKey ?? null;
      assignment.riderName = member?.riderName ?? assignment.riderName;
    });
    return cloneMemoryClubGroupTrainingAuthorization(authorization);
  }
  const result = await query(
    `SELECT authorizations.*, clubs.name AS club_name
     FROM ${schema}.club_group_training_authorizations AS authorizations
     JOIN ${schema}.clubs AS clubs ON clubs.id = authorizations.club_id
     WHERE authorizations.id = $1 AND authorizations.owner_profile_key = $2
       AND authorizations.token_hash = $3
     LIMIT 1`,
    [authorizationId, ownerProfileKey, completionTokenHash],
  );
  if (!result) return undefined;
  const row = result.rows[0];
  if (!row) return null;
  const assignmentResult = await query(
    `SELECT assignments.*, members.rider_name,
       members.status AS current_member_status,
       members.athlete_profile_key AS current_athlete_profile_key
     FROM ${schema}.club_group_training_assignments AS assignments
     LEFT JOIN ${schema}.club_members AS members
       ON members.club_id = assignments.club_id
       AND members.studio_rider_id = assignments.studio_rider_id
     WHERE assignments.authorization_id = $1
     ORDER BY assignments.player_id`,
    [authorizationId],
  );
  if (!assignmentResult) return undefined;
  return clubGroupTrainingAuthorizationFromRows(row, assignmentResult.rows);
}

export async function activateClubGroupTrainingAssignment({
  ownerProfileKey,
  authorizationId,
  assignmentId,
  tokenHash: completionTokenHash,
  startedAt,
  now = Date.now(),
}) {
  if (!pool) {
    const tokenAuthorizationId = memoryClubGroupTrainingAuthorizationIdByTokenHash.get(
      completionTokenHash,
    );
    const authorization = memoryClubGroupTrainingAuthorizations.get(authorizationId);
    if (!authorization || tokenAuthorizationId !== authorization.id) {
      return { status: 'invalid', authorization: null };
    }
    if (authorization.ownerProfileKey !== ownerProfileKey) {
      return { status: 'binding-conflict', authorization: null };
    }
    if (authorization.completedAt != null) return { status: 'completed', authorization: null };
    if (authorization.cancelledAt != null || authorization.expiresAt <= now) {
      return { status: 'expired', authorization: null };
    }
    const assignment = authorization.assignments.find((candidate) => candidate.id === assignmentId);
    if (!assignment) return { status: 'binding-conflict', authorization: null };
    const member = memoryClubMembers.get(clubMemberKey(
      assignment.clubId,
      assignment.studioRiderId,
    ));
    if (
      member?.status !== 'claimed'
      || member.athleteProfileKey !== assignment.athleteProfileKey
      || member.revokedAt
    ) return { status: 'member-inactive', authorization: null };
    if (startedAt < authorization.armedAt || startedAt > authorization.expiresAt) {
      return { status: 'binding-conflict', authorization: null };
    }
    if (assignment.startedAt != null) {
      return assignment.startedAt === startedAt
        ? { status: 'active', authorization: cloneMemoryClubGroupTrainingAuthorization(authorization) }
        : { status: 'binding-conflict', authorization: null };
    }
    assignment.startedAt = startedAt;
    assignment.activatedAt = now;
    assignment.updatedAt = now;
    authorization.updatedAt = now;
    return { status: 'active', authorization: cloneMemoryClubGroupTrainingAuthorization(authorization) };
  }
  return withPersistenceLock(`club-group-training:${authorizationId}`, async (client) => {
    const result = await client.query(
      `SELECT authorizations.*, clubs.name AS club_name,
         assignments.id AS assignment_id, assignments.authorization_id,
         assignments.club_id AS assignment_club_id,
         assignments.studio_rider_id, assignments.athlete_profile_key,
         assignments.bike_device_id, assignments.player_id,
         assignments.started_at, assignments.activated_at, assignments.ended_at,
         assignments.released_at, assignments.training_session_id,
         assignments.heart_rate_attachment_status,
         assignments.created_at AS assignment_created_at,
         assignments.updated_at AS assignment_updated_at,
         members.rider_name, members.status AS current_member_status,
         members.athlete_profile_key AS current_athlete_profile_key
       FROM ${schema}.club_group_training_authorizations AS authorizations
       JOIN ${schema}.clubs AS clubs ON clubs.id = authorizations.club_id
       JOIN ${schema}.club_group_training_assignments AS assignments
         ON assignments.authorization_id = authorizations.id
       LEFT JOIN ${schema}.club_members AS members
         ON members.club_id = assignments.club_id
         AND members.studio_rider_id = assignments.studio_rider_id
       WHERE authorizations.id = $1 AND authorizations.token_hash = $2
       ORDER BY assignments.player_id
       FOR UPDATE OF authorizations, assignments`,
      [authorizationId, completionTokenHash],
    );
    if (result.rows.length === 0) return { status: 'invalid', authorization: null };
    const parentRow = result.rows[0];
    if (parentRow.owner_profile_key !== ownerProfileKey) {
      return { status: 'binding-conflict', authorization: null };
    }
    const assignmentRows = result.rows.map((row) => ({
      id: row.assignment_id,
      authorization_id: row.authorization_id,
      club_id: row.assignment_club_id,
      studio_rider_id: row.studio_rider_id,
      athlete_profile_key: row.athlete_profile_key,
      bike_device_id: row.bike_device_id,
      player_id: row.player_id,
      started_at: row.started_at,
      activated_at: row.activated_at,
      ended_at: row.ended_at,
      released_at: row.released_at,
      training_session_id: row.training_session_id,
      heart_rate_attachment_status: row.heart_rate_attachment_status,
      created_at: row.assignment_created_at,
      updated_at: row.assignment_updated_at,
      rider_name: row.rider_name,
      current_member_status: row.current_member_status,
      current_athlete_profile_key: row.current_athlete_profile_key,
    }));
    const authorization = clubGroupTrainingAuthorizationFromRows(parentRow, assignmentRows);
    if (authorization.completedAt != null) return { status: 'completed', authorization: null };
    if (authorization.cancelledAt != null || authorization.expiresAt <= now) {
      return { status: 'expired', authorization: null };
    }
    const assignment = authorization.assignments.find((candidate) => candidate.id === assignmentId);
    if (!assignment) return { status: 'binding-conflict', authorization: null };
    if (
      assignment.currentMemberStatus !== 'claimed'
      || assignment.currentAthleteProfileKey !== assignment.athleteProfileKey
    ) return { status: 'member-inactive', authorization: null };
    if (startedAt < authorization.armedAt || startedAt > authorization.expiresAt) {
      return { status: 'binding-conflict', authorization: null };
    }
    if (assignment.startedAt != null) {
      return assignment.startedAt === startedAt
        ? { status: 'active', authorization }
        : { status: 'binding-conflict', authorization: null };
    }
    const activated = await client.query(
      `UPDATE ${schema}.club_group_training_assignments
       SET started_at = to_timestamp($2 / 1000.0),
         activated_at = to_timestamp($3 / 1000.0), updated_at = now()
       WHERE id = $1 AND started_at IS NULL AND released_at IS NULL
       RETURNING *`,
      [assignmentId, startedAt, now],
    );
    if (!activated.rows[0]) return { status: 'binding-conflict', authorization: null };
    assignment.startedAt = startedAt;
    assignment.activatedAt = now;
    assignment.updatedAt = now;
    authorization.updatedAt = now;
    return { status: 'active', authorization };
  });
}

export async function cancelClubGroupTrainingAuthorization({
  ownerProfileKey,
  authorizationId,
  tokenHash: completionTokenHash,
  now = Date.now(),
}) {
  if (!pool) {
    const tokenAuthorizationId = memoryClubGroupTrainingAuthorizationIdByTokenHash.get(
      completionTokenHash,
    );
    const authorization = memoryClubGroupTrainingAuthorizations.get(authorizationId);
    if (!authorization || tokenAuthorizationId !== authorization.id) {
      return { status: 'invalid', authorization: null };
    }
    if (authorization.ownerProfileKey !== ownerProfileKey) {
      return { status: 'binding-conflict', authorization: null };
    }
    if (authorization.completedAt != null) return { status: 'completed', authorization: null };
    const replayed = authorization.cancelledAt != null;
    authorization.cancelledAt = authorization.cancelledAt ?? now;
    authorization.updatedAt = now;
    authorization.assignments.forEach((assignment) => {
      assignment.releasedAt = assignment.releasedAt ?? authorization.cancelledAt;
      assignment.updatedAt = now;
    });
    return {
      status: replayed ? 'cancelled-replay' : 'cancelled',
      authorization: cloneMemoryClubGroupTrainingAuthorization(authorization),
    };
  }
  return withPersistenceLock(`club-monitor-assignments:${authorizationId}`, async (client) => {
    const result = await client.query(
      `SELECT authorizations.*, clubs.name AS club_name
       FROM ${schema}.club_group_training_authorizations AS authorizations
       JOIN ${schema}.clubs AS clubs ON clubs.id = authorizations.club_id
       WHERE authorizations.id = $1 AND authorizations.token_hash = $2
       FOR UPDATE`,
      [authorizationId, completionTokenHash],
    );
    const row = result.rows[0];
    if (!row) return { status: 'invalid', authorization: null };
    if (row.owner_profile_key !== ownerProfileKey) {
      return { status: 'binding-conflict', authorization: null };
    }
    if (row.completed_at) return { status: 'completed', authorization: null };
    const replayed = Boolean(row.cancelled_at);
    const cancelled = replayed ? row : (await client.query(
      `UPDATE ${schema}.club_group_training_authorizations
       SET cancelled_at = to_timestamp($2 / 1000.0), updated_at = now()
       WHERE id = $1 AND completed_at IS NULL AND cancelled_at IS NULL
       RETURNING *`,
      [authorizationId, now],
    )).rows[0];
    await client.query(
      `UPDATE ${schema}.club_group_training_assignments
       SET released_at = COALESCE(released_at, to_timestamp($2 / 1000.0)), updated_at = now()
       WHERE authorization_id = $1`,
      [authorizationId, cancelled.cancelled_at ? new Date(cancelled.cancelled_at).getTime() : now],
    );
    const assignments = await client.query(
      `SELECT assignments.*, members.rider_name,
         members.status AS current_member_status,
         members.athlete_profile_key AS current_athlete_profile_key
       FROM ${schema}.club_group_training_assignments AS assignments
       LEFT JOIN ${schema}.club_members AS members
         ON members.club_id = assignments.club_id
         AND members.studio_rider_id = assignments.studio_rider_id
       WHERE assignments.authorization_id = $1 ORDER BY assignments.player_id`,
      [authorizationId],
    );
    return {
      status: replayed ? 'cancelled-replay' : 'cancelled',
      authorization: clubGroupTrainingAuthorizationFromRows({
        ...cancelled,
        club_name: row.club_name,
      }, assignments.rows),
    };
  });
}

function canonicalJsonValue(value) {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => (
    [key, canonicalJsonValue(value[key])]
  )));
}

function clubGroupTrainingSessionMatches(existing, expected) {
  return existing?.id === expected.id
    && existing?.activityType === expected.activityType
    && existing?.title === expected.title
    && existing?.startedAt === expected.startedAt
    && existing?.endedAt === expected.endedAt
    && existing?.durationMs === expected.durationMs
    && existing?.distanceMeters === expected.distanceMeters
    && (existing?.trackId ?? null) === (expected.trackId ?? null)
    && (existing?.trackName ?? null) === (expected.trackName ?? null)
    && existing?.source === expected.source
    && (existing?._clubId ?? null) === (expected._clubId ?? null)
    && (existing?._studioRiderId ?? null) === (expected._studioRiderId ?? null)
    && json(canonicalJsonValue(existing?.details ?? {}))
      === json(canonicalJsonValue(expected.details ?? {}));
}

async function attachPreferredGroupHeartRateMemory(completion, authorization, assignment, now) {
  const options = {
    athleteProfileKey: assignment.athleteProfileKey,
    clubId: authorization.clubId,
    studioRiderId: assignment.studioRiderId,
    trainingSessionId: authorization.sessionId,
    activityType: authorization.activityType,
    playerId: assignment.playerId,
    startedAt: completion.session.startedAt,
    endedAt: completion.session.endedAt,
    zoneWindows: completion.zoneWindows ?? [],
    activeClockSegments: completion.activeClockSegments ?? [],
    now,
  };
  const studioResult = upsertMemoryHeartRateTrainingSegment({
    ...options,
    relayScope: 'studio-block',
  });
  if (studioResult.segment) {
    return { ...studioResult, attachmentStatus: 'shared-attached' };
  }
  const privateOptions = {
    ...options,
    relayScope: 'account-block',
    clubId: null,
    studioRiderId: null,
  };
  const accountResult = upsertMemoryHeartRateTrainingSegment(privateOptions);
  if (accountResult.segment) {
    return { ...accountResult, attachmentStatus: 'not-shared' };
  }
  if (memoryHeartRateStudioBlockPairingAvailable(options)) {
    const binding = saveMemoryHeartRateTrainingSegmentBinding({
      ...options,
      relayScope: 'studio-block',
    });
    return binding
      ? { status: 'pending', segment: null, attachmentStatus: 'shared-pending' }
      : { status: 'conflict', segment: null, attachmentStatus: 'failed' };
  }
  if (memoryHeartRateAccountBlockPairingAvailable(privateOptions)) {
    const binding = saveMemoryHeartRateTrainingSegmentBinding(privateOptions);
    return binding
      ? { status: 'pending', segment: null, attachmentStatus: 'not-shared' }
      : { status: 'conflict', segment: null, attachmentStatus: 'failed' };
  }
  return {
    status: studioResult.status === 'conflict' || accountResult.status === 'conflict'
      ? 'conflict'
      : 'no-block',
    segment: null,
    attachmentStatus: studioResult.status === 'conflict' || accountResult.status === 'conflict'
      ? 'failed'
      : 'not-shared',
  };
}

async function attachPreferredGroupHeartRateWithClient(
  client,
  completion,
  authorization,
  assignment,
  now,
) {
  const options = {
    athleteProfileKey: assignment.athleteProfileKey,
    clubId: authorization.clubId,
    studioRiderId: assignment.studioRiderId,
    trainingSessionId: authorization.sessionId,
    activityType: authorization.activityType,
    playerId: assignment.playerId,
    startedAt: completion.session.startedAt,
    endedAt: completion.session.endedAt,
    zoneWindows: completion.zoneWindows ?? [],
    activeClockSegments: completion.activeClockSegments ?? [],
    now,
  };
  const studioResult = await upsertHeartRateTrainingSegmentWithClient(client, {
    ...options,
    relayScope: 'studio-block',
  });
  if (studioResult.segment) {
    return { ...studioResult, attachmentStatus: 'shared-attached' };
  }
  const privateOptions = {
    ...options,
    relayScope: 'account-block',
    clubId: null,
    studioRiderId: null,
  };
  const accountResult = await upsertHeartRateTrainingSegmentWithClient(client, privateOptions);
  if (accountResult.segment) {
    return { ...accountResult, attachmentStatus: 'not-shared' };
  }
  if (await heartRateStudioBlockPairingAvailableWithClient(client, options)) {
    const binding = await upsertHeartRateTrainingSegmentBindingWithClient(client, {
      ...options,
      relayScope: 'studio-block',
    });
    return binding
      ? { status: 'pending', segment: null, attachmentStatus: 'shared-pending' }
      : { status: 'conflict', segment: null, attachmentStatus: 'failed' };
  }
  if (await heartRateAccountBlockPairingAvailableWithClient(client, privateOptions)) {
    const binding = await upsertHeartRateTrainingSegmentBindingWithClient(client, privateOptions);
    return binding
      ? { status: 'pending', segment: null, attachmentStatus: 'not-shared' }
      : { status: 'conflict', segment: null, attachmentStatus: 'failed' };
  }
  return {
    status: studioResult.status === 'conflict' || accountResult.status === 'conflict'
      ? 'conflict'
      : 'no-block',
    segment: null,
    attachmentStatus: studioResult.status === 'conflict' || accountResult.status === 'conflict'
      ? 'failed'
      : 'not-shared',
  };
}

export async function completeClubGroupTrainingAuthorization({
  ownerProfileKey,
  authorizationId,
  tokenHash: completionTokenHash,
  completionDigest,
  completions,
  now = Date.now(),
}) {
  if (!pool) {
    const tokenAuthorizationId = memoryClubGroupTrainingAuthorizationIdByTokenHash.get(
      completionTokenHash,
    );
    const authorization = memoryClubGroupTrainingAuthorizations.get(authorizationId);
    if (!authorization || tokenAuthorizationId !== authorization.id) {
      return { status: 'invalid', authorization: null, sessions: [] };
    }
    if (authorization.ownerProfileKey !== ownerProfileKey) {
      return { status: 'binding-conflict', authorization: null, sessions: [] };
    }
    if (authorization.completedAt != null) {
      if (authorization.completionDigest !== completionDigest) {
        return { status: 'completion-conflict', authorization: null, sessions: [] };
      }
      const sessions = authorization.assignments.flatMap((assignment) => {
        const session = memoryTrainingSessions.get(
          `${assignment.athleteProfileKey}:${authorization.sessionId}`,
        );
        return session ? [cloneJson(enrichMemoryClubTrainingSession(session), session)] : [];
      });
      return {
        status: sessions.length === authorization.assignments.length ? 'duplicate' : 'session-conflict',
        authorization: cloneMemoryClubGroupTrainingAuthorization(authorization),
        sessions,
      };
    }
    if (!clubGroupCompletionIsTimely(authorization, completions, now)) {
      return { status: 'expired', authorization: null, sessions: [] };
    }
    if (
      completions.length !== authorization.assignments.length
      || authorization.assignments.some((assignment) => assignment.startedAt == null)
    ) return { status: 'not-activated', authorization: null, sessions: [] };
    const completionsByAssignmentId = new Map(completions.map((completion) => (
      [completion.assignmentId, completion]
    )));
    const prepared = [];
    for (const assignment of authorization.assignments) {
      const completion = completionsByAssignmentId.get(assignment.id);
      const member = memoryClubMembers.get(clubMemberKey(
        assignment.clubId,
        assignment.studioRiderId,
      ));
      if (
        !completion
        || member?.status !== 'claimed'
        || member.athleteProfileKey !== assignment.athleteProfileKey
        || member.revokedAt
      ) return { status: 'member-inactive', authorization: null, sessions: [] };
      const session = completion.session;
      if (
        session?._profileKey !== assignment.athleteProfileKey
        || session?._clubId !== authorization.clubId
        || session?._studioRiderId !== assignment.studioRiderId
        || session?.id !== authorization.sessionId
        || session?.activityType !== authorization.activityType
        || session?.startedAt !== assignment.startedAt
        || session?.endedAt < assignment.startedAt
      ) return { status: 'binding-conflict', authorization: null, sessions: [] };
      const existing = memoryTrainingSessions.get(
        `${assignment.athleteProfileKey}:${authorization.sessionId}`,
      );
      if (existing && !clubGroupTrainingSessionMatches(existing, session)) {
        return { status: 'session-conflict', authorization: null, sessions: [] };
      }
      prepared.push({ assignment, completion, existing });
    }
    const sessions = [];
    for (const { assignment, completion, existing } of prepared) {
      const stored = existing ?? {
        ...cloneJson(completion.session, completion.session),
        updatedAt: now,
      };
      memoryTrainingSessions.set(`${assignment.athleteProfileKey}:${authorization.sessionId}`, stored);
      memoryHeartRateStreams.forEach((stream) => {
        if (
          stream.ownerProfileKey === assignment.athleteProfileKey
          && stream.sessionId === authorization.sessionId
          && stream.relayScope === 'session'
        ) {
          stream.trainingSessionId = authorization.sessionId;
          stream.updatedAt = now;
        }
      });
      const heartRateAttachment = await attachPreferredGroupHeartRateMemory(
        completion,
        authorization,
        assignment,
        now,
      );
      assignment.endedAt = completion.session.endedAt;
      assignment.releasedAt = now;
      assignment.trainingSessionId = authorization.sessionId;
      assignment.heartRateAttachmentStatus = heartRateAttachment.attachmentStatus;
      assignment.updatedAt = now;
      sessions.push(cloneJson(enrichMemoryClubTrainingSession(stored), stored));
    }
    authorization.completionDigest = completionDigest;
    authorization.completedAt = now;
    authorization.updatedAt = now;
    return {
      status: 'saved',
      authorization: cloneMemoryClubGroupTrainingAuthorization(authorization),
      sessions,
    };
  }

  return withPersistenceLock(`club-group-training:${authorizationId}`, async (client) => {
    const result = await client.query(
      `SELECT authorizations.*, clubs.name AS club_name,
         assignments.id AS assignment_id, assignments.authorization_id,
         assignments.club_id AS assignment_club_id,
         assignments.studio_rider_id, assignments.athlete_profile_key,
         assignments.bike_device_id, assignments.player_id,
         assignments.started_at, assignments.activated_at, assignments.ended_at,
         assignments.released_at, assignments.training_session_id,
         assignments.heart_rate_attachment_status,
         assignments.created_at AS assignment_created_at,
         assignments.updated_at AS assignment_updated_at,
         members.rider_name, members.status AS current_member_status,
         members.athlete_profile_key AS current_athlete_profile_key
       FROM ${schema}.club_group_training_authorizations AS authorizations
       JOIN ${schema}.clubs AS clubs ON clubs.id = authorizations.club_id
       JOIN ${schema}.club_group_training_assignments AS assignments
         ON assignments.authorization_id = authorizations.id
       LEFT JOIN ${schema}.club_members AS members
         ON members.club_id = assignments.club_id
         AND members.studio_rider_id = assignments.studio_rider_id
       WHERE authorizations.id = $1 AND authorizations.token_hash = $2
       ORDER BY assignments.player_id
       FOR UPDATE OF authorizations, assignments`,
      [authorizationId, completionTokenHash],
    );
    if (result.rows.length === 0) {
      return { status: 'invalid', authorization: null, sessions: [] };
    }
    const parentRow = result.rows[0];
    if (parentRow.owner_profile_key !== ownerProfileKey) {
      return { status: 'binding-conflict', authorization: null, sessions: [] };
    }
    const assignmentRows = result.rows.map((row) => ({
      id: row.assignment_id,
      authorization_id: row.authorization_id,
      club_id: row.assignment_club_id,
      studio_rider_id: row.studio_rider_id,
      athlete_profile_key: row.athlete_profile_key,
      bike_device_id: row.bike_device_id,
      player_id: row.player_id,
      started_at: row.started_at,
      activated_at: row.activated_at,
      ended_at: row.ended_at,
      released_at: row.released_at,
      training_session_id: row.training_session_id,
      heart_rate_attachment_status: row.heart_rate_attachment_status,
      created_at: row.assignment_created_at,
      updated_at: row.assignment_updated_at,
      rider_name: row.rider_name,
      current_member_status: row.current_member_status,
      current_athlete_profile_key: row.current_athlete_profile_key,
    }));
    const authorization = clubGroupTrainingAuthorizationFromRows(parentRow, assignmentRows);
    if (authorization.completedAt != null) {
      if (authorization.completionDigest !== completionDigest) {
        return { status: 'completion-conflict', authorization: null, sessions: [] };
      }
      const sessions = [];
      for (const assignment of authorization.assignments) {
        const saved = await client.query(
          `SELECT sessions.*, clubs.name AS club_name, members.rider_name AS club_rider_name
           FROM ${schema}.training_sessions AS sessions
           LEFT JOIN ${schema}.clubs AS clubs ON clubs.id = sessions.club_id
           LEFT JOIN ${schema}.club_members AS members
             ON members.club_id = sessions.club_id
             AND members.studio_rider_id = sessions.studio_rider_id
           WHERE sessions.profile_key = $1 AND sessions.id = $2`,
          [assignment.athleteProfileKey, authorization.sessionId],
        );
        const session = trainingSessionFromRow(saved.rows[0]);
        if (session) sessions.push(session);
      }
      return {
        status: sessions.length === authorization.assignments.length ? 'duplicate' : 'session-conflict',
        authorization,
        sessions,
      };
    }
    if (!clubGroupCompletionIsTimely(authorization, completions, now)) {
      return { status: 'expired', authorization: null, sessions: [] };
    }
    if (
      completions.length !== authorization.assignments.length
      || authorization.assignments.some((assignment) => assignment.startedAt == null)
    ) return { status: 'not-activated', authorization: null, sessions: [] };
    const completionsByAssignmentId = new Map(completions.map((completion) => (
      [completion.assignmentId, completion]
    )));
    const prepared = [];
    for (const assignment of authorization.assignments) {
      const completion = completionsByAssignmentId.get(assignment.id);
      if (
        !completion
        || assignment.currentMemberStatus !== 'claimed'
        || assignment.currentAthleteProfileKey !== assignment.athleteProfileKey
      ) return { status: 'member-inactive', authorization: null, sessions: [] };
      const session = completion.session;
      if (
        session?._profileKey !== assignment.athleteProfileKey
        || session?._clubId !== authorization.clubId
        || session?._studioRiderId !== assignment.studioRiderId
        || session?.id !== authorization.sessionId
        || session?.activityType !== authorization.activityType
        || session?.startedAt !== assignment.startedAt
        || session?.endedAt < assignment.startedAt
      ) return { status: 'binding-conflict', authorization: null, sessions: [] };
      const existingResult = await client.query(
        `SELECT sessions.*, clubs.name AS club_name, members.rider_name AS club_rider_name
         FROM ${schema}.training_sessions AS sessions
         LEFT JOIN ${schema}.clubs AS clubs ON clubs.id = sessions.club_id
         LEFT JOIN ${schema}.club_members AS members
           ON members.club_id = sessions.club_id
           AND members.studio_rider_id = sessions.studio_rider_id
         WHERE sessions.profile_key = $1 AND sessions.id = $2
         FOR UPDATE OF sessions`,
        [assignment.athleteProfileKey, authorization.sessionId],
      );
      const existing = trainingSessionFromRow(existingResult.rows[0]);
      if (existing && !clubGroupTrainingSessionMatches(existing, session)) {
        return { status: 'session-conflict', authorization: null, sessions: [] };
      }
      prepared.push({ assignment, completion, existing, existingRow: existingResult.rows[0] });
    }

    const sessions = [];
    for (const { assignment, completion, existing, existingRow } of prepared) {
      let row = existingRow;
      if (!existing) {
        const session = completion.session;
        const inserted = await client.query(
          `INSERT INTO ${schema}.training_sessions (
             profile_key, id, activity_type, title, started_at, ended_at, duration_ms,
             distance_meters, track_id, track_name, source, details, club_id,
             studio_rider_id, created_at, updated_at
           ) VALUES (
             $1, $2, $3, $4, to_timestamp($5 / 1000.0), to_timestamp($6 / 1000.0),
             $7, $8, $9, $10, 'live', $11::jsonb, $12, $13,
             to_timestamp($14 / 1000.0), to_timestamp($15 / 1000.0)
           ) RETURNING *`,
          [
            assignment.athleteProfileKey,
            session.id,
            session.activityType,
            session.title,
            session.startedAt,
            session.endedAt,
            session.durationMs,
            session.distanceMeters,
            session.trackId ?? null,
            session.trackName ?? null,
            json(session.details),
            authorization.clubId,
            assignment.studioRiderId,
            session.createdAt,
            now,
          ],
        );
        row = inserted.rows[0];
      }
      await client.query(
        `UPDATE ${schema}.heart_rate_streams
         SET training_profile_key = $1, training_session_id = $2, updated_at = now()
         WHERE owner_profile_key = $1 AND session_id = $2 AND relay_scope = 'session'`,
        [assignment.athleteProfileKey, authorization.sessionId],
      );
      const heartRateAttachment = await attachPreferredGroupHeartRateWithClient(
        client,
        completion,
        authorization,
        assignment,
        now,
      );
      await client.query(
        `UPDATE ${schema}.club_group_training_assignments
         SET ended_at = to_timestamp($2 / 1000.0),
           released_at = to_timestamp($3 / 1000.0),
           training_profile_key = $4, training_session_id = $5,
           heart_rate_attachment_status = $6,
           updated_at = now()
         WHERE id = $1`,
        [
          assignment.id,
          completion.session.endedAt,
          now,
          assignment.athleteProfileKey,
          authorization.sessionId,
          heartRateAttachment.attachmentStatus,
        ],
      );
      assignment.endedAt = completion.session.endedAt;
      assignment.releasedAt = now;
      assignment.trainingSessionId = authorization.sessionId;
      assignment.heartRateAttachmentStatus = heartRateAttachment.attachmentStatus;
      sessions.push(trainingSessionFromRow({
        ...row,
        club_name: authorization.clubName,
        club_rider_name: assignment.riderName,
      }));
    }
    const completed = await client.query(
      `UPDATE ${schema}.club_group_training_authorizations
       SET completion_digest = $2, completed_at = to_timestamp($3 / 1000.0), updated_at = now()
       WHERE id = $1 AND completed_at IS NULL AND cancelled_at IS NULL
       RETURNING *`,
      [authorizationId, completionDigest, now],
    );
    if (!completed.rows[0]) throw new Error('Club group training completion state changed.');
    authorization.completionDigest = completionDigest;
    authorization.completedAt = now;
    authorization.updatedAt = now;
    return { status: 'saved', authorization, sessions };
  });
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
    for (const invitation of memoryHeartRateStudioInvitations.values()) {
      if (invitation.clubId === clubId && invitation.studioRiderId === studioRiderId && !invitation.claimedAt) {
        invitation.revokedAt = now;
        invitation.updatedAt = now;
      }
    }
    for (const pairing of memoryHeartRatePairings.values()) {
      if (pairing.clubId !== clubId || pairing.studioRiderId !== studioRiderId) continue;
      pairing.revokedAt = pairing.revokedAt ?? now;
      pairing.liveStudioConsent = false;
      pairing.sessionStudioConsent = false;
      pairing.updatedAt = now;
      const streamId = memoryHeartRateStreamIdByPairingId.get(pairing.id);
      const stream = streamId ? memoryHeartRateStreams.get(streamId) : null;
      if (stream) {
        stream.liveStudioConsent = false;
        stream.sessionStudioConsent = false;
        stream.updatedAt = now;
      }
    }
    for (const enrollment of memoryHeartRateWatchEnrollments.values()) {
      if (
        enrollment.clubId !== clubId
        || enrollment.studioRiderId !== studioRiderId
        || enrollment.revokedAt != null
      ) continue;
      revokeMemoryHeartRateWatchEnrollment(enrollment, now, 'membership-ended');
      for (const connection of memoryHeartRateWatchConnections.values()) {
        if (connection.enrollmentId !== enrollment.id) continue;
        const pairing = memoryHeartRatePairings.get(connection.pairingId);
        if (pairing) pairing.revokedAt = pairing.revokedAt ?? now;
      }
    }
    for (const segment of memoryHeartRateTrainingSegments.values()) {
      if (segment.clubId === clubId && segment.studioRiderId === studioRiderId) {
        segment.studioVisible = false;
        segment.updatedAt = now;
      }
    }
    for (const authorization of memoryClubMonitorSprintAuthorizations.values()) {
      if (
        authorization.clubId === clubId
        && authorization.studioRiderId === studioRiderId
        && authorization.consumedAt == null
      ) {
        authorization.revokedAt = authorization.revokedAt ?? now;
        authorization.updatedAt = now;
      }
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
  const clubId = result?.rows?.[0]?.club_id;
  if (!clubId) return false;
  await Promise.all([
    query(
      `UPDATE ${schema}.heart_rate_studio_invitations
       SET revoked_at = COALESCE(revoked_at, now()), updated_at = now()
       WHERE club_id = $1 AND studio_rider_id = $2 AND claimed_at IS NULL`,
      [clubId, studioRiderId],
    ),
    query(
      `UPDATE ${schema}.heart_rate_pairings
       SET revoked_at = COALESCE(revoked_at, now()),
         live_studio_consent = false, session_studio_consent = false, updated_at = now()
       WHERE club_id = $1 AND studio_rider_id = $2`,
      [clubId, studioRiderId],
    ),
    query(
      `UPDATE ${schema}.heart_rate_watch_enrollments
       SET revoked_at = COALESCE(revoked_at, now()),
         revoked_reason = COALESCE(revoked_reason, 'membership-ended'),
         updated_at = now()
       WHERE club_id = $1 AND studio_rider_id = $2`,
      [clubId, studioRiderId],
    ),
    query(
      `UPDATE ${schema}.heart_rate_watch_connections AS connections
       SET stopped_at = COALESCE(connections.stopped_at, now()),
         stopped_reason = COALESCE(connections.stopped_reason, 'membership-ended'),
         updated_at = now()
       FROM ${schema}.heart_rate_watch_enrollments AS enrollments
       WHERE enrollments.id = connections.enrollment_id
         AND enrollments.club_id = $1 AND enrollments.studio_rider_id = $2`,
      [clubId, studioRiderId],
    ),
    query(
      `UPDATE ${schema}.heart_rate_streams
       SET live_studio_consent = false, session_studio_consent = false, updated_at = now()
       WHERE club_id = $1 AND studio_rider_id = $2`,
      [clubId, studioRiderId],
    ),
    query(
      `UPDATE ${schema}.heart_rate_training_segments
       SET studio_visible = false, updated_at = now()
       WHERE club_id = $1 AND studio_rider_id = $2`,
      [clubId, studioRiderId],
    ),
    query(
      `UPDATE ${schema}.club_monitor_sprint_authorizations
       SET revoked_at = COALESCE(revoked_at, now()), updated_at = now()
       WHERE club_id = $1 AND studio_rider_id = $2 AND consumed_at IS NULL`,
      [clubId, studioRiderId],
    ),
  ]);
  return true;
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

function accountFriendsPageStatement() {
  return `WITH friend_edges AS MATERIALIZED (
       SELECT user_id_b AS friend_id, source, created_at
       FROM ${schema}.account_friendships WHERE user_id_a = $1
       UNION ALL
       SELECT user_id_a AS friend_id, source, created_at
       FROM ${schema}.account_friendships WHERE user_id_b = $1
     ), matching_friends AS MATERIALIZED (
       SELECT
         friend.id AS profile_id,
         friend.display_name,
         friend.username,
         official.kind AS official_type,
         edge.source AS friendship_source,
         edge.created_at AS connected_at
       FROM friend_edges AS edge
       JOIN ${schema}.auth_users AS friend ON friend.id = edge.friend_id
       LEFT JOIN ${schema}.official_friend_accounts AS official ON official.user_id = friend.id
       WHERE $4 = ''
          OR friend.username ILIKE '%' || $4 || '%' ESCAPE '\\'
          OR friend.display_name ILIKE '%' || $4 || '%' ESCAPE '\\'
     ), paged_friends AS (
       SELECT *
       FROM matching_friends
       ORDER BY connected_at DESC, profile_id
       OFFSET $2 LIMIT $3
     ), friend_total AS (
       SELECT count(*)::integer AS total FROM matching_friends
     )
     SELECT
       friend.profile_id,
       friend.display_name,
       friend.username,
       friend.official_type,
       profile_data.account_profile ->> 'photoUrl' AS photo_url,
       friend.friendship_source,
       friend.connected_at,
       recent_ghost.id AS ghost_id,
       recent_ghost.track_id AS ghost_track_id,
       recent_ghost.track_name AS ghost_track_name,
       recent_ghost.route_variant_id AS ghost_route_variant_id,
       recent_ghost.lap_count AS ghost_lap_count,
       recent_ghost.finish_time_ms AS ghost_finish_time_ms,
       recent_ghost.summary AS ghost_summary,
       friend_total.total AS total_count
     FROM friend_total
     LEFT JOIN paged_friends AS friend ON true
     LEFT JOIN ${schema}.user_data AS profile_data
       ON profile_data.guest_key = 'user:' || friend.profile_id
     LEFT JOIN LATERAL (
       SELECT
         id, track_id, track_name, route_variant_id, lap_count, finish_time_ms,
         jsonb_build_object(
           'sprintDistanceFeet', summary -> 'sprintDistanceFeet',
           'sprintAirSetting', summary -> 'sprintAirSetting'
         ) AS summary
       FROM ${schema}.ghost_laps
       WHERE owner_key = 'user:' || friend.profile_id AND race_source = 'live'
       ORDER BY saved_at DESC, finish_time_ms ASC, id
       LIMIT 1
     ) AS recent_ghost ON friend.friendship_source <> 'official'
     ORDER BY friend.connected_at DESC NULLS LAST, friend.profile_id`;
}

export async function loadAccountFriendsPage(userId, { offset = 0, limit = 25, searchText = '' } = {}) {
  const normalizedSearch = String(searchText || '').trim().toLowerCase();
  if (!pool) {
    const matches = [...memoryAccountFriendships.values()]
      .filter((friendship) => friendship.userIdA === userId || friendship.userIdB === userId)
      .filter((friendship) => {
        if (!normalizedSearch) return true;
        const friendId = friendship.userIdA === userId ? friendship.userIdB : friendship.userIdA;
        const friend = memoryAuthUsersById.get(friendId);
        return String(friend?.username || '').toLowerCase().includes(normalizedSearch)
          || String(friend?.displayName || '').toLowerCase().includes(normalizedSearch);
      })
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const items = matches
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
    return { items, total: matches.length };
  }

  const escapedSearch = normalizedSearch.replace(/[\\%_]/g, '\\$&');
  const result = await query(accountFriendsPageStatement(), [userId, offset, limit, escapedSearch]);
  const rows = result?.rows ?? [];
  const total = Number(rows[0]?.total_count) || 0;
  const items = rows.filter((row) => row.profile_id).map((row) => accountProfileFromRow(row, {
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
  return { items, total };
}

export async function listAccountFriends(userId, options = {}) {
  return (await loadAccountFriendsPage(userId, options)).items;
}

function accountFriendRequestsPageStatement(direction) {
  const incoming = direction !== 'outgoing';
  const ownerColumn = incoming ? 'request.to_user_id' : 'request.from_user_id';
  const otherColumn = incoming ? 'request.from_user_id' : 'request.to_user_id';
  return `WITH matching_requests AS MATERIALIZED (
       SELECT
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
     ), paged_requests AS (
       SELECT * FROM matching_requests
       ORDER BY created_at DESC, request_id DESC
       OFFSET $2 LIMIT $3
     ), request_total AS (
       SELECT count(*)::integer AS total FROM matching_requests
     )
     SELECT request.*, request_total.total AS total_count
     FROM request_total
     LEFT JOIN paged_requests AS request ON true
     ORDER BY request.created_at DESC NULLS LAST, request.request_id DESC`;
}

export async function loadAccountFriendRequestsPage(userId, direction, { offset = 0, limit = 25, searchText = '' } = {}) {
  const incoming = direction !== 'outgoing';
  const normalizedSearch = String(searchText || '').trim().toLowerCase();
  if (!pool) {
    const matches = [...memoryAccountFriendRequests.values()]
      .filter((request) => request.status === 'pending')
      .filter((request) => incoming ? request.toUserId === userId : request.fromUserId === userId)
      .filter((request) => {
        if (!normalizedSearch) return true;
        const otherId = incoming ? request.fromUserId : request.toUserId;
        const other = memoryAuthUsersById.get(otherId);
        return String(other?.username || '').toLowerCase().includes(normalizedSearch)
          || String(other?.displayName || '').toLowerCase().includes(normalizedSearch);
      })
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const items = matches
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
    return { items, total: matches.length };
  }

  const escapedSearch = normalizedSearch.replace(/[\\%_]/g, '\\$&');
  const result = await query(
    accountFriendRequestsPageStatement(direction),
    [userId, offset, limit, escapedSearch],
  );
  const rows = result?.rows ?? [];
  const total = Number(rows[0]?.total_count) || 0;
  const items = rows.filter((row) => row.request_id).map((row) => ({
    requestId: row.request_id,
    direction: incoming ? 'incoming' : 'outgoing',
    profile: accountProfileFromRow(row),
    createdAt: new Date(row.created_at).toISOString(),
  }));
  return { items, total };
}

export async function listAccountFriendRequests(userId, direction, options = {}) {
  return (await loadAccountFriendRequestsPage(userId, direction, options)).items;
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
  let removedHeartRateInvitations = 0;
  let removedHeartRatePairings = 0;
  let removedClubMonitorSprintAuthorizations = 0;

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

  for (const [invitationId, invitation] of memoryHeartRateStudioInvitations.entries()) {
    const terminalAt = invitation.revokedAt ?? invitation.claimedAt ?? invitation.expiresAt;
    if (terminalAt <= cutoff.getTime() - 7 * 24 * 60 * 60 * 1000) {
      memoryHeartRateStudioInvitations.delete(invitationId);
      memoryHeartRateStudioInvitationIdByCodeHash.delete(invitation.inviteCodeHash);
      removedHeartRateInvitations += 1;
    }
  }

  for (const [pairingId, pairing] of memoryHeartRatePairings.entries()) {
    const streamId = memoryHeartRateStreamIdByPairingId.get(pairingId);
    const abandoned = pairing.claimedAt == null
      && pairing.pairCodeExpiresAt <= cutoff.getTime() - 24 * 60 * 60 * 1000;
    const revokedWithoutStream = pairing.revokedAt != null
      && pairing.revokedAt <= cutoff.getTime() - 30 * 24 * 60 * 60 * 1000
      && !streamId;
    if (abandoned || revokedWithoutStream) {
      memoryHeartRatePairings.delete(pairingId);
      memoryHeartRatePairingIdByCodeHash.delete(pairing.pairCodeHash);
      if (pairing.ingestTokenHash) memoryHeartRatePairingIdByTokenHash.delete(pairing.ingestTokenHash);
      removedHeartRatePairings += 1;
    }
  }

  for (const [authorizationId, authorization] of memoryClubMonitorSprintAuthorizations.entries()) {
    const terminalAt = authorization.consumedAt ?? authorization.revokedAt ?? authorization.expiresAt;
    if (terminalAt <= cutoff.getTime() - 7 * 24 * 60 * 60 * 1000) {
      memoryClubMonitorSprintAuthorizations.delete(authorizationId);
      memoryClubMonitorSprintAuthorizationIdByTokenHash.delete(authorization.tokenHash);
      removedClubMonitorSprintAuthorizations += 1;
    }
  }

  for (const [key, binding] of memoryHeartRateTrainingSegmentBindings.entries()) {
    if (binding.expiresAt <= cutoff.getTime()) {
      memoryHeartRateTrainingSegmentBindings.delete(key);
    }
  }

  if (!pool) {
    return {
      removedSessions,
      removedBillingCheckouts,
      removedHeartRateInvitations,
      removedHeartRatePairings,
      removedClubMonitorSprintAuthorizations,
    };
  }

  const [sessions, checkouts, invitations, pairings, monitorAuthorizations] = await Promise.all([
    query(
      `DELETE FROM ${schema}.auth_sessions
       WHERE expires_at <= $1::timestamptz
       RETURNING id`,
      [cutoff],
    ),
    query(
      `DELETE FROM ${schema}.billing_checkouts
       WHERE expires_at <= $1::timestamptz
          OR (claimed_at IS NOT NULL AND claimed_at <= $1::timestamptz - interval '7 days')
       RETURNING state_hash`,
      [cutoff],
    ),
    query(
      `DELETE FROM ${schema}.heart_rate_studio_invitations
       WHERE COALESCE(revoked_at, claimed_at, expires_at) <= $1::timestamptz - interval '7 days'
       RETURNING id`,
      [cutoff],
    ),
    query(
      `DELETE FROM ${schema}.heart_rate_pairings AS pairings
       WHERE (
         pairings.claimed_at IS NULL
         AND pairings.pair_code_expires_at <= $1::timestamptz - interval '1 day'
       ) OR (
         pairings.revoked_at <= $1::timestamptz - interval '30 days'
         AND NOT EXISTS (
           SELECT 1 FROM ${schema}.heart_rate_streams AS streams
           WHERE streams.pairing_id = pairings.id
         )
       )
       RETURNING id`,
      [cutoff],
    ),
    query(
      `DELETE FROM ${schema}.club_monitor_sprint_authorizations
       WHERE COALESCE(consumed_at, revoked_at, expires_at) <= $1::timestamptz - interval '7 days'
       RETURNING id`,
      [cutoff],
    ),
    query(
      `DELETE FROM ${schema}.heart_rate_training_segment_bindings
       WHERE expires_at <= $1::timestamptz`,
      [cutoff],
    ),
  ]);

  return {
    removedSessions: removedSessions + (sessions?.rowCount ?? 0),
    removedBillingCheckouts: removedBillingCheckouts + (checkouts?.rowCount ?? 0),
    removedHeartRateInvitations: removedHeartRateInvitations + (invitations?.rowCount ?? 0),
    removedHeartRatePairings: removedHeartRatePairings + (pairings?.rowCount ?? 0),
    removedClubMonitorSprintAuthorizations: removedClubMonitorSprintAuthorizations
      + (monitorAuthorizations?.rowCount ?? 0),
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

function recoveryAlertPreferenceFromRow(row) {
  return row ? {
    mode: row.mode,
    timerSeconds: Number(row.timer_seconds),
    targetBpm: Number(row.target_bpm),
    minimumSeconds: Number(row.minimum_seconds),
    maximumSeconds: Number(row.maximum_seconds),
    updatedAt: new Date(row.updated_at).getTime(),
  } : null;
}

function recoveryAlertEpisodeFromRow(row) {
  return row ? {
    id: row.id,
    ownerProfileKey: row.owner_profile_key,
    requestId: row.request_id,
    requestFingerprint: row.request_fingerprint,
    activityType: row.activity_type,
    sessionId: row.session_id,
    repetitionId: row.repetition_id,
    mode: row.mode,
    timerSeconds: Number(row.timer_seconds),
    targetBpm: row.target_bpm == null ? null : Number(row.target_bpm),
    minimumSeconds: Number(row.minimum_seconds),
    maximumSeconds: Number(row.maximum_seconds),
    startedAt: new Date(row.started_at).getTime(),
    notBeforeAt: new Date(row.not_before_at).getTime(),
    plannedReadyAt: row.planned_ready_at == null ? null : new Date(row.planned_ready_at).getTime(),
    fallbackAt: new Date(row.fallback_at).getTime(),
    readyAt: row.ready_at == null ? null : new Date(row.ready_at).getTime(),
    readyReason: row.ready_reason ?? null,
    explanation: row.explanation,
    confidence: row.confidence,
    learningEpisodeCount: Number(row.learning_episode_count) || 0,
    effortSummary: fromJson(row.effort_summary, {}),
    recoverySummary: fromJson(row.recovery_summary, {}),
    freshSampleCount: Number(row.fresh_sample_count) || 0,
    belowTargetStartedAt: row.below_target_started_at == null
      ? null
      : new Date(row.below_target_started_at).getTime(),
    lastHeartRateRecordedAt: row.last_hr_recorded_at == null
      ? null
      : new Date(row.last_hr_recorded_at).getTime(),
    lastHeartRateStreamId: row.last_hr_stream_id ?? null,
    alertedAt: row.alerted_at == null ? null : new Date(row.alerted_at).getTime(),
    alertTrigger: row.alert_trigger ?? null,
    cancelledAt: row.cancelled_at == null ? null : new Date(row.cancelled_at).getTime(),
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  } : null;
}

function cloneRecoveryEpisode(episode) {
  return episode ? cloneJson(episode, episode) : null;
}

function recoveryOwnerUserId(ownerProfileKey) {
  return String(ownerProfileKey || '').startsWith('user:')
    ? String(ownerProfileKey).slice('user:'.length)
    : '';
}

export async function loadRecoveryAlertPreference(ownerProfileKey) {
  if (!pool) {
    return cloneJson(memoryRecoveryAlertPreferences.get(ownerProfileKey), null);
  }
  const result = await query(
    `SELECT * FROM ${schema}.recovery_alert_preferences WHERE owner_profile_key = $1 LIMIT 1`,
    [ownerProfileKey],
  );
  return recoveryAlertPreferenceFromRow(result?.rows?.[0]);
}

export async function saveRecoveryAlertPreference(ownerProfileKey, preference, now = Date.now()) {
  if (!pool) {
    const saved = { ...cloneJson(preference, preference), updatedAt: now };
    memoryRecoveryAlertPreferences.set(ownerProfileKey, saved);
    return cloneJson(saved, saved);
  }
  const result = await query(
    `INSERT INTO ${schema}.recovery_alert_preferences (
       owner_profile_key, owner_user_id, mode, timer_seconds, target_bpm, minimum_seconds,
       maximum_seconds, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8 / 1000.0), to_timestamp($8 / 1000.0))
     ON CONFLICT (owner_profile_key) DO UPDATE SET
       mode = EXCLUDED.mode,
       timer_seconds = EXCLUDED.timer_seconds,
       target_bpm = EXCLUDED.target_bpm,
       minimum_seconds = EXCLUDED.minimum_seconds,
       maximum_seconds = EXCLUDED.maximum_seconds,
       updated_at = EXCLUDED.updated_at
     RETURNING *`,
    [
      ownerProfileKey,
      recoveryOwnerUserId(ownerProfileKey),
      preference.mode,
      preference.timerSeconds,
      preference.targetBpm,
      preference.minimumSeconds,
      preference.maximumSeconds,
      now,
    ],
  );
  return recoveryAlertPreferenceFromRow(result?.rows?.[0]);
}

export async function loadRecoveryLearningSummaries(ownerProfileKey, activityType, targetBpm, limit = 12) {
  const boundedLimit = Math.max(2, Math.min(50, Math.round(Number(limit) || 12)));
  if (!pool) {
    return [...memoryRecoveryAlertEpisodes.values()]
      .filter((episode) => (
        episode.ownerProfileKey === ownerProfileKey
        && episode.activityType === activityType
        && episode.targetBpm === targetBpm
        && episode.cancelledAt == null
        && episode.readyReason === 'heart-rate-target'
        && Number(episode.recoverySummary?.recoverySeconds) > 0
        && Number(episode.recoverySummary?.sampleCount) >= 3
      ))
      .sort((left, right) => right.readyAt - left.readyAt)
      .slice(0, boundedLimit)
      .reverse()
      .map((episode) => ({
        recoverySeconds: Number(episode.recoverySummary.recoverySeconds),
        sampleCount: Number(episode.recoverySummary.sampleCount),
        effortSummary: cloneJson(episode.effortSummary, {}),
      }));
  }
  // Learning deliberately reads only bounded episode summaries. It never joins
  // the raw heart_rate_samples table or exposes another account's history.
  const result = await query(
    `SELECT recovery_summary, effort_summary
     FROM ${schema}.recovery_alert_episodes
     WHERE owner_profile_key = $1
       AND activity_type = $2
       AND target_bpm = $3
       AND cancelled_at IS NULL
       AND ready_reason = 'heart-rate-target'
       AND COALESCE((recovery_summary ->> 'sampleCount')::integer, 0) >= 3
     ORDER BY ready_at DESC
     LIMIT $4`,
    [ownerProfileKey, activityType, targetBpm, boundedLimit],
  );
  return (result?.rows ?? []).reverse().map((row) => ({
    recoverySeconds: Number(fromJson(row.recovery_summary, {}).recoverySeconds),
    sampleCount: Number(fromJson(row.recovery_summary, {}).sampleCount),
    effortSummary: fromJson(row.effort_summary, {}),
  })).filter((summary) => Number.isFinite(summary.recoverySeconds) && summary.recoverySeconds > 0);
}

function sameRecoveryRequest(episode, candidate) {
  return episode.requestFingerprint === candidate.requestFingerprint
    && episode.activityType === candidate.activityType
    && episode.sessionId === candidate.sessionId
    && episode.repetitionId === candidate.repetitionId
    && episode.startedAt === candidate.startedAt;
}

function compareRecoveryEpisodeAuthority(left, right) {
  return right.startedAt - left.startedAt
    || right.createdAt - left.createdAt
    || right.updatedAt - left.updatedAt
    || String(right.id).localeCompare(String(left.id));
}

function latestMemoryRecoveryAlertEpisode(ownerProfileKey) {
  return [...memoryRecoveryAlertEpisodes.values()]
    .filter((episode) => episode.ownerProfileKey === ownerProfileKey)
    .sort(compareRecoveryEpisodeAuthority)[0] ?? null;
}

export async function createRecoveryAlertEpisode(
  ownerProfileKey,
  candidate,
  now = Date.now(),
  revisionAt = Math.max(now, candidate.startedAt),
) {
  if (!pool) {
    const replay = [...memoryRecoveryAlertEpisodes.values()].find((episode) => (
      episode.ownerProfileKey === ownerProfileKey
      && (episode.requestId === candidate.requestId || (
        episode.activityType === candidate.activityType
        && episode.sessionId === candidate.sessionId
        && episode.repetitionId === candidate.repetitionId
      ))
    ));
    if (replay) {
      return {
        episode: cloneRecoveryEpisode(replay),
        replayed: sameRecoveryRequest(replay, candidate),
        conflict: !sameRecoveryRequest(replay, candidate),
      };
    }
    const latest = latestMemoryRecoveryAlertEpisode(ownerProfileKey);
    const staleArrival = latest != null && candidate.startedAt < latest.startedAt;
    if (!staleArrival) {
      for (const episode of memoryRecoveryAlertEpisodes.values()) {
        const stillRecovering = episode.readyAt == null
          && (episode.plannedReadyAt == null || episode.plannedReadyAt > now)
          && episode.fallbackAt > now;
        if (episode.ownerProfileKey === ownerProfileKey && episode.cancelledAt == null && stillRecovering) {
          episode.cancelledAt = Math.max(episode.startedAt, now);
          episode.updatedAt = Math.max(now, episode.startedAt, episode.updatedAt + 1);
        }
      }
    }
    const stored = {
      ...cloneJson(candidate, candidate),
      ownerProfileKey,
      readyAt: null,
      readyReason: null,
      recoverySummary: {},
      freshSampleCount: 0,
      belowTargetStartedAt: null,
      lastHeartRateRecordedAt: null,
      lastHeartRateStreamId: null,
      alertedAt: null,
      alertTrigger: null,
      cancelledAt: staleArrival ? Math.max(candidate.startedAt, now) : null,
      createdAt: now,
      updatedAt: revisionAt,
    };
    memoryRecoveryAlertEpisodes.set(stored.id, stored);
    return { episode: cloneRecoveryEpisode(stored), replayed: false, conflict: false };
  }
  return withPersistenceLock(`recovery-alert:${ownerProfileKey}`, async (client) => {
    const existing = await client.query(
      `SELECT * FROM ${schema}.recovery_alert_episodes
       WHERE owner_profile_key = $1
         AND (
           request_id = $2
           OR (activity_type = $3 AND session_id = $4 AND repetition_id = $5)
         )
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [ownerProfileKey, candidate.requestId, candidate.activityType, candidate.sessionId, candidate.repetitionId],
    );
    const replay = recoveryAlertEpisodeFromRow(existing.rows[0]);
    if (replay) {
      const matches = sameRecoveryRequest(replay, candidate);
      return { episode: replay, replayed: matches, conflict: !matches };
    }
    const latestResult = await client.query(
      `SELECT * FROM ${schema}.recovery_alert_episodes
       WHERE owner_profile_key = $1
       ORDER BY started_at DESC, created_at DESC, id DESC
       LIMIT 1
       FOR UPDATE`,
      [ownerProfileKey],
    );
    const latest = recoveryAlertEpisodeFromRow(latestResult.rows[0]);
    const staleArrival = latest != null && candidate.startedAt < latest.startedAt;
    if (!staleArrival) {
      await client.query(
        `UPDATE ${schema}.recovery_alert_episodes
         SET cancelled_at = GREATEST(started_at, to_timestamp($2 / 1000.0)),
           updated_at = GREATEST(
             updated_at + interval '1 millisecond',
             started_at,
             to_timestamp($2 / 1000.0)
           )
         WHERE owner_profile_key = $1
           AND cancelled_at IS NULL
           AND ready_at IS NULL
           AND (planned_ready_at IS NULL OR planned_ready_at > to_timestamp($2 / 1000.0))
           AND fallback_at > to_timestamp($2 / 1000.0)`,
        [ownerProfileKey, now],
      );
    }
    const inserted = await client.query(
      `INSERT INTO ${schema}.recovery_alert_episodes (
         id, owner_profile_key, owner_user_id, request_id, request_fingerprint, activity_type,
         session_id, repetition_id, mode, timer_seconds, target_bpm,
         minimum_seconds, maximum_seconds, started_at, not_before_at,
         planned_ready_at, fallback_at, explanation, confidence,
         learning_episode_count, effort_summary, cancelled_at, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
         to_timestamp($14 / 1000.0), to_timestamp($15 / 1000.0),
         CASE WHEN $16::double precision IS NULL THEN NULL ELSE to_timestamp($16 / 1000.0) END,
         to_timestamp($17 / 1000.0), $18, $19, $20, $21::jsonb,
         CASE WHEN $22::double precision IS NULL THEN NULL ELSE to_timestamp($22 / 1000.0) END,
         clock_timestamp(), to_timestamp($23 / 1000.0)
       ) RETURNING *`,
      [
        candidate.id,
        ownerProfileKey,
        recoveryOwnerUserId(ownerProfileKey),
        candidate.requestId,
        candidate.requestFingerprint,
        candidate.activityType,
        candidate.sessionId,
        candidate.repetitionId,
        candidate.mode,
        candidate.timerSeconds,
        candidate.targetBpm,
        candidate.minimumSeconds,
        candidate.maximumSeconds,
        candidate.startedAt,
        candidate.notBeforeAt,
        candidate.plannedReadyAt,
        candidate.fallbackAt,
        candidate.explanation,
        candidate.confidence,
        candidate.learningEpisodeCount,
        json(candidate.effortSummary),
        staleArrival ? Math.max(candidate.startedAt, now) : null,
        revisionAt,
      ],
    );
    return {
      episode: recoveryAlertEpisodeFromRow(inserted.rows[0]),
      replayed: false,
      conflict: false,
    };
  });
}

export async function loadRecoveryAlertEpisode(ownerProfileKey, episodeId) {
  if (!pool) {
    const episode = memoryRecoveryAlertEpisodes.get(episodeId);
    return episode?.ownerProfileKey === ownerProfileKey ? cloneRecoveryEpisode(episode) : null;
  }
  const result = await query(
    `SELECT * FROM ${schema}.recovery_alert_episodes
     WHERE id = $1 AND owner_profile_key = $2 LIMIT 1`,
    [episodeId, ownerProfileKey],
  );
  return recoveryAlertEpisodeFromRow(result?.rows?.[0]);
}

const recoveryAlertActiveVisibilityMs = 60 * 60 * 1_000;

function recoveryAlertEpisodeStillVisible(episode, now) {
  if (!episode) return false;
  const anchor = episode.cancelledAt == null
    ? episode.fallbackAt
    : Math.max(episode.fallbackAt, episode.updatedAt);
  return now <= anchor + recoveryAlertActiveVisibilityMs;
}

export async function loadActiveRecoveryAlertEpisode(ownerProfileKey, now = Date.now()) {
  if (!pool) {
    const episode = latestMemoryRecoveryAlertEpisode(ownerProfileKey);
    return episode?.cancelledAt == null && recoveryAlertEpisodeStillVisible(episode, now)
      ? cloneRecoveryEpisode(episode)
      : null;
  }
  const result = await query(
    `SELECT * FROM ${schema}.recovery_alert_episodes
     WHERE owner_profile_key = $1
     ORDER BY started_at DESC, created_at DESC, id DESC LIMIT 1`,
    [ownerProfileKey],
  );
  const episode = recoveryAlertEpisodeFromRow(result?.rows?.[0]);
  return episode?.cancelledAt == null && recoveryAlertEpisodeStillVisible(episode, now) ? episode : null;
}

export async function loadLatestRecoveryAlertEpisode(ownerProfileKey) {
  if (!pool) {
    const episode = latestMemoryRecoveryAlertEpisode(ownerProfileKey);
    return cloneRecoveryEpisode(episode);
  }
  const result = await query(
    `SELECT * FROM ${schema}.recovery_alert_episodes
     WHERE owner_profile_key = $1
     ORDER BY started_at DESC, created_at DESC, id DESC LIMIT 1`,
    [ownerProfileKey],
  );
  return recoveryAlertEpisodeFromRow(result?.rows?.[0]);
}

function updateMemoryRecoveryEpisode(episode, action, options, now, revisionAt) {
  if (!episode || episode.cancelledAt != null) return null;
  if (action === 'stop') {
    episode.cancelledAt = Math.max(episode.startedAt, now);
  } else if (action === 'start-anyway') {
    const readyAt = Math.max(episode.startedAt, Math.min(episode.fallbackAt, now));
    episode.readyAt = readyAt;
    episode.readyReason = 'manual-start';
    // Manual readiness is already acknowledged by the athlete. Persist the
    // trigger so another signed-in device treats it as a silent completion,
    // never as a new notification/haptic request.
    episode.alertedAt = readyAt;
    episode.alertTrigger = 'manual';
    episode.explanation = 'Started manually. Begin only when you feel ready.';
    episode.belowTargetStartedAt = null;
  } else if (action === 'add-time') {
    const seconds = options.seconds;
    const extensionMs = seconds * 1_000;
    const absoluteLimit = episode.startedAt + 1_800_000;
    const nextFallback = Math.min(absoluteLimit, Math.max(now, episode.fallbackAt) + extensionMs);
    if (nextFallback <= episode.fallbackAt) return null;
    if (episode.plannedReadyAt != null) {
      episode.plannedReadyAt = Math.min(nextFallback, Math.max(now, episode.plannedReadyAt) + extensionMs);
    }
    episode.fallbackAt = nextFallback;
    episode.readyAt = null;
    episode.readyReason = null;
    episode.alertedAt = null;
    episode.alertTrigger = null;
    episode.belowTargetStartedAt = null;
    episode.explanation = 'Recovery extended. Start when the next alert appears and you feel ready.';
  }
  episode.updatedAt = revisionAt;
  return episode;
}

export async function updateRecoveryAlertEpisode(ownerProfileKey, episodeId, action, options = {}, now = Date.now()) {
  if (!pool) {
    const episode = memoryRecoveryAlertEpisodes.get(episodeId);
    if (!episode || episode.ownerProfileKey !== ownerProfileKey) return null;
    const revisionAt = Math.max(now, episode.startedAt, episode.updatedAt + 1);
    return cloneRecoveryEpisode(updateMemoryRecoveryEpisode(episode, action, options, now, revisionAt));
  }
  return withPersistenceLock(`recovery-alert:${ownerProfileKey}`, async (client) => {
    const loaded = await client.query(
      `SELECT * FROM ${schema}.recovery_alert_episodes
       WHERE id = $1 AND owner_profile_key = $2 LIMIT 1 FOR UPDATE`,
      [episodeId, ownerProfileKey],
    );
    const episode = recoveryAlertEpisodeFromRow(loaded.rows[0]);
    if (!episode || episode.cancelledAt != null) return null;
    const revisionAt = Math.max(now, episode.startedAt, episode.updatedAt + 1);
    if (action === 'stop') {
      const result = await client.query(
        `UPDATE ${schema}.recovery_alert_episodes
         SET cancelled_at = GREATEST(started_at, to_timestamp($3 / 1000.0)),
           updated_at = to_timestamp($4 / 1000.0)
         WHERE id = $1 AND owner_profile_key = $2 RETURNING *`,
        [episodeId, ownerProfileKey, now, revisionAt],
      );
      return recoveryAlertEpisodeFromRow(result.rows[0]);
    }
    if (action === 'start-anyway') {
      const readyAt = Math.max(episode.startedAt, Math.min(episode.fallbackAt, now));
      const result = await client.query(
        `UPDATE ${schema}.recovery_alert_episodes
         SET ready_at = to_timestamp($3 / 1000.0), ready_reason = 'manual-start',
           alerted_at = to_timestamp($3 / 1000.0), alert_trigger = 'manual',
           explanation = 'Started manually. Begin only when you feel ready.',
           below_target_started_at = NULL, updated_at = to_timestamp($4 / 1000.0)
         WHERE id = $1 AND owner_profile_key = $2 RETURNING *`,
        [episodeId, ownerProfileKey, readyAt, revisionAt],
      );
      return recoveryAlertEpisodeFromRow(result.rows[0]);
    }
    if (action !== 'add-time') return null;
    const extensionMs = options.seconds * 1_000;
    const absoluteLimit = episode.startedAt + 1_800_000;
    const nextFallback = Math.min(absoluteLimit, Math.max(now, episode.fallbackAt) + extensionMs);
    if (nextFallback <= episode.fallbackAt) return null;
    const nextPlanned = episode.plannedReadyAt == null
      ? null
      : Math.min(nextFallback, Math.max(now, episode.plannedReadyAt) + extensionMs);
    const result = await client.query(
      `UPDATE ${schema}.recovery_alert_episodes
       SET fallback_at = to_timestamp($3 / 1000.0),
         planned_ready_at = CASE WHEN $4::double precision IS NULL
           THEN NULL ELSE to_timestamp($4 / 1000.0) END,
         ready_at = NULL, ready_reason = NULL, alerted_at = NULL, alert_trigger = NULL,
         below_target_started_at = NULL,
         explanation = 'Recovery extended. Start when the next alert appears and you feel ready.',
         updated_at = to_timestamp($5 / 1000.0)
       WHERE id = $1 AND owner_profile_key = $2 RETURNING *`,
      [episodeId, ownerProfileKey, nextFallback, nextPlanned, revisionAt],
    );
    return recoveryAlertEpisodeFromRow(result.rows[0]);
  });
}

const recoveryHeartRateFreshnessMs = 10_000;
const recoveryHeartRateFutureSkewMs = 2_000;
const recoveryHeartRateMaximumGapMs = 6_000;
const recoveryHeartRateSustainedMs = 12_000;

function recoveryMedianBpm(samples) {
  const values = samples.map((sample) => sample.bpm).sort((left, right) => left - right);
  if (values.length === 0) return null;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

function applyRecoverySampleToEpisode(episode, streamId, sample, decisionWindow, receivedAt) {
  if (
    !episode
    || episode.cancelledAt != null
    || episode.readyAt != null
    || !['heart-rate', 'smart'].includes(episode.mode)
    || episode.targetBpm == null
    || receivedAt >= episode.fallbackAt
    || sample.recordedAt > episode.fallbackAt
  ) return false;

  // Stored window points are deliberately revisited to calculate the rolling
  // median. Ignore those already-accounted-for points before applying live
  // freshness rules to the newly accepted tail sample.
  if (episode.lastHeartRateRecordedAt != null && sample.recordedAt <= episode.lastHeartRateRecordedAt) {
    return false;
  }
  // Match the Watch engine: new sensor timing that is too early, stale, or too
  // far in the future fails closed and breaks any in-progress sustained hold.
  if (
    receivedAt < episode.notBeforeAt
    || sample.recordedAt < episode.notBeforeAt
    || sample.recordedAt < receivedAt - recoveryHeartRateFreshnessMs
    || sample.recordedAt > receivedAt + recoveryHeartRateFutureSkewMs
  ) {
    const changed = episode.belowTargetStartedAt != null;
    episode.belowTargetStartedAt = null;
    return changed;
  }
  episode.freshSampleCount += 1;
  const previousAt = episode.lastHeartRateRecordedAt;
  episode.lastHeartRateRecordedAt = sample.recordedAt;
  episode.lastHeartRateStreamId = streamId;
  const eligibleDecisionWindow = decisionWindow.filter((candidate) => (
    candidate.recordedAt >= episode.notBeforeAt
    && Number(candidate._receivedAt) >= episode.notBeforeAt
  ));
  const smoothedBpm = eligibleDecisionWindow.length >= 2
    ? recoveryMedianBpm(eligibleDecisionWindow)
    : null;
  if (smoothedBpm != null && smoothedBpm <= episode.targetBpm) {
    if (
      episode.belowTargetStartedAt == null
      || previousAt == null
      || sample.recordedAt - previousAt > recoveryHeartRateMaximumGapMs
    ) episode.belowTargetStartedAt = sample.recordedAt;
    if (sample.recordedAt - episode.belowTargetStartedAt >= recoveryHeartRateSustainedMs) {
      episode.readyAt = sample.recordedAt;
      episode.readyReason = 'heart-rate-target';
      episode.explanation = 'Recovery target reached — start when you feel ready.';
      episode.recoverySummary = {
        recoverySeconds: Math.round((sample.recordedAt - episode.startedAt) / 100) / 10,
        sampleCount: episode.freshSampleCount,
        sustainedTargetSeconds: recoveryHeartRateSustainedMs / 1_000,
      };
    }
  } else {
    episode.belowTargetStartedAt = null;
  }
  return true;
}

async function buildRecoveryHeartRateEvaluations(
  episode,
  streamId,
  evaluationSamples,
  receivedAt,
  execute = null,
) {
  if (evaluationSamples.length === 0) return [];
  const acceptedSequences = evaluationSamples
    .map((sample) => Number(sample.sequence))
    .filter((sequence) => Number.isSafeInteger(sequence));
  const cursorAt = episode.lastHeartRateRecordedAt;
  const upperRecordedAt = cursorAt ?? evaluationSamples[0].recordedAt;
  const includeUpperBound = cursorAt != null;
  // The ingest endpoint stores the accepted batch first. Exclude those exact
  // sequences while seeding so a same-clock retry cannot replace the prior
  // Watch point. When a cursor exists, include its equal timestamp and choose
  // the earliest receipt-valid sequence for that sensor clock.
  const storedWindow = execute
    ? await loadRecentHeartRateSamplesWithQuery(
      execute,
      streamId,
      4,
      upperRecordedAt,
      includeUpperBound,
      acceptedSequences,
    )
    : await loadRecentHeartRateSamples(
      streamId,
      4,
      upperRecordedAt,
      includeUpperBound,
      acceptedSequences,
    );
  let rollingWindow = storedWindow.filter((sample) => {
    const originalReceivedAt = Number(sample._receivedAt);
    return Number.isFinite(originalReceivedAt)
      && sample.recordedAt >= originalReceivedAt - recoveryHeartRateFreshnessMs
      && sample.recordedAt <= originalReceivedAt + recoveryHeartRateFutureSkewMs
      && sample.recordedAt >= receivedAt - recoveryHeartRateFreshnessMs;
  }).sort((left, right) => (
    left.recordedAt - right.recordedAt
    || Number(left.sequence ?? 0) - Number(right.sequence ?? 0)
  )).slice(-4);
  let contiguousStart = rollingWindow.length > 0 ? rollingWindow.length - 1 : 0;
  while (
    contiguousStart > 0
    && rollingWindow[contiguousStart].recordedAt
      - rollingWindow[contiguousStart - 1].recordedAt <= recoveryHeartRateMaximumGapMs
  ) contiguousStart -= 1;
  rollingWindow = rollingWindow.slice(contiguousStart);
  return evaluationSamples.map((sample) => {
    const originalReceivedAt = Number(sample._receivedAt);
    const receiptValid = Number.isFinite(originalReceivedAt)
      && sample.recordedAt >= originalReceivedAt - recoveryHeartRateFreshnessMs
      && sample.recordedAt <= originalReceivedAt + recoveryHeartRateFutureSkewMs;
    const previous = rollingWindow.at(-1);
    // Invalid points reset only the sustained hold in the episode evaluator.
    // Non-increasing valid points are ignored before they touch this window.
    // A valid clock gap over six seconds clears both, matching Watch.
    if (
      receiptValid
      && (cursorAt == null || sample.recordedAt > cursorAt)
      && (!previous || sample.recordedAt > previous.recordedAt)
    ) {
      if (
        previous
        && sample.recordedAt - previous.recordedAt > recoveryHeartRateMaximumGapMs
      ) rollingWindow = [];
      rollingWindow.push(sample);
      rollingWindow = rollingWindow.filter((candidate) => (
        candidate.recordedAt >= originalReceivedAt - recoveryHeartRateFreshnessMs
      )).slice(-5);
    }
    return {
      sample,
      receivedAt: originalReceivedAt,
      decisionWindow: [...rollingWindow],
    };
  });
}

export async function applyRecoveryHeartRateSamples(
  ownerProfileKey,
  streamId,
  samples,
  receivedAt = Date.now(),
) {
  const evaluationSamples = [...samples]
    .map((sample) => ({
      ...sample,
      _receivedAt: Number.isFinite(Number(sample._receivedAt))
        ? Number(sample._receivedAt)
        : receivedAt,
    }))
    .sort((left, right) => (
      left.recordedAt - right.recordedAt
      || Number(left.sequence ?? 0) - Number(right.sequence ?? 0)
    ));
  if (!pool) {
    const episode = latestMemoryRecoveryAlertEpisode(ownerProfileKey);
    if (!episode || episode.cancelledAt != null) return episode ? cloneRecoveryEpisode(episode) : null;
    const evaluations = await buildRecoveryHeartRateEvaluations(
      episode,
      streamId,
      evaluationSamples,
      receivedAt,
    );
    const priorUpdatedAt = episode.updatedAt;
    let changed = false;
    evaluations.forEach((evaluation) => {
      changed = applyRecoverySampleToEpisode(
        episode,
        streamId,
        evaluation.sample,
        evaluation.decisionWindow,
        evaluation.receivedAt,
      ) || changed;
    });
    if (changed) episode.updatedAt = Math.max(receivedAt, episode.startedAt, priorUpdatedAt + 1);
    return cloneRecoveryEpisode(episode);
  }
  return withPersistenceLock(`recovery-alert:${ownerProfileKey}`, async (client) => {
    const loaded = await client.query(
      `SELECT * FROM ${schema}.recovery_alert_episodes
       WHERE owner_profile_key = $1
       ORDER BY started_at DESC, created_at DESC, id DESC LIMIT 1 FOR UPDATE`,
      [ownerProfileKey],
    );
    const episode = recoveryAlertEpisodeFromRow(loaded.rows[0]);
    if (!episode || episode.cancelledAt != null) return episode;
    const evaluations = await buildRecoveryHeartRateEvaluations(
      episode,
      streamId,
      evaluationSamples,
      receivedAt,
      (text, params) => client.query(text, params),
    );
    const priorUpdatedAt = episode.updatedAt;
    let changed = false;
    evaluations.forEach((evaluation) => {
      changed = applyRecoverySampleToEpisode(
        episode,
        streamId,
        evaluation.sample,
        evaluation.decisionWindow,
        evaluation.receivedAt,
      ) || changed;
    });
    if (!changed) return episode;
    const revisionAt = Math.max(receivedAt, episode.startedAt, priorUpdatedAt + 1);
    const updated = await client.query(
      `UPDATE ${schema}.recovery_alert_episodes
       SET ready_at = CASE WHEN $3::double precision IS NULL
           THEN NULL ELSE to_timestamp($3 / 1000.0) END,
         ready_reason = $4,
         explanation = $5,
         recovery_summary = $6::jsonb,
         fresh_sample_count = $7,
         below_target_started_at = CASE WHEN $8::double precision IS NULL
           THEN NULL ELSE to_timestamp($8 / 1000.0) END,
         last_hr_recorded_at = CASE WHEN $9::double precision IS NULL
           THEN NULL ELSE to_timestamp($9 / 1000.0) END,
         last_hr_stream_id = $10,
         updated_at = to_timestamp($11 / 1000.0)
       WHERE id = $1 AND owner_profile_key = $2 RETURNING *`,
      [
        episode.id,
        ownerProfileKey,
        episode.readyAt,
        episode.readyReason,
        episode.explanation,
        json(episode.recoverySummary),
        episode.freshSampleCount,
        episode.belowTargetStartedAt,
        episode.lastHeartRateRecordedAt,
        episode.lastHeartRateStreamId,
        revisionAt,
      ],
    );
    return recoveryAlertEpisodeFromRow(updated.rows[0]);
  });
}

export async function acknowledgeRecoveryAlert(
  ownerProfileKey,
  episodeId,
  trigger,
  triggeredAt,
  now = Date.now(),
) {
  if (!pool) {
    const episode = memoryRecoveryAlertEpisodes.get(episodeId);
    if (!episode || episode.ownerProfileKey !== ownerProfileKey || episode.cancelledAt != null) return null;
    if (episode.alertedAt == null) {
      episode.alertedAt = triggeredAt;
      episode.alertTrigger = trigger;
      // triggeredAt is a sensor/device event clock, not a server revision.
      episode.updatedAt = Math.max(now, episode.startedAt, episode.updatedAt + 1);
    }
    return cloneRecoveryEpisode(episode);
  }
  const result = await query(
    `UPDATE ${schema}.recovery_alert_episodes
     SET alerted_at = COALESCE(alerted_at, to_timestamp($4 / 1000.0)),
       alert_trigger = COALESCE(alert_trigger, $3),
       updated_at = CASE WHEN alerted_at IS NULL
         THEN GREATEST(updated_at + interval '1 millisecond', to_timestamp($5 / 1000.0))
         ELSE updated_at END
     WHERE id = $1 AND owner_profile_key = $2 AND cancelled_at IS NULL
     RETURNING *`,
    [episodeId, ownerProfileKey, trigger, triggeredAt, now],
  );
  return recoveryAlertEpisodeFromRow(result?.rows?.[0]);
}

/** Used by account-erasure flows; PostgreSQL also cascades directly from auth_users. */
export async function deleteRecoveryAlertData(ownerProfileKey) {
  if (!pool) {
    memoryRecoveryAlertPreferences.delete(ownerProfileKey);
    for (const [episodeId, episode] of memoryRecoveryAlertEpisodes.entries()) {
      if (episode.ownerProfileKey === ownerProfileKey) memoryRecoveryAlertEpisodes.delete(episodeId);
    }
    return true;
  }
  const result = await query(
    `WITH deleted_preferences AS (
       DELETE FROM ${schema}.recovery_alert_preferences WHERE owner_profile_key = $1 RETURNING owner_profile_key
     ), deleted_episodes AS (
       DELETE FROM ${schema}.recovery_alert_episodes WHERE owner_profile_key = $1 RETURNING owner_profile_key
     )
     SELECT
       (SELECT count(*)::integer FROM deleted_preferences) AS preferences,
       (SELECT count(*)::integer FROM deleted_episodes) AS episodes`,
    [ownerProfileKey],
  );
  return Boolean(result);
}
