import type {
  SplitBranchChoice,
  TrackPoint,
  TrackRecord,
  TrackRaceViewMode,
  TrackRouteVariant,
  TrackRouteVariantId,
  TrackSplitSection,
  TrackZoneBoundarySet,
  TrackZoneBranchSelections,
  TrackZone,
  UserTrackMapping,
} from '../types';
import { safeSetLocalStorage } from './browserStorage';

export const trackMappingStorageKey = 'tracklab:user-track-mappings:v1';
export const defaultZoneBoundarySetId = 'default';
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

export type TrackZoneBoundaryAnchorSet = {
  id: string;
  branchSelections?: TrackZoneBranchSelections;
  boundaryPoints: TrackPoint[];
};

const earthRadiusMeters = 6371008.8;
const splitJunctionToleranceMeters = 4;
const zoneBoundaryEndpointSnapMeters = 8;
const zoneBoundaryDuplicateMeters = 3;

function mappingSavedAtMs(mapping: UserTrackMapping | null | undefined) {
  const savedAt = Date.parse(mapping?.savedAt ?? '');
  return Number.isFinite(savedAt) ? savedAt : 0;
}

function withoutLegacyGameRoute(mapping: UserTrackMapping): UserTrackMapping {
  if (mapping.raceViewMode !== 'game' && !Object.prototype.hasOwnProperty.call(mapping, 'gameRoute')) {
    return mapping;
  }
  const { gameRoute: _legacyGameRoute, ...standardMapping } = mapping as UserTrackMapping & {
    gameRoute?: unknown;
  };
  return {
    ...standardMapping,
    raceViewMode: mapping.raceViewMode === '3d' ? '3d' : 'satellite',
  };
}

export function newestTrackMapping(
  preferred: UserTrackMapping | null | undefined,
  candidate: UserTrackMapping | null | undefined,
) {
  if (!preferred) {
    return candidate;
  }
  if (!candidate) {
    return preferred;
  }

  return mappingSavedAtMs(candidate) > mappingSavedAtMs(preferred) ? candidate : preferred;
}

/**
 * Club Event snapshots may include an unpublished browser draft only while the
 * developer mapping UI is active. Shared tablets and regular club owners must
 * use the published mapping so another profile's localStorage cannot replace
 * the course that every rider receives.
 */
export function clubEventTrackMapping(
  local: UserTrackMapping | null | undefined,
  published: UserTrackMapping | null | undefined,
  developerUiActive: boolean,
) {
  return newestTrackMapping(developerUiActive ? local : undefined, published);
}

export function mergeTrackMappingsBySavedAt(
  current: StoredTrackMappings,
  incoming: StoredTrackMappings,
) {
  const merged = { ...current };
  Object.entries(incoming).forEach(([trackId, mapping]) => {
    merged[trackId] = withoutLegacyGameRoute(newestTrackMapping(merged[trackId], mapping) ?? mapping);
  });
  return merged;
}

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

export function routeIsClosedLoop(points: TrackPoint[], toleranceMeters = 8) {
  return points.length >= 3
    && distanceBetweenTrackPoints(points[0], points[points.length - 1]) <= toleranceMeters;
}

export function appendProSetZoneBoundaryMeter(
  boundaryMeters: number[],
  nextMeter: number,
  branchLengthMeters: number,
) {
  const branchLength = Math.max(0, Math.round(branchLengthMeters));
  if (branchLength === 0 || !Number.isFinite(nextMeter)) {
    return boundaryMeters;
  }

  const anchoredBoundaries = boundaryMeters.length === 0
    ? []
    : boundaryMeters[0] <= zoneBoundaryDuplicateMeters
      ? [...boundaryMeters]
      : [0, ...boundaryMeters];

  // The first Pro Set action always establishes the split as the first pin.
  // A second action then places the paired boundary on the branch.
  if (anchoredBoundaries.length === 0) {
    return [0];
  }

  const clampedMeter = Math.max(0, Math.min(branchLength, Math.round(nextMeter)));
  const snappedMeter = clampedMeter <= zoneBoundaryEndpointSnapMeters
    ? 0
    : branchLength - clampedMeter <= zoneBoundaryEndpointSnapMeters
      ? branchLength
      : clampedMeter;
  if (anchoredBoundaries.some((boundary) => Math.abs(boundary - snappedMeter) < zoneBoundaryDuplicateMeters)) {
    return anchoredBoundaries;
  }

  return [...anchoredBoundaries, snappedMeter].sort((left, right) => left - right);
}

