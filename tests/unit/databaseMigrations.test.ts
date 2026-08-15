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
