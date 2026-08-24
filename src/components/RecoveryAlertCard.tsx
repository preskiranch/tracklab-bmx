import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  BellRing,
  Brain,
  Clock3,
  HeartPulse,
  Minus,
  Plus,
  ShieldCheck,
  Square,
  Zap,
} from 'lucide-react';
import type { RecoveryAlertPreference, RecoveryEpisode, RecoveryMode } from '../lib/recoveryAlert';

export type RecoveryAlertDraft = Readonly<{
  mode: RecoveryMode;
  timerSeconds: number;
  targetBpm: number;
  minimumSeconds: number;
  maximumSeconds: number;
}>;

export type RecoveryAlertDisplay = Readonly<{
  ready: boolean;
  status: string;
  detail: string;
  remainingSeconds: number | null;
}>;

type RecoveryAlertCardProps = Readonly<{
  draft: RecoveryAlertDraft;
  savedPreferences: RecoveryAlertPreference | null;
  episode: RecoveryEpisode | null;
  latestHeartRate: Readonly<{ bpm: number; recordedAt: number }> | null;
  now: number;
  loading: boolean;
  saving: boolean;
  actionBusy: boolean;
  message: string;
  nativeAlertsAvailable: boolean | null;
  onDraftChange: (draft: RecoveryAlertDraft) => void;
  onSave: () => void;
  onAddTime: () => void;
  onStartAnyway: () => void;
  onStop: () => void;
}>;

