import type {
  LeaderboardEntry,
  MultiplayerRaceConfiguration,
  MultiplayerRaceIntervalsConfiguration,
  MultiplayerRaceSetup,
  MultiplayerRaceView,
  MultiplayerStraightSprintConfiguration,
  RacePresentationViewport,
  TrackPoint,
  TrackRecord,
  TrackRouteVariant,
  TrackSplitSection,
  TrackZone,
  TrackZoneBoundarySet,
  TrackZoneBranchSelections,
} from '../types';
import { normalizeRacePresentationViewport } from './racePresentation';
import { straightSprintDistanceOptions, straightSprintFeetToMeters } from './straightSprint';
import { routeLengthWithDefaultSplitBranches } from './trackMapping';

export const multiplayerRaceSetupVersion = 1 as const;

const maxRevision = Number.MAX_SAFE_INTEGER;
const maxTrackPoints = 10_000;
const maxZones = 512;
const maxBoundarySets = 128;
const maxSplitSections = 64;
const maxLeaderboardEntries = 100;
const maxDistanceMeters = 10_000_000;
const validSprintDistances = new Set<number>(straightSprintDistanceOptions);

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as UnknownRecord;
}

function owns(value: UnknownRecord, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function text(value: unknown, maxLength: number, required = true) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if ((required && !normalized) || normalized.length > maxLength || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    return null;
  }
  return normalized;
}

function finite(value: unknown, minimum: number, maximum: number) {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum
    ? value
    : null;
}

function integer(value: unknown, minimum: number, maximum: number) {
  const number = finite(value, minimum, maximum);
  return number != null && Number.isInteger(number) ? number : null;
}

function rounded(value: number, decimalPlaces: number) {
  const scale = 10 ** decimalPlaces;
  return Math.round(value * scale) / scale;
}

function point(value: unknown): TrackPoint | null {
  const candidate = record(value);
  if (!candidate) return null;
  const lat = finite(candidate.lat, -90, 90);
  const lng = finite(candidate.lng, -180, 180);
  return lat != null && lng != null
    ? { lat: rounded(lat, 7), lng: rounded(lng, 7) }
    : null;
}

function pointArray(value: unknown, minimumLength = 0): TrackPoint[] | null {
  if (!Array.isArray(value) || value.length < minimumLength || value.length > maxTrackPoints) return null;
  const points = value.map(point);
  return points.every((entry): entry is TrackPoint => entry != null) ? points : null;
}

function numberArray(value: unknown, maximum = maxDistanceMeters): number[] | null {
  if (!Array.isArray(value) || value.length > maxZones * 2) return null;
  const numbers = value.map((entry) => finite(entry, 0, maximum));
  return numbers.every((entry): entry is number => entry != null)
    ? numbers.map((entry) => rounded(entry, 3))
    : null;
}

function branchSelections(value: unknown): TrackZoneBranchSelections | null {
  const candidate = record(value);
  if (!candidate || Object.keys(candidate).length > maxSplitSections) return null;
  const normalized: TrackZoneBranchSelections = {};
  for (const [rawId, choice] of Object.entries(candidate)) {
    const id = text(rawId, 160);
    if (!id || (choice !== 'a' && choice !== 'b')) return null;
    normalized[id] = choice;
  }
  return normalized;
}

function optionalBranchSelections(candidate: UnknownRecord) {
  if (!owns(candidate, 'branchSelections')) return undefined;
  return branchSelections(candidate.branchSelections);
}

