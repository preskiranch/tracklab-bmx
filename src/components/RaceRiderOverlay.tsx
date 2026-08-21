import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { GripHorizontal, Lock, Unlock } from 'lucide-react';
import type { GhostPlaybackRider, MultiplayerRaceState, PlayerSlot, RaceRiderOverlayLayout, RaceState, RiderState, SpeedUnit } from '../types';
import { defaultRaceRiderOverlayLayout, normalizeRaceRiderOverlayLayout } from '../lib/raceViewPreferences';
import { racePositionsAreEstablished } from '../lib/racePositionDisplay';
import { raceProgressPercent } from '../lib/raceProgress';
import { formatSpeedFromKph, speedUnitLabel } from '../units';
import { RiderAvatar } from './RiderAvatar';
import { NewRecordBadge } from './NewRecordBadge';
import type { PersonalRecordAchievements } from '../lib/personalRecords';
import { ghostPlaybackAccent } from '../lib/ghosts';
import { heartRateReadingState } from './HeartRateMetric';

export type LiveHeartRateByPlayer = Partial<Record<PlayerSlot['id'], {
  bpm: number | null;
  recordedAt: number | null;
}>>;

type DragState =
  | {
      kind: 'move';
      pointerId: number;
      startX: number;
      startY: number;
      layout: RaceRiderOverlayLayout;
      captureTarget: HTMLElement;
    }
  | {
      kind: 'resize';
      pointerId: number;
      startX: number;
      startY: number;
      layout: RaceRiderOverlayLayout;
      captureTarget: HTMLElement;
    };

type OverlayEntry = {
  id: string;
  playerId: PlayerSlot['id'] | null;
  badge: string;
  name: string;
  photoUrl?: string;
  accent: string;
  rank: number;
  progressPct: number;
  speedKph: number | null;
  distanceMeters: number;
  finishedAt: number | null;
  kind: 'local' | 'ghost' | 'remote';
  heartRateBpm: number | null;
};

type RaceRiderOverlayProps = {
  trackId: string;
  riders: RiderState[];
  ghostRiders: GhostPlaybackRider[];
  remoteRaceStates: MultiplayerRaceState[];
  players: PlayerSlot[];
  raceState: RaceState;
  visible: boolean;
  speedUnit: SpeedUnit;
  trackLengthMeters: number;
  preference?: RaceRiderOverlayLayout;
  canEditLayout: boolean;
  onPreferenceChange: (trackId: string, layout: RaceRiderOverlayLayout) => void;
  onFullscreenInteraction: () => void;
  newPersonalRecordsByPlayer: PersonalRecordAchievements;
  heartRateByPlayer?: LiveHeartRateByPlayer;
};

function ordinal(value: number) {
  const suffix = value === 1 ? 'st' : value === 2 ? 'nd' : value === 3 ? 'rd' : 'th';
  return `${value}${suffix}`;
}

function clampLayout(layout: RaceRiderOverlayLayout, container: HTMLElement | null) {
  if (!container) {
    return layout;
  }

  const minimumHeight = container.clientWidth <= 900 ? 340 : 190;
  const width = Math.max(320, Math.min(layout.width, Math.max(320, container.clientWidth - 24)));
  const height = Math.max(
    minimumHeight,
    Math.min(layout.height, Math.max(minimumHeight, container.clientHeight - 24)),
  );
  const maxX = Math.max(0, 1 - (width / Math.max(1, container.clientWidth)));
  const maxY = Math.max(0, 1 - (height / Math.max(1, container.clientHeight)));
  return {
    width,
    height,
    xPct: Math.max(0, Math.min(maxX, layout.xPct)),
    yPct: Math.max(0, Math.min(maxY, layout.yPct)),
    locked: layout.locked,
  };
}

