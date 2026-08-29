import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { loadGoogleMaps } from '../lib/googleMaps';
import {
  exploreCameraOffsetMeters,
  exploreRouteHeading,
  exploreRoutePoint,
  exploreRoutePoints,
  smoothExploreCameraPoint,
  smoothExploreHeading,
  type ExploreCameraFollowPosition,
  type ExploreViewportGroup,
} from '../lib/explore';
import type {
  GoogleMap,
  GoogleMarker,
  GoogleMapsRuntime,
  GooglePolyline,
} from '../lib/googleMaps';
import type {
  ExploreDistanceUnit,
  ExploreRider,
  ExploreRoute as ExploreRouteModel,
  TrackPoint,
} from '../types';
import { formatExploreDistanceMeters } from '../units';

export type ExploreMapPanelProps = {
  group: ExploreViewportGroup;
  route: ExploreRouteModel;
  distanceUnit: ExploreDistanceUnit;
  followZoom: number;
  cameraFollowPosition: ExploreCameraFollowPosition;
  cameraFollowEnabled: boolean;
  showMapLabels: boolean;
  followTravelHeading: boolean;
  onLandmarkSelect: (placeId: string) => void;
  onCameraInteraction: () => void;
};

type ExploreRiderMarker = {
  setMap: (map: GoogleMap | null) => void;
  setPosition: (position: TrackPoint) => void;
  setRider: (rider: ExploreRider) => void;
};

type ExploreMarkerRefs = Map<string, ExploreRiderMarker>;

export type ExploreRiderPinPresentation = {
  element: HTMLDivElement;
  update: (rider: ExploreRider) => void;
};

const exploreRiderPinWidthPx = 32;
const exploreRiderPinHeightPx = 40;

export function useExploreCameraInteraction(onCameraInteraction: () => void) {
  const interactionActiveRef = useRef(false);
  const activePointerIdsRef = useRef(new Set<number>());
  const releaseTimerRef = useRef(0);

  const scheduleRelease = useCallback((delayMs = 350) => {
    window.clearTimeout(releaseTimerRef.current);
    releaseTimerRef.current = window.setTimeout(() => {
      interactionActiveRef.current = false;
    }, delayMs);
  }, []);

  const beginPointerInteraction = useCallback((pointerId: number) => {
    window.clearTimeout(releaseTimerRef.current);
    activePointerIdsRef.current.add(pointerId);
    interactionActiveRef.current = true;
    onCameraInteraction();
  }, [onCameraInteraction]);

  const endPointerInteraction = useCallback((pointerId: number) => {
    activePointerIdsRef.current.delete(pointerId);
    if (activePointerIdsRef.current.size === 0) {
      scheduleRelease();
    }
  }, [scheduleRelease]);

  const beginWheelInteraction = useCallback(() => {
    interactionActiveRef.current = true;
    onCameraInteraction();
    scheduleRelease(250);
  }, [onCameraInteraction, scheduleRelease]);

  useEffect(() => {
    const finishPointerInteraction = (event: PointerEvent) => {
      endPointerInteraction(event.pointerId);
    };
    window.addEventListener('pointerup', finishPointerInteraction, true);
    window.addEventListener('pointercancel', finishPointerInteraction, true);
    return () => {
      window.clearTimeout(releaseTimerRef.current);
      window.removeEventListener('pointerup', finishPointerInteraction, true);
      window.removeEventListener('pointercancel', finishPointerInteraction, true);
    };
  }, [endPointerInteraction]);

  return {
    beginPointerInteraction,
    beginWheelInteraction,
    interactionActiveRef,
  };
}

/**
 * Map SDK canvases can retain their portrait backing size when iOS rotates the
 * WKWebView into an activity. Refresh after the element, visual viewport, and
 * fullscreen layout have all settled instead of relying on a single resize.
 */
