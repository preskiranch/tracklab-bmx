import { useEffect, useRef, useState } from 'react';
import type {
  BikeSample,
  MappingEditMode,
  PlayerSlot,
  RiderState,
  SpeedUnit,
  TrackPoint,
  TrackRecord,
  TrackZone,
} from '../types';
import { formatSpeedFromKph, speedUnitLabel } from '../units';
import {
  loadGoogleMaps,
  mappedTrackRoute,
  riderLatLng,
  trackBoundsPoints,
  trackCenter,
  type GoogleMap,
  type GoogleMarker,
  type GoogleMapsEventListener,
  type GooglePolyline,
  type GoogleMapsRuntime,
  zonePolyline,
} from '../lib/googleMaps';

type GoogleMapsTrackLayerProps = {
  track: TrackRecord;
  activeZones: TrackZone[];
  riders: RiderState[];
  players: PlayerSlot[];
  samplesByDevice: Map<number, BikeSample>;
  speedUnit: SpeedUnit;
  earthAngle: number;
  mappingMode?: boolean;
  mappingEditMode?: MappingEditMode;
  draftPoints?: TrackPoint[];
  draftZonePoints?: TrackPoint[];
  onMappingPathPointAdd?: (point: TrackPoint) => void;
  onMappingZonePointAdd?: (point: TrackPoint) => void;
};

const zoneColors: Record<TrackZone['type'], string> = {
  pedal: '#4ade80',
  recovery: '#facc15',
  technical: '#38bdf8',
};
const drawSampleMeters = 1.2;

function distanceBetweenPoints(a: TrackPoint, b: TrackPoint) {
  const latScale = 111_320;
  const lngScale = Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180)) * 111_320;
  return Math.hypot((b.lng - a.lng) * lngScale, (b.lat - a.lat) * latScale);
}