export function RaceRiderOverlay({
  trackId,
  riders,
  ghostRiders,
  remoteRaceStates,
  players,
  raceState,
  visible,
  speedUnit,
  trackLengthMeters,
  preference,
  canEditLayout,
  onPreferenceChange,
  onFullscreenInteraction,
  newPersonalRecordsByPlayer,
  heartRateByPlayer = {},
}: RaceRiderOverlayProps) {
  const [layout, setLayout] = useState<RaceRiderOverlayLayout>(
    () => normalizeRaceRiderOverlayLayout(preference ?? defaultRaceRiderOverlayLayout),
  );
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const layoutRef = useRef(layout);

  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  useEffect(() => {
    const next = normalizeRaceRiderOverlayLayout(preference ?? defaultRaceRiderOverlayLayout);
    layoutRef.current = next;
    setLayout(next);
  }, [preference, trackId]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    const nextLayout = clampLayout(layout, overlayRef.current?.parentElement ?? null);
    if (
      nextLayout.width !== layout.width
      || nextLayout.height !== layout.height
      || nextLayout.xPct !== layout.xPct
      || nextLayout.yPct !== layout.yPct
    ) {
      layoutRef.current = nextLayout;
      setLayout(nextLayout);
      if (canEditLayout && !layout.locked) {
        onPreferenceChange(trackId, nextLayout);
      }
    }
  }, [canEditLayout, layout, onPreferenceChange, trackId, visible]);

  const entries = useMemo<OverlayEntry[]>(() => {
    const localEntries = riders.flatMap((rider) => {
      const player = players.find((slot) => slot.id === rider.playerId);
      if (!player) {
        return [];
      }

      const heartRate = heartRateReadingState(
        heartRateByPlayer[player.id]?.bpm,
        heartRateByPlayer[player.id]?.recordedAt,
      );
      return [{
        id: `local-${player.id}`,
        playerId: player.id,
        badge: `P${player.id}`,
        name: player.name,
        photoUrl: player.photoUrl,
        accent: player.accent,
        rank: rider.rank,
        progressPct: raceProgressPercent(rider.distance, trackLengthMeters),
        speedKph: rider.velocity > 0 ? rider.velocity * 3.6 : null,
        distanceMeters: rider.distance,
        finishedAt: rider.finishedAt,
        kind: 'local' as const,
        heartRateBpm: heartRate.bpm,
      }];
    });

    const ghostEntries = ghostRiders.map((rider, index) => ({
      id: `ghost-${rider.id}`,
      playerId: null,
      badge: `G${index + 1}`,
      name: rider.name,
      photoUrl: undefined,
      accent: ghostPlaybackAccent,
      rank: rider.rank,
      progressPct: raceProgressPercent(rider.distance, trackLengthMeters),
      speedKph: rider.velocity > 0 ? rider.velocity * 3.6 : null,
      distanceMeters: rider.distance,
      finishedAt: rider.finishedAt,
      kind: 'ghost' as const,
      heartRateBpm: null,
    }));

    const remoteEntries = remoteRaceStates.flatMap((state) => state.riders.map((rider, index) => ({
      id: `remote-${state.clientId}-${rider.id}`,
      playerId: rider.playerId,
      badge: `R${index + 1}`,
      name: rider.name,
      photoUrl: rider.photoUrl,
      accent: rider.accent,
      rank: rider.rank,
      progressPct: raceProgressPercent(rider.distance, trackLengthMeters),
      speedKph: rider.speedKph ?? (rider.velocity > 0 ? rider.velocity * 3.6 : null),
      distanceMeters: rider.distance,
      finishedAt: rider.finishedAt,
      kind: 'remote' as const,
      heartRateBpm: null,
    })));

    return [...localEntries, ...ghostEntries, ...remoteEntries]
      .sort((left, right) => left.rank - right.rank || right.progressPct - left.progressPct);
  }, [ghostRiders, heartRateByPlayer, players, remoteRaceStates, riders, trackLengthMeters]);
  const positionsEstablished = useMemo(
    () => racePositionsAreEstablished(raceState, entries),
    [entries, raceState],
  );

  const finishDrag = useCallback(() => {
    const drag = dragRef.current;
    if (drag) {
      onPreferenceChange(trackId, layoutRef.current);
      if (drag.captureTarget.hasPointerCapture?.(drag.pointerId)) {
        drag.captureTarget.releasePointerCapture(drag.pointerId);
      }
    }
    dragRef.current = null;
  }, [onPreferenceChange, trackId]);

  const moveDrag = useCallback((event: PointerEvent) => {
    const drag = dragRef.current;
    const overlay = overlayRef.current;
    const container = overlay?.parentElement ?? null;
    if (!drag || !container || drag.pointerId !== event.pointerId) {
      return;
    }

    if (event.cancelable) {
      event.preventDefault();
    }
    const rect = container.getBoundingClientRect();
    if (drag.kind === 'move') {
      const next = clampLayout({
        ...drag.layout,
        xPct: drag.layout.xPct + ((event.clientX - drag.startX) / Math.max(1, rect.width)),
        yPct: drag.layout.yPct + ((event.clientY - drag.startY) / Math.max(1, rect.height)),
      }, container);
      layoutRef.current = next;
      setLayout(next);
      return;
    }

    const next = clampLayout({
      ...drag.layout,
      width: drag.layout.width + (event.clientX - drag.startX),
      height: drag.layout.height + (event.clientY - drag.startY),
    }, container);
    layoutRef.current = next;
    setLayout(next);
  }, []);

  useEffect(() => {
    window.addEventListener('pointermove', moveDrag, { passive: false });
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('pointercancel', finishDrag);
    return () => {
      window.removeEventListener('pointermove', moveDrag);
      window.removeEventListener('pointerup', finishDrag);
      window.removeEventListener('pointercancel', finishDrag);
    };
  }, [finishDrag, moveDrag]);

  const beginMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canEditLayout || layout.locked) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onFullscreenInteraction();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      kind: 'move',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      layout,
      captureTarget: event.currentTarget,
    };
  };

  const beginResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!canEditLayout || layout.locked) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onFullscreenInteraction();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      kind: 'resize',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      layout,
      captureTarget: event.currentTarget,
    };
  };

  const toggleLock = () => {
    if (!canEditLayout) {
      return;
    }
    dragRef.current = null;
    const next = { ...layout, locked: !layout.locked };
    layoutRef.current = next;
    setLayout(next);
    onPreferenceChange(trackId, next);
  };

  if (!visible || entries.length === 0) {
    return null;
  }

  return (
    <div
      className={`race-rider-overlay${!canEditLayout || layout.locked ? ' locked' : ''}`}
      ref={overlayRef}
      aria-label="Race rider positions"
      style={{
        '--overlay-x': `${layout.xPct * 100}%`,
        '--overlay-y': `${layout.yPct * 100}%`,
        '--overlay-width': `${layout.width}px`,
        '--overlay-height': `${layout.height}px`,
      } as CSSProperties}
    >
      <div className="race-rider-overlay-toolbar">
        <div
          className="race-rider-overlay-handle"
          onPointerDown={beginMove}
          role="button"
          tabIndex={!canEditLayout || layout.locked ? -1 : 0}
          aria-disabled={!canEditLayout || layout.locked}
          aria-label={!canEditLayout || layout.locked ? 'Rider panel position locked' : 'Move rider panel'}
        >
          <GripHorizontal size={16} />
          <span>Rider positions</span>
          {canEditLayout && !layout.locked && <small>Drag to move / drag corner to resize</small>}
        </div>
        {canEditLayout ? (
          <button
            className="race-rider-overlay-lock"
            type="button"
            aria-pressed={layout.locked}
            aria-label={layout.locked ? 'Unlock rider panel' : 'Lock rider panel position and size'}
            title={layout.locked ? 'Unlock rider panel' : 'Lock rider panel'}
            onPointerDown={(event) => {
              event.stopPropagation();
              onFullscreenInteraction();
            }}
            onClick={toggleLock}
          >
            {layout.locked ? <Lock size={15} /> : <Unlock size={15} />}
            <span>{layout.locked ? 'Locked' : 'Lock panel'}</span>
          </button>
        ) : (
          <span className="race-rider-overlay-lock" aria-label="Rider panel locked">
            <Lock size={15} />
            <span>Locked</span>
          </span>
        )}
      </div>
      <div className="race-rider-overlay-grid">
        {entries.map((entry) => (
          <div
            className={`race-rider-overlay-card race-rider-overlay-card-${entry.kind}${positionsEstablished ? '' : ' positions-pending'}`}
            style={{ '--player-color': entry.accent } as CSSProperties}
            key={entry.id}
          >
            <div className="race-rider-overlay-summary">
              <RiderAvatar
                name={entry.name}
                photoUrl={entry.photoUrl}
                accent={entry.accent}
                className="race-rider-overlay-avatar"
              />
              <span className="race-rider-overlay-badge">{entry.badge}</span>
              <div className="race-rider-overlay-identity">
                <strong>{entry.name}</strong>
                <span>
                  {entry.kind === 'local' && entry.playerId != null && newPersonalRecordsByPlayer[entry.playerId]
                    ? `${((entry.finishedAt ?? 0) / 1000).toFixed(2)}s finish`
                    : `${entry.progressPct}% track / ${formatSpeedFromKph(entry.speedKph, speedUnit)} ${speedUnitLabel(speedUnit)}`}
                </span>
                {entry.heartRateBpm != null && (
                  <span className="race-rider-overlay-heart-rate" aria-label={`Heart rate ${entry.heartRateBpm} beats per minute`}>
                    <b aria-hidden="true">♥</b> {entry.heartRateBpm} BPM
                  </span>
                )}
                {entry.kind === 'local' && entry.playerId != null && newPersonalRecordsByPlayer[entry.playerId] && (
                  <NewRecordBadge />
                )}
              </div>
            </div>
            {positionsEstablished && (
              <div className="race-rider-overlay-place" aria-label={`${ordinal(entry.rank)} place`}>
                <strong>{ordinal(entry.rank)}</strong>
                <span>Place</span>
              </div>
            )}
          </div>
        ))}
      </div>
      {canEditLayout && !layout.locked && (
        <button
          className="race-rider-overlay-resize"
          type="button"
          aria-label="Resize rider overlay"
          title="Resize rider panel horizontally and vertically"
          onPointerDown={beginResize}
        />
      )}
    </div>
  );
}