export function repeatTrackZonesForLaps(
  zones: TrackZone[],
  routeLength: number,
  lapCount: number,
) {
  const safeLapCount = Math.max(1, Math.min(20, Math.round(lapCount)));
  if (safeLapCount === 1 || routeLength <= 0) {
    return zones;
  }

  return Array.from({ length: safeLapCount }, (_, lapIndex) => {
    const offset = lapIndex * routeLength;
    return zones.map((zone) => ({
      ...zone,
      id: `${zone.id}-lap-${lapIndex + 1}`,
      name: `Lap ${lapIndex + 1} / ${zone.name}`,
      startMeter: zone.startMeter + offset,
      endMeter: zone.endMeter + offset,
    }));
  }).flat();
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
  const roundedTotalMeters = Math.max(0, Math.round(totalMeters));
  const rounded = boundaries
    .map((boundary) => Math.max(0, Math.min(roundedTotalMeters, Math.round(boundary))))
    .map((boundary) => {
      if (boundary <= zoneBoundaryEndpointSnapMeters) {
        return 0;
      }

      if (roundedTotalMeters - boundary <= zoneBoundaryEndpointSnapMeters) {
        return roundedTotalMeters;
      }

      return boundary;
    })
    .filter((boundary) => boundary >= 0 && boundary <= roundedTotalMeters)
    .sort((a, b) => a - b);

  return rounded.filter((boundary, index) => index === 0 || Math.abs(boundary - rounded[index - 1]) >= 3);
}

