import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Bike, Gauge, HeartPulse, Minimize2, RadioTower, Signal, Zap } from 'lucide-react';
import { liveBikeTimeoutMs } from '../data';
import { bmxSpeedKphFromCadence } from '../game/bmxRollout';
import { wattbikeMonitorLastThree } from '../lib/bikeProfileIdentity';
import { formatSpeedFromKph, speedUnitLabel } from '../units';
import type { BikeSample, PlayerSlot, SpeedUnit } from '../types';
import { PullSledScene } from './PullSledScene';
import { heartRateReadingState } from './HeartRateMetric';
import type { LiveHeartRateByPlayer } from './RaceRiderOverlay';
import './MonitorView.css';

type MonitorViewProps = {
  players: PlayerSlot[];
  samplesByDevice: Map<number, BikeSample>;
  speedUnit: SpeedUnit;
  fullscreen?: boolean;
  onFullscreenChange?: (enabled: boolean) => void;
  heartRateByPlayer?: LiveHeartRateByPlayer;
  historyStatusByPlayer?: Partial<Record<PlayerSlot['id'], MonitorSprintHistoryStatus>>;
  studioHeartRateByPlayer?: Partial<Record<PlayerSlot['id'], MonitorStudioHeartRateControl>>;
  onStudioHeartRateOpen?: (player: PlayerSlot) => void;
  onSprintArm?: (arm: MonitorSprintArm) => void;
  onSprintArmCancel?: (cancellation: MonitorSprintArmCancellation) => void;
  onSprintStart?: (session: MonitorSprintSession) => void;
  onSprintCancel?: (cancellation: MonitorSprintCancellation) => void;
  onSprintComplete?: (result: MonitorSprintCompleteResult) => void;
};

export type MonitorStudioHeartRateControl = Readonly<{
  phase: 'disconnected' | 'inviting' | 'waiting-athlete' | 'waiting-watch' | 'watch-ready' | 'error';
  disabled?: boolean;
}>;

export type MonitorSprintHistoryStatus = Readonly<{
  state: 'authorizing' | 'saving' | 'saved' | 'error';
  label: string;
  detail?: string;
}>;

export type MonitorSprintArm = {
  id: string;
  playerId: PlayerSlot['id'];
  riderId?: string;
  riderName: string;
  deviceId: number;
  armedAt: number;
};

export type MonitorSprintArmCancellation = MonitorSprintArm & {
  reason: 'assignment-changed' | 'bike-disconnected' | 'expired' | 'view-closed';
};

export type MonitorSprintSession = MonitorSprintArm & {
  startedAt: number;
};

export type MonitorSprintCancellation = MonitorSprintSession & {
  endedAt: number;
  reason: 'insufficient-samples' | 'assignment-changed' | 'bike-disconnected' | 'view-closed';
};

export type MonitorSprintCompleteResult = MonitorSprintSession & {
  endedAt: number;
  durationMs: number;
  distanceMeters: number;
  averageWatts: number;
  peakWatts: number;
  averageCadence: number;
  peakCadence: number;
  averageSpeedKph: number;
  peakSpeedKph: number;
};

type MonitorMetrics = {
  live: boolean;
  watts: number;
  cadence: number;
  speedKph: number;
};

// Elite BMX cadence can be exceptionally high, but a Wattbike flywheel packet in
// the thousands is not a rider measurement. Keep generous headroom above the
// expected human range while rejecting the post-sprint runaway values outright.
export const monitorMaximumCadenceRpm = 320;
// Rotate an unused arm before the server's 15-minute reservation expires, so a
// rider can never begin against a stale one-use authorization.
export const monitorSprintArmLifetimeMs = 10 * 60 * 1000;
const monitorTravelSeconds = 6;

