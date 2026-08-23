import {
  BellRing,
  Brain,
  Clock3,
  HeartPulse,
  Plus,
  ShieldCheck,
  Square,
  Zap,
} from 'lucide-react';
import type { RecoveryAlertPreference, RecoveryEpisode, RecoveryMode } from '../lib/recoveryAlert';

export const recoveryTimerPresetsSeconds = [60, 120, 180, 300] as const;
export const smartRecoveryBackupPresetsSeconds = [300, 600, 900, 1800] as const;

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

export function clampRecoverySeconds(value: unknown, fallback = 120) {
  return Math.max(30, Math.min(30 * 60, Math.round(finiteNumber(value, fallback))));
}

export function clampRecoveryTargetBpm(value: unknown, fallback = 115) {
  return Math.max(40, Math.min(220, Math.round(finiteNumber(value, fallback))));
}

export function smartRecoveryBackupSeconds(timerSeconds: number, currentBackupSeconds: number) {
  const minimum = Math.max(
    clampRecoverySeconds(timerSeconds),
    clampRecoverySeconds(currentBackupSeconds, 600),
  );
  return smartRecoveryBackupPresetsSeconds.find((seconds) => seconds >= minimum) ?? 1800;
}

export function recoveryDraftFromPreferences(
  preferences: RecoveryAlertPreference | null,
): RecoveryAlertDraft {
  const mode = preferences?.mode ?? 'off';
  const timerSeconds = clampRecoverySeconds(preferences?.timerSeconds, 120);
  const maximumSeconds = clampRecoverySeconds(preferences?.maximumSeconds, 600);
  return {
    mode,
    timerSeconds,
    targetBpm: clampRecoveryTargetBpm(preferences?.targetBpm, 115),
    minimumSeconds: clampRecoverySeconds(preferences?.minimumSeconds, 30),
    maximumSeconds: mode === 'smart'
      ? smartRecoveryBackupSeconds(timerSeconds, maximumSeconds)
      : maximumSeconds,
  };
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
  const display = episode ? recoveryAlertDisplay(episode, now, latestHeartRate) : null;
  const timerPreset = recoveryTimerPresetsSeconds.includes(
    draft.timerSeconds as (typeof recoveryTimerPresetsSeconds)[number],
  ) ? draft.timerSeconds : 'custom';
  const preferencesChanged = !savedPreferences
    || draft.mode !== savedPreferences.mode
    || draft.timerSeconds !== savedPreferences.timerSeconds
    || draft.targetBpm !== savedPreferences.targetBpm
    || draft.minimumSeconds !== savedPreferences.minimumSeconds
    || draft.maximumSeconds !== savedPreferences.maximumSeconds;

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
                    ? smartRecoveryBackupSeconds(draft.timerSeconds, draft.maximumSeconds)
                    : draft.maximumSeconds,
                })}
              >
                {modeIcon(mode)} {modeLabel(mode)}
              </button>
            ))}
          </div>

          {draft.mode === 'timer' && (
            <div className="recovery-alert-fields">
              <label>
                <span>Recovery time</span>
                <select
                  value={timerPreset}
                  onChange={(event) => {
                    if (event.target.value === 'custom') {
                      onDraftChange({ ...draft, timerSeconds: 90 });
                      return;
                    }
                    onDraftChange({ ...draft, timerSeconds: clampRecoverySeconds(event.target.value) });
                  }}
                >
                  <option value={60}>1 minute</option>
                  <option value={120}>2 minutes</option>
                  <option value={180}>3 minutes</option>
                  <option value={300}>5 minutes</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              {timerPreset === 'custom' && (
                <label>
                  <span>Custom seconds</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={30}
                    max={1800}
                    step={15}
                    value={draft.timerSeconds}
                    onChange={(event) => onDraftChange({
                      ...draft,
                      timerSeconds: clampRecoverySeconds(event.target.value),
                    })}
                  />
                </label>
              )}
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
              <label>
                <span>Timer backup</span>
                <select
                  value={draft.maximumSeconds}
                  onChange={(event) => onDraftChange({
                    ...draft,
                    maximumSeconds: clampRecoverySeconds(event.target.value, 600),
                  })}
                >
                  <option value={120}>2 minutes</option>
                  <option value={180}>3 minutes</option>
                  <option value={300}>5 minutes</option>
                  <option value={600}>10 minutes</option>
                  <option value={900}>15 minutes</option>
                </select>
              </label>
              <label>
                <span>Earliest alert</span>
                <select
                  value={draft.minimumSeconds}
                  onChange={(event) => onDraftChange({
                    ...draft,
                    minimumSeconds: clampRecoverySeconds(event.target.value, 30),
                  })}
                >
                  <option value={30}>30 seconds</option>
                  <option value={60}>1 minute</option>
                  <option value={120}>2 minutes</option>
                </select>
              </label>
              <p className="recovery-alert-explainer">
                <HeartPulse size={17} aria-hidden="true" /> Use a recovery target for this workout, not a medical resting-heart-rate measurement. TrackLab alerts after a fresh Watch reading holds the target for 12 seconds.
              </p>
            </div>
          )}

          {draft.mode === 'smart' && (
            <div className="recovery-alert-fields">
              <label>
                <span>Starting recovery time</span>
                <select
                  value={timerPreset}
                  onChange={(event) => {
                    if (event.target.value === 'custom') {
                      onDraftChange({
                        ...draft,
                        timerSeconds: 90,
                        maximumSeconds: smartRecoveryBackupSeconds(90, draft.maximumSeconds),
                      });
                      return;
                    }
                    const timerSeconds = clampRecoverySeconds(event.target.value);
                    onDraftChange({
                      ...draft,
                      timerSeconds,
                      maximumSeconds: smartRecoveryBackupSeconds(timerSeconds, draft.maximumSeconds),
                    });
                  }}
                >
                  <option value={60}>1 minute</option>
                  <option value={120}>2 minutes</option>
                  <option value={180}>3 minutes</option>
                  <option value={300}>5 minutes</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              {timerPreset === 'custom' && (
                <label>
                  <span>Custom seconds</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={30}
                    max={1800}
                    step={15}
                    value={draft.timerSeconds}
                    onChange={(event) => {
                      const timerSeconds = clampRecoverySeconds(event.target.value);
                      onDraftChange({
                        ...draft,
                        timerSeconds,
                        maximumSeconds: smartRecoveryBackupSeconds(timerSeconds, draft.maximumSeconds),
                      });
                    }}
                  />
                </label>
              )}
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
              <label>
                <span>Earliest alert</span>
                <select
                  value={draft.minimumSeconds}
                  onChange={(event) => onDraftChange({
                    ...draft,
                    minimumSeconds: clampRecoverySeconds(event.target.value, 30),
                  })}
                >
                  <option value={30}>30 seconds</option>
                  <option value={60}>1 minute</option>
                  <option value={120}>2 minutes</option>
                </select>
              </label>
              <label>
                <span>Timer backup</span>
                <select
                  value={draft.maximumSeconds}
                  onChange={(event) => onDraftChange({
                    ...draft,
                    maximumSeconds: clampRecoverySeconds(event.target.value, 600),
                  })}
                >
                  {smartRecoveryBackupPresetsSeconds.map((seconds) => (
                    <option key={seconds} value={seconds} disabled={seconds < draft.timerSeconds}>
                      {seconds / 60} minutes
                    </option>
                  ))}
                </select>
              </label>
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
              disabled={loading || saving || !preferencesChanged}
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
