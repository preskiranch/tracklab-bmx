import type { FormEvent } from 'react';
import {
  Check,
  Copy,
  Link,
  LogOut,
  MessageSquare,
  RadioTower,
  Send,
  Shuffle,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import type {
  BikeSample,
  MultiplayerChallenge,
  MultiplayerRaceState,
  MultiplayerRider,
  MultiplayerRoom,
  MultiplayerRoomMessage,
  PlayMode,
  PlayerSlot,
  RiderState,
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
  inviteUrl: string;
  track: TrackRecord;
  players: PlayerSlot[];
  maxPlayers: number;
  riders: RiderState[];
  samplesByDevice: Map<number, BikeSample>;
  chatMessages: ChatMessage[];
  roomMessages: MultiplayerRoomMessage[];
  remoteRaceStates: MultiplayerRaceState[];
  chatDraft: string;
  onPlayModeChange: (mode: PlayMode) => void;
  onRiderNameChange: (name: string) => void;
  onRiderAvailableChange: (available: boolean) => void;
  onCreatePrivateRoom: () => void;
  onLeaveRoom: () => void;
  onShareInvite: () => void;
  onRandomTrack: () => void;
  onQuickMatch: () => void;
  onChallengeRider: (riderId: string) => void;
  onAcceptChallenge: (challengeId: string) => void;
  onDeclineChallenge: (challengeId: string) => void;
  onChatDraftChange: (value: string) => void;
  onChatSend: () => void;
};

function sampleForPlayer(player: PlayerSlot, samplesByDevice: Map<number, BikeSample>) {
  return player.deviceId == null ? undefined : samplesByDevice.get(player.deviceId);
}

export function MultiplayerPanel({
  playMode,
  connection,
  status,
  riderName,
  riderAvailable,
  currentUserId,
  currentRoom,
  rooms,
  onlineRiders,
  incomingChallenges,
  inviteUrl,
  track,
  players,
  maxPlayers,
  riders,
  samplesByDevice,
  chatMessages,
  roomMessages,
  remoteRaceStates,
  chatDraft,
  onPlayModeChange,
  onRiderNameChange,
  onRiderAvailableChange,
  onCreatePrivateRoom,
  onLeaveRoom,
  onShareInvite,
  onRandomTrack,
  onQuickMatch,
  onChallengeRider,
  onAcceptChallenge,
  onDeclineChallenge,
  onChatDraftChange,
  onChatSend,
}: MultiplayerPanelProps) {
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onChatSend();
  };
  const multiplayerOnline = playMode === 'multiplayer' && connection === 'open';
  const availableRiders = onlineRiders
    .filter((rider) => rider.id !== currentUserId && rider.available)
    .slice(0, 8);
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
    .slice(0, 8);

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
          </div>
        )}

        <div className="room-card">
          <div>
            <span>Private room</span>
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
            <UserPlus size={14} /> Create room
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
          <button type="button" disabled={!currentRoom} onClick={onLeaveRoom}>
            <LogOut size={14} /> Leave
          </button>
        </div>

        <div className="selected-track-note">
          <RadioTower size={14} />
          <span>{playMode === 'local' ? 'Local session' : 'Room track'}: {track.name}</span>
        </div>
      </section>

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
        <section className="panel-section online-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Online</span>
              <h3>{availableRiders.length} riders available</h3>
            </div>
            <Users size={18} />
          </div>

          <div className="online-rider-list">
            {availableRiders.length === 0 && <div className="empty-compact">No available riders yet.</div>}
            {availableRiders.map((rider) => (
              <div className="online-rider-row" key={rider.id}>
                <div>
                  <strong>{rider.name}</strong>
                  <span>{rider.bikeCount} bike{rider.bikeCount === 1 ? '' : 's'} / {rider.track.name}</span>
                </div>
                <button type="button" onClick={() => onChallengeRider(rider.id)}>Challenge</button>
              </div>
            ))}
          </div>

          {rooms.length > 0 && (
            <div className="open-room-list">
              <span>Live private rooms</span>
              {rooms.slice(0, 4).map((room) => (
                <small key={room.id}>{room.id} / {room.memberCount} riders / {room.track.name}</small>
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
