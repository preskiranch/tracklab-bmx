import type {
  SplitBranchChoice,
  TrackPoint,
  TrackRecord,
  TrackRouteVariant,
  TrackRouteVariantId,
  TrackSplitSection,
  TrackZone,
  UserTrackMapping,
} from '../types';

export const trackMappingStorageKey = 'tracklab:user-track-mappings:v1';
export const splitBranchLabels: Record<SplitBranchChoice, string> = {
  a: 'Amateur Line',
  b: 'Pro Set',
};
export const proSplitMinimumMph = 26;
export const routeVariantLabels: Record<TrackRouteVariantId, string> = {
  amateur: 'Amateur Track',
  pro: 'Pro Track',
};
const routeVariantOrder: TrackRouteVariantId[] = ['amateur', 'pro'];

export type SplitBranchSelection = Partial<Record<string, SplitBranchChoice>>;

export type SplitRouteDecisionPoint = {
  id: string;
  index: number;
  splitMeter: number;
  mergeMeterByBranch: Record<SplitBranchChoice, number>;
  branchLengthByBranch: Record<SplitBranchChoice, number>;
};

export type StoredTrackMappings = Record<string, UserTrackMapping>;

const earthRadiusMeters = 6371008.8;
const splitJunctionToleranceMeters = 4;

function roundCoordinate(value: number) {
  return Number(value.toFixed(7));
}

export function distanceBetweenTrackPoints(a: TrackPoint, b: TrackPoint) {
  const lat1 = a.lat * (Math.PI / 180);
  const lat2 = b.lat * (Math.PI / 180);
  const deltaLat = (b.lat - a.lat) * (Math.PI / 180);
  const deltaLng = (b.lng - a.lng) * (Math.PI / 180);
  const haversine = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;

  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function routeLengthMeters(points: TrackPoint[]) {
  let total = 0;

  for (let index = 1; index < points.length; index += 1) {
    total += distanceBetweenTrackPoints(points[index - 1], points[index]);
  }

  return total;
}

function pointsMatch(a: TrackPoint, b: TrackPoint, toleranceMeters = splitJunctionToleranceMeters) {
  return distanceBetweenTrackPoints(a, b) <= toleranceMeters;
}

function splitBridgeForPoints(start: TrackPoint, end: TrackPoint, splitSections: TrackSplitSection[]) {
  return splitSections.find((section) => (
    pointsMatch(start, section.splitPoint)
    && pointsMatch(end, section.mergePoint)
  ));
}

function splitBranchForSelection(
  splitBridge: TrackSplitSection,
  selections: SplitBranchSelection,
) {
  const selectedId = selections[splitBridge.id] ?? 'a';
  return splitBridge.branches.find((branch) => branch.id === selectedId)
    ?? splitBridge.branches.find((branch) => branch.id === 'a')
    ?? splitBridge.branches[0];
}

function withoutRepeatedJunctions(points: TrackPoint[]) {
  return points.filter((point, index) => (
    index === 0 || distanceBetweenTrackPoints(points[index - 1], point) > 0.25
  ));
}

export function splitSharedRouteSegments(points: TrackPoint[], splitSections: TrackSplitSection[] = []) {
  if (points.length < 2) {
    return points.length === 1 ? [points] : [];
  }

  if (splitSections.length === 0) {
    return [points];
  }

  const segments: TrackPoint[][] = [];
  let currentSegment: TrackPoint[] = [points[0]];

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    const splitBridge = splitBridgeForPoints(previous, point, splitSections);

    if (splitBridge) {
      if (!pointsMatch(currentSegment[currentSegment.length - 1], splitBridge.splitPoint, 0.25)) {
        currentSegment.push(splitBridge.splitPoint);
      }

      const cleanedSegment = withoutRepeatedJunctions(currentSegment);
      if (cleanedSegment.length > 1) {
        segments.push(cleanedSegment);
      }

      currentSegment = [splitBridge.mergePoint];
      continue;
    }

    currentSegment.push(point);
  }

  const cleanedSegment = withoutRepeatedJunctions(currentSegment);
  if (cleanedSegment.length > 1) {
    segments.push(cleanedSegment);
  }

  return segments;
}

