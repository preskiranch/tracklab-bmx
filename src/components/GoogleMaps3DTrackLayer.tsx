import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Box, Check, MousePointer2, RotateCcw, Trash2, X } from 'lucide-react';
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
import {
  loadGoogleMaps3DLibrary,
  mappedTrackRoute,
  riderRoutePose,
  trackBoundsPoints,
  trackCenter,
  trackFinishPoint,
  trackStartPoint,
  zonePolyline,
  type GoogleMap3DElement,
  type GoogleMarker3DElement,
  type GoogleMaps3DLibrary,
} from '../lib/googleMaps';
import {
  elevatedPath,
  isGoogleMaps3DSteadyEvent,
  previewRangeMeters,
  projectScreenPointToGround,
  terrainRelativeCamera,
} from '../lib/googleMaps3d';
import {
  distanceBetweenTrackPoints,
  pointAtRouteMeter,
  routeLengthMeters,
  routeWithDefaultSplitBranches,
  routeWithSplitBranchSelections,
} from '../lib/trackMapping';
import { curveRawSampleMeters, preparedCurveStroke } from '../lib/trackCurve';
import { formatDistanceMeters, formatSpeedFromKph, speedUnitLabel } from '../units';
import { recordMap3DLoad, type Map3DLoadContext } from '../lib/map3dUsage';
import { cStartVisualDistance, type CStartOffsetsByPlayer } from '../lib/bmxGateStart';
import {
  riderAirPixelsToMeters,
  riderLaneOffsetsByPlayer,
  riderMarkerCanvasSize,
  riderMarkerDrawSize,
  riderMarkerSafetyInsetPixels,
  uprightRiderOrientation,
} from '../lib/riderPresentation';
import {
  ghostPlaybackAccent,
  ghostPlaybackColorName,
  ghostPlaybackGlow,
} from '../lib/ghosts';
import { riderRigBaseAssetByColor } from '../lib/riderAssets';

type GoogleMaps3DTrackLayerProps = {
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
  onUseSatellite: () => void;
};

type LayerState = 'loading' | 'ready' | 'error';
type EditSelection = { kind: 'path' | 'zone'; index: number } | null;
type SceneElement = HTMLElement;
type DynamicMarker = {
  marker: GoogleMarker3DElement;
  content: HTMLDivElement | null;
};
type MarkerConstructor = new (options?: Record<string, unknown>) => GoogleMarker3DElement;

const routeColors: Record<TrackRouteVariantId, string> = {
  amateur: '#d8ff3e',
  pro: '#38bdf8',
};
const splitBranchMinInteriorPoints = 2;
const splitBranchEndpointSnapMeters = 8;
const remoteRiderLaneOffsetBaseMeters = 3.2;
const remoteRiderLaneSpacingMeters = 0.7;

export function formatProSetPedalStart3DTitle(distanceUnit: DistanceUnit) {
  return `Set Pro Set pedal start at split (${formatDistanceMeters(0, distanceUnit)})`;
}

function normalizeHeading(value: number) {
  return ((value % 360) + 360) % 360;
}

function zoomToRange(baseRange: number, zoom: number | null) {
  if (zoom == null) {
    return baseRange;
  }
  return Math.max(40, Math.min(20_000, baseRange * (2 ** (19 - zoom))));
}

function rangeToZoom(baseRange: number, range: number | undefined, fallback: number | null) {
  if (!range || range <= 0 || baseRange <= 0) {
    return fallback ?? undefined;
  }
  return 19 - Math.log2(range / baseRange);
}

export type Deferred3DMapView = Readonly<{
  trackId: string;
  trackCenter: TrackPoint;
  baseRange: number;
  angle: number;
  heading: number;
  center: TrackPoint | null;
  zoom: number | null;
}>;

/** Resolve the newest camera only when the asynchronous 3D map is ready. */
export function resolveDeferred3DMapView(
  viewRef: Readonly<{ current: Deferred3DMapView }>,
) {
  const latest = viewRef.current;
  return {
    trackId: latest.trackId,
    center: latest.center ?? latest.trackCenter,
    angle: latest.angle,
    heading: latest.heading,
    range: zoomToRange(latest.baseRange, latest.zoom),
    baseRange: latest.baseRange,
    zoom: latest.zoom,
  };
}

function applyTerrainRelativeCamera(
  map: GoogleMap3DElement,
  center: TrackPoint,
  heading: number,
  tilt: number,
  range: number,
) {
  const endCamera = terrainRelativeCamera(center, heading, tilt, range);
  if (map.flyCameraTo) {
    try {
      const transition = map.flyCameraTo({ endCamera, durationMillis: 1 });
      if (transition instanceof Promise) {
        void transition.catch(() => undefined);
      }
      return;
    } catch {
      // Older Maps builds may expose the method before the element is connected.
    }
  }

  map.center = endCamera.center;
  map.heading = heading;
  map.tilt = tilt;
  map.range = range;
}

function pointFromMapEvent(event: Event): TrackPoint | null {
  const mapEvent = event as Event & {
    position?: { lat?: number; lng?: number };
    detail?: { position?: { lat?: number; lng?: number } };
  };
  const position = mapEvent.position ?? mapEvent.detail?.position;
  const point = typeof position?.lat === 'number' && typeof position.lng === 'number'
    ? { lat: position.lat, lng: position.lng }
    : null;

  return point && isTrackPointUsable(point) ? point : null;
}

function isTrackPointUsable(point: TrackPoint | null | undefined): point is TrackPoint {
  return point != null
    && Number.isFinite(point.lat)
    && Number.isFinite(point.lng)
    && Math.abs(point.lat) <= 90
    && Math.abs(point.lng) <= 180;
}

function safeNumber(value: number | undefined, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function pointerPixelFromRect(event: ReactPointerEvent<HTMLDivElement>, rect: DOMRect) {
  const pixel = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };

  return Number.isFinite(pixel.x) && Number.isFinite(pixel.y) ? pixel : null;
}

function trySetPointerCapture(element: Element, pointerId: number) {
  const pointerElement = element as Element & { setPointerCapture?: (pointerId: number) => void };
  try {
    pointerElement.setPointerCapture?.(pointerId);
  } catch {
    // Browser touch/pencil capture can fail if the pointer was already cancelled.
  }
}

function tryReleasePointerCapture(element: Element, pointerId: number) {
  const pointerElement = element as Element & { releasePointerCapture?: (pointerId: number) => void };
  try {
    pointerElement.releasePointerCapture?.(pointerId);
  } catch {
    // Pointer capture can already be released if the browser cancels the gesture.
  }
}