function finiteNumber(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function recoveryMinutesFromSeconds(
  value: unknown,
  fallbackSeconds = 300,
  maximumMinutes = 30,
) {
  return Math.max(1, Math.min(
    maximumMinutes,
    Math.ceil(finiteNumber(value, fallbackSeconds) / 60),
  ));
}

export function recoverySecondsFromMinutes(
  value: unknown,
  fallbackSeconds = 300,
  minimumMinutes = 1,
  maximumMinutes = 30,
) {
  return Math.max(
    minimumMinutes,
    Math.min(maximumMinutes, Math.round(finiteNumber(
      value,
      recoveryMinutesFromSeconds(fallbackSeconds, fallbackSeconds, maximumMinutes),
    ))),
  ) * 60;
}

export function recoverySecondsFromMinuteInput(
  value: unknown,
  minimumMinutes = 1,
  maximumMinutes = 30,
) {
  if (typeof value === 'string' && value.trim() === '') return null;
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= minimumMinutes && numeric <= maximumMinutes
    ? numeric * 60
    : null;
}

function wholeMinuteRecoverySeconds(value: unknown, fallbackSeconds = 300, maximumMinutes = 30) {
  return recoveryMinutesFromSeconds(value, fallbackSeconds, maximumMinutes) * 60;
}

export function clampRecoveryTargetBpm(value: unknown, fallback = 115) {
  return Math.max(40, Math.min(220, Math.round(finiteNumber(value, fallback))));
}

export function smartRecoveryBackupSeconds(
  timerSeconds: number,
  currentBackupSeconds: number,
  minimumSeconds = 60,
) {
  return Math.max(
    wholeMinuteRecoverySeconds(timerSeconds),
    wholeMinuteRecoverySeconds(currentBackupSeconds, 600),
    wholeMinuteRecoverySeconds(minimumSeconds, 60, 10),
  );
}

export function recoveryDraftFromPreferences(
  preferences: RecoveryAlertPreference | null,
): RecoveryAlertDraft {
  const mode = preferences?.mode ?? 'off';
  const timerSeconds = wholeMinuteRecoverySeconds(preferences?.timerSeconds, 300);
  const minimumSeconds = wholeMinuteRecoverySeconds(preferences?.minimumSeconds, 60, 10);
  const maximumSeconds = wholeMinuteRecoverySeconds(preferences?.maximumSeconds, 600);
  return {
    mode,
    timerSeconds,
    targetBpm: clampRecoveryTargetBpm(preferences?.targetBpm, 115),
    minimumSeconds,
    maximumSeconds: mode === 'smart'
      ? smartRecoveryBackupSeconds(timerSeconds, maximumSeconds, minimumSeconds)
      : Math.max(minimumSeconds, maximumSeconds),
  };
}

type RecoveryMinutesFieldProps = Readonly<{
  label: string;
  seconds: number;
  fallbackSeconds?: number;
  minimumMinutes?: number;
  maximumMinutes?: number;
  onChange: (seconds: number) => void;
  onValidityChange: (field: string, valid: boolean) => void;
}>;

function RecoveryMinutesField({
  label,
  seconds,
  fallbackSeconds = 300,
  minimumMinutes = 1,
  maximumMinutes = 30,
  onChange,
  onValidityChange,
}: RecoveryMinutesFieldProps) {
  const inputId = useId();
  const committedMinutes = recoveryMinutesFromSeconds(seconds, fallbackSeconds, maximumMinutes);
  const [inputValue, setInputValue] = useState(String(committedMinutes));
  const validityResetTimer = useRef<number | null>(null);
  const cancelValidityReset = () => {
    if (validityResetTimer.current == null) return;
    window.clearTimeout(validityResetTimer.current);
    validityResetTimer.current = null;
  };
  useEffect(() => {
    setInputValue(String(committedMinutes));
    onValidityChange(label, true);
  }, [committedMinutes, label, onValidityChange]);
  useEffect(() => () => {
    if (validityResetTimer.current != null) window.clearTimeout(validityResetTimer.current);
    onValidityChange(label, true);
  }, [label, onValidityChange]);
  const inputValid = recoverySecondsFromMinuteInput(
    inputValue,
    minimumMinutes,
    maximumMinutes,
  ) != null;
  const parsedMinutes = inputValid ? Number(inputValue) : committedMinutes;
  const applyMinuteStep = (direction: -1 | 1) => {
    cancelValidityReset();
    const nextMinutes = Math.max(
      minimumMinutes,
      Math.min(maximumMinutes, parsedMinutes + direction),
    );
    const nextSeconds = nextMinutes * 60;
    setInputValue(String(nextMinutes));
    onValidityChange(label, true);
    if (nextSeconds !== seconds) onChange(nextSeconds);
  };

  return (
    <div className="recovery-alert-minute-field">
      <label htmlFor={inputId}>{label}</label>
      <div className="recovery-alert-minute-controls">
        <button
          type="button"
          aria-label={`Decrease ${label} by 1 minute`}
          disabled={inputValid && parsedMinutes <= minimumMinutes}
          onClick={() => applyMinuteStep(-1)}
        >
          <Minus size={20} aria-hidden="true" />
        </button>
        <span className="recovery-alert-input-unit">
          <input
            id={inputId}
            aria-label={`${label} in minutes`}
            type="number"
            inputMode="numeric"
            min={minimumMinutes}
            max={maximumMinutes}
            step={1}
            value={inputValue}
            aria-invalid={!inputValid}
            onFocus={cancelValidityReset}
            onChange={(event) => {
              cancelValidityReset();
              const value = event.target.value;
              setInputValue(value);
              const nextSeconds = recoverySecondsFromMinuteInput(
                value,
                minimumMinutes,
                maximumMinutes,
              );
              onValidityChange(label, nextSeconds != null);
              if (nextSeconds != null) onChange(nextSeconds);
            }}
            onBlur={() => {
              const nextSeconds = recoverySecondsFromMinuteInput(
                inputValue,
                minimumMinutes,
                maximumMinutes,
              );
              setInputValue(String(nextSeconds == null ? committedMinutes : nextSeconds / 60));
              if (nextSeconds == null) {
                cancelValidityReset();
                validityResetTimer.current = window.setTimeout(() => {
                  validityResetTimer.current = null;
                  onValidityChange(label, true);
                }, 0);
              } else {
                onValidityChange(label, true);
                if (nextSeconds !== seconds) onChange(nextSeconds);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
          />
          <b>MIN</b>
        </span>
        <button
          type="button"
          aria-label={`Increase ${label} by 1 minute`}
          disabled={inputValid && parsedMinutes >= maximumMinutes}
          onClick={() => applyMinuteStep(1)}
        >
          <Plus size={20} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function formatCountdown(totalSeconds: number) {
  const seconds = Math.max(0, Math.ceil(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function episodeReady(episode: RecoveryEpisode, now: number) {
  if (episode.state === 'ready' || episode.readyAt != null) return true;
  if (episode.mode === 'timer' || episode.mode === 'smart') {
    return now >= (episode.plannedReadyAt ?? episode.fallbackAt);
  }
  return now >= episode.fallbackAt;
}

export function recoveryAlertDisplay(
  episode: RecoveryEpisode,
  now: number,
  latestHeartRate: Readonly<{ bpm: number; recordedAt: number }> | null,
): RecoveryAlertDisplay {
  if (episodeReady(episode, now)) {
    return {
      ready: true,
      status: 'Ready for next rep',
      detail: 'Recovery target reached — start when you feel ready.',
      remainingSeconds: 0,
    };
  }

  if (episode.mode === 'heart-rate') {
    const freshBpm = latestHeartRate && now - latestHeartRate.recordedAt <= 10_000
      ? Math.round(latestHeartRate.bpm)
      : null;
    return {
      ready: false,
      status: `HR ${freshBpm ?? '—'} · Target ${episode.targetBpm ?? '—'}`,
      detail: freshBpm == null
        ? 'Waiting for a fresh reading from your Watch. The timer backup is still running.'
        : 'TrackLab waits for your target to hold, then alerts you. The next rep never starts automatically.',
      remainingSeconds: Math.max(0, Math.ceil((episode.fallbackAt - now) / 1_000)),
    };
  }

  if (episode.mode === 'smart' && episode.learningEpisodeCount < 6) {
    return {
      ready: false,
      status: 'Smart Recovery · Learning',
      detail: episode.explanation
        || `Learning your private recovery pattern (${episode.learningEpisodeCount} of 6 sessions).`,
      remainingSeconds: Math.max(0, Math.ceil(((episode.plannedReadyAt ?? episode.fallbackAt) - now) / 1_000)),
    };
  }

  const deadline = episode.plannedReadyAt ?? episode.fallbackAt;
  const remainingSeconds = Math.max(0, Math.ceil((deadline - now) / 1_000));
  return {
    ready: false,
    status: episode.mode === 'smart'
      ? `Smart Recovery · ${formatCountdown(remainingSeconds)}`
      : `Recovering · ${formatCountdown(remainingSeconds)}`,
    detail: episode.mode === 'smart'
      ? episode.explanation || 'Based on your private heart-rate recovery and recent sprint performance.'
      : 'Your recovery timer started at your exact finish.',
    remainingSeconds,
  };
}

function modeLabel(mode: RecoveryMode) {
  if (mode === 'heart-rate') return 'Heart Rate';
  if (mode === 'smart') return 'Smart';
  if (mode === 'timer') return 'Timer';
  return 'Off';
}

function modeIcon(mode: RecoveryMode) {
  if (mode === 'heart-rate') return <HeartPulse size={18} aria-hidden="true" />;
  if (mode === 'smart') return <Brain size={18} aria-hidden="true" />;
  if (mode === 'timer') return <Clock3 size={18} aria-hidden="true" />;
  return <Square size={17} aria-hidden="true" />;
}

export function RecoveryAlertCard({
  draft,
  savedPreferences,
  episode,
  latestHeartRate,
  now,
  loading,
  saving,
  actionBusy,
  message,
  nativeAlertsAvailable,
  onDraftChange,
  onSave,
  onAddTime,
  onStartAnyway,
  onStop,
}: RecoveryAlertCardProps) {
  const [invalidDurationInputs, setInvalidDurationInputs] = useState<ReadonlySet<string>>(() => new Set());
  const onDurationInputValidityChange = useCallback((field: string, valid: boolean) => {
    setInvalidDurationInputs((current) => {
      if (current.has(field) === !valid) return current;
      const next = new Set(current);
      if (valid) next.delete(field);
      else next.add(field);
      return next;
    });
  }, []);
  const display = episode ? recoveryAlertDisplay(episode, now, latestHeartRate) : null;
  const preferencesChanged = !savedPreferences
    || draft.mode !== savedPreferences.mode
    || (draft.mode === 'timer' && draft.timerSeconds !== savedPreferences.timerSeconds)
    || (draft.mode === 'heart-rate' && (
      draft.targetBpm !== savedPreferences.targetBpm
      || draft.minimumSeconds !== savedPreferences.minimumSeconds
      || draft.maximumSeconds !== savedPreferences.maximumSeconds
    ))
    || (draft.mode === 'smart' && (
      draft.timerSeconds !== savedPreferences.timerSeconds
      || draft.targetBpm !== savedPreferences.targetBpm
      || draft.minimumSeconds !== savedPreferences.minimumSeconds
      || draft.maximumSeconds !== savedPreferences.maximumSeconds
    ));

  return (
    <section className={`recovery-alert-card${episode ? ' has-active' : ''}${display?.ready ? ' is-ready' : ''}`} aria-label="Recovery Alert">
      <div className="recovery-alert-heading">
        <span className="recovery-alert-icon"><BellRing size={21} aria-hidden="true" /></span>
        <span>
          <strong>Recovery Alert</strong>
          <small>Choose once before training. It starts after each individual finish.</small>
        </span>
        {savedPreferences && (
          <b className={`recovery-alert-mode-badge mode-${savedPreferences.mode}`}>
            {modeLabel(savedPreferences.mode)}
          </b>
        )}
      </div>

      {episode && display ? (
        <div className="recovery-alert-active" aria-live="polite" role="status">
          <div className="recovery-alert-status">
            {display.ready ? <Zap size={22} aria-hidden="true" /> : modeIcon(episode.mode)}
            <span>
              <strong>{display.status}</strong>
              <small>{display.detail}</small>
              {episode.mode === 'smart' && episode.confidence !== 'fixed' && (
                <small className="recovery-alert-confidence">
                  {episode.confidence === 'personalized' ? 'Personalized' : 'Early estimate'} · private to your account
                </small>
              )}
            </span>
          </div>
          <div className="recovery-alert-actions" aria-label="Recovery controls">
            <button type="button" disabled={actionBusy} onClick={onStartAnyway}>Start anyway</button>
            <button type="button" disabled={actionBusy} onClick={onAddTime}>
              <Plus size={16} aria-hidden="true" /> Add 30 seconds
            </button>
            <button className="quiet" type="button" disabled={actionBusy} onClick={onStop}>Stop</button>
          </div>
        </div>
      ) : (
        <div className="recovery-alert-setup" aria-busy={loading || saving}>
          <div className="recovery-alert-mode-options" role="group" aria-label="Recovery Alert type">
            {(['off', 'timer', 'heart-rate', 'smart'] as const).map((mode) => (
              <button
                className={draft.mode === mode ? 'selected' : ''}
                type="button"
                aria-pressed={draft.mode === mode}
                key={mode}
                onClick={() => onDraftChange({
                  ...draft,
                  mode,
                  maximumSeconds: mode === 'smart'
                    ? smartRecoveryBackupSeconds(
                      draft.timerSeconds,
                      draft.maximumSeconds,
                      draft.minimumSeconds,
                    )
                    : draft.maximumSeconds,
                })}
              >
                {modeIcon(mode)} {modeLabel(mode)}
              </button>
            ))}
          </div>

          {draft.mode === 'timer' && (
            <div className="recovery-alert-fields">
              <RecoveryMinutesField
                label="Recovery time"
                seconds={draft.timerSeconds}
                onValidityChange={onDurationInputValidityChange}
                onChange={(timerSeconds) => onDraftChange({ ...draft, timerSeconds })}
              />
            </div>
          )}

          {draft.mode === 'heart-rate' && (
            <div className="recovery-alert-fields">
              <label>
                <span>Recovery target</span>
                <span className="recovery-alert-input-unit">
                  <input
                    aria-label="Recovery target BPM"
                    type="number"
                    inputMode="numeric"
                    min={40}
                    max={220}
                    value={draft.targetBpm}
                    onChange={(event) => onDraftChange({
                      ...draft,
                      targetBpm: clampRecoveryTargetBpm(event.target.value),
                    })}
                  />
                  <b>BPM</b>
                </span>
              </label>
              <RecoveryMinutesField
                label="Timer backup"
                seconds={draft.maximumSeconds}
                fallbackSeconds={600}
                minimumMinutes={recoveryMinutesFromSeconds(draft.minimumSeconds, 60, 10)}
                onValidityChange={onDurationInputValidityChange}
                onChange={(maximumSeconds) => onDraftChange({ ...draft, maximumSeconds })}
              />
              <RecoveryMinutesField
                label="Earliest alert"
                seconds={draft.minimumSeconds}
                fallbackSeconds={60}
                maximumMinutes={10}
                onValidityChange={onDurationInputValidityChange}
                onChange={(minimumSeconds) => onDraftChange({
                  ...draft,
                  minimumSeconds,
                  maximumSeconds: Math.max(draft.maximumSeconds, minimumSeconds),
                })}
              />
              <p className="recovery-alert-explainer">
                <HeartPulse size={17} aria-hidden="true" /> Use a recovery target for this workout, not a medical resting-heart-rate measurement. TrackLab alerts after a fresh Watch reading holds the target for 12 seconds.
              </p>
            </div>
          )}

          {draft.mode === 'smart' && (
            <div className="recovery-alert-fields">
              <RecoveryMinutesField
                label="Starting recovery time"
                seconds={draft.timerSeconds}
                onValidityChange={onDurationInputValidityChange}
                onChange={(timerSeconds) => onDraftChange({
                  ...draft,
                  timerSeconds,
                  maximumSeconds: smartRecoveryBackupSeconds(
                    timerSeconds,
                    draft.maximumSeconds,
                    draft.minimumSeconds,
                  ),
                })}
              />
              <label>
                <span>Ready heart rate</span>
                <span className="recovery-alert-input-unit">
                  <input
                    aria-label="Smart Recovery ready heart rate BPM"
                    type="number"
                    inputMode="numeric"
                    min={40}
                    max={220}
                    value={draft.targetBpm}
                    onChange={(event) => onDraftChange({
                      ...draft,
                      targetBpm: clampRecoveryTargetBpm(event.target.value),
                    })}
                  />
                  <b>BPM</b>
                </span>
              </label>
              <RecoveryMinutesField
                label="Earliest alert"
                seconds={draft.minimumSeconds}
                fallbackSeconds={60}
                maximumMinutes={10}
                onValidityChange={onDurationInputValidityChange}
                onChange={(minimumSeconds) => onDraftChange({
                  ...draft,
                  minimumSeconds,
                  maximumSeconds: smartRecoveryBackupSeconds(
                    draft.timerSeconds,
                    draft.maximumSeconds,
                    minimumSeconds,
                  ),
                })}
              />
              <RecoveryMinutesField
                label="Timer backup"
                seconds={draft.maximumSeconds}
                fallbackSeconds={600}
                minimumMinutes={Math.max(
                  recoveryMinutesFromSeconds(draft.timerSeconds),
                  recoveryMinutesFromSeconds(draft.minimumSeconds, 60, 10),
                )}
                onValidityChange={onDurationInputValidityChange}
                onChange={(maximumSeconds) => onDraftChange({ ...draft, maximumSeconds })}
              />
              <p className="recovery-alert-explainer">
                <Brain size={17} aria-hidden="true" /> Starts with your chosen recovery time, then learns from your private heart-rate recovery and sprint performance. Use a recovery target, not a medical resting-heart-rate measurement; TrackLab does not claim to measure breathing.
              </p>
            </div>
          )}

          <div className="recovery-alert-save-row">
            <p><ShieldCheck size={16} aria-hidden="true" /> Alerts never start the next rep for you.</p>
            <button
              className="primary"
              type="button"
              disabled={loading || saving || !preferencesChanged || invalidDurationInputs.size > 0}
              onClick={onSave}
            >
              {saving ? 'Saving…' : draft.mode === 'off' ? 'Save Off' : 'Save Recovery Alert'}
            </button>
          </div>
        </div>
      )}

      {nativeAlertsAvailable === false && draft.mode !== 'off' && (
        <p className="recovery-alert-upgrade-note" role="note">
          Install the latest TrackLab build for background Apple notifications and Watch taps. The in-app alert still works here.
        </p>
      )}
      {message && <p className="recovery-alert-message" role="status">{message}</p>}
    </section>
  );
}

export default RecoveryAlertCard;