export function routeWithSplitBranchSelections(
  points: TrackPoint[],
  splitSections: TrackSplitSection[] = [],
  selections: SplitBranchSelection = {},
) {
  if (points.length < 2 || splitSections.length === 0) {
    return points;
  }

  const route: TrackPoint[] = [points[0]];

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    const splitBridge = splitBridgeForPoints(previous, point, splitSections);

    if (splitBridge) {
      const selectedBranch = splitBranchForSelection(splitBridge, selections);
      const branchPoints = selectedBranch?.points.length >= 2
        ? selectedBranch.points
        : [splitBridge.splitPoint, splitBridge.mergePoint];

      if (route.length > 0 && pointsMatch(route[route.length - 1], splitBridge.splitPoint)) {
        route[route.length - 1] = splitBridge.splitPoint;
      } else {
        route.push(splitBridge.splitPoint);
      }

      branchPoints.slice(1).forEach((branchPoint) => route.push(branchPoint));
      continue;
    }

    route.push(point);
  }

  return withoutRepeatedJunctions(route);
}

export function routeWithDefaultSplitBranches(points: TrackPoint[], splitSections: TrackSplitSection[] = []) {
  return routeWithSplitBranchSelections(points, splitSections);
}

export function routeLengthWithSplitBranchSelections(
  points: TrackPoint[],
  splitSections: TrackSplitSection[] = [],
  selections: SplitBranchSelection = {},
) {
  return routeLengthMeters(routeWithSplitBranchSelections(points, splitSections, selections));
}

export function routeLengthWithDefaultSplitBranches(points: TrackPoint[], splitSections: TrackSplitSection[] = []) {
  return routeLengthWithSplitBranchSelections(points, splitSections);
}

export function splitDecisionPointsForRoute(
  points: TrackPoint[],
  splitSections: TrackSplitSection[] = [],
): SplitRouteDecisionPoint[] {
  if (points.length < 2 || splitSections.length === 0) {
    return [];
  }

  const route: TrackPoint[] = [points[0]];
  const decisions: SplitRouteDecisionPoint[] = [];

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    const splitBridge = splitBridgeForPoints(previous, point, splitSections);

    if (splitBridge) {
      if (route.length > 0 && pointsMatch(route[route.length - 1], splitBridge.splitPoint)) {
        route[route.length - 1] = splitBridge.splitPoint;
      } else {
        route.push(splitBridge.splitPoint);
      }

      const splitMeter = routeLengthMeters(withoutRepeatedJunctions(route));
      const branchA = splitBridge.branches.find((branch) => branch.id === 'a');
      const branchB = splitBridge.branches.find((branch) => branch.id === 'b');
      const branchAPoints = (branchA?.points.length ?? 0) >= 2 ? branchA!.points : [splitBridge.splitPoint, splitBridge.mergePoint];
      const branchBPoints = (branchB?.points.length ?? 0) >= 2 ? branchB!.points : [splitBridge.splitPoint, splitBridge.mergePoint];
      const branchALength = routeLengthMeters(branchAPoints);
      const branchBLength = routeLengthMeters(branchBPoints);

      decisions.push({
        id: splitBridge.id,
        index: splitBridge.index,
        splitMeter,
        mergeMeterByBranch: {
          a: splitMeter + branchALength,
          b: splitMeter + branchBLength,
        },
        branchLengthByBranch: {
          a: branchALength,
          b: branchBLength,
        },
      });

      branchAPoints.slice(1).forEach((branchPoint) => route.push(branchPoint));
      continue;
    }

    route.push(point);
  }

  return decisions;
}

function cumulativeMeters(points: TrackPoint[]) {
  const distances = [0];
  let total = 0;

  for (let index = 1; index < points.length; index += 1) {
    total += distanceBetweenTrackPoints(points[index - 1], points[index]);
    distances.push(total);
  }

  return distances;
}

function sortedUniqueBoundaries(boundaries: number[], totalMeters: number) {
  const rounded = boundaries
    .map((boundary) => Math.round(boundary))
    .filter((boundary) => boundary > 1 && boundary < totalMeters - 1)
    .sort((a, b) => a - b);

  return rounded.filter((boundary, index) => index === 0 || Math.abs(boundary - rounded[index - 1]) >= 3);
}

function normalizePoint(point: TrackPoint): TrackPoint {
  return {
    lat: roundCoordinate(point.lat),
    lng: roundCoordinate(point.lng),
  };
}

function isTrackZone(zone: TrackZone) {
  return zone.type === 'pedal' || zone.type === 'recovery' || zone.type === 'technical';
}

function defaultPedalZoneName(index: number) {
  return `Pedal Zone ${index + 1}`;
}