export function useExploreMapViewportRefresh(
  containerRef: RefObject<HTMLElement | null>,
  refresh: () => void,
  active: boolean,
) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!active) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;
    let firstFrame = 0;
    let secondFrame = 0;
    let settleTimer = 0;

    const performRefresh = () => {
      const bounds = container.getBoundingClientRect();
      if (bounds.width < 2 || bounds.height < 2) return;
      refreshRef.current();
    };
    const scheduleRefresh = () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      window.clearTimeout(settleTimer);
      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(performRefresh);
      });
      settleTimer = window.setTimeout(performRefresh, 320);
    };
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleRefresh);
    resizeObserver?.observe(container);
    window.addEventListener('resize', scheduleRefresh);
    window.addEventListener('orientationchange', scheduleRefresh);
    window.visualViewport?.addEventListener('resize', scheduleRefresh);
    document.addEventListener('fullscreenchange', scheduleRefresh);
    scheduleRefresh();

    return () => {
      resizeObserver?.disconnect();
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      window.clearTimeout(settleTimer);
      window.removeEventListener('resize', scheduleRefresh);
      window.removeEventListener('orientationchange', scheduleRefresh);
      window.visualViewport?.removeEventListener('resize', scheduleRefresh);
      document.removeEventListener('fullscreenchange', scheduleRefresh);
    };
  }, [active, containerRef]);
}

function exploreRiderInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?';
}

function safeRiderAccent(accent: string) {
  return /^#[0-9a-f]{3,8}$/i.test(accent.trim()) ? accent.trim() : '#7ade36';
}

function exploreRiderPinSvg(accent: string, playerId: number) {
  const color = safeRiderAccent(accent);
  const label = `P${Math.max(1, Math.min(4, Math.round(playerId)))}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${exploreRiderPinWidthPx}" height="${exploreRiderPinHeightPx}" viewBox="0 0 32 40" style="display:block;width:100%;height:100%"><path d="M16 1C7.7 1 1 7.7 1 16c0 11.4 15 23 15 23s15-11.6 15-23C31 7.7 24.3 1 16 1Z" fill="${color}" stroke="#fff" stroke-width="2"/><circle cx="16" cy="15.5" r="8" fill="#fff" fill-opacity=".94"/><text x="16" y="18.7" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" font-weight="900" fill="#101823">${label}</text></svg>`;
}

function exploreRiderPinDataUrl(accent: string, playerId: number) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(exploreRiderPinSvg(accent, playerId))}`;
}

export function createExploreRiderPinElement(rider: ExploreRider): ExploreRiderPinPresentation {
  const element = document.createElement('div');
  element.className = 'explore-map-rider-marker';
  element.style.cssText = 'display:flex;flex-direction:column;align-items:center;width:52px;pointer-events:none;filter:drop-shadow(0 3px 4px rgba(0,0,0,.48))';
  let signature = '';

  const update = (nextRider: ExploreRider) => {
    const nextSignature = [
      nextRider.name,
      nextRider.photoUrl ?? '',
      nextRider.accent,
      nextRider.playerId,
    ].join('|');
    if (nextSignature === signature) {
      return;
    }
    signature = nextSignature;
    element.title = nextRider.name;
    element.setAttribute('aria-label', `${nextRider.name} map position`);
    element.style.setProperty('--player-color', safeRiderAccent(nextRider.accent));

    const avatar = nextRider.photoUrl
      ? document.createElement('img')
      : document.createElement('span');
    const avatarSizePx = window.matchMedia('(max-width: 720px)').matches ? 40 : 44;
    avatar.className = 'explore-map-rider-avatar';
    avatar.style.cssText = `position:relative;z-index:2;display:grid;place-items:center;width:${avatarSizePx}px;height:${avatarSizePx}px;overflow:hidden;border:2px solid ${safeRiderAccent(nextRider.accent)};border-radius:50%;background:#101823;color:#fff;box-shadow:0 0 0 2px rgba(255,255,255,.92);font-size:12px;font-weight:900;line-height:1;object-fit:cover`;
    if (avatar instanceof HTMLImageElement) {
      avatar.alt = '';
      avatar.draggable = false;
      avatar.src = nextRider.photoUrl ?? '';
    } else {
      avatar.textContent = exploreRiderInitials(nextRider.name);
    }

    const pin = document.createElement('span');
    pin.className = 'explore-map-rider-pin';
    pin.style.cssText = 'position:relative;z-index:1;display:block;width:32px;height:40px;margin-top:-3px';
    pin.setAttribute('aria-hidden', 'true');
    pin.innerHTML = exploreRiderPinSvg(nextRider.accent, nextRider.playerId);
    element.replaceChildren(avatar, pin);
  };

  update(rider);
  return { element, update };
}

