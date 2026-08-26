import { uciVoiceWatchGateOffsetMs } from './audioCues';
import { raceStagingDurationMs } from './raceStartSequence';
import {
  uciRandomDelayMaxMs,
  uciRandomDelayMinMs,
  uciStartToneIntervalMs,
} from './uciStartGate';

export const clubEventRidersReadyOffsetMs = 3_300;

/**
 * A delayed browser task may still play its intended cue, but the allowance is
 * deliberately shorter than the gap between UCI lights. That prevents a busy
 * tablet from replaying several old tones in one burst.
 */
export const clubEventGateCueFreshnessMs = Math.max(
  1,
  uciStartToneIntervalMs - 1,
);
export const clubEventVoiceCueFreshnessMs = Math.min(
  uciRandomDelayMinMs,
  clubEventGateCueFreshnessMs,
);

export type ClubEventGatePhase =
  | 'waiting'
  | 'staging'
  | 'ok-riders'
  | 'riders-ready'
  | 'random-delay'
  | 'red-1'
  | 'red-2'
  | 'red-3'
  | 'green';

export type ClubEventGateCueKind = 'red-1' | 'red-2' | 'red-3' | 'green';

export type ClubEventGateCue = Readonly<{
  kind: ClubEventGateCueKind;
  /** Canonical timestamp in the server clock domain. */
  at: number;
  lightIndex: 0 | 1 | 2 | 3;
  startsRace: boolean;
}>;

export type ClubEventGateTransition = Readonly<{
  phase: Exclude<ClubEventGatePhase, 'waiting'>;
  /** Canonical timestamp in the server clock domain. */
  at: number;
}>;

export type ClubEventGateTimeline = Readonly<{
  eventId: string;
  eventStartAt: number;
  cadenceDelayMs: number;
  stagingStartsAt: number;
  cadenceStartsAt: number;
  ridersReadyAt: number;
  randomDelayStartsAt: number;
  redAt: readonly [number, number, number];
  greenAt: number;
  transitions: readonly ClubEventGateTransition[];
  audioCues: readonly ClubEventGateCue[];
}>;

export type ClubEventGateScheduledTransition = ClubEventGateTransition & Readonly<{
  /** Target timestamp in this client's Date.now() clock domain. */
  localAt: number;
  delayMs: number;
}>;

export type ClubEventGateScheduledCue = ClubEventGateCue & Readonly<{
  /** Target timestamp in this client's Date.now() clock domain. */
  localAt: number;
  delayMs: number;
}>;

export type ClubEventGateTimelinePlan = Readonly<{
  timeline: ClubEventGateTimeline;
  serverClockOffsetMs: number;
  /** Date.now() translated into the canonical server clock domain. */
  serverNow: number;
  phase: ClubEventGatePhase;
  phaseStartedAt: number | null;
  nextPhaseAt: number | null;
  stagingSecondsRemaining: number | null;
  cadenceLocalAt: number;
  gateDropLocalAt: number;
  upcomingTransitions: readonly ClubEventGateScheduledTransition[];
  /** Strictly future cues only. Past cues are never returned for replay. */
  pendingAudioCues: readonly ClubEventGateScheduledCue[];
  catchUp: Readonly<{
    shouldStartRace: boolean;
    raceStartedAt: number;
    elapsedRaceMs: number;
  }>;
}>;

export type ClubEventGateTimelineInput = Readonly<{
  eventId: string;
  /** Immutable Club Event startAt in the server clock domain. */
  startAt: number;
}>;

export type ClubEventGateTimelinePlanInput = ClubEventGateTimelineInput & Readonly<{
  /** Server time minus this client's Date.now(), matching multiplayer clockOffsetMs. */
  serverClockOffsetMs: number;
  now: number;
}>;

function finiteNumber(value: number, label: string) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
  return value;
}

function eventIdentity(value: string) {
  const eventId = value.trim();
  if (!eventId) {
    throw new TypeError('eventId must not be empty.');
  }
  return eventId;
}

