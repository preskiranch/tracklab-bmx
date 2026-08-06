import { useEffect, useRef, useState } from 'react';
import type {
  BikeSample,
  DistanceUnit,
  DraftTrackSplit,
  EarthCamera,
  GhostPlaybackRider,
  MappingEditMode,
  MultiplayerRaceState,
  PlayerId,
  PlayerSlot,
  RaceState,
  RiderState,
  SplitBranchChoice,
  SpeedUnit,
  TrackPoint,
  TrackRecord,
  TrackRouteVariantId,
  TrackSplitSection,
  TrackZone,
} from '../types';
import { formatDistanceMeters, formatSpeedFromKph, speedUnitLabel } from '../units';
import {
  loadGoogleMaps,
  mappedTrackRoute,
  mappedTrackRouteWithBranchSelections,
  mappedTrackRouteSegments,
  riderLatLng,
  riderRoutePose,
  trackBoundsPoints,
  trackCenter,
  type GoogleMap,
  type GoogleMarker,
  type GoogleMapsEventListener,
  type GoogleOverlayView,
  type GooglePolyline,
  type GoogleMapsRuntime,
  zonePolyline,
} from '../lib/googleMaps';
import {
  distanceBetweenTrackPoints,
  pointAtRouteMeter,
  routeLengthMeters,
  routeLengthWithDefaultSplitBranches,
  routeWithDefaultSplitBranches,
  routeWithSplitBranchSelections,
  splitSharedRouteSegments,
} from '../lib/trackMapping';
import {
  curveRawSampleMeters,
  preparedCurveStroke,
  samplePointsByDistance,
  smoothCurvePoints,
} from '../lib/trackCurve';
import { cStartVisualDistance, type CStartOffsetsByPlayer } from '../lib/bmxGateStart';
import {
  riderAnimationState,
  riderWheelFrameCount,
  type RiderAnimationState,
} from '../lib/riderAnimation';
import {
  riderCrankPedalPositions,
  riderLegKnee,
  riderRigGeometry,
  type RiderRigPoint,
} from '../lib/riderRig';
import {
  riderMarkerCanvasSize,
  riderMarkerDrawSize,
  riderMarkerDrawTop,
  riderMarkerMaximumShadowBlurPixels,
  riderMarkerShadowBlurPixels,
  riderMarkerShadowOffsetYPixels,
  riderScreenLaneOffsetsByPlayer,
  riderScreenLaneTranslation,
  uprightRiderOrientation,
} from '../lib/riderPresentation';
import {
  pedalZoneLabelAnchor,
  pedalZoneLabelPosition,
  pedalZoneLabelSizePixels,
} from '../lib/mapZoneLabels';

type GoogleMapsTrackLayerProps = {
  track: TrackRecord;
  activeZones: TrackZone[];
  riders: RiderState[];
  ghostRiders?: GhostPlaybackRider[];
  remoteRaceStates?: MultiplayerRaceState[];
  players: PlayerSlot[];
  samplesByDevice: Map<number, BikeSample>;
  speedUnit: SpeedUnit;
  distanceUnit: DistanceUnit;
  cStartOffsetsByPlayer?: CStartOffsetsByPlayer;
  raceViewFullscreen?: boolean;
  cameraLocked?: boolean;
  raceState: RaceState;
  raceDistanceMeters?: number;
  earthAngle: number;
  earthHeading: number;
  earthCenter: TrackPoint | null;
  earthZoom: number | null;
  mappingMode?: boolean;
  mappingEditMode?: MappingEditMode;
  mappingRouteVariantId?: TrackRouteVariantId;
  mappingZoneBranchChoice?: SplitBranchChoice;
  draftPoints?: TrackPoint[];
  draftZoneRoutePoints?: TrackPoint[];
  draftZoneSectionId?: string | null;
  draftZoneMeters?: number[];
  draftZonePoints?: TrackPoint[];
  draftReferenceZones?: TrackZone[];
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
  recovery: '#f97316',
  technical: '#38bdf8',
};
const pedalZoneColor = '#4ade80';
const routeVariantColors: Record<TrackRouteVariantId, string> = {
  amateur: '#d8ff3e',
  pro: '#38bdf8',
};
const drawSampleMeters = 1.2;
const splitBranchMinInteriorPoints = 2;
const splitBranchEndpointSnapMeters = 8;
const riderFallbackIconByColor: Record<PlayerSlot['colorName'], string> = {
  lime: '/assets/rider-lime.png',
  red: '/assets/rider-red.png',
  blue: '/assets/rider-blue.png',
  yellow: '/assets/rider-yellow.png',
};
const riderRigBaseByColor: Record<PlayerSlot['colorName'], string> = {
  lime: '/assets/rider-lime-rig-base.png',
  red: '/assets/rider-red-rig-base.png',
  blue: '/assets/rider-blue-rig-base.png',
  yellow: '/assets/rider-yellow-rig-base.png',
};
const riderFrontTireInset = 1;
const riderGroundContactInset = 1;
const riderLaneSpacingMeters = 1.1;
const riderLaneMaxSpreadMeters = 4.4;
const remoteRiderLaneOffsetBaseMeters = 3.2;
const remoteRiderLaneSpacingMeters = 0.7;
const savedRouteStrokeWeight = 6;
const mappingRouteHaloStrokeWeight = 25;
const mappingRouteCoreStrokeWeight = 7;
const mappingPedalZoneStrokeWeight = 14;
const mappingSplitBranchStrokeWeight = 11;
const racePedalZoneStrokeWeight = 10;
const defaultPedalZoneStrokeWeight = 11;
const finishStripeCoreStrokeWeight = mappingRouteCoreStrokeWeight / 2;
const finishStripeHaloStrokeWeight = finishStripeCoreStrokeWeight + 2;
const finishStripeWidthMeters = 9;
const finishLabelOffsetMeters = 8;

type RiderMapMarker = {
  setMap: (map: GoogleMap | null) => void;
  setLabel: (label: string) => void;
  setPosition: (position: TrackPoint) => void;
  setVisual: (
    rotationDegrees: number,
    animation: RiderAnimationState,
    laneOffsetPixels: number,
  ) => void;
  setTitle: (title: string) => void;
};

const riderImagePromises = new Map<string, Promise<HTMLImageElement>>();
const riderIconCache = new Map<string, string>();
const riderIconCacheMaxEntries = 768;

function cachedRiderIcon(cacheKey: string) {
  const cached = riderIconCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  riderIconCache.delete(cacheKey);
  riderIconCache.set(cacheKey, cached);
  return cached;
}

function rememberRiderIcon(cacheKey: string, dataUrl: string) {
  while (riderIconCache.size >= riderIconCacheMaxEntries) {
    const oldestKey = riderIconCache.keys().next().value;
    if (typeof oldestKey !== 'string') {
      break;
    }
    riderIconCache.delete(oldestKey);
  }
  riderIconCache.set(cacheKey, dataUrl);
}

function coastingRiderAnimation(distanceMeters: number): RiderAnimationState {
  return riderAnimationState({
    raceState: 'ready',
    distanceMeters,
    pedalPhase: 0,
    driveAllowed: false,
    driveSource: 'blocked',
    cadenceRpm: 0,
    watts: 0,
  });
}

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

function pointAtBearingDistance(point: TrackPoint, bearingDegrees: number, distanceMeters: number): TrackPoint {
  const radians = (bearingDegrees * Math.PI) / 180;
  const northMeters = Math.cos(radians) * distanceMeters;
  const eastMeters = Math.sin(radians) * distanceMeters;
  const latScale = 111_320;
  const lngScale = Math.cos(point.lat * (Math.PI / 180)) * latScale;

  return {
    lat: point.lat + (northMeters / latScale),
    lng: point.lng + (eastMeters / Math.max(1, lngScale)),
  };
}

function bearingBetweenPoints(start: TrackPoint, end: TrackPoint) {
  const startLat = start.lat * (Math.PI / 180);
  const endLat = end.lat * (Math.PI / 180);
  const deltaLng = (end.lng - start.lng) * (Math.PI / 180);
  const y = Math.sin(deltaLng) * Math.cos(endLat);
  const x = Math.cos(startLat) * Math.sin(endLat)
    - Math.sin(startLat) * Math.cos(endLat) * Math.cos(deltaLng);

  return ((Math.atan2(y, x) * (180 / Math.PI)) + 360) % 360;
}

function routeEndpointTangent(route: TrackPoint[], endpoint: 'start' | 'finish') {
  const endpointIndex = endpoint === 'start' ? 0 : route.length - 1;
  const endpointPoint = route[endpointIndex];
  if (!endpointPoint) {
    return null;
  }

  if (endpoint === 'start') {
    for (let index = 1; index < route.length; index += 1) {
      if (distanceBetweenTrackPoints(endpointPoint, route[index]) > 1) {
        return bearingBetweenPoints(endpointPoint, route[index]);
      }
    }
    return null;
  }

  for (let index = route.length - 2; index >= 0; index -= 1) {
    if (distanceBetweenTrackPoints(route[index], endpointPoint) > 1) {
      return bearingBetweenPoints(route[index], endpointPoint);
    }
  }

  return null;
}

function endpointStripePath(route: TrackPoint[], endpoint: 'start' | 'finish') {
  const endpointPoint = endpoint === 'start' ? route[0] : route[route.length - 1];
  const tangent = routeEndpointTangent(route, endpoint);
  if (!endpointPoint || tangent == null) {
    return null;
  }

  const crossBearing = normalizeHeading(tangent + 90);
  const halfWidth = finishStripeWidthMeters / 2;
  return [
    pointAtBearingDistance(endpointPoint, crossBearing, -halfWidth),
    pointAtBearingDistance(endpointPoint, crossBearing, halfWidth),
  ];
}

function startStripePath(route: TrackPoint[]) {
  return endpointStripePath(route, 'start');
}

function finishStripePath(route: TrackPoint[]) {
  return endpointStripePath(route, 'finish');
}

