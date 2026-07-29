import { useEffect, useMemo, useRef, useState } from 'react';
import { loadGoogleMaps } from '../lib/googleMaps';
import {
  exploreRoutePoint,
  exploreRoutePoints,
  type ExploreViewportGroup,
} from '../lib/explore';
import type {
  GoogleMap,
  GoogleMarker,
  GoogleMapsRuntime,
  GooglePolyline,
} from '../lib/googleMaps';
import type { ExploreRoute as ExploreRouteModel, TrackPoint } from '../types';
import { formatDistanceMeters } from '../units';

type ExploreMapPanelProps = {
  group: ExploreViewportGroup;
  route: ExploreRouteModel;
  distanceUnit: 'ft' | 'm';
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

export function ExploreMapPanel({ group, route, distanceUnit }: ExploreMapPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const googleRef = useRef<GoogleMapsRuntime | null>(null);
  const mapRef = useRef<GoogleMap | null>(null);
  const routeLineRef = useRef<GooglePolyline | null>(null);
  const markerRefs = useRef<ExploreMarkerRefs>(new Map());
  const endpointMarkerRefs = useRef<GoogleMarker[]>([]);
  const lastCameraAtRef = useRef(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
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
          gestureHandling: 'greedy',
          keyboardShortcuts: false,
          mapTypeControl: false,
          mapTypeId: 'satellite',
          renderingType: google.maps.RenderingType?.VECTOR,
          rotateControl: false,
          scaleControl: true,
          streetViewControl: false,
          tilt: 0,
          zoom: 18,
          zoomControl: true,
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
      mapRef.current = null;
      googleRef.current = null;
    };
  }, [route.id, route.destinationLabel, route.originLabel, routePoints]);

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

    const now = Date.now();
    if (positions.length === 0 || now - lastCameraAtRef.current < 450) {
      return;
    }
    lastCameraAtRef.current = now;
    if (positions.length === 1) {
      map.setCenter?.(positions[0].position);
      map.setZoom?.(18);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    positions.forEach(({ position }) => bounds.extend(position));
    map.fitBounds(bounds, 90);
  }, [group, route, routePoints, status]);

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
            : `${formatDistanceMeters(leadRider?.distanceMeters ?? 0, distanceUnit)} ridden`}
        </span>
      </div>
    </section>
  );
}
