import { useCallback, useEffect, useRef, useState } from 'react';
import {
  normalizeLiveFriendAudioInviteStatus,
  type LiveFriendAudioInviteStatus,
} from '../lib/liveFriendAudio';
import type {
  MultiplayerRoom,
  MultiplayerVoiceSignal,
  MultiplayerVoiceSignalPayload,
} from '../types';

export type LiveFriendAudioPendingCommand = { type: 'create-live-audio-invite'; targetProfileId: string }
  | { type: 'join-room'; roomId: string };

export type LiveFriendAudioConnectionActivity = 'idle' | 'inviting' | 'joining' | 'accepted' | 'room' | 'error';

export const LIVE_FRIEND_AUDIO_WELCOME_TIMEOUT_MS = 12_000;

type LiveFriendAudioWelcomeSocket = {
  readonly readyState: number;
  close: (code?: number, reason?: string) => void;
};

export function armLiveFriendAudioWelcomeTimeout(
  socket: LiveFriendAudioWelcomeSocket,
  isCurrent: () => boolean,
  onTimeout: () => void,
  delay = LIVE_FRIEND_AUDIO_WELCOME_TIMEOUT_MS,
) {
  let active = true;
  const timer = globalThis.setTimeout(() => {
    if (!active || !isCurrent()) return;
    active = false;
    onTimeout();
    if (socket.readyState < 2) socket.close(4000, 'Live audio welcome timed out');
  }, delay);
  return () => {
    if (!active) return;
    active = false;
    globalThis.clearTimeout(timer);
  };
}

export function mergeLiveFriendAudioPendingCommand(
  _current: readonly LiveFriendAudioPendingCommand[],
  next: LiveFriendAudioPendingCommand,
) {
  // A person can only be opening one one-to-one room at a time. Keeping the
  // latest intent prevents repeated taps/retries from replaying stale invites
  // or joins after the socket finally welcomes the client.
  return [next];
}

export function clearLiveFriendAudioPendingCommands() {
  return [] as LiveFriendAudioPendingCommand[];
}

export function terminateLiveFriendAudioSocket<TSocket extends LiveFriendAudioWelcomeSocket>(
  socket: TSocket,
  refs: {
    socket: { current: TSocket | null };
    welcomed: { current: boolean };
    intentionalClose: { current: boolean };
    leaveRequested: { current: boolean };
    commands: { current: LiveFriendAudioPendingCommand[] };
  },
  code: number,
  reason: string,
) {
  if (refs.socket.current !== socket) return false;
  refs.socket.current = null;
  refs.welcomed.current = false;
  refs.intentionalClose.current = true;
  refs.leaveRequested.current = false;
  refs.commands.current = clearLiveFriendAudioPendingCommands();
  if (socket.readyState < 2) socket.close(code, reason);
  return true;
}

export function liveFriendAudioTerminalStatus(
  activity: LiveFriendAudioConnectionActivity,
  current: LiveFriendAudioInviteStatus | null,
  message: string,
) {
  const active = activity === 'inviting'
    || activity === 'joining'
    || activity === 'accepted'
    || activity === 'room'
    || current?.state === 'sending'
    || current?.state === 'sent'
    || current?.state === 'accepted'
    || current?.state === 'error';
  if (!active) return current;
  return {
    ...(current ?? {}),
    state: 'error' as const,
    message,
  };
}

function socketUrl() {
  const configured = import.meta.env.VITE_TRACKLAB_MULTIPLAYER_URL?.trim();
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return new URL(configured || `${protocol}//${window.location.host}/multiplayer`, window.location.href).toString();
}

function liveRoom(value: unknown): MultiplayerRoom | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const room = value as MultiplayerRoom;
  return room.purpose === 'live-audio' && typeof room.id === 'string' && Array.isArray(room.members)
    ? room
    : null;
}

