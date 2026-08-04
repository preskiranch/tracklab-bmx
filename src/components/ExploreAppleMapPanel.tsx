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
  loadAppleMapKit,
  type AppleMapKitAnnotation,
  type AppleMapKitMap,
  type AppleMapKitOverlay,
  type AppleMapKitRuntime,
} from '../lib/appleMaps';
import { formatExploreDistanceMeters } from '../units';
import {
  exploreGroupPositions,
  type ExploreMapPanelProps,
  useExploreCameraInteraction,
} from './ExploreMapPanel';

function exploreAppleCameraDistance(followZoom: number) {
  return Math.max(70, Math.min(30_000, 300 * (2 ** (18 - followZoom))));
}

export function ExploreAppleMapPanel({
  group,
  route,
  distanceUnit,
  followZoom,
  cameraFollowPosition,
  cameraFollowEnabled,
  showMapLabels,
  followTravelHeading,
  onCameraInteraction,
}: ExploreMapPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<AppleMapKitMap | null>(null);
  const runtimeRef = useRef<AppleMapKitRuntime | null>(null);
  const routeLineRef = useRef<AppleMapKitOverlay | null>(null);
  const endpointMarkersRef = useRef<AppleMapKitAnnotation[]>([]);
  const riderMarkersRef = useRef(new Map<string, AppleMapKitAnnotation>());
  const cameraCenterRef = useRef<{ lat: number; lng: number } | null>(null);
  const cameraTargetRef = useRef<{ lat: number; lng: number } | null>(null);
  const travelHeadingRef = useRef(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
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
    let map: AppleMapKitMap | null = null;
    setStatus('loading');
    setError('');

    loadAppleMapKit()
      .then((runtime) => {
        if (cancelled || !containerRef.current || routePoints.length < 2) {
          return;
        }
        runtimeRef.current = runtime;
        map = new runtime.Map(containerRef.current, {
          cameraDistance: exploreAppleCameraDistance(followZoom),
          center: routePoints[0],
          isRotationEnabled: true,
          isScrollEnabled: true,
          isZoomEnabled: true,
          mapType: showMapLabels ? runtime.MapType.Hybrid : runtime.MapType.Satellite,
          rotation: 0,
          showsCompass: false,
          showsMapTypeControl: false,
          showsPointsOfInterest: showMapLabels,
          showsScale: true,
          showsZoomControl: false,
        });
        mapRef.current = map;
        setStatus('ready');
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Apple Satellite is unavailable.');
          setStatus('error');
        }
      });

    return () => {
      cancelled = true;
      map?.destroy?.();
      if (mapRef.current === map) {
        mapRef.current = null;
      }
      runtimeRef.current = null;
      routeLineRef.current = null;
      endpointMarkersRef.current = [];
      riderMarkersRef.current.clear();
      cameraCenterRef.current = null;
      cameraTargetRef.current = null;
      containerRef.current?.replaceChildren();
    };
  }, [route.id, routePoints]);

  useEffect(() => {
    const map = mapRef.current;
    const runtime = runtimeRef.current;
    if (!map || !runtime || status !== 'ready') {
      return;
    }
    if (routeLineRef.current) {
      map.removeOverlays?.([routeLineRef.current]);
    }
    if (endpointMarkersRef.current.length > 0) {
      map.removeAnnotations?.(endpointMarkersRef.current);
    }
    routeLineRef.current = new runtime.PolylineOverlay(routePoints, {
      style: new runtime.Style({
        lineCap: 'round',
        lineJoin: 'round',
        lineWidth: 6,
        strokeColor: '#d8ff3e',
      }),
    });
    map.addOverlay(routeLineRef.current);
    endpointMarkersRef.current = [
      new runtime.MarkerAnnotation(routePoints[0], {
        color: '#7ade36',
        glyphText: 'S',
        title: route.originLabel,
      }),
      new runtime.MarkerAnnotation(routePoints[routePoints.length - 1], {
        color: '#111827',
        glyphColor: '#ffffff',
        glyphText: 'F',
        title: route.destinationLabel,
      }),
    ];
    map.addAnnotations(endpointMarkersRef.current);
  }, [route.destinationLabel, route.originLabel, routePoints, status]);

  useEffect(() => {
    const map = mapRef.current;
    const runtime = runtimeRef.current;
    if (!map || !runtime || status !== 'ready') {
      return;
    }
    map.mapType = showMapLabels ? runtime.MapType.Hybrid : runtime.MapType.Satellite;
    map.showsPointsOfInterest = showMapLabels;
    const cameraDistance = exploreAppleCameraDistance(followZoom);
    if (cameraFollowEnabled) {
      map.setCameraDistanceAnimated?.(cameraDistance, false);
      if (!map.setCameraDistanceAnimated) {
        map.cameraDistance = cameraDistance;
      }
    }
    const visible = new Set(group.riders.map((rider) => rider.id));
    const removed: AppleMapKitAnnotation[] = [];
    riderMarkersRef.current.forEach((marker, riderId) => {
      if (!visible.has(riderId)) {
        removed.push(marker);
        riderMarkersRef.current.delete(riderId);
      }
    });
    if (removed.length > 0) {
      map.removeAnnotations?.(removed);
    }
    const positions = exploreGroupPositions(group, route, routePoints);
    positions.forEach(({ rider, position }) => {
      let marker = riderMarkersRef.current.get(rider.id);
      if (!marker) {
        marker = new runtime.MarkerAnnotation(position, {
          color: rider.accent,
          glyphColor: '#07111f',
          glyphText: `P${rider.playerId}`,
          title: rider.name,
        });
        map.addAnnotation(marker);
        riderMarkersRef.current.set(rider.id, marker);
      } else {
        marker.coordinate = position;
      }
    });
    if (positions.length === 0) {
      if (cameraFollowEnabled) {
        const center = routePoints[Math.floor(routePoints.length / 2)] ?? routePoints[0];
        const routeDistance = Math.max(cameraDistance, route.distanceMeters * 1.25);
        map.setCenterAnimated?.(center, false);
        if (!map.setCenterAnimated) {
          map.center = center;
        }
        map.setCameraDistanceAnimated?.(routeDistance, false);
        if (!map.setCameraDistanceAnimated) {
          map.cameraDistance = routeDistance;
        }
      }
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
      map.setCenterAnimated?.(center, false);
      if (!map.setCenterAnimated) {
        map.center = center;
      }
    }
  }, [
    cameraFollowPosition,
    cameraFollowEnabled,
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
    const center = mapRef.current?.center;
    if (center) {
      cameraCenterRef.current = center;
    }
  }, [cameraFollowEnabled, status]);

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
      if (map && interactionActiveRef.current) {
        if (map.center) {
          cameraCenterRef.current = map.center;
        }
        previousAt = now;
        lastUpdateAt = now;
      } else if (map && current && target && now - lastUpdateAt >= 32) {
        const elapsedMs = Math.min(250, Math.max(0, now - previousAt));
        const next = smoothExploreCameraPoint(current, target, elapsedMs);
        cameraCenterRef.current = next;
        map.setCenterAnimated?.(next, false);
        if (!map.setCenterAnimated) {
          map.center = next;
        }
        if (cameraFollowEnabled) {
          map.rotation = smoothExploreHeading(
            map.rotation ?? 0,
            followTravelHeading ? travelHeadingRef.current : 0,
            elapsedMs,
          );
        }
        previousAt = now;
        lastUpdateAt = now;
      }
      frameRequest = requestAnimationFrame(updateCamera);
    };
    frameRequest = requestAnimationFrame(updateCamera);
    return () => cancelAnimationFrame(frameRequest);
  }, [cameraFollowEnabled, followTravelHeading, status]);

  const leadRider = [...group.riders].sort((a, b) => b.distanceMeters - a.distanceMeters)[0];
  return (
    <section
      className={`explore-map-panel${group.riders.length === 0 ? ' preview' : ''}`}
      aria-label="Apple Satellite Explore map"
      onPointerDownCapture={(event) => beginPointerInteraction(event.pointerId)}
      onWheelCapture={beginWheelInteraction}
    >
      <div className="explore-map-canvas" ref={containerRef} />
      {status === 'loading' && <div className="explore-map-status">Loading Apple Satellite…</div>}
      {status === 'error' && <div className="explore-map-status error">{error}</div>}
      <div className="explore-map-group-label">
        <strong>{group.riders.length === 0 ? 'Route preview' : group.riders.length === 1 ? leadRider?.name : `${group.riders.length} riders together`}</strong>
        <span>{group.riders.length === 0 ? 'Apple satellite comparison' : `${formatExploreDistanceMeters(leadRider?.distanceMeters ?? 0, distanceUnit)} ridden`}</span>
      </div>
    </section>
  );
}
