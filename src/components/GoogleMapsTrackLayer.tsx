import { useEffect, useRef, useState } from 'react';
import type {
  BikeSample,
  DistanceUnit,
  MappingEditMode,
  PlayerSlot,
  RaceState,
  RouteViewMode,
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
  trackStartPoint,
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
  raceViewFullscreen?: boolean;
  raceState: RaceState;
  earthAngle: number;
  earthHeading: number;
  routeViewMode: RouteViewMode;
  mappingMode?: boolean;
  mappingEditMode?: MappingEditMode;
  draftPoints?: TrackPoint[];
  draftZoneMeters?: number[];
  draftZonePoints?: TrackPoint[];
  onEarthCameraChange?: (camera: { angle?: number; heading?: number }) => void;
  onMappingPathPointAdd?: (point: TrackPoint) => void;
  onMappingPathPointMove?: (index: number, point: TrackPoint) => void;
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
  players,
  samplesByDevice,
  speedUnit,
  distanceUnit,
  raceViewFullscreen = false,
  raceState,
  earthAngle,
  earthHeading,
  routeViewMode,
  mappingMode = false,
  mappingEditMode = 'draw',
  draftPoints = [],
  draftZoneMeters = [],
  draftZonePoints = [],
  onEarthCameraChange,
  onMappingPathPointAdd,
  onMappingPathPointMove,
  onMappingZonePointAdd,
}: GoogleMapsTrackLayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const streetViewContainerRef = useRef<HTMLDivElement | null>(null);
  const googleRef = useRef<GoogleMapsRuntime | null>(null);
  const mapRef = useRef<GoogleMap | null>(null);
  const streetViewPanoramaRef = useRef<InstanceType<NonNullable<GoogleMapsRuntime['maps']['StreetViewPanorama']>> | null>(null);
  const streetViewServiceRef = useRef<InstanceType<NonNullable<GoogleMapsRuntime['maps']['StreetViewService']>> | null>(null);
  const streetViewRequestRef = useRef(0);
  const trackLineRef = useRef<GooglePolyline | null>(null);
  const zoneLinesRef = useRef<GooglePolyline[]>([]);
  const distanceLabelRefs = useRef<GoogleMarker[]>([]);
  const finishMarkerRef = useRef<GoogleMarker | null>(null);
  const draftLineRef = useRef<GooglePolyline | null>(null);
  const draftMarkerRefs = useRef<GoogleMarker[]>([]);
  const draftMarkerListenerRefs = useRef<GoogleMapsEventListener[]>([]);
  const mapListenerRefs = useRef<GoogleMapsEventListener[]>([]);
  const isDrawingRef = useRef(false);
  const lastDrawPointRef = useRef<TrackPoint | null>(null);
  const markerRefs = useRef<Map<number, RiderMapMarker>>(new Map());
  const cameraRef = useRef({ angle: earthAngle, heading: earthHeading });
  const suppressCameraSyncRef = useRef(false);
  const lastFitKeyRef = useRef('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [streetViewStatus, setStreetViewStatus] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');

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
      finishMarkerRef.current?.setMap(null);
      draftLineRef.current?.setMap(null);
      draftMarkerRefs.current.forEach((marker) => marker.setMap(null));
      draftMarkerListenerRefs.current.forEach((listener) => listener.remove());
      mapListenerRefs.current.forEach((listener) => listener.remove());
      markerRefs.current.forEach((marker) => marker.setMap(null));
      trackLineRef.current = null;
      zoneLinesRef.current = [];
      distanceLabelRefs.current = [];
      finishMarkerRef.current = null;
      draftLineRef.current = null;
      draftMarkerRefs.current = [];
      draftMarkerListenerRefs.current = [];
      mapListenerRefs.current = [];
      markerRefs.current.clear();
      mapRef.current = null;
      streetViewPanoramaRef.current = null;
      streetViewServiceRef.current = null;
    };
  }, [track]);

  useEffect(() => {
    const google = googleRef.current;
    const container = streetViewContainerRef.current;

    if (!google || !container || status !== 'ready' || routeViewMode !== 'street-view') {
      streetViewPanoramaRef.current?.setVisible(false);
      setStreetViewStatus('idle');
      return;
    }

    if (!google.maps.StreetViewPanorama || !google.maps.StreetViewService) {
      setStreetViewStatus('unavailable');
      return;
    }

    if (!streetViewPanoramaRef.current) {
      streetViewPanoramaRef.current = new google.maps.StreetViewPanorama(container, {
        addressControl: false,
        clickToGo: true,
        disableDefaultUI: false,
        enableCloseButton: false,
        fullscreenControl: false,
        linksControl: true,
        motionTracking: false,
        panControl: true,
        showRoadLabels: true,
        visible: false,
        zoomControl: true,
      });
    }

    if (!streetViewServiceRef.current) {
      streetViewServiceRef.current = new google.maps.StreetViewService();
    }

    const leadRider = riders.length > 0
      ? riders.reduce((leader, rider) => (rider.distance > leader.distance ? rider : leader), riders[0])
      : null;
    const riderPose = leadRider && (raceState === 'racing' || raceState === 'finished')
      ? riderRoutePose(track, leadRider.distance)
      : null;
    const startPoint = trackStartPoint(track);
    const position = riderPose?.position ?? startPoint;
    const heading = riderPose?.bearing ?? earthHeading;
    const requestId = streetViewRequestRef.current + 1;
    streetViewRequestRef.current = requestId;
    streetViewPanoramaRef.current?.setVisible(false);
    setStreetViewStatus('loading');

    streetViewServiceRef.current.getPanorama({ location: position, radius: 250 })
      .then((response) => {
        if (streetViewRequestRef.current !== requestId || routeViewMode !== 'street-view') {
          return;
        }

        const pano = response.data?.location?.pano;
        if (!pano) {
          streetViewPanoramaRef.current?.setVisible(false);
          setStreetViewStatus('unavailable');
          return;
        }

        streetViewPanoramaRef.current?.setPano(pano);
        streetViewPanoramaRef.current?.setPov({ heading, pitch: 0 });
        streetViewPanoramaRef.current?.setVisible(true);
        setStreetViewStatus('ready');
      })
      .catch(() => {
        if (streetViewRequestRef.current === requestId) {
          streetViewPanoramaRef.current?.setVisible(false);
          setStreetViewStatus('unavailable');
        }
      });
  }, [earthHeading, raceState, riders, routeViewMode, status, track]);

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
      if (suppressCameraSyncRef.current) {
        return;
      }

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
    finishMarkerRef.current?.setMap(null);
    zoneLinesRef.current = [];
    distanceLabelRefs.current = [];
    finishMarkerRef.current = null;

    const fitKey = `${track.id}:${track.routeStatus ?? 'locator'}:${track.centerline?.length ?? 0}`;
    if (lastFitKeyRef.current !== fitKey) {
      const bounds = new google.maps.LatLngBounds();
      trackBoundsPoints(track).forEach((point) => bounds.extend(point));
      suppressCameraSyncRef.current = true;
      map.fitBounds(bounds, 58);
      const restoreCamera = () => {
        applyCamera(map, cameraRef.current.angle, cameraRef.current.heading);
      };
      restoreCamera();
      window.requestAnimationFrame(restoreCamera);
      window.setTimeout(() => {
        restoreCamera();
        suppressCameraSyncRef.current = false;
      }, 220);
      lastFitKeyRef.current = fitKey;
    }

    const savedRoute = mappedTrackRoute(track);
    if (savedRoute.length < 2) {
      trackLineRef.current = null;
      return;
    }

    const hideRaceRoute = raceViewFullscreen || raceState === 'racing';

    if (!hideRaceRoute) {
      trackLineRef.current = new google.maps.Polyline({
        map,
        path: savedRoute,
        strokeColor: '#d8ff3e',
        strokeOpacity: 0.88,
        strokeWeight: 5,
      });
    }

    const routeMidpoint = riderLatLng(track, track.lengthMeters / 2);
    if (routeMidpoint && !hideRaceRoute) {
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

    if (!hideRaceRoute) {
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

    activeZones.forEach((zone, index) => {
      if (hideRaceRoute) {
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
  }, [activeZones, distanceUnit, raceState, raceViewFullscreen, status, track]);

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
        applyCamera(map, cameraRef.current.angle, cameraRef.current.heading);
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

    draftLineRef.current?.setMap(null);
    draftMarkerRefs.current.forEach((marker) => marker.setMap(null));
    draftMarkerListenerRefs.current.forEach((listener) => listener.remove());
    draftMarkerRefs.current = [];
    draftMarkerListenerRefs.current = [];

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

    const pathPointMarkers = draftPoints.map((point, index) => {
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

      return marker;
    });

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
      ...pathPointMarkers,
      ...zoneMarkers,
    ];
  }, [distanceUnit, draftPoints, draftZoneMeters, draftZonePoints, mappingMode, onMappingPathPointMove, status]);

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
      <div
        className={`street-view-layer${routeViewMode === 'street-view' && streetViewStatus === 'ready' ? ' active' : ''}`}
        ref={streetViewContainerRef}
      />
      {routeViewMode === 'street-view' && streetViewStatus !== 'ready' && (
        <div className="street-view-status">
          <strong>{streetViewStatus === 'loading' ? 'Finding Street View' : 'No Street View here'}</strong>
          <span>
            {streetViewStatus === 'loading'
              ? 'Checking for Google Street View imagery near this route point.'
              : 'Google only has Street View on covered public roads. Use satellite view, or move your custom route point closer to a covered road.'}
          </span>
        </div>
      )}
      {status !== 'ready' && (
        <div className="google-map-status">
          <strong>{status === 'loading' ? 'Loading Google imagery' : 'Google imagery unavailable'}</strong>
          <span>{status === 'loading' ? 'Connecting to Google Maps satellite layer.' : error}</span>
        </div>
      )}
    </>
  );
}
