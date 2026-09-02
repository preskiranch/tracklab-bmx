import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { GripHorizontal, Lock, Maximize2, Save, Unlock } from 'lucide-react';
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
import { EVERGREEN_RIDER_ACCENT } from '../lib/playerPalette';

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
  editorPreview?: boolean;
  showPreviewPlaceholders?: boolean;
  onPreferenceChange: (
    trackId: string,
    layout: RaceRiderOverlayLayout,
    publishGlobally?: boolean,
  ) => Promise<void> | void;
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

function raceRiderOverlayUsesPhonePortrait(containerWidth: number, containerHeight: number) {
  return containerHeight > containerWidth && containerWidth <= 600;
}

function raceRiderOverlayUsesShortPhonePortrait(containerWidth: number, containerHeight: number) {
  return raceRiderOverlayUsesPhonePortrait(containerWidth, containerHeight)
    && containerHeight <= 700;
}

export function raceRiderOverlayMinimumHeight(
  containerWidth: number,
  containerHeight: number,
  presentationScale = 1,
  requestedPresentationHeight?: number,
  editorPreview = false,
) {
  const scale = normalizeRiderPresentationScale(presentationScale);
  if (Math.abs(scale - 1) > 0.001) {
    // Keep the phone card strip readable without letting it consume the
    // playable map. Landscape uses one compact row; portrait uses two rows.
    // Both are deliberately bounded to leave most of the screen to the race.
    if (raceRiderOverlayUsesCompactLandscape(containerWidth, containerHeight)) {
      return 110;
    }
    if (raceRiderOverlayUsesPhonePortrait(containerWidth, containerHeight)) {
      const portraitMinimum = raceRiderOverlayUsesShortPhonePortrait(containerWidth, containerHeight)
        ? 200
        : 248;
      return Math.min(portraitMinimum, Math.max(1, containerHeight - 24));
    }
    if (editorPreview) {
      return 190;
    }
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
    return 110;
  }
  if (raceRiderOverlayUsesPhonePortrait(containerWidth, containerHeight)) {
    const portraitMinimum = raceRiderOverlayUsesShortPhonePortrait(containerWidth, containerHeight)
      ? 200
      : 248;
    return Math.min(portraitMinimum, Math.max(1, containerHeight - 24));
  }
  if (editorPreview) {
    // Match the canonical persistence floor while the owner is authoring.
    // Live views keep their larger readability floor, while phone layouts
    // continue to use the responsive limits above.
    return 190;
  }
  return containerWidth <= 900 ? Math.min(300, Math.round(containerHeight * 0.28)) : 220;
}

