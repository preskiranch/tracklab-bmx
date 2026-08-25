export type BridgeMode = 'auto' | 'sim' | 'ant' | 'demo' | 'bluetooth' | 'usb';
export type BridgeSourceState = 'idle' | 'starting' | 'running' | 'stopping' | 'error';
export type SpeedUnit = 'kph' | 'mph';
export type DistanceUnit = 'ft' | 'm';
export type SessionMode = 'sprint' | 'interval';
export type IntervalMode = 'auto' | 'manual';
export type PlayMode = 'local' | 'multiplayer';
export type MappingEditMode = 'navigate' | 'draw' | 'adjust' | 'curve' | 'zones' | 'split';
export type MetricKey = 'cadence' | 'speed' | 'power' | 'reaction';
export type LeaderboardMetric = 'rpm' | 'speed';

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
  sourceState?: BridgeSourceState;
};

export type BikeSampleMessage = BikeSample & {
  type: 'bike-sample';
};

export type BridgeMessage = BridgeStatusMessage | BridgeErrorMessage | BikeSampleMessage | BikeControlResultMessage;

export type PlayerId = 1 | 2 | 3 | 4;
export type PlayerColorName = 'lime' | 'red' | 'blue' | 'yellow';
export type SplitBranchChoice = 'a' | 'b';
export type TrackZoneBranchSelections = Partial<Record<string, SplitBranchChoice>>;
export type DemoRiderNames = Partial<Record<PlayerId, string>>;
export type DemoRiderPhotos = Partial<Record<PlayerId, string>>;

export type PlayerSlot = {
  id: PlayerId;
  name: string;
  colorName: PlayerColorName;
  accent: string;
  deviceId: number | null;
  deviceLabel?: string;
  deviceSource?: BridgeMode;
  riderId?: string;
  bikeName?: string;
  photoUrl?: string;
};

export type BikeProfile = {
  deviceId: number;
  name: string;
  colorName: PlayerColorName;
  accent: string;
  updatedAt: number;
};

export type StudioRider = {
  id: string;
  name: string;
  photoUrl?: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
};

export type StudioRiderAssignments = Record<number, string>;

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
export type ExploreTravelMode = 'bicycle' | 'drive';
export type ExploreDistanceUnit = 'mi' | 'km';

export type ExploreElevationSample = {
  distanceMeters: number;
  elevationMeters: number;
};

export type ExploreRouteWaypoint = {
  point: TrackPoint;
  label: string;
};

export type ExploreRoute = {
  id: string;
  name?: string;
  origin: TrackPoint;
  destination: TrackPoint;
  originLabel: string;
  destinationLabel: string;
  travelMode: ExploreTravelMode;
  distanceMeters: number;
  durationSeconds: number;
  encodedPolyline: string;
  waypoints?: ExploreRouteWaypoint[];
  elevationSamples?: ExploreElevationSample[];
  elevationGainMeters?: number;
  elevationLossMeters?: number;
  createdAt: number;
};

export type ExploreRider = {
  id: string;
  clientId: string;
  playerId: PlayerSlot['id'];
  riderId?: string;
  name: string;
  photoUrl?: string;
  colorName: PlayerColorName;
  accent: string;
  distanceMeters: number;
  velocityMps: number;
  cadence: number | null;
  watts: number;
  signal: number;
  recommendedAirSetting?: number;
  finishedAt: number | null;
  at: number;
};

/**
 * An immutable studio-side snapshot of who was assigned to a physical bike
 * before an Explore ride began. These values are identifiers and display
 * metadata only; bearer credentials must never be added to this shape.
 */
export type ExploreRideRiderBinding = Readonly<{
  playerId: PlayerSlot['id'];
  riderId?: string;
  riderName: string;
  deviceId: number;
  deviceLabel?: string;
}>;

