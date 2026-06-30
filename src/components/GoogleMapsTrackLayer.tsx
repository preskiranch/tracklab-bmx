import { useEffect, useRef, useState } from 'react';
import type {
  BikeSample,
  DistanceUnit,
  MappingEditMode,
  PlayerSlot,
  RiderState,
  SpeedUnit,
  TrackPoint,
  TrackRecord,
  TrackZone,
} from '../types';
import { formatDistanceMeters, formatSpeedFromKph, speedUnitLabel } from '../units';
import {
  loadGoogleMaps,
  mappedTrackRoute,
  pathLengthMeters,
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
import { pointAtRouteMeter } from '../lib/trackMapping';

type GoogleMapsTrackLayerProps = {
  track: TrackRecord;
  activeZones: TrackZone[];
  riders: RiderState[];
  players: PlayerSlot[];
  samplesByDevice: Map<number, BikeSample>;
  speedUnit: SpeedUnit;
  distanceUnit: DistanceUnit;
  earthAngle: number;
  earthHeading: number;
  mappingMode?: boolean;
  mappingEditMode?: MappingEditMode;
  draftPoints?: TrackPoint[];
  draftZoneMeters?: number[];
  draftZonePoints?: TrackPoint[];
  onEarthCameraChange?: (camera: { angle?: number; heading?: number }) => void;
  onMappingPathPointAdd?: (point: TrackPoint) => void;
  onMappingZonePointAdd?: (point: TrackPoint) => void;
};

const zoneColors: Record<TrackZone['type'], string> = {
  pedal: '#4ade80',
  recovery: '#facc15',
  technical: '#38bdf8',
};
const drawSampleMeters = 1.2;
const riderIconByColor: Record<PlayerSlot['colorName'], string> = {
  lime: '/assets/rider-lime.png',
  red: '/assets/rider-red.png',
  blue: '/assets/rider-blue.png',
  yellow: '/assets/rider-yellow.png',
};

function clampTilt(value: number) {
  return Math.max(0, Math.min(67, value));
}

function normalizeHeading(value: number) {
  return ((value % 360) + 360) % 360;
}

function applyCamera(map: GoogleMap, angle: number, heading: number) {
  const camera = {
    heading: normalizeHeading(heading),
    tilt: clampTilt(angle),
  };

  if (map.moveCamera) {
    map.moveCamera(camera);
    return;
  }

  map.setTilt(camera.tilt);
  map.setHeading(camera.heading);
}

function distanceBetweenPoints(a: TrackPoint, b: TrackPoint) {
  const latScale = 111_320;
  const lngScale = Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180)) * 111_320;
  return Math.hypot((b.lng - a.lng) * lngScale, (b.lat - a.lat) * latScale);
}

