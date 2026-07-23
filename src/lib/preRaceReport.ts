import type {
  GhostLap,
  PlayerSlot,
  TrackRecord,
} from '../types';

export type PreRaceSource = {
  title: string;
  url: string;
  kind: 'track' | 'research' | 'weather';
};

export type PreRaceWeather = {
  available: boolean;
  provider?: string;
  observedAt?: string;
  summary?: string;
  temperatureC?: number;
  feelsLikeC?: number;
  humidityPercent?: number;
  windKph?: number;
  windDirection?: string;
  gustKph?: number;
  precipitationMm?: number;
};

export type PreRaceRiderContext = {
  playerId: PlayerSlot['id'];
  name: string;
  colorName: PlayerSlot['colorName'];
  personalBestMs?: number;
  personalThirtyFootMs?: number;
  personalBestAt?: string;
};

export type PreRaceTrackContext = {
  id: string;
  name: string;
  country: string;
  countryCode: string;
  state: string;
  region: string;
  city?: string;
  county?: string;
  district?: string;
  postalCode?: string;
  address?: string;
  addressStatus?: TrackRecord['addressStatus'];
  latitude?: number;
  longitude?: number;
  coordinateSource?: string;
  coordinateAccuracy?: string;
  surface?: string;
  lengthMeters: number;
  elevationMeters?: number;
  routeStatus?: TrackRecord['routeStatus'];
  routeVariantId?: TrackRecord['activeRouteVariantId'];
  routeVariantName?: string;
  lapCount: number;
  source: string;
  sourceUrl?: string;
  sourceType?: TrackRecord['sourceType'];
  websiteUrl?: string;
  facebookUrl?: string;
  instagramUrl?: string;
  verificationStatus?: TrackRecord['verificationStatus'];
  lastVerifiedAt?: string;
  outlinePointCount: number;
  centerlinePointCount: number;
  routeVariantCount: number;
  zoneCount: number;
  zoneNames: string[];
  pedalZoneCount: number;
  pedalMeters: number;
  recoveryZoneCount: number;
  recoveryMeters: number;
  technicalZoneCount: number;
  technicalMeters: number;
  splitCount: number;
  splitNames: string[];
  branchNames: string[];
  hasProSet: boolean;
  riders: PreRaceRiderContext[];
  knownTrackBestMs?: number;
  knownTrackBestRider?: string;
  knownTrackBestAt?: string;
};

export type PreRaceReport = {
  line: string;
  source: 'ai' | 'local';
  generatedAt: string;
  variableCount: number;
  supportedVariableCount: number;
  sources: PreRaceSource[];
  weather: PreRaceWeather;
};

function usefulText(value: unknown) {
  const text = String(value ?? '').trim();
  return text && !/^(?:unknown|n\/a|not available|unspecified)$/i.test(text)
    ? text
    : undefined;
}