/** Non-secret identifiers returned after a future club authorization call. */
export type ExploreRideAuthorizationReferences = Readonly<{
  authorizationGroupId: string;
  riders: readonly Readonly<{
    playerId: PlayerSlot['id'];
    authorizationId: string;
  }>[];
  /** Full allow-listed recovery material; never contains the completion token. */
  authorizationCheckpoint?: import('./lib/clubOwnerTrainingCoordinator').ClubOwnerTrainingCheckpoint;
}>;

/**
 * The allow-listed subset of studio authorization state that may survive an
 * app reload. A recovered token is intentionally owned by the caller and is
 * never accepted by the checkpoint serializer.
 */
export type ExploreRideStudioBinding = Readonly<{
  authorizationGroupId?: string;
  authorizationCheckpoint?: import('./lib/clubOwnerTrainingCoordinator').ClubOwnerTrainingCheckpoint;
  riders: readonly Readonly<ExploreRideRiderBinding & {
    authorizationId?: string;
  }>[];
}>;

export type ExploreRideSessionArm = Readonly<{
  sessionId: string;
  route: ExploreRoute;
  armedAt: number;
  riderBindings: readonly ExploreRideRiderBinding[];
}>;

export type ExploreRideSessionRestored = Readonly<{
  sessionId: string;
  route: ExploreRoute;
  startedAt: number;
  elapsedMs: number;
  activeClockSegments: readonly import('./lib/heartRate').HeartRateActiveClockSegment[];
  studioBinding: ExploreRideStudioBinding;
}>;

export type ExploreRideSessionStartEvent = Readonly<ExploreRideSessionArm & {
  riders: ExploreRider[];
  startedAt: number;
  studioBinding?: ExploreRideStudioBinding;
}>;

export type ExploreRideSessionClockEvent = Readonly<{
  sessionId: string;
  at: number;
  activeElapsedMs: number;
  studioBinding?: ExploreRideStudioBinding;
}>;

export type ExploreRideSessionCancellation = Readonly<{
  sessionId: string;
  at: number;
  activeElapsedMs: number;
  reason: 'authorization-failed' | 'binding-changed' | 'reset' | 'view-closed';
  arm?: ExploreRideSessionArm;
  studioBinding?: ExploreRideStudioBinding;
}>;

export type ExploreRideCompleteEvent = Readonly<{
  sessionId: string;
  route: ExploreRoute;
  riders: ExploreRider[];
  startedAt: number;
  endedAt: number;
  durationMs: number;
  activeClockSegments: import('./lib/heartRate').HeartRateActiveClockSegment[];
  studioBinding?: ExploreRideStudioBinding;
}>;

export type ExploreSession = {
  id: string;
  routeId: string;
  status: 'ready' | 'riding' | 'paused' | 'finished';
  startedAt: number | null;
  updatedAt: number;
};

export type MultiplayerExploreState = {
  sessionId: string;
  clientId: string;
  roomId: string;
  routeId: string;
  at: number;
  riders: ExploreRider[];
};

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
  purpose?: 'race' | 'live-audio';
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
  exploreRoute?: ExploreRoute | null;
  exploreSession?: ExploreSession | null;
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
  photoUrl?: string;
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

export type AppMode = 'profile' | 'friends' | 'settings' | 'race' | 'results' | 'explore' | 'straight-sprint' | 'get-pulled' | 'monitor' | 'club-monitor' | 'club-tablet' | 'diagnostics' | 'developer';

export type AccountProfile = {
  photoUrl?: string;
  updatedAt: number;
};

export type UnitPreferences = {
  speedUnit: SpeedUnit;
  distanceUnit: DistanceUnit;
  updatedAt: number;
};

/**
 * Apple Watch heart-rate data is private training data. Keep these types out of
 * public race, leaderboard, multiplayer, friend, and ghost payloads.
 */
export type HeartRateSource = 'apple-watch';