function appendPolyline(
  map: GoogleMap3DElement,
  Polyline3DElement: GoogleMaps3DLibrary['Polyline3DElement'],
  path: TrackPoint[],
  options: Record<string, unknown>,
) {
  const cleanPath = path.filter(isTrackPointUsable);
  if (cleanPath.length < 2) {
    return null;
  }
  try {
    const line = new Polyline3DElement({
      altitudeMode: 'RELATIVE_TO_GROUND',
      drawsOccludedSegments: true,
      path: elevatedPath(cleanPath),
      ...options,
    });
    map.append(line);
    return line;
  } catch (error) {
    console.error('TrackLab could not render a Google 3D polyline.', error);
    return null;
  }
}

function makeMarkerContent(className: string, label: string) {
  const content = document.createElement('div');
  content.className = className;
  content.textContent = label;
  return content;
}

function createMarkerSafely(
  Marker: MarkerConstructor,
  options: Record<string, unknown>,
) {
  try {
    return new Marker(options);
  } catch (error) {
    console.error('TrackLab could not render a Google 3D marker.', error);
    return null;
  }
}

function appendMarker(
  map: GoogleMap3DElement,
  library: GoogleMaps3DLibrary,
  position: TrackPoint,
  options: {
    className?: string;
    interactive?: boolean;
    label?: string;
    title: string;
    zIndex?: number;
    onClick?: () => void;
  },
) {
  const CustomConstructor = options.interactive
    ? library.MarkerInteractiveElement
    : library.MarkerElement;
  const StandardConstructor = options.interactive
    ? library.Marker3DInteractiveElement ?? library.Marker3DElement
    : library.Marker3DElement;
  // Current Maps builds expose Marker3DInteractiveElement for reliable touch and
  // keyboard clicks. Prefer it over the older custom interactive marker name.
  const useCustomConstructor = Boolean(CustomConstructor && (!options.interactive || !StandardConstructor));
  const MarkerConstructor = useCustomConstructor
    ? CustomConstructor
    : StandardConstructor ?? CustomConstructor;
  if (!MarkerConstructor) {
    return null;
  }

  const markerPosition = { ...position, altitude: 1.2 };
  const marker = useCustomConstructor
    ? createMarkerSafely(MarkerConstructor, {
        altitudeMode: 'RELATIVE_TO_GROUND',
        position: markerPosition,
        title: options.title,
      })
    : createMarkerSafely(MarkerConstructor, {
        altitudeMode: 'RELATIVE_TO_GROUND',
        drawsWhenOccluded: true,
        label: options.label,
        position: markerPosition,
        sizePreserved: true,
        title: options.title,
        zIndex: options.zIndex,
      });
  if (!marker) {
    return null;
  }
  if (useCustomConstructor && options.zIndex != null) {
    marker.style.zIndex = String(options.zIndex);
  }
  const content = useCustomConstructor && options.label
    ? makeMarkerContent(options.className ?? 'map-3d-landmark-marker', options.label)
    : null;
  if (content) {
    marker.append(content);
  }
  if (options.onClick) {
    marker.addEventListener('gmp-click', (event) => {
      event.stopPropagation();
      options.onClick?.();
    });
  }
  map.append(marker);
  return marker;
}

