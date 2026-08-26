import {
  Mic,
  MicOff,
  PhoneCall,
  PhoneOff,
  RotateCw,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveFriendAudioConnection } from '../hooks/useLiveFriendAudioConnection';
import { useRoomVoiceChat } from '../hooks/useRoomVoiceChat';
import {
  clearQueuedLiveFriendAudioRequests,
  createLiveFriendAudioApi,
  subscribeToLiveFriendAudioRequests,
  type LiveFriendAudioApi,
  type LiveFriendAudioInvite,
  type LiveFriendAudioInviteStatus,
} from '../lib/liveFriendAudio';
import { RiderAvatar } from './RiderAvatar';
import './LiveFriendAudioCoordinator.css';

export type { LiveFriendAudioInviteStatus } from '../lib/liveFriendAudio';

export type LiveFriendAudioRoomMember = {
  id: string;
  name?: string;
  displayName?: string;
  photoUrl?: string;
};

export type LiveFriendAudioRoom = {
  id: string;
  purpose?: 'race' | 'live-audio' | 'club-event';
  members: LiveFriendAudioRoomMember[];
};

export type LiveFriendAudioCoordinatorProps = {
  accountId: string;
  refreshToken?: string | number;
  api?: LiveFriendAudioApi;
  currentRoom?: LiveFriendAudioRoom | null;
  currentUserId?: string | null;
  inviteStatus?: LiveFriendAudioInviteStatus | null;
  connectionError?: string | null;
  onConnect?: () => void | Promise<void>;
  onJoinRoom?: (roomId: string) => boolean | void | Promise<boolean | void>;
  onLeaveRoom?: () => boolean | void | Promise<boolean | void>;
  voiceEnabled?: boolean;
  voiceRequesting?: boolean;
  voiceSupported?: boolean;
  voiceStatus?: string;
  voiceRemoteCount?: number;
  onVoiceStart?: () => void | Promise<void>;
  onVoiceStop?: () => void | Promise<void>;
  onDismissConnectionError?: () => void | Promise<void>;
  /** Hydration/test seam. Production normally lets the coordinator load the account-scoped endpoint. */
  initialInvites?: LiveFriendAudioInvite[];
  initialJoiningRoomId?: string;
};

const defaultFriendsApi = createLiveFriendAudioApi();