function zone(value: unknown): TrackZone | null {
  const candidate = record(value);
  if (!candidate) return null;
  const id = text(candidate.id, 160);
  const name = text(candidate.name, 160);
  const startMeter = finite(candidate.startMeter, 0, maxDistanceMeters);
  const endMeter = finite(candidate.endMeter, 0, maxDistanceMeters);
  const type = candidate.type === 'pedal'
    || candidate.type === 'recovery'
    || candidate.type === 'technical'
    ? candidate.type
    : null;
  const restAfterSeconds = owns(candidate, 'restAfterSeconds')
    ? finite(candidate.restAfterSeconds, 0, 86_400)
    : undefined;
  const selections = optionalBranchSelections(candidate);
  if (
    !id
    || !name
    || startMeter == null
    || endMeter == null
    || endMeter <= startMeter
    || !type
    || restAfterSeconds === null
    || selections === null
  ) return null;
  return {
    id,
    name,
    startMeter: rounded(startMeter, 3),
    endMeter: rounded(endMeter, 3),
    type,
    ...(restAfterSeconds != null ? { restAfterSeconds: rounded(restAfterSeconds, 3) } : {}),
    ...(selections ? { branchSelections: selections } : {}),
  };
}

function zones(value: unknown): TrackZone[] | null {
  if (!Array.isArray(value) || value.length > maxZones) return null;
  const normalized = value.map(zone);
  return normalized.every((entry): entry is TrackZone => entry != null) ? normalized : null;
}

function boundarySet(value: unknown): TrackZoneBoundarySet | null {
  const candidate = record(value);
  if (!candidate) return null;
  const id = text(candidate.id, 160);
  const name = text(candidate.name, 160);
  const boundaryMeters = numberArray(candidate.boundaryMeters);
  const selections = optionalBranchSelections(candidate);
  if (!id || !name || !boundaryMeters || selections === null) return null;
  return {
    id,
    name,
    ...(selections ? { branchSelections: selections } : {}),
    boundaryMeters,
  };
}

function boundarySets(value: unknown): TrackZoneBoundarySet[] | null {
  if (!Array.isArray(value) || value.length > maxBoundarySets) return null;
  const normalized = value.map(boundarySet);
  return normalized.every((entry): entry is TrackZoneBoundarySet => entry != null) ? normalized : null;
}

function splitSection(value: unknown): TrackSplitSection | null {
  const candidate = record(value);
  if (!candidate || !Array.isArray(candidate.branches) || candidate.branches.length !== 2) return null;
  const id = text(candidate.id, 160);
  const name = text(candidate.name, 160);
  const index = integer(candidate.index, 0, maxSplitSections - 1);
  const splitPoint = point(candidate.splitPoint);
  const mergePoint = point(candidate.mergePoint);
  const branches = candidate.branches.map((rawBranch) => {
    const branch = record(rawBranch);
    if (!branch || (branch.id !== 'a' && branch.id !== 'b')) return null;
    const branchName = text(branch.name, 160);
    const points = pointArray(branch.points, 2);
    const lengthMeters = finite(branch.lengthMeters, 0.001, maxDistanceMeters);
    return branchName && points && lengthMeters != null ? {
      id: branch.id,
      name: branchName,
      points,
      lengthMeters: rounded(lengthMeters, 3),
    } : null;
  });
  if (
    !id
    || !name
    || index == null
    || !splitPoint
    || !mergePoint
    || !branches.every((entry) => entry != null)
    || new Set(branches.map((entry) => entry?.id)).size !== 2
  ) return null;
  return { id, name, index, splitPoint, mergePoint, branches: branches as TrackSplitSection['branches'] };
}

function splitSections(value: unknown): TrackSplitSection[] | null {
  if (!Array.isArray(value) || value.length > maxSplitSections) return null;
  const normalized = value.map(splitSection);
  return normalized.every((entry): entry is TrackSplitSection => entry != null) ? normalized : null;
}