export function createTrackZones(
  lengthMeters: number,
  zoneBoundaryMeters: number[] = [],
  _zoneTypes: TrackZone['type'][] = [],
  _restAfterSeconds = 1,
): TrackZone[] {
  const cleanBoundaries = sortedUniqueBoundaries(zoneBoundaryMeters, lengthMeters);
  const zones: TrackZone[] = [];

  for (let index = 0; index < cleanBoundaries.length - 1; index += 2) {
    const startMeter = cleanBoundaries[index];
    const endMeter = cleanBoundaries[index + 1];
    if (endMeter - startMeter < 3) {
      continue;
    }

    zones.push({
      id: `pedal-zone-${zones.length + 1}`,
      name: defaultPedalZoneName(zones.length),
      startMeter,
      endMeter,
      type: 'pedal',
      restAfterSeconds: _restAfterSeconds,
    });
  }

  return zones;
}

function normalizeSplitSection(section: TrackSplitSection): TrackSplitSection {
  const splitPoint = normalizePoint(section.splitPoint);
  const mergePoint = normalizePoint(section.mergePoint);
  const index = Math.max(1, Math.round(section.index));
  const normalizedBranches = section.branches
    .filter((branch) => branch.id === 'a' || branch.id === 'b')
    .slice(0, 2)
    .map((branch) => {
      const rawPoints = branch.points.length >= 2 ? branch.points : [splitPoint, mergePoint];
      const points = rawPoints.map(normalizePoint);

      return {
        id: branch.id,
        name: branch.name || splitBranchLabels[branch.id],
        points,
        lengthMeters: Math.round(Math.max(1, routeLengthMeters(points))),
      };
    });

  return {
    id: section.id || `split-${index}`,
    name: section.name || `Split ${index} / Merge ${index}`,
    index,
    splitPoint,
    mergePoint,
    branches: normalizedBranches,
  };
}

function createTrackRouteVariant(
  track: TrackRecord,
  variantId: TrackRouteVariantId,
  points: TrackPoint[],
  restAfterSeconds: number,
  zoneBoundaryMeters: number[] = [],
  splitSections: TrackSplitSection[] = [],
  zoneTypes: TrackZone['type'][] = [],
): TrackRouteVariant {
  const centerline = points.map(normalizePoint);
  const normalizedSplitSections = splitSections.map(normalizeSplitSection);
  const measurableRoute = routeWithDefaultSplitBranches(centerline, normalizedSplitSections);
  const distances = cumulativeMeters(measurableRoute);
  const lengthMeters = Math.max(1, distances[distances.length - 1] ?? track.lengthMeters);
  const cleanBoundaries = sortedUniqueBoundaries(zoneBoundaryMeters, lengthMeters);
  const zones = createTrackZones(lengthMeters, cleanBoundaries, zoneTypes, restAfterSeconds);

  return {
    id: variantId,
    name: routeVariantLabels[variantId],
    restAfterSeconds,
    lengthMeters: Math.round(lengthMeters),
    centerline,
    startGate: centerline[0],
    finishLine: centerline[centerline.length - 1],
    zoneBoundaryMeters: cleanBoundaries,
    zones,
    splitSections: normalizedSplitSections,
  };
}

function routeVariantFromTopLevelMapping(
  mapping: UserTrackMapping,
  variantId: TrackRouteVariantId = 'amateur',
): TrackRouteVariant {
  const zoneBoundaryMeters = Array.isArray(mapping.zoneBoundaryMeters)
    ? sortedUniqueBoundaries(mapping.zoneBoundaryMeters, mapping.lengthMeters)
    : mapping.zones
      .filter(isTrackZone)
      .flatMap((zone) => [zone.startMeter, zone.endMeter]);

  return {
    id: variantId,
    name: routeVariantLabels[variantId],
    restAfterSeconds: mapping.restAfterSeconds,
    lengthMeters: mapping.lengthMeters,
    centerline: mapping.centerline,
    startGate: mapping.startGate,
    finishLine: mapping.finishLine,
    zoneBoundaryMeters,
    zones: createTrackZones(mapping.lengthMeters, zoneBoundaryMeters, [], mapping.restAfterSeconds),
    splitSections: mapping.splitSections ?? [],
  };
}