function distanceLabelIcon(text: string, color = '#111827') {
  const width = Math.max(86, text.length * 8 + 22);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="26" viewBox="0 0 ${width} 26">
      <rect x="1" y="1" width="${width - 2}" height="24" rx="6" fill="${color}" fill-opacity="0.92" stroke="#ffffff" stroke-width="1.4"/>
      <text x="${width / 2}" y="17" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="12" font-weight="800" fill="#ffffff">${text}</text>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export function GoogleMapsTrackLayer({
  track,
  activeZones,
  riders,
  players,
  samplesByDevice,
  speedUnit,
  distanceUnit,
  earthAngle,
  earthHeading,
  mappingMode = false,
  mappingEditMode = 'draw',
  draftPoints = [],
  draftZoneMeters = [],
  draftZonePoints = [],
  onEarthCameraChange,
  onMappingPathPointAdd,
  onMappingZonePointAdd,
}: GoogleMapsTrackLayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const googleRef = useRef<GoogleMapsRuntime | null>(null);
  const mapRef = useRef<GoogleMap | null>(null);
  const trackLineRef = useRef<GooglePolyline | null>(null);
  const zoneLinesRef = useRef<GooglePolyline[]>([]);
  const distanceLabelRefs = useRef<GoogleMarker[]>([]);
  const draftLineRef = useRef<GooglePolyline | null>(null);
  const draftMarkerRefs = useRef<GoogleMarker[]>([]);
  const mapListenerRefs = useRef<GoogleMapsEventListener[]>([]);
  const isDrawingRef = useRef(false);
  const lastDrawPointRef = useRef<TrackPoint | null>(null);
  const markerRefs = useRef<Map<number, GoogleMarker>>(new Map());
  const cameraRef = useRef({ angle: earthAngle, heading: earthHeading });
  const lastFitKeyRef = useRef('');
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
          cameraControl: true,
          center,
          clickableIcons: false,
          controlSize: 30,
          disableDefaultUI: false,
          fullscreenControl: false,
          gestureHandling: 'greedy',
          heading: earthHeading,
          headingInteractionEnabled: true,
          isFractionalZoomEnabled: true,
          keyboardShortcuts: true,
          mapId: google.maps.Map.DEMO_MAP_ID,
          mapTypeControl: false,
          mapTypeId: 'satellite',
          renderingType: google.maps.RenderingType?.VECTOR,
          rotateControl: true,
          scaleControl: true,
          streetViewControl: false,
          tiltInteractionEnabled: true,
          tilt: earthAngle,
          zoomControl: true,
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
      distanceLabelRefs.current.forEach((marker) => marker.setMap(null));
      draftLineRef.current?.setMap(null);
      draftMarkerRefs.current.forEach((marker) => marker.setMap(null));
      mapListenerRefs.current.forEach((listener) => listener.remove());
      markerRefs.current.forEach((marker) => marker.setMap(null));
      trackLineRef.current = null;
      zoneLinesRef.current = [];
      distanceLabelRefs.current = [];
      draftLineRef.current = null;
      draftMarkerRefs.current = [];
      mapListenerRefs.current = [];
      markerRefs.current.clear();
      mapRef.current = null;
    };
  }, [track]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    cameraRef.current = { angle: earthAngle, heading: earthHeading };
    applyCamera(map, earthAngle, earthHeading);
  }, [earthAngle, earthHeading]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready' || !onEarthCameraChange) {
      return undefined;
    }

    const syncCamera = () => {
      onEarthCameraChange({
        angle: Math.round(map.getTilt?.() ?? earthAngle),
        heading: Math.round(map.getHeading?.() ?? earthHeading),
      });
    };

    const listeners = [
      map.addListener('tilt_changed', syncCamera),
      map.addListener('heading_changed', syncCamera),
    ];

    return () => listeners.forEach((listener) => listener.remove());
  }, [earthAngle, earthHeading, onEarthCameraChange, status]);

  useEffect(() => {
    const google = googleRef.current;
    const map = mapRef.current;
    if (!google || !map || status !== 'ready') {
      return;
    }

    trackLineRef.current?.setMap(null);
    zoneLinesRef.current.forEach((line) => line.setMap(null));
    distanceLabelRefs.current.forEach((marker) => marker.setMap(null));
    zoneLinesRef.current = [];
    distanceLabelRefs.current = [];

    const fitKey = `${track.id}:${track.routeStatus ?? 'locator'}:${track.centerline?.length ?? 0}`;
    if (lastFitKeyRef.current !== fitKey) {
      const bounds = new google.maps.LatLngBounds();
      trackBoundsPoints(track).forEach((point) => bounds.extend(point));
      map.fitBounds(bounds, 58);
      const restoreCamera = () => {
        applyCamera(map, cameraRef.current.angle, cameraRef.current.heading);
      };
      restoreCamera();
      window.requestAnimationFrame(restoreCamera);
      lastFitKeyRef.current = fitKey;
    }

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

    const routeMidpoint = riderLatLng(track, track.lengthMeters / 2);
    if (routeMidpoint) {
      distanceLabelRefs.current.push(new google.maps.Marker({
        icon: {
          anchor: new google.maps.Point(54, 34),
          scaledSize: new google.maps.Size(108, 26),
          url: distanceLabelIcon(`Track ${formatDistanceMeters(pathLengthMeters(savedRoute, google), distanceUnit)}`),
        },
        map,
        optimized: false,
        position: routeMidpoint,
        title: `Track distance ${formatDistanceMeters(track.lengthMeters, distanceUnit)}`,
        zIndex: 500,
      }));
    }

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

    activeZones.forEach((zone, index) => {
      const position = riderLatLng(track, zone.startMeter + (zone.endMeter - zone.startMeter) / 2);
      if (!position) {
        return;
      }

      const distance = Math.max(0, zone.endMeter - zone.startMeter);
      distanceLabelRefs.current.push(new google.maps.Marker({
        icon: {
          anchor: new google.maps.Point(43, -4),
          scaledSize: new google.maps.Size(86, 26),
          url: distanceLabelIcon(`Z${index + 1} ${formatDistanceMeters(distance, distanceUnit)}`, zoneColors[zone.type]),
        },
        map,
        optimized: false,
        position,
        title: `${zone.name} ${formatDistanceMeters(distance, distanceUnit)}`,
        zIndex: 520,
      }));
    });
  }, [activeZones, distanceUnit, status, track]);

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

    const draftLengthMeters = pathLengthMeters(draftPoints, google);
    const draftDistanceMarkers = draftPoints.length > 1 ? [
      new google.maps.Marker({
        icon: {
          anchor: new google.maps.Point(54, 34),
          scaledSize: new google.maps.Size(108, 26),
          url: distanceLabelIcon(`Track ${formatDistanceMeters(draftLengthMeters, distanceUnit)}`),
        },
        map,
        optimized: false,
        position: pointAtRouteMeter(draftPoints, draftLengthMeters / 2) ?? draftPoints[Math.floor(draftPoints.length / 2)],
        title: `Draft track distance ${formatDistanceMeters(draftLengthMeters, distanceUnit)}`,
        zIndex: 540,
      }),
    ] : [];

    const draftZoneBreaks = draftPoints.length > 1
      ? [0, ...draftZoneMeters.filter((meter) => meter > 0 && meter < draftLengthMeters), draftLengthMeters]
      : [];
    const draftZoneDistanceMarkers = draftZoneBreaks.slice(1).map((endMeter, index) => {
      const startMeter = draftZoneBreaks[index];
      const midpoint = pointAtRouteMeter(draftPoints, startMeter + (endMeter - startMeter) / 2);
      if (!midpoint) {
        return null;
      }

      return new google.maps.Marker({
        icon: {
          anchor: new google.maps.Point(43, -4),
          scaledSize: new google.maps.Size(86, 26),
          url: distanceLabelIcon(`Z${index + 1} ${formatDistanceMeters(endMeter - startMeter, distanceUnit)}`, '#38bdf8'),
        },
        map,
        optimized: false,
        position: midpoint,
        title: `Draft zone ${index + 1} ${formatDistanceMeters(endMeter - startMeter, distanceUnit)}`,
        zIndex: 545,
      });
    }).filter((marker): marker is GoogleMarker => marker != null);

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

    draftMarkerRefs.current = [
      ...draftDistanceMarkers,
      ...draftZoneDistanceMarkers,
      ...endpointMarkers,
      ...zoneMarkers,
    ];
  }, [distanceUnit, draftPoints, draftZoneMeters, draftZonePoints, mappingMode, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') {
      return undefined;
    }

    mapListenerRefs.current.forEach((listener) => listener.remove());
    mapListenerRefs.current = [];
    isDrawingRef.current = false;
    lastDrawPointRef.current = null;
    const isDrawMode = mappingMode && mappingEditMode === 'draw';
    const isNavigateMode = !mappingMode || mappingEditMode === 'navigate';
    map.setOptions({
      draggable: !isDrawMode,
      draggableCursor: mappingMode && !isNavigateMode ? 'crosshair' : undefined,
      gestureHandling: isDrawMode ? 'none' : 'greedy',
      headingInteractionEnabled: isNavigateMode,
      tiltInteractionEnabled: isNavigateMode,
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
        const point = event?.latLng?.toJSON();
        if (!point) {
          return;
        }

        if (mappingEditMode === 'navigate') {
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
        const point = event?.latLng?.toJSON();
        if (!point || !isDrawingRef.current || mappingEditMode !== 'draw') {
          return;
        }

        addDrawPoint(point);
      }),
      map.addListener('mouseup', (event) => {
        const point = event?.latLng?.toJSON();
        if (point && isDrawingRef.current && mappingEditMode === 'draw') {
          addDrawPoint(point);
        }

        isDrawingRef.current = false;
        lastDrawPointRef.current = null;
      }),
      map.addListener('click', (event) => {
        const point = event?.latLng?.toJSON();
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
        headingInteractionEnabled: true,
        tiltInteractionEnabled: true,
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
          anchor: new google.maps.Point(24, 44),
          labelOrigin: new google.maps.Point(63, 15),
          scaledSize: new google.maps.Size(58, 66),
          url: riderIconByColor[player.colorName],
        },
        label: {
          color: '#ffffff',
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