function routeVariant(value: unknown): TrackRouteVariant | null {
  const candidate = record(value);
  if (!candidate || (candidate.id !== 'amateur' && candidate.id !== 'pro')) return null;
  const name = text(candidate.name, 160);
  const restAfterSeconds = finite(candidate.restAfterSeconds, 0, 86_400);
  const lengthMeters = finite(candidate.lengthMeters, 0.001, maxDistanceMeters);
  const centerline = pointArray(candidate.centerline, 2);
  const startGate = point(candidate.startGate);
  const finishLine = point(candidate.finishLine);
  const normalizedZones = zones(candidate.zones);
  const zoneBoundaryMeters = owns(candidate, 'zoneBoundaryMeters')
    ? numberArray(candidate.zoneBoundaryMeters)
    : undefined;
  const zoneBoundarySets = owns(candidate, 'zoneBoundarySets')
    ? boundarySets(candidate.zoneBoundarySets)
    : undefined;
  const normalizedSplitSections = owns(candidate, 'splitSections')
    ? splitSections(candidate.splitSections)
    : undefined;
  if (
    !name
    || restAfterSeconds == null
    || lengthMeters == null
    || !centerline
    || !startGate
    || !finishLine
    || !normalizedZones
    || zoneBoundaryMeters === null
    || zoneBoundarySets === null
    || normalizedSplitSections === null
  ) return null;
  return {
    id: candidate.id,
    name,
    restAfterSeconds: rounded(restAfterSeconds, 3),
    lengthMeters: rounded(lengthMeters, 3),
    centerline,
    startGate,
    finishLine,
    ...(zoneBoundaryMeters ? { zoneBoundaryMeters } : {}),
    ...(zoneBoundarySets ? { zoneBoundarySets } : {}),
    zones: normalizedZones,
    ...(normalizedSplitSections ? { splitSections: normalizedSplitSections } : {}),
  };
}

function routeVariants(value: unknown): TrackRouteVariant[] | null {
  if (!Array.isArray(value) || value.length > 2) return null;
  const normalized = value.map(routeVariant);
  if (!normalized.every((entry): entry is TrackRouteVariant => entry != null)) return null;
  if (new Set(normalized.map((entry) => entry.id)).size !== normalized.length) return null;
  return normalized.sort((left, right) => left.id.localeCompare(right.id));
}

function leaderboardEntry(value: unknown): LeaderboardEntry | null {
  const candidate = record(value);
  if (!candidate) return null;
  const rider = text(candidate.rider, 160);
  const unit = text(candidate.unit, 32);
  const date = text(candidate.date, 64);
  const score = finite(candidate.value, -maxDistanceMeters, maxDistanceMeters);
  const photoUrl = owns(candidate, 'photoUrl') ? text(candidate.photoUrl, 2_048, false) : undefined;
  if (!rider || !unit || !date || score == null || photoUrl === null) return null;
  return {
    rider,
    ...(photoUrl ? { photoUrl } : {}),
    value: score,
    unit,
    date,
  };
}

function leaderboard(value: unknown): LeaderboardEntry[] | null {
  if (!Array.isArray(value) || value.length > maxLeaderboardEntries) return null;
  const normalized = value.map(leaderboardEntry);
  return normalized.every((entry): entry is LeaderboardEntry => entry != null) ? normalized : null;
}

function optionalTextFields(source: UnknownRecord, target: UnknownRecord) {
  const fields = [
    ['sourceTrackId', 240], ['providerId', 240], ['lastVerifiedAt', 80], ['address', 500],
    ['city', 160], ['county', 160], ['district', 160], ['postalCode', 40],
    ['coordinateSource', 160], ['coordinateAccuracy', 160], ['websiteUrl', 2_048],
    ['facebookUrl', 2_048], ['instagramUrl', 2_048], ['tiktokUrl', 2_048],
    ['youtubeUrl', 2_048], ['phoneNumber', 80], ['federationName', 240], ['federationUrl', 2_048],
    ['activeRouteVariantName', 160],
  ] as const;
  for (const [key, maximum] of fields) {
    if (!owns(source, key)) continue;
    const normalized = text(source[key], maximum, false);
    if (normalized === null) return false;
    if (normalized) target[key] = normalized;
  }
  return true;
}