function normalizeRouteVariant(variant: TrackRouteVariant): TrackRouteVariant {
  const variantId = variant.id === 'pro' ? 'pro' : 'amateur';
  const centerline = variant.centerline.map(normalizePoint);
  const splitSections = (variant.splitSections ?? []).map(normalizeSplitSection);
  const measurableRoute = routeWithDefaultSplitBranches(centerline, splitSections);
  const lengthMeters = Math.round(Math.max(1, routeLengthMeters(measurableRoute)));
  const zoneBoundaryMeters = Array.isArray(variant.zoneBoundaryMeters)
    ? sortedUniqueBoundaries(variant.zoneBoundaryMeters, lengthMeters)
    : variant.zones
      .filter(isTrackZone)
      .flatMap((zone) => [zone.startMeter, zone.endMeter]);
  const restAfterSeconds = Number.isFinite(variant.restAfterSeconds) ? variant.restAfterSeconds : 1;

  return {
    id: variantId,
    name: variant.name || routeVariantLabels[variantId],
    restAfterSeconds,
    lengthMeters,
    centerline,
    startGate: variant.startGate ? normalizePoint(variant.startGate) : centerline[0],
    finishLine: variant.finishLine ? normalizePoint(variant.finishLine) : centerline[centerline.length - 1],
    zoneBoundaryMeters,
    zones: createTrackZones(lengthMeters, zoneBoundaryMeters, [], restAfterSeconds),
    splitSections,
  };
}

export function routeVariantsFromMapping(mapping: UserTrackMapping) {
  const rawVariants = Array.isArray(mapping.routeVariants) ? mapping.routeVariants : [];
  const variants = rawVariants
    .filter((variant) => (variant.id === 'amateur' || variant.id === 'pro') && variant.centerline?.length >= 2)
    .map(normalizeRouteVariant);

  if (variants.length > 0) {
    return routeVariantOrder
      .map((variantId) => variants.find((variant) => variant.id === variantId))
      .filter((variant): variant is TrackRouteVariant => variant != null);
  }

  return [routeVariantFromTopLevelMapping(mapping, 'amateur')];
}

export function routeVariantFromMapping(mapping: UserTrackMapping, variantId: TrackRouteVariantId) {
  return routeVariantsFromMapping(mapping).find((variant) => variant.id === variantId) ?? null;
}

export function draftRouteFromMapping(mapping: UserTrackMapping, variantId: TrackRouteVariantId) {
  const variant = routeVariantFromMapping(mapping, variantId);
  if (variant) {
    return variant;
  }

  return Array.isArray(mapping.routeVariants) && mapping.routeVariants.length > 0
    ? null
    : routeVariantFromTopLevelMapping(mapping, variantId);
}

export function zoneBoundariesFromRouteVariant(variant: TrackRouteVariant) {
  if (Array.isArray(variant.zoneBoundaryMeters)) {
    return variant.zoneBoundaryMeters;
  }

  return variant.zones
    .filter(isTrackZone)
    .flatMap((zone) => [zone.startMeter, zone.endMeter])
    .filter((meter) => meter > 0 && meter < variant.lengthMeters);
}

export function createUserTrackMapping(
  track: TrackRecord,
  points: TrackPoint[],
  restAfterSeconds: number,
  zoneBoundaryMeters: number[] = [],
  splitSections: TrackSplitSection[] = [],
  routeVariantId?: TrackRouteVariantId,
  existingRouteVariants: TrackRouteVariant[] = [],
  zoneTypes: TrackZone['type'][] = [],
): UserTrackMapping {
  const primaryVariant = createTrackRouteVariant(
    track,
    routeVariantId ?? 'amateur',
    points,
    restAfterSeconds,
    zoneBoundaryMeters,
    splitSections,
    zoneTypes,
  );
  const routeVariants = routeVariantId
    ? routeVariantOrder
      .map((variantId) => (
        variantId === routeVariantId
          ? primaryVariant
          : existingRouteVariants.find((variant) => variant.id === variantId)
      ))
      .filter((variant): variant is TrackRouteVariant => variant != null)
    : existingRouteVariants;

  return {
    version: 1,
    trackId: track.id,
    trackName: track.name,
    country: track.country,
    state: track.state,
    savedAt: new Date().toISOString(),
    routeStatus: 'user-mapped',
    restAfterSeconds: primaryVariant.restAfterSeconds,
    lengthMeters: primaryVariant.lengthMeters,
    centerline: primaryVariant.centerline,
    startGate: primaryVariant.startGate,
    finishLine: primaryVariant.finishLine,
    zoneBoundaryMeters: primaryVariant.zoneBoundaryMeters,
    zones: primaryVariant.zones,
    splitSections: primaryVariant.splitSections,
    ...(routeVariants.length > 0 ? { routeVariants } : {}),
  };
}

