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
  recentLines: string[] = [],
) {
  const names = naturalNameList(context.riders.map((rider) => rider.name));
  const place = usefulText(context.city) ?? usefulText(context.state) ?? usefulText(context.country);
  const location = place ? ` in ${place}` : '';
  const weatherFacts = weather?.available && weather.summary
    ? [
      `${weather.summary.toLowerCase()} skies frame the track`,
      `the forecast says ${weather.summary.toLowerCase()}`,
      `${weather.summary.toLowerCase()} weather sits over the course`,
    ]
    : [];
  const facts = [
    ...(usefulText(context.surface)
      ? [`the ${context.surface} surface is ready`, `this one runs on ${context.surface}`, `${context.surface} is under the wheels`]
      : []),
    ...(context.lengthMeters
      ? [`${Math.round(context.lengthMeters)} meters of racing lie ahead`, `the ${Math.round(context.lengthMeters)}-meter course is waiting`]
      : []),
    ...(context.hasProSet
      ? ['the Pro Set adds a major line choice', 'the split line could shape the middle of the race']
      : []),
    ...(context.knownTrackBestMs
      ? [`the TrackLab benchmark stands at ${(context.knownTrackBestMs / 1000).toFixed(2)} seconds`]
      : []),
    'the start is moments away',
  ];
  const openings = [
    `${names} are set for ${context.name}${location}`,
    `The gate is nearly ready for ${names} at ${context.name}${location}`,
    `${names} line up next at ${context.name}${location}`,
    `Race time is close for ${names} at ${context.name}${location}`,
    `All eyes turn to ${names} at ${context.name}${location}`,
    `Next on the gate: ${names}, here at ${context.name}${location}`,
    `${context.name}${location} is ready for ${names}`,
    `The next matchup brings ${names} to ${context.name}${location}`,
    `Staging now at ${context.name}${location}: ${names}`,
    `The course belongs to ${names} next at ${context.name}${location}`,
  ];
  const closers = [
    'The gate is next.',
    'Everything starts with the gate.',
    'The opening charge is almost here.',
    'One clean start can change the whole race.',
    'The countdown is nearly complete.',
    'The next sound is the start cadence.',
    'The race is ready to come alive.',
    'Now the focus moves to the gate.',
  ];
  const seedText = [
    context.id,
    names,
    recentLines.length,
    recentLines.at(-1) ?? '',
  ].join('|');
  let seed = 2_166_136_261;
  for (const character of seedText) {
    seed ^= character.charCodeAt(0);
    seed = Math.imul(seed, 16_777_619);
  }
  const baseSeed = seed >>> 0;
  const candidates = Array.from({ length: 36 }, (_, index) => {
    const opening = openings[(baseSeed + index * 17) % openings.length];
    const trackFact = facts[(baseSeed + index * 23) % facts.length];
    const fact = weatherFacts.length > 0
      ? `${weatherFacts[(baseSeed + index * 19) % weatherFacts.length]}; ${trackFact}`
      : trackFact;
    const closer = closers[(baseSeed + index * 31) % closers.length];
    return `${opening}; ${fact}. ${closer}`;
  });
  const normalizedMemory = new Set(recentLines.map((line) => (
    line.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  )));
  const novel = candidates.filter((candidate) => !normalizedMemory.has(
    candidate.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(),
  ));
  const pool = novel.length > 0 ? novel : candidates;
  return pool[baseSeed % pool.length];
}
