import { trackCatalog } from '../data/trackCatalog';
import type {
  RaceZoneResult,
  TrackPoint,
  TrackRecord,
  TrackRouteVariant,
  TrackRouteVariantId,
  TrackZone,
  UserTrackMapping,
} from '../types';
import { readCloudUserData } from './cloudUserData';
import { readPublicTrackCatalog } from './publicTrackMappings';
import {
  applyUserTrackMapping,
  applyTrackRouteVariant,
  newestTrackMapping,
  pointAtRouteMeter,
  routeVariantFromMapping,
  routeWithSplitBranchSelections,
  splitSharedRouteSegments,
  type StoredTrackMappings,
} from './trackMapping';

export type TrainingTrackReviewZone = TrackZone & {
  number: number;
  sourceIndex: number;
  sourceZoneId: string;
  recordedStartMeter: number;
  recordedEndMeter: number;
  lapNumber: number | null;
  placeable: boolean;
  placementNote: string | null;
};

export type TrainingTrackReviewResult = {
  status: 'ready' | 'missing-track' | 'unmapped';
  track: TrackRecord | null;
  zones: TrainingTrackReviewZone[];
  mappingSource: 'catalog' | 'public' | 'user' | null;
  mappingSavedAt: string | null;
  note: string;
};

export type TrainingTrackReviewRequest = {
  trackId?: string | null;
  routeVariantId?: string | null;
  lapCount?: number | null;
  zones: readonly RaceZoneResult[];
};

export type TrainingTrackReviewSources = {
  catalog: readonly TrackRecord[];
  publicMappings?: StoredTrackMappings;
  publicRoutes?: readonly TrackRecord[];
  userMappings?: StoredTrackMappings;
  userRoutes?: readonly TrackRecord[];
};

export type TrainingTrackSchematic = {
  routePaths: string[];
  zones: Array<TrainingTrackReviewZone & { path: string; labelX: number; labelY: number }>;
};

const maxZones = 250;
const maxRoutePoints = 2_500;
const maxReviewMeters = 2_000_000;
let catalogPromise: Promise<TrackRecord[]> | null = null;
let publicPromise: ReturnType<typeof readPublicTrackCatalog> | null = null;

function finitePoint(value: unknown): value is TrackPoint {
  const point = value as Partial<TrackPoint> | null;
  return Boolean(point
    && Number.isFinite(point.lat)
    && Number.isFinite(point.lng)
    && Math.abs(Number(point.lat)) <= 90
    && Math.abs(Number(point.lng)) <= 180);
}

function safePointList(value: unknown, minimum = 2) {
  return Array.isArray(value)
    && value.length >= minimum
    && value.length <= maxRoutePoints
    && value.every(finitePoint);
}

function safeOptionalPointList(value: unknown) {
  return value == null || (Array.isArray(value) && value.length <= maxRoutePoints && value.every(finitePoint));
}

function safeSplitSections(value: unknown) {
  return value == null || (Array.isArray(value)
    && value.length <= 32
    && value.every((rawSection) => {
      const section = rawSection as { splitPoint?: unknown; mergePoint?: unknown; branches?: unknown };
      return finitePoint(section.splitPoint)
        && finitePoint(section.mergePoint)
        && Array.isArray(section.branches)
        && section.branches.length <= 2
        && section.branches.every((rawBranch) => {
          const branch = rawBranch as { points?: unknown };
          return safePointList(branch.points);
        });
    }));
}

function safeZones(value: unknown) {
  return Array.isArray(value)
    && value.length <= maxZones
    && value.every((rawZone) => {
      const zone = rawZone as Partial<TrackZone>;
      return typeof zone.id === 'string'
        && zone.id.length > 0
        && zone.id.length <= 160
        && Number.isFinite(zone.startMeter)
        && Number.isFinite(zone.endMeter)
        && Number(zone.startMeter) >= 0
        && Number(zone.endMeter) > Number(zone.startMeter)
        && Number(zone.endMeter) <= maxReviewMeters
        && (zone.branchSelections == null || (
          typeof zone.branchSelections === 'object'
          && !Array.isArray(zone.branchSelections)
          && Object.entries(zone.branchSelections).length <= 32
          && Object.entries(zone.branchSelections).every(([splitId, branch]) => (
            splitId.length > 0 && splitId.length <= 160 && (branch === 'a' || branch === 'b')
          ))
        ));
    });
}

