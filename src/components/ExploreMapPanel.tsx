import { useEffect, useMemo, useRef, useState } from 'react';
import { loadGoogleMaps, loadGoogleStreetViewLibrary } from '../lib/googleMaps';
import {
  exploreCameraOffsetMeters,
  exploreRouteHeading,
  exploreRoutePoint,
  exploreRoutePoints,
  smoothExploreCameraPoint,
  type ExploreCameraFollowPosition,
  type ExploreViewportGroup,
} from '../lib/explore';
import type {
  GoogleMap,
  GoogleMarker,
  GoogleMapsRuntime,
  GooglePolyline,
  GoogleStreetViewPanorama,
} from '../lib/googleMaps';
import type { ExploreRoute as ExploreRouteModel, ExploreViewMode, TrackPoint } from '../types';
import { formatDistanceMeters } from '../units';

type ExploreMapPanelProps = {
  group: ExploreViewportGroup;
  route: ExploreRouteModel;
  distanceUnit: 'ft' | 'm';
  followZoom: number;
  cameraFollowPosition: ExploreCameraFollowPosition;
  showMapLabels: boolean;
  viewMode: ExploreViewMode;
  orbitEnabled: boolean;
  orbitSpeedDps: number;
};

type ExploreMarkerRefs = Map<string, GoogleMarker>;

