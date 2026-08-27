import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { GripHorizontal, Lock, Unlock } from 'lucide-react';
import type { BikeSample, GhostPlaybackRider, MultiplayerRaceState, PlayerSlot, RaceRiderOverlayLayout, RaceState, RiderState, SpeedUnit } from '../types';
import { defaultRaceRiderOverlayLayout, normalizeRaceRiderOverlayLayout } from '../lib/raceViewPreferences';
import { racePositionsAreEstablished } from '../lib/racePositionDisplay';
import { raceProgressPercent } from '../lib/raceProgress';
import { formatSpeedFromKph, speedUnitLabel } from '../units';
import { RiderAvatar } from './RiderAvatar';
import { NewRecordBadge } from './NewRecordBadge';
import type { PersonalRecordAchievements } from '../lib/personalRecords';
import { ghostPlaybackAccent } from '../lib/ghosts';
import { heartRateReadingState } from './HeartRateMetric';
import { demoHeartRateReadingForBikeSample } from '../lib/demoHeartRate';
import { normalizeRiderPresentationScale } from '../lib/riderPresentation';
import { normalizeRacePresentationViewport } from '../lib/racePresentation';

export type LiveHeartRateByPlayer = Partial<Record<PlayerSlot['id'], {
  bpm: number | null;
  recordedAt: number | null;
  source?: 'apple-watch' | 'demo-simulated';
}>>;

type DragState =
  | {
      kind: 'move';
      pointerId: number;
      startX: number;
      startY: number;
      layout: RaceRiderOverlayLayout;
      requestedLayout: RaceRiderOverlayLayout;
      captureTarget: HTMLElement;
    }
  | {
      kind: 'resize';
      pointerId: number;
      startX: number;
      startY: number;
      layout: RaceRiderOverlayLayout;
      requestedLayout: RaceRiderOverlayLayout;
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
  heartRateSimulated: boolean;
  disqualified: boolean;
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
  presentationScale?: number;
  canEditLayout: boolean;
  onPreferenceChange: (trackId: string, layout: RaceRiderOverlayLayout) => void;
  onFullscreenInteraction: () => void;
  newPersonalRecordsByPlayer: PersonalRecordAchievements;
  disqualifiedPlayerIds: PlayerSlot['id'][];
  heartRateByPlayer?: LiveHeartRateByPlayer;
  samplesByDevice?: Map<number, BikeSample>;
};

function raceRiderOverlayUsesCompactLandscape(containerWidth: number, containerHeight: number) {
  return containerWidth > containerHeight
    && containerWidth <= 1000
    && containerHeight <= 500;
}

export function raceRiderOverlayMinimumHeight(
  containerWidth: number,
  containerHeight: number,
  presentationScale = 1,
  requestedPresentationHeight?: number,
) {
  const scale = normalizeRiderPresentationScale(presentationScale);
  if (Math.abs(scale - 1) > 0.001) {
    const scaledDefaultMinimum = Math.max(
      110,
      Math.round(defaultRaceRiderOverlayLayout.height * scale),
    );
    // A locked owner layout has already been mapped into this viewport. Do not
    // inflate a deliberately short saved panel (for example 190px -> 142.5px)
    // back to the 220px default's 165px presentation height.
    return requestedPresentationHeight == null
      ? scaledDefaultMinimum
      : Math.min(scaledDefaultMinimum, Math.max(1, requestedPresentationHeight));
  }
  if (raceRiderOverlayUsesCompactLandscape(containerWidth, containerHeight)) {
    return 138;
  }
  if (containerWidth <= 600) {
    return 368;
  }
  return containerWidth <= 900 ? 340 : 220;
}

