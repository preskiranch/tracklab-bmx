import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('Club Event persistence availability', () => {
  it('does not turn a configured database outage into an empty current event', () => {
    const persistenceUrl = new URL('../../cloud/persistence.mjs', import.meta.url).href;
    const source = `
      const persistence = await import(${JSON.stringify(persistenceUrl)});
      try {
        await persistence.loadCurrentClubEvent('outage-test-club');
        process.exitCode = 2;
      } catch (error) {
        if (error?.code !== 'TRACKLAB_CLUB_EVENT_PERSISTENCE_UNAVAILABLE') {
          console.error(error);
          process.exitCode = 3;
        }
      }
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        ...process.env,
        DATABASE_URL: 'postgresql://tracklab:tracklab@127.0.0.1:1/tracklab',
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });
});