/**
 * Builds the bounded geometry snapshot used over the multiplayer wire. Unknown
 * provider fields are deliberately excluded; they are not needed to run a race.
 */
export function sanitizeMultiplayerTrackRecord(value: unknown): TrackRecord | null {
  const candidate = record(value);
  if (!candidate) return null;
  const id = text(candidate.id, 240);
  const name = text(candidate.name, 240);
  const country = text(candidate.country, 160);
  const countryCode = text(candidate.countryCode, 16);
  const state = text(candidate.state, 160);
  const region = text(candidate.region, 160);
  const source = text(candidate.source, 240);
  const sourceUrl = text(candidate.sourceUrl, 2_048, false);
  const lengthMeters = finite(candidate.lengthMeters, 0.001, maxDistanceMeters);
  const elevationMeters = finite(candidate.elevationMeters, -1_000, 20_000);
  const surface = text(candidate.surface, 240);
  const outline = pointArray(candidate.outline);
  const centerline = owns(candidate, 'centerline') ? pointArray(candidate.centerline, 2) : undefined;
  const startGate = owns(candidate, 'startGate') ? point(candidate.startGate) : undefined;
  const finishLine = owns(candidate, 'finishLine') ? point(candidate.finishLine) : undefined;
  const normalizedZones = zones(candidate.zones);
  const normalizedSplitSections = owns(candidate, 'splitSections')
    ? splitSections(candidate.splitSections)
    : undefined;
  const normalizedRouteVariants = owns(candidate, 'routeVariants')
    ? routeVariants(candidate.routeVariants)
    : undefined;
  const rpm = record(candidate.leaderboards) ? leaderboard(record(candidate.leaderboards)?.rpm) : null;
  const speed = record(candidate.leaderboards) ? leaderboard(record(candidate.leaderboards)?.speed) : null;
  if (
    !id || !name || !country || !countryCode || !state || !region || !source || sourceUrl === null
    || lengthMeters == null || elevationMeters == null || !surface || !outline || !normalizedZones
    || centerline === null || startGate === null || finishLine === null
    || normalizedSplitSections === null || normalizedRouteVariants === null || !rpm || !speed
    || (!centerline && (!normalizedRouteVariants || normalizedRouteVariants.length === 0))
  ) return null;

  const normalized: TrackRecord = {
    id,
    name,
    country,
    countryCode,
    state,
    region,
    source,
    sourceUrl: sourceUrl ?? '',
    lengthMeters: rounded(lengthMeters, 3),
    elevationMeters: rounded(elevationMeters, 3),
    surface,
    outline,
    ...(centerline ? { centerline } : {}),
    ...(startGate ? { startGate } : {}),
    ...(finishLine ? { finishLine } : {}),
    ...(normalizedSplitSections ? { splitSections: normalizedSplitSections } : {}),
    ...(normalizedRouteVariants ? { routeVariants: normalizedRouteVariants } : {}),
    zones: normalizedZones,
    leaderboards: { rpm, speed },
  };
  if (!optionalTextFields(candidate, normalized as UnknownRecord)) return null;

  if (owns(candidate, 'latitude')) {
    const latitude = finite(candidate.latitude, -90, 90);
    if (latitude == null) return null;
    normalized.latitude = rounded(latitude, 7);
  }
  if (owns(candidate, 'longitude')) {
    const longitude = finite(candidate.longitude, -180, 180);
    if (longitude == null) return null;
    normalized.longitude = rounded(longitude, 7);
  }
  if ((owns(candidate, 'latitude') && !owns(candidate, 'longitude'))
    || (!owns(candidate, 'latitude') && owns(candidate, 'longitude'))) return null;

  const sourceTypes = new Set([
    'sanctioning-body-track-directory', 'national-federation-track-directory',
    'national-federation-club-directory', 'governing-body-reference', 'community-map', 'manual',
  ]);
  if (owns(candidate, 'sourceType')) {
    if (!sourceTypes.has(String(candidate.sourceType))) return null;
    normalized.sourceType = candidate.sourceType as TrackRecord['sourceType'];
  }
  const verificationStatuses = new Set([
    'official-track-directory', 'federation-directory', 'reference-only',
    'supplemental', 'unverified',
  ]);
  if (owns(candidate, 'verificationStatus')) {
    if (!verificationStatuses.has(String(candidate.verificationStatus))) return null;
    normalized.verificationStatus = candidate.verificationStatus as TrackRecord['verificationStatus'];
  }
  const addressStatuses = new Set([
    'provider-address', 'provider-approximate', 'reverse-geocoded', 'coordinates-only', 'unverified',
  ]);
  if (owns(candidate, 'addressStatus')) {
    if (!addressStatuses.has(String(candidate.addressStatus))) return null;
    normalized.addressStatus = candidate.addressStatus as TrackRecord['addressStatus'];
  }
  if (owns(candidate, 'routeStatus')) {
    if (
      candidate.routeStatus !== 'verified'
      && candidate.routeStatus !== 'estimated'
      && candidate.routeStatus !== 'locator-only'
      && candidate.routeStatus !== 'user-mapped'
    ) return null;
    normalized.routeStatus = candidate.routeStatus;
  }
  if (owns(candidate, 'activeRouteVariantId')) {
    if (candidate.activeRouteVariantId !== 'amateur' && candidate.activeRouteVariantId !== 'pro') return null;
    if (!normalizedRouteVariants?.some((variant) => variant.id === candidate.activeRouteVariantId)) return null;
    normalized.activeRouteVariantId = candidate.activeRouteVariantId;
  }

  // Provider sourceRecord can be arbitrarily large/private and cannot affect race playback.
  return normalized;
}