export function raceRiderOverlayMaximumHeight(containerWidth: number, containerHeight: number) {
  if (!raceRiderOverlayUsesCompactLandscape(containerWidth, containerHeight)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(138, Math.min(156, Math.round(containerHeight * 0.36)));
}

export function raceRiderOverlayPreferenceForViewport(
  requested: RaceRiderOverlayLayout,
  presented: RaceRiderOverlayLayout,
  containerWidth: number,
  containerHeight: number,
) {
  return raceRiderOverlayUsesCompactLandscape(containerWidth, containerHeight)
    ? { ...requested, locked: presented.locked }
    : presented;
}

function ordinal(value: number) {
  const suffix = value === 1 ? 'st' : value === 2 ? 'nd' : value === 3 ? 'rd' : 'th';
  return `${value}${suffix}`;
}

function clampLayout(
  layout: RaceRiderOverlayLayout,
  container: HTMLElement | null,
  presentationScale = 1,
) {
  if (!container) {
    return layout;
  }

  const scale = normalizeRiderPresentationScale(presentationScale);
  const presentationScaled = Math.abs(scale - 1) > 0.001;
  const minimumHeight = raceRiderOverlayMinimumHeight(
    container.clientWidth,
    container.clientHeight,
    scale,
    layout.height,
  );
  const maximumHeight = presentationScaled
    ? Number.POSITIVE_INFINITY
    : raceRiderOverlayMaximumHeight(container.clientWidth, container.clientHeight);
  const scaledMinimumWidth = Math.max(220, Math.round(320 * scale));
  const minimumWidth = presentationScaled
    ? Math.min(scaledMinimumWidth, Math.max(1, layout.width))
    : 320;
  const width = Math.max(
    minimumWidth,
    Math.min(layout.width, Math.max(minimumWidth, container.clientWidth - 24)),
  );
  const height = Math.max(
    minimumHeight,
    Math.min(layout.height, maximumHeight, Math.max(minimumHeight, container.clientHeight - 24)),
  );
  const maxX = Math.max(0, 1 - (width / Math.max(1, container.clientWidth)));
  const maxY = Math.max(0, 1 - (height / Math.max(1, container.clientHeight)));
  return {
    ...layout,
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
  presentationScale = 1,
  canEditLayout,
  onPreferenceChange,
  onFullscreenInteraction,
  newPersonalRecordsByPlayer,
  disqualifiedPlayerIds,
  heartRateByPlayer = {},
  samplesByDevice = new Map(),
}: RaceRiderOverlayProps) {
  const normalizedPresentationScale = normalizeRiderPresentationScale(presentationScale);
  const presentationScaled = Math.abs(normalizedPresentationScale - 1) > 0.001;
  const [layout, setLayout] = useState<RaceRiderOverlayLayout>(
    () => presentationScaled && preference
      ? preference
      : normalizeRaceRiderOverlayLayout(preference ?? defaultRaceRiderOverlayLayout),
  );
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const layoutRef = useRef(layout);
  const requestedLayoutRef = useRef(layout);
  const disqualifiedPlayerIdSet = useMemo(
    () => new Set(disqualifiedPlayerIds),
    [disqualifiedPlayerIds],
  );

  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  useEffect(() => {
    const next = presentationScaled && preference
      ? preference
      : normalizeRaceRiderOverlayLayout(preference ?? defaultRaceRiderOverlayLayout);
    requestedLayoutRef.current = next;
    const presented = clampLayout(
      next,
      overlayRef.current?.parentElement ?? null,
      normalizedPresentationScale,
    );
    layoutRef.current = presented;
    setLayout(presented);
  }, [normalizedPresentationScale, preference, presentationScaled, trackId]);

  useEffect(() => {
    if (!visible) {
      return undefined;
    }

    const container = overlayRef.current?.parentElement ?? null;
    if (!container) {
      return undefined;
    }

    const syncLayoutToViewport = () => {
      const nextLayout = clampLayout(
        requestedLayoutRef.current,
        container,
        normalizedPresentationScale,
      );
      const currentLayout = layoutRef.current;
      if (
        nextLayout.width === currentLayout.width
        && nextLayout.height === currentLayout.height
        && nextLayout.xPct === currentLayout.xPct
        && nextLayout.yPct === currentLayout.yPct
        && nextLayout.locked === currentLayout.locked
      ) {
        return;
      }

      layoutRef.current = nextLayout;
      setLayout(nextLayout);
    };

    syncLayoutToViewport();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', syncLayoutToViewport);
      return () => window.removeEventListener('resize', syncLayoutToViewport);
    }

    const resizeObserver = new ResizeObserver(syncLayoutToViewport);
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [normalizedPresentationScale, trackId, visible]);

  const entries = useMemo<OverlayEntry[]>(() => {
    const localEntries = riders.flatMap((rider) => {
      const player = players.find((slot) => slot.id === rider.playerId);
      if (!player) {
        return [];
      }

      const heartRateReading = demoHeartRateReadingForBikeSample(
        player.deviceId == null ? null : samplesByDevice.get(player.deviceId),
      ) ?? heartRateByPlayer[player.id];
      const heartRate = heartRateReadingState(
        heartRateReading?.bpm,
        heartRateReading?.recordedAt,
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
        heartRateSimulated: heartRateReading?.source === 'demo-simulated',
        disqualified: disqualifiedPlayerIdSet.has(player.id),
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
      heartRateSimulated: false,
      disqualified: false,
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
      heartRateSimulated: false,
      disqualified: rider.disqualified === true,
    })));

    return [...localEntries, ...ghostEntries, ...remoteEntries]
      .sort((left, right) => (
        Number(left.disqualified) - Number(right.disqualified)
        || left.rank - right.rank
        || right.progressPct - left.progressPct
      ));
  }, [disqualifiedPlayerIdSet, ghostRiders, heartRateByPlayer, players, remoteRaceStates, riders, samplesByDevice, trackLengthMeters]);
  const positionsEstablished = useMemo(
    () => racePositionsAreEstablished(raceState, entries.filter((entry) => !entry.disqualified)),
    [entries, raceState],
  );

  const finishDrag = useCallback(() => {
    const drag = dragRef.current;
    if (drag) {
      const container = overlayRef.current?.parentElement ?? null;
      const nextPreference = container
        ? raceRiderOverlayPreferenceForViewport(
          drag.requestedLayout,
          layoutRef.current,
          container.clientWidth,
          container.clientHeight,
        )
        : layoutRef.current;
      const referenceViewport = container
        && !raceRiderOverlayUsesCompactLandscape(container.clientWidth, container.clientHeight)
        ? normalizeRacePresentationViewport({
            width: container.clientWidth,
            height: container.clientHeight,
          })
        : nextPreference.referenceViewport;
      const savedPreference = {
        ...nextPreference,
        ...(referenceViewport ? { referenceViewport } : {}),
      };
      requestedLayoutRef.current = savedPreference;
      onPreferenceChange(trackId, savedPreference);
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
      }, container, normalizedPresentationScale);
      requestedLayoutRef.current = next;
      layoutRef.current = next;
      setLayout(next);
      return;
    }

    const next = clampLayout({
      ...drag.layout,
      width: drag.layout.width + (event.clientX - drag.startX),
      height: drag.layout.height + (event.clientY - drag.startY),
    }, container, normalizedPresentationScale);
    requestedLayoutRef.current = next;
    layoutRef.current = next;
    setLayout(next);
  }, [normalizedPresentationScale]);

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
      requestedLayout: requestedLayoutRef.current,
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
      requestedLayout: requestedLayoutRef.current,
      captureTarget: event.currentTarget,
    };
  };

  const toggleLock = () => {
    if (!canEditLayout) {
      return;
    }
    dragRef.current = null;
    const container = overlayRef.current?.parentElement ?? null;
    const referenceViewport = container
      ? normalizeRacePresentationViewport({
          width: container.clientWidth,
          height: container.clientHeight,
        })
      : null;
    const nextPreference = {
      ...requestedLayoutRef.current,
      locked: !layout.locked,
      ...(referenceViewport ? { referenceViewport } : {}),
    };
    const nextLayout = clampLayout(
      nextPreference,
      container,
      normalizedPresentationScale,
    );
    requestedLayoutRef.current = nextPreference;
    layoutRef.current = nextLayout;
    setLayout(nextLayout);
    onPreferenceChange(trackId, nextPreference);
  };

  if (!visible || entries.length === 0) {
    return null;
  }

  return (
    <div
      className={`race-rider-overlay${!canEditLayout || layout.locked ? ' locked' : ''}${presentationScaled ? ' presentation-scaled' : ''}`}
      ref={overlayRef}
      aria-label="Race rider positions"
      style={{
        '--overlay-x': `${layout.xPct * 100}%`,
        '--overlay-y': `${layout.yPct * 100}%`,
        '--overlay-width': `${layout.width}px`,
        '--overlay-height': `${layout.height}px`,
        '--race-overlay-min-height': `${raceRiderOverlayMinimumHeight(
          overlayRef.current?.parentElement?.clientWidth ?? 1366,
          overlayRef.current?.parentElement?.clientHeight ?? 1024,
          normalizedPresentationScale,
          layout.height,
        )}px`,
      } as CSSProperties}
    >
      <div
        className="race-rider-overlay-presentation"
        style={{
          width: presentationScaled ? `${layout.width / normalizedPresentationScale}px` : '100%',
          height: presentationScaled ? `${layout.height / normalizedPresentationScale}px` : '100%',
          display: 'grid',
          gridTemplateRows: 'auto minmax(0, 1fr)',
          transform: presentationScaled ? `scale(${normalizedPresentationScale})` : undefined,
          transformOrigin: 'top left',
        }}
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
            className={`race-rider-overlay-card race-rider-overlay-card-${entry.kind}${entry.disqualified ? ' disqualified' : positionsEstablished ? '' : ' positions-pending'}`}
            style={{ '--player-color': entry.accent } as CSSProperties}
            key={entry.id}
          >
            <div className="race-rider-overlay-summary">
              <div className="race-rider-overlay-portrait">
                <RiderAvatar
                  name={entry.name}
                  photoUrl={entry.photoUrl}
                  accent={entry.accent}
                  className="race-rider-overlay-avatar"
                />
                <span className="race-rider-overlay-badge">{entry.badge}</span>
              </div>
              <div className="race-rider-overlay-identity">
                <strong>{entry.name}</strong>
                <span className="race-rider-overlay-progress">
                  {entry.disqualified
                    ? 'False start · not ranked'
                    : entry.kind === 'local' && entry.playerId != null && newPersonalRecordsByPlayer[entry.playerId]
                    ? `${((entry.finishedAt ?? 0) / 1000).toFixed(2)}s finish`
                    : `${entry.progressPct}% track / ${formatSpeedFromKph(entry.speedKph, speedUnit)} ${speedUnitLabel(speedUnit)}`}
                </span>
                {entry.heartRateBpm != null && (
                  <span
                    className="race-rider-overlay-heart-rate"
                    aria-label={`${entry.heartRateSimulated ? 'Simulated heart rate' : 'Heart rate'} ${entry.heartRateBpm} beats per minute`}
                  >
                    <b aria-hidden="true">♥</b>
                    {entry.heartRateSimulated && (
                      <span className="race-rider-overlay-heart-rate-source" aria-hidden="true">Sim ·</span>
                    )}
                    <span aria-hidden="true">{entry.heartRateBpm} BPM</span>
                  </span>
                )}
                {!entry.disqualified && entry.kind === 'local' && entry.playerId != null && newPersonalRecordsByPlayer[entry.playerId] && (
                  <NewRecordBadge />
                )}
              </div>
            </div>
            {(entry.disqualified || positionsEstablished) && (
              <div
                className="race-rider-overlay-place"
                aria-label={entry.disqualified ? 'Disqualified false start' : `${ordinal(entry.rank)} place`}
              >
                <strong>{entry.disqualified ? 'DQ' : ordinal(entry.rank)}</strong>
                <span>{entry.disqualified ? 'False start' : 'Place'}</span>
              </div>
            )}
          </div>
        ))}
      </div>
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