function timestamp(value: string | number | null | undefined) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Date.parse(value ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

export function liveFriendAudioCountdown(
  expiresAt: string | number | null | undefined,
  now = Date.now(),
) {
  const remainingSeconds = Math.max(0, Math.ceil((timestamp(expiresAt) - now) / 1_000));
  if (remainingSeconds <= 0) return 'Expired';
  if (remainingSeconds < 60) return `${remainingSeconds}s`;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function liveFriendAudioPeer(
  room: LiveFriendAudioRoom | null,
  currentUserId: string | null,
) {
  if (!room || !currentUserId) return null;
  return room?.members.find((member) => member.id !== currentUserId) ?? null;
}

export function claimLiveFriendAudioEnd(gate: { current: boolean }) {
  if (gate.current) return false;
  gate.current = true;
  return true;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export function LiveFriendAudioCoordinator({
  accountId,
  refreshToken = 0,
  api,
  currentRoom: controlledRoom,
  currentUserId: controlledUserId,
  inviteStatus: controlledInviteStatus,
  connectionError: controlledConnectionError,
  onConnect: controlledConnect,
  onJoinRoom: controlledJoinRoom,
  onLeaveRoom: controlledLeaveRoom,
  voiceEnabled: controlledVoiceEnabled,
  voiceRequesting: controlledVoiceRequesting,
  voiceSupported: controlledVoiceSupported,
  voiceStatus: controlledVoiceStatus,
  voiceRemoteCount: controlledVoiceRemoteCount,
  onVoiceStart: controlledVoiceStart,
  onVoiceStop: controlledVoiceStop,
  onDismissConnectionError: controlledDismissConnectionError,
  initialInvites = [],
  initialJoiningRoomId = '',
}: LiveFriendAudioCoordinatorProps) {
  const friendsApi = api ?? defaultFriendsApi;
  const connection = useLiveFriendAudioConnection(accountId);
  const voiceRoom = useMemo(() => (
    connection.currentRoom && liveFriendAudioPeer(connection.currentRoom, connection.clientId)
      ? {
        ...connection.currentRoom,
        members: connection.currentRoom.members.map((member) => ({ ...member, roomRole: 'racer' as const })),
      }
      : null
  ), [connection.clientId, connection.currentRoom]);
  const internalVoice = useRoomVoiceChat({
    currentRoom: voiceRoom,
    currentUserId: connection.clientId,
    voiceSignals: connection.voiceSignals,
    sendVoiceSignal: connection.sendVoiceSignal,
  });
  const currentRoom = controlledRoom === undefined ? connection.currentRoom : controlledRoom;
  const currentUserId = controlledUserId === undefined ? connection.clientId : controlledUserId;
  const inviteStatus = controlledInviteStatus === undefined ? connection.inviteStatus : controlledInviteStatus;
  const connectionError = controlledConnectionError === undefined
    ? connection.connectionError
    : controlledConnectionError;
  const onConnect = controlledConnect ?? (() => undefined);
  const onJoinRoom = controlledJoinRoom ?? connection.joinRoom;
  const onLeaveRoom = controlledLeaveRoom ?? connection.leaveRoom;
  const voiceEnabled = controlledVoiceEnabled ?? internalVoice.enabled;
  const voiceRequesting = controlledVoiceRequesting ?? internalVoice.requesting;
  const voiceSupported = controlledVoiceSupported ?? internalVoice.supported;
  const voiceStatus = controlledVoiceStatus ?? internalVoice.status ?? connection.connectionMessage;
  const voiceRemoteCount = controlledVoiceRemoteCount ?? internalVoice.remoteCount;
  const onVoiceStart = controlledVoiceStart ?? internalVoice.start;
  const onVoiceStop = controlledVoiceStop ?? internalVoice.stop;
  const onDismissConnectionError = controlledDismissConnectionError ?? connection.dismissConnectionError;
  const [invites, setInvites] = useState<LiveFriendAudioInvite[]>(initialInvites);
  const [now, setNow] = useState(Date.now);
  const [busyInviteId, setBusyInviteId] = useState('');
  const [joiningRoomId, setJoiningRoomId] = useState(initialJoiningRoomId);
  const [message, setMessage] = useState('');
  const [ending, setEnding] = useState(false);
  const [dismissedOutgoingKey, setDismissedOutgoingKey] = useState('');
  const loadGenerationRef = useRef(0);
  const previousAccountIdRef = useRef(accountId);
  const endingRef = useRef(false);

  useEffect(() => {
    const unsubscribe = subscribeToLiveFriendAudioRequests(accountId, (request) => {
      connection.inviteFriend(request.targetProfileId, request.targetName);
    });
    return () => {
      unsubscribe();
      // Account changes and logout must not replay an intent created under a
      // different authenticated rider, even if another lazy mount follows.
      clearQueuedLiveFriendAudioRequests();
    };
  }, [accountId, connection.inviteFriend]);

  useEffect(() => {
    if (previousAccountIdRef.current === accountId) return;
    previousAccountIdRef.current = accountId;
    loadGenerationRef.current += 1;
    setInvites(initialInvites);
    setBusyInviteId('');
    setJoiningRoomId('');
    setMessage('');
    endingRef.current = false;
    setEnding(false);
    setDismissedOutgoingKey('');
  }, [accountId, initialInvites]);

  useEffect(() => {
    if (!accountId) return undefined;
    const generation = ++loadGenerationRef.current;
    void friendsApi.listLiveAudioInvites()
      .then((nextInvites) => {
        if (generation === loadGenerationRef.current) setInvites(nextInvites);
      })
      .catch(() => {
        // This short-lived surface is refreshed by the authenticated SSE stream.
        // A transient read failure must not replace the rest of the app with an error.
      });
    return () => {
      if (loadGenerationRef.current === generation) loadGenerationRef.current += 1;
    };
  }, [accountId, friendsApi, refreshToken]);

  const liveRoom = currentRoom?.purpose === 'live-audio' ? currentRoom : null;
  const liveRoomPeer = liveFriendAudioPeer(liveRoom, currentUserId);
  const validInvites = useMemo(
    () => invites.filter((invite) => timestamp(invite.expiresAt) > now),
    [invites, now],
  );
  const incomingInvite = liveRoom ? null : validInvites[0] ?? null;
  const outgoingKey = inviteStatus
    ? `${inviteStatus.state}:${inviteStatus.inviteId ?? ''}:${inviteStatus.targetProfileId ?? ''}`
    : '';
  const showOutgoing = Boolean(
    !incomingInvite
    && (!liveRoom || !liveRoomPeer)
    && inviteStatus
    && !['idle', 'cancelled'].includes(inviteStatus.state)
    && dismissedOutgoingKey !== outgoingKey,
  );

  useEffect(() => {
    const expiresAt = incomingInvite?.expiresAt
      ?? (inviteStatus?.state === 'sent' ? inviteStatus.expiresAt : null);
    if (!expiresAt || timestamp(expiresAt) <= Date.now()) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [incomingInvite?.expiresAt, inviteStatus?.expiresAt, inviteStatus?.state]);

  useEffect(() => {
    if (liveRoom) {
      setJoiningRoomId('');
      setMessage('');
    } else {
      endingRef.current = false;
      setEnding(false);
    }
  }, [liveRoom]);

  const connectAndJoin = useCallback(async (roomId: string) => {
    setJoiningRoomId(roomId);
    setMessage('');
    try {
      await onConnect();
      const joined = await onJoinRoom(roomId);
      if (joined === false) throw new Error('TrackLab is still connecting to live audio.');
    } catch (error) {
      setMessage(errorMessage(error, 'The private live audio room could not be joined.'));
    }
  }, [onConnect, onJoinRoom]);

  const respondToInvite = useCallback(async (invite: LiveFriendAudioInvite, accepted: boolean) => {
    if (busyInviteId) return;
    setBusyInviteId(invite.id);
    setMessage('');
    try {
      const response = await friendsApi.respondToLiveAudioInvite(invite.id, accepted);
      setInvites((current) => current.filter((item) => item.id !== invite.id));
      if (accepted) {
        if (!response.accepted) throw new Error('That live audio invitation is no longer available.');
        await connectAndJoin(response.roomId);
      }
    } catch (error) {
      setMessage(errorMessage(
        error,
        accepted ? 'The live audio invitation could not be joined.' : 'The invitation could not be dismissed.',
      ));
    } finally {
      setBusyInviteId('');
    }
  }, [busyInviteId, connectAndJoin, friendsApi]);

  const cancelOutgoingInvite = useCallback(async () => {
    const inviteId = inviteStatus?.inviteId?.trim();
    if (!inviteId || busyInviteId) return;
    setBusyInviteId(inviteId);
    setMessage('');
    try {
      await friendsApi.cancelLiveAudioInvite(inviteId);
      setDismissedOutgoingKey(outgoingKey);
    } catch (error) {
      setMessage(errorMessage(error, 'The live audio invitation could not be canceled.'));
    } finally {
      setBusyInviteId('');
    }
  }, [busyInviteId, friendsApi, inviteStatus?.inviteId, outgoingKey]);

  const endLiveAudio = useCallback(async () => {
    if (!claimLiveFriendAudioEnd(endingRef)) return;
    setEnding(true);
    setMessage('');
    try {
      // Stop is intentionally unconditional: it also invalidates an in-flight
      // microphone permission request before the room/socket is closed.
      await onVoiceStop();
      await onLeaveRoom();
    } catch (error) {
      endingRef.current = false;
      setEnding(false);
      setMessage(errorMessage(error, 'Live audio could not be closed.'));
    }
  }, [onLeaveRoom, onVoiceStop]);

  const dismissConnectionFailure = useCallback(() => {
    setJoiningRoomId('');
    setMessage('');
    setDismissedOutgoingKey(outgoingKey);
    void Promise.resolve(onDismissConnectionError());
  }, [onDismissConnectionError, outgoingKey]);

  if (liveRoom && !showOutgoing) {
    const peer = liveRoomPeer;
    const peerName = peer?.displayName || peer?.name || 'your friend';
    const voiceCanStart = Boolean(peer) && voiceSupported;
    return (
      <div className="live-friend-audio-layer">
        <section className="live-friend-audio-card active" role="region" aria-labelledby="live-friend-audio-active-title">
          <div className="live-friend-audio-heading">
            <span className="live-friend-audio-avatar"><RiderAvatar name={peerName} photoUrl={peer?.photoUrl} /></span>
            <span>
              <small>Live audio</small>
              <strong id="live-friend-audio-active-title">{peer ? `Talking with ${peerName}` : 'Waiting for your friend'}</strong>
              <span aria-live="polite">{voiceEnabled
                ? `Microphone on · ${voiceRemoteCount} connected`
                : voiceRequesting
                  ? 'Requesting microphone access…'
                  : peer ? 'Microphone off' : 'Microphone stays off until your friend joins.'}</span>
            </span>
          </div>
          <div className="live-friend-audio-actions">
            <button
              type="button"
              className="primary"
              aria-pressed={voiceEnabled}
              aria-busy={voiceRequesting || undefined}
              disabled={ending || voiceRequesting || (!voiceEnabled && !voiceCanStart)}
              onClick={() => {
                if (voiceEnabled) void onVoiceStop();
                else if (voiceCanStart && !voiceRequesting) void onVoiceStart();
              }}
            >
              {voiceEnabled ? <MicOff size={17} aria-hidden="true" /> : <Mic size={17} aria-hidden="true" />}
              {voiceEnabled ? 'Mute' : voiceRequesting ? 'Starting…' : 'Start talking'}
            </button>
            <button type="button" disabled={ending} onClick={() => { void endLiveAudio(); }}>
              <PhoneOff size={17} aria-hidden="true" /> {ending ? 'Ending…' : 'End'}
            </button>
          </div>
          <p className="live-friend-audio-status" aria-live="polite">{message
            || (peer ? voiceStatus : 'Waiting for your friend to join the private room.')}</p>
        </section>
      </div>
    );
  }

  if (incomingInvite) {
    const waiting = busyInviteId === incomingInvite.id;
    return (
      <div className="live-friend-audio-layer">
        <p className="sr-only" role="alert">{incomingInvite.from.displayName} invited you to live audio.</p>
        <section className="live-friend-audio-card" role="region" aria-labelledby="live-friend-audio-invite-title">
          <div className="live-friend-audio-heading">
            <span className="live-friend-audio-avatar"><RiderAvatar name={incomingInvite.from.displayName} photoUrl={incomingInvite.from.photoUrl} /></span>
            <span>
              <small>Live audio invite</small>
              <strong id="live-friend-audio-invite-title">{incomingInvite.from.displayName} wants to talk live.</strong>
              <span>Microphone stays off until you turn it on.</span>
            </span>
          </div>
          <div className="live-friend-audio-expiry" aria-hidden="true">
            Expires in {liveFriendAudioCountdown(incomingInvite.expiresAt, now)}
          </div>
          <div className="live-friend-audio-actions">
            <button
              type="button"
              className="primary"
              disabled={waiting}
              aria-label={`Join ${incomingInvite.from.displayName}'s live audio`}
              onClick={() => { void respondToInvite(incomingInvite, true); }}
            ><PhoneCall size={17} aria-hidden="true" /> {waiting ? 'Joining…' : 'Join'}</button>
            <button
              type="button"
              disabled={waiting}
              aria-label={`Not now for ${incomingInvite.from.displayName}'s live audio invite`}
              onClick={() => { void respondToInvite(incomingInvite, false); }}
            ><X size={17} aria-hidden="true" /> Not now</button>
          </div>
          {message && <p className="live-friend-audio-status error" role="alert">{message}</p>}
        </section>
      </div>
    );
  }

  if (joiningRoomId && !liveRoom) {
    const joiningError = message || connectionError;
    return (
      <div className="live-friend-audio-layer">
        <section className="live-friend-audio-card" role="region" aria-label="Joining live audio">
          <div className="live-friend-audio-heading compact">
            {joiningError
              ? <PhoneOff size={20} aria-hidden="true" />
              : <RotateCw className="live-friend-audio-spin" size={20} aria-hidden="true" />}
            <span>
              <small>Live audio</small>
              <strong>{joiningError ? 'The private room could not be opened.' : 'Opening the private room…'}</strong>
            </span>
          </div>
          {joiningError && (
            <>
              <p className="live-friend-audio-status error" role="alert">{joiningError}</p>
              <div className="live-friend-audio-actions">
                <button type="button" className="primary" onClick={() => { void connectAndJoin(joiningRoomId); }}>
                  <RotateCw size={16} aria-hidden="true" /> Try again
                </button>
                <button type="button" onClick={dismissConnectionFailure}>
                  <X size={16} aria-hidden="true" /> Dismiss
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    );
  }

  if (showOutgoing && inviteStatus) {
    const targetName = inviteStatus.targetName?.trim() || 'your friend';
    const waiting = inviteStatus.state === 'sending' || inviteStatus.state === 'sent';
    const outcome = inviteStatus.state === 'declined'
      ? `${targetName} is unavailable right now.`
      : inviteStatus.state === 'expired'
        ? `${targetName} didn’t join.`
        : inviteStatus.state === 'error'
          ? inviteStatus.message || 'The live audio invite could not be sent.'
          : inviteStatus.state === 'accepted'
            ? `Opening live audio with ${targetName}…`
            : inviteStatus.state === 'sending'
              ? `Sending a live audio invite to ${targetName}…`
              : `Waiting for ${targetName}…`;
    return (
      <div className="live-friend-audio-layer">
        <section className="live-friend-audio-card compact-card" role="status" aria-live="polite">
          <div className="live-friend-audio-heading compact">
            <PhoneCall size={20} aria-hidden="true" />
            <span>
              <small>Live audio</small>
              <strong>{outcome}</strong>
              {liveRoom && !liveRoomPeer && (
                <span>Microphone stays off until your friend joins.</span>
              )}
            </span>
          </div>
          {inviteStatus.state === 'sent' && inviteStatus.expiresAt && (
            <div className="live-friend-audio-expiry" aria-hidden="true">
              Expires in {liveFriendAudioCountdown(inviteStatus.expiresAt, now)}
            </div>
          )}
          {waiting && inviteStatus.inviteId ? (
            <button
              className="live-friend-audio-retry"
              type="button"
              disabled={Boolean(busyInviteId)}
              onClick={() => { void cancelOutgoingInvite(); }}
            ><X size={16} aria-hidden="true" /> {busyInviteId ? 'Canceling…' : 'Cancel invite'}</button>
          ) : liveRoom ? (
            <button
              className="live-friend-audio-retry"
              type="button"
              disabled={ending}
              onClick={() => { void endLiveAudio(); }}
            ><PhoneOff size={16} aria-hidden="true" /> {ending ? 'Ending…' : 'End'}</button>
          ) : !waiting && inviteStatus.state !== 'accepted' ? (
            <button className="live-friend-audio-dismiss" type="button" aria-label="Dismiss live audio status" onClick={dismissConnectionFailure}>
              <X size={16} aria-hidden="true" />
            </button>
          ) : null}
          {message && <p className="live-friend-audio-status error" role="alert">{message}</p>}
        </section>
      </div>
    );
  }

  return null;
}