function groupPositions(
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
  viewMode,
  orbitEnabled,
  orbitSpeedDps,
}: ExploreMapPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const streetContainerRef = useRef<HTMLDivElement | null>(null);
  const googleRef = useRef<GoogleMapsRuntime | null>(null);
  const mapRef = useRef<GoogleMap | null>(null);
  const streetViewRef = useRef<GoogleStreetViewPanorama | null>(null);
  const streetStatusListenerRef = useRef<{ remove: () => void } | null>(null);
  const streetRouteHeadingRef = useRef(0);
  const lastStreetDistanceRef = useRef<number | null>(null);
  const lastStreetUpdateAtRef = useRef(0);
  const routeLineRef = useRef<GooglePolyline | null>(null);
  const markerRefs = useRef<ExploreMarkerRefs>(new Map());
  const endpointMarkerRefs = useRef<GoogleMarker[]>([]);
  const cameraCenterRef = useRef<TrackPoint | null>(null);
  const cameraTargetRef = useRef<TrackPoint | null>(null);
  const lastFollowZoomRef = useRef<number | null>(null);
  const initialFollowZoomRef = useRef(followZoom);
  const initialShowMapLabelsRef = useRef(showMapLabels);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [streetStatus, setStreetStatus] = useState<'idle' | 'loading' | 'ready' | 'unavailable' | 'error'>('idle');
  const [error, setError] = useState('');
  const routePoints = useMemo(() => exploreRoutePoints(route), [route]);

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
        map.fitBounds(routeBounds, 70);
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
      streetStatusListenerRef.current?.remove();
      streetViewRef.current?.setVisible(false);
      streetStatusListenerRef.current = null;
      streetViewRef.current = null;
      lastStreetDistanceRef.current = null;
      lastStreetUpdateAtRef.current = 0;
      cameraCenterRef.current = null;
      cameraTargetRef.current = null;
      lastFollowZoomRef.current = null;
      mapRef.current = null;
      googleRef.current = null;
    };
  }, [route.id, route.destinationLabel, route.originLabel, routePoints]);

  useEffect(() => {
    if (status !== 'ready' || viewMode !== 'street') {
      streetViewRef.current?.setVisible(false);
      return;
    }
    let cancelled = false;
    setStreetStatus('loading');
    loadGoogleStreetViewLibrary()
      .then((google) => {
        const StreetViewPanorama = google.maps.StreetViewPanorama;
        if (
          cancelled
          || !StreetViewPanorama
          || !streetContainerRef.current
          || routePoints.length === 0
        ) {
          return;
        }
        googleRef.current = google;
        if (!streetViewRef.current) {
          const panorama = new StreetViewPanorama(streetContainerRef.current, {
            addressControl: false,
            clickToGo: false,
            disableDefaultUI: true,
            fullscreenControl: false,
            linksControl: false,
            motionTracking: false,
            panControl: false,
            position: routePoints[0],
            pov: {
              heading: exploreRouteHeading(routePoints, 0, route.distanceMeters),
              pitch: 0,
            },
            showRoadLabels: true,
            visible: true,
            zoomControl: false,
          });
          streetViewRef.current = panorama;
          streetStatusListenerRef.current = panorama.addListener('status_changed', () => {
            setStreetStatus(String(panorama.getStatus?.()) === 'OK' ? 'ready' : 'unavailable');
          });
        }
        streetViewRef.current.setVisible(true);
        setStreetStatus(
          String(streetViewRef.current.getStatus?.()) === 'OK' ? 'ready' : 'loading',
        );
      })
      .catch(() => {
        if (!cancelled) {
          setStreetStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [route.distanceMeters, route.id, routePoints, status, viewMode]);

  useEffect(() => {
    if (status !== 'ready') {
      return;
    }
    mapRef.current?.setOptions({
      clickableIcons: false,
      mapTypeId: showMapLabels ? 'hybrid' : 'satellite',
    });
  }, [showMapLabels, status]);

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

    const positions = groupPositions(group, route, routePoints);
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

    const zoomChanged = lastFollowZoomRef.current !== followZoom;
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
    const streetPosition = exploreRoutePoint(
      routePoints,
      averageDistanceMeters,
      route.distanceMeters,
    ) ?? riderCenter;
    const routeHeading = exploreRouteHeading(routePoints, averageDistanceMeters, route.distanceMeters);
    streetRouteHeadingRef.current = (
      routeHeading + (cameraFollowPosition === 'behind' ? 180 : 0)
    ) % 360;
    const panorama = streetViewRef.current;
    const now = window.performance.now();
    const lastStreetDistance = lastStreetDistanceRef.current;
    if (
      viewMode === 'street'
      && panorama
      && (
        lastStreetDistance == null
        || Math.abs(averageDistanceMeters - lastStreetDistance) >= 4
        || now - lastStreetUpdateAtRef.current >= 900
      )
    ) {
      panorama.setPosition(streetPosition);
      if (!orbitEnabled) {
        panorama.setPov({ heading: streetRouteHeadingRef.current, pitch: 0 });
      }
      lastStreetDistanceRef.current = averageDistanceMeters;
      lastStreetUpdateAtRef.current = now;
    }
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
    if (map.getZoom?.() !== followZoom) {
      map.setZoom?.(followZoom);
    }
    if (zoomChanged) {
      lastFollowZoomRef.current = followZoom;
    }
  }, [cameraFollowPosition, followZoom, group, orbitEnabled, route, routePoints, status, viewMode]);

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

      if (viewMode === 'satellite' && map && current && target && now - lastMapUpdateAt >= 32) {
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
  }, [status, viewMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (status !== 'ready' || !map) {
      return;
    }

    if (!orbitEnabled) {
      map.setHeading(0);
      if (viewMode === 'street' && streetViewRef.current) {
        streetViewRef.current.setPov({ heading: streetRouteHeadingRef.current, pitch: 0 });
      }
      return;
    }

    let frameRequest = 0;
    let previousAt = window.performance.now();
    let lastCameraUpdateAt = 0;
    const rotateCamera = (now: number) => {
      if (now - lastCameraUpdateAt >= 50) {
        const elapsedSeconds = Math.min(0.25, Math.max(0, now - previousAt) / 1_000);
        if (viewMode === 'street' && streetViewRef.current && streetStatus === 'ready') {
          const current = streetViewRef.current.getPov?.() ?? {
            heading: streetRouteHeadingRef.current,
            pitch: 0,
          };
          streetViewRef.current.setPov({
            heading: (current.heading + orbitSpeedDps * elapsedSeconds) % 360,
            pitch: current.pitch,
          });
        } else {
          map.setHeading(((map.getHeading?.() ?? 0) + orbitSpeedDps * elapsedSeconds) % 360);
        }
        previousAt = now;
        lastCameraUpdateAt = now;
      }
      frameRequest = window.requestAnimationFrame(rotateCamera);
    };

    frameRequest = window.requestAnimationFrame(rotateCamera);
    return () => window.cancelAnimationFrame(frameRequest);
  }, [orbitEnabled, orbitSpeedDps, status, streetStatus, viewMode]);

  const leadRider = [...group.riders].sort((a, b) => b.distanceMeters - a.distanceMeters)[0];

  return (
    <section
      className={`explore-map-panel${group.riders.length === 0 ? ' preview' : ''}`}
      aria-label={group.riders.length > 0
        ? `Explore map for ${group.riders.map((rider) => rider.name).join(', ')}`
        : 'Explore route preview'}
    >
      <div className="explore-map-canvas" ref={containerRef} />
      <div
        className={`explore-street-canvas${viewMode === 'street' && !['error', 'unavailable'].includes(streetStatus) ? ' active' : ''}`}
        ref={streetContainerRef}
      />
      {status === 'loading' && <div className="explore-map-status">Loading satellite view…</div>}
      {status === 'error' && <div className="explore-map-status error">{error || 'Satellite view is unavailable.'}</div>}
      {viewMode === 'street' && streetStatus === 'loading' && (
        <div className="explore-map-status">Opening Street View…</div>
      )}
      {viewMode === 'street' && ['error', 'unavailable'].includes(streetStatus) && (
        <div className="explore-map-status street-fallback">
          Street View is unavailable here. Satellite view continues.
        </div>
      )}
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
            : `${formatDistanceMeters(leadRider?.distanceMeters ?? 0, distanceUnit)} ridden`}
        </span>
      </div>
    </section>
  );
}
