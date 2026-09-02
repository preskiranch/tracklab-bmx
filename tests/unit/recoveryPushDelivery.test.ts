import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  resolveRecoveryNotificationDelivery,
  type NativeRecoveryPushDeliveryState,
} from '../../src/lib/nativeRecoveryPushDelivery';

const personalAccountId = `recacct_${'a'.repeat(32)}`;
const otherAccountId = `recacct_${'b'.repeat(32)}`;

function nativePush(
  accountId: string | null,
  status: NativeRecoveryPushDeliveryState['status'],
): NativeRecoveryPushDeliveryState {
  return { accountId, status };
}

describe('Recovery Alert personal push delivery fence', () => {
  it('selects exactly one delivery owner for every server/native readiness state', () => {
    const matrix = [
      {
        label: 'uses APNs after this exact personal account is bound',
        serverPushDeliveryAvailable: true,
        nativePush: nativePush(personalAccountId, 'ready'),
        expected: 'remote',
      },
      {
        label: 'uses the local timer when the server cannot dispatch APNs',
        serverPushDeliveryAvailable: false,
        nativePush: nativePush(personalAccountId, 'ready'),
        expected: 'local',
      },
      {
        label: 'uses the local timer after this device cannot register',
        serverPushDeliveryAvailable: true,
        nativePush: nativePush(personalAccountId, 'unavailable'),
        expected: 'local',
      },
      {
        label: 'holds local scheduling while registration is unresolved',
        serverPushDeliveryAvailable: true,
        nativePush: nativePush(personalAccountId, 'checking'),
        expected: 'checking',
      },
      {
        label: 'holds local scheduling until the server capability is known',
        serverPushDeliveryAvailable: null,
        nativePush: nativePush(personalAccountId, 'ready'),
        expected: 'checking',
      },
      {
        label: 'never reuses a different account\'s ready installation',
        serverPushDeliveryAvailable: true,
        nativePush: nativePush(otherAccountId, 'ready'),
        expected: 'checking',
      },
    ] as const;

    for (const scenario of matrix) {
      expect(resolveRecoveryNotificationDelivery({
        accountId: personalAccountId,
        serverPushDeliveryAvailable: scenario.serverPushDeliveryAvailable,
        nativePush: scenario.nativePush,
      }), scenario.label).toBe(scenario.expected);
    }
  });
});

describe('direct personal Recovery Alert push wiring', () => {
  it('creates an account-bound recovery-ready event and wakes the worker only after the recovery episode commits', () => {
    const source = readFileSync(new URL('../../cloud/server.mjs', import.meta.url), 'utf8');
    const start = source.indexOf("if (pathname === '/api/recovery-alert/episodes')");
    const end = source.indexOf("if (pathname === '/api/recovery-alert/episodes/active')", start);
    const handler = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(handler).toContain('pushEventForEpisode: (episode) => recoveryReadyPushEvent({');
    expect(handler).toMatch(/recipientUserId:\s*session\.user\.id,/u);
    expect(handler).toMatch(/if\s*\(created\.createdEpisode\)\s*\{?\s*kickPushWorker\(\);/u);

    const eventFactory = handler.indexOf('pushEventForEpisode: (episode) => recoveryReadyPushEvent({');
    const createResultCheck = handler.indexOf('if (created.error)');
    const workerKick = handler.search(/if\s*\(created\.createdEpisode\)\s*\{?\s*kickPushWorker\(\);/u);
    expect(eventFactory).toBeGreaterThan(handler.indexOf('const created = await createRecoveryAlertEpisodeForOwner'));
    expect(eventFactory).toBeLessThan(createResultCheck);
    expect(workerKick).toBeGreaterThan(createResultCheck);
  });
});