export function raceRiderOverlayMaximumHeight(containerWidth: number, containerHeight: number) {
  if (raceRiderOverlayUsesCompactLandscape(containerWidth, containerHeight)) {
    return Math.max(110, Math.min(128, Math.round(containerHeight * 0.3)));
  }
  if (raceRiderOverlayUsesPhonePortrait(containerWidth, containerHeight)) {
    if (raceRiderOverlayUsesShortPhonePortrait(containerWidth, containerHeight)) {
      return 200;
    }
    return Math.max(248, Math.min(272, Math.round(containerHeight * 0.32)));
  }
  return Number.POSITIVE_INFINITY;
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
  editorPreview = false,
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
    editorPreview,
  );
  const maximumHeight = raceRiderOverlayMaximumHeight(
    container.clientWidth,
    container.clientHeight,
  );
  const scaledMinimumWidth = Math.max(220, Math.round(320 * scale));
  const compactLandscape = raceRiderOverlayUsesCompactLandscape(
    container.clientWidth,
    container.clientHeight,
  );
  const phonePortrait = raceRiderOverlayUsesPhonePortrait(
    container.clientWidth,
    container.clientHeight,
  );
  const responsiveMinimumWidth = compactLandscape
    ? Math.round(container.clientWidth * 0.68)
    : phonePortrait
      ? container.clientWidth - 16
      : 0;
  const minimumWidth = Math.min(
    Math.max(1, container.clientWidth - 16),
    Math.max(
      responsiveMinimumWidth,
      presentationScaled
        ? Math.min(scaledMinimumWidth, Math.max(1, layout.width))
        : 320,
    ),
  );
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
  const responsiveBottomAligned = compactLandscape || phonePortrait;
  return {
    ...layout,
    width,
    height,
    xPct: Math.max(0, Math.min(maxX, layout.xPct)),
    yPct: responsiveBottomAligned ? maxY : Math.max(0, Math.min(maxY, layout.yPct)),
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
  editorPreview = false,
  showPreviewPlaceholders = false,
  onPreferenceChange,
  onFullscreenInteraction,
  newPersonalRecordsByPlayer,
  disqualifiedPlayerIds,
  heartRateByPlayer = {},
  samplesByDevice = new Map(),
}: RaceRiderOverlayProps) {
  const normalizedPresentationScale = normalizeRiderPresentationScale(presentationScale);
  const presentationScaled = Math.abs(normalizedPresentationScale - 1) > 0.001;
  // The complete saved overlay is uniformly scaled to preserve its authored
  // position and footprint. Counter only the typography on tablet-sized
  // viewers so a 1366px owner layout does not turn into 9-12px race data on a
  // 1024px studio iPad. Dedicated phone rules still cap the compact layout.
  const presentationLegibilityScale = presentationScaled
    ? 1 / normalizedPresentationScale
    : 1;
  const [layout, setLayout] = useState<RaceRiderOverlayLayout>(
    () => presentationScaled && preference
      ? preference
      : normalizeRaceRiderOverlayLayout(preference ?? defaultRaceRiderOverlayLayout),
  );
  const [publishStatus, setPublishStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const editorDraftActiveRef = useRef(false);
  const editorDraftTrackIdRef = useRef(trackId);
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
    const trackChanged = editorDraftTrackIdRef.current !== trackId;
    if (trackChanged) {
      editorDraftTrackIdRef.current = trackId;
      editorDraftActiveRef.current = false;
      setPublishStatus('idle');
    } else if (editorPreview && editorDraftActiveRef.current) {
      // Preference refreshes can arrive while the owner is manipulating the
      // Edit Map preview. Keep that same-track cloud response from replacing
      // the local draft (and relocking the grip) before it is published.
      return;
    }
    if (!editorPreview) {
      editorDraftActiveRef.current = false;
      setPublishStatus('idle');
    }
    const next = presentationScaled && preference
      ? preference
      : normalizeRaceRiderOverlayLayout(preference ?? defaultRaceRiderOverlayLayout);
    requestedLayoutRef.current = next;
    const presented = clampLayout(
      next,
      overlayRef.current?.parentElement ?? null,
      normalizedPresentationScale,
      editorPreview,
    );
    layoutRef.current = presented;
    setLayout(presented);
  }, [editorPreview, normalizedPresentationScale, preference, presentationScaled, trackId]);

  useLayoutEffect(() => {
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
        editorPreview,
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
    // Browser rotation changes the visual viewport before ResizeObserver is
    // guaranteed to deliver. Listen to the window signals as well so React
    // commits the compact/portrait clamp in the same layout cycle, while the
    // observer still covers stage-only size changes such as sidebar toggles.
    window.addEventListener('resize', syncLayoutToViewport);
    window.addEventListener('orientationchange', syncLayoutToViewport);
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(syncLayoutToViewport);
    resizeObserver?.observe(container);
    return () => {
      window.removeEventListener('resize', syncLayoutToViewport);
      window.removeEventListener('orientationchange', syncLayoutToViewport);
      resizeObserver?.disconnect();
    };
  }, [editorPreview, normalizedPresentationScale, trackId, visible]);

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
  const previewEntries = useMemo<OverlayEntry[]>(() => (
    Array.from({ length: 4 }, (_, index) => {
      const player = players[index];
      const rank = index + 1;
      return {
        id: `preview-${player?.id ?? rank}`,
        playerId: player?.id ?? null,
        badge: `P${rank}`,
        name: player?.name ?? `Player ${rank}`,
        photoUrl: player?.photoUrl,
        accent: player?.accent ?? [EVERGREEN_RIDER_ACCENT, '#2da8ff', '#ff5364', '#ffe05a'][index],
        rank,
        progressPct: 72 - (index * 9),
        speedKph: 38 - (index * 2),
        distanceMeters: 72 - (index * 9),
        finishedAt: null,
        kind: 'local' as const,
        heartRateBpm: 126 + (index * 3),
        heartRateSimulated: true,
        disqualified: false,
      };
    })
  ), [players]);
  const displayedEntries = entries.length > 0 || !showPreviewPlaceholders
    ? entries
    : previewEntries;
  const positionsEstablished = useMemo(
    () => editorPreview || racePositionsAreEstablished(
      raceState,
      displayedEntries.filter((entry) => !entry.disqualified),
    ),
    [displayedEntries, editorPreview, raceState],
  );

  const finishDrag = useCallback((event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    if (drag) {
      const container = overlayRef.current?.parentElement ?? null;
      // The Edit Map preview is an authoring surface, including on phones.
      // Keep the geometry the owner actually dragged in this viewport. Live
      // presentation still preserves the canonical authored layout when its
      // compact phone clamp is only a responsive rendering detail.
      const nextPreference = container
        ? editorPreview
          ? layoutRef.current
          : raceRiderOverlayPreferenceForViewport(
              drag.requestedLayout,
              layoutRef.current,
              container.clientWidth,
              container.clientHeight,
            )
        : layoutRef.current;
      const referenceViewport = container
        && (editorPreview
          || !raceRiderOverlayUsesCompactLandscape(container.clientWidth, container.clientHeight))
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
      if (!editorPreview) {
        void onPreferenceChange(trackId, savedPreference, false);
      }
      if (drag.captureTarget.hasPointerCapture?.(drag.pointerId)) {
        drag.captureTarget.releasePointerCapture(drag.pointerId);
      }
    }
    dragRef.current = null;
  }, [editorPreview, onPreferenceChange, trackId]);

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
      }, container, normalizedPresentationScale, editorPreview);
      requestedLayoutRef.current = next;
      layoutRef.current = next;
      setLayout(next);
      return;
    }

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    const resized = clampLayout({
      ...drag.layout,
      // The Edit Map grip sits on the left so it remains reachable while the
      // mapping toolbar occupies the right side. Preserve the panel's right
      // edge as that grip moves; the live-race bottom-right grip keeps its
      // established resize direction.
      width: drag.layout.width + (editorPreview ? -deltaX : deltaX),
      height: drag.layout.height + deltaY,
    }, container, normalizedPresentationScale, editorPreview);
    const next = editorPreview
      ? clampLayout({
          ...resized,
          xPct: (
            (drag.layout.xPct * rect.width)
            + drag.layout.width
            - resized.width
          ) / Math.max(1, rect.width),
        }, container, normalizedPresentationScale, editorPreview)
      : resized;
    requestedLayoutRef.current = next;
    layoutRef.current = next;
    setLayout(next);
  }, [editorPreview, normalizedPresentationScale]);

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
    if (editorPreview) {
      editorDraftActiveRef.current = true;
    }
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
    if (editorPreview) {
      editorDraftActiveRef.current = true;
    }
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
    const referenceViewport = !editorPreview && container
      ? normalizeRacePresentationViewport({
          width: container.clientWidth,
          height: container.clientHeight,
        })
      : null;
    const nextPreference = {
      ...requestedLayoutRef.current,
      locked: !layout.locked,
      // An editor drag already records the viewport that gives its pixel
      // dimensions meaning. Do not re-key those dimensions if the owner
      // rotates between releasing the grip and pressing Save & publish.
      ...(referenceViewport ? { referenceViewport } : {}),
    };
    const nextLayout = clampLayout(
      nextPreference,
      container,
      normalizedPresentationScale,
      editorPreview,
    );
    if (editorPreview) {
      editorDraftActiveRef.current = !nextPreference.locked;
      if (!nextPreference.locked) {
        setPublishStatus('idle');
      }
    }
    requestedLayoutRef.current = nextPreference;
    layoutRef.current = nextLayout;
    setLayout(nextLayout);
    // Edit Map uses an explicit draft workflow. Unlocking only changes the
    // local preview; the owner publishes the layout by pressing Save & publish.
    if (!editorPreview || nextPreference.locked) {
      const publishGlobally = nextPreference.locked;
      const result = onPreferenceChange(trackId, nextPreference, publishGlobally);
      if (editorPreview && publishGlobally) {
        setPublishStatus('saving');
        void Promise.resolve(result)
          .then(() => setPublishStatus('saved'))
          .catch(() => setPublishStatus('error'));
      } else if (publishGlobally) {
        void Promise.resolve(result).catch(() => undefined);
      }
    }
  };

  if (!visible || displayedEntries.length === 0) {
    return null;
  }

  return (
    <div
      className={`race-rider-overlay${!canEditLayout || layout.locked ? ' locked' : ''}${presentationScaled ? ' presentation-scaled' : ''}${editorPreview ? ' editor-preview' : ''}`}
      ref={overlayRef}
      aria-label={editorPreview ? 'Player card layout preview' : 'Race rider positions'}
      style={{
        '--overlay-x': `${layout.xPct * 100}%`,
        '--overlay-y': `${layout.yPct * 100}%`,
        '--overlay-width': `${layout.width}px`,
        '--overlay-height': `${layout.height}px`,
        '--rr-presentation-legibility-scale': presentationLegibilityScale,
        ...(presentationScaled ? {
          '--rr-font': `${16 * presentationLegibilityScale}px`,
          '--rr-compact-avatar': `${28 / normalizedPresentationScale}px`,
          '--rr-compact-toolbar': `${20 / normalizedPresentationScale}px`,
          '--rr-compact-place': `${21 / normalizedPresentationScale}px`,
          '--rr-compact-gap': `${3 / normalizedPresentationScale}px`,
          '--rr-compact-padding': `${3 / normalizedPresentationScale}px`,
          '--rr-portrait-avatar': `${52 / normalizedPresentationScale}px`,
          '--rr-portrait-toolbar': `${28 / normalizedPresentationScale}px`,
          '--rr-portrait-place': `${34 / normalizedPresentationScale}px`,
          '--rr-portrait-gap': `${4 / normalizedPresentationScale}px`,
          '--rr-portrait-padding': `${4 / normalizedPresentationScale}px`,
          '--rr-short-portrait-avatar': `${40 / normalizedPresentationScale}px`,
          '--rr-short-portrait-toolbar': `${20 / normalizedPresentationScale}px`,
          '--rr-short-portrait-place': `${26 / normalizedPresentationScale}px`,
          '--rr-short-portrait-gap': `${2 / normalizedPresentationScale}px`,
          '--rr-short-portrait-padding': `${2 / normalizedPresentationScale}px`,
        } : {}),
        '--race-overlay-min-height': `${raceRiderOverlayMinimumHeight(
          overlayRef.current?.parentElement?.clientWidth ?? 1366,
          overlayRef.current?.parentElement?.clientHeight ?? 1024,
          normalizedPresentationScale,
          layout.height,
          editorPreview,
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
          <span>{editorPreview ? 'Player card preview' : 'Rider positions'}</span>
          {canEditLayout && !layout.locked && <small>Drag to move / drag corner to resize</small>}
        </div>
        {canEditLayout ? (
          <button
            className="race-rider-overlay-lock"
            type="button"
            aria-pressed={layout.locked}
            aria-label={editorPreview
              ? layout.locked ? 'Resize cards' : 'Save and publish player cards'
              : layout.locked ? 'Unlock rider panel' : 'Lock rider panel position and size'}
            title={editorPreview
              ? layout.locked ? 'Unlock this preview to move and resize the player cards' : 'Save and publish these player card dimensions'
              : layout.locked ? 'Unlock rider panel' : 'Lock rider panel'}
            onPointerDown={(event) => {
              event.stopPropagation();
              onFullscreenInteraction();
            }}
            onClick={toggleLock}
          >
            {editorPreview
              ? layout.locked ? <Maximize2 size={15} /> : <Save size={15} />
              : layout.locked ? <Lock size={15} /> : <Unlock size={15} />}
            <span>{editorPreview
              ? layout.locked ? 'Resize cards' : 'Save & publish'
              : layout.locked ? 'Locked' : 'Lock panel'}</span>
          </button>
        ) : (
          <span className="race-rider-overlay-lock" aria-label="Rider panel locked">
            <Lock size={15} />
            <span>Locked</span>
          </span>
        )}
        {editorPreview && publishStatus !== 'idle' && (
          <span
            className={`race-rider-overlay-publish-status ${publishStatus}`}
            role="status"
            aria-live="polite"
          >
            {publishStatus === 'saving'
              ? 'Publishing…'
              : publishStatus === 'saved'
                ? 'Published to every device'
                : 'Saved here · cross-device publish will retry'}
          </span>
        )}
      </div>
      <div className="race-rider-overlay-grid">
        {displayedEntries.map((entry) => (
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
              <div className={`race-rider-overlay-identity${entry.name.trim().length > 18 ? ' has-long-name' : ''}`}>
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
        >
          <Maximize2 size={22} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
