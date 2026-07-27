import { useEffect, useState, type FormEvent } from 'react';
import {
  Check,
  Copy,
  Link,
  LogOut,
  MessageSquare,
  Plus,
  RadioTower,
  Send,
  ShieldCheck,
  Shuffle,
  Trophy,
  UserPlus,
  Users,
  Video,
  VideoOff,
  Vote,
  X,
  Zap,
} from 'lucide-react';
import type {
  BikeSample,
  MultiplayerChallenge,
  MultiplayerGroup,
  MultiplayerLatencySnapshot,
  MultiplayerMatchInvite,
  MultiplayerRaceState,
  MultiplayerRider,
  MultiplayerRoom,
  MultiplayerRoomMessage,
  MultiplayerSocialState,
  MultiplayerTrackVoteCandidate,
  PlayMode,
  PlayerSlot,
  RiderState,
  SplitBranchChoice,
  TrackRecord,
} from '../types';

export type ChatMessage = {
  id: number;
  author: string;
  text: string;
  at: string;
};

type MultiplayerPanelProps = {
  playMode: PlayMode;
  connection: string;
  status: string;
  profileKey: string;
  riderName: string;
  riderAvailable: boolean;
  currentUserId: string | null;
  currentRoom: MultiplayerRoom | null;
  rooms: MultiplayerRoom[];
  onlineRiders: MultiplayerRider[];
  incomingChallenges: Array<{
    challenge: MultiplayerChallenge;
    from: MultiplayerRider;
  }>;
  incomingMatchInvites: Array<{
    invite: MultiplayerMatchInvite;
    from: MultiplayerRider;
  }>;
  social: MultiplayerSocialState;
  inviteUrl: string;
  track: TrackRecord;
  trackVoteCandidates: MultiplayerTrackVoteCandidate[];
  players: PlayerSlot[];
  maxPlayers: number;
  riders: RiderState[];
  samplesByDevice: Map<number, BikeSample>;
  chatMessages: ChatMessage[];
  roomMessages: MultiplayerRoomMessage[];
  remoteRaceStates: MultiplayerRaceState[];
  latency: MultiplayerLatencySnapshot;
  chatDraft: string;
  onPlayModeChange: (mode: PlayMode) => void;
  onProfileKeyChange: (profileKey: string) => void;
  onProfileKeyCopy: () => void;
  onRiderNameChange: (name: string) => void;
  onRiderAvailableChange: (available: boolean) => void;
  onCreatePrivateRoom: () => void;
  onCreateMatch: (targetIds: string[], localSeatCount: number) => void;
  onRespondToMatchInvite: (inviteId: string, accepted: boolean) => void;
  onJoinRoom: (roomId: string) => void;
  onLeaveRoom: () => void;
  onShareInvite: () => void;
  onRandomTrack: () => void;
  onStartTrackVote: () => void;
  onVoteTrack: (trackId: string) => void;
  onRoomRouteChoice: (choice: SplitBranchChoice) => void;
  onResetRoomFlow: () => void;
  onQuickMatch: () => void;
  onChallengeRider: (riderId: string) => void;
  onAcceptChallenge: (challengeId: string) => void;
  onDeclineChallenge: (challengeId: string) => void;
  onSendFriendRequest: (riderId: string) => void;
  onRespondToFriendRequest: (requestId: string, accepted: boolean) => void;
  onCreateGroup: (name: string) => void;
  onInviteToGroup: (groupId: string, riderId: string) => void;
  onRespondToGroupInvite: (inviteId: string, accepted: boolean) => void;
  onChatDraftChange: (value: string) => void;
  onChatSend: () => void;
  workoutVideoAvailable: boolean;
  workoutVideoCameraOn: boolean;
  workoutVideoEligible: boolean;
  workoutVideoJoined: boolean;
  workoutVideoJoining: boolean;
  workoutVideoParticipantCount: number;
  workoutVideoStatus: string;
  workoutVideoSupported: boolean;
  workoutVideoVisible: boolean;
  onWorkoutVideoCameraToggle: () => void;
  onWorkoutVideoJoin: () => void;
  onWorkoutVideoLeave: () => void;
};

