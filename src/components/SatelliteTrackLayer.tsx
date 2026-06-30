import type { CSSProperties, MouseEvent } from 'react';
import { useMemo, useRef } from 'react';
import { Bike } from 'lucide-react';
import { trackBoundsPoints, trackFinishPoint, trackRoute, trackStartPoint, zonePolyline } from '../lib/googleMaps';
import { formatSpeedFromKph, speedUnitLabel } from '../units';
import type { BikeSample, PlayerSlot, RaceState, RiderState, SpeedUnit, TrackPoint, TrackRecord, TrackZone } from '../types';

type ProjectedPoint = {
  x: number;
  y: number;
};

type Tile = {
  id: string;
  left: number;
  top: number;
  url: string;
};

type SatelliteTrackLayerProps = {
  track: TrackRecord;
  activeZones: TrackZone[];
  riders: RiderState[];
  players: PlayerSlot[];
  samplesByDevice: Map<number, BikeSample>;
  speedUnit: SpeedUnit;
  raceState: RaceState;
  earthAngle: number;
  mappingMode?: boolean;
  draftPoints?: TrackPoint[];
  onMappingPointAdd?: (point: TrackPoint) => void;
};

const tileSize = 256;
const viewWidth = 1000;
const viewHeight = 620;
const padding = 92;
const minZoom = 14;
const maxZoom = 20;
const esriWorldImageryTemplate = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const tileUrlTemplate = import.meta.env.VITE_SATELLITE_TILE_URL_TEMPLATE?.trim() || esriWorldImageryTemplate;

const zoneColors: Record<TrackZone['type'], string> = {
  pedal: '#4ade80',
  recovery: '#facc15',
  technical: '#38bdf8',
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function projectToWorldPixel(point: TrackPoint, zoom: number): ProjectedPoint {
  const lat = clamp(point.lat, -85.05112878, 85.05112878);
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const scale = tileSize * 2 ** zoom;

  return {
    x: ((point.lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  };
}

function unprojectWorldPixel(point: ProjectedPoint, zoom: number): TrackPoint {
  const scale = tileSize * 2 ** zoom;
  const lng = (point.x / scale) * 360 - 180;
  const mercatorN = Math.PI - (2 * Math.PI * point.y) / scale;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(mercatorN) - Math.exp(-mercatorN)));

  return { lat, lng };
}

function boundsFor(points: ProjectedPoint[]) {
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));

  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function chooseZoom(outline: TrackPoint[]) {
  for (let zoom = maxZoom; zoom >= minZoom; zoom -= 1) {
    const bounds = boundsFor(outline.map((point) => projectToWorldPixel(point, zoom)));
    if (bounds.width <= viewWidth - padding * 2 && bounds.height <= viewHeight - padding * 2) {
      return zoom;
    }
  }

  return minZoom;
}

function normalizeTileX(tileX: number, zoom: number) {
  const tileCount = 2 ** zoom;
  return ((tileX % tileCount) + tileCount) % tileCount;
}

function tileUrl(zoom: number, tileX: number, tileY: number) {
  return tileUrlTemplate
    .replaceAll('{z}', String(zoom))
    .replaceAll('{x}', String(normalizeTileX(tileX, zoom)))
    .replaceAll('{y}', String(tileY));
}

function pathFromPoints(points: ProjectedPoint[]) {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
}

function segmentLengths(points: ProjectedPoint[]) {
  const lengths: number[] = [];
  let total = 0;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    total += Math.hypot(current.x - previous.x, current.y - previous.y);
    lengths.push(total);
  }

  return { lengths, total };
}