const monitorWallStyles = `
.monitor-panel.monitor-wall{box-sizing:border-box;display:flex;flex-direction:column;height:100dvh;min-height:0;overflow:hidden;padding:10px}
.monitor-wall .monitor-header{flex:0 0 auto;margin-bottom:8px}
.monitor-wall .monitor-header h2{font-size:20px}
.monitor-wall .monitor-header p{font-size:12px}
.monitor-wall .monitor-grid{display:grid!important;flex:1;min-height:0;gap:8px}
.monitor-wall .monitor-grid[data-bike-count="1"]{grid-template-columns:minmax(0,1fr)!important;grid-template-rows:minmax(0,1fr)}
.monitor-wall .monitor-grid[data-bike-count="2"]{grid-template-columns:repeat(2,minmax(0,1fr))!important;grid-template-rows:minmax(0,1fr)}
.monitor-wall .monitor-grid[data-bike-count="3"]{grid-template-columns:repeat(3,minmax(0,1fr))!important;grid-template-rows:minmax(0,1fr)}
.monitor-wall .monitor-grid[data-bike-count="4"]{grid-template-columns:repeat(2,minmax(0,1fr))!important;grid-template-rows:repeat(2,minmax(0,1fr))}
.monitor-wall .monitor-card{grid-template-areas:"head head" "scene scene" "primary secondary" "result result";grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:auto minmax(82px,1fr) auto auto;min-height:0;overflow:hidden;gap:7px;padding:9px}
.monitor-wall .monitor-card-head{grid-area:head;min-height:0}
.monitor-wall .monitor-card>.pull-sled-scene{grid-area:scene;height:100%!important;min-height:82px!important;border-radius:10px!important}
.monitor-wall .monitor-grid[data-bike-count="4"] .pull-sled-scene [data-pull-scenery="fixed-track"]{background-position:center 68%!important}
.monitor-wall .monitor-grid[data-bike-count="4"] .pull-sled-scene [data-finish-line="pull"]{top:55%!important;height:45%!important}
.monitor-wall .monitor-primary{grid-area:primary}
.monitor-wall .monitor-secondary{grid-area:secondary}
.monitor-wall .monitor-primary,.monitor-wall .monitor-secondary{gap:5px}
.monitor-wall .monitor-primary div,.monitor-wall .monitor-secondary div{min-height:48px;gap:4px;padding:5px}
.monitor-wall .monitor-primary span{font-size:clamp(20px,2.6vw,38px)}
.monitor-wall .monitor-secondary span{font-size:clamp(13px,1.7vw,22px)}
.monitor-wall .monitor-primary svg,.monitor-wall .monitor-secondary svg{width:17px;height:17px}
.monitor-wall .monitor-card-actions{gap:3px}
.monitor-wall .monitor-watch-button{min-height:23px;padding:3px 7px;font-size:8px}
.monitor-wall .monitor-sprint-result{grid-area:result;min-height:58px;gap:5px;padding:6px}
.monitor-wall .monitor-sprint-grid{gap:5px}
.monitor-wall .monitor-sprint-grid div{min-height:34px;padding:4px}
.monitor-wall .monitor-sprint-grid span{font-size:18px}
.monitor-wall .monitor-sprint-grid small{font-size:8px}
.monitor-wall .monitor-sprint-head strong,.monitor-wall .monitor-sprint-head span{font-size:10px}
.monitor-wall .monitor-grid[data-bike-count="3"] .monitor-card,.monitor-wall .monitor-grid[data-bike-count="4"] .monitor-card{gap:5px;padding:7px}
.monitor-wall .monitor-grid[data-bike-count="3"] .monitor-card-head small,.monitor-wall .monitor-grid[data-bike-count="4"] .monitor-card-head small{font-size:9px}
.monitor-wall .monitor-grid[data-bike-count="3"] .monitor-secondary span,.monitor-wall .monitor-grid[data-bike-count="4"] .monitor-secondary span{font-size:11px}
.monitor-wall .monitor-grid[data-bike-count="3"] .monitor-watch-button span,.monitor-wall .monitor-grid[data-bike-count="4"] .monitor-watch-button span{display:none}
.monitor-wall .monitor-grid[data-bike-count="3"] .monitor-watch-button,.monitor-wall .monitor-grid[data-bike-count="4"] .monitor-watch-button{width:24px;padding:3px}
@media(max-height:700px){.monitor-wall .monitor-header p{display:none}.monitor-wall .monitor-card{grid-template-rows:auto minmax(72px,1fr) auto auto}.monitor-wall .monitor-card>.pull-sled-scene{min-height:72px!important}.monitor-wall .monitor-primary div,.monitor-wall .monitor-secondary div{min-height:42px}.monitor-wall .monitor-sprint-result{min-height:50px}}
`;

