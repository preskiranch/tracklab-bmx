export type BridgeMode = 'auto' | 'sim' | 'ant' | 'demo' | 'bluetooth' | 'usb';
export type BridgeSourceState = 'idle' | 'starting' | 'running' | 'stopping' | 'error';
export type SpeedUnit = 'kph' | 'mph';
export type DistanceUnit = 'ft' | 'm';
export type SessionMode = 'sprint' | 'interval';
export type IntervalMode = 'auto' | 'manual';
export type PlayMode = 'local' | 'multiplayer';
export type MappingEditMode = 'navigate' | 'draw' | 'curve' | 'zones' | 'split';
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
  wattsAt?: number;
  cadenceAt?: number;
  speedAt?: number;
  speedSource?: 'measured' | 'estimated';
  physicsWatts?: number;
  demoActiveMs?: number;
  demoReactionDelayMs?: number;
  signal: number;
  battery?: number;
};

export type ConnectedBikeDevice = {
  deviceId: number;
  label: string;
  connected: boolean;
  source?: BridgeMode;
  signal?: number;
  at?: number;
  connectionOrigin?: 'bridge-status' | 'bridge-sample' | 'direct-bluetooth';
};

export type BridgeStatusMessage = {
  type: 'bridge-status';
  mode: BridgeMode;
  sourceState?: BridgeSourceState;
  at?: number;
  connectedAt?: number;
  message: string;
  connectedDevices?: ConnectedBikeDevice[];
  devices?: ConnectedBikeDevice[];
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

export type PlayerId = 1 | 2 | 3 | 4;
export type PlayerColorName = 'lime' | 'red' | 'blue' | 'yellow';
export type SplitBranchChoice = 'a' | 'b';
export type TrackZoneBranchSelections = Partial<Record<string, SplitBranchChoice>>;

export type PlayerSlot = {
  id: PlayerId;
  name: string;
  colorName: PlayerColorName;
  accent: string;
  deviceId: number | null;
  deviceLabel?: string;
  deviceSource?: BridgeMode;
};

export type BikeProfile = {
  deviceId: number;
  name: string;
  colorName: PlayerColorName;
  accent: string;
  updatedAt: number;
};

export type MultiplayerTrackSummary = {
  id: string;
  name: string;
  country: string;
  state: string;
};

export type MultiplayerTrackVoteCandidate = MultiplayerTrackSummary & {
  hasPedalZones: boolean;
  hasSplits: boolean;
};

export type MultiplayerRoomPhase = 'lobby' | 'voting' | 'route-select' | 'race';
export type MultiplayerLatencyQuality = 'unknown' | 'good' | 'ok' | 'poor';

export type MultiplayerLatencySnapshot = {
  rttMs: number | null;
  clockOffsetMs: number;
  quality: MultiplayerLatencyQuality;
  measuredAt: number | null;
};

export type MultiplayerRoomFlow = {
  phase: MultiplayerRoomPhase;
  candidates: MultiplayerTrackVoteCandidate[];
  votes: Record<string, string>;
  routeChoices: Record<string, SplitBranchChoice>;
  deadlineAt: number | null;
  selectedTrackId: string | null;
  raceToken: string | null;
  raceStartAt: number | null;
};

export type MultiplayerRider = {
  id: string;
  name: string;
  available: boolean;
  membershipTier?: 'visitor' | 'spectator' | 'racer';
  bikeCount: number;
  racerSeatCount?: number;
  latencyMs?: number | null;
  latencyQuality?: MultiplayerLatencyQuality;
  track: MultiplayerTrackSummary;
  roomId: string | null;
  roomRole?: 'racer' | 'spectator' | null;
  lastSeen: number;
};

export type MultiplayerRoom = {
  id: string;
  hostId: string | null;
  private: boolean;
  track: MultiplayerTrackSummary;
  flow: MultiplayerRoomFlow;
  createdAt: number;
  members: MultiplayerRider[];
  memberCount: number;
  racerCount?: number;
  racerSeatCount?: number;
  racerSeatCapacity?: number;
  maxLatencyMs?: number | null;
  latencyQuality?: MultiplayerLatencyQuality;
  spectatorCount?: number;
};

export type MultiplayerRoomMessage = {
  id: string;
  author: string;
  text: string;
  at: string;
};

export type MultiplayerChallenge = {
  id: string;
  fromId: string;
  toId: string;
  track: MultiplayerTrackSummary;
  createdAt: number;
};

export type MultiplayerMatchInvite = {
  id: string;
  roomId: string;
  fromId: string;
  fromName: string;
  targetIds: string[];
  hostSeatCount?: number;
  track: MultiplayerTrackSummary;
  createdAt: number;
};

export type MultiplayerFriend = {
  guestKey: string;
  name: string;
  online: boolean;
  riderId: string | null;
  available: boolean;
  createdAt: string;
};

export type MultiplayerFriendRequest = {
  id: string;
  fromGuestKey: string;
  fromName: string;
  toGuestKey: string;
  toName: string;
  createdAt: string;
};

export type MultiplayerGroupMember = {
  guestKey: string;
  name: string;
  role: 'owner' | 'member';
  online: boolean;
  riderId: string | null;
  available: boolean;
};

export type MultiplayerGroup = {
  id: string;
  name: string;
  ownerGuestKey: string;
  role: 'owner' | 'member';
  members: MultiplayerGroupMember[];
  createdAt: string;
};

export type MultiplayerGroupInvite = {
  id: string;
  groupId: string;
  groupName: string;
  fromGuestKey: string;
  fromName: string;
  toGuestKey: string;
  toName: string;
  createdAt: string;
};

export type MultiplayerSocialState = {
  friends: MultiplayerFriend[];
  incomingFriendRequests: MultiplayerFriendRequest[];
  outgoingFriendRequests: MultiplayerFriendRequest[];
  groups: MultiplayerGroup[];
  incomingGroupInvites: MultiplayerGroupInvite[];
};

export type MultiplayerRaceRider = {
  id: string;
  playerId: PlayerSlot['id'];
  name: string;
  colorName: PlayerColorName;
  accent: string;
  distance: number;
  velocity: number;
  boost: number;
  air: number;
  pitch: number;
  phase: RiderPhase;
  rank: number;
  finishedAt: number | null;
  selectedBranch: SplitBranchChoice;
  actualBranches: Record<string, SplitBranchChoice>;
  watts: number;
  cadence: number | null;
  speedKph: number | null;
  signal: number;
  sampleAt: number | null;
};

export type MultiplayerRaceState = {
  sessionId: string;
  clientId: string;
  riderName: string;
  roomId: string;
  trackId: string;
  raceState: RaceState;
  at: number;
  receivedAt?: number;
  riders: MultiplayerRaceRider[];
  summary: RaceSummaryEntry[];
};

export type MultiplayerVoiceSignalPayload =
  | { type: 'ready' }
  | { type: 'leave' }
  | { type: 'offer'; description: RTCSessionDescriptionInit }
  | { type: 'answer'; description: RTCSessionDescriptionInit }
  | { type: 'candidate'; candidate: RTCIceCandidateInit };

export type MultiplayerVoiceSignal = {
  id: string;
  fromId: string;
  targetId: string | null;
  signal: MultiplayerVoiceSignalPayload;
  at: number;
};

export type ReactionTimesByPlayer = Partial<Record<PlayerSlot['id'], number>>;

export type RaceState = 'ready' | 'racing' | 'finished';

export type AppMode = 'race' | 'monitor' | 'diagnostics';

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
  thirtyFootTimeMs: number | null;
  finishedAt: number | null;
  selectedBranch: SplitBranchChoice;
  actualBranches: Record<string, SplitBranchChoice>;
  proPenaltySections: Record<string, boolean>;
};