export function sanitizeMultiplayerRaceView(value: unknown): MultiplayerRaceView | null {
  const candidate = record(value);
  if (!candidate) return null;
  const mode = candidate.mode === 'satellite' || candidate.mode === '3d' || candidate.mode === 'game'
    ? candidate.mode
    : null;
  if (!mode) return null;
  if (mode === 'game') {
    return owns(candidate, 'camera') || owns(candidate, 'riderOverlay') ? null : { mode };
  }

  let camera: MultiplayerRaceView['camera'];
  if (owns(candidate, 'camera')) {
    const rawCamera = record(candidate.camera);
    if (!rawCamera) return null;
    const angle = finite(rawCamera.angle, 0, 67);
    const heading = finite(rawCamera.heading, 0, 359.9999999);
    const center = owns(rawCamera, 'center') ? point(rawCamera.center) : undefined;
    const zoom = owns(rawCamera, 'zoom') ? finite(rawCamera.zoom, 0, 30) : undefined;
    const referenceViewport = owns(rawCamera, 'referenceViewport')
      ? normalizeRacePresentationViewport(rawCamera.referenceViewport)
      : undefined;
    if (angle == null || heading == null || center === null || zoom === null || referenceViewport === null) {
      return null;
    }
    camera = {
      angle: rounded(angle, 4),
      heading: rounded(heading, 4),
      ...(center ? { center } : {}),
      ...(zoom != null ? { zoom: rounded(zoom, 4) } : {}),
      ...(referenceViewport ? { referenceViewport } : {}),
    };
  }

  let riderOverlay: MultiplayerRaceView['riderOverlay'];
  if (owns(candidate, 'riderOverlay')) {
    const overlay = record(candidate.riderOverlay);
    if (!overlay) return null;
    const xPct = finite(overlay.xPct, 0, 1);
    const yPct = finite(overlay.yPct, 0, 1);
    const width = finite(overlay.width, 320, 1_800);
    const height = finite(overlay.height, 190, 900);
    const referenceViewport = owns(overlay, 'referenceViewport')
      ? normalizeRacePresentationViewport(overlay.referenceViewport)
      : undefined;
    if (
      xPct == null || yPct == null || width == null || height == null
      || typeof overlay.locked !== 'boolean' || referenceViewport === null
    ) return null;
    riderOverlay = {
      xPct: rounded(xPct, 6),
      yPct: rounded(yPct, 6),
      width: rounded(width, 2),
      height: rounded(height, 2),
      locked: overlay.locked,
      ...(referenceViewport ? { referenceViewport } : {}),
    };
  }

  return {
    mode,
    ...(camera ? { camera } : {}),
    ...(riderOverlay ? { riderOverlay } : {}),
  };
}