function routePathBetweenMeters(route: TrackPoint[], startMeter: number, endMeter: number) {
  if (route.length < 2 || endMeter <= startMeter) {
    return [];
  }
  return Array.from({ length: 28 }, (_, index) => {
    const meter = startMeter + ((endMeter - startMeter) * index) / 27;
    return pointAtRouteMeter(route, meter);
  }).filter((point): point is TrackPoint => point != null);
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

function raceLinePath(position: TrackPoint, bearingDegrees: number) {
  const crossBearing = normalizeHeading(bearingDegrees + 90);
  return [-4.5, 4.5].map((meters) => pointAtBearingDistance(position, crossBearing, meters));
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

function offsetRiderPosition(position: TrackPoint, bearingDegrees: number, lateralMeters: number) {
  if (Math.abs(lateralMeters) < 0.05) {
    return position;
  }
  return pointAtBearingDistance(
    position,
    normalizeHeading(bearingDegrees + (lateralMeters > 0 ? 90 : -90)),
    Math.abs(lateralMeters),
  );
}

function remoteRiderLaneOffset(index: number) {
  const side = index % 2 === 0 ? 1 : -1;
  return side * (remoteRiderLaneOffsetBaseMeters + Math.floor(index / 2) * remoteRiderLaneSpacingMeters);
}

function visualRiderDistance(distanceMeters: number, cStartBackoffMeters = 0) {
  const routeDistance = Math.max(0, distanceMeters);
  return Math.max(0, cStartVisualDistance(routeDistance, cStartBackoffMeters));
}

function createRiderContent(
  player: Pick<PlayerSlot, 'colorName' | 'accent'>,
  label: string,
  appearance: 'live' | 'ghost' | 'remote',
) {
  const content = document.createElement('div');
  content.className = `map-3d-rider-marker map-3d-rider-marker-${appearance}`;
  content.style.setProperty('--rider-accent', appearance === 'ghost' ? ghostPlaybackAccent : player.accent);
  content.dataset.riderCanvasSize = String(riderMarkerCanvasSize);
  content.style.height = `${riderMarkerCanvasSize}px`;
  content.style.overflow = 'visible';
  content.style.pointerEvents = 'none';
  content.style.position = 'relative';
  content.style.width = `${riderMarkerCanvasSize}px`;
  content.title = label;
  content.setAttribute('aria-label', label);
  const image = document.createElement('img');
  image.className = 'map-3d-rider-image';
  image.alt = label;
  image.src = riderRigBaseAssetByColor[
    appearance === 'ghost' ? ghostPlaybackColorName : player.colorName
  ];
  image.style.display = 'block';
  image.style.height = `${riderMarkerDrawSize}px`;
  image.style.left = `${riderMarkerSafetyInsetPixels}px`;
  image.style.objectFit = 'contain';
  image.style.position = 'absolute';
  image.style.top = `${riderMarkerSafetyInsetPixels}px`;
  image.style.transformOrigin = '50% 100%';
  image.style.width = `${riderMarkerDrawSize}px`;
  if (appearance === 'ghost') {
    content.dataset.ghostColor = 'fluorescent-orange';
    image.style.filter = `hue-rotate(-28deg) saturate(2.6) brightness(1.18) drop-shadow(0 0 5px ${ghostPlaybackGlow})`;
    image.style.opacity = '0.72';
  }
  content.append(image);
  return content;
}

function createDynamicRiderMarker(
  map: GoogleMap3DElement,
  library: GoogleMaps3DLibrary,
  position: TrackPoint,
  player: Pick<PlayerSlot, 'colorName' | 'accent'>,
  label: string,
  title: string,
  appearance: 'live' | 'ghost' | 'remote',
  zIndex: number,
) {
  const MarkerConstructor = library.MarkerElement ?? library.Marker3DElement;
  if (!MarkerConstructor) {
    return null;
  }
  const markerPosition = { ...position, altitude: 1 };
  const marker = library.MarkerElement
    ? createMarkerSafely(MarkerConstructor, {
        altitudeMode: 'RELATIVE_TO_GROUND',
        position: markerPosition,
        title,
      })
    : createMarkerSafely(MarkerConstructor, {
        altitudeMode: 'RELATIVE_TO_GROUND',
        drawsWhenOccluded: true,
        label: '',
        position: markerPosition,
        sizePreserved: true,
        title,
        zIndex,
      });
  if (!marker) {
    return null;
  }
  if (library.MarkerElement) {
    marker.style.zIndex = String(zIndex);
  }
  const content = library.MarkerElement ? createRiderContent(player, label, appearance) : null;
  if (content) {
    marker.append(content);
  }
  map.append(marker);
  return { marker, content } satisfies DynamicMarker;
}

function updateDynamicRiderMarker(
  dynamic: DynamicMarker,
  position: TrackPoint,
  altitude: number,
  bearing: number,
  mapHeading: number,
  label: string,
  title: string,
  cStartLoaded: boolean,
) {
  dynamic.marker.position = { ...position, altitude };
  dynamic.marker.title = title;
  if (!dynamic.content) {
    dynamic.marker.label = '';
    return;
  }
  dynamic.content.title = title;
  dynamic.content.setAttribute('aria-label', label);
  dynamic.content.classList.toggle('map-3d-rider-marker-c-start', cStartLoaded);
  const image = dynamic.content.querySelector<HTMLImageElement>('.map-3d-rider-image');
  if (image) {
    const orientation = uprightRiderOrientation(bearing - mapHeading - 90);
    const radians = (orientation.leanDegrees * Math.PI) / 180;
    const tireX = riderMarkerDrawSize * 0.465 * (orientation.mirrored ? -1 : 1);
    const tireY = -riderMarkerDrawSize * 0.04;
    const anchorX = tireX * Math.cos(radians) - tireY * Math.sin(radians);
    const anchorY = tireX * Math.sin(radians) + tireY * Math.cos(radians);
    // MarkerElement anchors custom content at its bottom center. The larger
    // safety envelope moves that edge down by the inset, so compensate here
    // to leave the visible 58px rider at exactly the same screen position.
    dynamic.content.style.transform = `translate(${-anchorX}px, ${
      riderMarkerSafetyInsetPixels - anchorY
    }px)`;
    image.style.transform = `rotate(${orientation.leanDegrees}deg) scaleX(${orientation.mirrored ? -1 : 1})`;
  }
}

function removeElements(elements: SceneElement[]) {
  elements.forEach((element) => {
    try {
      element.remove();
    } catch {
      // A rejected Google Maps custom element can throw while disconnecting.
    }
  });
  elements.length = 0;
}

function replaceChildrenSafely(container: HTMLElement | null, ...nodes: Node[]) {
  if (!container) {
    return;
  }
  try {
    container.replaceChildren(...nodes);
  } catch {
    // Keep the React tree alive if a Google Maps custom element fails to detach.
  }
}

export function GoogleMaps3DTrackLayer({
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
  mappingEditMode = 'navigate',
  mappingRouteVariantId = 'amateur',
  mappingZoneBranchChoice = 'a',
  draftPoints = [],
  draftZoneRoutePoints = [],
  draftZoneSectionId = null,
  draftZoneMeters = [],
  draftZonePoints = [],
  draftReferenceZones = [],
  draftSplitSections = [],
  draftRouteSplitSections = [],
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
  onUseSatellite,
}: GoogleMaps3DTrackLayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GoogleMap3DElement | null>(null);
  const libraryRef = useRef<GoogleMaps3DLibrary | null>(null);
  const staticElementsRef = useRef<SceneElement[]>([]);
  const dynamicMarkersRef = useRef<Map<string, DynamicMarker>>(new Map());
  const cameraTimerRef = useRef(0);
  const sceneContextRef = useRef<Map3DLoadContext>('view');
  const interactionRef = useRef<(point: TrackPoint) => void>(() => undefined);
  const cameraChangeRef = useRef(onEarthCameraChange);
  const useSatelliteRef = useRef(onUseSatellite);
  const baseRangeRef = useRef(500);
  const suppressNextMapClickRef = useRef(false);
  const curvePointerIdRef = useRef<number | null>(null);
  const curveStrokeRef = useRef<TrackPoint[]>([]);
  const splitPointerIdRef = useRef<number | null>(null);
  const splitStrokeRef = useRef<TrackPoint[]>([]);
  const [layerState, setLayerState] = useState<LayerState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [sceneVersion, setSceneVersion] = useState(0);
  const [selectedEditPoint, setSelectedEditPoint] = useState<EditSelection>(null);
  const [curvePreviewPixels, setCurvePreviewPixels] = useState<Array<{ x: number; y: number }>>([]);
  const [splitPreviewPixels, setSplitPreviewPixels] = useState<Array<{ x: number; y: number }>>([]);
  const savedRoute = useMemo(() => mappedTrackRoute(track), [track]);
  const center = useMemo(() => trackCenter(track), [track]);
  const boundsPoints = useMemo(() => trackBoundsPoints(track), [track]);
  const baseRange = useMemo(
    () => previewRangeMeters(boundsPoints.length > 0 ? boundsPoints : savedRoute, center),
    [boundsPoints, center, savedRoute],
  );
  const latestMapViewRef = useRef<Deferred3DMapView>({
    trackId: track.id,
    trackCenter: center,
    baseRange,
    angle: earthAngle,
    heading: earthHeading,
    center: earthCenter,
    zoom: earthZoom,
  });
  latestMapViewRef.current = {
    trackId: track.id,
    trackCenter: center,
    baseRange,
    angle: earthAngle,
    heading: earthHeading,
    center: earthCenter,
    zoom: earthZoom,
  };
  const draftRoute = useMemo(
    () => routeWithDefaultSplitBranches(draftPoints, draftRouteSplitSections),
    [draftPoints, draftRouteSplitSections],
  );
  const activeDraftZoneRoute = draftZoneRoutePoints.length > 1 ? draftZoneRoutePoints : draftRoute;
  const isProSetZoneMapping = mappingMode
    && mappingEditMode === 'zones'
    && mappingZoneBranchChoice === 'b'
    && Boolean(draftZoneSectionId);
  const isCurveDrawMode = mappingMode && mappingEditMode === 'curve' && layerState === 'ready';
  const isSplitBranchDrawMode = mappingMode
    && mappingEditMode === 'split'
    && layerState === 'ready'
    && Boolean(draftSplitBuilder?.splitPoint)
    && Boolean(draftSplitBuilder?.mergePoint);

  sceneContextRef.current = raceViewFullscreen || raceState === 'racing'
    ? 'race'
    : mappingMode
      ? 'edit'
      : 'view';
  cameraChangeRef.current = onEarthCameraChange;
  useSatelliteRef.current = onUseSatellite;
  baseRangeRef.current = baseRange;

  useEffect(() => {
    let cancelled = false;
    let mountedMap: GoogleMap3DElement | null = null;
    let loadRecorded = false;
    let sceneFailed = false;
    let readinessTimer = 0;
    let fallbackTimer = 0;
    const listeners: Array<{ name: string; listener: EventListener }> = [];
    setLayerState('loading');
    setErrorMessage('');
    setSceneVersion(0);
    setSelectedEditPoint(null);

    const fallbackToSatellite = (message: string) => {
      if (cancelled || sceneFailed) {
        return;
      }
      sceneFailed = true;
      window.clearTimeout(readinessTimer);
      setLayerState('error');
      setErrorMessage(message);
      fallbackTimer = window.setTimeout(() => {
        if (!cancelled) {
          useSatelliteRef.current();
        }
      }, 0);
    };
    const authFailureListener = () => {
      fallbackToSatellite('Google could not authorize photorealistic 3D. Switching to satellite view.');
    };
    window.addEventListener('tracklab-google-maps-auth-failure', authFailureListener);

    loadGoogleMaps3DLibrary()
      .then((library) => {
        if (cancelled || !containerRef.current) {
          return;
        }
        libraryRef.current = library;
        const readyView = resolveDeferred3DMapView(latestMapViewRef);
        const map = new library.Map3DElement({
          center: { ...readyView.center, altitude: 0 },
          heading: readyView.heading,
          mode: 'SATELLITE',
          range: readyView.range,
          tilt: readyView.angle,
        });
        map.style.width = '100%';
        map.style.height = '100%';
        map.style.display = 'block';

        const saveCamera = () => {
          window.clearTimeout(cameraTimerRef.current);
          cameraTimerRef.current = window.setTimeout(() => {
            const currentView = resolveDeferred3DMapView(latestMapViewRef);
            const nextCenter = map.center;
            cameraChangeRef.current?.({
              angle: Math.round(map.tilt ?? currentView.angle),
              center: nextCenter ? { lat: nextCenter.lat, lng: nextCenter.lng } : currentView.center,
              heading: Math.round(map.heading ?? currentView.heading),
              zoom: rangeToZoom(currentView.baseRange, map.range, currentView.zoom),
            });
          }, 180);
        };
        ['gmp-centerchange', 'gmp-headingchange', 'gmp-tiltchange', 'gmp-rangechange'].forEach((name) => {
          const listener: EventListener = saveCamera;
          map.addEventListener(name, listener);
          listeners.push({ name, listener });
        });

        const mapClickListener: EventListener = (event) => {
          if (suppressNextMapClickRef.current) {
            suppressNextMapClickRef.current = false;
            return;
          }
          const point = pointFromMapEvent(event);
          if (point) {
            interactionRef.current(point);
          }
        };
        map.addEventListener('gmp-click', mapClickListener);
        listeners.push({ name: 'gmp-click', listener: mapClickListener });

        const steadyListener: EventListener = (event) => {
          if (sceneFailed || !isGoogleMaps3DSteadyEvent(event)) {
            return;
          }
          window.clearTimeout(readinessTimer);
          setLayerState('ready');
          setSceneVersion((current) => current + 1);
          if (!loadRecorded) {
            loadRecorded = true;
            void recordMap3DLoad(track, sceneContextRef.current).catch(() => undefined);
          }
        };
        map.addEventListener('gmp-steadychange', steadyListener);
        listeners.push({ name: 'gmp-steadychange', listener: steadyListener });

        const errorListener: EventListener = () => {
          fallbackToSatellite('Google could not render this photorealistic 3D scene.');
        };
        map.addEventListener('gmp-error', errorListener);
        listeners.push({ name: 'gmp-error', listener: errorListener });

        replaceChildrenSafely(containerRef.current, map);
        mountedMap = map;
        mapRef.current = map;
        applyTerrainRelativeCamera(
          map,
          readyView.center,
          readyView.heading,
          readyView.angle,
          readyView.range,
        );
        readinessTimer = window.setTimeout(() => {
          if (!cancelled && !sceneFailed && mountedMap === map) {
            fallbackToSatellite('Google 3D terrain took too long to load. Switching to satellite view.');
          }
        }, 15_000);
      })
      .catch((error: unknown) => {
        fallbackToSatellite(error instanceof Error ? error.message : 'The 3D scene could not be loaded.');
      });

    return () => {
      cancelled = true;
      window.removeEventListener('tracklab-google-maps-auth-failure', authFailureListener);
      window.clearTimeout(readinessTimer);
      window.clearTimeout(fallbackTimer);
      window.clearTimeout(cameraTimerRef.current);
      listeners.forEach(({ name, listener }) => mountedMap?.removeEventListener(name, listener));
      removeElements(staticElementsRef.current);
      dynamicMarkersRef.current.forEach(({ marker }) => {
        try {
          marker.remove();
        } catch {
          // The map may already have removed a failed custom marker.
        }
      });
      dynamicMarkersRef.current.clear();
      if (mapRef.current === mountedMap) {
        mapRef.current = null;
      }
      libraryRef.current = null;
      replaceChildrenSafely(containerRef.current);
    };
  // A scene load is intentionally tied to the selected track, not changing overlays or rider frames.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    const latestView = resolveDeferred3DMapView(latestMapViewRef);
    applyTerrainRelativeCamera(
      map,
      latestView.center,
      latestView.heading,
      latestView.angle,
      latestView.range,
    );
  }, [baseRange, center, earthAngle, earthCenter, earthHeading, earthZoom]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    map.gestureHandling = isCurveDrawMode || isSplitBranchDrawMode ? 'COOPERATIVE' : 'AUTO';
  }, [isCurveDrawMode, isSplitBranchDrawMode]);

  useEffect(() => {
    interactionRef.current = (point) => {
      if (!mappingMode || mappingEditMode === 'navigate') {
        return;
      }
      if (selectedEditPoint?.kind === 'path' && onMappingPathPointMove) {
        onMappingPathPointMove(selectedEditPoint.index, point);
        setSelectedEditPoint(null);
        return;
      }
      if (selectedEditPoint?.kind === 'zone' && onMappingZonePointMove) {
        onMappingZonePointMove(selectedEditPoint.index, point);
        setSelectedEditPoint(null);
        return;
      }
      if (mappingEditMode === 'draw' && onMappingPathPointAdd) {
        onMappingPathPointAdd(point);
      } else if (mappingEditMode === 'zones' && onMappingZonePointAdd) {
        onMappingZonePointAdd(point);
      } else if (mappingEditMode === 'split' && onMappingSplitPointAdd) {
        onMappingSplitPointAdd(point);
      }
    };
  }, [mappingEditMode, mappingMode, onMappingPathPointAdd, onMappingPathPointMove, onMappingSplitPointAdd, onMappingZonePointAdd, onMappingZonePointMove, selectedEditPoint]);

  useEffect(() => {
    const map = mapRef.current;
    const library = libraryRef.current;
    if (!map || !library || sceneVersion === 0) {
      return;
    }
    removeElements(staticElementsRef.current);
    const elements = staticElementsRef.current;
    const routeColor = routeColors[mappingRouteVariantId];
    const hideRaceRoute = raceViewFullscreen && raceState === 'racing';
    const visibleRoute = mappingMode ? draftRoute : savedRoute;

    if (!hideRaceRoute && visibleRoute.length > 1) {
      const line = appendPolyline(map, library.Polyline3DElement, visibleRoute, {
        outerColor: '#111827',
        outerWidth: mappingMode ? 0.7 : 0.45,
        strokeColor: routeColor,
        strokeWidth: mappingMode ? 9 : 7,
      });
      if (line) elements.push(line);
    }

    const zonesToDraw = mappingMode ? draftReferenceZones : activeZones;
    zonesToDraw.filter((zone) => zone.type === 'pedal').forEach((zone) => {
      const route = mappingMode
        ? routeWithSplitBranchSelections(draftPoints, draftRouteSplitSections, zone.branchSelections)
        : [];
      const path = mappingMode
        ? routePathBetweenMeters(route, zone.startMeter, zone.endMeter)
        : zonePolyline(track, zone);
      const line = appendPolyline(map, library.Polyline3DElement, path, {
        outerColor: '#052e16',
        outerWidth: 0.45,
        strokeColor: '#4ade80',
        strokeWidth: mappingMode ? 12 : 10,
      });
      if (line) elements.push(line);
    });

    if (mappingMode && activeDraftZoneRoute.length > 1) {
      const routeLength = routeLengthMeters(activeDraftZoneRoute);
      const meters = [...draftZoneMeters]
        .filter((meter) => meter >= 0 && meter <= routeLength)
        .sort((left, right) => left - right);
      for (let index = 0; index + 1 < meters.length; index += 2) {
        const line = appendPolyline(
          map,
          library.Polyline3DElement,
          routePathBetweenMeters(activeDraftZoneRoute, meters[index], meters[index + 1]),
          { outerColor: '#052e16', outerWidth: 0.55, strokeColor: '#4ade80', strokeWidth: 13 },
        );
        if (line) elements.push(line);
      }
    }

    const splitSections = mappingMode ? draftSplitSections : track.splitSections ?? [];
    if (!hideRaceRoute) {
      splitSections.forEach((section) => {
        const isActiveProZoneSection = isProSetZoneMapping && section.id === draftZoneSectionId;
        const canUseSectionForZoneBoundary = !isProSetZoneMapping || isActiveProZoneSection;
        const handleJunctionClick = (point: TrackPoint) => {
          suppressNextMapClickRef.current = true;
          if (mappingEditMode === 'zones') {
            onMappingZonePointAdd?.(point);
          } else if (mappingEditMode === 'split') {
            onMappingSplitPointAdd?.(point);
          } else if (mappingEditMode === 'draw') {
            onMappingPathPointAdd?.(point);
          }
        };
        section.branches.forEach((branch) => {
          const isActiveProBranch = isActiveProZoneSection && branch.id === 'b';
          const line = appendPolyline(map, library.Polyline3DElement, branch.points, {
            outerColor: '#111827',
            outerWidth: isActiveProBranch ? 0.65 : 0.4,
            strokeColor: branch.id === 'a' ? '#ff2d55' : '#38bdf8',
            strokeWidth: isActiveProZoneSection ? (isActiveProBranch ? 12 : 5) : mappingMode ? 9 : 7,
          });
          if (line) elements.push(line);
        });
        const splitMarker = appendMarker(map, library, section.splitPoint, {
          className: 'map-3d-junction-marker split',
          interactive: mappingMode && mappingEditMode !== 'navigate' && canUseSectionForZoneBoundary,
          label: `S${section.index}`,
          title: isActiveProZoneSection
            ? formatProSetPedalStart3DTitle(distanceUnit)
            : `Split ${section.index}`,
          zIndex: 780,
          onClick: mappingMode && mappingEditMode !== 'navigate' && canUseSectionForZoneBoundary
            ? () => handleJunctionClick(section.splitPoint)
            : undefined,
        });
        const mergeMarker = appendMarker(map, library, section.mergePoint, {
          className: 'map-3d-junction-marker merge',
          interactive: mappingMode && mappingEditMode !== 'navigate' && canUseSectionForZoneBoundary,
          label: `M${section.index}`,
          title: isActiveProZoneSection ? 'Snap Pro Set pedal endpoint to merge' : `Merge ${section.index}`,
          zIndex: 781,
          onClick: mappingMode && mappingEditMode !== 'navigate' && canUseSectionForZoneBoundary
            ? () => handleJunctionClick(section.mergePoint)
            : undefined,
        });
        if (splitMarker) elements.push(splitMarker);
        if (mergeMarker) elements.push(mergeMarker);
      });
    }

    if (mappingMode && draftSplitBuilder?.splitPoint) {
      const points = draftSplitBuilder.activeBranch === 'a' ? draftSplitBuilder.branchA : draftSplitBuilder.branchB;
      const branchPath = draftSplitBuilder.mergePoint && points.length > 0
        ? draftBranchPath(points, draftSplitBuilder.splitPoint, draftSplitBuilder.mergePoint)
        : [];
      if (branchPath.length > 1) {
        const line = appendPolyline(map, library.Polyline3DElement, branchPath, {
          outerColor: '#111827', outerWidth: 0.55,
          strokeColor: draftSplitBuilder.activeBranch === 'a' ? '#ff2d55' : '#38bdf8', strokeWidth: 10,
        });
        if (line) elements.push(line);
      }
    }

    const start = mappingMode ? draftPoints[0] : trackStartPoint(track);
    const finish = mappingMode
      ? draftPoints[draftPoints.length - 1]
      : raceDistanceMeters != null
        ? pointAtRouteMeter(savedRoute, Math.min(routeLengthMeters(savedRoute), raceDistanceMeters))
        : trackFinishPoint(track);
    if (!mappingMode) {
      const finishDistance = Math.min(routeLengthMeters(savedRoute), raceDistanceMeters ?? Number.POSITIVE_INFINITY);
      const raceLines = [
        { color: '#d8ff3e', pose: riderRoutePose(track, 0) },
        { color: '#ffffff', pose: riderRoutePose(track, finishDistance) },
      ];
      raceLines.forEach(({ color, pose }) => {
        if (!pose) return;
        const line = appendPolyline(map, library.Polyline3DElement, raceLinePath(pose.position, pose.bearing), {
          outerColor: '#111827', outerWidth: 0.75, strokeColor: color, strokeWidth: 14,
        });
        if (line) elements.push(line);
      });
    }
    if (start) {
      const marker = appendMarker(map, library, start, {
        className: 'map-3d-landmark-marker start', label: 'START', title: 'Start line', zIndex: 850,
      });
      if (marker) elements.push(marker);
    }
    if (finish && (!start || finish.lat !== start.lat || finish.lng !== start.lng)) {
      const marker = appendMarker(map, library, finish, {
        className: 'map-3d-landmark-marker finish', label: 'FINISH', title: 'Finish line', zIndex: 851,
      });
      if (marker) elements.push(marker);
    }

    if (mappingMode) {
      draftPoints.forEach((point, index) => {
        const isStart = index === 0;
        const isFinish = index === draftPoints.length - 1 && draftPoints.length > 1;
        const marker = appendMarker(map, library, point, {
          className: `map-3d-edit-marker${selectedEditPoint?.kind === 'path' && selectedEditPoint.index === index ? ' selected' : ''}`,
          interactive: true,
          label: isStart ? 'S' : isFinish ? 'F' : String(index + 1),
          title: `Route point ${index + 1}`,
          zIndex: 900 + index,
          onClick: () => {
            suppressNextMapClickRef.current = true;
            if (mappingEditMode === 'zones') {
              onMappingZonePointAdd?.(point);
            } else if (mappingEditMode === 'split') {
              onMappingSplitPointAdd?.(point);
            } else if (mappingEditMode === 'draw') {
              setSelectedEditPoint({ kind: 'path', index });
            }
          },
        });
        if (marker) elements.push(marker);
      });
      draftZonePoints.forEach((point, index) => {
        const number = Math.floor(index / 2) + 1;
        const marker = appendMarker(map, library, point, {
          className: `map-3d-edit-marker zone${selectedEditPoint?.kind === 'zone' && selectedEditPoint.index === index ? ' selected' : ''}`,
          interactive: true,
          label: `${index % 2 === 0 ? 'S' : 'E'}${number}`,
          title: `${index % 2 === 0 ? 'Start' : 'End'} pedal zone ${number}`,
          zIndex: 1_000 + index,
          onClick: () => {
            suppressNextMapClickRef.current = true;
            setSelectedEditPoint({ kind: 'zone', index });
          },
        });
        if (marker) elements.push(marker);
      });
    }

    return () => removeElements(elements);
  }, [activeDraftZoneRoute, activeZones, distanceUnit, draftPoints, draftReferenceZones, draftRoute, draftRouteSplitSections, draftSplitBuilder, draftSplitSections, draftZoneMeters, draftZonePoints, draftZoneSectionId, isProSetZoneMapping, mappingEditMode, mappingMode, mappingRouteVariantId, onMappingPathPointAdd, onMappingSplitPointAdd, onMappingZonePointAdd, raceDistanceMeters, raceState, raceViewFullscreen, savedRoute, sceneVersion, selectedEditPoint, track]);

  useEffect(() => {
    const map = mapRef.current;
    const library = libraryRef.current;
    if (!map || !library || sceneVersion === 0) {
      return;
    }
    const desired = new Set<string>();
    const lanes = riderLaneOffsetsByPlayer(players);

    const updateRider = (
      key: string,
      player: PlayerSlot,
      label: string,
      distance: number,
      velocity: number,
      altitude: number,
      bearingSelections: Record<string, 'a' | 'b'>,
      laneOffset: number,
      cStartBackoffMeters: number,
      appearance: 'live' | 'ghost' | 'remote',
      zIndex: number,
    ) => {
      desired.add(key);
      const pose = riderRoutePose(track, visualRiderDistance(distance, cStartBackoffMeters), bearingSelections);
      if (!pose) {
        return;
      }
      const position = offsetRiderPosition(pose.position, pose.bearing, laneOffset);
      const speedKph = velocity > 0 ? velocity * 3.6 : null;
      const title = `${player.name} / ${formatSpeedFromKph(speedKph, speedUnit)} ${speedUnitLabel(speedUnit)}`;
      let dynamic = dynamicMarkersRef.current.get(key);
      if (!dynamic) {
        dynamic = createDynamicRiderMarker(map, library, position, player, label, title, appearance, zIndex) ?? undefined;
        if (!dynamic) return;
        dynamicMarkersRef.current.set(key, dynamic);
      }
      updateDynamicRiderMarker(
        dynamic,
        position,
        Math.max(1, altitude),
        pose.bearing,
        earthHeading,
        label,
        title,
        cStartBackoffMeters > 0,
      );
    };

    if (!mappingMode) {
      riders.forEach((rider) => {
        const player = players.find((candidate) => candidate.id === rider.playerId);
        if (!player) return;
        updateRider(
          `local:${player.id}`,
          player,
          `P${player.id}`,
          rider.distance,
          rider.velocity,
          1 + riderAirPixelsToMeters(rider.air),
          rider.actualBranches,
          lanes.get(player.id) ?? 0,
          cStartOffsetsByPlayer[player.id] ?? 0,
          'live',
          900 + player.id,
        );
      });

      ghostRiders.forEach((rider, index) => {
        const ghostPlayer: PlayerSlot = {
          id: ((index % 4) + 1) as PlayerId,
          name: rider.name,
          colorName: ghostPlaybackColorName,
          accent: ghostPlaybackAccent,
          deviceId: null,
        };
        updateRider(
          `ghost:${rider.id}`,
          ghostPlayer,
          `G${index + 1}`,
          rider.distance,
          rider.velocity,
          1,
          rider.actualBranches,
          remoteRiderLaneOffset(index + 1) * 0.45,
          0,
          'ghost',
          950 + index,
        );
      });

      let remoteIndex = 0;
      remoteRaceStates.forEach((state) => state.riders.forEach((rider) => {
        const elapsed = Math.max(0, Date.now() - (state.receivedAt ?? state.at));
        const distance = rider.finishedAt == null && state.raceState === 'racing'
          ? rider.distance + rider.velocity * Math.min(0.35, elapsed / 1000)
          : rider.distance;
        const remotePlayer: PlayerSlot = {
          id: ((remoteIndex % 4) + 1) as PlayerId,
          name: rider.name,
          colorName: rider.colorName,
          accent: rider.accent,
          deviceId: null,
        };
        updateRider(
          `remote:${state.clientId}:${rider.id}`,
          remotePlayer,
          `R${remoteIndex + 1}`,
          distance,
          rider.velocity,
          1 + riderAirPixelsToMeters(rider.air),
          rider.actualBranches ?? {},
          remoteRiderLaneOffset(remoteIndex),
          0,
          'remote',
          1_000 + remoteIndex,
        );
        remoteIndex += 1;
      }));
    }

    dynamicMarkersRef.current.forEach(({ marker }, key) => {
      if (!desired.has(key)) {
        marker.remove();
        dynamicMarkersRef.current.delete(key);
      }
    });
  }, [cStartOffsetsByPlayer, earthHeading, ghostRiders, mappingMode, players, raceState, remoteRaceStates, riders, samplesByDevice, sceneVersion, speedUnit, track]);

  const clearCurveStroke = useCallback(() => {
    curvePointerIdRef.current = null;
    curveStrokeRef.current = [];
    setCurvePreviewPixels([]);
  }, []);

  const clearSplitStroke = useCallback(() => {
    splitPointerIdRef.current = null;
    splitStrokeRef.current = [];
    setSplitPreviewPixels([]);
  }, []);

  const curvePixelFromEvent = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const shell = containerRef.current?.parentElement ?? containerRef.current;
    if (!shell) {
      return null;
    }

    const rect = shell.getBoundingClientRect();
    return pointerPixelFromRect(event, rect);
  }, []);

  const addSplitStrokePoint = useCallback((point: TrackPoint, pixel: { x: number; y: number }) => {
    const previous = splitStrokeRef.current[splitStrokeRef.current.length - 1];
    if (previous && distanceBetweenTrackPoints(previous, point) < curveRawSampleMeters) {
      return;
    }

    splitStrokeRef.current = [...splitStrokeRef.current, point];
    setSplitPreviewPixels((current) => [...current, pixel]);
  }, []);

  const screenPointToTrackPoint = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const shell = containerRef.current?.parentElement ?? containerRef.current;
    const map = mapRef.current;
    if (!shell || !map) {
      return null;
    }

    const rect = shell.getBoundingClientRect();
    const currentCenter = map.center
      ? { lat: map.center.lat, lng: map.center.lng }
      : (earthCenter ?? center);
    if (!isTrackPointUsable(currentCenter)) {
      return null;
    }

    const pixel = pointerPixelFromRect(event, rect);
    if (!pixel) {
      return null;
    }

    try {
      const point = projectScreenPointToGround(
        pixel,
        {
          width: rect.width,
          height: rect.height,
        },
        {
          center: currentCenter,
          heading: safeNumber(map.heading, earthHeading),
          tilt: safeNumber(map.tilt, earthAngle),
          range: safeNumber(map.range, zoomToRange(baseRangeRef.current, earthZoom)),
          fov: safeNumber(map.fov, 35),
        },
      );

      return isTrackPointUsable(point) ? point : null;
    } catch (error) {
      console.error('TrackLab could not project a Google 3D map edit point.', error);
      return null;
    }
  }, [center, earthAngle, earthCenter, earthHeading, earthZoom]);

  const beginSplitStroke = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isSplitBranchDrawMode || !onMappingSplitPointAdd) {
      return;
    }

    const point = screenPointToTrackPoint(event);
    const pixel = curvePixelFromEvent(event);
    if (!point || !pixel) {
      return;
    }

    event.preventDefault();
    trySetPointerCapture(event.currentTarget, event.pointerId);
    splitPointerIdRef.current = event.pointerId;
    splitStrokeRef.current = [];
    setSplitPreviewPixels([]);
    addSplitStrokePoint(point, pixel);
  }, [addSplitStrokePoint, curvePixelFromEvent, isSplitBranchDrawMode, onMappingSplitPointAdd, screenPointToTrackPoint]);

  const updateSplitStroke = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (splitPointerIdRef.current !== event.pointerId) {
      return;
    }

    const point = screenPointToTrackPoint(event);
    const pixel = curvePixelFromEvent(event);
    if (!point || !pixel) {
      return;
    }

    event.preventDefault();
    addSplitStrokePoint(point, pixel);
  }, [addSplitStrokePoint, curvePixelFromEvent, screenPointToTrackPoint]);

  const finishSplitStroke = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (splitPointerIdRef.current !== event.pointerId) {
      return;
    }

    event.preventDefault();
    tryReleasePointerCapture(event.currentTarget, event.pointerId);

    const point = screenPointToTrackPoint(event);
    const pixel = curvePixelFromEvent(event);
    if (point && pixel) {
      addSplitStrokePoint(point, pixel);
    }

    const strokePoints = preparedCurveStroke(splitStrokeRef.current);
    if (strokePoints.length > 0) {
      strokePoints.forEach((strokePoint) => onMappingSplitPointAdd?.(strokePoint));
      onMappingSplitDrawEnd?.();
    }

    clearSplitStroke();
  }, [addSplitStrokePoint, clearSplitStroke, curvePixelFromEvent, onMappingSplitDrawEnd, onMappingSplitPointAdd, screenPointToTrackPoint]);

  const beginCurveStroke = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isCurveDrawMode || !onMappingPathPointAdd) {
      return;
    }

    const point = screenPointToTrackPoint(event);
    const pixel = curvePixelFromEvent(event);
    if (!point || !pixel) {
      return;
    }

    event.preventDefault();
    trySetPointerCapture(event.currentTarget, event.pointerId);
    curvePointerIdRef.current = event.pointerId;
    curveStrokeRef.current = [point];
    setCurvePreviewPixels([pixel]);
  }, [curvePixelFromEvent, isCurveDrawMode, onMappingPathPointAdd, screenPointToTrackPoint]);

  const updateCurveStroke = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (curvePointerIdRef.current !== event.pointerId) {
      return;
    }

    const point = screenPointToTrackPoint(event);
    const pixel = curvePixelFromEvent(event);
    if (!point || !pixel) {
      return;
    }

    event.preventDefault();
    const previous = curveStrokeRef.current[curveStrokeRef.current.length - 1];
    if (!previous || distanceBetweenTrackPoints(previous, point) >= curveRawSampleMeters) {
      curveStrokeRef.current = [...curveStrokeRef.current, point];
      setCurvePreviewPixels((current) => [...current, pixel]);
    }
  }, [curvePixelFromEvent, screenPointToTrackPoint]);

  const finishCurveStroke = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (curvePointerIdRef.current !== event.pointerId) {
      return;
    }

    event.preventDefault();
    tryReleasePointerCapture(event.currentTarget, event.pointerId);

    const point = screenPointToTrackPoint(event);
    if (point) {
      const previous = curveStrokeRef.current[curveStrokeRef.current.length - 1];
      if (!previous || distanceBetweenTrackPoints(previous, point) >= 0.25) {
        curveStrokeRef.current = [...curveStrokeRef.current, point];
      }
    }

    const strokePoints = preparedCurveStroke(curveStrokeRef.current);
    if (strokePoints.length > 1) {
      strokePoints.forEach((strokePoint) => onMappingPathPointAdd?.(strokePoint));
    }

    clearCurveStroke();
  }, [clearCurveStroke, onMappingPathPointAdd, screenPointToTrackPoint]);

  useEffect(() => {
    if (!isCurveDrawMode) {
      clearCurveStroke();
    }
  }, [clearCurveStroke, isCurveDrawMode]);

  useEffect(() => {
    if (!isSplitBranchDrawMode) {
      clearSplitStroke();
    }
  }, [clearSplitStroke, isSplitBranchDrawMode]);

  const removeSelectedPoint = () => {
    if (selectedEditPoint?.kind === 'path') {
      onMappingPathPointRemove?.(selectedEditPoint.index);
    } else if (selectedEditPoint?.kind === 'zone') {
      onMappingZonePointRemove?.(selectedEditPoint.index);
    }
    setSelectedEditPoint(null);
  };

  const editInstruction = selectedEditPoint
    ? 'Tap the terrain to move the selected point.'
    : mappingEditMode === 'navigate'
      ? 'Use Google 3D gestures to orbit, tilt, and zoom.'
      : mappingEditMode === 'zones'
        ? isProSetZoneMapping
          ? 'Start at S, then tap zone boundaries along the blue Pro route. Use M for the final endpoint.'
          : 'Tap the route or terrain to add zone boundaries. Tap an existing pin to move it.'
      : mappingEditMode === 'split'
        ? draftSplitBuilder?.splitPoint && draftSplitBuilder.mergePoint
          ? 'Drag through the branch from split to merge. Multiple strokes are supported.'
          : 'Tap the terrain to place the split and merge junctions.'
        : mappingEditMode === 'curve'
          ? 'Drag across the terrain to draw a smooth route. Apple Pencil and finger gestures are supported.'
          : 'Tap terrain to add route points. Tap an existing point, then terrain, to move it.';

  return (
    <div className={`google-map-3d-shell${cameraLocked ? ' camera-locked' : ''}`}>
      <div className="google-map-layer google-map-3d-layer" ref={containerRef} />
      {isCurveDrawMode && (
        <div
          className="map-3d-curve-input"
          onPointerDown={beginCurveStroke}
          onPointerMove={updateCurveStroke}
          onPointerUp={finishCurveStroke}
          onPointerCancel={finishCurveStroke}
        >
          {curvePreviewPixels.length > 1 && (
            <svg className="map-3d-curve-preview" aria-hidden="true">
              <polyline points={curvePreviewPixels.map(({ x, y }) => `${x},${y}`).join(' ')} />
            </svg>
          )}
        </div>
      )}
      {isSplitBranchDrawMode && (
        <div
          className="map-3d-curve-input"
          onPointerDown={beginSplitStroke}
          onPointerMove={updateSplitStroke}
          onPointerUp={finishSplitStroke}
          onPointerCancel={finishSplitStroke}
        >
          {splitPreviewPixels.length > 1 && (
            <svg className="map-3d-curve-preview map-3d-split-preview" aria-hidden="true">
              <polyline points={splitPreviewPixels.map(({ x, y }) => `${x},${y}`).join(' ')} />
            </svg>
          )}
        </div>
      )}
      {layerState === 'loading' && (
        <div className="google-map-status loading" role="status">
          <Box size={20} />
          <strong>Loading photorealistic 3D</strong>
          <span>Preparing terrain, track overlays, and live rider markers.</span>
        </div>
      )}
      {layerState === 'error' && (
        <div className="google-map-status error" role="alert">
          <Box size={20} />
          <strong>3D mode unavailable</strong>
          <span>{errorMessage}</span>
          <button type="button" onClick={onUseSatellite}>
            <RotateCcw size={15} />
            Use satellite view
          </button>
        </div>
      )}
      {mappingMode && layerState === 'ready' && (
        <div className="map-3d-edit-console" role="status">
          <MousePointer2 size={16} />
          <span>{editInstruction}</span>
          {selectedEditPoint && (
            <>
              <button type="button" onClick={removeSelectedPoint} title="Delete selected point">
                <Trash2 size={15} />
                Delete
              </button>
              <button type="button" onClick={() => setSelectedEditPoint(null)} title="Cancel point move">
                <X size={15} />
                Cancel
              </button>
            </>
          )}
          {mappingEditMode === 'split' && draftSplitBuilder?.mergePoint && (
            <button type="button" onClick={onMappingSplitDrawEnd} title="Finish the active split branch">
              <Check size={15} />
              Finish branch
            </button>
          )}
        </div>
      )}
    </div>
  );
}
