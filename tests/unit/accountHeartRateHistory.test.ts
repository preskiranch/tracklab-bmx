import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { TrainingSession } from '../../src/types';
import type {
  HeartRateStream,
  HeartRateTrainingSegment,
  PrivateHeartRateHistoryItem,
} from '../../src/lib/heartRateCloud';
import {
  PrivateHeartRateHistoryPanel,
  clubHeartRateHistoryTarget,
  privateHeartRateSyncPollDelay,
  privateHeartRateSyncPollLimit,
  privateHeartRateSessionId,
} from '../../src/components/AccountProfileView';

const stream: HeartRateStream = {
  id: 'stream-1',
  pairingId: 'pair-1',
  sessionId: 'session-1',
  activityType: 'bmx-race',
  riderId: 'account:rider-1',
  playerId: 1,
  startedAt: 1_000,
  endedAt: 11_000,
  activeDurationMs: 10_000,
  summary: {
    sampleCount: 8,
    coverageMs: 8_000,
    coveragePercent: 80,
    firstSampleElapsedMs: 0,
    lastSampleElapsedMs: 9_000,
    minimumBpm: 101,
    averageBpm: 142.5,
    peakBpm: 181,
  },
  zoneSummaries: [{
    zoneId: 'zone-1',
    zoneName: 'Zone 1',
    startElapsedMs: 0,
    endElapsedMs: 5_000,
    summary: {
      sampleCount: 4,
      coverageMs: 4_000,
      coveragePercent: 80,
      firstSampleElapsedMs: 0,
      lastSampleElapsedMs: 4_500,
      minimumBpm: 101,
      averageBpm: 130,
      peakBpm: 155,
    },
  }],
  finalizedAt: 12_000,
};

function markup(
  state: 'loading' | 'ready' | 'error',
  streams: readonly PrivateHeartRateHistoryItem[],
  error = '',
  sharingLabel?: string,
  attachmentStatus?: 'syncing' | 'saved' | 'not-recorded',
) {
  return renderToStaticMarkup(createElement(PrivateHeartRateHistoryPanel, {
    state,
    streams,
    error,
    sharingLabel,
    attachmentStatus,
    onRetry: () => undefined,
  }));
}

const pendingStudioSegment: HeartRateTrainingSegment = {
  id: 'segment-monitor-1',
  streamId: 'continuous-studio-stream-1',
  trainingSessionId: 'monitor-1',
  activityType: 'monitor-sprint',
  relayScope: 'studio-block',
  studioRiderId: 'studio-rider-1',
  playerId: 2,
  startedAt: 20_000,
  endedAt: 26_000,
  activeDurationMs: 6_000,
  summary: {
    sampleCount: 0,
    coverageMs: 0,
    coveragePercent: 0,
    firstSampleElapsedMs: null,
    lastSampleElapsedMs: null,
    minimumBpm: null,
    averageBpm: null,
    peakBpm: null,
  },
  zoneSummaries: [],
  finalizedAt: null,
};

function trainingSession(id: string, role?: 'athlete' | 'owner'): TrainingSession {
  return {
    id,
    activityType: 'bmx-race',
    title: 'Test race',
    startedAt: 1_000,
    endedAt: 11_000,
    durationMs: 10_000,
    distanceMeters: 100,
    source: 'live',
    ...(role ? {
      club: {
        id: 'club-1',
        name: 'Test club',
        studioRiderId: 'rider-1',
        riderName: 'Rider One',
        role,
      },
    } : {}),
    details: {},
    createdAt: 1_000,
    updatedAt: 11_000,
  };
}

describe('owner-only Account profile heart-rate history', () => {
  it('shows Apple Watch minimum, average, peak, coverage, and pedal-zone coverage', () => {
    const html = markup('ready', [stream]);

    expect(html).toContain('Private Apple Watch heart rate');
    expect(html).toContain('101 BPM');
    expect(html).toContain('143 BPM');
    expect(html).toContain('181 BPM');
    expect(html).toContain('8 samples · 80% · 8s measured');
    expect(html).toContain('Heart rate by pedal zone');
    expect(html).toContain('Zone 1');
    expect(html).toContain('Avg 130 BPM · Peak 155 BPM');
    expect(html).toContain('4 samples · 80% · 4s measured');
    expect(html).toContain('kept separate from club history and generic JSON/CSV downloads');
  });

  it('keeps loading, no-data, and error states explicit', () => {
    expect(markup('loading', [])).toContain('Loading private heart-rate history');
    expect(markup('ready', [])).toContain('No Apple Watch heart-rate data was saved');
    const error = markup('error', [], 'Network interrupted');
    expect(error).toContain('Private heart-rate history is temporarily unavailable');
    expect(error).toContain('Try again');
  });

  it('keeps a late Watch attachment visibly syncing and retryable instead of declaring no data', () => {
    const html = markup('ready', [], '', undefined, 'syncing');

    expect(html).toContain('Apple Watch heart-rate data is still syncing for this session.');
    expect(html).toContain('Check again');
    expect(html).not.toContain('No Apple Watch heart-rate data was saved');
  });

  it('uses a bounded sync polling cadence and stops after the final attempt', () => {
    expect(privateHeartRateSyncPollDelay(0)).toBe(2_000);
    expect(privateHeartRateSyncPollDelay(8)).toBe(10_000);
    expect(privateHeartRateSyncPollDelay(privateHeartRateSyncPollLimit - 1)).toBe(10_000);
    expect(privateHeartRateSyncPollDelay(privateHeartRateSyncPollLimit)).toBeNull();
    expect(privateHeartRateSyncPollDelay(-1)).toBeNull();
  });

  it('shows a studio sprint slice as pending until its late-sample grace period is finalized', () => {
    const html = markup('ready', [pendingStudioSegment]);

    expect(html).toContain('Apple Watch data is still syncing for this session.');
    expect(html).toContain('Check again');
  });

  it('settles a finalized studio sprint slice that contains no valid Watch samples', () => {
    const html = markup('ready', [{ ...pendingStudioSegment, finalizedAt: 41_000 }]);

    expect(html).toContain('No valid Apple Watch samples were recorded for this session.');
    expect(html).not.toContain('Check again');
  });

  it('routes club-owner history only through a consented summary target and resolves athlete projections', () => {
    const ownerSession = trainingSession(
      'club-owner:club-1:rider-1:session-1',
      'owner',
    );
    expect(privateHeartRateSessionId(ownerSession)).toBeNull();
    expect(clubHeartRateHistoryTarget(ownerSession)).toEqual({
      clubId: 'club-1',
      clubName: 'Test club',
      sessionId: 'session-1',
    });
    expect(privateHeartRateSessionId(trainingSession(
      'club:club-1:session-1',
      'athlete',
    ))).toBe('session-1');
    expect(privateHeartRateSessionId(trainingSession('session-1'))).toBe('session-1');
  });

  it('labels a club view as rider-consented summary-only data', () => {
    const html = markup('ready', [stream], '', 'Shared with Test club by rider consent');
    expect(html).toContain('Shared with Test club by rider consent');
    expect(html).toContain('Summary only · raw heart-rate samples are unavailable to the club');
    expect(html).not.toContain('Owner-only health data');
  });
});