function safeRoutePoints(track: TrackRecord) {
  if (safePointList(track.centerline)) return track.centerline!;
  return safePointList(track.outline) ? track.outline : [];
}

export function trainingTrackReviewRoute(
  track: TrackRecord,
  branchSelections: TrackZone['branchSelections'] = {},
) {
  const route = safeRoutePoints(track);
  return route.length > 1
    ? routeWithSplitBranchSelections(route, track.splitSections ?? [], branchSelections)
    : [];
}

export function trainingTrackReviewRouteSegments(track: TrackRecord) {
  const route = safeRoutePoints(track);
  return route.length > 1
    ? splitSharedRouteSegments(route, track.splitSections ?? [])
    : [];
}

export function trainingTrackReviewZonePolyline(track: TrackRecord, zone: TrackZone) {
  if ((zone as Partial<TrainingTrackReviewZone>).placeable === false) return [];
  const route = trainingTrackReviewRoute(track, zone.branchSelections);
  if (route.length < 2 || zone.endMeter <= zone.startMeter) return [];
  return Array.from({ length: 24 }, (_, index) => (
    pointAtRouteMeter(route, zone.startMeter + ((zone.endMeter - zone.startMeter) * index / 23))
  )).filter((point): point is TrackPoint => point != null);
}

function safeRouteVariants(value: unknown) {
  return value == null || (Array.isArray(value)
    && value.length <= 2
    && value.every((rawVariant) => {
      const variant = rawVariant as Partial<TrackRouteVariant>;
      return (variant.id === 'amateur' || variant.id === 'pro')
        && typeof variant.name === 'string'
        && variant.name.length <= 160
        && Number.isFinite(variant.restAfterSeconds)
        && Number.isFinite(variant.lengthMeters)
        && Number(variant.lengthMeters) > 0
        && Number(variant.lengthMeters) <= maxReviewMeters
        && safePointList(variant.centerline)
        && finitePoint(variant.startGate)
        && finitePoint(variant.finishLine)
        && safeZones(variant.zones)
        && safeSplitSections(variant.splitSections);
    }));
}

function safeTrackRecord(value: unknown, trackId: string, requireGeometry: boolean): value is TrackRecord {
  const track = value as Partial<TrackRecord> | null;
  return Boolean(track
    && track.id === trackId
    && typeof track.name === 'string'
    && safeZones(track.zones)
    && safeOptionalPointList(track.outline)
    && safeOptionalPointList(track.centerline)
    && safeSplitSections(track.splitSections)
    && safeRouteVariants(track.routeVariants)
    && Number.isFinite(track.lengthMeters)
    && Number(track.lengthMeters) > 0
    && Number(track.lengthMeters) <= maxReviewMeters
    && (!requireGeometry || safePointList(track.centerline) || safePointList(track.outline)));
}

function safeMapping(value: unknown, trackId: string): value is UserTrackMapping {
  const mapping = value as Partial<UserTrackMapping> | null;
  if (!mapping
    || mapping.version !== 1
    || mapping.trackId !== trackId
    || mapping.routeStatus !== 'user-mapped'
    || !safePointList(mapping.centerline)
    || !finitePoint(mapping.startGate)
    || !finitePoint(mapping.finishLine)
    || !safeZones(mapping.zones)
    || !safeSplitSections(mapping.splitSections)
    || !Number.isFinite(mapping.lengthMeters)
    || Number(mapping.lengthMeters) <= 0
    || Number(mapping.lengthMeters) > maxReviewMeters) {
    return false;
  }
  return !Array.isArray(mapping.routeVariants) || mapping.routeVariants.every((variant) => (
    (variant.id === 'amateur' || variant.id === 'pro')
    && safePointList(variant.centerline)
    && safeSplitSections(variant.splitSections)
    && safeZones(variant.zones)
  ));
}

function exactTrack(trackId: string, sources: TrainingTrackReviewSources) {
  const catalogTrack = sources.catalog.find((track) => track.id === trackId);
  const publicTrack = sources.publicRoutes?.find((track) => track.id === trackId);
  const userTrack = sources.userRoutes?.find((track) => track.id === trackId);
  if (trackId.startsWith('custom-')) {
    if (safeTrackRecord(userTrack, trackId, true)) return userTrack;
    if (safeTrackRecord(publicTrack, trackId, true)) return publicTrack;
  }
  if (safeTrackRecord(catalogTrack, trackId, false)) return catalogTrack;
  if (safeTrackRecord(publicTrack, trackId, true)) return publicTrack;
  return safeTrackRecord(userTrack, trackId, true) ? userTrack : null;
}