export function applyUserTrackMapping(
  track: TrackRecord,
  mapping: UserTrackMapping,
  routeVariantId?: TrackRouteVariantId,
): TrackRecord {
  const routeVariant = routeVariantId ? routeVariantFromMapping(mapping, routeVariantId) : null;
  const activeRoute = routeVariant ?? routeVariantFromTopLevelMapping(mapping);

  return {
    ...track,
    lengthMeters: activeRoute.lengthMeters,
    outline: activeRoute.centerline,
    centerline: activeRoute.centerline,
    startGate: activeRoute.startGate,
    finishLine: activeRoute.finishLine,
    routeStatus: 'user-mapped',
    zones: activeRoute.zones,
    splitSections: activeRoute.splitSections ?? [],
    routeVariants: routeVariantsFromMapping(mapping),
    activeRouteVariantId: activeRoute.id,
    activeRouteVariantName: activeRoute.name,
  };
}

export function readStoredTrackMappings(): StoredTrackMappings {
  try {
    const stored = window.localStorage.getItem(trackMappingStorageKey);
    if (!stored) {
      return {};
    }

    const parsed = JSON.parse(stored) as StoredTrackMappings;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeStoredTrackMappings(mappings: StoredTrackMappings) {
  window.localStorage.setItem(trackMappingStorageKey, JSON.stringify(mappings));
}

export function zoneBoundariesFromMapping(mapping: UserTrackMapping) {
  if (Array.isArray(mapping.zoneBoundaryMeters)) {
    return mapping.zoneBoundaryMeters;
  }

  return mapping.zones
    .filter(isTrackZone)
    .flatMap((zone) => [zone.startMeter, zone.endMeter])
    .filter((meter) => meter > 0 && meter < mapping.lengthMeters);
}

export function pointAtRouteMeter(points: TrackPoint[], meter: number): TrackPoint | null {
  if (points.length === 0) {
    return null;
  }

  if (points.length === 1) {
    return points[0];
  }

  const target = Math.max(0, meter);
  let traveled = 0;

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const segmentDistance = distanceBetweenTrackPoints(start, end);
    if (traveled + segmentDistance >= target) {
      const progress = (target - traveled) / Math.max(1, segmentDistance);
      return {
        lat: start.lat + (end.lat - start.lat) * progress,
        lng: start.lng + (end.lng - start.lng) * progress,
      };
    }

    traveled += segmentDistance;
  }

  return points[points.length - 1];
}

function projectToFlatMeters(point: TrackPoint, origin: TrackPoint) {
  const latScale = 111_320;
  const lngScale = Math.cos(origin.lat * (Math.PI / 180)) * 111_320;

  return {
    x: (point.lng - origin.lng) * lngScale,
    y: (point.lat - origin.lat) * latScale,
  };
}

export function nearestRouteMeter(points: TrackPoint[], target: TrackPoint) {
  if (points.length < 2) {
    return 0;
  }

  const origin = points[0];
  const targetPoint = projectToFlatMeters(target, origin);
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestMeter = 0;
  let traveled = 0;

  for (let index = 1; index < points.length; index += 1) {
    const start = projectToFlatMeters(points[index - 1], origin);
    const end = projectToFlatMeters(points[index], origin);
    const segmentX = end.x - start.x;
    const segmentY = end.y - start.y;
    const segmentLengthSquared = segmentX ** 2 + segmentY ** 2;
    const segmentDistance = distanceBetweenTrackPoints(points[index - 1], points[index]);
    const progress = segmentLengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((targetPoint.x - start.x) * segmentX + (targetPoint.y - start.y) * segmentY) / segmentLengthSquared));
    const projected = {
      x: start.x + segmentX * progress,
      y: start.y + segmentY * progress,
    };
    const distance = Math.hypot(targetPoint.x - projected.x, targetPoint.y - projected.y);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestMeter = traveled + segmentDistance * progress;
    }

    traveled += segmentDistance;
  }

  return bestMeter;
}

export function parseUserTrackMapping(value: string): UserTrackMapping {
  const parsed = JSON.parse(value) as Partial<UserTrackMapping>;

  if (
    parsed.version !== 1
    || typeof parsed.trackId !== 'string'
    || typeof parsed.trackName !== 'string'
    || !Array.isArray(parsed.centerline)
    || parsed.centerline.length < 2
    || !Array.isArray(parsed.zones)
  ) {
    throw new Error('Mapping file is not a TrackLab BMX mapping.');
  }

  return {
    ...parsed,
    splitSections: Array.isArray(parsed.splitSections)
      ? parsed.splitSections.map((section) => normalizeSplitSection(section))
      : [],
    routeVariants: Array.isArray(parsed.routeVariants)
      ? routeVariantsFromMapping(parsed as UserTrackMapping)
      : undefined,
  } as UserTrackMapping;
}
