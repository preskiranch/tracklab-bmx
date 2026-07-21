import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { GripHorizontal } from 'lucide-react';
import type { GhostPlaybackRider, MultiplayerRaceState, PlayerSlot, RiderState, SpeedUnit } from '../types';
import { formatSpeedFromKph, speedUnitLabel } from '../units';

type OverlayLayout = {
  xPct: number;
  yPct: number;
  width: number;
};

type DragState =
  | { kind: 'move'; pointerId: number; startX: number; startY: number; layout: OverlayLayout }
  | { kind: 'resize'; pointerId: number; startX: number; layout: OverlayLayout };

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
};

const storageKey = 'tracklab:race-rider-overlay-layout:v1';
const defaultLayout: OverlayLayout = {
  xPct: 0.07,
  yPct: 0.82,
  width: 760,
};

function loadLayouts() {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed as Record<string, OverlayLayout> : {};
  } catch {
    return {};
  }
}

function savedTrackLayout(trackId: string) {
  const layout = loadLayouts()[trackId];
  if (!layout) {
    return defaultLayout;
  }

  return {
    xPct: Number.isFinite(layout.xPct) ? layout.xPct : defaultLayout.xPct,
    yPct: Number.isFinite(layout.yPct) ? layout.yPct : defaultLayout.yPct,
    width: Number.isFinite(layout.width) ? layout.width : defaultLayout.width,
  };
}

function saveTrackLayout(trackId: string, layout: OverlayLayout) {
  if (typeof window === 'undefined') {
    return;
  }

  const layouts = loadLayouts();
  layouts[trackId] = layout;
  window.localStorage.setItem(storageKey, JSON.stringify(layouts));
}

function ordinal(value: number) {
  const suffix = value === 1 ? 'st' : value === 2 ? 'nd' : value === 3 ? 'rd' : 'th';
  return `${value}${suffix}`;
}

function clampLayout(layout: OverlayLayout, container: HTMLElement | null) {
  if (!container) {
    return layout;
  }

  const width = Math.max(300, Math.min(layout.width, Math.max(300, container.clientWidth - 24)));
  const maxX = Math.max(0, 1 - (width / Math.max(1, container.clientWidth)));
  const maxY = 0.92;
  return {
    width,
    xPct: Math.max(0, Math.min(maxX, layout.xPct)),
    yPct: Math.max(0, Math.min(maxY, layout.yPct)),
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
}: RaceRiderOverlayProps) {
  const [layout, setLayout] = useState<OverlayLayout>(() => savedTrackLayout(trackId));
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    setLayout(savedTrackLayout(trackId));
  }, [trackId]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    const nextLayout = clampLayout(layout, overlayRef.current?.parentElement ?? null);
    if (
      nextLayout.width !== layout.width
      || nextLayout.xPct !== layout.xPct
      || nextLayout.yPct !== layout.yPct
    ) {
      setLayout(nextLayout);
      saveTrackLayout(trackId, nextLayout);
    }
  }, [layout, trackId, visible]);

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
    dragRef.current = null;
  }, []);

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
      setLayout(next);
      saveTrackLayout(trackId, next);
      return;
    }

    const next = clampLayout({
      ...drag.layout,
      width: drag.layout.width + (event.clientX - drag.startX),
    }, container);
    setLayout(next);
    saveTrackLayout(trackId, next);
  }, [trackId]);

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
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      kind: 'resize',
      pointerId: event.pointerId,
      startX: event.clientX,
      layout,
    };
  };

  if (!visible || entries.length === 0) {
    return null;
  }

  return (
    <div
      className="race-rider-overlay"
      ref={overlayRef}
      style={{
        '--overlay-x': `${layout.xPct * 100}%`,
        '--overlay-y': `${layout.yPct * 100}%`,
        '--overlay-width': `${layout.width}px`,
      } as CSSProperties}
    >
      <div
        className="race-rider-overlay-handle"
        onPointerDown={beginMove}
        role="button"
        tabIndex={0}
        aria-label="Move rider overlay"
      >
        <GripHorizontal size={14} />
        <span>Riders</span>
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
        title="Resize"
        onPointerDown={beginResize}
      />
    </div>
  );
}
