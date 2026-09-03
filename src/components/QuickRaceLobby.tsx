import { useMemo, useState, type FormEvent } from 'react';
import {
  Check,
  Flag,
  Globe2,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  RefreshCw,
  Search,
  Share2,
  TabletSmartphone,
  UsersRound,
} from 'lucide-react';
import type {
  MultiplayerMatchmakingState,
  MultiplayerRider,
  MultiplayerRoom,
  SplitBranchChoice,
} from '../types';
import './QuickRaceLobby.css';

export type QuickRaceLobbyMatchmakingStatus = MultiplayerMatchmakingState;

type QuickRaceLobbyAction = () => void | boolean | Promise<void>;

export type QuickRaceLobbyProps<TRoom extends MultiplayerRoom = MultiplayerRoom> = Readonly<{
  room: TRoom | null;
  localRiderId: string | null;
  /** True only for a restored, authenticated tablet assigned to this club. */
  isAuthenticatedClubTablet: boolean;
  /** Human-readable, exact summary of the setup that every racer will receive. */
  setupLabel: string;
  /** Local prerequisite that must be fixed before opening or confirming a race. */
  setupProblem?: string;
  matchmaking: QuickRaceLobbyMatchmakingStatus;
  /** True after the room's exact setup has been applied on this device. */
  setupReady?: boolean;
  /** Connection or server feedback shown where racers take actions. */
  statusMessage?: string;
  /** Compact local-training entry point; entering online mode reveals race choices. */
  localEntry?: boolean;
  /** True when the host's locally selected next setup is complete and can be confirmed. */
  canConfirmSetup?: boolean;
  disabled?: boolean;
  onEnterMultiplayer?: QuickRaceLobbyAction;
  onQuickMatch: (scope: 'studio' | 'world') => void | Promise<void>;
  onCancelMatchmaking: QuickRaceLobbyAction;
  onStartStudioMatch: QuickRaceLobbyAction;
  onCreatePrivate: QuickRaceLobbyAction;
  onJoinCode: (code: string) => void | boolean | Promise<void>;
  onReady: (ready: boolean) => void | Promise<void>;
  onStart: QuickRaceLobbyAction;
  onRaceAgain: QuickRaceLobbyAction;
  onChangeSetup: QuickRaceLobbyAction;
  onConfirmSetup: QuickRaceLobbyAction;
  onRouteChoice: (choice: SplitBranchChoice) => void | Promise<void>;
  onLeave: QuickRaceLobbyAction;
  onShare: QuickRaceLobbyAction;
  onUseSoloTraining?: QuickRaceLobbyAction;
}>;

export type QuickRaceLobbySeat = Readonly<{
  key: string;
  memberId: string;
  name: string;
  ready: boolean;
}>;

export function normalizeQuickRaceCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

export function displayQuickRaceCode(roomId: string) {
  const normalized = roomId.toUpperCase().trim();
  const separator = normalized.lastIndexOf('-');
  return normalizeQuickRaceCode(separator >= 0 ? normalized.slice(separator + 1) : normalized);
}

function roomRacers(room: MultiplayerRoom) {
  return room.members.filter((member) => member.roomRole !== 'spectator');
}

function memberIsReady(room: MultiplayerRoom, member: MultiplayerRider) {
  return member.ready === true || room.readyMemberIds?.includes(member.id) === true;
}

export function quickRaceLobbySeats(room: MultiplayerRoom): QuickRaceLobbySeat[] {
  const seats: QuickRaceLobbySeat[] = [];
  roomRacers(room).forEach((member) => {
    const memberSeatCount = Math.max(1, Math.min(4, Math.round(member.racerSeatCount ?? 1)));
    for (let seatIndex = 0; seatIndex < memberSeatCount && seats.length < 4; seatIndex += 1) {
      seats.push({
        key: `${member.id}:${seatIndex}`,
        memberId: member.id,
        name: memberSeatCount > 1 ? `${member.name} · Rider ${seatIndex + 1}` : member.name,
        ready: memberIsReady(room, member),
      });
    }
  });
  return seats;
}

export function canStartQuickRace(room: MultiplayerRoom) {
  const racers = roomRacers(room);
  const seatCount = quickRaceLobbySeats(room).length;
  return room.flow.phase === 'lobby'
    && seatCount >= 2
    && seatCount <= 4
    && racers.length > 0
    && racers.every((member) => memberIsReady(room, member));
}

function activityTitle(room: MultiplayerRoom | null) {
  if (room?.setup?.configuration.activityType === 'straight-sprint') return 'Straight Sprint';
  return 'Race Intervals';
}

