export type BridgeMode = 'sim' | 'ant' | 'demo' | 'bluetooth' | 'usb';
export type SpeedUnit = 'kph' | 'mph';
export type DistanceUnit = 'ft' | 'm';
export type SessionMode = 'sprint' | 'interval';
export type IntervalMode = 'auto' | 'manual';
export type PlayMode = 'local' | 'multiplayer';
export type MappingEditMode = 'navigate' | 'draw' | 'zones';
export type StartCadenceMode = 'countdown' | 'uci';
export type MetricKey = 'cadence' | 'speed' | 'power' | 'reaction';
export type LeaderboardMetric = 'rpm' | 'speed' | 'watts';

export type BikeSample = {
  at: number;
  source: BridgeMode;
  deviceId: number;
  label: string;
  watts: number;
  cadence: number | null;
  speedKph: number | null;
  signal: number;
  battery?: number;
};

export type BridgeStatusMessage = {
  type: 'bridge-status';
  mode: BridgeMode;
  at?: number;
  connectedAt?: number;
  message: string;
  devices?: Array<{
    deviceId: number;
    label: string;
    connected: boolean;
    signal: number;
  }>;
};

export type BikeControlAction = 'race-arm' | 'race-start' | 'race-reset';

export type BikeControlCommand = {
  type: 'bike-control';
  action: BikeControlAction;
  at: number;
  sessionId?: string;
};

export type BikeControlResultMessage = {
  type: 'bike-control-result';
  action: BikeControlAction;
  ok: boolean;
  at: number;
  message: string;
  controlledCount?: number;
};

export type BridgeErrorMessage = {
  type: 'bridge-error';
  message: string;
  at: number;
};

export type BikeSampleMessage = BikeSample & {
  type: 'bike-sample';
};

export type BridgeMessage = BridgeStatusMessage | BridgeErrorMessage | BikeSampleMessage | BikeControlResultMessage;

export type PlayerSlot = {
  id: 1 | 2 | 3 | 4;
  name: string;
  colorName: 'lime' | 'red' | 'blue' | 'yellow';
  accent: string;
  deviceId: number | null;
};

export type ReactionTimesByPlayer = Partial<Record<PlayerSlot['id'], number>>;

export type RaceState = 'ready' | 'racing' | 'finished';

export type AppMode = 'race' | 'monitor';

export type RiderPhase = 'pedaling' | 'airborne' | 'landing';

export type RiderState = {
  playerId: PlayerSlot['id'];
  distance: number;
  velocity: number;
  boost: number;
  air: number;
  verticalVelocity: number;
  pitch: number;
  pedalPhase: number;
  landingCompression: number;
  phase: RiderPhase;
  lastWatts: number;
  wattsAverage: number;
  rank: number;
  finishedAt: number | null;
};

export type RaceSummaryEntry = {
  playerId: PlayerSlot['id'];
  riderName: string;
  colorName: PlayerSlot['colorName'];
  accent: string;
  deviceLabel: string;
  rank: number;
  finishTimeMs: number | null;
  distanceMeters: number;
  sampleCount: number;
  topSpeedKph: number | null;
  averageSpeedKph: number | null;
  topCadence: number | null;
  averageCadence: number | null;
  topWatts: number | null;
  averageWatts: number | null;
};

export type TrackPoint = {
  lat: number;
  lng: number;
};

export type TrackZone = {
  id: string;
  name: string;
  startMeter: number;
  endMeter: number;
  type: 'pedal' | 'recovery' | 'technical';
  restAfterSeconds?: number;
};

export type TrackRouteStatus = 'verified' | 'estimated' | 'locator-only' | 'user-mapped';

export type UserTrackMapping = {
  version: 1;
  trackId: string;
  trackName: string;
  country: string;
  state: string;
  savedAt: string;
  routeStatus: 'user-mapped';
  restAfterSeconds: number;
  lengthMeters: number;
  centerline: TrackPoint[];
  startGate: TrackPoint;
  finishLine: TrackPoint;
  zoneBoundaryMeters?: number[];
  zones: TrackZone[];
};

export type LeaderboardEntry = {
  rider: string;
  value: number;
  unit: string;
  date: string;
};

export type TrackRecord = {
  id: string;
  name: string;
  country: string;
  countryCode: string;
  state: string;
  region: string;
  source: string;
  sourceUrl: string;
  sourceTrackId?: string;
  address?: string;
  city?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  websiteUrl?: string;
  facebookUrl?: string;
  instagramUrl?: string;
  lengthMeters: number;
  elevationMeters: number;
  surface: string;
  outline: TrackPoint[];
  centerline?: TrackPoint[];
  startGate?: TrackPoint;
  finishLine?: TrackPoint;
  routeStatus?: TrackRouteStatus;
  zones: TrackZone[];
  leaderboards: Record<LeaderboardMetric, LeaderboardEntry[]>;
};
