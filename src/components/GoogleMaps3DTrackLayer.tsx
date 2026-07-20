import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Check, MousePointer2, RotateCcw, Trash2, X } from 'lucide-react';
import type {
  BikeSample,
  DraftTrackSplit,
  EarthCamera,
  GhostPlaybackRider,
  MappingEditMode,
  MultiplayerRaceState,
  PlayerId,
  PlayerSlot,
  RaceState,
  RiderState,
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
  terrainRelativeCamera,
} from '../lib/googleMaps3d';
import {
  pointAtRouteMeter,
  routeLengthMeters,
  routeWithDefaultSplitBranches,
  routeWithSplitBranchSelections,
} from '../lib/trackMapping';
import { ghostRiderMarkerLabel, localRiderMarkerLabel } from '../lib/playerIdentity';
import { formatSpeedFromKph, speedUnitLabel } from '../units';
import { recordMap3DLoad, type Map3DLoadContext } from '../lib/map3dUsage';

type GoogleMaps3DTrackLayerProps = {
  track: TrackRecord;
  activeZones: TrackZone[];
  riders: RiderState[];
  ghostRiders?: GhostPlaybackRider[];
  remoteRaceStates?: MultiplayerRaceState[];
  players: PlayerSlot[];
  samplesByDevice: Map<number, BikeSample>;
  speedUnit: SpeedUnit;
  raceViewFullscreen?: boolean;
  raceState: RaceState;
  earthAngle: number;
  earthHeading: number;
  earthCenter: TrackPoint | null;
  earthZoom: number | null;
  mappingMode?: boolean;
  mappingEditMode?: MappingEditMode;
  mappingRouteVariantId?: TrackRouteVariantId;
  draftPoints?: TrackPoint[];
  draftZoneRoutePoints?: TrackPoint[];
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
const riderIconByColor: Record<PlayerSlot['colorName'], string> = {
  lime: '/assets/rider-lime.png',
  red: '/assets/rider-red.png',
  blue: '/assets/rider-blue.png',
  yellow: '/assets/rider-yellow.png',
};
const riderStartSetbackMeters = 2.2;
const riderStartSetbackBlendMeters = 5;
const riderLaneSpacingMeters = 1.1;
const riderLaneMaxSpreadMeters = 4.4;
const remoteRiderLaneOffsetBaseMeters = 3.2;
const remoteRiderLaneSpacingMeters = 0.7;

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
  return typeof position?.lat === 'number' && typeof position.lng === 'number'
    ? { lat: position.lat, lng: position.lng }
    : null;
}