type MonitorSprintDraft = {
  session: MonitorSprintSession;
  id: string;
  deviceId: number;
  startedAt: number;
  lastActiveAt: number;
  peakWatts: number;
  wattsTotal: number;
  wattsSampleCount: number;
  averageWatts: number;
  peakCadence: number;
  cadenceTotal: number;
  cadenceSampleCount: number;
  averageCadence: number;
  peakSpeedKph: number;
  distanceMeters: number;
  sampleCount: number;
};

type MonitorSprintResult = MonitorSprintDraft & {
  endedAt: number | null;
  status: 'capturing' | 'complete';
};

function formatAge(sample: BikeSample | undefined, now = Date.now()) {
  if (!sample) {
    return 'No data';
  }

  const seconds = Math.max(0, Math.round((now - sample.at) / 1000));
  return seconds <= 1 ? 'Live now' : `${seconds}s ago`;
}

function metricIsFresh(sample: BikeSample | undefined, metricAt: number | undefined, now = Date.now()) {
  if (!sample) {
    return false;
  }

  return now - (metricAt ?? sample.at) <= liveBikeTimeoutMs;
}

export function monitorMetrics(sample: BikeSample | undefined, now = Date.now()): MonitorMetrics {
  const wattsFresh = metricIsFresh(sample, sample?.wattsAt, now);
  const cadenceFresh = metricIsFresh(sample, sample?.cadenceAt, now);
  const watts = wattsFresh ? sample?.watts ?? 0 : 0;
  const rawCadence = cadenceFresh ? sample?.cadence ?? 0 : 0;
  const cadenceIsPlausible = Number.isFinite(rawCadence)
    && rawCadence >= 0
    && rawCadence <= monitorMaximumCadenceRpm;
  const cadence = cadenceIsPlausible ? rawCadence : 0;
  const bmxSpeedKph = bmxSpeedKphFromCadence(cadence);
  const idleNoise = watts < 1 && cadence <= 15;

  if (!cadenceIsPlausible) {
    return {
      live: metricIsFresh(sample, sample?.at, now),
      watts: 0,
      cadence: 0,
      speedKph: 0,
    };
  }

  return {
    live: metricIsFresh(sample, sample?.at, now),
    watts: idleNoise ? 0 : watts,
    cadence: idleNoise ? 0 : cadence,
    speedKph: idleNoise ? 0 : bmxSpeedKph,
  };
}

export function monitorSprintShouldCapture(metrics: MonitorMetrics) {
  return metrics.watts >= 1;
}

function resultFromDraft(draft: MonitorSprintDraft, status: MonitorSprintResult['status'], endedAt: number | null): MonitorSprintResult {
  return {
    ...draft,
    endedAt,
    status,
  };
}

function sprintDurationSeconds(result: MonitorSprintResult, now: number) {
  const end = result.endedAt ?? now;
  return Math.max(0, (end - result.startedAt) / 1000);
}

function defaultMonitorSprintNonce() {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

/**
 * Allocates the exact sprint identity while the rider is still idle. `armedAt`
 * is deliberately separate from `startedAt`: the session clock remains tied to
 * the first fresh Wattbike sample at or above one watt.
 */
export function createMonitorSprintArm(
  player: PlayerSlot,
  armedAt = Date.now(),
  createNonce: () => string = defaultMonitorSprintNonce,
): MonitorSprintArm | null {
  if (player.deviceId == null || !Number.isSafeInteger(armedAt) || armedAt < 0) return null;
  const nonce = createNonce().trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/u.test(nonce)) return null;
  return {
    id: `monitor-sprint:${nonce}`,
    playerId: player.id,
    ...(player.riderId ? { riderId: player.riderId } : {}),
    riderName: player.name,
    deviceId: player.deviceId,
    armedAt,
  };
}

export function monitorSprintArmMatchesPlayer(arm: MonitorSprintArm, player: PlayerSlot) {
  return arm.playerId === player.id
    && arm.deviceId === player.deviceId
    && (arm.riderId ?? null) === (player.riderId ?? null)
    && arm.riderName === player.name;
}

