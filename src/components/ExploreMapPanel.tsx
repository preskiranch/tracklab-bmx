import { useEffect, useMemo, useRef, useState } from 'react';
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
import type { ExploreDistanceUnit, ExploreRoute as ExploreRouteModel, TrackPoint } from '../types';
import { formatExploreDistanceMeters } from '../units';

export type ExploreMapPanelProps = {
  group: ExploreViewportGroup;
  route: ExploreRouteModel;
  distanceUnit: ExploreDistanceUnit;
  followZoom: number;
  cameraFollowPosition: ExploreCameraFollowPosition;
  showMapLabels: boolean;
  followTravelHeading: boolean;
  onLandmarkSelect: (placeId: string) => void;
};

type ExploreMarkerRefs = Map<string, GoogleMarker>;

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

export function ExploreMapPanel({
  group,
  route,
  distanceUnit,
  followZoom,
  cameraFollowPosition,
  showMapLabels,
  followTravelHeading,
  onLandmarkSelect,
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
          gestureHandling: 'none',
          keyboardShortcuts: false,
          mapTypeControl: false,
          mapTypeId: initialShowMapLabelsRef.current ? 'hybrid' : 'satellite',
          renderingType: google.maps.RenderingType?.VECTOR,
          rotateControl: false,
          scaleControl: true,
          streetViewControl: false,
          tilt: 0,
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
        marker = new google.maps.Marker({
          icon: {
            fillColor: rider.accent,
            fillOpacity: 1,
            path: google.maps.SymbolPath.CIRCLE,
            scale: 13,
            strokeColor: '#ffffff',
            strokeWeight: 4,
          },
          label: {
            color: '#07111f',
            fontSize: '11px',
            fontWeight: '900',
            text: `P${rider.playerId}`,
          },
          map,
          position,
          title: rider.name,
          zIndex: 500 + rider.playerId,
        });
        markerRefs.current.set(rider.id, marker);
      } else {
        marker.setPosition(position);
        marker.setTitle?.(rider.name);
      }
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
    followZoom,
    group,
    route,
    routePoints,
    status,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (status !== 'ready' || !map || lastFollowZoomRef.current === followZoom) {
      return;
    }
    lastFollowZoomRef.current = followZoom;
    map.setZoom?.(followZoom);
  }, [followZoom, status]);

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

      if (map && current && target && now - lastMapUpdateAt >= 32) {
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
    if (status !== 'ready' || !map) {
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
  }, [followTravelHeading, status]);

  const leadRider = [...group.riders].sort((a, b) => b.distanceMeters - a.distanceMeters)[0];

  return (
    <section
      className={`explore-map-panel${group.riders.length === 0 ? ' preview' : ''}`}
      aria-label={group.riders.length > 0
        ? `Explore map for ${group.riders.map((rider) => rider.name).join(', ')}`
        : 'Explore route preview'}
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