function appendPolyline(
  map: GoogleMap3DElement,
  Polyline3DElement: GoogleMaps3DLibrary['Polyline3DElement'],
  path: TrackPoint[],
  options: Record<string, unknown>,
) {
  if (path.length < 2) {
    return null;
  }
  const line = new Polyline3DElement({
    altitudeMode: 'RELATIVE_TO_GROUND',
    drawsOccludedSegments: true,
    path: elevatedPath(path),
    ...options,
  });
  map.append(line);
  return line;
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
    ? library.MarkerInteractiveElement ?? library.MarkerElement
    : library.MarkerElement;
  const FallbackConstructor = options.interactive
    ? library.Marker3DInteractiveElement ?? library.Marker3DElement
    : library.Marker3DElement;
  const MarkerConstructor = CustomConstructor ?? FallbackConstructor;
  if (!MarkerConstructor) {
    return null;
  }

  const markerPosition = { ...position, altitude: 1.2 };
  const marker = CustomConstructor
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
  if (CustomConstructor && options.zIndex != null) {
    marker.style.zIndex = String(options.zIndex);
  }
  const content = CustomConstructor && options.label
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

function riderLaneOffsets(players: PlayerSlot[]) {
  const sorted = [...players].sort((left, right) => left.id - right.id);
  const offsets = new Map<PlayerId, number>();
  const spacing = sorted.length <= 1
    ? 0
    : Math.min(riderLaneSpacingMeters, riderLaneMaxSpreadMeters / (sorted.length - 1));
  const midpoint = (sorted.length - 1) / 2;
  sorted.forEach((player, index) => offsets.set(player.id, (index - midpoint) * spacing));
  return offsets;
}

function remoteRiderLaneOffset(index: number) {
  const side = index % 2 === 0 ? 1 : -1;
  return side * (remoteRiderLaneOffsetBaseMeters + Math.floor(index / 2) * remoteRiderLaneSpacingMeters);
}

function visualRiderDistance(distanceMeters: number) {
  if (distanceMeters <= 0) {
    return -riderStartSetbackMeters;
  }
  if (distanceMeters >= riderStartSetbackBlendMeters) {
    return distanceMeters;
  }
  const progress = Math.max(0, Math.min(1, distanceMeters / riderStartSetbackBlendMeters));
  const smoothProgress = progress * progress * (3 - 2 * progress);
  return distanceMeters - riderStartSetbackMeters * (1 - smoothProgress);
}

function createRiderContent(
  player: Pick<PlayerSlot, 'colorName' | 'accent'>,
  label: string,
  appearance: 'live' | 'ghost' | 'remote',
) {
  const content = document.createElement('div');
  content.className = `map-3d-rider-marker map-3d-rider-marker-${appearance}`;
  content.style.setProperty('--rider-accent', appearance === 'ghost' ? '#22d3ee' : player.accent);
  const image = document.createElement('img');
  image.className = 'map-3d-rider-image';
  image.alt = '';
  image.src = riderIconByColor[appearance === 'ghost' ? 'blue' : player.colorName];
  const name = document.createElement('span');
  name.className = 'map-3d-rider-label';
  name.textContent = label;
  content.append(image, name);
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
        label,
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
) {
  dynamic.marker.position = { ...position, altitude };
  dynamic.marker.title = title;
  if (!dynamic.content) {
    dynamic.marker.label = label;
    return;
  }
  const image = dynamic.content.querySelector<HTMLImageElement>('.map-3d-rider-image');
  const name = dynamic.content.querySelector<HTMLSpanElement>('.map-3d-rider-label');
  if (image) {
    image.style.transform = `rotate(${normalizeHeading(bearing - mapHeading - 90)}deg)`;
  }
  if (name) {
    name.textContent = label;
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
  raceViewFullscreen = false,
  raceState,
  earthAngle,
  earthHeading,
  earthCenter,
  earthZoom,
  mappingMode = false,
  mappingEditMode = 'navigate',
  mappingRouteVariantId = 'amateur',
  draftPoints = [],
  draftZoneRoutePoints = [],
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
  const [layerState, setLayerState] = useState<LayerState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [sceneVersion, setSceneVersion] = useState(0);
  const [selectedEditPoint, setSelectedEditPoint] = useState<EditSelection>(null);
  const savedRoute = useMemo(() => mappedTrackRoute(track), [track]);
  const center = useMemo(() => trackCenter(track), [track]);
  const boundsPoints = useMemo(() => trackBoundsPoints(track), [track]);
  const baseRange = useMemo(
    () => previewRangeMeters(boundsPoints.length > 0 ? boundsPoints : savedRoute, center),
    [boundsPoints, center, savedRoute],
  );
  const draftRoute = useMemo(
    () => routeWithDefaultSplitBranches(draftPoints, draftRouteSplitSections),
    [draftPoints, draftRouteSplitSections],
  );
  const activeDraftZoneRoute = draftZoneRoutePoints.length > 1 ? draftZoneRoutePoints : draftRoute;

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
        const initialCenter = earthCenter ?? center;
        const initialRange = zoomToRange(baseRange, earthZoom);
        const map = new library.Map3DElement({
          center: { ...initialCenter, altitude: 0 },
          heading: earthHeading,
          mode: 'SATELLITE',
          range: initialRange,
          tilt: earthAngle,
        });
        map.style.width = '100%';
        map.style.height = '100%';
        map.style.display = 'block';

        const saveCamera = () => {
          window.clearTimeout(cameraTimerRef.current);
          cameraTimerRef.current = window.setTimeout(() => {
            const nextCenter = map.center;
            cameraChangeRef.current?.({
              angle: Math.round(map.tilt ?? earthAngle),
              center: nextCenter ? { lat: nextCenter.lat, lng: nextCenter.lng } : center,
              heading: Math.round(map.heading ?? earthHeading),
              zoom: rangeToZoom(baseRangeRef.current, map.range, earthZoom),
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
          initialCenter,
          earthHeading,
          earthAngle,
          initialRange,
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
    applyTerrainRelativeCamera(
      map,
      earthCenter ?? center,
      earthHeading,
      earthAngle,
      zoomToRange(baseRange, earthZoom),
    );
  }, [baseRange, center, earthAngle, earthCenter, earthHeading, earthZoom]);

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
      if ((mappingEditMode === 'draw' || mappingEditMode === 'curve') && onMappingPathPointAdd) {
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
        section.branches.forEach((branch) => {
          const line = appendPolyline(map, library.Polyline3DElement, branch.points, {
            outerColor: '#111827',
            outerWidth: 0.4,
            strokeColor: branch.id === 'a' ? '#ff2d55' : '#38bdf8',
            strokeWidth: mappingMode ? 9 : 7,
          });
          if (line) elements.push(line);
        });
        const splitMarker = appendMarker(map, library, section.splitPoint, {
          className: 'map-3d-junction-marker split', label: `S${section.index}`, title: `Split ${section.index}`, zIndex: 780,
        });
        const mergeMarker = appendMarker(map, library, section.mergePoint, {
          className: 'map-3d-junction-marker merge', label: `M${section.index}`, title: `Merge ${section.index}`, zIndex: 781,
        });
        if (splitMarker) elements.push(splitMarker);
        if (mergeMarker) elements.push(mergeMarker);
      });
    }

    if (mappingMode && draftSplitBuilder?.splitPoint) {
      const points = draftSplitBuilder.activeBranch === 'a' ? draftSplitBuilder.branchA : draftSplitBuilder.branchB;
      const branchPath = [draftSplitBuilder.splitPoint, ...points];
      const line = appendPolyline(map, library.Polyline3DElement, branchPath, {
        outerColor: '#111827', outerWidth: 0.55,
        strokeColor: draftSplitBuilder.activeBranch === 'a' ? '#ff2d55' : '#38bdf8', strokeWidth: 10,
      });
      if (line) elements.push(line);
    }

    const start = mappingMode ? draftPoints[0] : trackStartPoint(track);
    const finish = mappingMode ? draftPoints[draftPoints.length - 1] : trackFinishPoint(track);
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
            } else if (mappingEditMode === 'draw' || mappingEditMode === 'curve') {
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
  }, [activeDraftZoneRoute, activeZones, draftPoints, draftReferenceZones, draftRoute, draftRouteSplitSections, draftSplitBuilder, draftSplitSections, draftZoneMeters, draftZonePoints, mappingEditMode, mappingMode, mappingRouteVariantId, onMappingSplitPointAdd, onMappingZonePointAdd, raceState, raceViewFullscreen, savedRoute, sceneVersion, selectedEditPoint, track]);

  useEffect(() => {
    const map = mapRef.current;
    const library = libraryRef.current;
    if (!map || !library || sceneVersion === 0) {
      return;
    }
    const desired = new Set<string>();
    const lanes = riderLaneOffsets(players);

    const updateRider = (
      key: string,
      player: PlayerSlot,
      label: string,
      distance: number,
      velocity: number,
      altitude: number,
      bearingSelections: Record<string, 'a' | 'b'>,
      laneOffset: number,
      appearance: 'live' | 'ghost' | 'remote',
      zIndex: number,
    ) => {
      desired.add(key);
      const pose = riderRoutePose(track, visualRiderDistance(distance), bearingSelections);
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
      updateDynamicRiderMarker(dynamic, position, Math.max(1, altitude), pose.bearing, earthHeading, label, title);
    };

    if (!mappingMode) {
      riders.forEach((rider) => {
        const player = players.find((candidate) => candidate.id === rider.playerId);
        if (!player) return;
        updateRider(
          `local:${player.id}`,
          player,
          localRiderMarkerLabel(player),
          rider.distance,
          rider.velocity,
          1 + Math.max(0, rider.air),
          rider.actualBranches,
          lanes.get(player.id) ?? 0,
          'live',
          900 + player.id,
        );
      });

      ghostRiders.forEach((rider, index) => {
        const ghostPlayer: PlayerSlot = {
          id: ((index % 4) + 1) as PlayerId,
          name: rider.name,
          colorName: 'blue',
          accent: '#22d3ee',
          deviceId: null,
        };
        updateRider(
          `ghost:${rider.id}`,
          ghostPlayer,
          ghostRiderMarkerLabel(rider.name, index + 1),
          rider.distance,
          rider.velocity,
          1,
          rider.actualBranches,
          remoteRiderLaneOffset(index + 1) * 0.45,
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
          `R${remoteIndex + 1} ${rider.name}`,
          distance,
          rider.velocity,
          1 + Math.max(0, rider.air),
          rider.actualBranches ?? {},
          remoteRiderLaneOffset(remoteIndex),
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
  }, [earthHeading, ghostRiders, mappingMode, players, raceState, remoteRaceStates, riders, samplesByDevice, sceneVersion, speedUnit, track]);

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
        ? 'Tap the route or terrain to add zone boundaries. Tap an existing pin to move it.'
        : mappingEditMode === 'split'
          ? 'Tap the terrain to place junctions and branch points.'
          : 'Tap terrain to add route points. Tap an existing point, then terrain, to move it.';

  return (
    <div className="google-map-3d-shell">
      <div className="google-map-layer google-map-3d-layer" ref={containerRef} />
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