function roomSetupDetails(room: MultiplayerRoom) {
  const configuration = room.setup?.configuration;
  if (!configuration) return [];
  if (configuration.activityType === 'straight-sprint') {
    return [
      configuration.courseName,
      `${Math.round(configuration.distanceFeet)} ft`,
      `Air ${Math.round(configuration.airSetting)}`,
    ];
  }
  return [
    configuration.trackName,
    configuration.routeVariantId
      ? `${configuration.routeVariantId === 'pro' ? 'Pro' : 'Amateur'} route`
      : 'Full route',
    `${configuration.lapCount} ${configuration.lapCount === 1 ? 'lap' : 'laps'}`,
  ].filter((value): value is string => Boolean(value));
}

function SearchingState({
  matchmaking,
  disabled,
  onCancel,
  onStartStudioMatch,
}: Readonly<{
  matchmaking: QuickRaceLobbyMatchmakingStatus;
  disabled: boolean;
  onCancel: QuickRaceLobbyAction;
  onStartStudioMatch: QuickRaceLobbyAction;
}>) {
  const studio = matchmaking.scope === 'studio';
  return (
    <section className="quick-race-searching" aria-live="polite" aria-busy="true">
      <LoaderCircle className="quick-race-spin" size={34} aria-hidden="true" />
      <div>
        <span className="quick-race-eyebrow">Finding racers</span>
        <h3>{studio ? 'Looking for this studio’s tablets' : 'Quick Match worldwide'}</h3>
        <p>
          {matchmaking.message
            || (studio
              ? 'TrackLab is matching 2–4 ready athletes from this club.'
              : 'TrackLab is finding 2–4 racers for this activity, then applies one shared setup.')}
        </p>
        {matchmaking.queuedRacers > 0 && (
          <strong>{Math.min(4, matchmaking.queuedRacers)} of 4 racers found</strong>
        )}
      </div>
      <div className="quick-race-search-actions">
        {studio && matchmaking.queuedRacers >= 2 && matchmaking.queuedRacers < 4 && (
          <button type="button" className="quick-race-button primary" disabled={disabled} onClick={onStartStudioMatch}>
            <Flag size={18} aria-hidden="true" /> Start with {matchmaking.queuedRacers} racers
          </button>
        )}
        <button type="button" className="quick-race-button secondary" disabled={disabled} onClick={onCancel}>
          Cancel search
        </button>
      </div>
    </section>
  );
}

