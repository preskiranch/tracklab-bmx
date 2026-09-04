import { Check, Flag, RotateCcw, Timer, Trophy, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  playStartGateToneConfirmed,
  playUciRandomStartVoice,
  primeAudioCues,
  stopStartGateAudio,
} from '../lib/audioCues';
import {
  createReactionTestCadenceDelay,
  createReactionTestCadencePlan,
  createReactionTestResult,
  fireReactionTestCue,
  formatReactionTime,
  normalizeReactionInputTimestamp,
  reactionStageAtTimestamp,
  type ReactionTestCadencePlan,
  type ReactionTestCueEvent,
  type ReactionTestResult,
  type ReactionTestStage,
} from '../lib/reactionTest';
import { uciStartToneIntervalMs } from '../lib/uciStartGate';
import { ReactionGateLayer, REACTION_GATE_DROP_MS } from './ReactionGateLayer';
import './ReactionTestView.css';

type ReactionTestRunState = 'ready' | 'arming' | 'waiting' | 'running' | 'finished';

export type ReactionTestViewProps = {
  /** Results are persisted by the existing TrackLab session-history layer. */
  onResult?: (result: ReactionTestResult) => void | Promise<void>;
  /** The rider's durable all-time best, measured from the first UCI tone. */
  personalBestMs?: number | null;
  onExit?: () => void;
};

function monotonicNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function ratingLabel(result: ReactionTestResult) {
  if (result.falseStart) return 'TOO EARLY / FALSE START';
  if (result.rating === 'excellent') return 'EXCELLENT';
  if (result.rating === 'great') return 'GREAT';
  if (result.rating === 'okay') return 'OKAY';
  return 'LATE';
}

/**
 * A free-standing, touch-first BMX start reaction exercise. CSS handles only
 * scene motion; timing and scoring stay in the UCI cadence plan.
 */
