import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  databaseMigrations,
  migrationChecksum,
  runDatabaseMigrations,
} from '../../cloud/migrations.mjs';

type Migration = {
  version: number;
  name: string;
  statements: string[];
};

type QueryCall = {
  text: string;
  params: unknown[];
};

function migration(version: number, statement = `SELECT ${version}`): Migration {
  return {
    version,
    name: `migration ${version}`,
    statements: [statement],
  };
}

function fakeDatabase(options: {
  applied?: Array<{ version: number; name: string; checksum: string }>;
  failOn?: string;
} = {}) {
  const calls: QueryCall[] = [];
  const client = {
    query: vi.fn(async (text: string, params: unknown[] = []) => {
      calls.push({ text: text.trim(), params });
      if (options.failOn && text.includes(options.failOn)) {
        throw new Error('simulated migration failure');
      }
      if (text.includes('SELECT version, name, checksum')) {
        return { rows: options.applied ?? [] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn(async () => client),
  };

  return { pool, client, calls };
}

describe('database migration runner', () => {
  it('copies Apple billing and connection-capacity tables during database moves', () => {
    const source = readFileSync(
      new URL('../../scripts/migrate-tracklab-postgres.mjs', import.meta.url),
      'utf8',
    );
    const authUsers = source.indexOf("'auth_users'");
    const lineageBindings = source.indexOf("'apple_iap_lineage_token_bindings'");
    const subscriptions = source.indexOf("'apple_iap_subscriptions'");
    const transactions = source.indexOf("'apple_iap_transactions'");
    const notifications = source.indexOf("'apple_iap_notifications'");
    const leases = source.indexOf("'wattbike_connection_leases'");

    expect(authUsers).toBeGreaterThanOrEqual(0);
    expect(lineageBindings).toBeGreaterThan(authUsers);
    expect(lineageBindings).toBeLessThan(subscriptions);
    expect(subscriptions).toBeGreaterThan(authUsers);
    expect(transactions).toBeGreaterThan(subscriptions);
    expect(notifications).toBeGreaterThan(subscriptions);
    expect(leases).toBeGreaterThan(authUsers);
  });

  it('includes recovery for custom sprint maps saved while the location was still a preview', () => {
    const recoveryMigration = databaseMigrations().find((candidate) => candidate.version === 9);

    expect(recoveryMigration).toMatchObject({
      version: 9,
      name: 'recover custom sprint maps saved from location previews',
    });
    expect(recoveryMigration?.statements.join('\n')).toContain('custom-preview-%');
    expect(recoveryMigration?.statements.join('\n')).toContain('public_custom_routes');
    expect(recoveryMigration?.statements.join('\n')).toContain('public_track_mappings');
  });

  it('adds account profiles and durable training history', () => {
    const trainingHistoryMigration = databaseMigrations().find((candidate) => candidate.version === 10);

    expect(trainingHistoryMigration).toMatchObject({
      version: 10,
      name: 'add account profiles and unified training history',
    });
    expect(trainingHistoryMigration?.statements.join('\n')).toContain('account_profile');
    expect(trainingHistoryMigration?.statements.join('\n')).toContain('training_sessions');
    expect(trainingHistoryMigration?.statements.join('\n')).toContain('profile_key');
  });

  it('adds private one-time club athlete claims', () => {
    const clubConnectMigration = databaseMigrations().find((candidate) => candidate.version === 11);

    expect(clubConnectMigration).toMatchObject({
      version: 11,
      name: 'add secure club connect athlete claims',
    });
    expect(clubConnectMigration?.statements.join('\n')).toContain('club_members');
    expect(clubConnectMigration?.statements.join('\n')).toContain('club_invites');
    expect(clubConnectMigration?.statements.join('\n')).toContain('token_hash');
    expect(clubConnectMigration?.statements.join('\n')).toContain('athlete_profile_key');
  });

  it('attributes one canonical athlete session to both the athlete and club', () => {
    const clubSessionMigration = databaseMigrations().find((candidate) => candidate.version === 12);

    expect(clubSessionMigration).toMatchObject({
      version: 12,
      name: 'attribute athlete training sessions to clubs',
    });
    expect(clubSessionMigration?.statements.join('\n')).toContain('club_id');
    expect(clubSessionMigration?.statements.join('\n')).toContain('studio_rider_id');
    expect(clubSessionMigration?.statements.join('\n')).toContain('idx_tracklab_training_sessions_club_date');
  });

  it('stores only hashed credentials for owner-authorized shared club tablets', () => {
    const clubTabletMigration = databaseMigrations().find((candidate) => candidate.version === 13);

    expect(clubTabletMigration).toMatchObject({
      version: 13,
      name: 'add owner-authorized shared club tablets',
    });
    expect(clubTabletMigration?.statements.join('\n')).toContain('club_tablet_devices');
    expect(clubTabletMigration?.statements.join('\n')).toContain('token_hash TEXT UNIQUE NOT NULL');
    expect(clubTabletMigration?.statements.join('\n')).toContain('revoked_at');
  });

  it('adds one durable four-tablet Club Event lobby per club without raw credentials', () => {
    const clubEventMigration = databaseMigrations().find((candidate) => candidate.version === 27);
    const statements = clubEventMigration?.statements.join('\n') ?? '';

    expect(clubEventMigration).toMatchObject({
      version: 27,
      name: 'add durable club event tablet lobbies',
    });
    expect(statements).toContain('club_events');
    expect(statements).toContain('club_event_participants');
    expect(statements).toContain("activity_type IN ('bmx-race', 'straight-sprint', 'explore')");
    expect(statements).toContain("WHERE status IN ('lobby', 'active')");
    expect(statements).toContain('seat_number BETWEEN 1 AND 4');
    expect(statements).toContain('UNIQUE (event_id, device_id)');
    expect(statements).toContain('UNIQUE (event_id, studio_rider_id)');
    expect(statements).toContain('UNIQUE (event_id, bike_device_id)');
    expect(statements).toContain('session_token_hash TEXT NOT NULL');
    expect(statements).not.toContain('session_token TEXT');
  });

  it('persists Club Event launch acknowledgments and deferred tablet-result credentials', () => {
    const hardeningMigration = databaseMigrations().find((candidate) => candidate.version === 28);
    const statements = hardeningMigration?.statements.join('\n') ?? '';

    expect(hardeningMigration).toMatchObject({
      version: 28,
      name: 'harden club event launches and deferred tablet results',
    });
    expect(statements).toContain('ADD COLUMN IF NOT EXISTS launched_at TIMESTAMPTZ');
    expect(statements).toContain('club_tablet_result_authorizations');
    expect(statements).toContain('token_hash TEXT PRIMARY KEY');
    expect(statements).toContain('session_token_hash TEXT NOT NULL UNIQUE');
    expect(statements).toContain('expires_at TIMESTAMPTZ NOT NULL');
    expect(statements).not.toContain('session_token TEXT');
  });

  it('stores verified Apple subscriptions, transaction history, and idempotent V2 notifications', () => {
    const appleMigration = databaseMigrations().find((candidate) => candidate.version === 29);
    const statements = appleMigration?.statements.join('\n') ?? '';

    expect(appleMigration).toMatchObject({
      version: 29,
      name: 'make verified apple subscriptions authoritative for wattbike seats',
    });
    expect(statements).toContain('legacy_membership_tier');
    expect(statements).toContain('apple_billing_managed');
    expect(statements).toContain('apple_iap_subscriptions');
    expect(statements).toContain('apple_iap_transactions');
    expect(statements).toContain('bike_seats BETWEEN 1 AND 4');
    expect(statements).toContain('app_account_token');
    expect(statements).toContain('apple_iap_notifications');
    expect(statements).toContain('notification_uuid TEXT PRIMARY KEY');
    expect(statements).toContain('signed_payload_sha256');
    expect(statements).toContain('reconciled_at TIMESTAMPTZ NOT NULL');
  });

  it('stores short account-wide Wattbike connection leases', () => {
    const capacityMigration = databaseMigrations().find((candidate) => candidate.version === 30);
    const statements = capacityMigration?.statements.join('\n') ?? '';

    expect(capacityMigration).toMatchObject({
      version: 30,
      name: 'enforce account wide wattbike connection capacity',
    });
    expect(statements).toContain('wattbike_connection_leases');
    expect(statements).toContain('billing_owner_user_id');
    expect(statements).toContain("allocation_kind IN ('owner-websocket', 'club-tablet')");
    expect(statements).toContain('seat_count BETWEEN 1 AND 4');
    expect(statements).toContain('expires_at TIMESTAMPTZ NOT NULL');
    expect(statements).toContain('PRIMARY KEY (billing_owner_user_id, allocation_key)');
    expect(statements).toContain('idx_tracklab_wattbike_connection_leases_expiry');
  });

  it('persists cross-instance Club Tablet athlete and bike holders', () => {
    const tabletHolderMigration = databaseMigrations().find((candidate) => candidate.version === 34);
    const statements = tabletHolderMigration?.statements.join('\n') ?? '';

    expect(tabletHolderMigration).toMatchObject({
      version: 34,
      name: 'persist club tablet session assignment holders',
    });
    expect(statements).toContain('wattbike_connection_leases');
    expect(statements).toContain('club_id TEXT');
    expect(statements).toContain('studio_rider_id TEXT');
    expect(statements).toContain('bike_device_id TEXT');
    expect(statements).toContain('wattbike_connection_leases_club_assignment_complete');
    expect(statements).toContain('idx_tracklab_wattbike_leases_club_rider');
    expect(statements).toContain('idx_tracklab_wattbike_leases_club_bike');
  });

  it('adds club-funded personal devices to the shared Wattbike lease pool', () => {
    const personalLeaseMigration = databaseMigrations().find((candidate) => candidate.version === 35);
    const statements = personalLeaseMigration?.statements.join('\n') ?? '';

    expect(personalLeaseMigration).toMatchObject({
      version: 35,
      name: 'share wattbike capacity with club personal devices',
    });
    expect(statements).toContain("'club-personal'");
    expect(statements).toContain('wattbike_connection_leases_allocation_kind_check');
    expect(statements).toContain('wattbike_connection_leases_club_assignment_complete');
    expect(statements).toMatch(/allocation_kind = 'club-tablet'[\s\S]*club_id IS NULL[\s\S]*studio_rider_id IS NULL[\s\S]*bike_device_id IS NULL/);
    expect(statements).toContain("allocation_kind = 'club-personal'");
    expect(statements).toContain('bike_device_id IS NULL');
  });

  it('marks legacy club tablets for recovery and preserves their paired Wattbike identity', () => {
    const tabletRecoveryMigration = databaseMigrations().find((candidate) => candidate.version === 36);
    const statements = tabletRecoveryMigration?.statements.join('\n') ?? '';

    expect(tabletRecoveryMigration).toMatchObject({
      version: 36,
      name: 'preserve club tablet recovery and paired wattbike identity',
    });
    expect(statements).toContain('recovery_state');
    expect(statements).toContain("WHEN last_seen_at >= TIMESTAMPTZ '2026-08-28 15:34:00+00' THEN 'restored'");
    expect(statements).toContain("ELSE 'pending'");
    expect(statements).toContain("ALTER COLUMN recovery_state SET DEFAULT 'complete'");
    expect(statements).toContain("recovery_state IN ('pending', 'complete', 'restored')");
    expect(statements).toContain('paired_bike_device_id BIGINT');
    expect(statements).toContain('paired_bike_label TEXT');
    expect(statements).toContain('paired_bike_updated_at TIMESTAMPTZ');
    expect(statements).toContain('club_tablet_devices_paired_bike_complete');
  });

  it('queues bike shop ownership claims for private manual verification', () => {
    const claimMigration = databaseMigrations().find((candidate) => candidate.version === 37);
    const statements = claimMigration?.statements.join('\n') ?? '';

    expect(claimMigration).toMatchObject({
      version: 37,
      name: 'add moderated bike shop ownership claims',
    });
    expect(statements).toContain('bike_shop_claim_requests');
    expect(statements).toContain("source = 'openstreetmap'");
    expect(statements).toContain("osm_element_type IN ('node', 'way', 'relation')");
    expect(statements).toContain("status IN ('pending', 'approved', 'rejected', 'withdrawn')");
    expect(statements).toContain('claimant_user_id');
    expect(statements).toContain('reviewer_user_id');
    expect(statements).toContain('ON DELETE SET NULL');
    expect(statements).toContain("status = 'withdrawn' AND reviewer_user_id IS NULL AND reviewed_at IS NULL");
    expect(statements).toContain("status IN ('approved', 'rejected') AND reviewed_at IS NOT NULL");
    expect(statements).not.toContain(
      "status IN ('approved', 'rejected') AND reviewer_user_id IS NOT NULL",
    );
    expect(statements).toContain("WHERE status = 'approved'");
    expect(statements).not.toContain('auto_approved');

    const copyScript = readFileSync(
      new URL('../../scripts/migrate-tracklab-postgres.mjs', import.meta.url),
      'utf8',
    );
    expect(copyScript).toContain("'bike_shop_claim_requests'");
  });

  it('allows corrected shop claim retries and anonymizes terminal history on account erasure', () => {
    const claimHardeningMigration = databaseMigrations().find((candidate) => candidate.version === 38);
    const statements = claimHardeningMigration?.statements.join('\n') ?? '';

    expect(claimHardeningMigration).toMatchObject({
      version: 38,
      name: 'harden bike shop claim retries and erasure retention',
    });
    expect(statements).toContain('legacy_unique_name');
    expect(statements).toContain('ALTER COLUMN claimant_user_id DROP NOT NULL');
    expect(statements).toContain('ON DELETE SET NULL');
    expect(statements).toContain("status <> 'pending' OR claimant_user_id IS NOT NULL");
    expect(statements).toContain('idx_tracklab_bike_shop_claim_active_claimant_shop');
    expect(statements).toContain("status IN ('pending', 'approved')");
    expect(statements).toContain("WHERE claimant_user_id IS NOT NULL");
  });

  it('extends moderated ownership claims to canonical Overture place listings', () => {
    const migration = databaseMigrations().find((candidate) => candidate.version === 39);
    const statements = migration?.statements.join('\n') ?? '';
    expect(migration).toMatchObject({
      version: 39,
      name: 'support Overture bike shop ownership claims',
    });
    expect(statements).toContain("source IN ('openstreetmap', 'overture')");
    expect(statements).toContain("source = 'overture' AND osm_element_type = 'place'");
    expect(statements).toContain("source = 'openstreetmap' AND osm_element_type IN ('node', 'way', 'relation')");
    expect(statements).toContain("[0-9a-f]{8}-[0-9a-f]{4}");
  });

  it('persists cross-catalog identity aliases for one moderated shop claim', () => {
    const migration = databaseMigrations().find((candidate) => candidate.version === 40);
    const statements = migration?.statements.join('\n') ?? '';
    expect(migration).toMatchObject({
      version: 40,
      name: 'preserve equivalent bike shop claim identities',
    });
    expect(statements).toContain('identity_aliases JSONB');
    expect(statements).toContain('jsonb_build_array');
    expect(statements).toContain('USING GIN (identity_aliases)');
  });

  it('adds accountable administrator review fields to community reports', () => {
    const moderationMigration = databaseMigrations().find((candidate) => candidate.version === 32);
    const statements = moderationMigration?.statements.join('\n') ?? '';

    expect(moderationMigration).toMatchObject({
      version: 32,
      name: 'add accountable community report moderation',
    });
    expect(statements).toContain('moderation_action');
    expect(statements).toContain('moderation_note');
    expect(statements).toContain('reviewed_by_user_id');
    expect(statements).toContain("'protect-reporter'");
    expect(statements).toContain('ON DELETE SET NULL');
    expect(statements).toContain('idx_tracklab_friend_reports_review_queue');
  });

  it('retains only a pseudonymous Apple lineage binding after account deletion', () => {
    const recoveryMigration = databaseMigrations().find((candidate) => candidate.version === 33);
    const statements = recoveryMigration?.statements.join('\n') ?? '';

    expect(recoveryMigration).toMatchObject({
      version: 33,
      name: 'retain pseudonymous apple lineage for restore after account deletion',
    });
    expect(statements).toContain('apple_iap_lineage_token_bindings');
    expect(statements).toContain('app_account_token_sha256');
    expect(statements).toContain('bound_user_id TEXT');
    expect(statements).toContain('ON DELETE SET NULL');
    expect(statements).toContain('WHERE bound_user_id IS NULL');
    expect(statements).not.toContain('email');
    expect(statements).not.toContain('display_name');
  });

  it('prepares Apple billing projection without destructively cutting over customers', () => {
    const cutoverMigration = databaseMigrations().find((candidate) => candidate.version === 31);
    const statements = cutoverMigration?.statements.join('\n') ?? '';

    expect(cutoverMigration).toMatchObject({
      version: 31,
      name: 'prepare query time apple billing entitlement projection',
    });
    expect(statements).toContain('idx_tracklab_auth_users_apple_billing_projection');
    expect(statements).not.toContain("membership_tier = 'spectator'");
    expect(statements).not.toContain('UPDATE');
  });

  it('adds durable per-account display unit preferences', () => {
    const unitPreferencesMigration = databaseMigrations().find((candidate) => candidate.version === 14);

    expect(unitPreferencesMigration).toMatchObject({
      version: 14,
      name: 'save account display unit preferences',
    });
    expect(unitPreferencesMigration?.statements.join('\n')).toContain('unit_preferences JSONB');
  });

  it('adds a private authenticated friend graph with hashed expiring invitations', () => {
    const friendsMigration = databaseMigrations().find((candidate) => candidate.version === 15);
    const statements = friendsMigration?.statements.join('\n') ?? '';

    expect(friendsMigration).toMatchObject({
      version: 15,
      name: 'add authenticated account friend network',
    });
    expect(statements).toContain('friend_discoverable BOOLEAN NOT NULL DEFAULT false');
    expect(statements).toContain('account_friendships');
    expect(statements).toContain('account_friend_requests');
    expect(statements).toContain('friend_blocks');
    expect(statements).toContain('friend_reports');
    expect(statements).toContain('friend_invites');
    expect(statements).toContain('token_hash TEXT UNIQUE NOT NULL');
    expect(statements).toContain('official_friend_accounts');
    expect(statements).toContain('reconciled_at TIMESTAMPTZ');
    expect(statements).toContain('SET reconciled_at = now()');
    expect(statements).toContain('idx_tracklab_auth_users_friend_handle_prefix');
    expect(statements).toContain('idx_tracklab_auth_users_friend_name_prefix');
    expect(statements).toContain('text_pattern_ops');
    expect(statements).toContain("('club', 'preskiranch@gmail.com')");
    expect(statements).toContain("('founder', 'rasheen25@gmail.com')");
    expect(statements).toContain("ON CONFLICT (user_id_a, user_id_b) DO UPDATE SET source = 'official'");
    expect(statements).toContain("WHERE existing.source = 'legacy'");
    expect(statements).toContain('row_number() OVER');
  });

  it('indexes recent live ghosts for friend race previews', () => {
    const migration = databaseMigrations().find((candidate) => candidate.version === 16);
    const statements = migration?.statements.join('\n') ?? '';

    expect(migration).toMatchObject({
      version: 16,
      name: 'index live ghosts for friend race discovery',
    });
    expect(statements).toContain('idx_tracklab_ghost_laps_live_owner_recent');
    expect(statements).toContain('owner_key, saved_at DESC, finish_time_ms ASC, id');
    expect(statements).toContain("WHERE race_source = 'live'");
  });

  it('keeps legacy account inserts compatible after usernames become required', () => {
    const compatibilityMigration = databaseMigrations().find((candidate) => candidate.version === 17);
    const statements = compatibilityMigration?.statements.join('\n') ?? '';

    expect(compatibilityMigration).toMatchObject({
      version: 17,
      name: 'keep account registration compatible with pre-friends releases',
    });
    expect(statements).toContain('ALTER COLUMN username SET DEFAULT');
    expect(statements).toContain('gen_random_uuid()');
  });

  it('stores private heart-rate relay data outside public training and ghost payloads', () => {
    const heartRateMigration = databaseMigrations().find((candidate) => candidate.version === 18);
    const statements = heartRateMigration?.statements.join('\n') ?? '';

    expect(heartRateMigration).toMatchObject({
      version: 18,
      name: 'store private apple watch heart rate sessions',
    });
    expect(statements).toContain('heart_rate_studio_invitations');
    expect(statements).toContain('heart_rate_pairings');
    expect(statements).toContain('pair_code_hash TEXT UNIQUE NOT NULL');
    expect(statements).toContain('ingest_token_hash TEXT UNIQUE');
    expect(statements).toContain('live_studio_consent BOOLEAN NOT NULL DEFAULT false');
    expect(statements).toContain('heart_rate_streams');
    expect(statements).toContain("zone_summaries JSONB NOT NULL DEFAULT '[]'::jsonb");
    expect(statements).toContain('heart_rate_samples');
    expect(statements).toContain('PRIMARY KEY (stream_id, sequence)');
    expect(statements).toContain('ON DELETE CASCADE');
    expect(statements).toContain('monitor-sprint');
  });

  it('binds owner Monitor View saves to one claimed athlete, bike, and session token', () => {
    const monitorMigration = databaseMigrations().find((candidate) => candidate.version === 19);
    const statements = monitorMigration?.statements.join('\n') ?? '';

    expect(monitorMigration).toMatchObject({
      version: 19,
      name: 'authorize owner monitor sprints for claimed club athletes',
    });
    expect(statements).toContain('club_monitor_sprint_authorizations');
    expect(statements).toContain('athlete_profile_key TEXT NOT NULL');
    expect(statements).toContain('bike_device_id TEXT NOT NULL');
    expect(statements).toContain('token_hash TEXT UNIQUE NOT NULL');
    expect(statements).toContain('UNIQUE (club_id, studio_rider_id, session_id)');
    expect(statements).toContain('consumed_at TIMESTAMPTZ');
    expect(statements).toContain('revoked_at TIMESTAMPTZ');
    expect(statements).toContain('REFERENCES tracklab.club_members');
    expect(statements).toContain('ON DELETE CASCADE');
  });

  it('arms Monitor sprints before first watt and segments continuous studio heart rate', () => {
    const studioBlockMigration = databaseMigrations().find((candidate) => candidate.version === 20);
    const statements = studioBlockMigration?.statements.join('\n') ?? '';

    expect(studioBlockMigration).toMatchObject({
      version: 20,
      name: 'arm monitor sprints and segment continuous studio heart rate',
    });
    expect(statements).toContain('armed_at TIMESTAMPTZ');
    expect(statements).toContain('activated_at TIMESTAMPTZ');
    expect(statements).toContain('ALTER COLUMN started_at DROP NOT NULL');
    expect(statements).toContain("relay_scope IN ('session', 'studio-block')");
    expect(statements).toContain('studio_block_stopped_at TIMESTAMPTZ');
    expect(statements).toContain('heart_rate_training_segments');
    expect(statements).toContain('heart_rate_training_segment_bindings');
    expect(statements).toContain("zone_windows JSONB NOT NULL DEFAULT '[]'::jsonb");
    expect(statements).toContain('expires_at TIMESTAMPTZ NOT NULL');
    expect(statements).toContain('UNIQUE (training_profile_key, training_session_id)');
    expect(statements).toContain('studio_visible BOOLEAN NOT NULL DEFAULT false');
    expect(statements).toContain('finalized_at TIMESTAMPTZ');
    expect(statements).toContain('REFERENCES tracklab.training_sessions');
    expect(statements).toContain('ON DELETE CASCADE');
  });

  it('segments one private continuous account heart-rate block across personal-device sessions', () => {
    const accountBlockMigration = databaseMigrations().find((candidate) => candidate.version === 21);
    const statements = accountBlockMigration?.statements.join('\n') ?? '';

    expect(accountBlockMigration).toMatchObject({
      version: 21,
      name: 'segment private continuous account heart rate across devices',
    });
    expect(statements).toContain("'training-block'");
    expect(statements).toContain("relay_scope IN ('session', 'studio-block', 'account-block')");
    expect(statements).toContain('idx_tracklab_heart_rate_pairings_one_account_block');
    expect(statements).toContain('account_block_stop_requested_at');
    expect(statements).toContain('account_block_drain_expires_at');
    expect(statements).toContain('idx_tracklab_heart_rate_pairings_account_block_drain');
    expect(statements).toContain('ALTER COLUMN club_id DROP NOT NULL');
    expect(statements).toContain('ALTER COLUMN studio_rider_id DROP NOT NULL');
    expect(statements).toContain("relay_scope = 'account-block' AND club_id IS NULL");
    expect(statements).toContain('heart_rate_training_segment_bindings');
    expect(statements).toContain("active_clock_segments JSONB NOT NULL DEFAULT '[]'::jsonb");
    expect(statements).toContain('idx_tracklab_heart_rate_account_segment_bindings_match');
  });

  it('atomically binds owner multi-bike sessions to immutable claimed-athlete seats', () => {
    const groupMigration = databaseMigrations().find((candidate) => candidate.version === 22);
    const statements = groupMigration?.statements.join('\n') ?? '';

    expect(groupMigration).toMatchObject({
      version: 22,
      name: 'atomically save owner assigned multi bike training',
    });
    expect(statements).toContain('club_group_training_authorizations');
    expect(statements).toContain('club_group_training_assignments');
    expect(statements).toContain('athlete_profile_key TEXT NOT NULL');
    expect(statements).toContain('token_hash TEXT UNIQUE NOT NULL');
    expect(statements).toContain('completion_digest TEXT');
    expect(statements).toContain('heart_rate_attachment_status TEXT NOT NULL');
    expect(statements).toContain('UNIQUE (owner_profile_key, request_id)');
    expect(statements).toContain('UNIQUE (club_id, session_id)');
    expect(statements).toContain('UNIQUE (authorization_id, athlete_profile_key)');
    expect(statements).toContain('idx_tracklab_group_training_active_rider');
    expect(statements).toContain('idx_tracklab_group_training_active_bike');
    expect(statements).toContain('WHERE released_at IS NULL');
    expect(statements).toContain('REFERENCES tracklab.training_sessions');
    expect(statements).toContain('ON DELETE SET NULL');
  });

  it('remembers revocable watches and limits each Watch Connect session to four hours', () => {
    const watchConnectMigration = databaseMigrations().find((candidate) => candidate.version === 23);
    const statements = watchConnectMigration?.statements.join('\n') ?? '';

    expect(watchConnectMigration).toMatchObject({
      version: 23,
      name: 'remember trusted watches and authorize four hour watch connect sessions',
    });
    expect(statements).toContain('heart_rate_watch_enrollments');
    expect(statements).toContain('install_id_hash TEXT NOT NULL');
    expect(statements).toContain('UNIQUE (owner_profile_key, request_id)');
    expect(statements).toContain("scope TEXT NOT NULL CHECK (scope IN ('personal', 'studio'))");
    expect(statements).toContain('heart_rate_watch_connections');
    expect(statements).toContain("connected_until = connected_at + interval '4 hours'");
    expect(statements).toContain('idx_tracklab_watch_connection_one_active_scope');
    expect(statements).toContain('WHERE stopped_at IS NULL');
    expect(statements).toContain('live_studio_consent BOOLEAN NOT NULL DEFAULT false');
    expect(statements).toContain('session_studio_consent BOOLEAN NOT NULL DEFAULT false');
    expect(statements).toContain("'studio-disconnected'");
    expect(statements).toContain('REFERENCES tracklab.club_members');
    expect(statements).toContain('ON DELETE CASCADE');
    expect(statements).not.toContain('bike_device_id');
  });

  it('adds private account recovery schedules and summary-only Smart learning', () => {
    const recoveryAlertMigration = databaseMigrations().find((candidate) => candidate.version === 24);
    const statements = recoveryAlertMigration?.statements.join('\n') ?? '';

    expect(recoveryAlertMigration).toMatchObject({
      version: 24,
      name: 'add private per account recovery alerts and summary only learning',
    });
    expect(statements).toContain('recovery_alert_preferences');
    expect(statements).toContain('recovery_alert_episodes');
    expect(statements).toContain("mode IN ('off', 'timer', 'heart-rate', 'smart')");
    expect(statements).toContain("activity_type IN ('bmx-race', 'straight-sprint', 'get-pulled')");
    expect(statements).toContain('not_before_at TIMESTAMPTZ NOT NULL');
    expect(statements).toContain('planned_ready_at TIMESTAMPTZ');
    expect(statements).toContain('fallback_at TIMESTAMPTZ NOT NULL');
    expect(statements).toContain('ready_at TIMESTAMPTZ');
    expect(statements).toContain("effort_summary JSONB NOT NULL DEFAULT '{}'::jsonb");
    expect(statements).toContain("recovery_summary JSONB NOT NULL DEFAULT '{}'::jsonb");
    expect(statements).not.toContain('bpm_samples');
    expect(statements).not.toContain('heart_rate_samples');
    expect(statements).toContain('UNIQUE (owner_profile_key, request_id)');
    expect(statements).toContain('UNIQUE (owner_profile_key, activity_type, session_id, repetition_id)');
    expect(statements).toContain('REFERENCES tracklab.auth_users(id) ON DELETE CASCADE');
  });

  it('rolls back the complete Recovery Alert migration if any v24 statement fails', async () => {
    const recoveryAlertMigration = databaseMigrations().find((candidate) => candidate.version === 24);
    if (!recoveryAlertMigration) throw new Error('Recovery Alert migration is missing.');
    const database = fakeDatabase({ failOn: 'idx_tracklab_recovery_alert_owner_learning' });

    await expect(runDatabaseMigrations(database.pool, { migrations: [recoveryAlertMigration] }))
      .rejects.toThrow('simulated migration failure');

    const commands = database.calls.map((call) => call.text);
    expect(commands).toContain('ROLLBACK');
    expect(commands.some((command) => command.startsWith('INSERT INTO tracklab.schema_migrations'))).toBe(false);
    expect(commands.at(-1)).toBe('SELECT pg_advisory_unlock(hashtext($1))');
  });

  it('adds private per-account favorites and durable explicit-friend track shares', () => {
    const trackSharingMigration = databaseMigrations().find((candidate) => candidate.version === 25);
    const statements = trackSharingMigration?.statements.join('\n') ?? '';

    expect(trackSharingMigration).toMatchObject({
      version: 25,
      name: 'add private track favorites and explicit friend track shares',
    });
    expect(statements).toContain('account_track_favorites');
    expect(statements).toContain('PRIMARY KEY (user_id, track_id)');
    expect(statements).toContain('account_track_shares');
    expect(statements).toContain('UNIQUE (sender_user_id, recipient_user_id, track_id)');
    expect(statements).toContain('CHECK (sender_user_id <> recipient_user_id)');
    expect(statements).toContain("CHECK (jsonb_typeof(track_snapshot) = 'object')");
    expect(statements).toContain('REFERENCES tracklab.auth_users(id) ON DELETE CASCADE');
    expect(statements).toContain('idx_tracklab_account_track_favorites_recent');
    expect(statements).toContain('idx_tracklab_account_track_shares_recipient_recent');
  });

  it('rolls back the complete track favorites and shares migration if any v25 statement fails', async () => {
    const trackSharingMigration = databaseMigrations().find((candidate) => candidate.version === 25);
    if (!trackSharingMigration) throw new Error('Track favorites migration is missing.');
    const database = fakeDatabase({ failOn: 'idx_tracklab_account_track_shares_recipient_recent' });

    await expect(runDatabaseMigrations(database.pool, { migrations: [trackSharingMigration] }))
      .rejects.toThrow('simulated migration failure');

    const commands = database.calls.map((call) => call.text);
    expect(commands).toContain('ROLLBACK');
    expect(commands.some((command) => command.startsWith('INSERT INTO tracklab.schema_migrations'))).toBe(false);
    expect(commands.at(-1)).toBe('SELECT pg_advisory_unlock(hashtext($1))');
  });

  it('adds session-bound encrypted APNs installations and a transactional private outbox', () => {
    const pushMigration = databaseMigrations().find((candidate) => candidate.version === 26);
    const statements = pushMigration?.statements.join('\n') ?? '';

    expect(pushMigration).toMatchObject({
      version: 26,
      name: 'add private ios push installations and transactional social alerts',
    });
    expect(statements).toContain('push_installations');
    expect(statements).toContain('auth_session_token_hash TEXT NOT NULL');
    expect(statements).toContain('REFERENCES tracklab.auth_sessions(token_hash) ON DELETE CASCADE');
    expect(statements).toContain('token_ciphertext TEXT NOT NULL');
    expect(statements).toContain('token_fingerprint TEXT NOT NULL');
    expect(statements).toContain('revision BIGINT NOT NULL DEFAULT 1');
    expect(statements).not.toContain('device_token');
    expect(statements).toContain('push_preferences');
    expect(statements).toContain('live_audio_friend_invites');
    expect(statements).toContain("'joined'");
    expect(statements).toContain('push_events');
    expect(statements).toContain('idempotency_key TEXT UNIQUE NOT NULL');
    expect(statements).toContain('push_deliveries');
    expect(statements).toContain('PRIMARY KEY (event_id, installation_id)');
  });

  it('rolls back all private push tables if any v26 statement fails', async () => {
    const pushMigration = databaseMigrations().find((candidate) => candidate.version === 26);
    if (!pushMigration) throw new Error('Private push migration is missing.');
    const database = fakeDatabase({ failOn: 'idx_tracklab_push_deliveries_retry' });

    await expect(runDatabaseMigrations(database.pool, { migrations: [pushMigration] }))
      .rejects.toThrow('simulated migration failure');

    const commands = database.calls.map((call) => call.text);
    expect(commands).toContain('ROLLBACK');
    expect(commands.some((command) => command.startsWith('INSERT INTO tracklab.schema_migrations'))).toBe(false);
    expect(commands.at(-1)).toBe('SELECT pg_advisory_unlock(hashtext($1))');
  });

  it('serializes and commits each pending migration exactly once', async () => {
    const migrations = [migration(1), migration(2)];
    const database = fakeDatabase();

    const result = await runDatabaseMigrations(database.pool, { migrations });

    expect(result).toEqual({
      applied: [
        { version: 1, name: 'migration 1' },
        { version: 2, name: 'migration 2' },
      ],
      currentVersion: 2,
    });
    expect(database.calls.filter((call) => call.text === 'BEGIN')).toHaveLength(2);
    expect(database.calls.filter((call) => call.text === 'COMMIT')).toHaveLength(2);
    expect(database.calls.filter((call) => call.text.startsWith('INSERT INTO tracklab.schema_migrations')))
      .toHaveLength(2);
    expect(database.calls[0]).toMatchObject({
      text: 'SELECT pg_advisory_lock(hashtext($1))',
      params: ['tracklab:schema-migrations'],
    });
    expect(database.calls.at(-1)).toMatchObject({
      text: 'SELECT pg_advisory_unlock(hashtext($1))',
    });
    expect(database.client.release).toHaveBeenCalledOnce();
  });

  it('skips an applied migration only when its immutable checksum matches', async () => {
    const appliedMigration = migration(1);
    const database = fakeDatabase({
      applied: [{
        version: 1,
        name: appliedMigration.name,
        checksum: migrationChecksum(appliedMigration),
      }],
    });

    const result = await runDatabaseMigrations(database.pool, { migrations: [appliedMigration] });

    expect(result).toEqual({ applied: [], currentVersion: 1 });
    expect(database.calls.some((call) => call.text === 'BEGIN')).toBe(false);
    expect(database.client.release).toHaveBeenCalledOnce();
  });

  it('refuses to run when applied migration history was changed', async () => {
    const appliedMigration = migration(1);
    const database = fakeDatabase({
      applied: [{ version: 1, name: appliedMigration.name, checksum: 'changed' }],
    });

    await expect(runDatabaseMigrations(database.pool, { migrations: [appliedMigration] }))
      .rejects.toThrow('no longer matches its applied checksum');

    expect(database.calls.some((call) => call.text.includes('pg_advisory_unlock'))).toBe(true);
    expect(database.client.release).toHaveBeenCalledOnce();
  });

  it('rolls back a failed migration before releasing the deployment lock', async () => {
    const database = fakeDatabase({ failOn: 'BROKEN' });

    await expect(runDatabaseMigrations(database.pool, {
      migrations: [migration(1, 'BROKEN STATEMENT')],
    })).rejects.toThrow('simulated migration failure');

    const commands = database.calls.map((call) => call.text);
    expect(commands).toContain('ROLLBACK');
    expect(commands.some((command) => command.startsWith('INSERT INTO tracklab.schema_migrations'))).toBe(false);
    expect(commands.at(-1)).toBe('SELECT pg_advisory_unlock(hashtext($1))');
    expect(database.client.release).toHaveBeenCalledOnce();
  });

  it('refuses to start an older binary against a newer database schema', async () => {
    const database = fakeDatabase({
      applied: [{ version: 9, name: 'future migration', checksum: 'future' }],
    });

    await expect(runDatabaseMigrations(database.pool, { migrations: [migration(1)] }))
      .rejects.toThrow('newer than this server supports');
  });
});
