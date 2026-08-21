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
