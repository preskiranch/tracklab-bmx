import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { GripHorizontal, Lock, Unlock } from 'lucide-react';
import type { GhostPlaybackRider, MultiplayerRaceState, PlayerSlot, RaceRiderOverlayLayout, RiderState, SpeedUnit } from '../types';
import { defaultRaceRiderOverlayLayout, normalizeRaceRiderOverlayLayout } from '../lib/raceViewPreferences';
import { formatSpeedFromKph, speedUnitLabel } from '../units';

type DragState =
  | { kind: 'move'; pointerId: number; startX: number; startY: number; layout: RaceRiderOverlayLayout }
  | { kind: 'resize'; pointerId: number; startX: number; startY: number; layout: RaceRiderOverlayLayout };

type OverlayEntry = {
  id: string;
  badge: string;
  name: string;
  accent: string;
  rank: number;
  progressPct: number;
  speedKph: number | null;
  finishedAt: number | null;
  kind: 'local' | 'ghost' | 'remote';
};

type RaceRiderOverlayProps = {
  trackId: string;
  riders: RiderState[];
  ghostRiders: GhostPlaybackRider[];
  remoteRaceStates: MultiplayerRaceState[];
  players: PlayerSlot[];
  visible: boolean;
  speedUnit: SpeedUnit;
  trackLengthMeters: number;
  preference?: RaceRiderOverlayLayout;
  onPreferenceChange: (trackId: string, layout: RaceRiderOverlayLayout) => void;
};

function ordinal(value: number) {
  const suffix = value === 1 ? 'st' : value === 2 ? 'nd' : value === 3 ? 'rd' : 'th';
  return `${value}${suffix}`;
}

function clampLayout(layout: RaceRiderOverlayLayout, container: HTMLElement | null) {
  if (!container) {
    return layout;
  }

  const width = Math.max(320, Math.min(layout.width, Math.max(320, container.clientWidth - 24)));
  const height = Math.max(112, Math.min(layout.height, Math.max(112, container.clientHeight - 24)));
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
  visible,
  speedUnit,
  trackLengthMeters,
  preference,
  onPreferenceChange,
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
      onPreferenceChange(trackId, nextLayout);
    }
  }, [layout, onPreferenceChange, trackId, visible]);

  const entries = useMemo<OverlayEntry[]>(() => {
    const localEntries = riders.flatMap((rider) => {
      const player = players.find((slot) => slot.id === rider.playerId);
      if (!player) {
        return [];
      }

      return [{
        id: `local-${player.id}`,
        badge: `P${player.id}`,
        name: player.name,
        accent: player.accent,
        rank: rider.rank,
        progressPct: Math.max(0, Math.min(100, (rider.distance / Math.max(1, trackLengthMeters)) * 100)),
        speedKph: rider.velocity > 0 ? rider.velocity * 3.6 : null,
        finishedAt: rider.finishedAt,
        kind: 'local' as const,
      }];
    });

    const ghostEntries = ghostRiders.map((rider, index) => ({
      id: `ghost-${rider.id}`,
      badge: `G${index + 1}`,
      name: rider.name,
      accent: '#22d3ee',
      rank: rider.rank,
      progressPct: Math.max(0, Math.min(100, (rider.distance / Math.max(1, trackLengthMeters)) * 100)),
      speedKph: rider.velocity > 0 ? rider.velocity * 3.6 : null,
      finishedAt: rider.finishedAt,
      kind: 'ghost' as const,
    }));

    const remoteEntries = remoteRaceStates.flatMap((state) => state.riders.map((rider, index) => ({
      id: `remote-${state.clientId}-${rider.id}`,
      badge: `R${index + 1}`,
      name: rider.name,
      accent: rider.accent,
      rank: rider.rank,
      progressPct: Math.max(0, Math.min(100, (rider.distance / Math.max(1, trackLengthMeters)) * 100)),
      speedKph: rider.speedKph ?? (rider.velocity > 0 ? rider.velocity * 3.6 : null),
      finishedAt: rider.finishedAt,
      kind: 'remote' as const,
    })));

    return [...localEntries, ...ghostEntries, ...remoteEntries]
      .sort((left, right) => left.rank - right.rank || right.progressPct - left.progressPct);
  }, [ghostRiders, players, remoteRaceStates, riders, trackLengthMeters]);

  const finishDrag = useCallback(() => {
    if (dragRef.current) {
      onPreferenceChange(trackId, layoutRef.current);
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
    window.addEventListener('pointermove', moveDrag);
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('pointercancel', finishDrag);
    return () => {
      window.removeEventListener('pointermove', moveDrag);
      window.removeEventListener('pointerup', finishDrag);
      window.removeEventListener('pointercancel', finishDrag);
    };
  }, [finishDrag, moveDrag]);

  const beginMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (layout.locked) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      kind: 'move',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      layout,
    };
  };

  const beginResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (layout.locked) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      kind: 'resize',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      layout,
    };
  };

  const toggleLock = () => {
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
      className={`race-rider-overlay${layout.locked ? ' locked' : ''}`}
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
          tabIndex={layout.locked ? -1 : 0}
          aria-disabled={layout.locked}
          aria-label={layout.locked ? 'Rider panel position locked' : 'Move rider panel'}
        >
          <GripHorizontal size={16} />
          <span>Rider positions</span>
          {!layout.locked && <small>Drag to move / drag corner to resize</small>}
        </div>
        <button
          className="race-rider-overlay-lock"
          type="button"
          aria-pressed={layout.locked}
          aria-label={layout.locked ? 'Unlock rider panel' : 'Lock rider panel position and size'}
          title={layout.locked ? 'Unlock rider panel' : 'Lock rider panel'}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={toggleLock}
        >
          {layout.locked ? <Lock size={15} /> : <Unlock size={15} />}
          <span>{layout.locked ? 'Locked' : 'Lock panel'}</span>
        </button>
      </div>
      <div className="race-rider-overlay-grid">
        {entries.map((entry) => (
          <div
            className={`race-rider-overlay-card race-rider-overlay-card-${entry.kind}`}
            style={{ '--player-color': entry.accent } as CSSProperties}
            key={entry.id}
          >
            <span className="race-rider-overlay-badge">{entry.badge}</span>
            <div>
              <strong>{entry.name}</strong>
              <span>
                {ordinal(entry.rank)} / {Math.round(entry.progressPct)}% / {formatSpeedFromKph(entry.speedKph, speedUnit)} {speedUnitLabel(speedUnit)}
              </span>
            </div>
          </div>
        ))}
      </div>
      <button
        className="race-rider-overlay-resize"
        type="button"
        aria-label="Resize rider overlay"
        title="Resize rider panel horizontally and vertically"
        disabled={layout.locked}
        onPointerDown={beginResize}
      />
    </div>
  );
}