/** Stable UCI hold for every tablet participating in the same Club Event. */
export function clubEventCadenceDelayMs(eventIdValue: string) {
  const eventId = eventIdentity(eventIdValue);
  let hash = 0;
  for (let index = 0; index < eventId.length; index += 1) {
    hash = ((hash * 31) + eventId.charCodeAt(index)) >>> 0;
  }
  const range = Math.max(1, uciRandomDelayMaxMs - uciRandomDelayMinMs + 1);
  return uciRandomDelayMinMs + (hash % range);
}

/**
 * Build the canonical schedule entirely in server time. Audio loading and the
 * moment a particular tablet joins are intentionally absent from this input.
 */
export function createClubEventGateTimeline({
  eventId: eventIdValue,
  startAt: startAtValue,
}: ClubEventGateTimelineInput): ClubEventGateTimeline {
  const eventId = eventIdentity(eventIdValue);
  const eventStartAt = finiteNumber(startAtValue, 'startAt');
  if (eventStartAt <= 0) {
    throw new RangeError('startAt must be greater than zero.');
  }

  const cadenceDelayMs = clubEventCadenceDelayMs(eventId);
  const stagingStartsAt = eventStartAt;
  const cadenceStartsAt = stagingStartsAt + raceStagingDurationMs();
  const ridersReadyAt = cadenceStartsAt + clubEventRidersReadyOffsetMs;
  const randomDelayStartsAt = cadenceStartsAt + uciVoiceWatchGateOffsetMs;
  const firstRedAt = randomDelayStartsAt + cadenceDelayMs;
  const redAt = Object.freeze([
    firstRedAt,
    firstRedAt + uciStartToneIntervalMs,
    firstRedAt + (uciStartToneIntervalMs * 2),
  ]) as readonly [number, number, number];
  const greenAt = redAt[2] + uciStartToneIntervalMs;
  const transitions = Object.freeze([
    Object.freeze({ phase: 'staging' as const, at: stagingStartsAt }),
    Object.freeze({ phase: 'ok-riders' as const, at: cadenceStartsAt }),
    Object.freeze({ phase: 'riders-ready' as const, at: ridersReadyAt }),
    Object.freeze({ phase: 'random-delay' as const, at: randomDelayStartsAt }),
    Object.freeze({ phase: 'red-1' as const, at: redAt[0] }),
    Object.freeze({ phase: 'red-2' as const, at: redAt[1] }),
    Object.freeze({ phase: 'red-3' as const, at: redAt[2] }),
    Object.freeze({ phase: 'green' as const, at: greenAt }),
  ]);
  const audioCues = Object.freeze([
    Object.freeze({ kind: 'red-1' as const, at: redAt[0], lightIndex: 0 as const, startsRace: false }),
    Object.freeze({ kind: 'red-2' as const, at: redAt[1], lightIndex: 1 as const, startsRace: false }),
    Object.freeze({ kind: 'red-3' as const, at: redAt[2], lightIndex: 2 as const, startsRace: false }),
    Object.freeze({ kind: 'green' as const, at: greenAt, lightIndex: 3 as const, startsRace: true }),
  ]);

  return Object.freeze({
    eventId,
    eventStartAt,
    cadenceDelayMs,
    stagingStartsAt,
    cadenceStartsAt,
    ridersReadyAt,
    randomDelayStartsAt,
    redAt,
    greenAt,
    transitions,
    audioCues,
  });
}

function phaseAt(timeline: ClubEventGateTimeline, serverNow: number) {
  let phase: ClubEventGatePhase = 'waiting';
  let phaseStartedAt: number | null = null;
  let nextPhaseAt: number | null = timeline.stagingStartsAt;

  for (let index = 0; index < timeline.transitions.length; index += 1) {
    const transition = timeline.transitions[index];
    if (serverNow < transition.at) {
      nextPhaseAt = transition.at;
      break;
    }
    phase = transition.phase;
    phaseStartedAt = transition.at;
    nextPhaseAt = timeline.transitions[index + 1]?.at ?? null;
  }

  return { phase, phaseStartedAt, nextPhaseAt };
}

function localTime(serverAt: number, serverClockOffsetMs: number) {
  return serverAt - serverClockOffsetMs;
}

/**
 * One-call integration API for Club Event race/sprint clients. It resolves the
 * current visual phase, schedules only future transitions/cues, and identifies
 * a late join after the gate as a race catch-up rather than an audio replay.
 */
