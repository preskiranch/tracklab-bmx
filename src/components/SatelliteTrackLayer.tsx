import type { CSSProperties } from 'react';
import { useMemo } from 'react';
import { Bike } from 'lucide-react';
import { riderLatLng, zonePolyline } from '../lib/googleMaps';
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

export function SatelliteTrackLayer({
  track,
  activeZones,
  riders,
  players,
  samplesByDevice,
  speedUnit,
  raceState,
  earthAngle,
}: SatelliteTrackLayerProps) {
  const layout = useMemo(() => {
    const zoom = chooseZoom(track.outline);
    const worldPoints = track.outline.map((point) => projectToWorldPixel(point, zoom));
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

    return {
      zoom,
      tiles,
      trackPath: pathFromPoints(track.outline.map(toLocalPoint)),
      zones: activeZones.map((zone) => ({
        ...zone,
        path: pathFromPoints(zonePolyline(track, zone).map(toLocalPoint)),
      })),
      toLocalPoint,
    };
  }, [activeZones, track]);
  const tilt = clamp(72 - earthAngle, 4, 54);

  return (
    <div
      className="earth-map-plane satellite-live"
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

      <svg className="track-svg satellite-overlay" viewBox={`0 0 ${viewWidth} ${viewHeight}`} role="img" aria-label={`${track.name} GPS outline over satellite imagery`}>
        <path className="track-shadow" d={layout.trackPath} />
        <path className="track-base" d={layout.trackPath} />
        <path className="track-centerline" d={layout.trackPath} />
        {layout.zones.map((zone) => (
          <path
            className="zone-stroke"
            d={zone.path}
            key={zone.id}
            style={{ stroke: zoneColors[zone.type] }}
          />
        ))}
        <circle className="start-dot" cx={layout.toLocalPoint(track.outline[0]).x} cy={layout.toLocalPoint(track.outline[0]).y} r="10" />
      </svg>

      {riders.map((rider) => {
        const player = players.find((slot) => slot.id === rider.playerId);
        if (!player) {
          return null;
        }

        const sample = player.deviceId == null ? undefined : samplesByDevice.get(player.deviceId);
        const position = layout.toLocalPoint(riderLatLng(track, rider.distance));
        const progress = Math.max(0, Math.min(1, rider.distance / track.lengthMeters));
        const startOffset = raceState === 'ready' && progress < 0.025 ? player.id - 2.5 : 0;
        const startYOffset = startOffset === 0 ? 0 : Math.abs(startOffset) === 0.5 ? -12 : 12;
        const style = {
          '--player-color': player.accent,
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
