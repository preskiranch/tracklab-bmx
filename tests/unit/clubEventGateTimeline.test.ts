import { describe, expect, it } from 'vitest';
import { uciVoiceWatchGateOffsetMs } from '../../src/lib/audioCues';
import {
  clubEventCadenceDelayMs,
  clubEventGateCueFreshnessMs,
  clubEventGateCuePlaybackState,
  clubEventRidersReadyOffsetMs,
  clubEventVoiceCueFreshnessMs,
  createClubEventGateTimeline,
  planClubEventGateTimeline,
  runClubEventGateTimelinePlan,
} from '../../src/lib/clubEventGateTimeline';
import { raceStagingDurationMs } from '../../src/lib/raceStartSequence';
import {
  uciRandomDelayMaxMs,
  uciRandomDelayMinMs,
  uciStartToneIntervalMs,
} from '../../src/lib/uciStartGate';

const startAt = 1_800_000_000_000;
const eventId = 'club-event-four-tablet-final';

describe('absolute Club Event gate timeline', () => {
  it('derives one immutable server-clock staging, cadence, light, and gate schedule', () => {
    const timeline = createClubEventGateTimeline({ eventId, startAt });

    expect(timeline.stagingStartsAt).toBe(startAt);
    expect(timeline.cadenceStartsAt).toBe(startAt + raceStagingDurationMs());
    expect(timeline.ridersReadyAt).toBe(
      timeline.cadenceStartsAt + clubEventRidersReadyOffsetMs,
    );
    expect(timeline.randomDelayStartsAt).toBe(
      timeline.cadenceStartsAt + uciVoiceWatchGateOffsetMs,
    );
    expect(timeline.redAt).toEqual([
      timeline.randomDelayStartsAt + timeline.cadenceDelayMs,
      timeline.randomDelayStartsAt + timeline.cadenceDelayMs + uciStartToneIntervalMs,
      timeline.randomDelayStartsAt + timeline.cadenceDelayMs + (uciStartToneIntervalMs * 2),
    ]);
    expect(timeline.greenAt).toBe(timeline.redAt[2] + uciStartToneIntervalMs);
    expect(timeline.transitions.map(({ phase }) => phase)).toEqual([
      'staging',
      'ok-riders',
      'riders-ready',
      'random-delay',
      'red-1',
      'red-2',
      'red-3',
      'green',
    ]);
    expect(timeline.audioCues.map(({ kind, startsRace }) => ({ kind, startsRace }))).toEqual([
      { kind: 'red-1', startsRace: false },
      { kind: 'red-2', startsRace: false },
      { kind: 'red-3', startsRace: false },
      { kind: 'green', startsRace: true },
    ]);
    expect(Object.isFrozen(timeline)).toBe(true);
    expect(Object.isFrozen(timeline.redAt)).toBe(true);
    expect(Object.isFrozen(timeline.transitions)).toBe(true);
    expect(timeline.transitions.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(timeline.audioCues)).toBe(true);
    expect(timeline.audioCues.every(Object.isFrozen)).toBe(true);
  });

  it('uses the same bounded deterministic UCI hold for every tablet in an event', () => {
    const first = clubEventCadenceDelayMs(eventId);
    const repeated = Array.from({ length: 4 }, () => clubEventCadenceDelayMs(eventId));

    expect(repeated).toEqual([first, first, first, first]);
    expect(first).toBeGreaterThanOrEqual(uciRandomDelayMinMs);
    expect(first).toBeLessThanOrEqual(uciRandomDelayMaxMs);
    expect(clubEventCadenceDelayMs(`  ${eventId}  `)).toBe(first);
  });

  it('keeps red and green targets fixed across zero and 2500ms audio startup latency', () => {
    const timeline = createClubEventGateTimeline({ eventId, startAt });
    const immediateAudio = planClubEventGateTimeline({
      eventId,
      startAt,
      serverClockOffsetMs: 0,
      now: timeline.cadenceStartsAt,
    });
    const slowAudio = planClubEventGateTimeline({
      eventId,
      startAt,
      serverClockOffsetMs: 0,
      now: timeline.cadenceStartsAt + 2_500,
    });

    expect(immediateAudio.timeline.redAt).toEqual(slowAudio.timeline.redAt);
    expect(immediateAudio.timeline.greenAt).toBe(slowAudio.timeline.greenAt);
    expect(immediateAudio.pendingAudioCues.map(({ at }) => at)).toEqual(
      slowAudio.pendingAudioCues.map(({ at }) => at),
    );
    expect(immediateAudio.pendingAudioCues[0].delayMs - slowAudio.pendingAudioCues[0].delayMs)
      .toBe(2_500);
  });

  it('executes visuals and the race clock on absolute targets without awaiting voice playback', () => {
    const plan = planClubEventGateTimeline({
      eventId,
      startAt,
      serverClockOffsetMs: 0,
      now: startAt,
    });
    let now = startAt;
    const scheduled: Array<{ delayMs: number; action: () => void }> = [];
    const events: string[] = [];
    let reactionAt = 0;
    let gateDropAt = 0;

    runClubEventGateTimelinePlan(plan, {
      now: () => now,
      schedule: (delayMs, action) => scheduled.push({ delayMs, action }),
      onStaging: (seconds) => events.push(`staging:${seconds}`),
      onVoice: () => events.push('voice-requested'),
      onCadencePhase: (phase) => events.push(phase),
      onReactionArmed: (at) => { reactionAt = at; },
      onRed: (index, playTone) => events.push(`red:${index}:${playTone}`),
      onGreen: (at, playTone) => {
        gateDropAt = at;
        events.push(`green:${playTone}`);
      },
    });

    expect(events[0]).toBe('staging:20');
    const cadence = scheduled.find(({ delayMs }) => delayMs === raceStagingDurationMs());
    expect(cadence).toBeDefined();
    now = plan.cadenceLocalAt;
    cadence!.action();
    expect(events).toContain('voice-requested');
    expect(events).toContain('ok-riders');

    const firstRedDelay = plan.timeline.redAt[0] - startAt;
    const firstRed = scheduled.find(({ delayMs }) => delayMs === firstRedDelay);
    expect(firstRed).toBeDefined();
    now = plan.timeline.redAt[0] + clubEventGateCueFreshnessMs;
    firstRed!.action();
    expect(reactionAt).toBe(plan.timeline.redAt[0]);
    expect(events).toContain('red:0:true');

    const secondRed = scheduled.find(({ delayMs }) => (
      delayMs === plan.timeline.redAt[1] - startAt
    ));
    now = plan.timeline.redAt[1];
    secondRed!.action();
    expect(events).toContain('red:1:true');

    const green = scheduled.find(({ delayMs }) => delayMs === plan.timeline.greenAt - startAt);
    now = plan.timeline.greenAt;
    green!.action();
    expect(gateDropAt).toBe(plan.timeline.greenAt);
    expect(events).toContain('green:true');
  });

  it('translates different client clocks to equal delays and the same server targets', () => {
    const sharedServerNow = startAt + 7_250;
    const aheadOffsetMs = 125;
    const behindOffsetMs = -80;
    const aheadClient = planClubEventGateTimeline({
      eventId,
      startAt,
      serverClockOffsetMs: aheadOffsetMs,
      now: sharedServerNow - aheadOffsetMs,
    });
    const behindClient = planClubEventGateTimeline({
      eventId,
      startAt,
      serverClockOffsetMs: behindOffsetMs,
      now: sharedServerNow - behindOffsetMs,
    });

    expect(aheadClient.serverNow).toBe(sharedServerNow);
    expect(behindClient.serverNow).toBe(sharedServerNow);
    expect(aheadClient.timeline).toEqual(behindClient.timeline);
    expect(aheadClient.pendingAudioCues.map(({ delayMs }) => delayMs)).toEqual(
      behindClient.pendingAudioCues.map(({ delayMs }) => delayMs),
    );
    expect(aheadClient.gateDropLocalAt + aheadOffsetMs).toBe(aheadClient.timeline.greenAt);
    expect(behindClient.gateDropLocalAt + behindOffsetMs).toBe(behindClient.timeline.greenAt);
  });

  it('catches up the visual phase while omitting tones that a late join already missed', () => {
    const timeline = createClubEventGateTimeline({ eventId, startAt });
    const joinedAfterSecondRed = planClubEventGateTimeline({
      eventId,
      startAt,
      serverClockOffsetMs: 0,
      now: timeline.redAt[1] + 1,
    });

    expect(joinedAfterSecondRed.phase).toBe('red-2');
    expect(joinedAfterSecondRed.phaseStartedAt).toBe(timeline.redAt[1]);
    expect(joinedAfterSecondRed.pendingAudioCues.map(({ kind }) => kind)).toEqual([
      'red-3',
      'green',
    ]);
    expect(joinedAfterSecondRed.upcomingTransitions.map(({ phase }) => phase)).toEqual([
      'red-3',
      'green',
    ]);
    expect(joinedAfterSecondRed.catchUp.shouldStartRace).toBe(false);
  });

  it('starts a late client from the canonical gate drop without replaying old audio', () => {
    const timeline = createClubEventGateTimeline({ eventId, startAt });
    const elapsedRaceMs = 1_750;
    const lateClient = planClubEventGateTimeline({
      eventId,
      startAt,
      serverClockOffsetMs: 0,
      now: timeline.greenAt + elapsedRaceMs,
    });

    expect(lateClient.phase).toBe('green');
    expect(lateClient.pendingAudioCues).toEqual([]);
    expect(lateClient.upcomingTransitions).toEqual([]);
    expect(lateClient.catchUp).toEqual({
      shouldStartRace: true,
      raceStartedAt: timeline.greenAt,
      elapsedRaceMs,
    });
  });

  it('reports staging countdown catch-up from server time rather than join time', () => {
    const fiveSecondsLate = planClubEventGateTimeline({
      eventId,
      startAt,
      serverClockOffsetMs: 250,
      now: startAt + 5_000 - 250,
    });
    const nineteenPointFiveSecondsLate = planClubEventGateTimeline({
      eventId,
      startAt,
      serverClockOffsetMs: -100,
      now: startAt + 19_500 + 100,
    });

    expect(fiveSecondsLate.phase).toBe('staging');
    expect(fiveSecondsLate.stagingSecondsRemaining).toBe(15);
    expect(nineteenPointFiveSecondsLate.phase).toBe('staging');
    expect(nineteenPointFiveSecondsLate.stagingSecondsRemaining).toBe(1);
  });

  it('plays a scheduled tone only while fresh and never collapses stale tones', () => {
    const timeline = createClubEventGateTimeline({ eventId, startAt });
    const cue = timeline.audioCues[0];

    expect(clubEventGateCueFreshnessMs).toBe(uciStartToneIntervalMs - 1);
    expect(clubEventGateCuePlaybackState({
      cue,
      serverClockOffsetMs: 100,
      now: cue.at - 101,
    })).toBe('future');
    expect(clubEventGateCuePlaybackState({
      cue,
      serverClockOffsetMs: 100,
      now: cue.at - 100 + clubEventGateCueFreshnessMs,
    })).toBe('fresh');
    expect(clubEventGateCuePlaybackState({
      cue,
      serverClockOffsetMs: 100,
      now: cue.at - 100 + clubEventGateCueFreshnessMs + 1,
    })).toBe('stale');
  });

  it('coalesces delayed callbacks to the authoritative phase without replaying old voice or lights', () => {
    const plan = planClubEventGateTimeline({
      eventId,
      startAt,
      serverClockOffsetMs: 0,
      now: startAt,
    });
    let now = startAt;
    const scheduled: Array<{ delayMs: number; action: () => void }> = [];
    const events: string[] = [];
    runClubEventGateTimelinePlan(plan, {
      now: () => now,
      schedule: (delayMs, action) => scheduled.push({ delayMs, action }),
      onStaging: (seconds) => events.push(`staging:${seconds}`),
      onVoice: () => events.push('voice'),
      onCadencePhase: (phase) => events.push(phase),
      onReactionArmed: () => events.push('armed'),
      onRed: (index, playTone) => events.push(`red:${index}:${playTone}`),
      onGreen: (_at, playTone) => events.push(`green:${playTone}`),
    });

    const cadence = scheduled.find(({ delayMs }) => delayMs === raceStagingDurationMs());
    const firstRed = scheduled.find(({ delayMs }) => delayMs === plan.timeline.redAt[0] - startAt);
    const secondRed = scheduled.find(({ delayMs }) => delayMs === plan.timeline.redAt[1] - startAt);
    expect(cadence).toBeDefined();
    expect(firstRed).toBeDefined();
    expect(secondRed).toBeDefined();

    now = plan.timeline.redAt[1] + 1;
    cadence!.action();
    firstRed!.action();
    expect(events).not.toContain('voice');
    expect(events).not.toContain('ok-riders');
    expect(events.some((event) => event.startsWith('red:0'))).toBe(false);

    secondRed!.action();
    expect(events).toContain('red:1:true');
    expect(events.filter((event) => event === 'armed')).toHaveLength(1);
  });

  it('restores a late cadence visual without restarting a stale voice recording', () => {
    const timeline = createClubEventGateTimeline({ eventId, startAt });
    const plan = planClubEventGateTimeline({
      eventId,
      startAt,
      serverClockOffsetMs: 0,
      now: timeline.ridersReadyAt + 1,
    });
    const events: string[] = [];

    runClubEventGateTimelinePlan(plan, {
      now: () => timeline.ridersReadyAt + 1,
      schedule: () => undefined,
      onStaging: () => undefined,
      onVoice: () => events.push('voice'),
      onCadencePhase: (phase) => events.push(phase),
      onReactionArmed: () => undefined,
      onRed: () => undefined,
      onGreen: () => undefined,
    });

    expect(events).toEqual(['riders-ready']);
  });

  it('keeps the current OK RIDERS visual but skips a voice request that missed its safe start window', () => {
    const timeline = createClubEventGateTimeline({ eventId, startAt });
    const now = timeline.cadenceStartsAt + clubEventVoiceCueFreshnessMs + 1;
    const plan = planClubEventGateTimeline({
      eventId,
      startAt,
      serverClockOffsetMs: 0,
      now,
    });
    const events: string[] = [];

    expect(plan.phase).toBe('ok-riders');
    runClubEventGateTimelinePlan(plan, {
      now: () => now,
      schedule: () => undefined,
      onStaging: () => undefined,
      onVoice: () => events.push('voice'),
      onCadencePhase: (phase) => events.push(phase),
      onReactionArmed: () => undefined,
      onRed: () => undefined,
      onGreen: () => undefined,
    });

    expect(clubEventVoiceCueFreshnessMs).toBeLessThanOrEqual(uciRandomDelayMinMs);
    expect(events).toEqual(['ok-riders']);
  });

  it('rejects malformed clock authority instead of silently creating a local race', () => {
    expect(() => createClubEventGateTimeline({ eventId: ' ', startAt })).toThrow(/eventId/);
    expect(() => createClubEventGateTimeline({ eventId, startAt: 0 })).toThrow(/startAt/);
    expect(() => planClubEventGateTimeline({
      eventId,
      startAt,
      serverClockOffsetMs: Number.NaN,
      now: startAt,
    })).toThrow(/serverClockOffsetMs/);
  });
});