export function planClubEventGateTimeline({
  eventId,
  startAt,
  serverClockOffsetMs: offsetValue,
  now: nowValue,
}: ClubEventGateTimelinePlanInput): ClubEventGateTimelinePlan {
  const timeline = createClubEventGateTimeline({ eventId, startAt });
  const serverClockOffsetMs = finiteNumber(offsetValue, 'serverClockOffsetMs');
  const now = finiteNumber(nowValue, 'now');
  const serverNow = now + serverClockOffsetMs;
  const { phase, phaseStartedAt, nextPhaseAt } = phaseAt(timeline, serverNow);
  const upcomingTransitions = Object.freeze(timeline.transitions
    .filter((transition) => transition.at > serverNow)
    .map((transition) => Object.freeze({
      ...transition,
      localAt: localTime(transition.at, serverClockOffsetMs),
      delayMs: transition.at - serverNow,
    })));
  const pendingAudioCues = Object.freeze(timeline.audioCues
    .filter((cue) => cue.at > serverNow)
    .map((cue) => Object.freeze({
      ...cue,
      localAt: localTime(cue.at, serverClockOffsetMs),
      delayMs: cue.at - serverNow,
    })));
  const shouldStartRace = serverNow >= timeline.greenAt;

  return Object.freeze({
    timeline,
    serverClockOffsetMs,
    serverNow,
    phase,
    phaseStartedAt,
    nextPhaseAt,
    stagingSecondsRemaining: phase === 'staging'
      ? Math.max(1, Math.ceil((timeline.cadenceStartsAt - serverNow) / 1_000))
      : null,
    cadenceLocalAt: localTime(timeline.cadenceStartsAt, serverClockOffsetMs),
    gateDropLocalAt: localTime(timeline.greenAt, serverClockOffsetMs),
    upcomingTransitions,
    pendingAudioCues,
    catchUp: Object.freeze({
      shouldStartRace,
      raceStartedAt: timeline.greenAt,
      elapsedRaceMs: shouldStartRace ? Math.max(0, serverNow - timeline.greenAt) : 0,
    }),
  });
}

export type ClubEventGateCuePlaybackState = 'future' | 'fresh' | 'stale';

/**
 * Recheck a previously scheduled cue when its timer fires. Initial/late joins
 * must schedule from pendingAudioCues, which already excludes every past cue.
 */
export function clubEventGateCuePlaybackState({
  cue,
  serverClockOffsetMs: offsetValue,
  now: nowValue,
  freshnessMs = clubEventGateCueFreshnessMs,
}: Readonly<{
  cue: ClubEventGateCue;
  serverClockOffsetMs: number;
  now: number;
  freshnessMs?: number;
}>): ClubEventGateCuePlaybackState {
  const serverClockOffsetMs = finiteNumber(offsetValue, 'serverClockOffsetMs');
  const now = finiteNumber(nowValue, 'now');
  const safeFreshnessMs = Math.max(0, finiteNumber(freshnessMs, 'freshnessMs'));
  const serverNow = now + serverClockOffsetMs;
  if (serverNow < cue.at) return 'future';
  return serverNow - cue.at <= safeFreshnessMs ? 'fresh' : 'stale';
}

export type ClubEventGateTimelineCallbacks = Readonly<{
  now: () => number;
  schedule: (delayMs: number, action: () => void) => void;
  onStaging: (secondsRemaining: number) => void;
  onVoice: () => void;
  onCadencePhase: (phase: 'ok-riders' | 'riders-ready' | 'random-delay') => void;
  onReactionArmed: (firstRedLocalAt: number) => void;
  onRed: (index: 0 | 1 | 2, playTone: boolean) => void;
  onGreen: (gateDropLocalAt: number, playTone: boolean) => void;
}>;

function stagingSecondsAt(timeline: ClubEventGateTimeline, serverNow: number) {
  const totalSeconds = raceStagingDurationMs() / 1_000;
  return Math.max(1, Math.min(
    totalSeconds,
    Math.ceil((timeline.cadenceStartsAt - serverNow) / 1_000),
  ));
}

/**
 * Executes a previously planned Club Event schedule without introducing a
 * second local clock. The caller owns UI/audio side effects and cancellation;
 * this runtime owns ordering, catch-up, and stale-tone suppression.
 */