export type HeartRateMeasurement = Readonly<{
  source: HeartRateSource;
  sessionId: string | null;
  sequence: number;
  bpm: number;
  recordedAt: number;
  receivedAt: number;
}>;

export type PrivateHeartRateSample = Readonly<HeartRateMeasurement & {
  activeElapsedMs: number;
}>;

export type PrivateHeartRateSummary = Readonly<{
  sampleCount: number;
  coverageMs: number;
  coveragePercent: number;
  firstSampleElapsedMs: number | null;
  lastSampleElapsedMs: number | null;
  minimumBpm: number | null;
  averageBpm: number | null;
  peakBpm: number | null;
}>;

export type PrivateHeartRateZoneSummary = Readonly<{
  zoneId: string;
  zoneName?: string;
  startElapsedMs: number;
  endElapsedMs: number;
  summary: PrivateHeartRateSummary;
}>;

export type PrivateHeartRateCapture = Readonly<{
  source: HeartRateSource;
  samples: readonly PrivateHeartRateSample[];
  summary?: PrivateHeartRateSummary;
  zones?: readonly PrivateHeartRateZoneSummary[];
}>;

export type TrainingActivityType = 'bmx-race' | 'straight-sprint' | 'explore' | 'get-pulled' | 'monitor-sprint';

export type TrainingSessionClub = {
  id: string;
  name: string;
  studioRiderId: string;
  riderName: string;
  role: 'athlete' | 'owner';
};

export type TrainingSession = {
  id: string;
  activityType: TrainingActivityType;
  title: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  distanceMeters: number;
  trackId?: string;
  trackName?: string;
  source: 'live' | 'imported';
  club?: TrainingSessionClub;
  details: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
};

export type RiderPhase = 'pedaling' | 'airborne' | 'landing';
export type RiderDriveSource = 'cadence' | 'power' | 'speed' | 'coast' | 'blocked';

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
  lastRawWatts: number;
  lastRawCadence: number;
  lastRawSpeedKph: number;
  driveAllowed: boolean;
  driveSource: RiderDriveSource;
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
  riderId?: string;
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

export type RaceZoneRiderResult = {
  playerId: PlayerSlot['id'];
  sampleCount: number;
  entryElapsedMs: number | null;
  exitElapsedMs: number | null;
  durationMs: number | null;
  topSpeedKph: number | null;
  averageSpeedKph: number | null;
  topCadence: number | null;
  averageCadence: number | null;
  topWatts: number | null;
  averageWatts: number | null;
};

export type RaceZoneResult = {
  zoneId: string;
  zoneName: string;
  zoneType: TrackZone['type'];
  startMeter: number;
  endMeter: number;
  riders: RaceZoneRiderResult[];
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
  riderDriveSource?: RiderDriveSource | null;
  rawWatts?: number | null;
  rawCadence?: number | null;
  rawSpeedKph?: number | null;
  sampleAgeMs?: number | null;
  rank: number | null;
};

export type RaceCaptureFrame = {
  at: number;
  elapsedMs: number;
  raceState: RaceState;
  trackId: string;
  trackLengthMeters: number;
  routeLengthMeters: number;
  riders: Array<{
    playerId: PlayerSlot['id'];
    riderName: string;
    deviceId: number | null;
    distanceMeters: number;
    velocityMps: number;
    driveSource: RiderDriveSource;
    driveAllowed: boolean;
    rawWatts: number;
    rawCadence: number;
    rawSpeedKph: number;
    sampleAgeMs: number | null;
    wattsAgeMs: number | null;
    cadenceAgeMs: number | null;
    speedAgeMs: number | null;
  }>;
};