export function ReactionTestView({ onResult, personalBestMs = null, onExit }: ReactionTestViewProps) {
  const [runState, setRunState] = useState<ReactionTestRunState>('ready');
  const [activeStage, setActiveStage] = useState<ReactionTestStage>('idle');
  const [gateReleased, setGateReleased] = useState(false);
  const [gateSettled, setGateSettled] = useState(false);
  const [result, setResult] = useState<ReactionTestResult | null>(null);
  const [displayedPersonalBestMs, setDisplayedPersonalBestMs] = useState<number | null>(() => (
    Number.isFinite(personalBestMs) && Number(personalBestMs) > 0 ? Number(personalBestMs) : null
  ));
  const [newPersonalRecord, setNewPersonalRecord] = useState(false);
  const [notice, setNotice] = useState('Press start, then tap anywhere on the race surface when you react.');

  const generationRef = useRef(0);
  const timeoutsRef = useRef<number[]>([]);
  const cueEventsRef = useRef<ReactionTestCueEvent[]>([]);
  const timerStartedAtRef = useRef<number | null>(null);
  const timerStartedAtEpochRef = useRef<number | null>(null);
  const cadencePlanRef = useRef<ReactionTestCadencePlan | null>(null);
  const resultCapturedRef = useRef(false);
  const runStateRef = useRef<ReactionTestRunState>('ready');
  const personalBestRef = useRef(displayedPersonalBestMs);

  const setRunStateSafely = useCallback((next: ReactionTestRunState) => {
    runStateRef.current = next;
    setRunState(next);
  }, []);

  const clearTimers = useCallback(() => {
    timeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    timeoutsRef.current = [];
  }, []);

  const resetAttempt = useCallback(() => {
    generationRef.current += 1;
    clearTimers();
    stopStartGateAudio();
    cueEventsRef.current = [];
    timerStartedAtRef.current = null;
    timerStartedAtEpochRef.current = null;
    cadencePlanRef.current = null;
    resultCapturedRef.current = false;
    setActiveStage('idle');
    setGateReleased(false);
    setGateSettled(false);
    setResult(null);
    setNewPersonalRecord(false);
    setNotice('Press start, then tap anywhere on the race surface when you react.');
    setRunStateSafely('ready');
  }, [clearTimers, setRunStateSafely]);

  useEffect(() => resetAttempt, [resetAttempt]);

  useEffect(() => {
    const incoming = Number(personalBestMs);
    if (!Number.isFinite(incoming) || incoming <= 0) return;
    if (personalBestRef.current == null || incoming < personalBestRef.current) {
      personalBestRef.current = incoming;
      setDisplayedPersonalBestMs(incoming);
    }
  }, [personalBestMs]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const saveResult = useCallback((nextResult: ReactionTestResult) => {
    if (resultCapturedRef.current) return;
    resultCapturedRef.current = true;
    let beatExistingRecord = false;
    if (nextResult.valid && nextResult.reactionTimeMs != null) {
      const previousBest = personalBestRef.current;
      if (previousBest == null || nextResult.reactionTimeMs < previousBest) {
        beatExistingRecord = previousBest != null;
        personalBestRef.current = nextResult.reactionTimeMs;
        setDisplayedPersonalBestMs(nextResult.reactionTimeMs);
      }
    }
    setNewPersonalRecord(beatExistingRecord);
    setResult(nextResult);
    void Promise.resolve(onResult?.(nextResult)).catch((error: unknown) => {
      console.warn('Could not save Reaction Test result:', error);
    });
  }, [onResult]);

  const scheduleCadence = useCallback((plan: ReactionTestCadencePlan, generation: number) => {
    const runCue = async (index: number) => {
      const cadenceWasStopped = () => (
        generation !== generationRef.current || runStateRef.current === 'finished'
      );
      if (cadenceWasStopped()) return;
      const cue = plan.cues[index];
      if (!cue) return;

      // Confirm audible onset before changing any timing-sensitive state.
      // The tone result is the one authority for the light, reaction timer,
      // gate release and the cadence interval that follows this cue.
      const toneOnset = await playStartGateToneConfirmed(cue.tone);
      if (cadenceWasStopped()) return;
      if (toneOnset.startedAtMonotonic == null) {
        clearTimers();
        stopStartGateAudio();
        setActiveStage('idle');
        setNotice('Audio could not start. Press Start Reaction Test to try again.');
        setRunStateSafely('ready');
        return;
      }
      const event = fireReactionTestCue(cue, () => toneOnset.startedAtMonotonic!);
      cueEventsRef.current.push(event);
      setActiveStage(event.stage);
      if (event.startsTimer) {
        timerStartedAtRef.current = event.firedAt;
        timerStartedAtEpochRef.current = Date.now()
          - Math.max(0, monotonicNow() - event.firedAt);
        setRunStateSafely('running');
        setNotice('Tap anywhere on the race surface now.');
      }
      if (event.releasesGate) {
        setGateReleased(true);
        setNotice(resultCapturedRef.current
          ? 'Gate released. Your result is locked in.'
          : 'GREEN — tap now for a late reaction.');
        // The rigid gate layer reports its real animation completion. This fallback is
        // only for backgrounded WKWebViews where requestAnimationFrame can be
        // suspended before the final paint callback runs.
        const settledTimeout = window.setTimeout(() => {
          if (generation === generationRef.current) setGateSettled(true);
        }, REACTION_GATE_DROP_MS + 180);
        timeoutsRef.current.push(settledTimeout);
      }

      // Match Race Intervals: start each following cue from the cue that
      // audibly started. Four independent absolute timers can collapse into
      // a burst when a busy map or WKWebView stalls the main thread.
      if (index < plan.cues.length - 1) {
        const nextTimeout = window.setTimeout(
          () => void runCue(index + 1),
          Math.max(0, event.firedAt + uciStartToneIntervalMs - monotonicNow()),
        );
        timeoutsRef.current.push(nextTimeout);
      }
    };

    const firstCue = plan.cues[0];
    if (!firstCue) return;
    const firstTimeout = window.setTimeout(
      () => void runCue(0),
      Math.max(0, firstCue.at - monotonicNow()),
    );
    timeoutsRef.current.push(firstTimeout);
  }, [clearTimers, setRunStateSafely]);

  const startAttempt = useCallback(async () => {
    if (runStateRef.current !== 'ready') return;

    generationRef.current += 1;
    const generation = generationRef.current;
    resultCapturedRef.current = false;
    cueEventsRef.current = [];
    timerStartedAtRef.current = null;
    timerStartedAtEpochRef.current = null;
    cadencePlanRef.current = null;
    setActiveStage('idle');
    setGateReleased(false);
    setGateSettled(false);
    setResult(null);
    setNotice('Preparing the UCI start cadence…');
    setRunStateSafely('arming');

    // Runs inside the direct user gesture path so iOS allows the existing UCI
    // voice file and tone context to play with no first-cue permissions lag.
    await primeAudioCues().catch(() => undefined);
    if (generation !== generationRef.current) return;

    const voice = await playUciRandomStartVoice().catch(() => null);
    if (generation !== generationRef.current) return;

    // playUciRandomStartVoice supplies a monotonic timestamp from the same
    // audio-start event. A fallback remains functional in browsers that cannot
    // report it, while preserving the existing UCI timing constants.
    const voiceStartedAt = voice?.startedAtMonotonic ?? monotonicNow();
    const plan = createReactionTestCadencePlan(
      voiceStartedAt,
      createReactionTestCadenceDelay(),
    );
    cadencePlanRef.current = plan;
    setRunStateSafely('waiting');
    setNotice('Listen for the UCI cadence. The whole race surface is your reaction target.');
    scheduleCadence(plan, generation);
  }, [scheduleCadence, setRunStateSafely]);

  const captureReaction = useCallback((source?: EventTarget | null, eventTimestamp?: number) => {
    // The start/retry controls sit inside the generous reaction surface. They
    // are controls, not rider reactions, even though capture listeners run
    // before a button can stop its bubbling pointer event.
    if (source instanceof Element && source.closest('.reaction-control-action')) return;
    const currentRunState = runStateRef.current;
    if (currentRunState === 'ready' || currentRunState === 'finished' || resultCapturedRef.current) return;

    const handlerTimestamp = monotonicNow();
    const recordedAt = normalizeReactionInputTimestamp(
      eventTimestamp,
      handlerTimestamp,
      typeof performance !== 'undefined' ? performance.timeOrigin : undefined,
    );
    const recordedAtEpoch = Date.now() - Math.max(0, handlerTimestamp - recordedAt);
    const plan = cadencePlanRef.current;
    const timerStartedAt = timerStartedAtRef.current;
    const reactionStage = reactionStageAtTimestamp(cueEventsRef.current, recordedAt);

    if (timerStartedAt == null || reactionStage === 'too-early') {
      // Invalidate an in-flight voice preload as well as any cues that may
      // have been queued immediately before this false start.
      generationRef.current += 1;
      const falseStart = createReactionTestResult({
        id: `reaction-test-${Date.now()}-${generationRef.current}`,
        timerStartedAt: null,
        timerStartedAtEpoch: null,
        recordedAt,
        recordedAtEpoch,
        stage: 'too-early',
        cadenceDelayMs: plan?.cadenceDelayMs ?? null,
      });
      clearTimers();
      stopStartGateAudio();
      setRunStateSafely('finished');
      setNotice('False start. Wait for the red tone before reacting.');
      saveResult(falseStart);
      return;
    }

    const nextResult = createReactionTestResult({
      id: `reaction-test-${Date.now()}-${generationRef.current}`,
      timerStartedAt,
      timerStartedAtEpoch: timerStartedAtEpochRef.current,
      recordedAt,
      recordedAtEpoch,
      stage: reactionStage,
      cadenceDelayMs: plan?.cadenceDelayMs ?? null,
    });
    saveResult(nextResult);
    setNotice('Reaction captured. The gate will finish its drop.');
  }, [clearTimers, saveResult, setRunStateSafely]);

  const startButtonDisabled = runState !== 'ready';
  const retryAvailable = result != null && (result.falseStart || gateSettled);
  const handleGateSettled = useCallback(() => setGateSettled(true), []);
  const historicalLightIndex = activeStage === 'red'
    ? 0
    : activeStage === 'yellow-1'
      ? 1
      : activeStage === 'yellow-2'
        ? 2
        : activeStage === 'green' ? 3 : -1;

  return (
    <section className="reaction-test-view" aria-label="Reaction Test">
      <div
        className={`reaction-race-surface ${runState !== 'ready' && runState !== 'finished' ? 'is-reacting' : ''}`}
        role="button"
        tabIndex={0}
        onPointerDownCapture={(event) => captureReaction(event.target, event.timeStamp)}
        onKeyDown={(event) => {
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            captureReaction(event.target, event.timeStamp);
          }
        }}
        aria-label="Reaction area. Tap anywhere after the first red light to record your reaction."
      >
        {onExit && (
          <button
            aria-label="Exit Reaction Test"
            className="reaction-exit-action reaction-control-action"
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onExit}
          >
            <X aria-hidden="true" size={20} />
          </button>
        )}
        <div
          className="reaction-scene-stack"
          data-gate-state={gateSettled ? 'settled' : gateReleased ? 'dropping' : 'upright'}
          aria-label={gateReleased ? 'Full-width starting gate released' : 'Full-width starting gate upright and locked'}
        >
          <div className="reaction-scene-frame">
            <img
              className="reaction-scene-background"
              src="/assets/reaction-test-eight-lane-base.png"
              alt="Side view of an eight-lane starting hill with a fixed metal deck and a gate recess in the dirt"
              draggable={false}
            />
            <ReactionGateLayer released={gateReleased} onSettled={handleGateSettled} />
          </div>
        </div>
        <div className="reaction-scene-vignette" aria-hidden="true" />

        <header className="reaction-hud">
          <div className="reaction-title">
            <strong><Timer size={19} /> Reaction Test</strong>
          </div>
        </header>
        <p className="reaction-live-status sr-only" role="status" aria-live="polite">{notice}</p>

        <div className="reaction-tree" aria-label={`Starting tree: ${activeStage === 'idle' ? 'ready' : activeStage}`}>
          {[
            { stage: 'red' as const, label: 'RED', resultLabel: 'red', color: 'red' },
            { stage: 'yellow-1' as const, label: 'YELLOW', resultLabel: 'first yellow', color: 'yellow' },
            { stage: 'yellow-2' as const, label: 'YELLOW', resultLabel: 'second yellow', color: 'yellow' },
            { stage: 'green' as const, label: 'GREEN', resultLabel: 'green', color: 'green' },
          ].map((light, index) => (
            <div
              className={`reaction-light reaction-light-${light.color} ${historicalLightIndex >= index ? 'lit' : ''} ${activeStage === light.stage ? 'current' : ''}`}
              data-reaction-stage={light.stage}
              key={light.stage}
            >
              <span className="reaction-light-bulb" />
              <small>{light.label}</small>
              {result?.stage === light.stage && (
                <span
                  className="reaction-light-stop-marker"
                  aria-label={`Reaction recorded at the ${light.resultLabel} light`}
                  title="Reaction recorded here"
                >
                  <Check aria-hidden="true" size={17} strokeWidth={4} />
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="reaction-bottom-panel">
          <div className="reaction-result-stack">
            {result ? (
              <div className={`reaction-result-card ${result.falseStart ? 'false-start' : result.rating}`}>
                <span className="reaction-result-label">{result.falseStart ? 'REACTION RESULT' : 'REACTION TIME'}</span>
                <strong>{result.falseStart ? '—' : `${formatReactionTime(result.reactionTimeMs)} sec`}</strong>
                <em>{ratingLabel(result)}</em>
                <small>{result.falseStart
                  ? 'This try was saved as invalid and does not count as a reaction time.'
                  : `${result.stage === 'red' ? 'First red' : result.stage.replace('-', ' ')} stage · saved to your TrackLab history`}</small>
              </div>
            ) : (
              <div className="reaction-ready-card">
                <Flag size={20} />
                <span>{runState === 'ready' ? 'Ready at the gate' : 'Tap the entire race surface — no small button to find.'}</span>
              </div>
            )}
            <div
              className={`reaction-pr-badge${newPersonalRecord ? ' is-new-record' : ''}`}
              role={newPersonalRecord ? 'status' : undefined}
              aria-live="polite"
            >
              <Trophy aria-hidden="true" size={17} />
              <span>{newPersonalRecord ? 'NEW PR' : 'PR'} · {displayedPersonalBestMs == null
                ? '—'
                : `${formatReactionTime(displayedPersonalBestMs)} sec`}</span>
            </div>
          </div>

          {runState === 'ready' ? (
            <button
              className="reaction-primary-action reaction-control-action"
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={startAttempt}
              disabled={startButtonDisabled}
            >
              <Timer size={20} /> Start Reaction Test
            </button>
          ) : retryAvailable ? (
            <button
              className="reaction-primary-action reaction-control-action"
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={resetAttempt}
            >
              <RotateCcw size={20} /> Try Again
            </button>
          ) : result ? (
            <span className="reaction-gate-finish">Finishing gate drop…</span>
          ) : (
            <span className="reaction-gate-finish"><Trophy size={18} /> Listen, then react.</span>
          )}
        </div>
      </div>
    </section>
  );
}