export function monitorSprintArmIsExpired(arm: MonitorSprintArm, now = Date.now()) {
  return now - arm.armedAt >= monitorSprintArmLifetimeMs;
}

export function monitorSprintSessionFromArm(
  arm: MonitorSprintArm,
  startedAt: number,
): MonitorSprintSession | null {
  if (!Number.isSafeInteger(startedAt) || startedAt < arm.armedAt) return null;
  return { ...arm, startedAt };
}

export function MonitorView({
  players,
  samplesByDevice,
  speedUnit,
  fullscreen = false,
  onFullscreenChange,
  heartRateByPlayer = {},
  historyStatusByPlayer = {},
  studioHeartRateByPlayer = {},
  onStudioHeartRateOpen,
  onSprintArm,
  onSprintArmCancel,
  onSprintStart,
  onSprintCancel,
  onSprintComplete,
}: MonitorViewProps) {
  const armedSprintsRef = useRef<Map<number, MonitorSprintArm>>(new Map());
  const activeSprintsRef = useRef<Map<number, MonitorSprintDraft>>(new Map());
  const onSprintArmCancelRef = useRef(onSprintArmCancel);
  const onSprintCancelRef = useRef(onSprintCancel);
  const [sprintResults, setSprintResults] = useState<Record<number, MonitorSprintResult>>({});
  const [now, setNow] = useState(Date.now());
  const connectedPlayers = useMemo(
    () => players.filter((player) => player.deviceId != null),
    [players],
  );

  useEffect(() => {
    onSprintArmCancelRef.current = onSprintArmCancel;
  }, [onSprintArmCancel]);

  useEffect(() => {
    onSprintCancelRef.current = onSprintCancel;
  }, [onSprintCancel]);

  useEffect(() => () => {
    armedSprintsRef.current.forEach((arm) => {
      onSprintArmCancelRef.current?.({ ...arm, reason: 'view-closed' });
    });
    armedSprintsRef.current.clear();
    activeSprintsRef.current.forEach((draft) => {
      onSprintCancelRef.current?.({
        ...draft.session,
        endedAt: draft.lastActiveAt,
        reason: 'view-closed',
      });
    });
    activeSprintsRef.current.clear();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const connectedDevices = new Set(connectedPlayers
      .map((player) => player.deviceId)
      .filter((deviceId): deviceId is number => deviceId != null));
    const updates = new Map<number, MonitorSprintResult | null>();

    armedSprintsRef.current.forEach((arm, deviceId) => {
      if (activeSprintsRef.current.has(deviceId)) return;
      const player = connectedPlayers.find((candidate) => candidate.deviceId === deviceId);
      const expired = monitorSprintArmIsExpired(arm, now);
      if (player && monitorSprintArmMatchesPlayer(arm, player) && !expired) return;
      armedSprintsRef.current.delete(deviceId);
      onSprintArmCancel?.({
        ...arm,
        reason: !player ? 'bike-disconnected' : expired ? 'expired' : 'assignment-changed',
      });
    });

    connectedPlayers.forEach((player) => {
      if (
        player.deviceId == null
        || activeSprintsRef.current.has(player.deviceId)
        || armedSprintsRef.current.has(player.deviceId)
      ) return;
      const arm = createMonitorSprintArm(player, now);
      if (!arm) return;
      armedSprintsRef.current.set(player.deviceId, arm);
      onSprintArm?.(arm);
    });

    connectedPlayers.forEach((player) => {
      if (player.deviceId == null) {
        return;
      }

      const sample = samplesByDevice.get(player.deviceId);
      const metrics = monitorMetrics(sample, now);
      const active = monitorSprintShouldCapture(metrics);
      let existing = activeSprintsRef.current.get(player.deviceId);

      if (existing && !monitorSprintArmMatchesPlayer(existing.session, player)) {
        activeSprintsRef.current.delete(player.deviceId);
        updates.set(player.deviceId, null);
        onSprintCancel?.({
          ...existing.session,
          endedAt: existing.lastActiveAt,
          reason: 'assignment-changed',
        });
        return;
      }

      if (active) {
        const sampleAt = sample?.at ?? now;
        if (existing && sampleAt <= existing.lastActiveAt) {
          updates.set(player.deviceId, resultFromDraft(existing, 'capturing', null));
          return;
        }
        const cadenceValue = Math.max(0, metrics.cadence);
        const hasCadenceSample = cadenceValue > 0;
        const cadenceTotal = (existing?.cadenceTotal ?? 0) + (hasCadenceSample ? cadenceValue : 0);
        const cadenceSampleCount = (existing?.cadenceSampleCount ?? 0) + (hasCadenceSample ? 1 : 0);
        const wattsValue = Math.max(0, metrics.watts);
        const wattsTotal = (existing?.wattsTotal ?? 0) + wattsValue;
        const wattsSampleCount = (existing?.wattsSampleCount ?? 0) + 1;
        const deltaSeconds = existing
          ? Math.max(0, Math.min(2, (sampleAt - existing.lastActiveAt) / 1_000))
          : 0;
        const arm = existing?.session
          ?? armedSprintsRef.current.get(player.deviceId)
          ?? createMonitorSprintArm(player, now);
        const session = existing?.session
          ?? (arm ? monitorSprintSessionFromArm(arm, sampleAt) : null);
        if (!session) return;
        if (!existing) armedSprintsRef.current.delete(player.deviceId);
        const nextDraft: MonitorSprintDraft = {
          session,
          id: session.id,
          deviceId: player.deviceId,
          startedAt: session.startedAt,
          lastActiveAt: sampleAt,
          peakWatts: Math.max(existing?.peakWatts ?? 0, metrics.watts),
          wattsTotal,
          wattsSampleCount,
          averageWatts: wattsSampleCount > 0 ? Math.round(wattsTotal / wattsSampleCount) : 0,
          peakCadence: Math.max(existing?.peakCadence ?? 0, metrics.cadence),
          cadenceTotal,
          cadenceSampleCount,
          averageCadence: cadenceSampleCount > 0 ? Math.round(cadenceTotal / cadenceSampleCount) : 0,
          peakSpeedKph: Math.max(existing?.peakSpeedKph ?? 0, metrics.speedKph),
          distanceMeters: (existing?.distanceMeters ?? 0) + metrics.speedKph / 3.6 * deltaSeconds,
          sampleCount: (existing?.sampleCount ?? 0) + 1,
        };
        activeSprintsRef.current.set(player.deviceId, nextDraft);
        updates.set(player.deviceId, resultFromDraft(nextDraft, 'capturing', null));
        if (!existing) {
          onSprintStart?.(session);
        }
        return;
      }

      if (existing) {
        const idleMs = now - existing.lastActiveAt;
        if (idleMs >= 1200 || !metrics.live) {
          activeSprintsRef.current.delete(player.deviceId);
          if (existing.sampleCount >= 2) {
            updates.set(player.deviceId, resultFromDraft(existing, 'complete', existing.lastActiveAt));
            const durationMs = Math.max(0, existing.lastActiveAt - existing.startedAt);
            onSprintComplete?.({
              ...existing.session,
              endedAt: existing.lastActiveAt,
              durationMs,
              distanceMeters: existing.distanceMeters,
              averageWatts: existing.averageWatts,
              peakWatts: existing.peakWatts,
              averageCadence: existing.averageCadence,
              peakCadence: existing.peakCadence,
              averageSpeedKph: durationMs > 0 ? existing.distanceMeters / (durationMs / 1_000) * 3.6 : 0,
              peakSpeedKph: existing.peakSpeedKph,
            });
          } else {
            updates.set(player.deviceId, null);
            onSprintCancel?.({
              ...existing.session,
              endedAt: existing.lastActiveAt,
              reason: 'insufficient-samples',
            });
          }
        } else {
          updates.set(player.deviceId, resultFromDraft(existing, 'capturing', null));
        }
      }
    });

    activeSprintsRef.current.forEach((draft, deviceId) => {
      if (!connectedDevices.has(deviceId)) {
        activeSprintsRef.current.delete(deviceId);
        if (draft.sampleCount >= 2) {
          updates.set(deviceId, resultFromDraft(draft, 'complete', draft.lastActiveAt));
          const durationMs = Math.max(0, draft.lastActiveAt - draft.startedAt);
          onSprintComplete?.({
            ...draft.session,
            endedAt: draft.lastActiveAt,
            durationMs,
            distanceMeters: draft.distanceMeters,
            averageWatts: draft.averageWatts,
            peakWatts: draft.peakWatts,
            averageCadence: draft.averageCadence,
            peakCadence: draft.peakCadence,
            averageSpeedKph: durationMs > 0 ? draft.distanceMeters / (durationMs / 1_000) * 3.6 : 0,
            peakSpeedKph: draft.peakSpeedKph,
          });
        } else {
          updates.set(deviceId, null);
          onSprintCancel?.({
            ...draft.session,
            endedAt: draft.lastActiveAt,
            reason: 'bike-disconnected',
          });
        }
      }
    });

    if (updates.size === 0) {
      return;
    }

    setSprintResults((current) => {
      let changed = false;
      const next = { ...current };
      updates.forEach((result, deviceId) => {
        if (!result) {
          if (next[deviceId]) {
            delete next[deviceId];
            changed = true;
          }
          return;
        }

        const currentResult = next[deviceId];
        if (
          !currentResult
          || currentResult.status !== result.status
          || currentResult.peakWatts !== result.peakWatts
          || currentResult.peakCadence !== result.peakCadence
          || currentResult.averageCadence !== result.averageCadence
          || currentResult.endedAt !== result.endedAt
        ) {
          next[deviceId] = result;
          changed = true;
        }
      });

      return changed ? next : current;
    });
  }, [
    connectedPlayers,
    now,
    onSprintArm,
    onSprintArmCancel,
    onSprintCancel,
    onSprintComplete,
    onSprintStart,
    samplesByDevice,
  ]);

  return (
    <main className="monitor-panel monitor-wall">
      <style>{monitorWallStyles}</style>
      <div className="monitor-header">
        <div>
          <h2>Monitor View</h2>
          <p>Large-format live readout for connected Wattbike Model B monitors.</p>
        </div>
        <div className="monitor-count">
          <Bike size={18} />
          <span>{connectedPlayers.length} connected</span>
          {fullscreen && (
            <button type="button" onClick={() => onFullscreenChange?.(false)}>
              <Minimize2 size={17} /> Exit full screen
            </button>
          )}
        </div>
      </div>

      {connectedPlayers.length === 0 ? (
        <div className="monitor-empty">
          <RadioTower size={22} />
          <span>No connected bikes detected yet.</span>
        </div>
      ) : (
        <div
          className="monitor-grid"
          data-bike-count={Math.min(4, connectedPlayers.length)}
          data-monitor-layout={`${Math.min(4, connectedPlayers.length)}-way`}
        >
          {connectedPlayers.map((player) => {
            const sample = player.deviceId == null ? undefined : samplesByDevice.get(player.deviceId);
            const metrics = monitorMetrics(sample, now);
            const sprintResult = player.deviceId == null ? undefined : sprintResults[player.deviceId];
            const deviceLabel = player.deviceLabel ?? sample?.label ?? 'Wattbike monitor';
            const monitorId = player.deviceId == null
              ? null
              : wattbikeMonitorLastThree(deviceLabel, player.deviceId);
            const sprintProgress = sprintResult?.status === 'complete'
              ? 1
              : sprintResult
                ? Math.min(1, sprintDurationSeconds(sprintResult, now) / monitorTravelSeconds)
                : 0;
            const heartRate = heartRateReadingState(
              heartRateByPlayer[player.id]?.bpm,
              heartRateByPlayer[player.id]?.recordedAt,
              now,
            );
            const historyStatus = historyStatusByPlayer[player.id];
            const studioHeartRate = studioHeartRateByPlayer[player.id];
            const studioHeartRateLabel = studioHeartRate?.phase === 'watch-ready'
              ? 'Watch ready'
              : studioHeartRate?.phase === 'waiting-watch'
                ? 'Waiting for Watch'
                : studioHeartRate?.phase === 'waiting-athlete'
                  ? 'Watch invite'
                  : studioHeartRate?.phase === 'inviting'
                    ? 'Connecting Watch'
                    : studioHeartRate?.phase === 'error'
                      ? 'Watch setup'
                      : 'Add Watch';

            return (
              <section
                className={`monitor-card ${metrics.live ? 'live' : 'idle'}`}
                style={{ '--player-color': player.accent } as React.CSSProperties}
                key={player.id}
              >
                <div className="monitor-card-head">
                  <span className="player-chip" style={{ '--player-color': player.accent } as React.CSSProperties}>
                    P{player.id}
                  </span>
                  <div>
                    <h3>{player.name}</h3>
                    <p className="monitor-bike-id">{monitorId ? `Monitor ID ${monitorId}` : 'Unassigned'}</p>
                    <small>{deviceLabel}</small>
                  </div>
                  <div className="monitor-card-actions">
                    {studioHeartRate && onStudioHeartRateOpen && (
                      <button
                        aria-label={`Open Apple Watch setup for ${player.name}`}
                        className={`monitor-watch-button ${studioHeartRate.phase}`}
                        disabled={studioHeartRate.disabled}
                        onClick={() => onStudioHeartRateOpen(player)}
                        type="button"
                      >
                        <HeartPulse aria-hidden="true" size={14} />
                        <span>{studioHeartRateLabel}</span>
                      </button>
                    )}
                    <span className="monitor-live">
                      <Signal size={15} />
                      {metrics.live && sample ? `${Math.round(sample.signal * 100)}%` : 'Idle'}
                    </span>
                  </div>
                </div>

                <PullSledScene
                  active={monitorSprintShouldCapture(metrics)}
                  cadenceRpm={metrics.cadence}
                  compact={connectedPlayers.length === 4}
                  durationSeconds={monitorSprintShouldCapture(metrics) ? monitorTravelSeconds : undefined}
                  label={`${player.name} pulling the TrackLab sled`}
                  progress={sprintProgress}
                  speedKph={metrics.speedKph}
                />

                <div className="monitor-primary">
                  <div>
                    <Activity size={24} />
                    <span>{metrics.cadence}</span>
                    <small>rpm</small>
                  </div>
                  <div>
                    <Zap size={24} />
                    <span>{metrics.watts}</span>
                    <small>watts</small>
                  </div>
                </div>

                <div className="monitor-secondary">
                  <div>
                    <Gauge size={18} />
                    <span>{formatSpeedFromKph(metrics.speedKph, speedUnit)}</span>
                    <small>{speedUnitLabel(speedUnit)}</small>
                  </div>
                  <div>
                    <RadioTower size={18} />
                    <span>{sample?.source.toUpperCase() ?? '--'}</span>
                    <small>{formatAge(sample, now)}</small>
                  </div>
                  <div className={`monitor-heart-rate ${heartRate.state}`}>
                    <HeartPulse size={18} />
                    <span>{heartRate.bpm ?? '—'}</span>
                    <small>{heartRate.bpm == null ? heartRate.detail : 'Heart BPM'}</small>
                  </div>
                </div>

                <div className={`monitor-sprint-result ${sprintResult ? sprintResult.status : 'empty'}`}>
                  {sprintResult ? (
                    <>
                      <div className="monitor-sprint-head">
                        <strong>{sprintResult.status === 'capturing' ? 'Capturing sprint' : 'Last sprint result'}</strong>
                        <span
                          className={historyStatus ? `monitor-history-status ${historyStatus.state}` : undefined}
                          role={historyStatus ? 'status' : undefined}
                          title={historyStatus?.detail}
                        >
                          {sprintDurationSeconds(sprintResult, now).toFixed(1)}s
                          {historyStatus ? ` · ${historyStatus.label}` : ''}
                        </span>
                      </div>
                      <div className="monitor-sprint-grid">
                        <div>
                          <span>{sprintResult.peakCadence}</span>
                          <small>Cadence pk</small>
                        </div>
                        <div>
                          <span>{sprintResult.averageCadence}</span>
                          <small>Cadence avg</small>
                        </div>
                        <div>
                          <span>{sprintResult.peakWatts}</span>
                          <small>Watts pk</small>
                        </div>
                        <div>
                          <span>{sprintResult.averageWatts}</span>
                          <small>Watts avg</small>
                        </div>
                      </div>
                    </>
                  ) : (
                    <span>No completed sprint yet</span>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