export function runClubEventGateTimelinePlan(
  plan: ClubEventGateTimelinePlan,
  callbacks: ClubEventGateTimelineCallbacks,
) {
  const { timeline, serverClockOffsetMs, serverNow } = plan;
  const firstRedLocalAt = localTime(timeline.redAt[0], serverClockOffsetMs);
  const currentServerNow = () => callbacks.now() + serverClockOffsetMs;
  const currentPhase = () => phaseAt(timeline, currentServerNow()).phase;
  const voiceIsFresh = (serverTime: number) => (
    serverTime - timeline.cadenceStartsAt <= clubEventVoiceCueFreshnessMs
  );

  const armReaction = () => callbacks.onReactionArmed(firstRedLocalAt);
  const playCue = (cue: ClubEventGateCue) => clubEventGateCuePlaybackState({
    cue,
    serverClockOffsetMs,
    now: callbacks.now(),
  }) === 'fresh';
  const red = (index: 0 | 1 | 2, allowAudio: boolean) => {
    armReaction();
    callbacks.onRed(index, allowAudio && playCue(timeline.audioCues[index]));
  };
  const green = (allowAudio: boolean) => {
    armReaction();
    callbacks.onGreen(
      localTime(timeline.greenAt, serverClockOffsetMs),
      allowAudio && playCue(timeline.audioCues[3]),
    );
  };

  if (plan.phase === 'waiting' || plan.phase === 'staging') {
    callbacks.onStaging(stagingSecondsAt(timeline, serverNow));
  } else if (plan.phase === 'ok-riders') {
    if (voiceIsFresh(serverNow)) callbacks.onVoice();
    callbacks.onCadencePhase(plan.phase);
  } else if (plan.phase === 'riders-ready' || plan.phase === 'random-delay') {
    // A late tablet must not restart the full cadence recording after its
    // matching phrase has already passed; that recording would overlap the
    // absolute red/green cues. The current visual phase is still restored.
    callbacks.onCadencePhase(plan.phase);
  } else if (plan.phase === 'red-1') {
    red(0, false);
  } else if (plan.phase === 'red-2') {
    red(1, false);
  } else if (plan.phase === 'red-3') {
    red(2, false);
  } else if (plan.phase === 'green') {
    green(false);
    return plan;
  }

  // Countdown labels are also anchored to the canonical cadence timestamp;
  // a tablet that joins five seconds late begins at 15 rather than at 20.
  const totalStagingSeconds = raceStagingDurationMs() / 1_000;
  for (
    let secondsRemaining = totalStagingSeconds - 1;
    secondsRemaining >= 1;
    secondsRemaining -= 1
  ) {
    const at = timeline.cadenceStartsAt - (secondsRemaining * 1_000);
    if (at > serverNow) {
      callbacks.schedule(at - serverNow, () => {
        const liveServerNow = currentServerNow();
        if (phaseAt(timeline, liveServerNow).phase !== 'staging') return;
        callbacks.onStaging(stagingSecondsAt(timeline, liveServerNow));
      });
    }
  }

  plan.upcomingTransitions.forEach((transition) => {
    callbacks.schedule(transition.delayMs, () => {
      // A backgrounded or map-busy tablet can wake long after several timers
      // were due. Apply only the phase that is authoritative now so stale
      // voice, labels, and lights never replay in a burst.
      if (currentPhase() !== transition.phase) return;
      if (transition.phase === 'staging') {
        callbacks.onStaging(totalStagingSeconds);
      } else if (transition.phase === 'ok-riders') {
        if (voiceIsFresh(currentServerNow())) callbacks.onVoice();
        callbacks.onCadencePhase('ok-riders');
      } else if (
        transition.phase === 'riders-ready'
        || transition.phase === 'random-delay'
      ) {
        callbacks.onCadencePhase(transition.phase);
      } else if (transition.phase === 'red-1') {
        red(0, true);
      } else if (transition.phase === 'red-2') {
        red(1, true);
      } else if (transition.phase === 'red-3') {
        red(2, true);
      } else if (transition.phase === 'green') {
        green(true);
      }
    });
  });

  return plan;
}
