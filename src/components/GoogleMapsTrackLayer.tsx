import { useEffect, useRef, useState } from 'react';
import type {
  BikeSample,
  DistanceUnit,
  DraftTrackSplit,
  EarthCamera,
  MappingEditMode,
  MultiplayerRaceState,
  PlayerId,
  PlayerSlot,
  RaceState,
  RiderState,
  SpeedUnit,
  TrackPoint,
  TrackRecord,
  TrackSplitSection,
  TrackZone,
} from '../types';
import { formatDistanceMeters, formatSpeedFromKph, speedUnitLabel } from '../units';
import {
  loadGoogleMaps,
  mappedTrackRoute,
  mappedTrackRouteSegments,
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
import {
  distanceBetweenTrackPoints,
  pointAtRouteMeter,
  routeLengthWithDefaultSplitBranches,
  routeWithDefaultSplitBranches,
  splitSharedRouteSegments,
} from '../lib/trackMapping';

type GoogleMapsTrackLayerProps = {
  track: TrackRecord;
  activeZones: TrackZone[];
  riders: RiderState[];
  remoteRaceStates?: MultiplayerRaceState[];
  players: PlayerSlot[];
  samplesByDevice: Map<number, BikeSample>;
  speedUnit: SpeedUnit;
  distanceUnit: DistanceUnit;
  raceViewFullscreen?: boolean;
  raceState: RaceState;
  earthAngle: number;
  earthHeading: number;
  earthCenter: TrackPoint | null;
  earthZoom: number | null;
  mappingMode?: boolean;
  mappingEditMode?: MappingEditMode;
  draftPoints?: TrackPoint[];
  draftZoneMeters?: number[];
  draftZonePoints?: TrackPoint[];
  draftSplitSections?: TrackSplitSection[];
  draftRouteSplitSections?: TrackSplitSection[];
  draftSplitBuilder?: DraftTrackSplit | null;
  onEarthCameraChange?: (camera: Partial<EarthCamera>) => void;
  onMappingPathPointAdd?: (point: TrackPoint) => void;
  onMappingPathPointMove?: (index: number, point: TrackPoint) => void;
  onMappingPathPointRemove?: (index: number) => void;
  onMappingZonePointAdd?: (point: TrackPoint) => void;
  onMappingZonePointMove?: (index: number, point: TrackPoint) => void;
  onMappingZonePointRemove?: (index: number) => void;
  onMappingSplitPointAdd?: (point: TrackPoint) => void;
  onMappingSplitDrawEnd?: () => void;
};

const zoneColors: Record<TrackZone['type'], string> = {
  pedal: '#4ade80',
  recovery: '#facc15',
  technical: '#38bdf8',
};
const drawSampleMeters = 1.2;
const splitBranchMinInteriorPoints = 2;
const splitBranchEndpointSnapMeters = 8;
const riderIconByColor: Record<PlayerSlot['colorName'], string> = {
  lime: '/assets/rider-lime.png',
  red: '/assets/rider-red.png',
  blue: '/assets/rider-blue.png',
  yellow: '/assets/rider-yellow.png',
};
const riderCanvasSize = 58;
const riderDrawWidth = 38;
const riderDrawHeight = 45;
const riderDrawTop = -23;
const riderFrontTireInset = 1;
const riderGroundContactInset = 1;

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

function pointClose(a: TrackPoint | undefined, b: TrackPoint | null | undefined) {
  if (!b) {
    return true;
  }

  if (!a) {
    return false;
  }

  return distanceBetweenTrackPoints(a, b) < 0.5;
}

function branchWithSplitAndMerge(points: TrackPoint[], splitPoint: TrackPoint, mergePoint: TrackPoint) {
  const next = [...points];
  const firstPoint = next[0];
  if (!firstPoint || distanceBetweenTrackPoints(firstPoint, splitPoint) > 0.5) {
    next.unshift(splitPoint);
  }

  const lastPoint = next[next.length - 1];
  if (!lastPoint || distanceBetweenTrackPoints(lastPoint, mergePoint) > 0.5) {
    next.push(mergePoint);
  }

  return next;
}

function branchInteriorPoints(points: TrackPoint[], splitPoint: TrackPoint, mergePoint: TrackPoint) {
  return points.filter((point) => (
    distanceBetweenTrackPoints(point, splitPoint) > 0.5
    && distanceBetweenTrackPoints(point, mergePoint) > 0.5
  ));
}

function branchTouchesMerge(points: TrackPoint[], mergePoint: TrackPoint) {
  return points.some((point) => distanceBetweenTrackPoints(point, mergePoint) <= splitBranchEndpointSnapMeters);
}

function draftBranchPath(points: TrackPoint[], splitPoint: TrackPoint, mergePoint: TrackPoint) {
  const interiorPoints = branchInteriorPoints(points, splitPoint, mergePoint);
  if (interiorPoints.length === 0) {
    return [];
  }

  if (interiorPoints.length < splitBranchMinInteriorPoints || !branchTouchesMerge(points, mergePoint)) {
    return [splitPoint, ...interiorPoints];
  }

  return branchWithSplitAndMerge(interiorPoints, splitPoint, mergePoint);
}

function applyCamera(map: GoogleMap, cameraView: Partial<EarthCamera>) {
  const camera = {
    ...(cameraView.center ? { center: cameraView.center } : {}),
    ...(typeof cameraView.zoom === 'number' ? { zoom: cameraView.zoom } : {}),
    heading: normalizeHeading(cameraView.heading ?? 0),
    tilt: clampTilt(cameraView.angle ?? 0),
  };

  if (map.moveCamera) {
    map.moveCamera(camera);
    return;
  }

  map.setTilt(camera.tilt);
  map.setHeading(camera.heading);
  if (cameraView.center && map.setCenter) {
    map.setCenter(cameraView.center);
  }
  if (typeof cameraView.zoom === 'number' && map.setZoom) {
    map.setZoom(cameraView.zoom);
  }
}

function cameraCenterBelongsToTrack(camera: Partial<EarthCamera>, track: TrackRecord) {
  if (!camera.center) {
    return true;
  }

  const routePoints = trackBoundsPoints(track);
  if (routePoints.length === 0) {
    return true;
  }

  const nearestRoutePointMeters = Math.min(
    ...routePoints.map((point) => distanceBetweenTrackPoints(camera.center!, point)),
  );
  const allowedOffsetMeters = Math.max(750, track.lengthMeters * 2.5);
  return nearestRoutePointMeters <= allowedOffsetMeters;
}

function cameraForTrack(camera: Partial<EarthCamera>, track: TrackRecord) {
  if (cameraCenterBelongsToTrack(camera, track)) {
    return camera;
  }

  return {
    angle: camera.angle,
    heading: camera.heading,
    center: trackCenter(track),
  };
}

function refreshSatelliteTiles(google: GoogleMapsRuntime, map: GoogleMap, camera: Partial<EarthCamera>, track: TrackRecord) {
  map.setOptions({ mapTypeId: 'satellite' });
  google.maps.event?.trigger(map, 'resize');
  applyCamera(map, cameraForTrack({
    ...camera,
    center: camera.center ?? trackCenter(track),
  }, track));
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

function splitJunctionIcon(text: string, color = '#ff2d55') {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 42 42">
      <circle cx="21" cy="21" r="18" fill="${color}" fill-opacity="0.94" stroke="#ffffff" stroke-width="3"/>
      <circle cx="21" cy="21" r="9" fill="#111827" fill-opacity="0.88"/>
      <text x="21" y="25" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="12" font-weight="900" fill="#ffffff">${text}</text>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function finishLineIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="86" height="34" viewBox="0 0 86 34">
      <rect x="1" y="1" width="84" height="32" rx="7" fill="#111827" fill-opacity="0.94" stroke="#ffffff" stroke-width="1.5"/>
      <g transform="translate(12 7)">
        <rect width="4" height="4" fill="#ffffff"/>
        <rect x="4" y="4" width="4" height="4" fill="#ffffff"/>
        <rect y="8" width="4" height="4" fill="#ffffff"/>
        <rect x="4" y="12" width="4" height="4" fill="#ffffff"/>
        <rect x="8" width="4" height="4" fill="#ffffff"/>
        <rect x="12" y="4" width="4" height="4" fill="#ffffff"/>
        <rect x="8" y="8" width="4" height="4" fill="#ffffff"/>
        <rect x="12" y="12" width="4" height="4" fill="#ffffff"/>
      </g>
      <text x="54" y="22" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="12" font-weight="900" fill="#ffffff">FINISH</text>
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

function riderLeanBucket(rotationDegrees: number) {
  return Math.round(uprightRiderOrientation(rotationDegrees).leanDegrees / 2) * 2;
}

function riderFrontTireAnchorPoint(google: GoogleMapsRuntime, rotationDegrees: number) {
  const orientation = uprightRiderOrientation(rotationDegrees);
  const leanBucket = riderLeanBucket(rotationDegrees);
  const frontTireX = (riderDrawWidth / 2) - riderFrontTireInset;
  const groundY = riderDrawTop + riderDrawHeight - riderGroundContactInset;
  const localX = orientation.mirrored ? -frontTireX : frontTireX;
  const radians = (leanBucket * Math.PI) / 180;
  const anchorX = (riderCanvasSize / 2) + (localX * Math.cos(radians)) - (groundY * Math.sin(radians));
  const anchorY = (riderCanvasSize / 2) + (localX * Math.sin(radians)) + (groundY * Math.cos(radians));

  return new google.maps.Point(anchorX, anchorY);
}

function baseRiderIcon(google: GoogleMapsRuntime, player: PlayerSlot) {
  return {
    anchor: new google.maps.Point(38, 40),
    labelOrigin: new google.maps.Point(46, 13),
    scaledSize: new google.maps.Size(38, 43),
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
  const leanBucket = riderLeanBucket(rotationDegrees);
  const cacheKey = `${player.colorName}:${orientation.mirrored ? 'left' : 'right'}:${leanBucket}`;
  const cached = riderIconCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const image = await loadRiderImage(imageUrl);
  const canvas = document.createElement('canvas');
  const size = riderCanvasSize;
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
  context.drawImage(image, -riderDrawWidth / 2, riderDrawTop, riderDrawWidth, riderDrawHeight);

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
  labelText = `P${player.id}`,
  zIndex = 760 + player.id,
): RiderMapMarker {
  let iconVersion = 0;
  const marker = new google.maps.Marker({
    icon: baseRiderIcon(google, player),
    label: {
      color: '#ffffff',
      fontSize: '12px',
      fontWeight: '900',
      text: labelText,
    },
    map,
    optimized: false,
    position,
    title,
    zIndex,
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
          anchor: riderFrontTireAnchorPoint(google, nextRotation),
          labelOrigin: new google.maps.Point(52, 15),
          scaledSize: new google.maps.Size(riderCanvasSize, riderCanvasSize),
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
  remoteRaceStates = [],
  players,
  samplesByDevice,
  speedUnit,
  distanceUnit,
  raceViewFullscreen = false,
  raceState,
  earthAngle,
  earthHeading,
  earthCenter,
  earthZoom,
  mappingMode = false,
  mappingEditMode = 'draw',
  draftPoints = [],
  draftZoneMeters = [],
  draftZonePoints = [],
  draftSplitSections = [],
  draftRouteSplitSections,
  draftSplitBuilder = null,
  onEarthCameraChange,
  onMappingPathPointAdd,
  onMappingPathPointMove,
  onMappingPathPointRemove,
  onMappingZonePointAdd,
  onMappingZonePointMove,
  onMappingZonePointRemove,
  onMappingSplitPointAdd,
  onMappingSplitDrawEnd,
}: GoogleMapsTrackLayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const googleRef = useRef<GoogleMapsRuntime | null>(null);
  const mapRef = useRef<GoogleMap | null>(null);
  const trackLineRefs = useRef<GooglePolyline[]>([]);
  const zoneLinesRef = useRef<GooglePolyline[]>([]);
  const distanceLabelRefs = useRef<GoogleMarker[]>([]);
  const splitLineRefs = useRef<GooglePolyline[]>([]);
  const splitMarkerRefs = useRef<GoogleMarker[]>([]);
  const finishMarkerRef = useRef<GoogleMarker | null>(null);
  const draftLineRefs = useRef<GooglePolyline[]>([]);
  const draftSplitLineRefs = useRef<GooglePolyline[]>([]);
  const draftMarkerRefs = useRef<GoogleMarker[]>([]);
  const draftMarkerListenerRefs = useRef<GoogleMapsEventListener[]>([]);
  const mapListenerRefs = useRef<GoogleMapsEventListener[]>([]);
  const isDrawingRef = useRef(false);
  const lastDrawPointRef = useRef<TrackPoint | null>(null);
  const markerRefs = useRef<Map<number, RiderMapMarker>>(new Map());
  const remoteMarkerRefs = useRef<Map<string, RiderMapMarker>>(new Map());
  const cameraRef = useRef<Partial<EarthCamera>>({
    angle: earthAngle,
    heading: earthHeading,
    ...(earthCenter ? { center: earthCenter } : {}),
    ...(earthZoom != null ? { zoom: earthZoom } : {}),
  });
  const initialMapViewRef = useRef({
    track,
    earthAngle,
    earthHeading,
    earthCenter,
    earthZoom,
  });
  const suppressCameraSyncRef = useRef(false);
  const lastFitKeyRef = useRef('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError('');
    lastFitKeyRef.current = '';

    loadGoogleMaps()
      .then((google) => {
        if (cancelled || !containerRef.current) {
          return;
        }

        googleRef.current = google;
        const initialMapView = initialMapViewRef.current;
        const initialCamera = cameraForTrack({
          angle: initialMapView.earthAngle,
          heading: initialMapView.earthHeading,
          center: initialMapView.earthCenter ?? trackCenter(initialMapView.track),
          ...(initialMapView.earthZoom != null ? { zoom: initialMapView.earthZoom } : {}),
        }, initialMapView.track);
        const center = initialCamera.center ?? trackCenter(initialMapView.track);
        const map = new google.maps.Map(containerRef.current, {
          cameraControl: true,
          center,
          clickableIcons: false,
          controlSize: 30,
          disableDefaultUI: false,
          fullscreenControl: false,
          gestureHandling: 'greedy',
          heading: initialMapView.earthHeading,
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
          tilt: initialCamera.angle ?? initialMapView.earthAngle,
          zoomControl: true,
          zoom: initialCamera.zoom ?? 19,
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
      trackLineRefs.current.forEach((line) => line.setMap(null));
      zoneLinesRef.current.forEach((line) => line.setMap(null));
      distanceLabelRefs.current.forEach((marker) => marker.setMap(null));
      splitLineRefs.current.forEach((line) => line.setMap(null));
      splitMarkerRefs.current.forEach((marker) => marker.setMap(null));
      finishMarkerRef.current?.setMap(null);
      draftLineRefs.current.forEach((line) => line.setMap(null));
      draftSplitLineRefs.current.forEach((line) => line.setMap(null));
      draftMarkerRefs.current.forEach((marker) => marker.setMap(null));
      draftMarkerListenerRefs.current.forEach((listener) => listener.remove());
      mapListenerRefs.current.forEach((listener) => listener.remove());
      markerRefs.current.forEach((marker) => marker.setMap(null));
      remoteMarkerRefs.current.forEach((marker) => marker.setMap(null));
      trackLineRefs.current = [];
      zoneLinesRef.current = [];
      distanceLabelRefs.current = [];
      splitLineRefs.current = [];
      splitMarkerRefs.current = [];
      finishMarkerRef.current = null;
      draftLineRefs.current = [];
      draftSplitLineRefs.current = [];
      draftMarkerRefs.current = [];
      draftMarkerListenerRefs.current = [];
      mapListenerRefs.current = [];
      markerRefs.current.clear();
      remoteMarkerRefs.current.clear();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const nextCamera = cameraForTrack({
      angle: earthAngle,
      heading: earthHeading,
      ...(earthCenter ? { center: earthCenter } : {}),
      ...(earthZoom != null ? { zoom: earthZoom } : {}),
    }, track);
    cameraRef.current = nextCamera;
    const currentTilt = map.getTilt?.();
    const currentHeading = map.getHeading?.();
    const currentCenter = map.getCenter?.()?.toJSON();
    const currentZoom = map.getZoom?.();
    if (
      typeof currentTilt === 'number'
      && typeof currentHeading === 'number'
      && Math.abs(currentTilt - (nextCamera.angle ?? earthAngle)) < 0.75
      && headingDifference(currentHeading, nextCamera.heading ?? earthHeading) < 0.75
      && pointClose(currentCenter, nextCamera.center ?? null)
      && (nextCamera.zoom == null || (typeof currentZoom === 'number' && Math.abs(currentZoom - nextCamera.zoom) < 0.05))
    ) {
      return;
    }

    applyCamera(map, nextCamera);
  }, [earthAngle, earthCenter, earthHeading, earthZoom, track]);

  useEffect(() => {
    const google = googleRef.current;
    const map = mapRef.current;
    if (!google || !map || status !== 'ready') {
      return undefined;
    }

    const repaintCamera = cameraForTrack(cameraRef.current, track);
    const repaintTimers = [0, 90, 260, 700, 1400].map((delayMs) => (
      window.setTimeout(() => refreshSatelliteTiles(google, map, repaintCamera, track), delayMs)
    ));

    return () => {
      repaintTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [status, track.id]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready' || !onEarthCameraChange) {
      return undefined;
    }

    const syncCamera = () => {
      if (suppressCameraSyncRef.current) {
        return;
      }

      const nextCamera = {
        angle: Math.round(map.getTilt?.() ?? earthAngle),
        heading: normalizeHeading(Math.round(map.getHeading?.() ?? earthHeading)),
        center: map.getCenter?.()?.toJSON(),
        zoom: map.getZoom?.(),
        updatedAt: Date.now(),
      };
      cameraRef.current = nextCamera;
      onEarthCameraChange(nextCamera);
    };

    const listeners = [
      map.addListener('tilt_changed', syncCamera),
      map.addListener('heading_changed', syncCamera),
      map.addListener('zoom_changed', syncCamera),
      map.addListener('idle', syncCamera),
    ];

    return () => listeners.forEach((listener) => listener.remove());
  }, [earthAngle, earthHeading, onEarthCameraChange, status]);

  useEffect(() => {
    const google = googleRef.current;
    const map = mapRef.current;
    if (!google || !map || status !== 'ready') {
      return;
    }

    trackLineRefs.current.forEach((line) => line.setMap(null));
    zoneLinesRef.current.forEach((line) => line.setMap(null));
    distanceLabelRefs.current.forEach((marker) => marker.setMap(null));
    splitLineRefs.current.forEach((line) => line.setMap(null));
    splitMarkerRefs.current.forEach((marker) => marker.setMap(null));
    finishMarkerRef.current?.setMap(null);
    trackLineRefs.current = [];
    zoneLinesRef.current = [];
    distanceLabelRefs.current = [];
    splitLineRefs.current = [];
    splitMarkerRefs.current = [];
    finishMarkerRef.current = null;

    const fitKey = `${track.id}:${track.routeStatus ?? 'locator'}:${track.centerline?.length ?? 0}:${track.splitSections?.length ?? 0}`;
    if (lastFitKeyRef.current !== fitKey) {
      suppressCameraSyncRef.current = true;
      const savedTrackCamera = cameraForTrack(cameraRef.current, track);
      const hasSavedView = Boolean(savedTrackCamera.center && typeof savedTrackCamera.zoom === 'number');
      if (hasSavedView) {
        applyCamera(map, savedTrackCamera);
        window.requestAnimationFrame(() => applyCamera(map, savedTrackCamera));
      } else {
        const bounds = new google.maps.LatLngBounds();
        trackBoundsPoints(track).forEach((point) => bounds.extend(point));
        map.fitBounds(bounds, 58);
        const restoreCamera = () => {
          applyCamera(map, {
            angle: cameraRef.current.angle,
            heading: cameraRef.current.heading,
          });
        };
        restoreCamera();
        window.requestAnimationFrame(restoreCamera);
      }
      window.setTimeout(() => {
        applyCamera(map, cameraForTrack(cameraRef.current, track));
        suppressCameraSyncRef.current = false;
      }, 220);
      lastFitKeyRef.current = fitKey;
    }

    const savedRoute = mappedTrackRoute(track);
    if (savedRoute.length < 2) {
      trackLineRefs.current = [];
      return;
    }

    const hideRaceRoute = raceViewFullscreen || raceState === 'racing';

    if (!hideRaceRoute) {
      trackLineRefs.current = mappedTrackRouteSegments(track)
        .filter((segment) => segment.length > 1)
        .map((segment) => new google.maps.Polyline({
          map,
          path: segment,
          strokeColor: '#d8ff3e',
          strokeOpacity: 0.88,
          strokeWeight: 5,
        }));
    }

    const routeMidpoint = riderLatLng(track, track.lengthMeters / 2);
    if (routeMidpoint && !hideRaceRoute) {
      distanceLabelRefs.current.push(new google.maps.Marker({
        icon: {
          anchor: new google.maps.Point(54, 34),
          scaledSize: new google.maps.Size(108, 26),
          url: distanceLabelIcon(`Track ${formatDistanceMeters(track.lengthMeters, distanceUnit)}`),
        },
        map,
        optimized: false,
        position: routeMidpoint,
        title: `Track distance ${formatDistanceMeters(track.lengthMeters, distanceUnit)}`,
        zIndex: 500,
      }));
    }

    if (!hideRaceRoute && !mappingMode) {
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
    }

    if (!hideRaceRoute && !mappingMode) {
      (track.splitSections ?? []).forEach((section) => {
        section.branches.forEach((branch) => {
          if (branch.points.length < 2) {
            return;
          }

          splitLineRefs.current.push(new google.maps.Polyline({
            map,
            path: branch.points,
            strokeColor: branch.id === 'a' ? '#ff2d55' : '#38bdf8',
            strokeOpacity: 0.92,
            strokeWeight: 6,
          }));
        });

        splitMarkerRefs.current.push(new google.maps.Marker({
          icon: {
            anchor: new google.maps.Point(21, 21),
            scaledSize: new google.maps.Size(42, 42),
            url: splitJunctionIcon(`S${section.index}`, '#ff2d55'),
          },
          map,
          optimized: false,
          position: section.splitPoint,
          title: `Split ${section.index}`,
          zIndex: 760 + section.index,
        }));

        splitMarkerRefs.current.push(new google.maps.Marker({
          icon: {
            anchor: new google.maps.Point(21, 21),
            scaledSize: new google.maps.Size(42, 42),
            url: splitJunctionIcon(`M${section.index}`, '#38bdf8'),
          },
          map,
          optimized: false,
          position: section.mergePoint,
          title: `Merge ${section.index}`,
          zIndex: 770 + section.index,
        }));
      });
    }

    activeZones.forEach((zone, index) => {
      if (hideRaceRoute || mappingMode) {
        return;
      }

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

    const finishPosition = riderLatLng(track, track.lengthMeters);
    if (finishPosition) {
      finishMarkerRef.current = new google.maps.Marker({
        icon: {
          anchor: new google.maps.Point(43, 18),
          scaledSize: new google.maps.Size(86, 34),
          url: finishLineIcon(),
        },
        map,
        optimized: false,
        position: finishPosition,
        title: 'Finish line',
        zIndex: 820,
      });
    }
  }, [activeZones, distanceUnit, mappingMode, raceState, raceViewFullscreen, status, track]);

  useEffect(() => {
    const google = googleRef.current;
    const map = mapRef.current;
    if (!google || !map || status !== 'ready' || !raceViewFullscreen) {
      return undefined;
    }

    const route = mappedTrackRoute(track);
    if (route.length < 2) {
      return undefined;
    }

    const frameTimers: number[] = [];
    const releaseTimers: number[] = [];
    const frameRaceRoute = () => {
      const bounds = new google.maps.LatLngBounds();
      route.forEach((point) => bounds.extend(point));
      suppressCameraSyncRef.current = true;
      google.maps.event?.trigger(map, 'resize');
      map.fitBounds(bounds, 16);

      const restoreCamera = () => {
        applyCamera(map, cameraForTrack(cameraRef.current, track));
      };
      restoreCamera();
      window.requestAnimationFrame(restoreCamera);
      releaseTimers.push(window.setTimeout(() => {
        restoreCamera();
        suppressCameraSyncRef.current = false;
      }, 240));
    };

    [0, 180, 440].forEach((delayMs) => {
      frameTimers.push(window.setTimeout(frameRaceRoute, delayMs));
    });

    return () => {
      frameTimers.forEach((timer) => window.clearTimeout(timer));
      releaseTimers.forEach((timer) => window.clearTimeout(timer));
      suppressCameraSyncRef.current = false;
    };
  }, [raceViewFullscreen, status, track]);

  useEffect(() => {
    const google = googleRef.current;
    const map = mapRef.current;
    if (!google || !map || status !== 'ready') {
      return;
    }

    draftLineRefs.current.forEach((line) => line.setMap(null));
    draftSplitLineRefs.current.forEach((line) => line.setMap(null));
    draftMarkerRefs.current.forEach((marker) => marker.setMap(null));
    draftMarkerListenerRefs.current.forEach((listener) => listener.remove());
    draftLineRefs.current = [];
    draftSplitLineRefs.current = [];
    draftMarkerRefs.current = [];
    draftMarkerListenerRefs.current = [];

    if (!mappingMode && draftPoints.length === 0) {
      draftLineRefs.current = [];
      return;
    }

    const activeDraftRouteSplitSections = draftRouteSplitSections ?? draftSplitSections;
    const draftRoute = routeWithDefaultSplitBranches(draftPoints, activeDraftRouteSplitSections);
    const draftSharedSegments = splitSharedRouteSegments(draftPoints, activeDraftRouteSplitSections);
    if (mappingMode && draftPoints.length > 1) {
      draftLineRefs.current = draftSharedSegments
        .filter((segment) => segment.length > 1)
        .map((segment) => new google.maps.Polyline({
          map,
          path: segment,
          strokeColor: '#d8ff3e',
          strokeOpacity: 0.96,
          strokeWeight: 5,
        }));
    }

    const draftLengthMeters = routeLengthWithDefaultSplitBranches(draftPoints, activeDraftRouteSplitSections);
    const draftDistanceMarkers = mappingMode && draftPoints.length > 1 ? [
      new google.maps.Marker({
        icon: {
          anchor: new google.maps.Point(54, 34),
          scaledSize: new google.maps.Size(108, 26),
          url: distanceLabelIcon(`Track ${formatDistanceMeters(draftLengthMeters, distanceUnit)}`),
        },
        map,
        optimized: false,
        position: pointAtRouteMeter(draftRoute, draftLengthMeters / 2) ?? draftPoints[Math.floor(draftPoints.length / 2)],
        title: `Draft track distance ${formatDistanceMeters(draftLengthMeters, distanceUnit)}`,
        zIndex: 540,
      }),
    ] : [];

    const draftZoneBreaks = mappingMode && draftPoints.length > 1
      ? [0, ...draftZoneMeters.filter((meter) => meter > 0 && meter < draftLengthMeters), draftLengthMeters]
      : [];
    const draftZoneDistanceMarkers = draftZoneBreaks.slice(1).map((endMeter, index) => {
      const startMeter = draftZoneBreaks[index];
      const midpoint = pointAtRouteMeter(draftRoute, startMeter + (endMeter - startMeter) / 2);
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

    const pathPointMarkers = mappingMode ? draftPoints.map((point, index) => {
      const isStart = index === 0;
      const isFinish = index === draftPoints.length - 1 && draftPoints.length > 1;
      const marker = new google.maps.Marker({
        draggable: Boolean(onMappingPathPointMove),
        icon: {
          fillColor: isStart || isFinish ? '#d8ff3e' : '#ffffff',
          fillOpacity: 1,
          path: google.maps.SymbolPath.CIRCLE,
          scale: isStart || isFinish ? 11 : 8,
          strokeColor: '#111827',
          strokeWeight: 2,
        },
        label: {
          color: '#111827',
          fontSize: '11px',
          fontWeight: '900',
          text: isStart ? 'S' : isFinish ? 'F' : String(index + 1),
        },
        map,
        optimized: true,
        position: point,
        title: isStart ? 'Mapping start' : isFinish ? 'Mapping finish' : `Mapping point ${index + 1}`,
        zIndex: 620 + index,
      });

      if (onMappingPathPointMove) {
        draftMarkerListenerRefs.current.push(marker.addListener('dragend', (event) => {
          const nextPoint = event?.latLng?.toJSON();
          if (nextPoint) {
            onMappingPathPointMove(index, nextPoint);
          }
        }));
      }

      if (onMappingPathPointRemove) {
        const removePoint = () => onMappingPathPointRemove(index);
        draftMarkerListenerRefs.current.push(marker.addListener('dblclick', removePoint));
        draftMarkerListenerRefs.current.push(marker.addListener('rightclick', removePoint));
      }

      return marker;
    }) : [];

    const zoneMarkers = mappingMode ? draftZonePoints.map((point, index) => {
      const marker = new google.maps.Marker({
        draggable: Boolean(onMappingZonePointMove),
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
      });

      if (onMappingZonePointMove) {
        draftMarkerListenerRefs.current.push(marker.addListener('dragend', (event) => {
          const nextPoint = event?.latLng?.toJSON();
          if (nextPoint) {
            onMappingZonePointMove(index, nextPoint);
          }
        }));
      }

      if (onMappingZonePointRemove) {
        const removeZonePoint = () => onMappingZonePointRemove(index);
        draftMarkerListenerRefs.current.push(marker.addListener('dblclick', removeZonePoint));
        draftMarkerListenerRefs.current.push(marker.addListener('rightclick', removeZonePoint));
      }

      return marker;
    }) : [];

    const splitMarkers: GoogleMarker[] = [];
    const addDraftJunctionClick = (marker: GoogleMarker, point: TrackPoint, allowSplitTool = false) => {
      if (mappingEditMode === 'draw' && onMappingPathPointAdd) {
        draftMarkerListenerRefs.current.push(marker.addListener('click', () => {
          onMappingPathPointAdd(point);
        }));
        return;
      }

      if (allowSplitTool && mappingEditMode === 'split' && onMappingSplitPointAdd) {
        draftMarkerListenerRefs.current.push(marker.addListener('click', () => {
          onMappingSplitPointAdd(point);
        }));
      }
    };
    const renderDraftSplit = (section: TrackSplitSection, draft = false) => {
      section.branches.forEach((branch) => {
        if (branch.points.length < 2) {
          return;
        }

        draftSplitLineRefs.current.push(new google.maps.Polyline({
          map,
          path: branch.points,
          strokeColor: branch.id === 'a' ? '#ff2d55' : '#38bdf8',
          strokeOpacity: draft ? 0.96 : 0.82,
          strokeWeight: draft ? 7 : 5,
        }));
      });

      const splitMarker = new google.maps.Marker({
        icon: {
          anchor: new google.maps.Point(21, 21),
          scaledSize: new google.maps.Size(42, 42),
          url: splitJunctionIcon(`S${section.index}`, '#ff2d55'),
        },
        map,
        optimized: false,
        position: section.splitPoint,
        title: `Split ${section.index}`,
        zIndex: 800 + section.index,
      });
      splitMarkers.push(splitMarker);
      addDraftJunctionClick(splitMarker, section.splitPoint);

      const mergeMarker = new google.maps.Marker({
        icon: {
          anchor: new google.maps.Point(21, 21),
          scaledSize: new google.maps.Size(42, 42),
          url: splitJunctionIcon(`M${section.index}`, '#38bdf8'),
        },
        map,
        optimized: false,
        position: section.mergePoint,
        title: `Merge ${section.index}`,
        zIndex: 810 + section.index,
      });
      splitMarkers.push(mergeMarker);
      addDraftJunctionClick(mergeMarker, section.mergePoint);
    };

    if (mappingMode) {
      draftSplitSections.forEach((section) => renderDraftSplit(section));

      if (draftSplitBuilder?.splitPoint) {
        const branchA = draftSplitBuilder.mergePoint && draftSplitBuilder.branchA.length > 0
          ? draftBranchPath(draftSplitBuilder.branchA, draftSplitBuilder.splitPoint, draftSplitBuilder.mergePoint)
          : [];
        const branchB = draftSplitBuilder.mergePoint && draftSplitBuilder.branchB.length > 0
          ? draftBranchPath(draftSplitBuilder.branchB, draftSplitBuilder.splitPoint, draftSplitBuilder.mergePoint)
          : [];
        if (branchA.length > 1) {
          draftSplitLineRefs.current.push(new google.maps.Polyline({
            map,
            path: branchA,
            strokeColor: '#ff2d55',
            strokeOpacity: 0.98,
            strokeWeight: 7,
          }));
        }
        if (branchB.length > 1) {
          draftSplitLineRefs.current.push(new google.maps.Polyline({
            map,
            path: branchB,
            strokeColor: '#38bdf8',
            strokeOpacity: 0.98,
            strokeWeight: 7,
          }));
        }

        splitMarkers.push(new google.maps.Marker({
          icon: {
            anchor: new google.maps.Point(21, 21),
            scaledSize: new google.maps.Size(42, 42),
            url: splitJunctionIcon(`S${draftSplitBuilder.index}`, '#ff2d55'),
          },
          map,
          optimized: false,
          position: draftSplitBuilder.splitPoint,
          title: `Split ${draftSplitBuilder.index}`,
          zIndex: 880,
        }));

        const splitMarker = splitMarkers[splitMarkers.length - 1];
        addDraftJunctionClick(splitMarker, draftSplitBuilder.splitPoint, true);

        if (draftSplitBuilder.mergePoint) {
          splitMarkers.push(new google.maps.Marker({
            icon: {
              anchor: new google.maps.Point(21, 21),
              scaledSize: new google.maps.Size(42, 42),
              url: splitJunctionIcon(`M${draftSplitBuilder.index}`, '#38bdf8'),
            },
            map,
            optimized: false,
            position: draftSplitBuilder.mergePoint,
            title: `Merge ${draftSplitBuilder.index}`,
            zIndex: 881,
          }));

          const mergeMarker = splitMarkers[splitMarkers.length - 1];
          addDraftJunctionClick(mergeMarker, draftSplitBuilder.mergePoint, true);
        }
      }
    }

    draftMarkerRefs.current = [
      ...draftDistanceMarkers,
      ...draftZoneDistanceMarkers,
      ...pathPointMarkers,
      ...zoneMarkers,
      ...splitMarkers,
    ];
  }, [
    distanceUnit,
    draftPoints,
    draftRouteSplitSections,
    draftSplitBuilder,
    draftSplitSections,
    draftZoneMeters,
    draftZonePoints,
    mappingEditMode,
    mappingMode,
    onMappingPathPointAdd,
    onMappingPathPointMove,
    onMappingPathPointRemove,
    onMappingSplitPointAdd,
    onMappingZonePointMove,
    onMappingZonePointRemove,
    status,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') {
      return undefined;
    }

    mapListenerRefs.current.forEach((listener) => listener.remove());
    mapListenerRefs.current = [];
    isDrawingRef.current = false;
    lastDrawPointRef.current = null;
    const isSplitPlacementMode = mappingMode
      && mappingEditMode === 'split'
      && (!draftSplitBuilder?.splitPoint || !draftSplitBuilder?.mergePoint);
    const isSplitBranchDrawMode = mappingMode
      && mappingEditMode === 'split'
      && Boolean(draftSplitBuilder?.splitPoint && draftSplitBuilder.mergePoint);
    const isDrawMode = mappingMode && (mappingEditMode === 'draw' || isSplitBranchDrawMode);
    const isNavigateMode = !mappingMode || mappingEditMode === 'navigate';
    map.setOptions({
      draggable: !isDrawMode && !isSplitPlacementMode,
      draggableCursor: mappingMode && !isNavigateMode ? 'crosshair' : undefined,
      gestureHandling: 'greedy',
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

    const addSplitPoint = (point: TrackPoint) => {
      if (!onMappingSplitPointAdd) {
        return;
      }

      const previous = lastDrawPointRef.current;
      if (previous && distanceBetweenTrackPoints(previous, point) < drawSampleMeters) {
        return;
      }

      lastDrawPointRef.current = point;
      onMappingSplitPointAdd(point);
    };

    const finishSplitBranchDrawing = () => {
      if (!isDrawingRef.current || !isSplitBranchDrawMode) {
        return;
      }

      onMappingSplitDrawEnd?.();
      isDrawingRef.current = false;
      lastDrawPointRef.current = null;
    };

    window.addEventListener('mouseup', finishSplitBranchDrawing);
    window.addEventListener('touchend', finishSplitBranchDrawing);

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

        if (isSplitPlacementMode) {
          return;
        }

        if (isSplitBranchDrawMode) {
          isDrawingRef.current = true;
          lastDrawPointRef.current = null;
          addSplitPoint(point);
          return;
        }

        isDrawingRef.current = true;
        lastDrawPointRef.current = null;
        addDrawPoint(point);
      }),
      map.addListener('mousemove', (event) => {
        const point = event?.latLng?.toJSON();
        if (!point || !isDrawingRef.current) {
          return;
        }

        if (isSplitBranchDrawMode) {
          addSplitPoint(point);
          return;
        }

        if (mappingEditMode === 'draw') {
          addDrawPoint(point);
        }
      }),
      map.addListener('mouseup', (event) => {
        const point = event?.latLng?.toJSON();
        if (point && isDrawingRef.current) {
          if (isSplitBranchDrawMode) {
            addSplitPoint(point);
            finishSplitBranchDrawing();
          } else if (mappingEditMode === 'draw') {
            addDrawPoint(point);
          }
        }

        isDrawingRef.current = false;
        lastDrawPointRef.current = null;
      }),
      map.addListener('click', (event) => {
        const point = event?.latLng?.toJSON();
        if (point && mappingEditMode === 'zones') {
          onMappingZonePointAdd?.(point);
        }
        if (point && isSplitPlacementMode) {
          lastDrawPointRef.current = null;
          addSplitPoint(point);
        }
      }),
    ];

    return () => {
      window.removeEventListener('mouseup', finishSplitBranchDrawing);
      window.removeEventListener('touchend', finishSplitBranchDrawing);
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
  }, [
    mappingEditMode,
    mappingMode,
    draftSplitBuilder,
    onMappingPathPointAdd,
    onMappingSplitDrawEnd,
    onMappingSplitPointAdd,
    onMappingZonePointAdd,
    status,
  ]);

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

      const pose = riderRoutePose(track, rider.distance);
      const speedKph = rider.velocity > 0 ? rider.velocity * 3.6 : null;
      const label = `${formatSpeedFromKph(speedKph, speedUnit)} ${speedUnitLabel(speedUnit)}`;
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

  useEffect(() => {
    const google = googleRef.current;
    const map = mapRef.current;
    if (!google || !map || status !== 'ready') {
      return;
    }

    const activeRemoteKeys = new Set<string>();
    let remoteIndex = 0;

    remoteRaceStates.forEach((state) => {
      state.riders.forEach((rider) => {
        const markerKey = `${state.clientId}:${rider.id}`;
        activeRemoteKeys.add(markerKey);
        const pose = riderRoutePose(track, rider.distance);
        const existing = remoteMarkerRefs.current.get(markerKey);

        if (!pose) {
          existing?.setMap(null);
          remoteMarkerRefs.current.delete(markerKey);
          return;
        }

        const remotePlayer: PlayerSlot = {
          id: ((remoteIndex % 8) + 1) as PlayerId,
          name: rider.name,
          colorName: rider.colorName,
          accent: rider.accent,
          deviceId: null,
        };
        const labelText = `R${remoteIndex + 1}`;
        const speedKph = rider.speedKph ?? (rider.velocity > 0 ? rider.velocity * 3.6 : null);
        const label = `${formatSpeedFromKph(speedKph, speedUnit)} ${speedUnitLabel(speedUnit)}`;
        const rotation = riderScreenRotation(pose.bearing, earthHeading);
        const title = `${rider.name} / ${label} / remote`;

        if (existing) {
          existing.setPosition(pose.position);
          existing.setRotation(rotation);
          existing.setTitle(title);
        } else {
          const marker = createRiderMapMarker(
            google,
            map,
            remotePlayer,
            pose.position,
            rotation,
            title,
            labelText,
            900 + remoteIndex,
          );
          remoteMarkerRefs.current.set(markerKey, marker);
        }

        remoteIndex += 1;
      });
    });

    remoteMarkerRefs.current.forEach((marker, markerKey) => {
      if (!activeRemoteKeys.has(markerKey)) {
        marker.setMap(null);
        remoteMarkerRefs.current.delete(markerKey);
      }
    });
  }, [earthHeading, remoteRaceStates, speedUnit, status, track]);

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