export type RaceSummaryEntry = {
  playerId: PlayerSlot['id'];
  riderName: string;
  colorName: PlayerSlot['colorName'];
  accent: string;
  deviceLabel: string;
  rank: number;
  finishTimeMs: number | null;
  thirtyFootTimeMs: number | null;
  distanceMeters: number;
  sampleCount: number;
  topSpeedKph: number | null;
  averageSpeedKph: number | null;
  topCadence: number | null;
  averageCadence: number | null;
  topWatts: number | null;
  averageWatts: number | null;
};

export type RaceCaptureStatus = 'armed' | 'racing' | 'finished' | 'reset' | 'cancelled';

export type RaceCaptureSample = {
  at: number;
  elapsedMs: number;
  playerId: PlayerSlot['id'];
  riderName: string;
  deviceId: number;
  deviceLabel: string;
  source: BridgeMode;
  watts: number;
  cadence: number | null;
  speedKph: number | null;
  wattsAt?: number;
  cadenceAt?: number;
  speedAt?: number;
  speedSource?: 'measured' | 'estimated';
  signal: number;
  battery?: number;
  riderDistanceMeters: number | null;
  riderVelocityMps: number | null;
  riderPhase: RiderPhase | null;
  rank: number | null;
};

export type RaceCaptureEvent = {
  at: number;
  elapsedMs: number;
  type: 'race-arm' | 'race-start' | 'race-finish' | 'race-reset' | 'race-cancel';
  label: string;
};