export function GoogleMapsTrackLayer({
  track,
  activeZones,
  riders,
  players,
  samplesByDevice,
  speedUnit,
  earthAngle,
  mappingMode = false,
  mappingEditMode = 'draw',
  draftPoints = [],
  draftZonePoints = [],
  onMappingPathPointAdd,
  onMappingZonePointAdd,
}: GoogleMapsTrackLayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const googleRef = useRef<GoogleMapsRuntime | null>(null);
  const mapRef = useRef<GoogleMap | null>(null);
  const trackLineRef = useRef<GooglePolyline | null>(null);
  const zoneLinesRef = useRef<GooglePolyline[]>([]);
  const draftLineRef = useRef<GooglePolyline | null>(null);
  const draftMarkerRefs = useRef<GoogleMarker[]>([]);
  const mapListenerRefs = useRef<GoogleMapsEventListener[]>([]);
  const isDrawingRef = useRef(false);
  const lastDrawPointRef = useRef<TrackPoint | null>(null);
  const markerRefs = useRef<Map<number, GoogleMarker>>(new Map());
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    loadGoogleMaps()
      .then((google) => {
        if (cancelled || !containerRef.current) {
          return;
        }

        googleRef.current = google;
        const center = trackCenter(track);
        const map = new google.maps.Map(containerRef.current, {
          center,
          clickableIcons: false,
          disableDefaultUI: true,
          gestureHandling: 'greedy',
          heading: 24,
          mapTypeId: 'satellite',
          rotateControl: false,
          streetViewControl: false,
          tilt: earthAngle,
          zoom: 19,
        });
        mapRef.current = map;
        setStatus('ready');
      })
      .catch((loadError: Error) => {
        if (!cancelled) {
          setStatus('error');
          setError(loadError.message);
        }
      });

    return () => {
      cancelled = true;
      trackLineRef.current?.setMap(null);
      zoneLinesRef.current.forEach((line) => line.setMap(null));
      draftLineRef.current?.setMap(null);
      draftMarkerRefs.current.forEach((marker) => marker.setMap(null));
      mapListenerRefs.current.forEach((listener) => listener.remove());
      markerRefs.current.forEach((marker) => marker.setMap(null));
      trackLineRef.current = null;
      zoneLinesRef.current = [];
      draftLineRef.current = null;
      draftMarkerRefs.current = [];
      mapListenerRefs.current = [];
      markerRefs.current.clear();
      mapRef.current = null;
    };
  }, [track]);

  useEffect(() => {
    const google = googleRef.current;
    const map = mapRef.current;
    if (!google || !map) {
      return;
    }

    map.setTilt(Math.max(0, Math.min(67, earthAngle)));
    map.setHeading(24);
  }, [earthAngle]);

  useEffect(() => {
    const google = googleRef.current;
    const map = mapRef.current;
    if (!google || !map || status !== 'ready') {
      return;
    }

    trackLineRef.current?.setMap(null);
    zoneLinesRef.current.forEach((line) => line.setMap(null));
    zoneLinesRef.current = [];

    const bounds = new google.maps.LatLngBounds();
    trackBoundsPoints(track).forEach((point) => bounds.extend(point));
    map.fitBounds(bounds, 58);

    const savedRoute = mappedTrackRoute(track);
    if (savedRoute.length < 2) {
      trackLineRef.current = null;
      return;
    }

    trackLineRef.current = new google.maps.Polyline({
      map,
      path: savedRoute,
      strokeColor: '#d8ff3e',
      strokeOpacity: 0.88,
      strokeWeight: 5,
    });

    zoneLinesRef.current = activeZones
      .map((zone) => ({ zone, path: zonePolyline(track, zone) }))
      .filter(({ path }) => path.length > 1)
      .map(({ zone, path }) => new google.maps.Polyline({
        map,
        path,
        strokeColor: zoneColors[zone.type],
        strokeOpacity: 0.92,
        strokeWeight: 6,
      }));
  }, [activeZones, status, track]);

  useEffect(() => {
    const google = googleRef.current;
    const map = mapRef.current;
    if (!google || !map || status !== 'ready') {
      return;
    }

    draftLineRef.current?.setMap(null);
    draftMarkerRefs.current.forEach((marker) => marker.setMap(null));
    draftMarkerRefs.current = [];

    if (!mappingMode || draftPoints.length === 0) {
      draftLineRef.current = null;
      return;
    }

    if (draftPoints.length > 1) {
      draftLineRef.current = new google.maps.Polyline({
        map,
        path: draftPoints,
        strokeColor: '#d8ff3e',
        strokeOpacity: 0.96,
        strokeWeight: 5,
      });
    }

    const endpointMarkers = draftPoints.length === 0 ? [] : [
      new google.maps.Marker({
        icon: {
          fillColor: '#d8ff3e',
          fillOpacity: 1,
          path: google.maps.SymbolPath.CIRCLE,
          scale: 10,
          strokeColor: '#111827',
          strokeWeight: 2,
        },
        label: {
          color: '#111827',
          fontSize: '11px',
          fontWeight: '900',
          text: 'S',
        },
        map,
        optimized: true,
        position: draftPoints[0],
        title: 'Mapping start',
      }),
      ...(draftPoints.length > 1 ? [
        new google.maps.Marker({
          icon: {
            fillColor: '#d8ff3e',
            fillOpacity: 1,
            path: google.maps.SymbolPath.CIRCLE,
            scale: 10,
            strokeColor: '#111827',
            strokeWeight: 2,
          },
          label: {
            color: '#111827',
            fontSize: '11px',
            fontWeight: '900',
            text: 'F',
          },
          map,
          optimized: true,
          position: draftPoints[draftPoints.length - 1],
          title: 'Mapping finish',
        }),
      ] : []),
    ];

    const zoneMarkers = draftZonePoints.map((point, index) => new google.maps.Marker({
      icon: {
        fillColor: '#38bdf8',
        fillOpacity: 1,
        path: google.maps.SymbolPath.CIRCLE,
        scale: 10,
        strokeColor: '#111827',
        strokeWeight: 2,
      },
      label: {
        color: '#111827',
        fontSize: '11px',
        fontWeight: '900',
        text: String(index + 1),
      },
      map,
      optimized: true,
      position: point,
      title: `Mapping pin ${index + 1}`,
    }));

    draftMarkerRefs.current = [...endpointMarkers, ...zoneMarkers];
  }, [draftPoints, draftZonePoints, mappingMode, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') {
      return undefined;
    }

    mapListenerRefs.current.forEach((listener) => listener.remove());
    mapListenerRefs.current = [];
    isDrawingRef.current = false;
    lastDrawPointRef.current = null;
    map.setOptions({
      draggable: !mappingMode,
      draggableCursor: mappingMode ? 'crosshair' : undefined,
      gestureHandling: mappingMode ? 'none' : 'greedy',
    });

    if (!mappingMode) {
      return undefined;
    }

    const addDrawPoint = (point: TrackPoint) => {
      if (!onMappingPathPointAdd) {
        return;
      }

      const previous = lastDrawPointRef.current;
      if (previous && distanceBetweenPoints(previous, point) < drawSampleMeters) {
        return;
      }

      lastDrawPointRef.current = point;
      onMappingPathPointAdd(point);
    };

    mapListenerRefs.current = [
      map.addListener('mousedown', (event) => {
        const point = event.latLng?.toJSON();
        if (!point) {
          return;
        }

        if (mappingEditMode === 'zones') {
          onMappingZonePointAdd?.(point);
          return;
        }

        isDrawingRef.current = true;
        lastDrawPointRef.current = null;
        addDrawPoint(point);
      }),
      map.addListener('mousemove', (event) => {
        const point = event.latLng?.toJSON();
        if (!point || !isDrawingRef.current || mappingEditMode !== 'draw') {
          return;
        }

        addDrawPoint(point);
      }),
      map.addListener('mouseup', (event) => {
        const point = event.latLng?.toJSON();
        if (point && isDrawingRef.current && mappingEditMode === 'draw') {
          addDrawPoint(point);
        }

        isDrawingRef.current = false;
        lastDrawPointRef.current = null;
      }),
      map.addListener('click', (event) => {
        const point = event.latLng?.toJSON();
        if (point && mappingEditMode === 'zones') {
          onMappingZonePointAdd?.(point);
        }
      }),
    ];

    return () => {
      mapListenerRefs.current.forEach((listener) => listener.remove());
      mapListenerRefs.current = [];
      map.setOptions({
        draggable: true,
        draggableCursor: undefined,
        gestureHandling: 'greedy',
      });
    };
  }, [mappingEditMode, mappingMode, onMappingPathPointAdd, onMappingZonePointAdd, status]);

  useEffect(() => {
    const google = googleRef.current;
    const map = mapRef.current;
    if (!google || !map || status !== 'ready') {
      return;
    }

    const activePlayerIds = new Set(players.map((player) => player.id));
    markerRefs.current.forEach((marker, playerId) => {
      if (!activePlayerIds.has(playerId as PlayerSlot['id'])) {
        marker.setMap(null);
        markerRefs.current.delete(playerId);
      }
    });

    riders.forEach((rider) => {
      const player = players.find((slot) => slot.id === rider.playerId);
      if (!player) {
        return;
      }

      const sample = player.deviceId == null ? undefined : samplesByDevice.get(player.deviceId);
      const position = riderLatLng(track, rider.distance);
      const label = `${formatSpeedFromKph(sample?.speedKph, speedUnit)} ${speedUnitLabel(speedUnit)}`;
      const existing = markerRefs.current.get(player.id);

      if (!position) {
        existing?.setMap(null);
        markerRefs.current.delete(player.id);
        return;
      }

      if (existing) {
        existing.setPosition(position);
        return;
      }

      const marker = new google.maps.Marker({
        icon: {
          fillColor: player.accent,
          fillOpacity: 1,
          path: google.maps.SymbolPath.CIRCLE,
          scale: 12,
          strokeColor: '#ffffff',
          strokeWeight: 3,
        },
        label: {
          color: '#111827',
          fontSize: '12px',
          fontWeight: '900',
          text: `P${player.id}`,
        },
        map,
        optimized: true,
        position,
        title: `${player.name} / ${label}`,
      });
      markerRefs.current.set(player.id, marker);
    });
  }, [players, riders, samplesByDevice, speedUnit, status, track]);

  return (
    <>
      <div className="google-map-layer" ref={containerRef} />
      {status !== 'ready' && (
        <div className="google-map-status">
          <strong>{status === 'loading' ? 'Loading Google imagery' : 'Google imagery unavailable'}</strong>
          <span>{status === 'loading' ? 'Connecting to Google Maps satellite layer.' : error}</span>
        </div>
      )}
    </>
  );
}
