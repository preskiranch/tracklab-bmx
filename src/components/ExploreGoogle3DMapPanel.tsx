import { useEffect, useMemo, useRef, useState } from 'react';
import {
  exploreCameraOffsetMeters,
  exploreRouteHeading,
  exploreRoutePoint,
  exploreRoutePoints,
  smoothExploreCameraPoint,
  smoothExploreHeading,
} from '../lib/explore';
import {
  loadGoogleMaps3DLibrary,
  type GoogleMap3DElement,
  type GoogleMaps3DLibrary,
  type GoogleMarker3DElement,
  type GooglePolyline3DElement,
} from '../lib/googleMaps';
import { elevatedPath } from '../lib/googleMaps3d';
import { formatExploreDistanceMeters } from '../units';
import {
  exploreGroupPositions,
  type ExploreMapPanelProps,
} from './ExploreMapPanel';

function explore3DRange(followZoom: number) {
  return Math.max(80, Math.min(25_000, 320 * (2 ** (18 - followZoom))));
}

function removeSceneElement(element: HTMLElement | null) {
  try {
    element?.remove();
  } catch {
    // A failed Google custom element can already be detached.
  }
}

export function ExploreGoogle3DMapPanel({
  group,
  route,
  distanceUnit,
  followZoom,
  cameraFollowPosition,
  showMapLabels,
  followTravelHeading,
}: ExploreMapPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GoogleMap3DElement | null>(null);
  const libraryRef = useRef<GoogleMaps3DLibrary | null>(null);
  const routeLineRef = useRef<GooglePolyline3DElement | null>(null);
  const endpointMarkersRef = useRef<GoogleMarker3DElement[]>([]);
  const riderMarkersRef = useRef(new Map<string, GoogleMarker3DElement>());
  const cameraCenterRef = useRef<{ lat: number; lng: number } | null>(null);
  const cameraTargetRef = useRef<{ lat: number; lng: number } | null>(null);
  const travelHeadingRef = useRef(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const routePoints = useMemo(
    () => exploreRoutePoints(route),
    [route.encodedPolyline, route.id],
  );

  useEffect(() => {
    let cancelled = false;
    let map: GoogleMap3DElement | null = null;
    let readinessTimer = 0;
    const listeners: Array<{ name: string; listener: EventListener }> = [];
    setStatus('loading');
    setError('');

    loadGoogleMaps3DLibrary()
      .then((library) => {
        if (cancelled || !containerRef.current || routePoints.length < 2) {
          return;
        }
        libraryRef.current = library;
        map = new library.Map3DElement({
          center: { ...routePoints[0], altitude: 0 },
          gestureHandling: 'NONE',
          heading: 0,
          mode: showMapLabels ? 'HYBRID' : 'SATELLITE',
          range: explore3DRange(followZoom),
          tilt: 55,
        });
        map.style.cssText = 'display:block;height:100%;width:100%';
        const steadyListener: EventListener = (event) => {
          if ((event as Event & { isSteady?: boolean }).isSteady !== false) {
            window.clearTimeout(readinessTimer);
            setStatus('ready');
          }
        };
        const errorListener: EventListener = () => {
          window.clearTimeout(readinessTimer);
          setError('Google photorealistic 3D could not render this route.');
          setStatus('error');
        };
        map.addEventListener('gmp-steadychange', steadyListener);
        map.addEventListener('gmp-error', errorListener);
        listeners.push(
          { name: 'gmp-steadychange', listener: steadyListener },
          { name: 'gmp-error', listener: errorListener },
        );
        containerRef.current.replaceChildren(map);
        mapRef.current = map;
        readinessTimer = window.setTimeout(() => {
          if (!cancelled) {
            setError('Google 3D took too long to load. Choose Google Satellite to continue.');
            setStatus('error');
          }
        }, 15_000);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Google 3D is unavailable.');
          setStatus('error');
        }
      });

    return () => {
      cancelled = true;
      window.clearTimeout(readinessTimer);
      listeners.forEach(({ name, listener }) => map?.removeEventListener(name, listener));
      removeSceneElement(routeLineRef.current);
      endpointMarkersRef.current.forEach(removeSceneElement);
      riderMarkersRef.current.forEach(removeSceneElement);
      endpointMarkersRef.current = [];
      riderMarkersRef.current.clear();
      routeLineRef.current = null;
      cameraCenterRef.current = null;
      cameraTargetRef.current = null;
      mapRef.current = null;
      libraryRef.current = null;
      containerRef.current?.replaceChildren();
    };
  }, [route.id, routePoints]);

  useEffect(() => {
    const map = mapRef.current;
    const library = libraryRef.current;
    if (!map || !library || status !== 'ready') {
      return;
    }
    removeSceneElement(routeLineRef.current);
    endpointMarkersRef.current.forEach(removeSceneElement);
    routeLineRef.current = new library.Polyline3DElement({
      altitudeMode: 'RELATIVE_TO_GROUND',
      drawsOccludedSegments: true,
      path: elevatedPath(routePoints),
      outerColor: '#17310a',
      outerWidth: 0.5,
      strokeColor: '#d8ff3e',
      strokeWidth: 8,
    });
    map.append(routeLineRef.current);
    const Marker = library.Marker3DElement ?? library.MarkerElement;
    endpointMarkersRef.current = Marker ? [
      new Marker({
        altitudeMode: 'RELATIVE_TO_GROUND',
        drawsWhenOccluded: true,
        label: 'S',
        position: { ...routePoints[0], altitude: 1 },
        sizePreserved: true,
        title: route.originLabel,
      }),
      new Marker({
        altitudeMode: 'RELATIVE_TO_GROUND',
        drawsWhenOccluded: true,
        label: 'F',
        position: { ...routePoints[routePoints.length - 1], altitude: 1 },
        sizePreserved: true,
        title: route.destinationLabel,
      }),
    ] : [];
    endpointMarkersRef.current.forEach((marker) => map.append(marker));
  }, [route.destinationLabel, route.originLabel, routePoints, status]);

  useEffect(() => {
    const map = mapRef.current;
    const library = libraryRef.current;
    if (!map || !library || status !== 'ready') {
      return;
    }
    map.mode = showMapLabels ? 'HYBRID' : 'SATELLITE';
    map.range = explore3DRange(followZoom);
    const visible = new Set(group.riders.map((rider) => rider.id));
    riderMarkersRef.current.forEach((marker, riderId) => {
      if (!visible.has(riderId)) {
        removeSceneElement(marker);
        riderMarkersRef.current.delete(riderId);
      }
    });
    const Marker = library.Marker3DElement ?? library.MarkerElement;
    const positions = exploreGroupPositions(group, route, routePoints);
    positions.forEach(({ rider, position }) => {
      let marker = riderMarkersRef.current.get(rider.id);
      if (!marker && Marker) {
        marker = new Marker({
          altitudeMode: 'RELATIVE_TO_GROUND',
          drawsWhenOccluded: true,
          label: `P${rider.playerId}`,
          position: { ...position, altitude: 1.5 },
          sizePreserved: true,
          title: rider.name,
          zIndex: 500 + rider.playerId,
        });
        map.append(marker);
        riderMarkersRef.current.set(rider.id, marker);
      } else if (marker) {
        marker.position = { ...position, altitude: 1.5 };
        marker.title = rider.name;
      }
    });
    if (positions.length === 0) {
      const center = routePoints[Math.floor(routePoints.length / 2)] ?? routePoints[0];
      map.center = { ...center, altitude: 0 };
      map.range = Math.max(explore3DRange(followZoom), route.distanceMeters * 1.35);
      return;
    }
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
    ) ?? positions[0].position;
    cameraTargetRef.current = center;
    if (!cameraCenterRef.current) {
      cameraCenterRef.current = center;
      map.center = { ...center, altitude: 0 };
    }
  }, [
    cameraFollowPosition,
    followTravelHeading,
    followZoom,
    group,
    route,
    routePoints,
    showMapLabels,
    status,
  ]);

  useEffect(() => {
    if (status !== 'ready') {
      return;
    }
    let frameRequest = 0;
    let previousAt = performance.now();
    let lastUpdateAt = 0;
    const updateCamera = (now: number) => {
      const map = mapRef.current;
      const current = cameraCenterRef.current;
      const target = cameraTargetRef.current;
      if (map && current && target && now - lastUpdateAt >= 32) {
        const elapsedMs = Math.min(250, Math.max(0, now - previousAt));
        const next = smoothExploreCameraPoint(current, target, elapsedMs);
        cameraCenterRef.current = next;
        map.center = { ...next, altitude: 0 };
        map.heading = smoothExploreHeading(
          map.heading ?? 0,
          followTravelHeading ? travelHeadingRef.current : 0,
          elapsedMs,
        );
        previousAt = now;
        lastUpdateAt = now;
      }
      frameRequest = requestAnimationFrame(updateCamera);
    };
    frameRequest = requestAnimationFrame(updateCamera);
    return () => cancelAnimationFrame(frameRequest);
  }, [followTravelHeading, status]);

  const leadRider = [...group.riders].sort((a, b) => b.distanceMeters - a.distanceMeters)[0];
  return (
    <section
      className={`explore-map-panel${group.riders.length === 0 ? ' preview' : ''}`}
      aria-label="Google photorealistic 3D Explore map"
    >
      <div className="explore-map-canvas" ref={containerRef} />
      {status === 'loading' && <div className="explore-map-status">Loading Google 3D…</div>}
      {status === 'error' && <div className="explore-map-status error">{error}</div>}
      <div className="explore-map-group-label">
        <strong>{group.riders.length === 0 ? 'Route preview' : group.riders.length === 1 ? leadRider?.name : `${group.riders.length} riders together`}</strong>
        <span>{group.riders.length === 0 ? 'Google photorealistic 3D' : `${formatExploreDistanceMeters(leadRider?.distanceMeters ?? 0, distanceUnit)} ridden`}</span>
      </div>
    </section>
  );
}