export default function QuickRaceLobby<TRoom extends MultiplayerRoom = MultiplayerRoom>({
  room,
  localRiderId,
  isAuthenticatedClubTablet,
  setupLabel,
  setupProblem = '',
  matchmaking,
  setupReady = true,
  statusMessage = '',
  localEntry = false,
  canConfirmSetup = Boolean(setupLabel),
  disabled = false,
  onEnterMultiplayer,
  onQuickMatch,
  onCancelMatchmaking,
  onStartStudioMatch,
  onCreatePrivate,
  onJoinCode,
  onReady,
  onStart,
  onRaceAgain,
  onChangeSetup,
  onConfirmSetup,
  onRouteChoice,
  onLeave,
  onShare,
  onUseSoloTraining,
}: QuickRaceLobbyProps<TRoom>) {
  const [joinCode, setJoinCode] = useState('');
  const [joinCodeError, setJoinCodeError] = useState('');
  const seats = useMemo(() => room ? quickRaceLobbySeats(room) : [], [room]);
  const racers = useMemo(() => room ? roomRacers(room) : [], [room]);
  const localRacer = racers.find((member) => member.id === localRiderId) ?? null;
  const localReady = room && localRacer ? memberIsReady(room, localRacer) : false;
  const isHost = Boolean(room && localRiderId && room.hostId === localRiderId);
  const setupDetails = useMemo(() => room ? roomSetupDetails(room) : [], [room]);
  const roundComplete = room?.flow.phase === 'round-complete';
  const selectingSetup = room?.flow.phase === 'setup-select';
  const roomConfiguration = room?.setup?.configuration;
  const raceLineSplitSections = roomConfiguration?.activityType === 'bmx-race'
    ? (roomConfiguration.routeVariantId
        ? roomConfiguration.trackRecord?.routeVariants?.find(
            (variant) => variant.id === roomConfiguration.routeVariantId,
          )?.splitSections
        : roomConfiguration.trackRecord?.splitSections)
      ?? roomConfiguration.trackRecord?.splitSections
    : undefined;
  const hasSplitLineChoice = (raceLineSplitSections?.length ?? 0) > 0;
  const localRouteChoice: SplitBranchChoice = localRiderId
    && room?.flow.routeChoices[localRiderId] === 'b' ? 'b' : 'a';
  const canStart = room ? canStartQuickRace(room) : false;
  const automaticMatchStart = room?.matchmakingScope === 'studio'
    || room?.matchmakingScope === 'world';
  const localSetupAvailable = Boolean(setupLabel) && !setupProblem;

  const submitJoinCode = (event: FormEvent) => {
    event.preventDefault();
    const code = normalizeQuickRaceCode(joinCode);
    if (code.length !== 6) {
      setJoinCodeError('Enter the 6-character race code.');
      return;
    }
    setJoinCodeError('');
    void onJoinCode(code);
  };

  if (!room && matchmaking.active) {
    return (
      <div className="quick-race-lobby">
        <SearchingState
          matchmaking={matchmaking}
          disabled={disabled}
          onCancel={onCancelMatchmaking}
          onStartStudioMatch={onStartStudioMatch}
        />
      </div>
    );
  }

  if (!room && localEntry) {
    return (
      <section className="quick-race-lobby quick-race-local-entry" aria-labelledby="quick-race-local-title">
        <span className="quick-race-icon"><UsersRound size={25} aria-hidden="true" /></span>
        <div>
          <span className="quick-race-eyebrow">Optional multiplayer · solo training stays available</span>
          <h2 id="quick-race-local-title">Race Together (2–4)</h2>
          <p>Keep these settings and connect studio tablets, find a worldwide race, or invite friends with one code.</p>
          {(setupProblem || setupLabel) && (
            <strong className="quick-race-local-setup">{setupProblem || setupLabel}</strong>
          )}
        </div>
        <button
          type="button"
          className="quick-race-button primary"
          disabled={disabled || !localSetupAvailable || !onEnterMultiplayer}
          onClick={onEnterMultiplayer}
        >
          <UsersRound size={20} aria-hidden="true" /> Race Together
        </button>
      </section>
    );
  }

  if (!room) {
    return (
      <section className="quick-race-lobby" aria-labelledby="quick-race-title">
        <header className="quick-race-heading">
          <span className="quick-race-icon"><UsersRound size={25} aria-hidden="true" /></span>
          <div>
            <span className="quick-race-eyebrow">2–4 racers · one synchronized setup</span>
            <h2 id="quick-race-title">Race Together</h2>
            <p>Choose the simplest way to put every racer on the same activity, course, and settings.</p>
          </div>
        </header>

        <div className="quick-race-current-setup">
          <Flag size={20} aria-hidden="true" />
          <div>
            <span>Setup everyone will use</span>
            <strong>{setupProblem || setupLabel || 'Choose Race Intervals or Straight Sprint settings first'}</strong>
          </div>
        </div>

        <div className="quick-race-entry-grid">
          {isAuthenticatedClubTablet && (
            <button
              type="button"
              className="quick-race-entry primary"
              disabled={disabled || !localSetupAvailable}
              onClick={() => void onQuickMatch('studio')}
            >
              <TabletSmartphone size={27} aria-hidden="true" />
              <span>
                <strong>Race at this studio</strong>
                <small>Automatically find the other authorized club tablets.</small>
              </span>
            </button>
          )}
          <button
            type="button"
            className={`quick-race-entry ${isAuthenticatedClubTablet ? '' : 'primary'}`}
            disabled={disabled || !localSetupAvailable}
            onClick={() => void onQuickMatch('world')}
          >
            <Globe2 size={27} aria-hidden="true" />
              <span>
                <strong>Quick Match worldwide</strong>
                <small>Find 2–4 racers; everyone receives one shared setup.</small>
              </span>
          </button>
          <button
            type="button"
            className="quick-race-entry"
            disabled={disabled || !localSetupAvailable}
            onClick={() => void onCreatePrivate()}
          >
            <LockKeyhole size={27} aria-hidden="true" />
            <span>
              <strong>Create private race</strong>
              <small>Share one short code with people you know.</small>
            </span>
          </button>
        </div>

        <form className="quick-race-join" onSubmit={submitJoinCode}>
          <label htmlFor="quick-race-code">
            <span>Have a race code?</span>
            <input
              id="quick-race-code"
              type="text"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              maxLength={6}
              value={joinCode}
              aria-invalid={Boolean(joinCodeError)}
              aria-describedby={joinCodeError ? 'quick-race-code-error' : undefined}
              placeholder="ABC123"
              onChange={(event) => {
                setJoinCode(normalizeQuickRaceCode(event.target.value));
                if (joinCodeError) setJoinCodeError('');
              }}
            />
          </label>
          <button className="quick-race-button secondary" type="submit" disabled={disabled || joinCode.length !== 6}>
            <Search size={18} aria-hidden="true" /> Join race
          </button>
          {joinCodeError && <p id="quick-race-code-error" className="quick-race-code-error">{joinCodeError}</p>}
        </form>
        {statusMessage && (
          <p className="quick-race-status-message" role="status" aria-live="polite">{statusMessage}</p>
        )}
        {onUseSoloTraining && (
          <footer className="quick-race-room-footer quick-race-solo-footer">
            <button type="button" disabled={disabled && matchmaking.active} onClick={onUseSoloTraining}>
              <LogOut size={17} aria-hidden="true" /> Use this device only
            </button>
          </footer>
        )}
      </section>
    );
  }

  return (
    <section className="quick-race-lobby in-room" aria-labelledby="quick-race-title">
      <header className="quick-race-room-heading">
        <div>
          <span className="quick-race-eyebrow">
            {roundComplete
              ? `Round ${room.roundNumber ?? 1} complete`
              : selectingSetup ? 'Next race setup' : 'Shared race lobby'}
          </span>
          <h2 id="quick-race-title">
            {roundComplete ? 'Ready for the next race' : selectingSetup ? 'Choose the next setup' : activityTitle(room)}
          </h2>
          <p>{selectingSetup
            ? (isHost
              ? 'Use the Race Intervals or Straight Sprint controls above, then confirm the exact setup for everyone.'
              : 'The host is choosing the next Race Intervals or Straight Sprint setup for this group.')
            : setupLabel || 'This exact setup is locked for everyone in the room.'}</p>
        </div>
        <div className="quick-race-code-card" aria-label={`Race code ${displayQuickRaceCode(room.id)}`}>
          <span>Race code</span>
          <strong>{displayQuickRaceCode(room.id)}</strong>
        </div>
      </header>

      <div className={`quick-race-setup-summary${selectingSetup ? ' is-selecting' : ''}`} aria-label="Shared race setup">
        <Flag size={20} aria-hidden="true" />
        <div>
          <span>{selectingSetup ? (isHost ? 'Your next setup' : 'Waiting for host setup') : 'Same on every screen'}</span>
          <strong>{selectingSetup
            ? (isHost ? setupLabel || 'Choose a complete setup above' : 'Setup not confirmed yet')
            : setupLabel || activityTitle(room)}</strong>
          {!selectingSetup && setupDetails.length > 0 && (
            <div className="quick-race-setup-tags">
              {setupDetails.map((detail) => <small key={detail}>{detail}</small>)}
            </div>
          )}
        </div>
        {!selectingSetup && <LockKeyhole size={18} aria-label="Setup locked" />}
      </div>

      <div className="quick-race-slot-section">
        <div className="quick-race-section-title">
          <div>
            <span className="quick-race-eyebrow">Racers</span>
            <h3>{seats.length} of 4 seats</h3>
          </div>
          <strong>{seats.length < 2 ? `${2 - seats.length} more needed` : 'Enough racers to start'}</strong>
        </div>
        <ol className="quick-race-slots">
          {Array.from({ length: 4 }, (_, index) => {
            const seat = seats[index];
            return (
              <li key={seat?.key ?? `empty:${index}`} className={seat ? (seat.ready ? 'ready' : 'joined') : 'empty'}>
                <b>{index + 1}</b>
                <span>
                  <strong>{seat?.name ?? 'Open seat'}</strong>
                  <small>{seat
                    ? (selectingSetup ? 'Waiting for setup' : seat.ready ? 'Ready' : 'Tap Ready')
                    : 'Waiting for a racer'}</small>
                </span>
                {seat?.ready && <Check size={20} aria-label="Ready" />}
              </li>
            );
          })}
        </ol>
      </div>

      {hasSplitLineChoice && localRacer && room.flow.phase === 'lobby' && (
        <div className="quick-race-line-choice">
          <div>
            <span className="quick-race-eyebrow">Your race line</span>
            <h3>Choose your mapped split</h3>
            <p>This affects only your rider. Changing it clears your Ready state.</p>
          </div>
          <div className="quick-race-line-buttons" role="group" aria-label="Your mapped split line">
            <button
              type="button"
              className={localRouteChoice === 'a' ? 'selected' : ''}
              aria-pressed={localRouteChoice === 'a'}
              disabled={disabled || !setupReady}
              onClick={() => void onRouteChoice('a')}
            >
              Amateur Line
            </button>
            <button
              type="button"
              className={localRouteChoice === 'b' ? 'selected' : ''}
              aria-pressed={localRouteChoice === 'b'}
              disabled={disabled || !setupReady}
              onClick={() => void onRouteChoice('b')}
            >
              Pro Set
            </button>
          </div>
        </div>
      )}

      {roundComplete ? (
        <div className="quick-race-round-actions" aria-live="polite">
          {isHost ? (
            <>
              <div>
                <span className="quick-race-eyebrow">Keep this group together</span>
                <h3>What should everyone race next?</h3>
                <p>Race again with this setup, or change the activity/setup for the next synchronized round.</p>
              </div>
              <button className="quick-race-button primary" type="button" disabled={disabled} onClick={onRaceAgain}>
                <RefreshCw size={19} aria-hidden="true" /> Race again
              </button>
              <button className="quick-race-button secondary" type="button" disabled={disabled} onClick={onChangeSetup}>
                Change activity/setup
              </button>
            </>
          ) : (
            <div>
              <span className="quick-race-eyebrow">Stay in this room</span>
              <h3>Waiting for the host</h3>
              <p>The host is choosing Race again or a new activity/setup for this group.</p>
            </div>
          )}
        </div>
      ) : selectingSetup ? (
        <div className="quick-race-round-actions quick-race-setup-selection" aria-live="polite">
          {isHost ? (
            <>
              <div>
                <span className="quick-race-eyebrow">Host setup controls are unlocked</span>
                <h3>Confirm when the next race looks right</h3>
                <p>Confirmation sends the exact activity, course, route, view, distance, and Air setting to every racer. Everyone must then tap Ready again.</p>
              </div>
              <button
                className="quick-race-button primary"
                type="button"
                disabled={disabled || !canConfirmSetup || !localSetupAvailable}
                onClick={onConfirmSetup}
              >
                <Check size={19} aria-hidden="true" /> Use this setup
              </button>
            </>
          ) : (
            <div>
              <span className="quick-race-eyebrow">Stay in this room</span>
              <h3>Waiting for the host’s setup</h3>
              <p>Ready remains unavailable until the host confirms the next exact setup.</p>
            </div>
          )}
        </div>
      ) : (
        <div className="quick-race-ready-actions">
          {localRacer && room.flow.phase === 'lobby' && (
            <button
              type="button"
              className={`quick-race-button ready-toggle ${localReady ? 'is-ready' : 'primary'}`}
              aria-pressed={localReady}
              disabled={disabled || !setupReady}
              onClick={() => void onReady(!localReady)}
            >
              <Check size={20} aria-hidden="true" /> {localReady ? 'Ready — tap to undo' : 'I’m ready'}
            </button>
          )}
          {automaticMatchStart && room.flow.phase === 'lobby' && (
            <p className="quick-race-race-status" role="status">
              <Flag size={20} aria-hidden="true" /> Starts automatically when every racer is Ready.
            </p>
          )}
          {isHost && !automaticMatchStart && room.flow.phase === 'lobby' && (
            <button
              type="button"
              className="quick-race-button start"
              disabled={disabled || !setupReady || !canStart}
              title={!setupReady
                ? 'This device is still applying the shared setup'
                : canStart ? undefined : 'Requires 2–4 seats and every connected racer ready'}
              onClick={onStart}
            >
              <Flag size={20} aria-hidden="true" /> Start together
            </button>
          )}
          {room.flow.phase === 'race' && (
            <p className="quick-race-race-status" role="status">
              <Flag size={20} aria-hidden="true" /> The synchronized race is {room.flow.raceStartAt && room.flow.raceStartAt > Date.now() ? 'starting' : 'in progress'}.
            </p>
          )}
        </div>
      )}

      {statusMessage && (
        <p className="quick-race-status-message" role="status" aria-live="polite">{statusMessage}</p>
      )}

      <footer className="quick-race-room-footer">
        <button type="button" disabled={disabled} onClick={onShare}>
          <Share2 size={17} aria-hidden="true" /> Share code
        </button>
        <button type="button" disabled={disabled} onClick={onLeave}>
          <LogOut size={17} aria-hidden="true" /> Leave race
        </button>
      </footer>
    </section>
  );
}