function finite(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function normalizedRiderName(value: string) {
  return value.trim().toLocaleLowerCase();
}

function bestGhostForRider(ghosts: GhostLap[], riderName: string) {
  const normalizedName = normalizedRiderName(riderName);
  return ghosts
    .filter((ghost) => (
      ghost.source === 'personal'
      && normalizedRiderName(ghost.riderName) === normalizedName
    ))
    .sort((left, right) => left.finishTimeMs - right.finishTimeMs)[0];
}

function routeVariantName(track: TrackRecord) {
  if (usefulText(track.activeRouteVariantName)) {
    return usefulText(track.activeRouteVariantName);
  }
  if (track.activeRouteVariantId === 'pro') {
    return 'Pro route';
  }
  if (track.activeRouteVariantId === 'amateur') {
    return 'Amateur route';
  }
  return undefined;
}

export function buildPreRaceTrackContext(
  track: TrackRecord,
  players: PlayerSlot[],
  ghosts: GhostLap[],
  lapCount: number,
): PreRaceTrackContext {
  const safeLapCount = Math.max(1, Math.min(20, Math.round(finite(lapCount) ?? 1)));
  const pedalZones = track.zones.filter((zone) => zone.type === 'pedal');
  const recoveryZones = track.zones.filter((zone) => zone.type === 'recovery');
  const technicalZones = track.zones.filter((zone) => zone.type === 'technical');
  const trackBest = [...ghosts].sort((left, right) => left.finishTimeMs - right.finishTimeMs)[0];
  const riders = players.slice(0, 4).map((player) => {
    const personalBest = bestGhostForRider(ghosts, player.name);
    return {
      playerId: player.id,
      name: player.name,
      colorName: player.colorName,
      ...(personalBest ? {
        personalBestMs: personalBest.finishTimeMs,
        ...(personalBest.thirtyFootTimeMs != null
          ? { personalThirtyFootMs: personalBest.thirtyFootTimeMs }
          : {}),
        personalBestAt: new Date(personalBest.savedAt).toISOString(),
      } : {}),
    };
  });

  return {
    id: track.id,
    name: track.name,
    country: track.country,
    countryCode: track.countryCode,
    state: track.state,
    region: track.region,
    ...(usefulText(track.city) ? { city: usefulText(track.city) } : {}),
    ...(usefulText(track.county) ? { county: usefulText(track.county) } : {}),
    ...(usefulText(track.district) ? { district: usefulText(track.district) } : {}),
    ...(usefulText(track.postalCode) ? { postalCode: usefulText(track.postalCode) } : {}),
    ...(usefulText(track.address) ? { address: usefulText(track.address) } : {}),
    ...(track.addressStatus ? { addressStatus: track.addressStatus } : {}),
    ...(finite(track.latitude) != null ? { latitude: finite(track.latitude) } : {}),
    ...(finite(track.longitude) != null ? { longitude: finite(track.longitude) } : {}),
    ...(usefulText(track.coordinateSource) ? { coordinateSource: usefulText(track.coordinateSource) } : {}),
    ...(usefulText(track.coordinateAccuracy) ? { coordinateAccuracy: usefulText(track.coordinateAccuracy) } : {}),
    ...(usefulText(track.surface) ? { surface: usefulText(track.surface) } : {}),
    lengthMeters: Math.max(0, finite(track.lengthMeters) ?? 0),
    ...(finite(track.elevationMeters) != null && Number(track.elevationMeters) !== 0
      ? { elevationMeters: finite(track.elevationMeters) }
      : {}),
    ...(track.routeStatus ? { routeStatus: track.routeStatus } : {}),
    ...(track.activeRouteVariantId ? { routeVariantId: track.activeRouteVariantId } : {}),
    ...(routeVariantName(track) ? { routeVariantName: routeVariantName(track) } : {}),
    lapCount: safeLapCount,
    source: track.source,
    ...(usefulText(track.sourceUrl) ? { sourceUrl: usefulText(track.sourceUrl) } : {}),
    ...(track.sourceType ? { sourceType: track.sourceType } : {}),
    ...(usefulText(track.websiteUrl) ? { websiteUrl: usefulText(track.websiteUrl) } : {}),
    ...(usefulText(track.facebookUrl) ? { facebookUrl: usefulText(track.facebookUrl) } : {}),
    ...(usefulText(track.instagramUrl) ? { instagramUrl: usefulText(track.instagramUrl) } : {}),
    ...(track.verificationStatus ? { verificationStatus: track.verificationStatus } : {}),
    ...(usefulText(track.lastVerifiedAt) ? { lastVerifiedAt: usefulText(track.lastVerifiedAt) } : {}),
    outlinePointCount: track.outline.length,
    centerlinePointCount: track.centerline?.length ?? 0,
    routeVariantCount: track.routeVariants?.length ?? 0,
    zoneCount: track.zones.length,
    zoneNames: track.zones.map((zone) => zone.name),
    pedalZoneCount: pedalZones.length,
    pedalMeters: Number(pedalZones
      .reduce((total, zone) => total + Math.max(0, zone.endMeter - zone.startMeter), 0)
      .toFixed(1)),
    recoveryZoneCount: recoveryZones.length,
    recoveryMeters: Number(recoveryZones
      .reduce((total, zone) => total + Math.max(0, zone.endMeter - zone.startMeter), 0)
      .toFixed(1)),
    technicalZoneCount: technicalZones.length,
    technicalMeters: Number(technicalZones
      .reduce((total, zone) => total + Math.max(0, zone.endMeter - zone.startMeter), 0)
      .toFixed(1)),
    splitCount: track.splitSections?.length ?? 0,
    splitNames: track.splitSections?.map((section) => section.name) ?? [],
    branchNames: [...new Set(track.splitSections
      ?.flatMap((section) => section.branches.map((branch) => branch.name)) ?? [])],
    hasProSet: Boolean(track.splitSections?.some((section) => (
      section.branches.some((branch) => branch.id === 'b')
    ))),
    riders,
    ...(trackBest ? {
      knownTrackBestMs: trackBest.finishTimeMs,
      knownTrackBestRider: trackBest.riderName,
      knownTrackBestAt: new Date(trackBest.savedAt).toISOString(),
    } : {}),
  };
}

export function preRaceVariableCount(context: PreRaceTrackContext, weather?: PreRaceWeather) {
  const scalarValues: unknown[] = [
    context.id,
    context.name,
    context.country,
    context.countryCode,
    context.state,
    context.region,
    context.city,
    context.county,
    context.district,
    context.postalCode,
    context.address,
    context.addressStatus,
    context.latitude,
    context.longitude,
    context.coordinateSource,
    context.coordinateAccuracy,
    context.surface,
    context.lengthMeters,
    context.elevationMeters,
    context.routeStatus,
    context.routeVariantId,
    context.routeVariantName,
    context.lapCount,
    context.source,
    context.sourceUrl,
    context.sourceType,
    context.websiteUrl,
    context.facebookUrl,
    context.instagramUrl,
    context.verificationStatus,
    context.lastVerifiedAt,
    context.outlinePointCount,
    context.centerlinePointCount,
    context.routeVariantCount,
    context.zoneCount,
    ...context.zoneNames,
    context.pedalZoneCount,
    context.pedalMeters,
    context.recoveryZoneCount,
    context.recoveryMeters,
    context.technicalZoneCount,
    context.technicalMeters,
    context.splitCount,
    ...context.splitNames,
    ...context.branchNames,
    context.hasProSet,
    context.knownTrackBestMs,
    context.knownTrackBestRider,
    context.knownTrackBestAt,
    weather?.summary,
    weather?.temperatureC,
    weather?.feelsLikeC,
    weather?.humidityPercent,
    weather?.windKph,
    weather?.windDirection,
    weather?.gustKph,
    weather?.precipitationMm,
  ];
  const riderValues = context.riders.flatMap((rider) => [
    rider.playerId,
    rider.name,
    rider.colorName,
    rider.personalBestMs,
    rider.personalThirtyFootMs,
    rider.personalBestAt,
  ]);
  return [...scalarValues, ...riderValues]
    .filter((value) => value !== undefined && value !== null && value !== '').length;
}

function naturalNameList(names: string[]) {
  if (names.length <= 1) {
    return names[0] ?? 'the riders';
  }
  if (names.length === 2) {
    return `${names[0]} and ${names[1]}`;
  }
  return `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;
}

export function localPreRaceReportLine(
  context: PreRaceTrackContext,
  weather?: PreRaceWeather,
) {
  const names = naturalNameList(context.riders.map((rider) => rider.name));
  const place = usefulText(context.city) ?? usefulText(context.state) ?? usefulText(context.country);
  const conditions = weather?.available && weather.summary
    ? `, with ${weather.summary.toLowerCase()} conditions`
    : '';
  const surface = usefulText(context.surface)
    ? ` on the ${context.surface} surface`
    : '';
  const location = place ? ` in ${place}` : '';
  return `${names} are set for ${context.name}${location}${surface}${conditions}. The gate is next.`;
}