function lapFromZoneId(zoneId: string) {
  const match = zoneId.match(/-lap-(\d+)$/u);
  return match ? Math.max(1, Number(match[1]) || 1) : null;
}

function baseZoneId(zoneId: string) {
  return zoneId.replace(/-lap-\d+$/u, '');
}

function savedLapLengthFromZones(zones: readonly RaceZoneResult[]) {
  const byBaseId = new Map<string, Array<{ lap: number; start: number; end: number }>>();
  zones.forEach((zone) => {
    const lap = lapFromZoneId(zone.zoneId);
    if (lap == null || !validRecordedZone(zone)) return;
    const baseId = baseZoneId(zone.zoneId);
    byBaseId.set(baseId, [...(byBaseId.get(baseId) ?? []), {
      lap,
      start: zone.startMeter,
      end: zone.endMeter,
    }]);
  });
  const candidates: number[] = [];
  byBaseId.forEach((entries) => {
    const ordered = [...entries].sort((left, right) => left.lap - right.lap);
    for (let index = 1; index < ordered.length; index += 1) {
      const lapDelta = ordered[index].lap - ordered[index - 1].lap;
      if (lapDelta <= 0) continue;
      const startDelta = (ordered[index].start - ordered[index - 1].start) / lapDelta;
      const endDelta = (ordered[index].end - ordered[index - 1].end) / lapDelta;
      if (Number.isFinite(startDelta) && startDelta > 0) candidates.push(startDelta);
      if (Number.isFinite(endDelta) && endDelta > 0) candidates.push(endDelta);
    }
  });
  if (candidates.length === 0) return null;
  candidates.sort((left, right) => left - right);
  return candidates[Math.floor(candidates.length / 2)];
}

function validRecordedZone(zone: RaceZoneResult) {
  return typeof zone.zoneId === 'string'
    && zone.zoneId.trim().length > 0
    && zone.zoneId.length <= 160
    && Number.isFinite(zone.startMeter)
    && Number.isFinite(zone.endMeter)
    && zone.startMeter >= 0
    && zone.endMeter > zone.startMeter
    && zone.endMeter <= maxReviewMeters;
}

export function buildTrainingTrackReviewZones(
  recordedZones: readonly RaceZoneResult[],
  track: TrackRecord | null,
  lapCount = 1,
  options: { placementAllowed?: boolean; placementNote?: string } = {},
) {
  const routeLength = Math.max(1, Number(track?.lengthMeters) || 1);
  const safeLapCount = Math.max(1, Math.min(20, Math.round(Number(lapCount) || 1)));
  const savedLapLength = safeLapCount > 1 ? savedLapLengthFromZones(recordedZones) : null;
  const lengthTolerance = Math.max(1, routeLength * 0.01);
  const lapLengthChanged = track != null
    && savedLapLength != null
    && Math.abs(savedLapLength - routeLength) > lengthTolerance;
  const placementAllowed = options.placementAllowed
    ?? Boolean(track && track.routeStatus !== 'locator-only');

  const result: TrainingTrackReviewZone[] = [];
  recordedZones.forEach((recorded, sourceIndex) => {
    if (result.length >= maxZones) return;
    if (!validRecordedZone(recorded)) return;

    let lapNumber = lapFromZoneId(recorded.zoneId);
    if (lapNumber == null && savedLapLength && recorded.startMeter >= savedLapLength) {
      lapNumber = Math.min(safeLapCount, Math.floor(recorded.startMeter / savedLapLength) + 1);
    }
    const canNormalizeLap = lapNumber == null || lapNumber === 1 || savedLapLength != null;
    const offset = lapNumber && lapNumber > 1 && savedLapLength
      ? (lapNumber - 1) * savedLapLength
      : 0;
    const currentZone = track?.zones.find((zone) => (
      zone.id === recorded.zoneId || zone.id === baseZoneId(recorded.zoneId)
    ));
    const startMeter = recorded.startMeter - offset;
    const endMeter = recorded.endMeter - offset;
    const insideCurrentRoute = Boolean(track
      && startMeter >= 0
      && endMeter > startMeter
      && endMeter <= routeLength);
    const placeable = placementAllowed
      && canNormalizeLap
      && !lapLengthChanged
      && insideCurrentRoute;
    const placementNote = placeable
      ? null
      : options.placementNote
        ?? (!track || !placementAllowed
          ? 'Current route geometry is unavailable.'
          : !canNormalizeLap
            ? 'The saved lap length is unavailable.'
            : lapLengthChanged
              ? 'The current route length differs from this saved race.'
              : 'This saved zone falls outside the current route.');

    const zoneType = recorded.zoneType === 'pedal'
      || recorded.zoneType === 'recovery'
      || recorded.zoneType === 'technical'
      ? recorded.zoneType
      : currentZone?.type ?? 'pedal';
    result.push({
      id: result.some((zone) => zone.sourceZoneId === recorded.zoneId)
        ? `${recorded.zoneId}--recorded-${sourceIndex + 1}`
        : recorded.zoneId,
      sourceIndex,
      sourceZoneId: recorded.zoneId,
      number: result.length + 1,
      name: recorded.zoneName?.trim() || currentZone?.name || `Zone ${result.length + 1}`,
      type: zoneType,
      startMeter,
      endMeter,
      recordedStartMeter: recorded.startMeter,
      recordedEndMeter: recorded.endMeter,
      lapNumber,
      placeable,
      placementNote,
      ...(currentZone?.branchSelections ? { branchSelections: currentZone.branchSelections } : {}),
    });
  });
  return result;
}