export type RaceCapture = {
  version: 1;
  sessionId: string;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  status: RaceCaptureStatus;
  source: 'live' | 'demo';
  track: {
    id: string;
    name: string;
    country: string;
    state: string;
    lengthMeters: number;
  };
  sessionMode: SessionMode;
  selectedMetrics: MetricKey[];
  players: Array<{
    id: PlayerSlot['id'];
    name: string;
    deviceId: number | null;
    colorName: PlayerSlot['colorName'];
  }>;
  zones: TrackZone[];
  events: RaceCaptureEvent[];
  samples: RaceCaptureSample[];
  reactionTimesByPlayer: ReactionTimesByPlayer;
  summary: RaceSummaryEntry[];
};

export type GhostLapSource = 'personal' | 'friend' | 'top';

export type GhostLapPoint = {
  elapsedMs: number;
  distanceMeters: number;
  velocityMps: number;
  phase: RiderPhase;
  pitch: number;
  rank: number;
  actualBranches: Record<string, SplitBranchChoice>;
};

export type GhostLap = {
  version: 1;
  id: string;
  trackId: string;
  trackName: string;
  routeVariantId?: TrackRouteVariantId;
  riderName: string;
  ownerKey: string;
  ownerName: string;
  colorName: PlayerSlot['colorName'];
  accent: string;
  source: GhostLapSource;
  finishTimeMs: number;
  thirtyFootTimeMs: number | null;
  savedAt: number;
  summary: RaceSummaryEntry;
  points: GhostLapPoint[];
};

export type GhostPlaybackRider = {
  id: string;
  name: string;
  colorName: PlayerSlot['colorName'];
  accent: string;
  distance: number;
  velocity: number;
  phase: RiderPhase;
  pitch: number;
  rank: number;
  finishedAt: number | null;
  actualBranches: Record<string, SplitBranchChoice>;
};

export type TrackPoint = {
  lat: number;
  lng: number;
};

export type EarthCamera = {
  angle: number;
  heading: number;
  center?: TrackPoint;
  zoom?: number;
  updatedAt: number;
};

export type TrackZone = {
  id: string;
  name: string;
  startMeter: number;
  endMeter: number;
  type: 'pedal' | 'recovery' | 'technical';
  restAfterSeconds?: number;
  branchSelections?: TrackZoneBranchSelections;
};

export type TrackZoneBoundarySet = {
  id: string;
  name: string;
  branchSelections?: TrackZoneBranchSelections;
  boundaryMeters: number[];
};

export type TrackSplitBranch = {
  id: SplitBranchChoice;
  name: string;
  points: TrackPoint[];
  lengthMeters: number;
};

export type TrackSplitSection = {
  id: string;
  name: string;
  index: number;
  splitPoint: TrackPoint;
  mergePoint: TrackPoint;
  branches: TrackSplitBranch[];
};

export type DraftTrackSplit = {
  id: string;
  index: number;
  splitPoint: TrackPoint | null;
  mergePoint: TrackPoint | null;
  activeBranch: TrackSplitBranch['id'];
  branchA: TrackPoint[];
  branchB: TrackPoint[];
};

export type TrackRouteStatus = 'verified' | 'estimated' | 'locator-only' | 'user-mapped';
export type TrackRouteVariantId = 'amateur' | 'pro';

export type TrackRouteVariant = {
  id: TrackRouteVariantId;
  name: string;
  restAfterSeconds: number;
  lengthMeters: number;
  centerline: TrackPoint[];
  startGate: TrackPoint;
  finishLine: TrackPoint;
  zoneBoundaryMeters?: number[];
  zoneBoundarySets?: TrackZoneBoundarySet[];
  zones: TrackZone[];
  splitSections?: TrackSplitSection[];
};

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
  zoneBoundarySets?: TrackZoneBoundarySet[];
  zones: TrackZone[];
  splitSections?: TrackSplitSection[];
  routeVariants?: TrackRouteVariant[];
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
  county?: string;
  district?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  coordinateSource?: string;
  coordinateAccuracy?: string;
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
  splitSections?: TrackSplitSection[];
  routeVariants?: TrackRouteVariant[];
  activeRouteVariantId?: TrackRouteVariantId;
  activeRouteVariantName?: string;
  zones: TrackZone[];
  leaderboards: Record<LeaderboardMetric, LeaderboardEntry[]>;
  sourceRecord?: Record<string, unknown>;
};
