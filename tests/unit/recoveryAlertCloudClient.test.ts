import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addRecoveryTime,
  createRecoveryEpisode,
  loadActiveRecoveryEpisode,
  loadRecoveryAlertPreference,
  saveRecoveryAlertPreference,
  startRecoveryAnyway,
  stopRecoveryEpisode,
} from '../../src/lib/recoveryAlertCloud';

const accountId = `recacct_${'b'.repeat(32)}`;
const now = 100_000;
const episode = {
  id: 'recovery_client_1',
  activityType: 'bmx-race',
  sessionId: 'race-session-1',
  repetitionId: 'repetition-2',
  mode: 'timer',
  state: 'recovering',
  startedAt: now,
  notBeforeAt: now + 30_000,
  plannedReadyAt: now + 120_000,
  fallbackAt: now + 120_000,
  readyAt: null,
  targetBpm: null,
  reason: 'timer-running',
  explanation: 'Recovery timer running.',
  confidence: 'fixed',
  learningEpisodeCount: 0,
  alertedAt: null,
  alertTrigger: null,
  updatedAt: now,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('Recovery Alert cloud client', () => {
  it('loads and saves an exact opaque account-bound preference', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        accountId,
        preference: {
          mode: 'smart', timerSeconds: 120, targetBpm: 118,
          minimumSeconds: 30, maximumSeconds: 600, updatedAt: now,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        accountId,
        preference: {
          mode: 'timer', timerSeconds: 180, targetBpm: 118,
          minimumSeconds: 30, maximumSeconds: 600, updatedAt: now + 1,
        },
      }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadRecoveryAlertPreference()).resolves.toMatchObject({
      accountId,
      preference: { mode: 'smart', targetBpm: 118 },
    });
    await expect(saveRecoveryAlertPreference({ mode: 'timer', timerSeconds: 180 }))
      .resolves.toMatchObject({ accountId, preference: { mode: 'timer', timerSeconds: 180 } });
    expect(fetchMock.mock.calls[1]).toMatchObject([
      '/api/recovery-alert/preferences',
      expect.objectContaining({ method: 'PATCH' }),
    ]);
  });

  it('creates, polls, and performs durable recovery actions without constructing routes in UI', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ accountId, episode, activeEpisode: episode, replayed: false }, 201))
      .mockResolvedValueOnce(jsonResponse({ accountId, episode }))
      .mockResolvedValueOnce(jsonResponse({
        accountId,
        episode: {
          ...episode,
          plannedReadyAt: episode.plannedReadyAt + 30_000,
          fallbackAt: episode.fallbackAt + 30_000,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        accountId,
        episode: { ...episode, state: 'ready', readyAt: now + 10_000, reason: 'manual-start' },
      }))
      .mockResolvedValueOnce(jsonResponse({
        accountId,
        episode: { ...episode, state: 'cancelled', reason: 'stopped' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createRecoveryEpisode({
      requestId: `recovery-client-${'x'.repeat(32)}`,
      activityType: 'bmx-race',
      sessionId: episode.sessionId,
      repetitionId: episode.repetitionId,
      finishedAt: now,
      effortSummary: { peakPowerWatts: 1_200 },
    })).resolves.toMatchObject({
      accountId,
      episode: { id: episode.id },
      activeEpisode: { id: episode.id },
      replayed: false,
    });
    await expect(loadActiveRecoveryEpisode()).resolves.toMatchObject({ accountId, episode: { id: episode.id } });
    await expect(addRecoveryTime(episode.id)).resolves.toMatchObject({
      accountId,
      episode: { plannedReadyAt: episode.plannedReadyAt + 30_000 },
    });
    await expect(startRecoveryAnyway(episode.id)).resolves.toMatchObject({
      accountId,
      episode: { state: 'ready', reason: 'manual-start' },
    });
    await expect(stopRecoveryEpisode(episode.id)).resolves.toMatchObject({
      accountId,
      episode: { state: 'cancelled' },
    });
    expect(JSON.parse(String((fetchMock.mock.calls[2][1] as RequestInit).body)))
      .toEqual({ action: 'add-time', seconds: 30 });
  });

  it('fails closed on malformed or mismatched cloud responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      accountId: 'user:private-id',
      episode,
    })));
    await expect(loadActiveRecoveryEpisode()).rejects.toThrow('invalid account binding');
  });

  it('keeps an idempotent replay separate from the newer authoritative active repetition', async () => {
    const newer = {
      ...episode,
      id: 'recovery_client_2',
      sessionId: 'race-session-2',
      repetitionId: 'repetition-3',
      startedAt: now + 20_000,
      notBeforeAt: now + 50_000,
      plannedReadyAt: now + 140_000,
      fallbackAt: now + 140_000,
      updatedAt: now + 20_000,
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      accountId,
      episode,
      activeEpisode: newer,
      replayed: true,
    })));

    await expect(createRecoveryEpisode({
      requestId: `recovery-client-${'y'.repeat(32)}`,
      activityType: 'bmx-race',
      sessionId: episode.sessionId,
      repetitionId: episode.repetitionId,
      finishedAt: now,
      effortSummary: { peakPowerWatts: 1_200 },
    })).resolves.toMatchObject({
      replayed: true,
      episode: { id: episode.id },
      activeEpisode: { id: newer.id, repetitionId: newer.repetitionId },
    });
  });

  it('rejects a create response that omits authoritative activeEpisode', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      accountId,
      episode,
      replayed: false,
    })));
    await expect(createRecoveryEpisode({
      requestId: `recovery-client-${'z'.repeat(32)}`,
      activityType: 'bmx-race',
      sessionId: episode.sessionId,
      repetitionId: episode.repetitionId,
      finishedAt: now,
      effortSummary: { peakPowerWatts: 1_200 },
    })).rejects.toThrow('incomplete authoritative response');
  });
});