function finishLabelPosition(route: TrackPoint[]) {
  const finishPoint = route[route.length - 1];
  const tangent = routeEndpointTangent(route, 'finish');
  if (!finishPoint || tangent == null) {
    return finishPoint ?? null;
  }

  return pointAtBearingDistance(finishPoint, normalizeHeading(tangent + 90), finishLabelOffsetMeters);
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

function distanceLabelIcon(text: string) {
  const width = 168;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="40" viewBox="0 0 ${width} 40">
      <rect x="1" y="1" width="${width - 2}" height="38" rx="8" fill="#05070b" stroke="#ffffff" stroke-width="2"/>
      <text x="${width / 2}" y="26" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="16" font-weight="900" fill="#ffffff">${text}</text>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function routePointHandleIcon(label: string, color: string, selected: boolean) {
  const outerStroke = selected ? '#fbbf24' : '#ffffff';
  const ringWidth = selected ? 4 : 3;
  const radius = selected ? 16 : 14;
  const fontSize = label.length > 1 ? 11 : 13;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
      <circle cx="24" cy="24" r="23" fill="#ffffff" fill-opacity="0.01"/>
      <circle cx="24" cy="24" r="${radius + 3}" fill="#111827" fill-opacity="0.34"/>
      <circle cx="24" cy="24" r="${radius}" fill="${color}" fill-opacity="0.98" stroke="${outerStroke}" stroke-width="${ringWidth}"/>
      <text x="24" y="29" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="${fontSize}" font-weight="900" fill="#111827">${label}</text>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function pedalZoneNumberIcon(zoneNumber: number) {
  const text = String(zoneNumber);
  const fontSize = text.length > 1 ? 11 : 13;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30">
      <circle cx="15" cy="15" r="13" fill="${pedalZoneColor}" fill-opacity="0.96" stroke="#ffffff" stroke-width="2"/>
      <circle cx="15" cy="15" r="13" fill="none" stroke="#111827" stroke-opacity="0.32" stroke-width="1"/>
      <text x="15" y="19" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="${fontSize}" font-weight="900" fill="#111827">${text}</text>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function offsetTrackPoint(point: TrackPoint, bearingDegrees: number, meters: number): TrackPoint {
  const earthRadiusMeters = 6371008.8;
  const angularDistance = meters / earthRadiusMeters;
  const bearing = bearingDegrees * (Math.PI / 180);
  const lat1 = point.lat * (Math.PI / 180);
  const lng1 = point.lng * (Math.PI / 180);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance)
    + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
  );

  return {
    lat: lat2 * (180 / Math.PI),
    lng: lng2 * (180 / Math.PI),
  };
}

function riderLaneOffsetsByPlayer(players: PlayerSlot[]) {
  const sortedPlayers = [...players].sort((a, b) => a.id - b.id);
  const offsetByPlayer = new Map<PlayerId, number>();
  if (sortedPlayers.length <= 1) {
    sortedPlayers.forEach((player) => offsetByPlayer.set(player.id, 0));
    return offsetByPlayer;
  }

  const spacing = Math.min(riderLaneSpacingMeters, riderLaneMaxSpreadMeters / (sortedPlayers.length - 1));
  const midpoint = (sortedPlayers.length - 1) / 2;
  sortedPlayers.forEach((player, index) => {
    offsetByPlayer.set(player.id, (index - midpoint) * spacing);
  });

  return offsetByPlayer;
}

function remoteRiderLaneOffset(remoteIndex: number) {
  const side = remoteIndex % 2 === 0 ? 1 : -1;
  const band = Math.floor(remoteIndex / 2);
  return side * (remoteRiderLaneOffsetBaseMeters + band * remoteRiderLaneSpacingMeters);
}

function offsetRiderMapPosition(position: TrackPoint, bearingDegrees: number, lateralMeters: number) {
  if (Math.abs(lateralMeters) < 0.05) {
    return position;
  }

  const sideBearing = normalizeHeading(bearingDegrees + (lateralMeters > 0 ? 90 : -90));
  return offsetTrackPoint(position, sideBearing, Math.abs(lateralMeters));
}

function routePathBetweenMeters(route: TrackPoint[], startMeter: number, endMeter: number) {
  if (route.length < 2 || endMeter <= startMeter) {
    return [];
  }

  return Array.from({ length: 24 }, (_, index) => {
    const progress = index / 23;
    const meter = startMeter + (endMeter - startMeter) * progress;
    return pointAtRouteMeter(route, meter);
  }).filter((point): point is TrackPoint => point != null);
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

function riderLeanBucket(rotationDegrees: number) {
  return Math.round(uprightRiderOrientation(rotationDegrees).leanDegrees / 2) * 2;
}

function visualRiderDistanceMeters(distanceMeters: number, cStartBackoffMeters = 0) {
  const routeDistance = Math.max(0, distanceMeters);
  return Math.max(0, cStartVisualDistance(routeDistance, cStartBackoffMeters));
}

function riderFrontTireAnchor(rotationDegrees: number) {
  const orientation = uprightRiderOrientation(rotationDegrees);
  const leanBucket = riderLeanBucket(rotationDegrees);
  const frontTireX = (riderMarkerDrawSize / 2) - riderFrontTireInset;
  const groundY = riderMarkerDrawTop + riderMarkerDrawSize - riderGroundContactInset;
  const localX = orientation.mirrored ? -frontTireX : frontTireX;
  const radians = (leanBucket * Math.PI) / 180;
  const anchorX = (riderMarkerCanvasSize / 2) + (localX * Math.cos(radians)) - (groundY * Math.sin(radians));
  const anchorY = (riderMarkerCanvasSize / 2) + (localX * Math.sin(radians)) + (groundY * Math.cos(radians));

  return { x: anchorX, y: anchorY };
}

function riderFrontTireAnchorPoint(
  google: GoogleMapsRuntime,
  rotationDegrees: number,
  laneOffsetPixels: number,
) {
  const anchor = riderFrontTireAnchor(rotationDegrees);
  const laneTranslation = riderScreenLaneTranslation(rotationDegrees, laneOffsetPixels);
  return new google.maps.Point(
    anchor.x - laneTranslation.x,
    anchor.y - laneTranslation.y,
  );
}

function baseRiderIcon(google: GoogleMapsRuntime, player: PlayerSlot) {
  return {
    anchor: new google.maps.Point(38, 40),
    labelOrigin: new google.maps.Point(74, 13),
    scaledSize: new google.maps.Size(38, 43),
    url: riderFallbackIconByColor[player.colorName],
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

type RiderMarkerAppearance = 'live' | 'ghost';

function riderRigCanvasPoint(point: RiderRigPoint) {
  return {
    x: (-riderMarkerDrawSize / 2) + point.x * riderMarkerDrawSize,
    y: riderMarkerDrawTop + point.y * riderMarkerDrawSize,
  };
}

function eraseMovingRiderParts(context: CanvasRenderingContext2D) {
  const point = (x: number, y: number) => riderRigCanvasPoint({ x, y });
  const legPaths = [
    [[0.36, 0.34], [0.33, 0.5], [0.39, 0.65], [0.48, 0.7]],
    [[0.4, 0.34], [0.45, 0.51], [0.44, 0.66], [0.53, 0.71]],
  ] as const;
  context.strokeStyle = '#000000';
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = 6.4;
  for (const legPath of legPaths) {
    const start = point(legPath[0][0], legPath[0][1]);
    context.beginPath();
    context.moveTo(start.x, start.y);
    for (const [x, y] of legPath.slice(1)) {
      const next = point(x, y);
      context.lineTo(next.x, next.y);
    }
    context.stroke();
  }

  const crank = riderRigCanvasPoint(riderRigGeometry.crankCenter);
  context.fillStyle = '#000000';
  context.beginPath();
  context.arc(crank.x, crank.y, 4.2, 0, Math.PI * 2);
  context.fill();
}

function strokeRigSegment(
  context: CanvasRenderingContext2D,
  start: RiderRigPoint,
  end: RiderRigPoint,
  color: string,
  width: number,
) {
  const localStart = riderRigCanvasPoint(start);
  const localEnd = riderRigCanvasPoint(end);
  context.strokeStyle = color;
  context.lineWidth = width;
  context.beginPath();
  context.moveTo(localStart.x, localStart.y);
  context.lineTo(localEnd.x, localEnd.y);
  context.stroke();
}

function drawReconstructedBmxFrame(context: CanvasRenderingContext2D, accent: string) {
  const rearHub = { x: 0.22, y: 0.745 };
  const bottomBracket = riderRigGeometry.crankCenter;
  const seatJoint = { x: 0.365, y: 0.55 };
  const headTop = { x: 0.655, y: 0.485 };
  const headBottom = { x: 0.66, y: 0.555 };
  const frameSegments = [
    [rearHub, seatJoint],
    [rearHub, bottomBracket],
    [seatJoint, bottomBracket],
    [seatJoint, headTop],
    [headBottom, bottomBracket],
    [headTop, headBottom],
  ] as const;

  context.lineCap = 'round';
  context.lineJoin = 'round';
  frameSegments.forEach(([start, end]) => strokeRigSegment(context, start, end, '#07090b', 2.1));
  frameSegments.forEach(([start, end]) => strokeRigSegment(context, start, end, '#343b40', 0.9));
  strokeRigSegment(context, seatJoint, headTop, accent, 0.35);
  strokeRigSegment(context, rearHub, bottomBracket, '#9ca3af', 0.42);
  strokeRigSegment(
    context,
    { x: rearHub.x, y: rearHub.y + 0.012 },
    { x: bottomBracket.x, y: bottomBracket.y + 0.014 },
    '#6b7280',
    0.42,
  );

  const crank = riderRigCanvasPoint(bottomBracket);
  context.fillStyle = '#080a0c';
  context.strokeStyle = '#aeb5bd';
  context.lineWidth = 0.65;
  context.beginPath();
  context.arc(crank.x, crank.y, 2.15, 0, Math.PI * 2);
  context.fill();
  context.stroke();
}

function drawCrankArm(context: CanvasRenderingContext2D, pedal: RiderRigPoint, color: string) {
  strokeRigSegment(context, riderRigGeometry.crankCenter, pedal, '#050607', 1.8);
  strokeRigSegment(context, riderRigGeometry.crankCenter, pedal, color, 0.75);
  const localPedal = riderRigCanvasPoint(pedal);
  context.strokeStyle = '#08090b';
  context.lineCap = 'round';
  context.lineWidth = 1.2;
  context.beginPath();
  context.moveTo(localPedal.x - 1.6, localPedal.y);
  context.lineTo(localPedal.x + 1.6, localPedal.y);
  context.stroke();
}

function drawRiderLeg(
  context: CanvasRenderingContext2D,
  hip: RiderRigPoint,
  pedal: RiderRigPoint,
  accent: string,
  rear: boolean,
) {
  const knee = riderLegKnee(hip, pedal);
  const localHip = riderRigCanvasPoint(hip);
  const localKnee = riderRigCanvasPoint(knee);
  const localPedal = riderRigCanvasPoint(pedal);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.globalAlpha = rear ? 0.72 : 1;
  context.strokeStyle = '#050607';
  context.lineWidth = rear ? 4.2 : 4.6;
  context.beginPath();
  context.moveTo(localHip.x, localHip.y);
  context.lineTo(localKnee.x, localKnee.y);
  context.lineTo(localPedal.x, localPedal.y);
  context.stroke();
  context.strokeStyle = rear ? '#111417' : '#202427';
  context.lineWidth = rear ? 3.1 : 3.45;
  context.stroke();
  context.strokeStyle = accent;
  context.globalAlpha = rear ? 0.32 : 0.74;
  context.lineWidth = 0.52;
  context.stroke();

  context.globalAlpha = rear ? 0.72 : 1;
  context.strokeStyle = '#050607';
  context.lineWidth = rear ? 2.2 : 2.55;
  context.beginPath();
  context.moveTo(localPedal.x - 1.5, localPedal.y - 0.15);
  context.lineTo(localPedal.x + 2.9, localPedal.y - 0.15);
  context.stroke();
  context.strokeStyle = rear ? '#24282c' : '#3b4146';
  context.lineWidth = 0.75;
  context.stroke();
  context.globalAlpha = 1;
}

function drawRiderCrankAndLegRig(
  context: CanvasRenderingContext2D,
  crankAngleRadians: number,
  accent: string,
) {
  const pedals = riderCrankPedalPositions(crankAngleRadians);
  drawCrankArm(context, pedals.rear, '#555c63');
  drawRiderLeg(context, riderRigGeometry.rearHip, pedals.rear, accent, true);
  drawCrankArm(context, pedals.front, '#aeb5bd');
  drawRiderLeg(context, riderRigGeometry.frontHip, pedals.front, accent, false);

  const crank = riderRigCanvasPoint(riderRigGeometry.crankCenter);
  context.fillStyle = '#d1d5db';
  context.strokeStyle = '#050607';
  context.lineWidth = 0.7;
  context.beginPath();
  context.arc(crank.x, crank.y, 1.05, 0, Math.PI * 2);
  context.fill();
  context.stroke();
}

function drawUprightRiderCanvas(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  player: PlayerSlot,
  rotationDegrees: number,
  animation: RiderAnimationState,
  appearance: RiderMarkerAppearance = 'live',
) {
  const orientation = uprightRiderOrientation(rotationDegrees);
  const leanBucket = riderLeanBucket(rotationDegrees);
  const size = riderMarkerCanvasSize;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) {
    return false;
  }

  context.translate(size / 2, size / 2);
  context.rotate((leanBucket * Math.PI) / 180);
  context.scale(orientation.mirrored ? -1 : 1, 1);
  context.shadowColor = appearance === 'ghost' ? 'rgba(34, 211, 238, 0.85)' : 'rgba(0, 0, 0, 0.35)';
  context.shadowBlur = appearance === 'ghost'
    ? riderMarkerMaximumShadowBlurPixels
    : riderMarkerShadowBlurPixels;
  context.shadowOffsetY = riderMarkerShadowOffsetYPixels;
  context.drawImage(
    image,
    -riderMarkerDrawSize / 2,
    riderMarkerDrawTop,
    riderMarkerDrawSize,
    riderMarkerDrawSize,
  );
  context.shadowColor = 'transparent';
  context.shadowBlur = 0;
  context.shadowOffsetY = 0;
  context.save();
  context.globalCompositeOperation = 'destination-out';
  eraseMovingRiderParts(context);
  context.restore();
  drawReconstructedBmxFrame(context, player.accent);
  drawRiderCrankAndLegRig(context, animation.crankAngleRadians, player.accent);
  context.globalAlpha = 1;
  const wheelRotation = (animation.wheelFrameIndex / riderWheelFrameCount) * Math.PI * 2;
  context.strokeStyle = appearance === 'ghost' ? 'rgba(103, 232, 249, 0.78)' : player.accent;
  context.globalAlpha = appearance === 'ghost' ? 0.65 : 0.72;
  context.lineCap = 'round';
  context.lineWidth = 0.85;
  for (const wheelCenterX of [-17, 18]) {
    const wheelCenterY = 17;
    const spokeRadius = 8.5;
    context.beginPath();
    context.moveTo(
      wheelCenterX - Math.cos(wheelRotation) * spokeRadius,
      wheelCenterY - Math.sin(wheelRotation) * spokeRadius,
    );
    context.lineTo(
      wheelCenterX + Math.cos(wheelRotation) * spokeRadius,
      wheelCenterY + Math.sin(wheelRotation) * spokeRadius,
    );
    context.stroke();
  }
  context.globalAlpha = 1;
  if (appearance === 'ghost') {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalCompositeOperation = 'source-atop';
    context.globalAlpha = 0.5;
    context.fillStyle = player.accent;
    context.fillRect(0, 0, size, size);
  }

  return true;
}

async function uprightRiderIconUrl(
  player: PlayerSlot,
  rotationDegrees: number,
  animation: RiderAnimationState,
  appearance: RiderMarkerAppearance = 'live',
) {
  const imageUrl = riderRigBaseByColor[player.colorName];
  const orientation = uprightRiderOrientation(rotationDegrees);
  const leanBucket = riderLeanBucket(rotationDegrees);
  const cacheKey = `${appearance}:${player.colorName}:${player.accent}:${orientation.mirrored ? 'left' : 'right'}:${leanBucket}:${animation.crankStep}:${animation.wheelFrameIndex}`;
  const cached = cachedRiderIcon(cacheKey);
  if (cached) {
    return cached;
  }

  const image = await loadRiderImage(imageUrl);
  const canvas = document.createElement('canvas');
  if (!drawUprightRiderCanvas(canvas, image, player, rotationDegrees, animation, appearance)) {
    return imageUrl;
  }

  const dataUrl = canvas.toDataURL('image/png');
  rememberRiderIcon(cacheKey, dataUrl);
  return dataUrl;
}

function createPersistentRiderOverlay(
  google: GoogleMapsRuntime,
  map: GoogleMap,
  player: PlayerSlot,
  initialPosition: TrackPoint,
  initialRotationDegrees: number,
  initialAnimation: RiderAnimationState,
  initialLaneOffsetPixels: number,
  initialTitle: string,
  zIndex: number,
  appearance: RiderMarkerAppearance,
): RiderMapMarker | null {
  if (!google.maps.OverlayView) {
    return null;
  }

  const overlay = new google.maps.OverlayView();
  const element = document.createElement('div');
  const canvas = document.createElement('canvas');
  element.className = 'tracklab-rider-overlay';
  element.dataset.playerId = String(player.id);
  element.dataset.riderCanvasSize = String(riderMarkerCanvasSize);
  element.title = initialTitle;
  element.setAttribute('aria-label', initialTitle);
  element.style.background = `center / auto ${riderMarkerDrawSize}px no-repeat url("${riderFallbackIconByColor[player.colorName]}")`;
  element.style.height = `${riderMarkerCanvasSize}px`;
  element.style.overflow = 'visible';
  element.style.pointerEvents = 'none';
  element.style.position = 'absolute';
  element.style.transformOrigin = '0 0';
  element.style.width = `${riderMarkerCanvasSize}px`;
  element.style.willChange = 'left, top, transform';
  element.style.zIndex = String(zIndex);
  canvas.height = riderMarkerCanvasSize;
  canvas.style.display = 'block';
  canvas.width = riderMarkerCanvasSize;
  element.appendChild(canvas);

  let position = initialPosition;
  let rotationDegrees = initialRotationDegrees;
  let animation = initialAnimation;
  let laneOffsetPixels = initialLaneOffsetPixels;
  let visualKey = '';
  let frameRequest: number | null = null;
  let riderImage: HTMLImageElement | null = null;
  let disposed = false;

  const drawPosition = () => {
    const projection = overlay.getProjection();
    if (!projection) {
      return;
    }

    const pixel = projection.fromLatLngToDivPixel(new google.maps.LatLng(position.lat, position.lng));
    if (!pixel) {
      return;
    }

    const anchor = riderFrontTireAnchor(rotationDegrees);
    const laneTranslation = riderScreenLaneTranslation(rotationDegrees, laneOffsetPixels);
    element.style.left = `${pixel.x}px`;
    element.style.top = `${pixel.y}px`;
    element.style.transform = `translate3d(${
      -anchor.x + laneTranslation.x
    }px, ${-anchor.y + laneTranslation.y}px, 0)`;
  };

  const scheduleCanvasDraw = () => {
    if (disposed || !riderImage || frameRequest != null) {
      return;
    }

    frameRequest = window.requestAnimationFrame(() => {
      frameRequest = null;
      if (disposed || !riderImage) {
        return;
      }

      if (drawUprightRiderCanvas(
        canvas,
        riderImage,
        player,
        rotationDegrees,
        animation,
        appearance,
      )) {
        element.style.background = 'none';
      }
    });
  };

  const applyVisual = (
    nextRotationDegrees: number,
    nextAnimation: RiderAnimationState,
    nextLaneOffsetPixels: number,
  ) => {
    const orientation = uprightRiderOrientation(nextRotationDegrees);
    const nextVisualKey = `${orientation.mirrored ? 'left' : 'right'}:${riderLeanBucket(nextRotationDegrees)}:${nextAnimation.crankStep}:${nextAnimation.wheelFrameIndex}:${nextLaneOffsetPixels}`;
    if (nextVisualKey === visualKey) {
      return;
    }

    visualKey = nextVisualKey;
    rotationDegrees = nextRotationDegrees;
    animation = nextAnimation;
    laneOffsetPixels = nextLaneOffsetPixels;
    element.dataset.riderLaneOffset = String(nextLaneOffsetPixels);
    drawPosition();
    scheduleCanvasDraw();
  };

  overlay.onAdd = () => {
    const panes = overlay.getPanes();
    const pane = panes?.overlayMouseTarget ?? panes?.floatPane ?? panes?.overlayLayer;
    pane?.appendChild(element);
    drawPosition();
  };
  overlay.draw = drawPosition;
  overlay.onRemove = () => {
    element.remove();
    if (frameRequest != null) {
      window.cancelAnimationFrame(frameRequest);
      frameRequest = null;
    }
  };

  void loadRiderImage(riderRigBaseByColor[player.colorName])
    .then((image) => {
      if (disposed) {
        return;
      }
      riderImage = image;
      scheduleCanvasDraw();
    })
    .catch(() => undefined);

  overlay.setMap(map);
  applyVisual(initialRotationDegrees, initialAnimation, initialLaneOffsetPixels);

  return {
    setMap: (nextMap) => {
      disposed = nextMap == null;
      overlay.setMap(nextMap);
    },
    setLabel: () => undefined,
    setPosition: (nextPosition) => {
      position = nextPosition;
      drawPosition();
    },
    setVisual: applyVisual,
    setTitle: (nextTitle) => {
      element.title = nextTitle;
      element.setAttribute('aria-label', nextTitle);
    },
  };
}

function createRiderMapMarker(
  google: GoogleMapsRuntime,
  map: GoogleMap,
  player: PlayerSlot,
  position: TrackPoint,
  rotationDegrees: number,
  animation: RiderAnimationState,
  laneOffsetPixels: number,
  title: string,
  zIndex = 760 + player.id,
  appearance: RiderMarkerAppearance = 'live',
): RiderMapMarker {
  const persistentOverlay = createPersistentRiderOverlay(
    google,
    map,
    player,
    position,
    rotationDegrees,
    animation,
    laneOffsetPixels,
    title,
    zIndex,
    appearance,
  );
  if (persistentOverlay) {
    return persistentOverlay;
  }

  let iconVersion = 0;
  let visualKey = '';
  const marker = new google.maps.Marker({
    icon: baseRiderIcon(google, player),
    map,
    optimized: false,
    position,
    title,
    zIndex,
  });

  const applyVisual = (
    nextRotation: number,
    nextAnimation: RiderAnimationState,
    nextLaneOffsetPixels: number,
  ) => {
    const orientation = uprightRiderOrientation(nextRotation);
    const nextVisualKey = `${orientation.mirrored ? 'left' : 'right'}:${riderLeanBucket(nextRotation)}:${nextAnimation.crankStep}:${nextAnimation.wheelFrameIndex}:${nextLaneOffsetPixels}`;
    if (nextVisualKey === visualKey) {
      return;
    }

    visualKey = nextVisualKey;
    iconVersion += 1;
    const version = iconVersion;
    void uprightRiderIconUrl(player, nextRotation, nextAnimation, appearance)
      .then((url) => {
        if (version !== iconVersion) {
          return;
        }

        marker.setIcon({
          anchor: riderFrontTireAnchorPoint(google, nextRotation, nextLaneOffsetPixels),
          labelOrigin: new google.maps.Point(74, 15),
          scaledSize: new google.maps.Size(riderMarkerCanvasSize, riderMarkerCanvasSize),
          url,
        });
      })
      .catch(() => {
        if (version === iconVersion) {
          marker.setIcon(baseRiderIcon(google, player));
        }
      });
  };

  applyVisual(rotationDegrees, animation, laneOffsetPixels);

  return {
    setMap: (nextMap) => marker.setMap(nextMap),
    setLabel: () => marker.setLabel?.(null),
    setPosition: (nextPosition) => marker.setPosition(nextPosition),
    setVisual: applyVisual,
    setTitle: (nextTitle) => {
      marker.setTitle?.(nextTitle);
    },
  };
}

export function GoogleMapsTrackLayer({
  track,
  activeZones,
  riders,
  ghostRiders = [],
  remoteRaceStates = [],
  players,
  samplesByDevice,
  speedUnit,
  distanceUnit,
  cStartOffsetsByPlayer = {},
  raceViewFullscreen = false,
  cameraLocked = false,
  raceState,
  raceDistanceMeters,
  earthAngle,
  earthHeading,
  earthCenter,
  earthZoom,
  mappingMode = false,
  mappingEditMode = 'draw',
  mappingRouteVariantId = 'amateur',
  mappingZoneBranchChoice = 'a',
  draftPoints = [],
  draftZoneRoutePoints = [],
  draftZoneSectionId = null,
  draftZoneMeters = [],
  draftZonePoints = [],
  draftReferenceZones = [],
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
  const startLineRefs = useRef<GooglePolyline[]>([]);
  const finishLineRefs = useRef<GooglePolyline[]>([]);
  const finishMarkerRef = useRef<GoogleMarker | null>(null);
  const draftLineRefs = useRef<GooglePolyline[]>([]);
  const draftSplitLineRefs = useRef<GooglePolyline[]>([]);
  const draftMarkerRefs = useRef<GoogleMarker[]>([]);
  const draftMarkerListenerRefs = useRef<GoogleMapsEventListener[]>([]);
  const mapListenerRefs = useRef<GoogleMapsEventListener[]>([]);
  const isDrawingRef = useRef(false);
  const lastDrawPointRef = useRef<TrackPoint | null>(null);
  const suppressNextMapEditEventRef = useRef(false);
  const projectionOverlayRef = useRef<GoogleOverlayView | null>(null);
  const curvePreviewLineRef = useRef<GooglePolyline | null>(null);
  const curvePointerIdRef = useRef<number | null>(null);
  const curveStrokePointsRef = useRef<TrackPoint[]>([]);
  const markerRefs = useRef<Map<number, RiderMapMarker>>(new Map());
  const ghostMarkerRefs = useRef<Map<string, RiderMapMarker>>(new Map());
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
  const cameraSyncReleaseTimerRef = useRef<number | null>(null);
  const lastFitKeyRef = useRef('');
  const isProSetZoneMapping = mappingMode
    && mappingEditMode === 'zones'
    && mappingZoneBranchChoice === 'b'
    && Boolean(draftZoneSectionId);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [selectedPathPointIndex, setSelectedPathPointIndex] = useState<number | null>(null);
  const [dragMeasurement, setDragMeasurement] = useState<{
    pointLabel: string;
    distanceMeters: number;
  } | null>(null);
  const draftRouteColor = routeVariantColors[mappingRouteVariantId];

  useEffect(() => {
    setSelectedPathPointIndex(null);
    setDragMeasurement(null);
  }, [mappingEditMode, mappingMode, track.id]);

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
        if (google.maps.OverlayView) {
          const projectionOverlay = new google.maps.OverlayView();
          projectionOverlay.onAdd = () => undefined;
          projectionOverlay.draw = () => undefined;
          projectionOverlay.onRemove = () => undefined;
          projectionOverlay.setMap(map);
          projectionOverlayRef.current = projectionOverlay;
        }
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
      startLineRefs.current.forEach((line) => line.setMap(null));
      finishLineRefs.current.forEach((line) => line.setMap(null));
      finishMarkerRef.current?.setMap(null);
      draftLineRefs.current.forEach((line) => line.setMap(null));
      draftSplitLineRefs.current.forEach((line) => line.setMap(null));
      draftMarkerRefs.current.forEach((marker) => marker.setMap(null));
      draftMarkerListenerRefs.current.forEach((listener) => listener?.remove?.());
      mapListenerRefs.current.forEach((listener) => listener?.remove?.());
      curvePreviewLineRef.current?.setMap(null);
      projectionOverlayRef.current?.setMap(null);
      markerRefs.current.forEach((marker) => marker.setMap(null));
      ghostMarkerRefs.current.forEach((marker) => marker.setMap(null));
      remoteMarkerRefs.current.forEach((marker) => marker.setMap(null));
      trackLineRefs.current = [];
      zoneLinesRef.current = [];
      distanceLabelRefs.current = [];
      splitLineRefs.current = [];
      splitMarkerRefs.current = [];
      startLineRefs.current = [];
      finishLineRefs.current = [];
      finishMarkerRef.current = null;
      draftLineRefs.current = [];
      draftSplitLineRefs.current = [];
      draftMarkerRefs.current = [];
      draftMarkerListenerRefs.current = [];
      mapListenerRefs.current = [];
      curvePreviewLineRef.current = null;
      projectionOverlayRef.current = null;
      curvePointerIdRef.current = null;
      curveStrokePointsRef.current = [];
      markerRefs.current.clear();
      ghostMarkerRefs.current.clear();
      remoteMarkerRefs.current.clear();
      mapRef.current = null;
      if (cameraSyncReleaseTimerRef.current != null) {
        window.clearTimeout(cameraSyncReleaseTimerRef.current);
        cameraSyncReleaseTimerRef.current = null;
      }
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

    suppressCameraSyncRef.current = true;
    if (cameraSyncReleaseTimerRef.current != null) {
      window.clearTimeout(cameraSyncReleaseTimerRef.current);
    }
    applyCamera(map, nextCamera);
    cameraSyncReleaseTimerRef.current = window.setTimeout(() => {
      cameraSyncReleaseTimerRef.current = null;
      suppressCameraSyncRef.current = false;
    }, 250);
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
      if (suppressCameraSyncRef.current || cameraLocked) {
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

    return () => listeners.forEach((listener) => listener?.remove?.());
  }, [cameraLocked, earthAngle, earthHeading, onEarthCameraChange, status]);

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
    startLineRefs.current.forEach((line) => line.setMap(null));
    finishLineRefs.current.forEach((line) => line.setMap(null));
    finishMarkerRef.current?.setMap(null);
    trackLineRefs.current = [];
    zoneLinesRef.current = [];
    distanceLabelRefs.current = [];
    splitLineRefs.current = [];
    splitMarkerRefs.current = [];
    startLineRefs.current = [];
    finishLineRefs.current = [];
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

    const hideRaceRoute = mappingMode || raceViewFullscreen || raceState === 'racing' || raceState === 'finished';
    const showRaceStart = !mappingMode && !raceViewFullscreen && raceState !== 'racing';

    if (!hideRaceRoute) {
      trackLineRefs.current = mappedTrackRouteSegments(track)
        .filter((segment) => segment.length > 1)
        .map((segment) => new google.maps.Polyline({
          clickable: false,
          map,
          path: segment,
          strokeColor: '#d8ff3e',
          strokeOpacity: 0.88,
          strokeWeight: savedRouteStrokeWeight,
        }));
    }

    const startStripe = showRaceStart ? startStripePath(savedRoute) : null;
    if (startStripe) {
      startLineRefs.current = [
        new google.maps.Polyline({
          clickable: false,
          map,
          path: startStripe,
          strokeColor: '#111827',
          strokeOpacity: 0.96,
          strokeWeight: finishStripeHaloStrokeWeight,
          zIndex: 900,
        }),
        new google.maps.Polyline({
          clickable: false,
          map,
          path: startStripe,
          strokeColor: '#d8ff3e',
          strokeOpacity: 0.98,
          strokeWeight: finishStripeCoreStrokeWeight,
          zIndex: 901,
        }),
      ];
    }

    const routeMidpoint = riderLatLng(track, track.lengthMeters / 2);
    if (routeMidpoint && !hideRaceRoute) {
      distanceLabelRefs.current.push(new google.maps.Marker({
        icon: {
          anchor: new google.maps.Point(84, 50),
          scaledSize: new google.maps.Size(168, 40),
          url: distanceLabelIcon(`Track ${formatDistanceMeters(track.lengthMeters, distanceUnit)}`),
        },
        map,
        optimized: false,
        position: routeMidpoint,
        title: `Track distance ${formatDistanceMeters(track.lengthMeters, distanceUnit)}`,
        zIndex: 500,
      }));
    }

    const pedalZones = activeZones.filter((zone) => zone.type === 'pedal');
    if (!mappingMode) {
      zoneLinesRef.current = pedalZones
        .map((zone) => ({ zone, path: zonePolyline(track, zone) }))
        .filter(({ path }) => path.length > 1)
        .map(({ zone, path }) => new google.maps.Polyline({
          clickable: false,
          map,
          path,
          strokeColor: zoneColors[zone.type],
          strokeOpacity: raceState === 'racing' ? 0.72 : 0.82,
          strokeWeight: raceState === 'racing' ? racePedalZoneStrokeWeight : defaultPedalZoneStrokeWeight,
          zIndex: raceState === 'racing' ? 430 : 515,
        }));
    }

    if (!hideRaceRoute && !mappingMode) {
      (track.splitSections ?? []).forEach((section) => {
        section.branches.forEach((branch) => {
          if (branch.points.length < 2) {
            return;
          }

          splitLineRefs.current.push(new google.maps.Polyline({
            clickable: false,
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

    const showPedalZoneReviewNumbers = !mappingMode && raceState === 'finished';
    pedalZones.forEach((zone, index) => {
      if (!showPedalZoneReviewNumbers) {
        return;
      }

      const route = mappedTrackRouteWithBranchSelections(track, zone.branchSelections);
      const position = pedalZoneLabelPosition(route, zone.startMeter, zone.endMeter);
      if (!position) {
        return;
      }

      const distance = Math.max(0, zone.endMeter - zone.startMeter);
      distanceLabelRefs.current.push(new google.maps.Marker({
        icon: {
          anchor: new google.maps.Point(pedalZoneLabelAnchor.x, pedalZoneLabelAnchor.y),
          scaledSize: new google.maps.Size(
            pedalZoneLabelSizePixels,
            pedalZoneLabelSizePixels,
          ),
          url: pedalZoneNumberIcon(index + 1),
        },
        map,
        optimized: false,
        position,
        title: `${zone.name} ${formatDistanceMeters(distance, distanceUnit)} / performance tracked`,
        zIndex: 520,
      }));
    });

    const showRaceFinish = !mappingMode || raceViewFullscreen || raceState === 'racing' || raceState === 'finished';
    const finishRoute = !mappingMode && raceDistanceMeters != null
      ? routePathBetweenMeters(savedRoute, 0, Math.min(routeLengthMeters(savedRoute), raceDistanceMeters))
      : savedRoute;
    const finishStripe = showRaceFinish ? finishStripePath(finishRoute) : null;
    if (finishStripe) {
      finishLineRefs.current = [
        new google.maps.Polyline({
          clickable: false,
          map,
          path: finishStripe,
          strokeColor: '#111827',
          strokeOpacity: 0.96,
          strokeWeight: finishStripeHaloStrokeWeight,
          zIndex: 900,
        }),
        new google.maps.Polyline({
          clickable: false,
          map,
          path: finishStripe,
          strokeColor: '#ffffff',
          strokeOpacity: 0.98,
          strokeWeight: finishStripeCoreStrokeWeight,
          zIndex: 901,
        }),
      ];
    }

    const finishLabelPoint = showRaceFinish ? finishLabelPosition(finishRoute) : null;
    if (finishLabelPoint && showRaceFinish) {
      finishMarkerRef.current = new google.maps.Marker({
        icon: {
          anchor: new google.maps.Point(43, 18),
          scaledSize: new google.maps.Size(86, 34),
          url: finishLineIcon(),
        },
        map,
        optimized: false,
        position: finishLabelPoint,
        title: 'Finish line',
        zIndex: 920,
      });
    }
  }, [activeZones, distanceUnit, mappingMode, raceDistanceMeters, raceState, raceViewFullscreen, status, track]);

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
    draftMarkerListenerRefs.current.forEach((listener) => listener?.remove?.());
    draftLineRefs.current = [];
    draftSplitLineRefs.current = [];
    draftMarkerRefs.current = [];
    draftMarkerListenerRefs.current = [];

    const showMappingDraft = mappingMode && !raceViewFullscreen;
    if (!showMappingDraft) {
      return;
    }

    const activeDraftRouteSplitSections = draftRouteSplitSections ?? draftSplitSections;
    const draftRoute = routeWithDefaultSplitBranches(draftPoints, activeDraftRouteSplitSections);
    const draftSharedSegments = splitSharedRouteSegments(draftPoints, activeDraftRouteSplitSections);
    const visibleDraftSharedSegments = draftSharedSegments
      .filter((segment) => segment.length > 1);
    const draftSharedLinePairs: GooglePolyline[][] = [];
    if (showMappingDraft && draftPoints.length > 1) {
      draftSharedLinePairs.push(...visibleDraftSharedSegments
        .map((segment) => [
          new google.maps.Polyline({
            clickable: false,
            map,
            path: segment,
            strokeColor: draftRouteColor,
            strokeOpacity: 0.22,
            strokeWeight: mappingRouteHaloStrokeWeight,
            zIndex: 530,
          }),
          new google.maps.Polyline({
            clickable: false,
            map,
            path: segment,
            strokeColor: draftRouteColor,
            strokeOpacity: 0.96,
            strokeWeight: mappingRouteCoreStrokeWeight,
            zIndex: 531,
          }),
        ]));
      draftLineRefs.current = draftSharedLinePairs.flat();
    }

    const draftStartStripe = showMappingDraft && draftRoute.length > 1 ? startStripePath(draftRoute) : null;
    const draftStartStripeLines: GooglePolyline[] = [];
    if (draftStartStripe) {
      draftStartStripeLines.push(
        new google.maps.Polyline({
          clickable: false,
          map,
          path: draftStartStripe,
          strokeColor: '#111827',
          strokeOpacity: 0.96,
          strokeWeight: finishStripeHaloStrokeWeight,
          zIndex: 900,
        }),
        new google.maps.Polyline({
          clickable: false,
          map,
          path: draftStartStripe,
          strokeColor: draftRouteColor,
          strokeOpacity: 0.98,
          strokeWeight: finishStripeCoreStrokeWeight,
          zIndex: 901,
        }),
      );
      draftLineRefs.current = [...draftLineRefs.current, ...draftStartStripeLines];
    }

    const draftLengthMeters = routeLengthWithDefaultSplitBranches(draftPoints, activeDraftRouteSplitSections);
    const draftDistanceMarkers = showMappingDraft && draftPoints.length > 1 ? [
      new google.maps.Marker({
        icon: {
          anchor: new google.maps.Point(84, 50),
          scaledSize: new google.maps.Size(168, 40),
          url: distanceLabelIcon(`Track ${formatDistanceMeters(draftLengthMeters, distanceUnit)}`),
        },
        map,
        optimized: false,
        position: pointAtRouteMeter(draftRoute, draftLengthMeters / 2) ?? draftPoints[Math.floor(draftPoints.length / 2)],
        title: `Draft track distance ${formatDistanceMeters(draftLengthMeters, distanceUnit)}`,
        zIndex: 540,
      }),
    ] : [];

    const updateDraftDragPreview = (pointIndex: number, nextPoint: TrackPoint) => {
      const previewPoints = draftPoints.map((draftPoint, index) => (
        index === pointIndex ? nextPoint : draftPoint
      ));
      const previewRoute = routeWithDefaultSplitBranches(previewPoints, activeDraftRouteSplitSections);
      const previewSegments = splitSharedRouteSegments(previewPoints, activeDraftRouteSplitSections)
        .filter((segment) => segment.length > 1);
      const previewLengthMeters = routeLengthWithDefaultSplitBranches(
        previewPoints,
        activeDraftRouteSplitSections,
      );

      draftSharedLinePairs.forEach((linePair, segmentIndex) => {
        const segment = previewSegments[segmentIndex];
        if (!segment) {
          return;
        }
        linePair.forEach((line) => line.setPath?.(segment));
      });

      const previewStartStripe = startStripePath(previewRoute);
      if (previewStartStripe) {
        draftStartStripeLines.forEach((line) => line.setPath?.(previewStartStripe));
      }

      const distanceMarker = draftDistanceMarkers[0];
      const formattedDistance = formatDistanceMeters(previewLengthMeters, distanceUnit);
      if (distanceMarker && previewRoute.length > 1) {
        distanceMarker.setPosition(
          pointAtRouteMeter(previewRoute, previewLengthMeters / 2)
            ?? previewPoints[Math.floor(previewPoints.length / 2)],
        );
        distanceMarker.setIcon({
          anchor: new google.maps.Point(84, 50),
          scaledSize: new google.maps.Size(168, 40),
          url: distanceLabelIcon(`Track ${formattedDistance}`),
        });
        distanceMarker.setTitle?.(`Draft track distance ${formattedDistance}`);
      }

      const isStart = pointIndex === 0;
      const isFinish = pointIndex === draftPoints.length - 1;
      setDragMeasurement({
        pointLabel: isStart ? 'Start' : isFinish ? 'Finish' : `Point ${pointIndex + 1}`,
        distanceMeters: previewLengthMeters,
      });
    };

    const activeDraftZoneRoute = draftZoneRoutePoints.length > 1 ? draftZoneRoutePoints : draftRoute;
    const activeDraftZoneLengthMeters = routeLengthMeters(activeDraftZoneRoute);
    const draftReferencePedalLines = draftReferenceZones
      .filter((zone) => zone.type === 'pedal')
      .map((zone) => {
        const route = routeWithSplitBranchSelections(draftPoints, activeDraftRouteSplitSections, zone.branchSelections);
        return routePathBetweenMeters(route, zone.startMeter, zone.endMeter);
      })
      .filter((path) => path.length > 1)
      .map((path) => new google.maps.Polyline({
        clickable: false,
        map,
        path,
        strokeColor: pedalZoneColor,
        strokeOpacity: 0.34,
        strokeWeight: mappingPedalZoneStrokeWeight,
        zIndex: 548,
      }));
    const cleanDraftZonePins = showMappingDraft && activeDraftZoneRoute.length > 1
      ? draftZoneMeters
        .filter((meter) => meter >= 0 && meter <= activeDraftZoneLengthMeters)
        .sort((a, b) => a - b)
      : [];
    const draftPedalSpans = Array.from({ length: Math.floor(cleanDraftZonePins.length / 2) }, (_, index) => ({
      startMeter: cleanDraftZonePins[index * 2],
      endMeter: cleanDraftZonePins[index * 2 + 1],
    })).filter((span) => span.endMeter - span.startMeter >= 3);

    const draftPedalLines = draftPedalSpans
      .map((span) => routePathBetweenMeters(activeDraftZoneRoute, span.startMeter, span.endMeter))
      .filter((path) => path.length > 1)
      .map((path) => new google.maps.Polyline({
        clickable: false,
        map,
        path,
        strokeColor: pedalZoneColor,
        strokeOpacity: 0.72,
        strokeWeight: mappingPedalZoneStrokeWeight,
        zIndex: 552,
      }));
    draftLineRefs.current = [...draftLineRefs.current, ...draftReferencePedalLines, ...draftPedalLines];

    const draftZoneDistanceMarkers = draftPedalSpans.map((span, index) => {
      const labelPosition = pedalZoneLabelPosition(
        activeDraftZoneRoute,
        span.startMeter,
        span.endMeter,
      );
      if (!labelPosition) {
        return null;
      }

      return new google.maps.Marker({
        icon: {
          anchor: new google.maps.Point(pedalZoneLabelAnchor.x, pedalZoneLabelAnchor.y),
          scaledSize: new google.maps.Size(
            pedalZoneLabelSizePixels,
            pedalZoneLabelSizePixels,
          ),
          url: pedalZoneNumberIcon(index + 1),
        },
        map,
        optimized: false,
        position: labelPosition,
        title: `Pedal zone ${index + 1} ${formatDistanceMeters(span.endMeter - span.startMeter, distanceUnit)}`,
        zIndex: 545,
      });
    }).filter((marker): marker is GoogleMarker => marker != null);

    const canMovePathPoints = Boolean(onMappingPathPointMove) && mappingEditMode === 'adjust';
    const canUseRoutePointAsZoneBoundary = mappingEditMode === 'zones' && Boolean(onMappingZonePointAdd);
    const suppressNextMapEditEvent = () => {
      suppressNextMapEditEventRef.current = true;
      isDrawingRef.current = false;
      lastDrawPointRef.current = null;
    };
    const pathPointMarkers = showMappingDraft ? draftPoints.map((point, index) => {
      const isStart = index === 0;
      const isFinish = index === draftPoints.length - 1 && draftPoints.length > 1;
      const isSelected = mappingEditMode === 'adjust' && selectedPathPointIndex === index;
      const pointText = isStart ? 'S' : isFinish ? 'F' : String(index + 1);
      const pointLabel = isStart && mappingEditMode !== 'adjust' ? null : {
        color: '#111827',
        fontSize: '11px',
        fontWeight: '900',
        text: pointText,
      };
      const marker = new google.maps.Marker({
        clickable: true,
        cursor: canMovePathPoints ? 'grab' : canUseRoutePointAsZoneBoundary ? 'pointer' : undefined,
        crossOnDrag: false,
        draggable: canMovePathPoints,
        icon: canMovePathPoints
          ? {
              anchor: new google.maps.Point(24, 24),
              scaledSize: new google.maps.Size(48, 48),
              url: routePointHandleIcon(
                pointText,
                isSelected ? '#fbbf24' : isStart || isFinish ? draftRouteColor : '#ffffff',
                isSelected,
              ),
            }
          : {
              fillColor: isSelected ? '#fbbf24' : isStart || isFinish ? draftRouteColor : '#ffffff',
              fillOpacity: isStart ? 0.82 : 1,
              path: google.maps.SymbolPath.CIRCLE,
              scale: isSelected ? 12 : isStart ? 6 : isFinish ? 14 : 8,
              strokeColor: '#111827',
              strokeWeight: isSelected ? 4 : isStart ? 2 : isFinish ? 3 : 2,
            },
        ...(!canMovePathPoints && pointLabel ? { label: pointLabel } : {}),
        map,
        optimized: canMovePathPoints ? false : !(isFinish),
        position: point,
        title: mappingEditMode === 'adjust'
          ? `${isStart ? 'Start point' : isFinish ? 'Finish point' : `Route point ${index + 1}`} — tap or drag to move`
          : isStart
            ? 'Mapping start line'
            : isFinish
              ? 'Mapping finish'
              : `Mapping point ${index + 1}`,
        zIndex: isSelected ? 1_100 : isStart ? 902 : isFinish ? 950 + index : 620 + index,
      });

      if (mappingEditMode !== 'adjust') {
        draftMarkerListenerRefs.current.push(marker.addListener('mousedown', suppressNextMapEditEvent));
      }

      if (canMovePathPoints && onMappingPathPointMove) {
        let suppressClickUntil = 0;
        draftMarkerListenerRefs.current.push(marker.addListener('dragstart', () => {
          suppressClickUntil = Number.POSITIVE_INFINITY;
          suppressNextMapEditEvent();
          updateDraftDragPreview(index, point);
        }));
        draftMarkerListenerRefs.current.push(marker.addListener('drag', (event) => {
          const nextPoint = event?.latLng?.toJSON();
          if (nextPoint) {
            updateDraftDragPreview(index, nextPoint);
          }
        }));
        draftMarkerListenerRefs.current.push(marker.addListener('dragend', (event) => {
          const nextPoint = event?.latLng?.toJSON();
          if (nextPoint) {
            updateDraftDragPreview(index, nextPoint);
            onMappingPathPointMove(index, nextPoint);
          }
          suppressClickUntil = Date.now() + 350;
          window.setTimeout(() => {
            suppressNextMapEditEventRef.current = false;
          }, 350);
          setSelectedPathPointIndex(null);
          setDragMeasurement(null);
        }));
        draftMarkerListenerRefs.current.push(marker.addListener('click', () => {
          if (Date.now() < suppressClickUntil) {
            return;
          }
          setSelectedPathPointIndex((current) => current === index ? null : index);
        }));
      }

      if (canUseRoutePointAsZoneBoundary && onMappingZonePointAdd) {
        draftMarkerListenerRefs.current.push(marker.addListener('click', () => {
          suppressNextMapEditEvent();
          onMappingZonePointAdd(point);
        }));
      }

      if (canMovePathPoints && onMappingPathPointRemove) {
        const removePoint = () => onMappingPathPointRemove(index);
        draftMarkerListenerRefs.current.push(marker.addListener('dblclick', removePoint));
        draftMarkerListenerRefs.current.push(marker.addListener('rightclick', removePoint));
      }

      return marker;
    }) : [];

    const zoneMarkers = showMappingDraft ? draftZonePoints.map((point, index) => {
      const zoneNumber = Math.floor(index / 2) + 1;
      const isStartPin = index % 2 === 0;
      const marker = new google.maps.Marker({
        draggable: Boolean(onMappingZonePointMove),
        icon: {
          fillColor: pedalZoneColor,
          fillOpacity: 1,
          path: google.maps.SymbolPath.CIRCLE,
          scale: isStartPin ? 9 : 8,
          strokeColor: '#111827',
          strokeWeight: isStartPin ? 3 : 2,
        },
        label: {
          color: '#111827',
          fontSize: '11px',
          fontWeight: '900',
          text: `${isStartPin ? 'S' : 'E'}${zoneNumber}`,
        },
        map,
        optimized: false,
        position: point,
        title: `${isStartPin ? 'Start' : 'End'} pedal zone ${zoneNumber}`,
        zIndex: 1040 + index,
      });

      draftMarkerListenerRefs.current.push(marker.addListener('mousedown', suppressNextMapEditEvent));

      if (onMappingZonePointMove) {
        draftMarkerListenerRefs.current.push(marker.addListener('dragstart', suppressNextMapEditEvent));
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
    const addDraftJunctionClick = (
      marker: GoogleMarker,
      point: TrackPoint,
      allowSplitTool = false,
      allowZoneBoundary = true,
    ) => {
      if (allowZoneBoundary && mappingEditMode === 'zones' && onMappingZonePointAdd) {
        draftMarkerListenerRefs.current.push(marker.addListener('click', () => {
          suppressNextMapEditEvent();
          onMappingZonePointAdd(point);
        }));
        return;
      }

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
      const isActiveProZoneSection = isProSetZoneMapping && section.id === draftZoneSectionId;
      const allowZoneBoundary = !isProSetZoneMapping || isActiveProZoneSection;
      section.branches.forEach((branch) => {
        if (branch.points.length < 2) {
          return;
        }

        const isActiveProBranch = isActiveProZoneSection && branch.id === 'b';
        draftSplitLineRefs.current.push(new google.maps.Polyline({
          clickable: false,
          map,
          path: branch.points,
          strokeColor: branch.id === 'a' ? '#ff2d55' : '#38bdf8',
          strokeOpacity: isActiveProZoneSection ? (isActiveProBranch ? 1 : 0.22) : draft ? 0.96 : 0.82,
          strokeWeight: isActiveProBranch
            ? mappingSplitBranchStrokeWeight + 2
            : draft
              ? mappingSplitBranchStrokeWeight
              : savedRouteStrokeWeight,
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
        title: isActiveProZoneSection ? 'Set Pro Set pedal start at split (0 ft)' : `Split ${section.index}`,
        zIndex: 800 + section.index,
      });
      splitMarkers.push(splitMarker);
      addDraftJunctionClick(splitMarker, section.splitPoint, false, allowZoneBoundary);

      const mergeMarker = new google.maps.Marker({
        icon: {
          anchor: new google.maps.Point(21, 21),
          scaledSize: new google.maps.Size(42, 42),
          url: splitJunctionIcon(`M${section.index}`, '#38bdf8'),
        },
        map,
        optimized: false,
        position: section.mergePoint,
        title: isActiveProZoneSection ? 'Snap Pro Set pedal endpoint to merge' : `Merge ${section.index}`,
        zIndex: 810 + section.index,
      });
      splitMarkers.push(mergeMarker);
      addDraftJunctionClick(mergeMarker, section.mergePoint, false, allowZoneBoundary);
    };

    if (showMappingDraft) {
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
            clickable: false,
            map,
            path: branchA,
            strokeColor: '#ff2d55',
            strokeOpacity: 0.98,
            strokeWeight: mappingSplitBranchStrokeWeight,
          }));
        }
        if (branchB.length > 1) {
          draftSplitLineRefs.current.push(new google.maps.Polyline({
            clickable: false,
            map,
            path: branchB,
            strokeColor: '#38bdf8',
            strokeOpacity: 0.98,
            strokeWeight: mappingSplitBranchStrokeWeight,
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
        const allowZoneBoundary = !isProSetZoneMapping || draftSplitBuilder.id === draftZoneSectionId;
        addDraftJunctionClick(splitMarker, draftSplitBuilder.splitPoint, true, allowZoneBoundary);

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
          addDraftJunctionClick(mergeMarker, draftSplitBuilder.mergePoint, true, allowZoneBoundary);
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
    draftRouteColor,
    draftPoints,
    draftRouteSplitSections,
    draftSplitBuilder,
    draftSplitSections,
    draftZoneMeters,
    draftZonePoints,
    draftReferenceZones,
    draftZoneRoutePoints,
    draftZoneSectionId,
    isProSetZoneMapping,
    mappingEditMode,
    mappingMode,
    onMappingPathPointAdd,
    onMappingPathPointMove,
    onMappingPathPointRemove,
    onMappingSplitPointAdd,
    onMappingZonePointAdd,
    onMappingZonePointMove,
    onMappingZonePointRemove,
    raceState,
    raceViewFullscreen,
    selectedPathPointIndex,
    status,
  ]);

  useEffect(() => {
    const google = googleRef.current;
    const map = mapRef.current;
    const container = containerRef.current;
    if (!map || status !== 'ready') {
      return undefined;
    }

    mapListenerRefs.current.forEach((listener) => listener?.remove?.());
    mapListenerRefs.current = [];
    curvePreviewLineRef.current?.setMap(null);
    curvePreviewLineRef.current = null;
    curvePointerIdRef.current = null;
    curveStrokePointsRef.current = [];
    isDrawingRef.current = false;
    lastDrawPointRef.current = null;
    suppressNextMapEditEventRef.current = false;
    const previousTouchAction = container?.style.touchAction ?? '';
    const mappingInputEnabled = mappingMode && !raceViewFullscreen;
    const isSplitPlacementMode = mappingInputEnabled
      && mappingEditMode === 'split'
      && (!draftSplitBuilder?.splitPoint || !draftSplitBuilder?.mergePoint);
    const isSplitBranchDrawMode = mappingInputEnabled
      && mappingEditMode === 'split'
      && Boolean(draftSplitBuilder?.splitPoint && draftSplitBuilder.mergePoint);
    const isCurveDrawMode = mappingInputEnabled && mappingEditMode === 'curve';
    const isAdjustMode = mappingInputEnabled && mappingEditMode === 'adjust';
    const isDrawMode = mappingInputEnabled && (mappingEditMode === 'draw' || isCurveDrawMode || isSplitBranchDrawMode);
    const isNavigateMode = !mappingInputEnabled || mappingEditMode === 'navigate';
    const raceCameraInputLocked = raceViewFullscreen && cameraLocked;
    map.setOptions({
      cameraControl: !raceCameraInputLocked,
      draggable: !raceCameraInputLocked && !isDrawMode && !isSplitPlacementMode,
      draggableCursor: mappingInputEnabled && !isNavigateMode ? 'crosshair' : undefined,
      gestureHandling: raceCameraInputLocked || isCurveDrawMode ? 'none' : 'greedy',
      headingInteractionEnabled: !raceCameraInputLocked && isNavigateMode,
      keyboardShortcuts: !raceCameraInputLocked,
      rotateControl: !raceCameraInputLocked,
      scrollwheel: !raceCameraInputLocked,
      tiltInteractionEnabled: !raceCameraInputLocked && isNavigateMode,
      zoomControl: !raceCameraInputLocked,
    });
    if (isCurveDrawMode && container) {
      container.style.touchAction = 'none';
    }

    if (!mappingInputEnabled) {
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

    const clearCurveStroke = () => {
      curvePreviewLineRef.current?.setMap(null);
      curvePreviewLineRef.current = null;
      curvePointerIdRef.current = null;
      curveStrokePointsRef.current = [];
      isDrawingRef.current = false;
      lastDrawPointRef.current = null;
    };

    const pointFromPointerEvent = (event: PointerEvent): TrackPoint | null => {
      const projection = projectionOverlayRef.current?.getProjection();
      if (!google || !container || !projection) {
        return null;
      }

      const bounds = container.getBoundingClientRect();
      const point = new google.maps.Point(event.clientX - bounds.left, event.clientY - bounds.top);
      return projection.fromContainerPixelToLatLng(point)?.toJSON() ?? null;
    };

    const updateCurvePreview = () => {
      if (!curvePreviewLineRef.current) {
        return;
      }

      const rawPoints = curveStrokePointsRef.current;
      const previewPoints = smoothCurvePoints(samplePointsByDistance(rawPoints, curveRawSampleMeters));
      curvePreviewLineRef.current.setPath?.(previewPoints);
    };

    const addCurvePoint = (point: TrackPoint) => {
      const previous = curveStrokePointsRef.current[curveStrokePointsRef.current.length - 1];
      if (previous && distanceBetweenTrackPoints(previous, point) < curveRawSampleMeters) {
        return;
      }

      curveStrokePointsRef.current = [...curveStrokePointsRef.current, point];
      updateCurvePreview();
    };

    const startCurveStroke = (event: PointerEvent) => {
      if (!isCurveDrawMode || !google || !container || !onMappingPathPointAdd) {
        return;
      }

      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }

      const point = pointFromPointerEvent(event);
      if (!point) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      clearCurveStroke();
      curvePointerIdRef.current = event.pointerId;
      isDrawingRef.current = true;
      curvePreviewLineRef.current = new google.maps.Polyline({
        clickable: false,
        map,
        path: [point],
        strokeColor: draftRouteColor,
        strokeOpacity: 0.88,
        strokeWeight: mappingRouteCoreStrokeWeight,
        zIndex: 980,
      });
      container.setPointerCapture?.(event.pointerId);
      addCurvePoint(point);
    };

    const moveCurveStroke = (event: PointerEvent) => {
      if (!isCurveDrawMode || curvePointerIdRef.current !== event.pointerId) {
        return;
      }

      const point = pointFromPointerEvent(event);
      if (!point) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      addCurvePoint(point);
    };

    const finishCurveStroke = (event: PointerEvent) => {
      if (!isCurveDrawMode || curvePointerIdRef.current !== event.pointerId) {
        return;
      }

      const point = pointFromPointerEvent(event);
      if (point) {
        addCurvePoint(point);
      }

      event.preventDefault();
      event.stopPropagation();
      const strokePoints = preparedCurveStroke(curveStrokePointsRef.current);
      strokePoints.forEach((strokePoint) => onMappingPathPointAdd?.(strokePoint));
      try {
        container?.releasePointerCapture?.(event.pointerId);
      } catch {
        // Some browsers release touch/pencil capture before pointercancel reaches us.
      }
      clearCurveStroke();
    };

    if (isCurveDrawMode && container) {
      container.addEventListener('pointerdown', startCurveStroke, { passive: false });
      container.addEventListener('pointermove', moveCurveStroke, { passive: false });
      window.addEventListener('pointerup', finishCurveStroke, { passive: false });
      window.addEventListener('pointercancel', finishCurveStroke, { passive: false });
    }

    const consumeSuppressedMapEditEvent = () => {
      if (!suppressNextMapEditEventRef.current) {
        return false;
      }

      suppressNextMapEditEventRef.current = false;
      isDrawingRef.current = false;
      lastDrawPointRef.current = null;
      return true;
    };

    window.addEventListener('mouseup', finishSplitBranchDrawing);
    window.addEventListener('touchend', finishSplitBranchDrawing);

    mapListenerRefs.current = [
      map.addListener('mousedown', (event) => {
        if (consumeSuppressedMapEditEvent()) {
          return;
        }

        const point = event?.latLng?.toJSON();
        if (!point) {
          return;
        }

        if (mappingEditMode === 'navigate') {
          return;
        }

        if (mappingEditMode === 'zones') {
          return;
        }

        if (isAdjustMode) {
          return;
        }

        if (isSplitPlacementMode) {
          return;
        }

        if (isCurveDrawMode) {
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
        if (consumeSuppressedMapEditEvent()) {
          return;
        }

        const point = event?.latLng?.toJSON();
        if (
          point
          && isAdjustMode
          && selectedPathPointIndex != null
          && onMappingPathPointMove
        ) {
          onMappingPathPointMove(selectedPathPointIndex, point);
          setSelectedPathPointIndex(null);
          return;
        }
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
      if (container) {
        container.style.touchAction = previousTouchAction;
        container.removeEventListener('pointerdown', startCurveStroke);
        container.removeEventListener('pointermove', moveCurveStroke);
      }
      window.removeEventListener('pointerup', finishCurveStroke);
      window.removeEventListener('pointercancel', finishCurveStroke);
      window.removeEventListener('mouseup', finishSplitBranchDrawing);
      window.removeEventListener('touchend', finishSplitBranchDrawing);
      mapListenerRefs.current.forEach((listener) => listener?.remove?.());
      mapListenerRefs.current = [];
      suppressNextMapEditEventRef.current = false;
      clearCurveStroke();
      map.setOptions({
        cameraControl: true,
        draggable: true,
        draggableCursor: undefined,
        gestureHandling: 'greedy',
        headingInteractionEnabled: true,
        keyboardShortcuts: true,
        rotateControl: true,
        scrollwheel: true,
        tiltInteractionEnabled: true,
        zoomControl: true,
      });
    };
  }, [
    draftRouteColor,
    mappingEditMode,
    mappingMode,
    draftSplitBuilder,
    onMappingPathPointAdd,
    onMappingPathPointMove,
    onMappingSplitDrawEnd,
    onMappingSplitPointAdd,
    onMappingZonePointAdd,
    raceState,
    raceViewFullscreen,
    cameraLocked,
    selectedPathPointIndex,
    status,
  ]);

  useEffect(() => {
    const google = googleRef.current;
    const map = mapRef.current;
    if (!google || !map || status !== 'ready') {
      return;
    }

    const activePlayerIds = new Set(riders.map((rider) => rider.playerId));
    markerRefs.current.forEach((marker, playerId) => {
      if (!activePlayerIds.has(playerId as PlayerSlot['id'])) {
        marker.setMap(null);
        markerRefs.current.delete(playerId);
      }
    });

    const laneOffsetsByPlayer = riderLaneOffsetsByPlayer(players);
    const screenLaneOffsetsByPlayer = riderScreenLaneOffsetsByPlayer(players);

    riders.forEach((rider) => {
      const player = players.find((slot) => slot.id === rider.playerId);
      if (!player) {
        return;
      }

      const pose = riderRoutePose(
        track,
        visualRiderDistanceMeters(rider.distance, cStartOffsetsByPlayer[player.id] ?? 0),
        rider.actualBranches,
      );
      const speedKph = rider.velocity > 0 ? rider.velocity * 3.6 : null;
      const label = `${formatSpeedFromKph(speedKph, speedUnit)} ${speedUnitLabel(speedUnit)}`;
      const existing = markerRefs.current.get(player.id);

      if (!pose) {
        existing?.setMap(null);
        markerRefs.current.delete(player.id);
        return;
      }

      const rotation = riderScreenRotation(pose.bearing, earthHeading);
      const animation = riderAnimationState({
        raceState,
        distanceMeters: rider.distance,
        pedalPhase: rider.pedalPhase,
        driveAllowed: rider.driveAllowed,
        driveSource: rider.driveSource,
        cadenceRpm: rider.lastRawCadence,
        watts: rider.lastRawWatts,
      });
      const title = `${player.name} / ${label}`;
      const laneOffsetPixels = screenLaneOffsetsByPlayer.get(player.id) ?? 0;
      const position = offsetRiderMapPosition(
        pose.position,
        pose.bearing,
        laneOffsetsByPlayer.get(player.id) ?? 0,
      );

      if (existing) {
        existing.setPosition(position);
        existing.setVisual(rotation, animation, laneOffsetPixels);
        existing.setLabel('');
        existing.setTitle(title);
        return;
      }

      const marker = createRiderMapMarker(
        google,
        map,
        player,
        position,
        rotation,
        animation,
        laneOffsetPixels,
        title,
      );
      markerRefs.current.set(player.id, marker);
    });
  }, [cStartOffsetsByPlayer, earthHeading, players, raceState, riders, samplesByDevice, speedUnit, status, track]);

  useEffect(() => {
    const google = googleRef.current;
    const map = mapRef.current;
    if (!google || !map || status !== 'ready') {
      return;
    }

    const activeGhostIds = new Set(ghostRiders.map((rider) => rider.id));
    ghostMarkerRefs.current.forEach((marker, ghostId) => {
      if (!activeGhostIds.has(ghostId)) {
        marker.setMap(null);
        ghostMarkerRefs.current.delete(ghostId);
      }
    });

    ghostRiders.forEach((rider, index) => {
      const pose = riderRoutePose(track, visualRiderDistanceMeters(rider.distance), rider.actualBranches);
      const existing = ghostMarkerRefs.current.get(rider.id);

      if (!pose) {
        existing?.setMap(null);
        ghostMarkerRefs.current.delete(rider.id);
        return;
      }

      const ghostPlayer: PlayerSlot = {
        id: ((index % 4) + 1) as PlayerId,
        name: rider.name,
        colorName: 'blue',
        accent: '#22d3ee',
        deviceId: null,
      };
      const speedKph = rider.velocity > 0 ? rider.velocity * 3.6 : null;
      const label = `${formatSpeedFromKph(speedKph, speedUnit)} ${speedUnitLabel(speedUnit)}`;
      const rotation = riderScreenRotation(pose.bearing, earthHeading);
      const animation = coastingRiderAnimation(rider.distance);
      const title = `${rider.name} / ${label} / ghost`;
      const position = offsetRiderMapPosition(
        pose.position,
        pose.bearing,
        remoteRiderLaneOffset(index + 1) * 0.45,
      );

      if (existing) {
        existing.setPosition(position);
        existing.setVisual(rotation, animation, 0);
        existing.setLabel('');
        existing.setTitle(title);
        return;
      }

      const marker = createRiderMapMarker(
        google,
        map,
        ghostPlayer,
        position,
        rotation,
        animation,
        0,
        title,
        820 + index,
        'ghost',
      );
      ghostMarkerRefs.current.set(rider.id, marker);
    });
  }, [earthHeading, ghostRiders, speedUnit, status, track]);

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
        const elapsedSinceReceivedMs = Math.max(0, Date.now() - (state.receivedAt ?? state.at));
        const projectedDistance = rider.finishedAt == null && state.raceState === 'racing'
          ? rider.distance + (rider.velocity * Math.min(0.35, elapsedSinceReceivedMs / 1000))
          : rider.distance;
        const pose = riderRoutePose(
          track,
          visualRiderDistanceMeters(Math.min(track.lengthMeters, projectedDistance)),
          rider.actualBranches ?? {},
        );
        const existing = remoteMarkerRefs.current.get(markerKey);

        if (!pose) {
          existing?.setMap(null);
          remoteMarkerRefs.current.delete(markerKey);
          return;
        }

        const remotePlayer: PlayerSlot = {
          id: ((remoteIndex % 4) + 1) as PlayerId,
          name: rider.name,
          colorName: rider.colorName,
          accent: rider.accent,
          deviceId: null,
        };
        const speedKph = rider.speedKph ?? (rider.velocity > 0 ? rider.velocity * 3.6 : null);
        const label = `${formatSpeedFromKph(speedKph, speedUnit)} ${speedUnitLabel(speedUnit)}`;
        const rotation = riderScreenRotation(pose.bearing, earthHeading);
        const animation = coastingRiderAnimation(projectedDistance);
        const title = `${rider.name} / ${label} / remote`;
        const position = offsetRiderMapPosition(
          pose.position,
          pose.bearing,
          remoteRiderLaneOffset(remoteIndex),
        );

        if (existing) {
          existing.setPosition(position);
          existing.setVisual(rotation, animation, 0);
          existing.setTitle(title);
        } else {
          const marker = createRiderMapMarker(
            google,
            map,
            remotePlayer,
            position,
            rotation,
            animation,
            0,
            title,
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
      {dragMeasurement && (
        <output
          className="earth-overlay map-adjust-measurement"
          aria-live="polite"
          style={{ left: '50%', top: 14, zIndex: 12, padding: '7px 12px', pointerEvents: 'none', transform: 'translateX(-50%)' }}
        >
          <span>{dragMeasurement.pointLabel}</span>
          <strong>{formatDistanceMeters(dragMeasurement.distanceMeters, distanceUnit)}</strong>
          <small>Live route length</small>
        </output>
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