function sanitizeRaceConfiguration(candidate: UnknownRecord): MultiplayerRaceIntervalsConfiguration | null {
  const trackId = text(candidate.trackId, 240);
  const trackName = text(candidate.trackName, 240);
  const lapCount = integer(candidate.lapCount, 1, 20);
  const routeVariantId = candidate.routeVariantId == null
    ? null
    : candidate.routeVariantId === 'amateur' || candidate.routeVariantId === 'pro'
      ? candidate.routeVariantId
      : false;
  const raceView = sanitizeMultiplayerRaceView(candidate.raceView);
  const trackRecord = owns(candidate, 'trackRecord')
    ? sanitizeMultiplayerTrackRecord(candidate.trackRecord)
    : undefined;
  if (
    !trackId || !trackName || lapCount == null || routeVariantId === false || !raceView
    || !trackRecord || trackRecord.routeStatus !== 'user-mapped'
    || (owns(candidate, 'section') && candidate.section != null)
    || (owns(candidate, 'startSection') && candidate.startSection != null)
    || (trackRecord && (trackRecord.id !== trackId || trackRecord.name !== trackName))
    || (routeVariantId && trackRecord
      && !trackRecord.routeVariants?.some((variant) => variant.id === routeVariantId))
  ) return null;
  return {
    activityType: 'bmx-race',
    trackId,
    trackName,
    ...(trackRecord ? { trackRecord } : {}),
    raceView,
    lapCount,
    routeVariantId,
  };
}

function sanitizeSprintConfiguration(candidate: UnknownRecord): MultiplayerStraightSprintConfiguration | null {
  const courseId = text(candidate.courseId, 240);
  const courseName = text(candidate.courseName, 240);
  const courseSource = candidate.courseSource === 'saved-map' || candidate.courseSource === 'catalog-track'
    ? candidate.courseSource
    : null;
  const distanceFeet = integer(candidate.distanceFeet, 1, 1_500);
  const airSetting = integer(candidate.airSetting, 1, 10);
  const raceView = sanitizeMultiplayerRaceView(candidate.raceView);
  const trackRecord = owns(candidate, 'trackRecord')
    ? sanitizeMultiplayerTrackRecord(candidate.trackRecord)
    : undefined;
  const route = trackRecord?.centerline;
  const mappedRouteLengthMeters = route && route.length >= 2
    ? routeLengthWithDefaultSplitBranches(route, trackRecord?.splitSections ?? [])
    : 0;
  if (
    !courseId || !courseName || !courseSource || distanceFeet == null
    || !validSprintDistances.has(distanceFeet) || airSetting == null || !raceView
    || !trackRecord || trackRecord.routeStatus !== 'user-mapped'
    || mappedRouteLengthMeters + 0.5 < straightSprintFeetToMeters(distanceFeet)
    || (trackRecord && (trackRecord.id !== courseId || trackRecord.name !== courseName))
  ) return null;
  return {
    activityType: 'straight-sprint',
    courseId,
    courseName,
    courseSource,
    trackRecord,
    raceView,
    distanceFeet,
    airSetting,
  };
}