function pointAtProgress(points: ProjectedPoint[], progress: number) {
  const { lengths, total } = segmentLengths(points);
  const target = total * clamp(progress, 0, 1);
  const segmentIndex = lengths.findIndex((length) => length >= target);
  const safeSegmentIndex = segmentIndex === -1 ? Math.max(0, points.length - 2) : segmentIndex;
  const start = points[safeSegmentIndex];
  const end = points[safeSegmentIndex + 1] ?? start;
  const previousLength = safeSegmentIndex === 0 ? 0 : lengths[safeSegmentIndex - 1];
  const segmentLength = Math.max(1, lengths[safeSegmentIndex] - previousLength);
  const localProgress = segmentIndex === -1 ? 1 : (target - previousLength) / segmentLength;

  return {
    x: start.x + (end.x - start.x) * localProgress,
    y: start.y + (end.y - start.y) * localProgress,
    heading: (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI,
  };
}

function finishMarkerPath(point: ProjectedPoint, heading: number) {
  const radians = (heading * Math.PI) / 180;
  const normal = { x: -Math.sin(radians), y: Math.cos(radians) };
  const halfWidth = 30;

  return `M ${(point.x - normal.x * halfWidth).toFixed(2)} ${(point.y - normal.y * halfWidth).toFixed(2)} L ${(point.x + normal.x * halfWidth).toFixed(2)} ${(point.y + normal.y * halfWidth).toFixed(2)}`;
}

export function SatelliteTrackLayer({
  track,
  activeZones,
  riders,
  players,
  samplesByDevice,
  speedUnit,
  raceState,
  earthAngle,
  mappingMode = false,
  draftPoints = [],
  onMappingPointAdd,
}: SatelliteTrackLayerProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const layout = useMemo(() => {
    const route = trackRoute(track);
    const boundsPoints = trackBoundsPoints(track);
    const zoom = chooseZoom(boundsPoints);
    const worldPoints = boundsPoints.map((point) => projectToWorldPixel(point, zoom));
    const bounds = boundsFor(worldPoints);
    const centerX = bounds.minX + bounds.width / 2;
    const centerY = bounds.minY + bounds.height / 2;
    const viewportLeft = centerX - viewWidth / 2;
    const viewportTop = centerY - viewHeight / 2;
    const minTileX = Math.floor(viewportLeft / tileSize);
    const maxTileX = Math.floor((viewportLeft + viewWidth) / tileSize);
    const minTileY = Math.max(0, Math.floor(viewportTop / tileSize));
    const maxTileY = Math.min(2 ** zoom - 1, Math.floor((viewportTop + viewHeight) / tileSize));
    const tiles: Tile[] = [];

    for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
      for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
        tiles.push({
          id: `${zoom}-${tileX}-${tileY}`,
          left: tileX * tileSize - viewportLeft,
          top: tileY * tileSize - viewportTop,
          url: tileUrl(zoom, tileX, tileY),
        });
      }
    }

    const toLocalPoint = (point: TrackPoint) => {
      const worldPoint = projectToWorldPixel(point, zoom);
      return {
        x: worldPoint.x - viewportLeft,
        y: worldPoint.y - viewportTop,
      };
    };
    const toTrackPoint = (point: ProjectedPoint) => unprojectWorldPixel({
      x: point.x + viewportLeft,
      y: point.y + viewportTop,
    }, zoom);

    const routePoints = route.map(toLocalPoint);
    const draftLocalPoints = draftPoints.map(toLocalPoint);
    const startPoint = toLocalPoint(trackStartPoint(track));
    const finishPoint = toLocalPoint(trackFinishPoint(track));
    const finishRoutePoint = pointAtProgress(routePoints, 1);

    return {
      zoom,
      tiles,
      boundaryPath: track.outline.length > 1 ? pathFromPoints(track.outline.map(toLocalPoint)) : '',
      routePath: pathFromPoints(routePoints),
      routePoints,
      startPoint,
      finishPoint,
      finishPath: finishMarkerPath(finishPoint, finishRoutePoint.heading),
      draftPath: draftLocalPoints.length > 1 ? pathFromPoints(draftLocalPoints) : '',
      draftLocalPoints,
      zones: activeZones.map((zone) => ({
        ...zone,
        path: pathFromPoints(zonePolyline(track, zone).map(toLocalPoint)),
      })),
      toLocalPoint,
      toTrackPoint,
    };
  }, [activeZones, draftPoints, track]);
  const tilt = clamp(72 - earthAngle, 4, 54);
  const routeStatusClass = `route-${track.routeStatus ?? 'estimated'}`;
  const handleMapClick = (event: MouseEvent<SVGSVGElement>) => {
    if (!mappingMode || !onMappingPointAdd || !svgRef.current) {
      return;
    }

    const matrix = svgRef.current.getScreenCTM();
    if (!matrix) {
      return;
    }

    const screenPoint = svgRef.current.createSVGPoint();
    screenPoint.x = event.clientX;
    screenPoint.y = event.clientY;
    const localPoint = screenPoint.matrixTransform(matrix.inverse());

    onMappingPointAdd(layout.toTrackPoint({
      x: clamp(localPoint.x, 0, viewWidth),
      y: clamp(localPoint.y, 0, viewHeight),
    }));
  };

  return (
    <div
      className={`earth-map-plane satellite-live ${routeStatusClass}`}
      style={{ transform: `rotateX(${tilt}deg) rotateZ(-8deg)` }}
    >
      <div className="satellite-tile-grid" aria-hidden="true">
        {layout.tiles.map((tile) => (
          <img
            alt=""
            className="satellite-tile"
            decoding="async"
            draggable={false}
            key={tile.id}
            loading="eager"
            src={tile.url}
            style={{ left: `${tile.left}px`, top: `${tile.top}px` }}
          />
        ))}
        <div className="satellite-shade" />
      </div>

      <svg
        className={`track-svg satellite-overlay ${mappingMode ? 'mapping-active' : ''}`}
        viewBox={`0 0 ${viewWidth} ${viewHeight}`}
        role="img"
        aria-label={`${track.name} GPS outline over satellite imagery`}
        onClick={handleMapClick}
        ref={svgRef}
      >
        {layout.boundaryPath && <path className="track-boundary" d={layout.boundaryPath} />}
        <path className="track-shadow" d={layout.routePath} />
        <path className="track-base" d={layout.routePath} />
        <path className="track-centerline" d={layout.routePath} />
        {layout.zones.map((zone) => (
          <path
            className="zone-stroke"
            d={zone.path}
            key={zone.id}
            style={{ stroke: zoneColors[zone.type] }}
          />
        ))}
        <circle className="start-dot" cx={layout.startPoint.x} cy={layout.startPoint.y} r="10" />
        <path className="finish-line" d={layout.finishPath} />
        {mappingMode && layout.draftPath && <path className="mapping-draft-path" d={layout.draftPath} />}
        {mappingMode && layout.draftLocalPoints.map((point, index) => (
          <g className="mapping-pin" key={`${point.x}-${point.y}-${index}`}>
            <circle cx={point.x} cy={point.y} r="12" />
            <text x={point.x} y={point.y + 4}>{index + 1}</text>
          </g>
        ))}
      </svg>

      {riders.map((rider) => {
        const player = players.find((slot) => slot.id === rider.playerId);
        if (!player) {
          return null;
        }

        const sample = player.deviceId == null ? undefined : samplesByDevice.get(player.deviceId);
        const progress = Math.max(0, Math.min(1, rider.distance / track.lengthMeters));
        const routePosition = pointAtProgress(layout.routePoints, progress);
        const headingRadians = (routePosition.heading * Math.PI) / 180;
        const normal = { x: -Math.sin(headingRadians), y: Math.cos(headingRadians) };
        const laneOffset = [-18, -6, 6, 18][player.id - 1] ?? 0;
        const position = {
          x: routePosition.x + normal.x * laneOffset,
          y: routePosition.y + normal.y * laneOffset,
        };
        const startOffset = raceState === 'ready' && progress < 0.025 ? player.id - 2.5 : 0;
        const startYOffset = startOffset === 0 ? 0 : Math.abs(startOffset) === 0.5 ? -12 : 12;
        const style = {
          '--player-color': player.accent,
          '--rider-heading': `${routePosition.heading}deg`,
          '--rider-pitch': `${rider.pitch}deg`,
          '--rider-air': `${rider.air}px`,
          left: `${position.x + startOffset * 22}px`,
          top: `${position.y + startYOffset}px`,
        } as CSSProperties;

        return (
          <div className={`rider-token ${rider.phase}`} style={style} key={rider.playerId}>
            <span className="rider-bike">
              <Bike size={24} strokeWidth={2.6} />
            </span>
            <span className="rider-label">P{player.id}</span>
            <span className="rider-speed">
              {formatSpeedFromKph(sample?.speedKph, speedUnit)} {speedUnitLabel(speedUnit)}
            </span>
          </div>
        );
      })}

      <a
        className="satellite-attribution"
        href="https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9"
        target="_blank"
        rel="noreferrer"
      >
        Esri World Imagery / zoom {layout.zoom}
      </a>
    </div>
  );
}