export function exploreGroupPositions(
  group: ExploreViewportGroup,
  route: ExploreRouteModel,
  points: TrackPoint[],
) {
  return group.riders.flatMap((rider) => {
    const position = exploreRoutePoint(points, rider.distanceMeters, route.distanceMeters);
    return position ? [{ rider, position }] : [];
  });
}

function createExploreRiderMarker(
  google: GoogleMapsRuntime,
  map: GoogleMap,
  position: TrackPoint,
  rider: ExploreRider,
  zIndex: number,
): ExploreRiderMarker {
  if (!google.maps.OverlayView) {
    let appearanceSignature = `${rider.name}|${rider.accent}|${rider.playerId}`;
    const marker = new google.maps.Marker({
      icon: {
        anchor: new google.maps.Point(exploreRiderPinWidthPx / 2, exploreRiderPinHeightPx),
        scaledSize: new google.maps.Size(exploreRiderPinWidthPx, exploreRiderPinHeightPx),
        url: exploreRiderPinDataUrl(rider.accent, rider.playerId),
      },
      map,
      position,
      title: rider.name,
      zIndex,
    });
    return {
      setMap: (nextMap) => marker.setMap(nextMap),
      setPosition: (nextPosition) => marker.setPosition(nextPosition),
      setRider: (nextRider) => {
        const nextSignature = `${nextRider.name}|${nextRider.accent}|${nextRider.playerId}`;
        if (nextSignature === appearanceSignature) {
          return;
        }
        appearanceSignature = nextSignature;
        marker.setTitle?.(nextRider.name);
        marker.setIcon({
          anchor: new google.maps.Point(exploreRiderPinWidthPx / 2, exploreRiderPinHeightPx),
          scaledSize: new google.maps.Size(exploreRiderPinWidthPx, exploreRiderPinHeightPx),
          url: exploreRiderPinDataUrl(nextRider.accent, nextRider.playerId),
        });
      },
    };
  }

  const overlay = new google.maps.OverlayView();
  const presentation = createExploreRiderPinElement(rider);
  const { element } = presentation;
  element.style.position = 'absolute';
  element.style.transform = 'translate3d(-50%, -100%, 0)';
  element.style.zIndex = String(zIndex);

  let markerPosition = position;
  const draw = () => {
    const pixel = overlay.getProjection()?.fromLatLngToDivPixel(
      new google.maps.LatLng(markerPosition.lat, markerPosition.lng),
    );
    if (!pixel) {
      return;
    }
    element.style.left = `${pixel.x}px`;
    element.style.top = `${pixel.y}px`;
  };
  overlay.onAdd = () => {
    const panes = overlay.getPanes();
    (panes?.overlayMouseTarget ?? panes?.floatPane ?? panes?.overlayLayer)?.appendChild(element);
    draw();
  };
  overlay.draw = draw;
  overlay.onRemove = () => element.remove();
  overlay.setMap(map);

  return {
    setMap: (nextMap) => overlay.setMap(nextMap),
    setPosition: (nextPosition) => {
      markerPosition = nextPosition;
      draw();
    },
    setRider: presentation.update,
  };
}

