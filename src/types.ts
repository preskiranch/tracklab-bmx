export type BridgeMode = 'sim' | 'ant';
export type SpeedUnit = 'kph' | 'mph';
export type SessionMode = 'sprint' | 'interval';
export type IntervalMode = 'auto' | 'manual';
export type PlayMode = 'local' | 'multiplayer';
export type MetricKey = 'cadence' | 'speed' | 'power';
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

export type BridgeErrorMessage = {
  type: 'bridge-error';
  message: string;
  at: number;
};

export type BikeSampleMessage = BikeSample & {
  type: 'bike-sample';
};

export type BridgeMessage = BridgeStatusMessage | BridgeErrorMessage | BikeSampleMessage;

export type PlayerSlot = {
  id: 1 | 2 | 3 | 4;
  name: string;
  colorName: 'lime' | 'red' | 'blue' | 'yellow';
  accent: string;
  deviceId: number | null;
};

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
  source: 'USA BMX' | 'UCI' | 'British Cycling' | 'AusCycling' | 'Cycling Canada';
  sourceUrl: string;
  lengthMeters: number;
  elevationMeters: number;
  surface: string;
  outline: TrackPoint[];
  zones: TrackZone[];
  leaderboards: Record<LeaderboardMetric, LeaderboardEntry[]>;
};
