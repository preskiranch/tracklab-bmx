import { Flag, RotateCcw, Timer, Trophy } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  playStartGateTone,
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
  type ReactionTestCadencePlan,
  type ReactionTestResult,
  type ReactionTestStage,
} from '../lib/reactionTest';
import './ReactionTestView.css';

type ReactionTestRunState = 'ready' | 'arming' | 'waiting' | 'running' | 'finished';

export type ReactionTestViewProps = {
  /** Results are persisted by the existing TrackLab session-history layer. */
  onResult?: (result: ReactionTestResult) => void | Promise<void>;
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
export function ReactionTestView({ onResult }: ReactionTestViewProps) {
  const [runState, setRunState] = useState<ReactionTestRunState>('ready');
  const [activeStage, setActiveStage] = useState<ReactionTestStage>('idle');
  const [gateReleased, setGateReleased] = useState(false);
  const [gateSettled, setGateSettled] = useState(false);
  const [result, setResult] = useState<ReactionTestResult | null>(null);
  const [notice, setNotice] = useState('Press start, then tap anywhere on the race surface when you react.');

  const generationRef = useRef(0);
  const timeoutsRef = useRef<number[]>([]);
  const activeStageRef = useRef<ReactionTestStage>('idle');
  const timerStartedAtRef = useRef<number | null>(null);
  const timerStartedAtEpochRef = useRef<number | null>(null);
  const cadencePlanRef = useRef<ReactionTestCadencePlan | null>(null);
  const resultCapturedRef = useRef(false);
  const runStateRef = useRef<ReactionTestRunState>('ready');

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
    activeStageRef.current = 'idle';
    timerStartedAtRef.current = null;
    timerStartedAtEpochRef.current = null;
    cadencePlanRef.current = null;
    resultCapturedRef.current = false;
    setActiveStage('idle');
    setGateReleased(false);
    setGateSettled(false);
    setResult(null);
    setNotice('Press start, then tap anywhere on the race surface when you react.');
    setRunStateSafely('ready');
  }, [clearTimers, setRunStateSafely]);

  useEffect(() => resetAttempt, [resetAttempt]);

  const saveResult = useCallback((nextResult: ReactionTestResult) => {
    if (resultCapturedRef.current) return;
    resultCapturedRef.current = true;
    setResult(nextResult);
    void Promise.resolve(onResult?.(nextResult)).catch((error: unknown) => {
      console.warn('Could not save Reaction Test result:', error);
    });
  }, [onResult]);

  const scheduleCadence = useCallback((plan: ReactionTestCadencePlan, generation: number) => {
    plan.cues.forEach((cue) => {
      const delayMs = Math.max(0, cue.at - monotonicNow());
      const timeoutId = window.setTimeout(() => {
        if (generation !== generationRef.current || runStateRef.current === 'finished') return;

        // This one event is the authority for all actions at a given cue.
        // No CSS transition, requestAnimationFrame, or delayed state update is
        // allowed to write the timer or gate timestamp.
        const event = fireReactionTestCue(cue, monotonicNow);
        activeStageRef.current = event.stage;
        setActiveStage(event.stage);
        if (event.startsTimer) {
          timerStartedAtRef.current = event.firedAt;
          timerStartedAtEpochRef.current = Date.now();
          setRunStateSafely('running');
          setNotice('Tap anywhere on the race surface now.');
        }
        if (event.releasesGate) {
          setGateReleased(true);
          setNotice(resultCapturedRef.current
            ? 'Gate released. Your result is locked in.'
            : 'GREEN — tap now for a late reaction.');
          const settledTimeout = window.setTimeout(() => {
            if (generation === generationRef.current) setGateSettled(true);
          }, 560);
          timeoutsRef.current.push(settledTimeout);
        }
        playStartGateTone(event.tone);
      }, delayMs);
      timeoutsRef.current.push(timeoutId);
    });
  }, [setRunStateSafely]);

  const startAttempt = useCallback(async () => {
    if (runStateRef.current !== 'ready') return;

    generationRef.current += 1;
    const generation = generationRef.current;
    resultCapturedRef.current = false;
    activeStageRef.current = 'idle';
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

  const captureReaction = useCallback((source?: EventTarget | null) => {
    // The start/retry controls sit inside the generous reaction surface. They
    // are controls, not rider reactions, even though capture listeners run
    // before a button can stop its bubbling pointer event.
    if (source instanceof Element && source.closest('.reaction-primary-action')) return;
    const currentRunState = runStateRef.current;
    if (currentRunState === 'ready' || currentRunState === 'finished' || resultCapturedRef.current) return;

    const now = monotonicNow();
    const recordedAtEpoch = Date.now();
    const plan = cadencePlanRef.current;
    const timerStartedAt = timerStartedAtRef.current;

    if (timerStartedAt == null || activeStageRef.current === 'idle') {
      // Invalidate an in-flight voice preload as well as any cues that may
      // have been queued immediately before this false start.
      generationRef.current += 1;
      const falseStart = createReactionTestResult({
        id: `reaction-test-${Date.now()}-${generationRef.current}`,
        timerStartedAt: null,
        timerStartedAtEpoch: null,
        recordedAt: now,
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
      recordedAt: now,
      recordedAtEpoch,
      stage: activeStageRef.current,
      cadenceDelayMs: plan?.cadenceDelayMs ?? null,
    });
    saveResult(nextResult);
    setNotice('Reaction captured. The gate will finish its drop.');
  }, [clearTimers, saveResult, setRunStateSafely]);

  const startButtonDisabled = runState !== 'ready';
  const retryAvailable = result != null && (result.falseStart || gateSettled);
  const historicalLightIndex = activeStage === 'red'
    ? 0
    : activeStage === 'yellow-1'
      ? 1
      : activeStage === 'yellow-2'
        ? 2
        : activeStage === 'green' ? 3 : -1;

  return (
    <section className="reaction-test-view" aria-label="BMX Reaction Test">
      <div
        className={`reaction-race-surface ${runState !== 'ready' && runState !== 'finished' ? 'is-reacting' : ''}`}
        role="button"
        tabIndex={0}
        onPointerDownCapture={(event) => captureReaction(event.target)}
        onKeyDown={(event) => {
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            captureReaction(event.target);
          }
        }}
        aria-label="Reaction area. Tap anywhere after the first red light to record your reaction."
      >
        <img
          className="reaction-scene-image"
          src="/assets/reaction-test-start-hill-side-close.png"
          alt="Side profile of a BMX start hill and race course"
        />
        <div className="reaction-scene-vignette" aria-hidden="true" />

        <header className="reaction-hud">
          <div className="reaction-title">
            <span>Free BMX skill drill</span>
            <strong><Timer size={19} /> Reaction Test</strong>
          </div>
          <div className="reaction-status" aria-live="polite">{notice}</div>
        </header>

        <div className="reaction-tree" aria-label={`Starting tree: ${activeStage === 'idle' ? 'ready' : activeStage}`}>
          {[
            { stage: 'red' as const, label: 'RED', color: 'red' },
            { stage: 'yellow-1' as const, label: 'YELLOW', color: 'yellow' },
            { stage: 'yellow-2' as const, label: 'YELLOW', color: 'yellow' },
            { stage: 'green' as const, label: 'GREEN', color: 'green' },
          ].map((light, index) => (
            <div
              className={`reaction-light reaction-light-${light.color} ${historicalLightIndex >= index ? 'lit' : ''} ${activeStage === light.stage ? 'current' : ''}`}
              key={light.stage}
            >
              <span className="reaction-light-bulb" />
              <small>{light.label}</small>
            </div>
          ))}
        </div>

        <div className="reaction-gate-stage" aria-label={gateReleased ? 'Starting gate released' : 'Starting gate upright and locked'}>
          <span className="reaction-gate-side-caption" aria-hidden="true">SIDE VIEW · BARREL SAFETY GATE</span>
          <div className={`reaction-gate ${gateReleased ? 'is-dropping' : ''}`}>
            <span className="reaction-gate-bed" />
            <span className="reaction-gate-actuator" />
            <span className="reaction-gate-leaf-motion">
              <img
                className="reaction-gate-leaf"
                src="/assets/reaction-test-barrel-gate.png"
                alt=""
                aria-hidden="true"
                draggable={false}
              />
            </span>
            <span className="reaction-gate-hinge" />
          </div>
        </div>

        <div className="reaction-bottom-panel">
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

          {runState === 'ready' ? (
            <button
              className="reaction-primary-action"
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={startAttempt}
              disabled={startButtonDisabled}
            >
              <Timer size={20} /> Start Reaction Test
            </button>
          ) : retryAvailable ? (
            <button
              className="reaction-primary-action"
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