export function useLiveFriendAudioConnection(accountId: string) {
  const accountIdRef = useRef(accountId);
  const socketRef = useRef<WebSocket | null>(null);
  const welcomedRef = useRef(false);
  const commandsRef = useRef<LiveFriendAudioPendingCommand[]>([]);
  const intentionalCloseRef = useRef(false);
  const leaveRequestedRef = useRef(false);
  const activityRef = useRef<LiveFriendAudioConnectionActivity>('idle');
  const welcomeTimeoutRef = useRef<{ socket: WebSocket; cancel: () => void } | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [currentRoom, setCurrentRoom] = useState<MultiplayerRoom | null>(null);
  const [inviteStatus, setInviteStatus] = useState<LiveFriendAudioInviteStatus | null>(null);
  const [voiceSignals, setVoiceSignals] = useState<MultiplayerVoiceSignal[]>([]);
  const [connectionMessage, setConnectionMessage] = useState('Live audio is ready.');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  accountIdRef.current = accountId;

  const reportTerminalError = useCallback((message: string) => {
    const activity = activityRef.current;
    activityRef.current = 'error';
    setConnectionError(message);
    setConnectionMessage(message);
    setCurrentRoom(null);
    setVoiceSignals([]);
    setInviteStatus((current) => liveFriendAudioTerminalStatus(activity, current, message));
  }, []);

  const clearWelcomeTimeout = useCallback((socket?: WebSocket) => {
    const timeout = welcomeTimeoutRef.current;
    if (!timeout || (socket && timeout.socket !== socket)) return;
    welcomeTimeoutRef.current = null;
    timeout.cancel();
  }, []);

  const send = useCallback((command: object) => {
    const socket = socketRef.current;
    if (!welcomedRef.current || socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(command));
    return true;
  }, []);

  const connect = useCallback(() => {
    const existing = socketRef.current;
    setConnectionError(null);
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) return;
    intentionalCloseRef.current = false;
    welcomedRef.current = false;
    setConnectionMessage('Connecting live audio…');
    let socket: WebSocket;
    try {
      socket = new WebSocket(socketUrl());
    } catch {
      commandsRef.current = clearLiveFriendAudioPendingCommands();
      reportTerminalError('Live audio could not connect.');
      return;
    }
    socketRef.current = socket;
    clearWelcomeTimeout();
    const timeoutAccountId = accountId;
    const cancel = armLiveFriendAudioWelcomeTimeout(
      socket,
      () => socketRef.current === socket
        && accountIdRef.current === timeoutAccountId
        && !welcomedRef.current,
      () => {
        if (welcomeTimeoutRef.current?.socket === socket) welcomeTimeoutRef.current = null;
        if (!terminateLiveFriendAudioSocket(socket, {
          socket: socketRef,
          welcomed: welcomedRef,
          intentionalClose: intentionalCloseRef,
          leaveRequested: leaveRequestedRef,
          commands: commandsRef,
        }, 4000, 'Live audio welcome timed out')) return;
        setClientId(null);
        reportTerminalError('Live audio took too long to connect. Try again.');
      },
    );
    welcomeTimeoutRef.current = { socket, cancel };
    socket.addEventListener('open', () => {
      if (socketRef.current !== socket) return;
      socket.send(JSON.stringify({ type: 'hello', available: false, bikeCount: 0 }));
    });
    socket.addEventListener('message', (event) => {
      if (socketRef.current !== socket) return;
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (message.type === 'welcome') {
        clearWelcomeTimeout(socket);
        welcomedRef.current = true;
        setClientId(typeof message.clientId === 'string' ? message.clientId : null);
        setConnectionError(null);
        setConnectionMessage('Live audio connected.');
        const commands = commandsRef.current;
        commandsRef.current = clearLiveFriendAudioPendingCommands();
        commands.forEach((command) => socket.send(JSON.stringify(command)));
      } else if (message.type === 'room-state') {
        const room = liveRoom(message.room);
        if (room) {
          activityRef.current = 'room';
          leaveRequestedRef.current = false;
          setConnectionError(null);
          setCurrentRoom(room);
        }
      } else if (message.type === 'room-left') {
        commandsRef.current = clearLiveFriendAudioPendingCommands();
        leaveRequestedRef.current = false;
        setCurrentRoom(null);
        setInviteStatus(null);
        setVoiceSignals([]);
        setConnectionError(null);
        activityRef.current = 'idle';
        intentionalCloseRef.current = true;
        socket.close(1000, 'Live audio ended');
      } else if (message.type === 'live-audio-invite-status') {
        const nextStatus = normalizeLiveFriendAudioInviteStatus(message);
        if (nextStatus?.state === 'accepted') activityRef.current = 'accepted';
        else if (nextStatus?.state === 'sending' || nextStatus?.state === 'sent') activityRef.current = 'inviting';
        else if (nextStatus) activityRef.current = nextStatus.state === 'error' ? 'error' : 'idle';
        setInviteStatus(nextStatus);
        if (nextStatus?.state === 'error' && nextStatus.message) {
          setConnectionError(nextStatus.message);
        }
      } else if (message.type === 'voice-signal' && message.signal && typeof message.signal === 'object') {
        setVoiceSignals((current) => [...current, message.signal as MultiplayerVoiceSignal].slice(-64));
      } else if (message.type === 'room-error' || message.type === 'error') {
        const error = typeof message.message === 'string' ? message.message.slice(0, 240) : 'Live audio is unavailable.';
        commandsRef.current = clearLiveFriendAudioPendingCommands();
        reportTerminalError(error);
      }
    });
    socket.addEventListener('close', () => {
      clearWelcomeTimeout(socket);
      if (socketRef.current !== socket) return;
      socketRef.current = null;
      welcomedRef.current = false;
      commandsRef.current = clearLiveFriendAudioPendingCommands();
      leaveRequestedRef.current = false;
      setClientId(null);
      setCurrentRoom(null);
      setVoiceSignals([]);
      if (!intentionalCloseRef.current) {
        reportTerminalError('Live audio disconnected. Try again.');
      }
    });
    socket.addEventListener('error', () => {
      if (socketRef.current === socket) {
        clearWelcomeTimeout(socket);
        if (!terminateLiveFriendAudioSocket(socket, {
          socket: socketRef,
          welcomed: welcomedRef,
          intentionalClose: intentionalCloseRef,
          leaveRequested: leaveRequestedRef,
          commands: commandsRef,
        }, 4001, 'Live audio socket error')) return;
        setClientId(null);
        reportTerminalError('Live audio could not connect.');
      }
    });
  }, [accountId, clearWelcomeTimeout, reportTerminalError]);

  const queue = useCallback((command: LiveFriendAudioPendingCommand) => {
    setConnectionError(null);
    if (!send(command)) {
      commandsRef.current = mergeLiveFriendAudioPendingCommand(commandsRef.current, command);
      connect();
    }
    return true;
  }, [connect, send]);

  const inviteFriend = useCallback((profileId: string, displayName: string) => {
    const targetProfileId = profileId.trim().slice(0, 180);
    if (!targetProfileId) return;
    activityRef.current = 'inviting';
    setInviteStatus({
      state: 'sending',
      targetProfileId,
      targetName: displayName.trim().slice(0, 80) || 'your friend',
      message: 'Opening a private live audio room.',
    });
    queue({ type: 'create-live-audio-invite', targetProfileId });
  }, [queue]);

  const joinRoom = useCallback((roomId: string) => {
    const id = roomId.trim().slice(0, 32);
    if (!id) return false;
    activityRef.current = 'joining';
    setConnectionMessage('Joining live audio…');
    return queue({ type: 'join-room', roomId: id });
  }, [queue]);

  const leaveRoom = useCallback(() => {
    if (leaveRequestedRef.current) return false;
    leaveRequestedRef.current = true;
    activityRef.current = 'idle';
    intentionalCloseRef.current = true;
    commandsRef.current = clearLiveFriendAudioPendingCommands();
    setConnectionError(null);
    // End is locally terminal. If the dedicated socket drops before the
    // server's room-left acknowledgement, stale accepted/sent state must not
    // reopen an "Opening" or "Waiting" card.
    setCurrentRoom(null);
    setInviteStatus(null);
    setVoiceSignals([]);
    if (!send({ type: 'leave-room' })) {
      intentionalCloseRef.current = true;
      socketRef.current?.close(1000, 'Live audio ended');
    }
    return true;
  }, [send]);

  const sendVoiceSignal = useCallback((targetId: string | null, signal: MultiplayerVoiceSignalPayload) => (
    send({ type: 'voice-signal', targetId, signal })
  ), [send]);

  const dismissConnectionError = useCallback(() => {
    const socket = socketRef.current;
    clearWelcomeTimeout(socket ?? undefined);
    socketRef.current = null;
    intentionalCloseRef.current = true;
    welcomedRef.current = false;
    leaveRequestedRef.current = false;
    activityRef.current = 'idle';
    commandsRef.current = clearLiveFriendAudioPendingCommands();
    setClientId(null);
    setCurrentRoom(null);
    setInviteStatus(null);
    setVoiceSignals([]);
    setConnectionError(null);
    setConnectionMessage('Live audio is ready.');
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      socket.close(1000, 'Live audio dismissed');
    }
  }, [clearWelcomeTimeout]);

  useEffect(() => () => {
    clearWelcomeTimeout();
    intentionalCloseRef.current = true;
    commandsRef.current = clearLiveFriendAudioPendingCommands();
    leaveRequestedRef.current = false;
    activityRef.current = 'idle';
    socketRef.current?.close(1000, 'Account changed');
    socketRef.current = null;
  }, [accountId, clearWelcomeTimeout]);

  return {
    clientId,
    connectionError,
    connectionMessage,
    currentRoom,
    dismissConnectionError,
    inviteFriend,
    inviteStatus,
    joinRoom,
    leaveRoom,
    sendVoiceSignal,
    voiceSignals,
  };
}