export type RaceCaptureEvent = {
  at: number;
  elapsedMs: number;
  type: 'race-arm' | 'race-start' | 'race-finish' | 'race-reset' | 'race-cancel' | 'false-start';
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
    routeLengthMeters?: number;
    sprintDistanceFeet?: number;
    sprintAirSetting?: number;
  };
  sessionMode: SessionMode;
  selectedMetrics: MetricKey[];
  players: Array<{
    id: PlayerSlot['id'];
    name: string;
    deviceId: number | null;
    colorName: PlayerSlot['colorName'];
    riderId?: string;
    bikeName?: string;
  }>;
  zones: TrackZone[];
  events: RaceCaptureEvent[];
  samples: RaceCaptureSample[];
  frames?: RaceCaptureFrame[];
  reactionTimesByPlayer: ReactionTimesByPlayer;
  summary: RaceSummaryEntry[];
  zoneResults?: RaceZoneResult[];
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
  sprintDistanceFeet?: number;
  sprintAirSetting?: number;
  riderName: string;
  photoUrl?: string;
  ownerKey: string;
  ownerName: string;
  colorName: PlayerSlot['colorName'];
  accent: string;
  source: GhostLapSource;
  raceSource: 'live' | 'demo';
  lapCount: number;
  finishTimeMs: number;
  thirtyFootTimeMs: number | null;
  savedAt: number;
  analyticsPublic: boolean;
  medalRank: 1 | 2 | 3 | null;
  summary: RaceSummaryEntry | null;
  zoneResults: RaceZoneResult[];
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

export type RaceRiderOverlayLayout = {
  xPct: number;
  yPct: number;
  width: number;
  height: number;
  locked: boolean;
};

export type RaceCommentaryVoicePreset = 'american-man';

export type RaceCommentaryPreferences = {
  enabled: boolean;
  ambientEnabled: boolean;
  ambientVolume: number;
  ambientVolumeLocked: boolean;
  voicePreset: RaceCommentaryVoicePreset;
  volume: number;
  adaptiveMemory: boolean;
  recentLines: string[];
};

export type RaceViewPreferences = {
  cameraLocked: boolean;
  cameraLockedUpdatedAt: number;
  earthCamerasByTrack: Record<string, EarthCamera>;
  riderOverlaysByTrack: Record<string, RaceRiderOverlayLayout>;
  riderOverlayUpdatedAtByTrack: Record<string, number>;
  demoRiderNames: DemoRiderNames;
  demoRiderNamesUpdatedAt: number;
  demoRiderPhotos: DemoRiderPhotos;
  demoRiderPhotosUpdatedAt: number;
  commentary: RaceCommentaryPreferences;
  commentaryUpdatedAt: number;
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

export type TrackRaceViewMode = 'satellite' | '3d' | 'game';

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
  raceViewMode?: TrackRaceViewMode;
};

export type LeaderboardEntry = {
  rider: string;
  photoUrl?: string;
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
  providerId?: string;
  sourceType?: 'sanctioning-body-track-directory' | 'national-federation-track-directory' | 'national-federation-club-directory' | 'governing-body-reference' | 'community-map' | 'manual';
  verificationStatus?: 'official-track-directory' | 'federation-directory' | 'reference-only' | 'supplemental' | 'unverified';
  addressStatus?: 'provider-address' | 'provider-approximate' | 'reverse-geocoded' | 'coordinates-only' | 'unverified';
  lastVerifiedAt?: string;
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
  tiktokUrl?: string;
  youtubeUrl?: string;
  phoneNumber?: string;
  federationName?: string;
  federationUrl?: string;
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

export type TrackLocatorRecord = Pick<TrackRecord,
  | 'id'
  | 'name'
  | 'country'
  | 'countryCode'
  | 'state'
  | 'region'
  | 'source'
  | 'address'
  | 'city'
  | 'county'
  | 'district'
  | 'postalCode'
  | 'latitude'
  | 'longitude'
  | 'websiteUrl'
  | 'facebookUrl'
  | 'instagramUrl'
  | 'tiktokUrl'
  | 'youtubeUrl'
  | 'phoneNumber'
  | 'federationName'
  | 'federationUrl'
>;