export function resolveTrainingTrackReview(
  request: TrainingTrackReviewRequest,
  sources: TrainingTrackReviewSources,
): TrainingTrackReviewResult {
  const trackId = request.trackId?.trim() ?? '';
  if (!trackId) {
    return {
      status: 'missing-track',
      track: null,
      zones: buildTrainingTrackReviewZones(request.zones, null, Number(request.lapCount) || 1),
      mappingSource: null,
      mappingSavedAt: null,
      note: 'This saved session has no track identifier, so TrackLab will not guess from its name.',
    };
  }

  const baseTrack = exactTrack(trackId, sources);
  if (!baseTrack) {
    return {
      status: 'missing-track',
      track: null,
      zones: buildTrainingTrackReviewZones(request.zones, null, Number(request.lapCount) || 1),
      mappingSource: null,
      mappingSavedAt: null,
      note: 'The exact saved track is no longer in this track catalog. Recorded zone distances remain available.',
    };
  }

  const publicMapping = safeMapping(sources.publicMappings?.[trackId], trackId)
    ? sources.publicMappings![trackId]
    : undefined;
  const userMapping = safeMapping(sources.userMappings?.[trackId], trackId)
    ? sources.userMappings![trackId]
    : undefined;
  const mapping = newestTrackMapping(publicMapping, userMapping);
  const routeVariantId: TrackRouteVariantId | undefined = request.routeVariantId === 'amateur'
    || request.routeVariantId === 'pro'
    ? request.routeVariantId
    : undefined;
  let track = baseTrack;
  let appliedMapping: UserTrackMapping | undefined;
  let placementFailure = '';
  if (mapping && routeVariantId && !routeVariantFromMapping(mapping, routeVariantId)) {
    placementFailure = `The saved ${routeVariantId === 'pro' ? 'Pro' : 'Amateur'} route variant is no longer available.`;
  } else if (mapping) {
    try {
      track = applyUserTrackMapping(baseTrack, mapping, routeVariantId);
      appliedMapping = mapping;
    } catch {
      track = baseTrack;
    }
  } else if (routeVariantId) {
    const catalogVariant = baseTrack.routeVariants?.find((variant) => variant.id === routeVariantId);
    if (catalogVariant) {
      try {
        track = applyTrackRouteVariant(baseTrack, catalogVariant);
      } catch {
        placementFailure = `The saved ${routeVariantId === 'pro' ? 'Pro' : 'Amateur'} route variant is no longer available.`;
      }
    } else {
      placementFailure = `The saved ${routeVariantId === 'pro' ? 'Pro' : 'Amateur'} route variant is no longer available.`;
    }
  }
  const mappingSource = appliedMapping
    ? appliedMapping === userMapping ? 'user' : 'public'
    : 'catalog';
  const locatorOnly = track.routeStatus === 'locator-only' && !appliedMapping;
  const ready = !placementFailure && !locatorOnly && trainingTrackReviewRoute(track).length > 1;
  const note = placementFailure
    ? `${placementFailure} Saved zone rows remain available but are not placed on a guessed route.`
    : locatorOnly
      ? 'This catalog record is locator-only, not mapped route geometry. Saved zone rows remain available but are not placed on a guessed route.'
      : ready
        ? appliedMapping
          ? 'The map uses the current saved route; the distances and performance values are from this historical session.'
          : 'The map uses the current estimated catalog route; the distances and performance values are from this historical session.'
        : 'This track has no usable route geometry, so saved zone rows are not placed on a map.';

  return {
    status: ready ? 'ready' : 'unmapped',
    track,
    zones: buildTrainingTrackReviewZones(request.zones, track, Number(request.lapCount) || 1, {
      placementAllowed: ready,
      ...(ready ? {} : { placementNote: placementFailure || (locatorOnly
        ? 'This track is locator-only.'
        : 'Current route geometry is unavailable.') }),
    }),
    mappingSource,
    mappingSavedAt: appliedMapping?.savedAt ?? null,
    note,
  };
}