export function sanitizeMultiplayerRaceConfiguration(value: unknown): MultiplayerRaceConfiguration | null {
  const candidate = record(value);
  if (!candidate) return null;
  if (candidate.activityType === 'bmx-race') return sanitizeRaceConfiguration(candidate);
  if (candidate.activityType === 'straight-sprint') return sanitizeSprintConfiguration(candidate);
  return null;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as UnknownRecord).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson((value as UnknownRecord)[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fnv1a64(value: string) {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

export function multiplayerRaceConfigurationId(value: unknown) {
  const configuration = sanitizeMultiplayerRaceConfiguration(value);
  if (!configuration) return null;
  const prefix = configuration.activityType === 'bmx-race' ? 'race' : 'sprint';
  return `${prefix}-${fnv1a64(stableJson(configuration))}`;
}

/** Exact content key used when matching racers; revision is intentionally excluded. */
export function multiplayerRaceSetupCompatibilityKey(value: unknown) {
  const candidate = record(value);
  const configuration = candidate && owns(candidate, 'configuration')
    ? canonicalizeMultiplayerRaceSetup(candidate)?.configuration ?? null
    : sanitizeMultiplayerRaceConfiguration(value);
  return configuration
    ? `tracklab-multiplayer-race:v${multiplayerRaceSetupVersion}:${stableJson(configuration)}`
    : null;
}

/** Canonicalize untrusted network/storage input and derive a trustworthy configuration id. */
export function canonicalizeMultiplayerRaceSetup(value: unknown): MultiplayerRaceSetup | null {
  const candidate = record(value);
  if (!candidate || candidate.version !== multiplayerRaceSetupVersion) return null;
  const revision = integer(candidate.revision, 1, maxRevision);
  const configuration = sanitizeMultiplayerRaceConfiguration(candidate.configuration);
  const configurationId = configuration ? multiplayerRaceConfigurationId(configuration) : null;
  if (revision == null || !configuration || !configurationId) return null;
  return {
    version: multiplayerRaceSetupVersion,
    revision,
    configurationId,
    configuration,
  };
}

/** Boundary-oriented alias used by REST/WebSocket consumers. */
export function sanitizeMultiplayerRaceSetup(value: unknown) {
  return canonicalizeMultiplayerRaceSetup(value);
}

function raceViewLabel(view: MultiplayerRaceView) {
  if (view.mode === 'game') return 'Game Arena';
  if (view.mode === '3d') return '3D Terrain';
  return 'Satellite';
}

export function multiplayerRaceSetupLabel(value: unknown) {
  const setup = canonicalizeMultiplayerRaceSetup(value);
  if (!setup) return '';
  const configuration = setup.configuration;
  if (configuration.activityType === 'straight-sprint') {
    return `${configuration.courseName} · ${configuration.distanceFeet} ft · Air ${configuration.airSetting} · ${raceViewLabel(configuration.raceView)}`;
  }
  const details = [
    configuration.trackName,
    configuration.routeVariantId === 'pro'
      ? 'Pro Track'
      : configuration.routeVariantId === 'amateur'
        ? 'Amateur Track'
        : null,
    `${configuration.lapCount} ${configuration.lapCount === 1 ? 'lap' : 'laps'}`,
    raceViewLabel(configuration.raceView),
  ].filter((entry): entry is string => Boolean(entry));
  return details.join(' · ');
}

/** Helpful when applying an incoming setup without branching on field names. */
export function multiplayerRaceSetupTrackRecord(value: unknown) {
  return canonicalizeMultiplayerRaceSetup(value)?.configuration.trackRecord ?? null;
}

export function multiplayerRaceSetupTrackId(value: unknown) {
  const configuration = canonicalizeMultiplayerRaceSetup(value)?.configuration;
  if (!configuration) return null;
  return configuration.activityType === 'bmx-race' ? configuration.trackId : configuration.courseId;
}

export function multiplayerRaceSetupActivity(value: unknown) {
  return canonicalizeMultiplayerRaceSetup(value)?.configuration.activityType ?? null;
}

// Retain this type-only use close to its runtime normalizer for discoverability.
export type MultiplayerRaceSetupViewport = RacePresentationViewport;