function sampleForPlayer(player: PlayerSlot, samplesByDevice: Map<number, BikeSample>) {
  return player.deviceId == null ? undefined : samplesByDevice.get(player.deviceId);
}

function latencyLabel(latencyMs: number | null | undefined) {
  return latencyMs == null || !Number.isFinite(latencyMs) ? 'Ping pending' : `${Math.round(latencyMs)} ms`;
}

function latencyQualityLabel(quality: string | null | undefined) {
  if (quality === 'good') {
    return 'Good';
  }
  if (quality === 'ok') {
    return 'Playable';
  }
  if (quality === 'poor') {
    return 'High latency';
  }
  return 'Checking';
}

export function MultiplayerPanel({
  playMode,
  connection,
  status,
  profileKey,
  riderName,
  riderAvailable,
  currentUserId,
  currentRoom,
  rooms,
  onlineRiders,
  incomingChallenges,
  incomingMatchInvites,
  social,
  inviteUrl,
  track,
  trackVoteCandidates,
  players,
  maxPlayers,
  riders,
  samplesByDevice,
  chatMessages,
  roomMessages,
  remoteRaceStates,
  latency,
  chatDraft,
  onPlayModeChange,
  onProfileKeyChange,
  onProfileKeyCopy,
  onRiderNameChange,
  onRiderAvailableChange,
  onCreatePrivateRoom,
  onCreateMatch,
  onRespondToMatchInvite,
  onJoinRoom,
  onLeaveRoom,
  onShareInvite,
  onRandomTrack,
  onStartTrackVote,
  onVoteTrack,
  onRoomRouteChoice,
  onResetRoomFlow,
  onQuickMatch,
  onChallengeRider,
  onAcceptChallenge,
  onDeclineChallenge,
  onSendFriendRequest,
  onRespondToFriendRequest,
  onCreateGroup,
  onInviteToGroup,
  onRespondToGroupInvite,
  onChatDraftChange,
  onChatSend,
  workoutVideoAvailable,
  workoutVideoCameraOn,
  workoutVideoEligible,
  workoutVideoJoined,
  workoutVideoJoining,
  workoutVideoParticipantCount,
  workoutVideoStatus,
  workoutVideoSupported,
  workoutVideoVisible,
  onWorkoutVideoCameraToggle,
  onWorkoutVideoJoin,
  onWorkoutVideoLeave,
}: MultiplayerPanelProps) {
  const [profileKeyDraft, setProfileKeyDraft] = useState(profileKey);
  const [selectedRiderIds, setSelectedRiderIds] = useState<string[]>([]);
  const [localSeatCount, setLocalSeatCount] = useState(1);
  const [groupNameDraft, setGroupNameDraft] = useState('');
  const [activeGroupId, setActiveGroupId] = useState('');
  const [workoutVideoSafetyConfirmed, setWorkoutVideoSafetyConfirmed] = useState(false);
  const localBikeCapacity = Math.max(1, Math.min(maxPlayers, players.length || 1));
  const localSeatOptions = Array.from({ length: localBikeCapacity }, (_, index) => index + 1);

  useEffect(() => {
    setWorkoutVideoSafetyConfirmed(false);
  }, [currentRoom?.id]);

  useEffect(() => {
    setProfileKeyDraft(profileKey);
  }, [profileKey]);

  useEffect(() => {
    setSelectedRiderIds((current) => current.filter((riderId) => onlineRiders.some((rider) => rider.id === riderId)));
  }, [onlineRiders]);

  useEffect(() => {
    setLocalSeatCount((current) => Math.max(1, Math.min(localBikeCapacity, current)));
  }, [localBikeCapacity]);

  useEffect(() => {
    setSelectedRiderIds((current) => current.slice(0, Math.max(0, maxPlayers - localSeatCount)));
  }, [localSeatCount, maxPlayers]);

  useEffect(() => {
    if (!activeGroupId && social.groups[0]) {
      setActiveGroupId(social.groups[0].id);
    }
    if (activeGroupId && !social.groups.some((group) => group.id === activeGroupId)) {
      setActiveGroupId(social.groups[0]?.id ?? '');
    }
  }, [activeGroupId, social.groups]);

  const commitProfileKey = () => {
    const nextKey = profileKeyDraft.trim();
    if (nextKey && nextKey !== profileKey) {
      onProfileKeyChange(nextKey);
    } else if (!nextKey) {
      setProfileKeyDraft(profileKey);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onChatSend();
  };

  const toggleSelectedRider = (riderId: string) => {
    setSelectedRiderIds((current) => {
      if (current.includes(riderId)) {
        return current.filter((id) => id !== riderId);
      }
      return current.length + localSeatCount >= maxPlayers ? current : [...current, riderId];
    });
  };

  const handleCreateMatch = () => {
    if (selectedRiderIds.length === 0) {
      return;
    }
    onCreateMatch(selectedRiderIds, localSeatCount);
  };

  const handleCreateGroup = () => {
    const name = groupNameDraft.trim();
    if (!name) {
      return;
    }
    onCreateGroup(name);
    setGroupNameDraft('');
  };
  const multiplayerOnline = playMode === 'multiplayer' && connection === 'open';
  const availableRiders = onlineRiders
    .filter((rider) => rider.id !== currentUserId && rider.available)
    .slice(0, 20);
  const friendRiderIds = new Set(social.friends.map((friend) => friend.riderId).filter(Boolean));
  const pendingFriendNames = new Set([
    ...social.incomingFriendRequests.map((request) => request.fromName),
    ...social.outgoingFriendRequests.map((request) => request.toName),
  ]);
  const selectedGroup = social.groups.find((group) => group.id === activeGroupId) ?? social.groups[0] ?? null;
  const selectedRiders = availableRiders.filter((rider) => selectedRiderIds.includes(rider.id));
  const totalMatchSeats = localSeatCount + selectedRiders.length;
  const matchOverCapacity = totalMatchSeats > maxPlayers;
  const matchSeatSummary = `${localSeatCount} studio bike${localSeatCount === 1 ? '' : 's'}${selectedRiders.length === 0 ? '' : ` + ${selectedRiders.map((rider) => rider.name).join(', ')}`}`;
  const displayedMessages = playMode === 'multiplayer' && currentRoom
    ? roomMessages.map((message) => ({
      id: message.id,
      author: message.author,
      text: message.text,
      at: new Date(message.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    }))
    : chatMessages;
  const remoteTelemetryRows = remoteRaceStates
    .flatMap((state) => state.riders.map((rider) => ({ state, rider })))
    .slice(0, maxPlayers);
  const roomFlow = currentRoom?.flow;
  const isHost = Boolean(currentRoom && currentRoom.hostId === currentUserId);
  const voteCounts = new Map<string, number>();
  Object.values(roomFlow?.votes ?? {}).forEach((trackId) => {
    voteCounts.set(trackId, (voteCounts.get(trackId) ?? 0) + 1);
  });
  const currentVote = currentUserId ? roomFlow?.votes[currentUserId] : undefined;
  const currentRouteChoice = currentUserId ? roomFlow?.routeChoices[currentUserId] : undefined;
  const routeSelectSeconds = roomFlow?.phase === 'route-select' && roomFlow.deadlineAt
    ? Math.max(0, Math.ceil((roomFlow.deadlineAt - Date.now()) / 1000))
    : 0;
  const localLatencyLabel = latencyLabel(latency.rttMs);
  const localLatencyQualityLabel = latencyQualityLabel(latency.quality);
  const roomLatencyLabel = latencyLabel(currentRoom?.maxLatencyMs);
  const roomLatencyQualityLabel = latencyQualityLabel(currentRoom?.latencyQuality);
  const latencyCardQuality = currentRoom?.latencyQuality ?? latency.quality;

  return (
    <aside className="multiplayer-panel">
      <section className="panel-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Race Access</span>
            <h3>Local or multiplayer</h3>
          </div>
          <Users size={18} />
        </div>

        <div className="segmented-control" aria-label="Race access">
          <button
            className={playMode === 'local' ? 'selected' : ''}
            type="button"
            onClick={() => onPlayModeChange('local')}
          >
            Local
          </button>
          <button
            className={playMode === 'multiplayer' ? 'selected' : ''}
            type="button"
            onClick={() => onPlayModeChange('multiplayer')}
          >
            Multiplayer
          </button>
        </div>

        <div className={`multiplayer-status ${multiplayerOnline ? 'online' : ''}`}>
          <RadioTower size={15} />
          <span>{playMode === 'multiplayer' ? status : 'Local-only session. Switch to Multiplayer to go online.'}</span>
        </div>

        {playMode === 'multiplayer' && (
          <div className={`latency-card ${latencyCardQuality}`}>
            <RadioTower size={14} />
            <div>
              <strong>{currentRoom ? `${roomLatencyQualityLabel} room` : `${localLatencyQualityLabel} connection`}</strong>
              <span>{currentRoom ? `Server ${localLatencyLabel} / room max ${roomLatencyLabel}` : `Server ${localLatencyLabel}`}</span>
            </div>
          </div>
        )}

        {playMode === 'multiplayer' && (
          <div className="profile-card">
            <label className="text-field compact">
              <span>Rider name</span>
              <input
                type="text"
                value={riderName}
                onChange={(event) => onRiderNameChange(event.target.value)}
              />
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={riderAvailable}
                onChange={(event) => onRiderAvailableChange(event.target.checked)}
              />
              <span>Available for challenges</span>
            </label>
            <div className="profile-key-row">
              <label className="text-field compact">
                <span>Profile key</span>
                <input
                  type="text"
                  value={profileKeyDraft}
                  spellCheck={false}
                  onBlur={commitProfileKey}
                  onChange={(event) => setProfileKeyDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.currentTarget.blur();
                    }
                  }}
                />
              </label>
              <button
                className="square-button"
                type="button"
                aria-label="Copy profile key"
                onClick={onProfileKeyCopy}
              >
                <Copy size={16} />
              </button>
            </div>
          </div>
        )}

        <div className="room-card">
          <div>
            <span>{currentRoom?.private === false ? 'Public lobby' : 'Private room'}</span>
            <strong>{currentRoom?.id ?? 'No room'}</strong>
          </div>
          <button
            className="square-button"
            type="button"
            aria-label="Copy room invite"
            disabled={!currentRoom || !inviteUrl}
            onClick={onShareInvite}
          >
            <Copy size={16} />
          </button>
        </div>

        <div className="room-actions">
          <button type="button" disabled={!multiplayerOnline} onClick={onCreatePrivateRoom}>
            <UserPlus size={14} /> Private room
          </button>
          <button type="button" disabled={!multiplayerOnline} onClick={onQuickMatch}>
            <Users size={14} /> Quick match
          </button>
          <button type="button" disabled={!currentRoom || !inviteUrl} onClick={onShareInvite}>
            <Link size={14} /> Share link
          </button>
          <button type="button" disabled={!currentRoom} onClick={onRandomTrack}>
            <Shuffle size={14} /> Random track
          </button>
          <button type="button" disabled={!currentRoom || !isHost} onClick={onResetRoomFlow}>
            <X size={14} /> Reset lobby
          </button>
          <button type="button" disabled={!currentRoom} onClick={onLeaveRoom}>
            <LogOut size={14} /> Leave
          </button>
        </div>

        <div className="selected-track-note">
          <RadioTower size={14} />
          <span>{playMode === 'local' ? 'Local session' : 'Room track'}: {track.name}</span>
        </div>
      </section>

      {playMode === 'multiplayer' && currentRoom && (
        <section className="panel-section lobby-flow-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Online Lobby</span>
              <h3>{roomFlow?.phase === 'voting'
                ? 'Track vote'
                : roomFlow?.phase === 'route-select'
                  ? 'Route choice'
                  : roomFlow?.phase === 'race'
                    ? 'Race launch'
                    : 'Race setup'}</h3>
            </div>
            <Vote size={18} />
          </div>

          {(!roomFlow || roomFlow.phase === 'lobby') && (
            <>
              <button
                className="primary-inline-button"
                type="button"
                disabled={!isHost || trackVoteCandidates.length < 3}
                onClick={onStartTrackVote}
              >
                <Shuffle size={15} /> Vote on 3 mapped tracks
              </button>
              <p className="diagnostic-note">
                {trackVoteCandidates.length >= 3
                  ? `${trackVoteCandidates.length} mapped tracks with pedaling zones are eligible.`
                  : 'Map and save at least three tracks with pedaling zones before voting.'}
              </p>
            </>
          )}

          {roomFlow?.phase === 'voting' && (
            <div className="vote-candidate-list">
              {roomFlow.candidates.map((candidate) => (
                <button
                  className={`vote-candidate ${currentVote === candidate.id ? 'selected' : ''}`}
                  key={candidate.id}
                  type="button"
                  onClick={() => onVoteTrack(candidate.id)}
                >
                  <span>
                    <strong>{candidate.name}</strong>
                    <small>{candidate.state}, {candidate.country}{candidate.hasSplits ? ' / split straight' : ''}</small>
                  </span>
                  <b>{voteCounts.get(candidate.id) ?? 0}</b>
                </button>
              ))}
            </div>
          )}

          {roomFlow?.phase === 'route-select' && (
            <div className="route-vote-card">
              <div>
                <Trophy size={16} />
                <span>{routeSelectSeconds}s to choose a split line</span>
              </div>
              <div className="segmented-control compact">
                <button
                  className={(currentRouteChoice ?? 'a') === 'a' ? 'selected' : ''}
                  type="button"
                  onClick={() => onRoomRouteChoice('a')}
                >
                  Amateur Line
                </button>
                <button
                  className={currentRouteChoice === 'b' ? 'selected' : ''}
                  type="button"
                  onClick={() => onRoomRouteChoice('b')}
                >
                  <Zap size={14} />
                  Pro Set
                </button>
              </div>
              <p className="diagnostic-note">No choice defaults to Amateur Line. Pro Set still requires 26+ mph at the split.</p>
            </div>
          )}

          {roomFlow?.phase === 'race' && (
            <div className="route-vote-card">
              <div>
                <Trophy size={16} />
                <span>{currentRoom.latencyQuality === 'poor'
                  ? 'Race launch sent. High latency warning active.'
                  : 'Race launch sent. Full-screen gate starts on each racer device.'}</span>
              </div>
            </div>
          )}
        </section>
      )}

      {playMode === 'multiplayer' && currentRoom?.private && workoutVideoVisible && (
        <section className="panel-section workout-video-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Optional live video</span>
              <h3>Workout Cameras</h3>
            </div>
            {workoutVideoJoined ? <Video size={18} /> : <VideoOff size={18} />}
          </div>

          <div className="workout-video-card">
            <div className="workout-video-safety">
              <ShieldCheck size={19} />
              <div>
                <strong>Private camera-only room</strong>
                <span>Daily audio, chat, recording, transcription and screen sharing are disabled.</span>
                <span>Use video only with people you know. Never share private information.</span>
              </div>
            </div>
            {workoutVideoJoined ? (
              <div className="workout-video-card-controls">
                <button type="button" onClick={onWorkoutVideoCameraToggle}>
                  {workoutVideoCameraOn ? <VideoOff size={15} /> : <Video size={15} />}
                  {workoutVideoCameraOn ? 'Camera off' : 'Camera on'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setWorkoutVideoSafetyConfirmed(false);
                    onWorkoutVideoLeave();
                  }}
                >
                  <X size={15} />
                  Leave video
                </button>
              </div>
            ) : (
              <>
                <label className="workout-video-consent">
                  <input
                    type="checkbox"
                    checked={workoutVideoSafetyConfirmed}
                    onChange={(event) => setWorkoutVideoSafetyConfirmed(event.target.checked)}
                  />
                  <span>
                    I am 13 or older, I have permission to share this camera, and an adult is
                    supervising any rider under 18.
                  </span>
                </label>
                <button
                  type="button"
                  disabled={
                    !multiplayerOnline
                    || !workoutVideoEligible
                    || !workoutVideoSupported
                    || !workoutVideoAvailable
                    || !workoutVideoSafetyConfirmed
                    || workoutVideoJoining
                  }
                  onClick={onWorkoutVideoJoin}
                >
                  <Video size={15} />
                  {workoutVideoJoining ? 'Connecting camera…' : 'Share workout camera'}
                </button>
              </>
            )}
            <span>
              {workoutVideoStatus}
              {workoutVideoJoined ? ` / ${workoutVideoParticipantCount} connected` : ''}
            </span>
            <small>
              Opt-in every session · up to four invited racers · riders under 13 cannot use
              workout cameras until verified guardian consent is available
            </small>
          </div>
        </section>
      )}

      {playMode === 'multiplayer' && incomingMatchInvites.length > 0 && (
        <section className="panel-section challenge-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Match Invite</span>
              <h3>{incomingMatchInvites.length} pending</h3>
            </div>
          </div>
          {incomingMatchInvites.map(({ invite, from }) => (
            <div className="challenge-card" key={invite.id}>
              <div>
                <strong>{from.name}</strong>
                <span>{invite.track.name}</span>
              </div>
              <button type="button" onClick={() => onRespondToMatchInvite(invite.id, true)}><Check size={14} /> Accept</button>
              <button type="button" onClick={() => onRespondToMatchInvite(invite.id, false)}><X size={14} /> Decline</button>
            </div>
          ))}
        </section>
      )}

      {playMode === 'multiplayer' && incomingChallenges.length > 0 && (
        <section className="panel-section challenge-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Incoming</span>
              <h3>Challenge request</h3>
            </div>
          </div>
          {incomingChallenges.map(({ challenge, from }) => (
            <div className="challenge-card" key={challenge.id}>
              <div>
                <strong>{from.name}</strong>
                <span>{challenge.track.name}</span>
              </div>
              <button type="button" onClick={() => onAcceptChallenge(challenge.id)}><Check size={14} /> Accept</button>
              <button type="button" onClick={() => onDeclineChallenge(challenge.id)}><X size={14} /> Decline</button>
            </div>
          ))}
        </section>
      )}

      {playMode === 'multiplayer' && (
        <section className="panel-section online-section community-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Community</span>
              <h3>{availableRiders.length} available</h3>
            </div>
            <Users size={18} />
          </div>

          <div className="match-builder-card">
            <div className="match-builder-copy">
              <strong>{totalMatchSeats} / {maxPlayers} racer seats</strong>
              <span>{selectedRiders.length === 0 ? 'Choose your studio seats, then select racers' : matchSeatSummary}</span>
              <div className="studio-seat-selector" aria-label="Studio bike seats">
                <b>Studio seats</b>
                {localSeatOptions.map((seatCount) => (
                  <button
                    key={seatCount}
                    type="button"
                    className={seatCount === localSeatCount ? 'active' : ''}
                    onClick={() => setLocalSeatCount(seatCount)}
                  >
                    {seatCount}
                  </button>
                ))}
              </div>
            </div>
            <button
              className="primary-inline-button"
              type="button"
              disabled={!multiplayerOnline || selectedRiderIds.length === 0 || matchOverCapacity}
              onClick={handleCreateMatch}
            >
              <UserPlus size={15} /> Create Match
            </button>
          </div>

          <div className="online-rider-list">
            {availableRiders.length === 0 && <div className="empty-compact">No available riders yet.</div>}
            {availableRiders.map((rider) => (
              <div className="online-rider-row" key={rider.id}>
                <div>
                  <strong>{rider.name}</strong>
                  <span>{rider.bikeCount} bike{rider.bikeCount === 1 ? '' : 's'} / {latencyLabel(rider.latencyMs)} / {rider.track.name}</span>
                </div>
                <button
                  type="button"
                  className={selectedRiderIds.includes(rider.id) ? 'selected-mini-button' : ''}
                  disabled={!selectedRiderIds.includes(rider.id) && totalMatchSeats >= maxPlayers}
                  onClick={() => toggleSelectedRider(rider.id)}
                >
                  {selectedRiderIds.includes(rider.id) ? 'Selected' : 'Select'}
                </button>
                <button type="button" onClick={() => onChallengeRider(rider.id)}>1v1</button>
                <button
                  type="button"
                  disabled={friendRiderIds.has(rider.id) || pendingFriendNames.has(rider.name)}
                  onClick={() => onSendFriendRequest(rider.id)}
                >
                  Friend
                </button>
                {selectedGroup && (
                  <button type="button" onClick={() => onInviteToGroup(selectedGroup.id, rider.id)}>
                    Group
                  </button>
                )}
              </div>
            ))}
          </div>

          {(social.incomingFriendRequests.length > 0 || social.incomingGroupInvites.length > 0) && (
            <div className="social-request-list">
              {social.incomingFriendRequests.map((request) => (
                <div className="social-request-row" key={request.id}>
                  <div>
                    <strong>{request.fromName}</strong>
                    <span>Friend request</span>
                  </div>
                  <button type="button" onClick={() => onRespondToFriendRequest(request.id, true)}><Check size={14} /></button>
                  <button type="button" onClick={() => onRespondToFriendRequest(request.id, false)}><X size={14} /></button>
                </div>
              ))}
              {social.incomingGroupInvites.map((invite) => (
                <div className="social-request-row" key={invite.id}>
                  <div>
                    <strong>{invite.groupName}</strong>
                    <span>{invite.fromName}</span>
                  </div>
                  <button type="button" onClick={() => onRespondToGroupInvite(invite.id, true)}><Check size={14} /></button>
                  <button type="button" onClick={() => onRespondToGroupInvite(invite.id, false)}><X size={14} /></button>
                </div>
              ))}
            </div>
          )}

          <div className="friends-groups-grid">
            <div className="social-list-card">
              <span className="eyebrow">Friends</span>
              {social.friends.length === 0 && <div className="empty-compact">No friends yet.</div>}
              {social.friends.slice(0, 8).map((friend) => (
                <div className="social-mini-row" key={friend.guestKey}>
                  <div>
                    <strong>{friend.name}</strong>
                    <span>{friend.online ? (friend.available ? 'Available' : 'Online') : 'Offline'}</span>
                  </div>
                  {friend.riderId && (
                    <button type="button" onClick={() => toggleSelectedRider(friend.riderId ?? '')}>Select</button>
                  )}
                </div>
              ))}
            </div>

            <div className="social-list-card">
              <span className="eyebrow">Groups</span>
              <div className="group-create-row">
                <input
                  type="text"
                  value={groupNameDraft}
                  placeholder="Group name"
                  onChange={(event) => setGroupNameDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      handleCreateGroup();
                    }
                  }}
                />
                <button type="button" disabled={!groupNameDraft.trim()} onClick={handleCreateGroup}>
                  <Plus size={14} />
                </button>
              </div>
              {social.groups.length === 0 && <div className="empty-compact">No groups yet.</div>}
              {social.groups.slice(0, 5).map((group: MultiplayerGroup) => (
                <button
                  className={`group-row ${selectedGroup?.id === group.id ? 'selected' : ''}`}
                  type="button"
                  key={group.id}
                  onClick={() => setActiveGroupId(group.id)}
                >
                  <strong>{group.name}</strong>
                  <span>{group.members.length} member{group.members.length === 1 ? '' : 's'}</span>
                </button>
              ))}
            </div>
          </div>

          {rooms.length > 0 && (
            <div className="open-room-list">
              <span>Live rooms</span>
              {rooms.slice(0, 4).map((room) => (
                <button
                  className="open-room-link"
                  type="button"
                  key={room.id}
                  disabled={!multiplayerOnline || currentRoom?.id === room.id}
                  onClick={() => onJoinRoom(room.id)}
                >
                  {room.id} / {room.private ? 'private' : 'public'} / {room.racerSeatCount ?? room.racerCount ?? room.memberCount} racer seats / {latencyQualityLabel(room.latencyQuality)} {latencyLabel(room.maxLatencyMs)} / {room.track.name}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {playMode === 'multiplayer' && currentRoom && (
        <section className="panel-section room-telemetry-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Room Telemetry</span>
              <h3>{remoteTelemetryRows.length} remote rider{remoteTelemetryRows.length === 1 ? '' : 's'}</h3>
            </div>
            <RadioTower size={18} />
          </div>

          <div className="room-telemetry-list">
            {remoteTelemetryRows.length === 0 && <div className="empty-compact">Waiting for remote race data.</div>}
            {remoteTelemetryRows.map(({ state, rider }) => (
              <div className="room-telemetry-row" style={{ '--player-color': rider.accent } as React.CSSProperties} key={`${state.clientId}-${rider.id}`}>
                <span className="player-chip">R</span>
                <div>
                  <strong>{rider.name}</strong>
                  <span>{state.raceState} / rank {rider.rank}</span>
                </div>
                <strong>{rider.watts} W</strong>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="panel-section roster-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Riders</span>
            <h3>{players.length} / {maxPlayers} connected</h3>
          </div>
        </div>
        <div className="roster-list">
          {players.length === 0 && <div className="empty-compact">Waiting for Wattbikes.</div>}
          {players.map((player) => {
            const sample = sampleForPlayer(player, samplesByDevice);
            const rider = riders.find((item) => item.playerId === player.id);

            return (
              <div className="roster-row" style={{ '--player-color': player.accent } as React.CSSProperties} key={player.id}>
                <span className="player-chip">P{player.id}</span>
                <div>
                  <strong>{player.name}</strong>
                  <span>{player.deviceId ? `Wattbike ${player.deviceId}` : 'Unassigned'}</span>
                </div>
                <strong>{sample?.watts ?? rider?.lastWatts ?? 0} W</strong>
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel-section chat-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Room Chat</span>
            <h3>Race notes</h3>
          </div>
          <MessageSquare size={18} />
        </div>

        <div className="chat-log">
          {displayedMessages.map((message) => (
            <div className="chat-message" key={message.id}>
              <div>
                <strong>{message.author}</strong>
                <span>{message.at}</span>
              </div>
              <p>{message.text}</p>
            </div>
          ))}
        </div>

        <form className="chat-form" onSubmit={handleSubmit}>
          <input
            placeholder="Type a message..."
            value={chatDraft}
            onChange={(event) => onChatDraftChange(event.target.value)}
          />
          <button className="square-button" type="submit" aria-label="Send chat message">
            <Send size={16} />
          </button>
        </form>
      </section>
    </aside>
  );
}
