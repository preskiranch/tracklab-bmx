import type { FormEvent } from 'react';
import { Copy, Link, MessageSquare, RadioTower, Send, UserPlus, Users } from 'lucide-react';
import type { BikeSample, PlayMode, PlayerSlot, RiderState, TrackRecord } from '../types';

export type ChatMessage = {
  id: number;
  author: string;
  text: string;
  at: string;
};

type MultiplayerPanelProps = {
  playMode: PlayMode;
  accountsEnabled: boolean;
  roomCode: string;
  track: TrackRecord;
  players: PlayerSlot[];
  maxPlayers: number;
  riders: RiderState[];
  samplesByDevice: Map<number, BikeSample>;
  chatMessages: ChatMessage[];
  chatDraft: string;
  onPlayModeChange: (mode: PlayMode) => void;
  onAccountsEnabledChange: (enabled: boolean) => void;
  onChatDraftChange: (value: string) => void;
  onChatSend: () => void;
};

function sampleForPlayer(player: PlayerSlot, samplesByDevice: Map<number, BikeSample>) {
  return player.deviceId == null ? undefined : samplesByDevice.get(player.deviceId);
}

export function MultiplayerPanel({
  playMode,
  accountsEnabled,
  roomCode,
  track,
  players,
  maxPlayers,
  riders,
  samplesByDevice,
  chatMessages,
  chatDraft,
  onPlayModeChange,
  onAccountsEnabledChange,
  onChatDraftChange,
  onChatSend,
}: MultiplayerPanelProps) {
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onChatSend();
  };

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

        <label className="toggle-row">
          <input
            type="checkbox"
            checked={accountsEnabled}
            onChange={(event) => onAccountsEnabledChange(event.target.checked)}
          />
          <span>Accounts optional</span>
        </label>

        <div className="room-card">
          <div>
            <span>Private room</span>
            <strong>{roomCode}</strong>
          </div>
          <button className="square-button" type="button" aria-label="Copy room code">
            <Copy size={16} />
          </button>
        </div>

        <div className="room-actions">
          <button type="button"><Link size={14} /> Share link</button>
          <button type="button"><UserPlus size={14} /> Invite</button>
        </div>

        <div className="selected-track-note">
          <RadioTower size={14} />
          <span>{playMode === 'local' ? 'Local session' : 'Room track'}: {track.name}</span>
        </div>
      </section>

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
          {chatMessages.map((message) => (
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