export function ExploreMapPanel({
  group,
  route,
  distanceUnit,
  followZoom,
  cameraFollowPosition,
  cameraFollowEnabled,
  showMapLabels,
  followTravelHeading,
  onLandmarkSelect,
  onCameraInteraction,
}: ExploreMapPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const googleRef = useRef<GoogleMapsRuntime | null>(null);
  const mapRef = useRef<GoogleMap | null>(null);
  const travelHeadingRef = useRef(0);
  const routeLineRef = useRef<GooglePolyline | null>(null);
  const markerRefs = useRef<ExploreMarkerRefs>(new Map());
  const endpointMarkerRefs = useRef<GoogleMarker[]>([]);
  const cameraCenterRef = useRef<TrackPoint | null>(null);
  const cameraTargetRef = useRef<TrackPoint | null>(null);
  const lastFollowZoomRef = useRef<number | null>(null);
  const initialFollowZoomRef = useRef(followZoom);
  const initialShowMapLabelsRef = useRef(showMapLabels);
  const initialHasRidersRef = useRef(group.riders.length > 0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  initialFollowZoomRef.current = followZoom;
  initialShowMapLabelsRef.current = showMapLabels;
  initialHasRidersRef.current = group.riders.length > 0;
  const routePoints = useMemo(
    () => exploreRoutePoints(route),
    [route.encodedPolyline, route.id],
  );
  const {
    beginPointerInteraction,
    beginWheelInteraction,
    interactionActiveRef,
  } = useExploreCameraInteraction(onCameraInteraction);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError('');

    loadGoogleMaps()
      .then((google) => {
        if (cancelled || !containerRef.current || routePoints.length === 0) {
          return;
        }
        googleRef.current = google;
        const map = new google.maps.Map(containerRef.current, {
          center: routePoints[0],
          clickableIcons: false,
          controlSize: 26,
          disableDefaultUI: true,
          fullscreenControl: false,
          gestureHandling: 'greedy',
          headingInteractionEnabled: true,
          keyboardShortcuts: true,
          mapTypeControl: false,
          mapTypeId: initialShowMapLabelsRef.current ? 'hybrid' : 'satellite',
          rotateControl: false,
          scaleControl: true,
          streetViewControl: false,
          tilt: 0,
          tiltInteractionEnabled: true,
          zoom: initialFollowZoomRef.current,
          zoomControl: false,
        });
        mapRef.current = map;
        routeLineRef.current = new google.maps.Polyline({
          clickable: false,
          map,
          path: routePoints,
          strokeColor: '#d8ff3e',
          strokeOpacity: 0.94,
          strokeWeight: 6,
          zIndex: 200,
        });
        endpointMarkerRefs.current = [
          new google.maps.Marker({
            icon: {
              fillColor: '#7ade36',
              fillOpacity: 1,
              path: google.maps.SymbolPath.CIRCLE,
              scale: 8,
              strokeColor: '#ffffff',
              strokeWeight: 3,
            },
            label: { color: '#0f172a', fontSize: '9px', fontWeight: '900', text: 'S' },
            map,
            position: routePoints[0],
            title: route.originLabel,
            zIndex: 250,
          }),
          new google.maps.Marker({
            icon: {
              fillColor: '#111827',
              fillOpacity: 1,
              path: google.maps.SymbolPath.CIRCLE,
              scale: 8,
              strokeColor: '#ffffff',
              strokeWeight: 3,
            },
            label: { color: '#ffffff', fontSize: '9px', fontWeight: '900', text: 'F' },
            map,
            position: routePoints[routePoints.length - 1],
            title: route.destinationLabel,
            zIndex: 250,
          }),
        ];
        const routeBounds = new google.maps.LatLngBounds();
        routePoints.forEach((point) => routeBounds.extend(point));
        if (!initialHasRidersRef.current) {
          map.fitBounds(routeBounds, 70);
        }
        lastFollowZoomRef.current = initialFollowZoomRef.current;
        setStatus('ready');
      })
      .catch((loadError: Error) => {
        if (!cancelled) {
          setError(loadError.message);
          setStatus('error');
        }
      });

    return () => {
      cancelled = true;
      routeLineRef.current?.setMap(null);
      endpointMarkerRefs.current.forEach((marker) => marker.setMap(null));
      markerRefs.current.forEach((marker) => marker.setMap(null));
      routeLineRef.current = null;
      endpointMarkerRefs.current = [];
      markerRefs.current.clear();
      cameraCenterRef.current = null;
      cameraTargetRef.current = null;
      lastFollowZoomRef.current = null;
      mapRef.current = null;
      googleRef.current = null;
    };
  }, [route.id, route.destinationLabel, route.originLabel, routePoints]);

  useEffect(() => {
    if (status !== 'ready') {
      return;
    }
    const map = mapRef.current;
    map?.setOptions({
      clickableIcons: showMapLabels,
      mapTypeId: showMapLabels ? 'hybrid' : 'satellite',
    });
    if (!map || !showMapLabels) {
      return undefined;
    }

    const landmarkListener = map.addListener('click', (event) => {
      const placeId = event?.placeId?.trim();
      if (!placeId) {
        return;
      }
      event?.stop?.();
      onLandmarkSelect(placeId);
    });

    return () => landmarkListener.remove();
  }, [onLandmarkSelect, showMapLabels, status]);

  useEffect(() => {
    const google = googleRef.current;
    const map = mapRef.current;
    if (!google || !map || status !== 'ready') {
      return;
    }

    const visible = new Set(group.riders.map((rider) => rider.id));
    markerRefs.current.forEach((marker, riderId) => {
      if (!visible.has(riderId)) {
        marker.setMap(null);
        markerRefs.current.delete(riderId);
      }
    });

    const positions = exploreGroupPositions(group, route, routePoints);
    positions.forEach(({ rider, position }) => {
      let marker = markerRefs.current.get(rider.id);
      if (!marker) {
        marker = createExploreRiderMarker(
          google,
          map,
          position,
          rider,
          500 + rider.playerId,
        );
        markerRefs.current.set(rider.id, marker);
      } else {
        marker.setPosition(position);
      }
      marker.setRider(rider);
    });

    if (positions.length === 0) {
      return;
    }
    const riderCenter = positions.reduce(
      (sum, { position }) => ({
        lat: sum.lat + position.lat / positions.length,
        lng: sum.lng + position.lng / positions.length,
      }),
      { lat: 0, lng: 0 },
    );
    const averageDistanceMeters = positions.reduce(
      (sum, { rider }) => sum + rider.distanceMeters / positions.length,
      0,
    );
    travelHeadingRef.current = exploreRouteHeading(
      routePoints,
      averageDistanceMeters,
      route.distanceMeters,
    );
    const center = exploreRoutePoint(
      routePoints,
      averageDistanceMeters + exploreCameraOffsetMeters(cameraFollowPosition, followZoom),
      route.distanceMeters,
    ) ?? riderCenter;
    cameraTargetRef.current = center;
    if (!cameraCenterRef.current) {
      cameraCenterRef.current = center;
      map.moveCamera?.({ center });
      if (!map.moveCamera) {
        map.setCenter?.(center);
      }
    }
  }, [
    cameraFollowPosition,
    cameraFollowEnabled,
    followZoom,
    group,
    route,
    routePoints,
    status,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!cameraFollowEnabled) {
      lastFollowZoomRef.current = null;
      return;
    }
    if (status !== 'ready' || !map || lastFollowZoomRef.current === followZoom) {
      return;
    }
    lastFollowZoomRef.current = followZoom;
    map.setZoom?.(followZoom);
  }, [cameraFollowEnabled, followZoom, status]);

  useEffect(() => {
    if (status !== 'ready') {
      return;
    }
    const center = mapRef.current?.getCenter?.()?.toJSON();
    if (center) {
      cameraCenterRef.current = center;
    }
  }, [cameraFollowEnabled, status]);

  useEffect(() => {
    if (status !== 'ready') {
      return;
    }

    let frameRequest = 0;
    let previousAt = window.performance.now();
    let lastMapUpdateAt = 0;
    const updateCamera = (now: number) => {
      const map = mapRef.current;
      const current = cameraCenterRef.current;
      const target = cameraTargetRef.current;

      if (map && interactionActiveRef.current) {
        const interactiveCenter = map.getCenter?.()?.toJSON();
        if (interactiveCenter) {
          cameraCenterRef.current = interactiveCenter;
        }
        previousAt = now;
        lastMapUpdateAt = now;
      } else if (map && current && target && now - lastMapUpdateAt >= 32) {
        const needsMovement = Math.abs(target.lat - current.lat) > 1e-8
          || Math.abs(target.lng - current.lng) > 1e-8;
        if (needsMovement) {
          const elapsedMs = Math.min(250, Math.max(0, now - previousAt));
          const next = smoothExploreCameraPoint(current, target, elapsedMs);
          cameraCenterRef.current = next;
          map.moveCamera?.({ center: next });
          if (!map.moveCamera) {
            map.setCenter?.(next);
          }
        }
        previousAt = now;
        lastMapUpdateAt = now;
      }
      frameRequest = window.requestAnimationFrame(updateCamera);
    };

    frameRequest = window.requestAnimationFrame(updateCamera);
    return () => window.cancelAnimationFrame(frameRequest);
  }, [status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!cameraFollowEnabled || status !== 'ready' || !map) {
      return;
    }

    let frameRequest = 0;
    let previousAt = window.performance.now();
    let lastCameraUpdateAt = 0;
    const alignCamera = (now: number) => {
      if (now - lastCameraUpdateAt >= 50) {
        const elapsedMs = Math.min(250, Math.max(0, now - previousAt));
        const current = map.getHeading?.() ?? 0;
        map.setHeading(smoothExploreHeading(
          current,
          followTravelHeading ? travelHeadingRef.current : 0,
          elapsedMs,
        ));
        previousAt = now;
        lastCameraUpdateAt = now;
      }
      frameRequest = window.requestAnimationFrame(alignCamera);
    };

    frameRequest = window.requestAnimationFrame(alignCamera);
    return () => window.cancelAnimationFrame(frameRequest);
  }, [cameraFollowEnabled, followTravelHeading, status]);

  useExploreMapViewportRefresh(containerRef, () => {
    const google = googleRef.current;
    const map = mapRef.current;
    if (!google || !map) return;
    const center = cameraCenterRef.current ?? map.getCenter?.()?.toJSON();
    const zoom = map.getZoom?.();
    google.maps.event?.trigger(map, 'resize');
    if (center) {
      map.moveCamera?.({ center, ...(Number.isFinite(zoom) ? { zoom } : {}) });
      if (!map.moveCamera) map.setCenter?.(center);
    }
  }, status === 'ready');

  const leadRider = [...group.riders].sort((a, b) => b.distanceMeters - a.distanceMeters)[0];

  return (
    <section
      className={`explore-map-panel${group.riders.length === 0 ? ' preview' : ''}`}
      aria-label={group.riders.length > 0
        ? `Explore map for ${group.riders.map((rider) => rider.name).join(', ')}`
        : 'Explore route preview'}
      onPointerDownCapture={(event) => beginPointerInteraction(event.pointerId)}
      onWheelCapture={beginWheelInteraction}
    >
      <div className="explore-map-canvas" ref={containerRef} />
      {status === 'loading' && <div className="explore-map-status">Loading satellite view…</div>}
      {status === 'error' && <div className="explore-map-status error">{error || 'Satellite view is unavailable.'}</div>}
      <div className="explore-map-group-label">
        <strong>
          {group.riders.length === 0
            ? 'Route preview'
            : group.riders.length === 1
              ? leadRider?.name
              : `${group.riders.length} riders together`}
        </strong>
        <span>
          {group.riders.length === 0
            ? 'Connect a Wattbike to place a rider'
            : `${formatExploreDistanceMeters(leadRider?.distanceMeters ?? 0, distanceUnit)} ridden`}
        </span>
      </div>
    </section>
  );
}