function normalizeZoneBranchSelections(selections?: TrackZoneBranchSelections): TrackZoneBranchSelections | undefined {
  const entries = Object.entries(selections ?? {})
    .filter((entry): entry is [string, SplitBranchChoice] => (
      Boolean(entry[0]) && (entry[1] === 'a' || entry[1] === 'b')
    ))
    .sort(([left], [right]) => left.localeCompare(right));

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function zoneBranchSelectionKey(selections?: TrackZoneBranchSelections) {
  return Object.entries(normalizeZoneBranchSelections(selections) ?? {})
    .map(([splitId, branch]) => `${splitId}:${branch}`)
    .join('|');
}

export function zoneBoundarySetIdForSelections(selections?: TrackZoneBranchSelections) {
  const key = zoneBranchSelectionKey(selections);
  return key ? `branch:${key}` : defaultZoneBoundarySetId;
}

function zoneBoundarySetNameForSelections(
  splitSections: TrackSplitSection[],
  selections?: TrackZoneBranchSelections,
) {
  const normalized = normalizeZoneBranchSelections(selections);
  const selectedBranches = Object.values(normalized ?? {}) as SplitBranchChoice[];
  if (selectedBranches.length === 0) {
    return splitSections.length > 0 ? splitBranchLabels.a : 'Main Route';
  }

  if (selectedBranches.every((branch) => branch === 'b')) {
    return splitBranchLabels.b;
  }

  if (selectedBranches.every((branch) => branch === 'a')) {
    return splitBranchLabels.a;
  }

  return selectedBranches
    .map((branch, index) => `S${index + 1} ${splitBranchLabels[branch]}`)
    .join(' / ');
}

export function splitBranchSelectionsForChoice(
  splitSections: TrackSplitSection[],
  branch: SplitBranchChoice,
): TrackZoneBranchSelections {
  return Object.fromEntries(splitSections.map((section) => [section.id, branch]));
}

export function createZoneBoundarySet(
  branchSelections: TrackZoneBranchSelections | undefined,
  boundaryMeters: number[] = [],
  splitSections: TrackSplitSection[] = [],
  lengthMeters = 0,
): TrackZoneBoundarySet {
  const normalizedBranchSelections = normalizeZoneBranchSelections(branchSelections);
  return {
    id: zoneBoundarySetIdForSelections(normalizedBranchSelections),
    name: zoneBoundarySetNameForSelections(splitSections, normalizedBranchSelections),
    ...(normalizedBranchSelections ? { branchSelections: normalizedBranchSelections } : {}),
    boundaryMeters: sortedUniqueBoundaries(boundaryMeters, Math.max(0, lengthMeters)),
  };
}

export function captureZoneBoundaryAnchors(
  points: TrackPoint[],
  splitSections: TrackSplitSection[],
  boundarySets: TrackZoneBoundarySet[],
): TrackZoneBoundaryAnchorSet[] {
  const anchors: TrackZoneBoundaryAnchorSet[] = [];

  boundarySets.forEach((set) => {
    const route = routeWithSplitBranchSelections(points, splitSections, set.branchSelections);
    const lengthMeters = routeLengthMeters(route);
    if (route.length < 2 || lengthMeters <= 0) {
      return;
    }

    const boundaryPoints = set.boundaryMeters
      .filter((meter) => meter >= 0 && meter <= lengthMeters)
      .map((meter) => pointAtRouteMeter(route, meter))
      .filter((point): point is TrackPoint => Boolean(point));

    if (boundaryPoints.length > 0) {
      anchors.push({
        id: set.id,
        ...(set.branchSelections ? { branchSelections: { ...set.branchSelections } } : {}),
        boundaryPoints,
      });
    }
  });

  return anchors;
}

export function reprojectZoneBoundaryAnchors(
  points: TrackPoint[],
  splitSections: TrackSplitSection[],
  anchorSets: TrackZoneBoundaryAnchorSet[],
): TrackZoneBoundarySet[] {
  const boundarySets: TrackZoneBoundarySet[] = [];

  anchorSets.forEach((anchor) => {
    const route = routeWithSplitBranchSelections(points, splitSections, anchor.branchSelections);
    const lengthMeters = routeLengthMeters(route);
    if (route.length < 2 || lengthMeters <= 0) {
      return;
    }

    const boundarySet = createZoneBoundarySet(
      anchor.branchSelections,
      anchor.boundaryPoints.map((point) => nearestRouteMeter(route, point)),
      splitSections,
      lengthMeters,
    );
    if (boundarySet.boundaryMeters.length > 0) {
      boundarySets.push(boundarySet);
    }
  });

  return boundarySets;
}

export function zoneMatchesBranchSelections(
  zone: TrackZone,
  actualBranches: Record<string, SplitBranchChoice> = {},
  selectedBranch: SplitBranchChoice = 'a',
) {
  const selections = normalizeZoneBranchSelections(zone.branchSelections);
  const entries = Object.entries(selections ?? {});
  if (entries.length === 0) {
    return true;
  }

  return entries.every(([splitId, branch]) => (actualBranches[splitId] ?? selectedBranch) === branch);
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
  return `Zone ${index + 1}`;
}

export function createTrackZones(
  lengthMeters: number,
  zoneBoundaryMeters: number[] = [],
  _zoneTypes: TrackZone['type'][] = [],
  _restAfterSeconds = 1,
  branchSelections?: TrackZoneBranchSelections,
  zoneIdPrefix = 'pedal-zone',
  zoneNameOffset = 0,
): TrackZone[] {
  const cleanBoundaries = sortedUniqueBoundaries(zoneBoundaryMeters, lengthMeters);
  const zones: TrackZone[] = [];
  const normalizedBranchSelections = normalizeZoneBranchSelections(branchSelections);

  for (let index = 0; index < cleanBoundaries.length - 1; index += 2) {
    const startMeter = cleanBoundaries[index];
    const endMeter = cleanBoundaries[index + 1];
    if (endMeter - startMeter < 3) {
      continue;
    }

    zones.push({
      id: `${zoneIdPrefix}-${zones.length + 1}`,
      name: defaultPedalZoneName(zoneNameOffset + zones.length),
      startMeter,
      endMeter,
      type: 'pedal',
      restAfterSeconds: _restAfterSeconds,
      ...(normalizedBranchSelections ? { branchSelections: normalizedBranchSelections } : {}),
    });
  }

  return zones;
}

function normalizeZoneBoundarySets(
  centerline: TrackPoint[],
  splitSections: TrackSplitSection[],
  boundarySets: TrackZoneBoundarySet[] = [],
  fallbackBoundaryMeters: number[] = [],
) {
  const fallbackSelections = splitSections.length > 0
    ? splitBranchSelectionsForChoice(splitSections, 'a')
    : undefined;
  const rawSets = boundarySets.length > 0
    ? boundarySets
    : [{
      id: zoneBoundarySetIdForSelections(fallbackSelections),
      name: zoneBoundarySetNameForSelections(splitSections, fallbackSelections),
      ...(fallbackSelections ? { branchSelections: fallbackSelections } : {}),
      boundaryMeters: fallbackBoundaryMeters,
    }];

  const normalized = rawSets.map((set) => {
    const branchSelections = normalizeZoneBranchSelections(set.branchSelections);
    const route = routeWithSplitBranchSelections(centerline, splitSections, branchSelections);
    const lengthMeters = routeLengthMeters(route);
    return createZoneBoundarySet(
      branchSelections,
      Array.isArray(set.boundaryMeters) ? set.boundaryMeters : [],
      splitSections,
      lengthMeters,
    );
  });
  const uniqueById = new Map<string, TrackZoneBoundarySet>();
  normalized.forEach((set) => {
    uniqueById.set(set.id, set);
  });

  return Array.from(uniqueById.values()).sort((left, right) => {
    if (left.id === defaultZoneBoundarySetId) {
      return -1;
    }
    if (right.id === defaultZoneBoundarySetId) {
      return 1;
    }
    return left.name.localeCompare(right.name);
  });
}

export function createTrackZonesForBoundarySets(
  centerline: TrackPoint[],
  splitSections: TrackSplitSection[] = [],
  boundarySets: TrackZoneBoundarySet[] = [],
  restAfterSeconds = 1,
) {
  const normalizedSets = normalizeZoneBoundarySets(centerline, splitSections, boundarySets);
  let zoneOffset = 0;

  return normalizedSets.flatMap((set) => {
    const route = routeWithSplitBranchSelections(centerline, splitSections, set.branchSelections);
    const zones = createTrackZones(
      routeLengthMeters(route),
      set.boundaryMeters,
      [],
      restAfterSeconds,
      set.branchSelections,
      set.id.replace(/[^a-z0-9-]+/gi, '-'),
      zoneOffset,
    );
    zoneOffset += zones.length;
    return zones;
  });
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

export function createTrackRouteVariant(
  track: TrackRecord,
  variantId: TrackRouteVariantId,
  points: TrackPoint[],
  restAfterSeconds: number,
  zoneBoundaryMeters: number[] = [],
  splitSections: TrackSplitSection[] = [],
  zoneTypes: TrackZone['type'][] = [],
  zoneBoundarySets: TrackZoneBoundarySet[] = [],
): TrackRouteVariant {
  const centerline = points.map(normalizePoint);
  const normalizedSplitSections = splitSections.map(normalizeSplitSection);
  const measurableRoute = routeWithDefaultSplitBranches(centerline, normalizedSplitSections);
  const distances = cumulativeMeters(measurableRoute);
  const lengthMeters = Math.max(1, distances[distances.length - 1] ?? track.lengthMeters);
  const normalizedZoneBoundarySets = normalizeZoneBoundarySets(
    centerline,
    normalizedSplitSections,
    zoneBoundarySets,
    zoneBoundaryMeters,
  );
  const primaryBoundarySet = normalizedZoneBoundarySets[0];
  const cleanBoundaries = primaryBoundarySet?.boundaryMeters ?? sortedUniqueBoundaries(zoneBoundaryMeters, lengthMeters);
  const zones = normalizedZoneBoundarySets.length > 0
    ? createTrackZonesForBoundarySets(centerline, normalizedSplitSections, normalizedZoneBoundarySets, restAfterSeconds)
    : createTrackZones(lengthMeters, cleanBoundaries, zoneTypes, restAfterSeconds);

  return {
    id: variantId,
    name: routeVariantLabels[variantId],
    restAfterSeconds,
    lengthMeters: Math.round(lengthMeters),
    centerline,
    startGate: centerline[0],
    finishLine: centerline[centerline.length - 1],
    zoneBoundaryMeters: cleanBoundaries,
    zoneBoundarySets: normalizedZoneBoundarySets,
    zones,
    splitSections: normalizedSplitSections,
  };
}

function routeVariantFromTopLevelMapping(
  mapping: UserTrackMapping,
  variantId: TrackRouteVariantId = 'amateur',
): TrackRouteVariant {
  const splitSections = mapping.splitSections ?? [];
  const zoneBoundaryMeters = Array.isArray(mapping.zoneBoundaryMeters)
    ? sortedUniqueBoundaries(mapping.zoneBoundaryMeters, mapping.lengthMeters)
    : mapping.zones
      .filter(isTrackZone)
      .flatMap((zone) => [zone.startMeter, zone.endMeter]);
  const zoneBoundarySets = normalizeZoneBoundarySets(
    mapping.centerline,
    splitSections,
    Array.isArray(mapping.zoneBoundarySets) ? mapping.zoneBoundarySets : [],
    zoneBoundaryMeters,
  );

  return {
    id: variantId,
    name: routeVariantLabels[variantId],
    restAfterSeconds: mapping.restAfterSeconds,
    lengthMeters: mapping.lengthMeters,
    centerline: mapping.centerline,
    startGate: mapping.startGate,
    finishLine: mapping.finishLine,
    zoneBoundaryMeters: zoneBoundarySets[0]?.boundaryMeters ?? zoneBoundaryMeters,
    zoneBoundarySets,
    zones: createTrackZonesForBoundarySets(mapping.centerline, splitSections, zoneBoundarySets, mapping.restAfterSeconds),
    splitSections,
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
  const zoneBoundarySets = normalizeZoneBoundarySets(
    centerline,
    splitSections,
    Array.isArray(variant.zoneBoundarySets) ? variant.zoneBoundarySets : [],
    zoneBoundaryMeters,
  );

  return {
    id: variantId,
    name: variant.name || routeVariantLabels[variantId],
    restAfterSeconds,
    lengthMeters,
    centerline,
    startGate: variant.startGate ? normalizePoint(variant.startGate) : centerline[0],
    finishLine: variant.finishLine ? normalizePoint(variant.finishLine) : centerline[centerline.length - 1],
    zoneBoundaryMeters: zoneBoundarySets[0]?.boundaryMeters ?? zoneBoundaryMeters,
    zoneBoundarySets,
    zones: createTrackZonesForBoundarySets(centerline, splitSections, zoneBoundarySets, restAfterSeconds),
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

export function zoneBoundarySetsFromRouteVariant(variant: TrackRouteVariant) {
  return normalizeZoneBoundarySets(
    variant.centerline,
    variant.splitSections ?? [],
    Array.isArray(variant.zoneBoundarySets) ? variant.zoneBoundarySets : [],
    Array.isArray(variant.zoneBoundaryMeters)
      ? variant.zoneBoundaryMeters
      : variant.zones
        .filter(isTrackZone)
        .flatMap((zone) => [zone.startMeter, zone.endMeter]),
  );
}

export function zoneBoundariesFromRouteVariant(
  variant: TrackRouteVariant,
  branchSelections?: TrackZoneBranchSelections,
) {
  const setId = zoneBoundarySetIdForSelections(
    branchSelections ?? (variant.splitSections?.length ? splitBranchSelectionsForChoice(variant.splitSections, 'a') : undefined),
  );
  const boundarySet = zoneBoundarySetsFromRouteVariant(variant).find((set) => set.id === setId);
  if (boundarySet) {
    return boundarySet.boundaryMeters;
  }

  if (Array.isArray(variant.zoneBoundaryMeters)) {
    return variant.zoneBoundaryMeters;
  }

  return variant.zones
    .filter(isTrackZone)
    .flatMap((zone) => [zone.startMeter, zone.endMeter])
    .filter((meter) => meter >= 0 && meter <= variant.lengthMeters);
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
  zoneBoundarySets: TrackZoneBoundarySet[] = [],
  raceViewMode: TrackRaceViewMode = 'satellite',
): UserTrackMapping {
  const primaryVariant = createTrackRouteVariant(
    track,
    routeVariantId ?? 'amateur',
    points,
    restAfterSeconds,
    zoneBoundaryMeters,
    splitSections,
    zoneTypes,
    zoneBoundarySets,
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
    zoneBoundarySets: primaryVariant.zoneBoundarySets,
    zones: primaryVariant.zones,
    splitSections: primaryVariant.splitSections,
    raceViewMode,
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

export function applyTrackRouteVariant(track: TrackRecord, route: TrackRouteVariant): TrackRecord {
  const normalized = normalizeRouteVariant(route);
  return {
    ...track,
    lengthMeters: normalized.lengthMeters,
    outline: normalized.centerline,
    centerline: normalized.centerline,
    startGate: normalized.startGate,
    finishLine: normalized.finishLine,
    routeStatus: 'user-mapped',
    zones: normalized.zones,
    splitSections: normalized.splitSections ?? [],
    activeRouteVariantId: normalized.id,
    activeRouteVariantName: normalized.name,
  };
}

export function readStoredTrackMappings(): StoredTrackMappings {
  try {
    const stored = window.localStorage.getItem(trackMappingStorageKey);
    if (!stored) {
      return {};
    }

    const parsed = JSON.parse(stored) as StoredTrackMappings;
    return parsed && typeof parsed === 'object'
      ? Object.fromEntries(Object.entries(parsed).map(([trackId, mapping]) => [
        trackId,
        withoutLegacyGameRoute(mapping),
      ]))
      : {};
  } catch {
    return {};
  }
}

export function writeStoredTrackMappings(mappings: StoredTrackMappings) {
  const standardMappings = Object.fromEntries(Object.entries(mappings).map(([trackId, mapping]) => [
    trackId,
    withoutLegacyGameRoute(mapping),
  ]));
  return safeSetLocalStorage(trackMappingStorageKey, JSON.stringify(standardMappings));
}

export function zoneBoundariesFromMapping(mapping: UserTrackMapping) {
  if (Array.isArray(mapping.zoneBoundaryMeters)) {
    return mapping.zoneBoundaryMeters;
  }

  return mapping.zones
    .filter(isTrackZone)
    .flatMap((zone) => [zone.startMeter, zone.endMeter])
    .filter((meter) => meter >= 0 && meter <= mapping.lengthMeters);
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
  const parsed = JSON.parse(value) as Partial<UserTrackMapping> & { gameRoute?: unknown };

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

  const { gameRoute: _legacyGameRoute, ...standardMapping } = parsed;
  return {
    ...standardMapping,
    raceViewMode: parsed.raceViewMode === '3d' ? '3d' : 'satellite',
    splitSections: Array.isArray(parsed.splitSections)
      ? parsed.splitSections.map((section) => normalizeSplitSection(section))
      : [],
    routeVariants: Array.isArray(parsed.routeVariants)
      ? routeVariantsFromMapping(parsed as UserTrackMapping)
      : undefined,
  } as UserTrackMapping;
}