async function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = fetch('/data/track-database.json', { cache: 'force-cache' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Track database returned ${response.status}`);
        const payload = await response.json() as { tracks?: TrackRecord[] };
        return Array.isArray(payload.tracks) ? payload.tracks : [];
      })
      .then((tracks) => tracks.length > 0 ? tracks : trackCatalog)
      .catch(() => trackCatalog);
  }
  return catalogPromise;
}

export async function loadTrainingTrackReview(request: TrainingTrackReviewRequest) {
  if (!publicPromise) publicPromise = readPublicTrackCatalog();
  const [catalog, publicCatalog, userCatalog] = await Promise.all([
    loadCatalog(),
    publicPromise.catch(() => ({ trackMappings: {}, customRoutes: [] })),
    readCloudUserData('current').catch(() => ({ trackMappings: {}, customRoutes: [] })),
  ]);
  return resolveTrainingTrackReview(request, {
    catalog,
    publicMappings: publicCatalog.trackMappings,
    publicRoutes: publicCatalog.customRoutes,
    userMappings: userCatalog.trackMappings,
    userRoutes: userCatalog.customRoutes,
  });
}

function pathForPoints(points: readonly TrackPoint[], project: (point: TrackPoint) => { x: number; y: number }) {
  return points.map((point, index) => {
    const projected = project(point);
    return `${index === 0 ? 'M' : 'L'}${projected.x.toFixed(1)} ${projected.y.toFixed(1)}`;
  }).join(' ');
}

export function buildTrainingTrackSchematic(
  track: TrackRecord,
  zones: readonly TrainingTrackReviewZone[],
): TrainingTrackSchematic | null {
  const routeSegments = trainingTrackReviewRouteSegments(track).filter((segment) => segment.length > 1);
  const branchSegments = (track.splitSections ?? []).flatMap((section) => (
    section.branches.map((branch) => branch.points).filter((points) => points.length > 1)
  ));
  const zoneSegments = zones.map((zone) => ({ zone, points: trainingTrackReviewZonePolyline(track, zone) }))
    .filter(({ points }) => points.length > 1);
  const points = [...routeSegments, ...branchSegments, ...zoneSegments.map(({ points: zonePoints }) => zonePoints)].flat();
  if (points.length < 2) return null;

  const originLat = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
  const lngScale = Math.max(0.01, Math.cos(originLat * (Math.PI / 180)));
  const xs = points.map((point) => point.lng * lngScale);
  const ys = points.map((point) => point.lat);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(0.000001, maxX - minX);
  const height = Math.max(0.000001, maxY - minY);
  const scale = Math.min(584 / width, 304 / height);
  const offsetX = 28 + (584 - width * scale) / 2;
  const offsetY = 28 + (304 - height * scale) / 2;
  const project = (point: TrackPoint) => ({
    x: offsetX + ((point.lng * lngScale) - minX) * scale,
    y: offsetY + (maxY - point.lat) * scale,
  });

  return {
    routePaths: [...routeSegments, ...branchSegments].map((pointsInPath) => pathForPoints(pointsInPath, project)),
    zones: zoneSegments.map(({ zone, points: zonePoints }) => {
      const label = zonePoints[Math.floor(zonePoints.length / 2)];
      const projected = project(label);
      return {
        ...zone,
        path: pathForPoints(zonePoints, project),
        labelX: projected.x,
        labelY: projected.y,
      };
    }),
  };
}

export function resetTrainingTrackReviewCacheForTests() {
  catalogPromise = null;
  publicPromise = null;
}
