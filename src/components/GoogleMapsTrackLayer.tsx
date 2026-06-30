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
  riderRoutePose,
  trackBoundsPoints,
  trackCenter,
  type GoogleMap,
  type GoogleMarker,
  type GoogleMapsEventListener,
  type GooglePolyline,
  type GoogleMapsRuntime,
  zonePolyline,
} from '../lib/googleMaps';
import { distanceBetweenTrackPoints, pointAtRouteMeter } from '../lib/trackMapping';

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

type RiderMapMarker = {
  setMap: (map: GoogleMap | null) => void;
  setPosition: (position: TrackPoint) => void;
  setRotation: (rotationDegrees: number) => void;
  setTitle: (title: string) => void;
};

const riderImagePromises = new Map<string, Promise<HTMLImageElement>>();
const riderIconCache = new Map<string, string>();

function clampTilt(value: number) {
  return Math.max(0, Math.min(67, value));
}

function normalizeHeading(value: number) {
  return ((value % 360) + 360) % 360;
}

function headingDifference(a: number, b: number) {
  const delta = Math.abs(normalizeHeading(a) - normalizeHeading(b));
  return Math.min(delta, 360 - delta);
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

function riderScreenRotation(routeBearing: number, mapHeading: number) {
  return normalizeHeading(routeBearing - mapHeading - 90);
}

function signedRotationDegrees(rotationDegrees: number) {
  const normalized = normalizeHeading(rotationDegrees);
  return normalized > 180 ? normalized - 360 : normalized;
}

function uprightRiderOrientation(rotationDegrees: number) {
  const signedRotation = signedRotationDegrees(rotationDegrees);
  const mirrored = Math.abs(signedRotation) > 90;
  const facingLean = mirrored
    ? signedRotation - Math.sign(signedRotation || 1) * 180
    : signedRotation;

  return {
    leanDegrees: Math.max(-24, Math.min(24, facingLean)),
    mirrored,
  };
}

function baseRiderIcon(google: GoogleMapsRuntime, player: PlayerSlot) {
  return {
    anchor: new google.maps.Point(34, 70),
    labelOrigin: new google.maps.Point(76, 21),
    scaledSize: new google.maps.Size(68, 76),
    url: riderIconByColor[player.colorName],
  };
}

function loadRiderImage(url: string) {
  const cached = riderImagePromises.get(url);
  if (cached) {
    return cached;
  }

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load rider image ${url}`));
    image.src = url;
  });
  riderImagePromises.set(url, promise);
  return promise;
}

async function uprightRiderIconUrl(player: PlayerSlot, rotationDegrees: number) {
  const imageUrl = riderIconByColor[player.colorName];
  const orientation = uprightRiderOrientation(rotationDegrees);
  const leanBucket = Math.round(orientation.leanDegrees / 2) * 2;
  const cacheKey = `${player.colorName}:${orientation.mirrored ? 'left' : 'right'}:${leanBucket}`;
  const cached = riderIconCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const image = await loadRiderImage(imageUrl);
  const canvas = document.createElement('canvas');
  const size = 104;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) {
    return imageUrl;
  }

  context.translate(size / 2, size / 2);
  context.rotate((leanBucket * Math.PI) / 180);
  context.scale(orientation.mirrored ? -1 : 1, 1);
  context.shadowColor = 'rgba(0, 0, 0, 0.35)';
  context.shadowBlur = 8;
  context.shadowOffsetY = 5;
  context.drawImage(image, -34, -39, 68, 78);

  const dataUrl = canvas.toDataURL('image/png');
  riderIconCache.set(cacheKey, dataUrl);
  return dataUrl;
}

function createRiderMapMarker(
  google: GoogleMapsRuntime,
  map: GoogleMap,
  player: PlayerSlot,
  position: TrackPoint,
  rotationDegrees: number,
  title: string,
): RiderMapMarker {
  let iconVersion = 0;
  const marker = new google.maps.Marker({
    icon: baseRiderIcon(google, player),
    label: {
      color: '#ffffff',
      fontSize: '12px',
      fontWeight: '900',
      text: `P${player.id}`,
    },
    map,
    optimized: false,
    position,
    title,
    zIndex: 760 + player.id,
  });

  const applyRotation = (nextRotation: number) => {
    iconVersion += 1;
    const version = iconVersion;
    void uprightRiderIconUrl(player, nextRotation)
      .then((url) => {
        if (version !== iconVersion) {
          return;
        }

        marker.setIcon({
          anchor: new google.maps.Point(52, 87),
          labelOrigin: new google.maps.Point(91, 24),
          scaledSize: new google.maps.Size(104, 104),
          url,
        });
      })
      .catch(() => {
        if (version === iconVersion) {
          marker.setIcon(baseRiderIcon(google, player));
        }
      });
  };

  applyRotation(rotationDegrees);

  return {
    setMap: (nextMap) => marker.setMap(nextMap),
    setPosition: (nextPosition) => marker.setPosition(nextPosition),
    setRotation: applyRotation,
    setTitle: (nextTitle) => {
      marker.setTitle?.(nextTitle);
    },
  };
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
  const markerRefs = useRef<Map<number, RiderMapMarker>>(new Map());
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
    const currentTilt = map.getTilt?.();
    const currentHeading = map.getHeading?.();
    if (
      typeof currentTilt === 'number'
      && typeof currentHeading === 'number'
      && Math.abs(currentTilt - earthAngle) < 0.75
      && headingDifference(currentHeading, earthHeading) < 0.75
    ) {
      return;
    }

    applyCamera(map, earthAngle, earthHeading);
  }, [earthAngle, earthHeading]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready' || !onEarthCameraChange) {
      return undefined;
    }

    const syncCamera = () => {
      const nextCamera = {
        angle: Math.round(map.getTilt?.() ?? earthAngle),
        heading: normalizeHeading(Math.round(map.getHeading?.() ?? earthHeading)),
      };
      cameraRef.current = nextCamera;
      onEarthCameraChange(nextCamera);
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
      if (previous && distanceBetweenTrackPoints(previous, point) < drawSampleMeters) {
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
      const pose = riderRoutePose(track, rider.distance);
      const label = `${formatSpeedFromKph(sample?.speedKph, speedUnit)} ${speedUnitLabel(speedUnit)}`;
      const existing = markerRefs.current.get(player.id);

      if (!pose) {
        existing?.setMap(null);
        markerRefs.current.delete(player.id);
        return;
      }

      const rotation = riderScreenRotation(pose.bearing, earthHeading);
      const title = `${player.name} / ${label}`;

      if (existing) {
        existing.setPosition(pose.position);
        existing.setRotation(rotation);
        existing.setTitle(title);
        return;
      }

      const marker = createRiderMapMarker(google, map, player, pose.position, rotation, title);
      markerRefs.current.set(player.id, marker);
    });
  }, [earthHeading, players, riders, samplesByDevice, speedUnit, status, track]);

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
