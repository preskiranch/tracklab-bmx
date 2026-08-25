import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  claimLiveFriendAudioEnd,
  LiveFriendAudioCoordinator,
  liveFriendAudioCountdown,
  liveFriendAudioPeer,
  type LiveFriendAudioCoordinatorProps,
  type LiveFriendAudioInviteStatus,
  type LiveFriendAudioRoom,
} from '../../src/components/LiveFriendAudioCoordinator';
import {
  armLiveFriendAudioWelcomeTimeout,
  clearLiveFriendAudioPendingCommands,
  LIVE_FRIEND_AUDIO_WELCOME_TIMEOUT_MS,
  liveFriendAudioTerminalStatus,
  mergeLiveFriendAudioPendingCommand,
  terminateLiveFriendAudioSocket,
} from '../../src/hooks/useLiveFriendAudioConnection';
import {
  clearQueuedLiveFriendAudioRequests,
  queueLiveFriendAudioRequest,
  subscribeToLiveFriendAudioRequests,
  type LiveFriendAudioInvite,
} from '../../src/lib/liveFriendAudio';

const invite: LiveFriendAudioInvite = {
  id: 'invite-1',
  from: {
    id: 'friend-1',
    displayName: 'Friend One',
    handle: 'friend.one',
  },
  createdAt: '2099-08-24T20:00:00.000Z',
  expiresAt: '2099-08-24T20:01:30.000Z',
};

afterEach(() => {
  clearQueuedLiveFriendAudioRequests();
  vi.useRealTimers();
});

class FakeWelcomeWebSocket {
  readyState = 0;
  send = vi.fn((_message: string) => undefined);
  close = vi.fn((_code?: number, _reason?: string) => {
    this.readyState = 2;
  });
}

function props(overrides: Partial<LiveFriendAudioCoordinatorProps> = {}): LiveFriendAudioCoordinatorProps {
  return {
    accountId: 'me',
    currentRoom: null,
    currentUserId: 'me',
    onConnect: vi.fn(),
    onJoinRoom: vi.fn(),
    onLeaveRoom: vi.fn(),
    voiceEnabled: false,
    voiceSupported: true,
    voiceStatus: 'Microphone off',
    voiceRemoteCount: 0,
    onVoiceStart: vi.fn(),
    onVoiceStop: vi.fn(),
    ...overrides,
  };
}

describe('friend live audio coordinator', () => {
  it('shows an expiring, nonmodal invitation and clearly keeps the microphone off', () => {
    const markup = renderToStaticMarkup(createElement(LiveFriendAudioCoordinator, props({
      initialInvites: [invite],
    })));

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('Friend One invited you to live audio');
    expect(markup).toContain('role="region"');
    expect(markup).not.toContain('role="dialog"');
    expect(markup).toContain('Friend One wants to talk live');
    expect(markup).toContain('Microphone stays off until you turn it on');
    expect(markup).toContain('aria-label="Join Friend One&#x27;s live audio"');
    expect(markup).toContain('aria-label="Not now for Friend One&#x27;s live audio invite"');
    expect(markup).toContain(' Join</button>');
    expect(markup).toContain(' Not now</button>');
  });

  it('shows a compact active tray with microphone and end controls', () => {
    const onVoiceStart = vi.fn();
    const room: LiveFriendAudioRoom = {
      id: 'room-1',
      purpose: 'live-audio',
      members: [
        { id: 'me', displayName: 'Me' },
        { id: 'friend-1', displayName: 'Friend One' },
      ],
    };
    const markup = renderToStaticMarkup(createElement(LiveFriendAudioCoordinator, props({
      currentRoom: room,
      voiceStatus: 'Ready to talk',
      onVoiceStart,
    })));

    expect(markup).toContain('Talking with Friend One');
    expect(markup).toContain('Microphone off');
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).toMatch(/class="primary" aria-pressed="false"><svg/);
    expect(markup).toContain('Start talking</button>');
    expect(markup).toContain(' End</button>');
    expect(markup).toContain('Ready to talk');
    expect(onVoiceStart).not.toHaveBeenCalled();
  });

  it('keeps the host in wait/cancel state with the microphone unavailable until the friend joins', () => {
    const onVoiceStart = vi.fn();
    const markup = renderToStaticMarkup(createElement(LiveFriendAudioCoordinator, props({
      currentRoom: {
        id: 'host-room',
        purpose: 'live-audio',
        members: [{ id: 'me', displayName: 'Me' }],
      },
      inviteStatus: {
        state: 'sent',
        inviteId: 'invite-outgoing',
        targetProfileId: 'friend-1',
        targetName: 'Friend One',
        expiresAt: '2099-08-24T20:01:30.000Z',
      },
      onVoiceStart,
    })));

    expect(markup).toContain('Waiting for Friend One');
    expect(markup).toContain('Cancel invite');
    expect(markup).toContain('Microphone stays off until your friend joins');
    expect(markup).not.toContain('Start talking');
    expect(onVoiceStart).not.toHaveBeenCalled();
  });

  it('renders a disabled microphone control if a live room has no peer or outgoing status', () => {
    const markup = renderToStaticMarkup(createElement(LiveFriendAudioCoordinator, props({
      currentRoom: {
        id: 'waiting-room',
        purpose: 'live-audio',
        members: [{ id: 'me', displayName: 'Me' }],
      },
      inviteStatus: null,
    })));

    expect(markup).toContain('Waiting for your friend');
    expect(markup).toMatch(/class="primary" aria-pressed="false" disabled=""/);
    expect(markup).toContain('Microphone stays off until your friend joins');
  });

  it('does not replace race-room controls with the live-audio tray', () => {
    const markup = renderToStaticMarkup(createElement(LiveFriendAudioCoordinator, props({
      currentRoom: {
        id: 'race-room',
        purpose: 'race',
        members: [{ id: 'me', displayName: 'Me' }],
      },
    })));

    expect(markup).toBe('');
  });

  it('shows outgoing wait and cancellation status without opening a chat surface', () => {
    const markup = renderToStaticMarkup(createElement(LiveFriendAudioCoordinator, props({
      inviteStatus: {
        state: 'sent',
        inviteId: 'invite-outgoing',
        targetProfileId: 'friend-1',
        targetName: 'Friend One',
        expiresAt: '2099-08-24T20:01:30.000Z',
      },
    })));

    expect(markup).toContain('Waiting for Friend One');
    expect(markup).toContain('Cancel invite');
    expect(markup).not.toContain('role="dialog"');
    expect(markup).not.toContain('textarea');
  });

  it('surfaces connection errors while joining and provides a retry control', () => {
    const markup = renderToStaticMarkup(createElement(LiveFriendAudioCoordinator, props({
      currentRoom: null,
      connectionError: 'That private room is no longer available.',
      initialJoiningRoomId: 'room-1',
    })));

    expect(markup).toContain('The private room could not be opened');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('That private room is no longer available');
    expect(markup).toContain('Try again');
    expect(markup).toContain('Dismiss');
    expect(markup).not.toContain('live-friend-audio-spin');
  });

  it('disables Start talking while microphone permission is in flight', () => {
    const markup = renderToStaticMarkup(createElement(LiveFriendAudioCoordinator, props({
      currentRoom: {
        id: 'room-1',
        purpose: 'live-audio',
        members: [
          { id: 'me', displayName: 'Me' },
          { id: 'friend-1', displayName: 'Friend One' },
        ],
      },
      voiceRequesting: true,
    })));

    expect(markup).toContain('Requesting microphone access');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toMatch(/aria-pressed="false" aria-busy="true" disabled=""/);
    expect(markup).toContain('Starting…');
  });

  it('claims ending once so repeated taps cannot call leave twice', () => {
    const gate = { current: false };
    expect(claimLiveFriendAudioEnd(gate)).toBe(true);
    expect(claimLiveFriendAudioEnd(gate)).toBe(false);
    gate.current = false;
    expect(claimLiveFriendAudioEnd(gate)).toBe(true);
  });

  it('formats countdowns and finds the other room member deterministically', () => {
    const now = Date.parse('2026-08-24T20:00:00.000Z');
    expect(liveFriendAudioCountdown(now + 90_000, now)).toBe('1:30');
    expect(liveFriendAudioCountdown(now + 1_000, now)).toBe('1s');
    expect(liveFriendAudioCountdown(now, now)).toBe('Expired');
    expect(liveFriendAudioPeer({
      id: 'room-1',
      purpose: 'live-audio',
      members: [{ id: 'me' }, { id: 'friend-1', displayName: 'Friend One' }],
    }, 'me')).toMatchObject({ id: 'friend-1' });
    expect(liveFriendAudioPeer({
      id: 'room-1',
      purpose: 'live-audio',
      members: [{ id: 'me' }, { id: 'friend-1' }],
    }, null)).toBeNull();
  });

  it('deduplicates the latest socket intent and clears it after a failed connection', () => {
    const inviteCommand = { type: 'create-live-audio-invite' as const, targetProfileId: 'friend-1' };
    const joinCommand = { type: 'join-room' as const, roomId: 'room-1' };

    expect(mergeLiveFriendAudioPendingCommand([], inviteCommand)).toEqual([inviteCommand]);
    expect(mergeLiveFriendAudioPendingCommand([inviteCommand], inviteCommand)).toEqual([inviteCommand]);
    expect(mergeLiveFriendAudioPendingCommand([inviteCommand], joinCommand)).toEqual([joinCommand]);
    expect(clearLiveFriendAudioPendingCommands()).toEqual([]);
  });

  it('turns joining, accepted, and active socket drops into terminal dismissible status', () => {
    const error = 'Live audio disconnected. Try again.';
    expect(liveFriendAudioTerminalStatus('joining', null, error)).toEqual({
      state: 'error',
      message: error,
    });
    expect(liveFriendAudioTerminalStatus('accepted', {
      state: 'accepted',
      targetProfileId: 'friend-1',
      targetName: 'Friend One',
    }, error)).toEqual({
      state: 'error',
      targetProfileId: 'friend-1',
      targetName: 'Friend One',
      message: error,
    });
    expect(liveFriendAudioTerminalStatus('room', null, error)).toEqual({
      state: 'error',
      message: error,
    });
    expect(liveFriendAudioTerminalStatus('idle', null, error)).toBeNull();
  });

  it('times out a blackholed outgoing socket into dismissible terminal status', () => {
    vi.useFakeTimers();
    const socket = new FakeWelcomeWebSocket();
    let status: LiveFriendAudioInviteStatus | null = {
      state: 'sending',
      targetProfileId: 'friend-1',
      targetName: 'Friend One',
    };
    const error = 'Live audio took too long to connect. Try again.';
    const onTimeout = vi.fn(() => {
      status = liveFriendAudioTerminalStatus('inviting', status, error);
    });

    armLiveFriendAudioWelcomeTimeout(socket, () => true, onTimeout);
    vi.advanceTimersByTime(LIVE_FRIEND_AUDIO_WELCOME_TIMEOUT_MS - 1);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(onTimeout).toHaveBeenCalledOnce();
    expect(status).toEqual({
      state: 'error',
      targetProfileId: 'friend-1',
      targetName: 'Friend One',
      message: error,
    });
    expect(socket.close).toHaveBeenCalledWith(4000, 'Live audio welcome timed out');
  });

  it('times out a blackholed accepted join into Retry and Dismiss error state', () => {
    vi.useFakeTimers();
    const socket = new FakeWelcomeWebSocket();
    let status: LiveFriendAudioInviteStatus | null = {
      state: 'accepted',
      targetProfileId: 'friend-1',
      targetName: 'Friend One',
    };
    const error = 'Live audio took too long to connect. Try again.';

    armLiveFriendAudioWelcomeTimeout(socket, () => true, () => {
      status = liveFriendAudioTerminalStatus('joining', status, error);
    });
    vi.advanceTimersByTime(LIVE_FRIEND_AUDIO_WELCOME_TIMEOUT_MS);

    expect(status).toMatchObject({
      state: 'error',
      targetProfileId: 'friend-1',
      targetName: 'Friend One',
      message: error,
    });
    expect(socket.close).toHaveBeenCalledOnce();
  });

  it('cancels welcome deadlines and ignores stale socket/account timers', () => {
    vi.useFakeTimers();
    const canceledSocket = new FakeWelcomeWebSocket();
    const canceledMutation = vi.fn();
    const cancel = armLiveFriendAudioWelcomeTimeout(
      canceledSocket,
      () => true,
      canceledMutation,
    );
    cancel();

    const staleSocket = new FakeWelcomeWebSocket();
    const staleMutation = vi.fn();
    armLiveFriendAudioWelcomeTimeout(staleSocket, () => false, staleMutation);
    vi.advanceTimersByTime(LIVE_FRIEND_AUDIO_WELCOME_TIMEOUT_MS * 2);

    expect(canceledMutation).not.toHaveBeenCalled();
    expect(canceledSocket.close).not.toHaveBeenCalled();
    expect(staleMutation).not.toHaveBeenCalled();
    expect(staleSocket.close).not.toHaveBeenCalled();
  });

  it('detaches an errored socket so a late welcome cannot send stale commands', () => {
    const erroredSocket = new FakeWelcomeWebSocket();
    const refs = {
      socket: { current: erroredSocket as FakeWelcomeWebSocket | null },
      welcomed: { current: false },
      intentionalClose: { current: false },
      leaveRequested: { current: true },
      commands: {
        current: [{ type: 'join-room' as const, roomId: 'old-room' }],
      },
    };

    expect(terminateLiveFriendAudioSocket(
      erroredSocket,
      refs,
      4001,
      'Live audio socket error',
    )).toBe(true);
    expect(refs.socket.current).toBeNull();
    expect(refs.commands.current).toEqual([]);
    expect(refs.welcomed.current).toBe(false);
    expect(refs.intentionalClose.current).toBe(true);
    expect(refs.leaveRequested.current).toBe(false);
    expect(erroredSocket.close).toHaveBeenCalledWith(4001, 'Live audio socket error');

    const replacementSocket = new FakeWelcomeWebSocket();
    refs.socket.current = replacementSocket;
    refs.commands.current = [{ type: 'join-room', roomId: 'new-room' }];
    // This is the same exact-socket guard used by the real late message
    // listener. The old socket cannot welcome itself back into the session or
    // consume the replacement socket's command.
    if (refs.socket.current === erroredSocket) {
      refs.commands.current.forEach((command) => erroredSocket.send(JSON.stringify(command)));
      refs.commands.current = [];
    }

    expect(erroredSocket.send).not.toHaveBeenCalled();
    expect(replacementSocket.send).not.toHaveBeenCalled();
    expect(refs.commands.current).toEqual([{ type: 'join-room', roomId: 'new-room' }]);
  });

  it('delivers a live request queued before lazy subscription exactly once', () => {
    const received = vi.fn();
    expect(queueLiveFriendAudioRequest({
      accountId: 'account-a',
      targetProfileId: 'friend-1',
      targetName: 'Friend One',
    })).toBe(false);

    const unsubscribe = subscribeToLiveFriendAudioRequests('account-a', received);
    expect(received).toHaveBeenCalledOnce();
    expect(received).toHaveBeenCalledWith({
      accountId: 'account-a',
      targetProfileId: 'friend-1',
      targetName: 'Friend One',
    });
    unsubscribe();
    const secondSubscriber = vi.fn();
    subscribeToLiveFriendAudioRequests('account-a', secondSubscriber)();
    expect(secondSubscriber).not.toHaveBeenCalled();
  });

  it('isolates queued requests by account and clears stale intent on account switch', () => {
    const accountA = vi.fn();
    const unsubscribeA = subscribeToLiveFriendAudioRequests('account-a', accountA);
    queueLiveFriendAudioRequest({
      accountId: 'account-b',
      targetProfileId: 'friend-b',
      targetName: 'Friend B',
    });
    expect(accountA).not.toHaveBeenCalled();

    unsubscribeA();
    clearQueuedLiveFriendAudioRequests();
    const accountB = vi.fn();
    subscribeToLiveFriendAudioRequests('account-b', accountB)();
    expect(accountB).not.toHaveBeenCalled();
  });

  it('keeps mobile controls tappable, keyboard-visible, and motion-safe', () => {
    const css = readFileSync(new URL('../../src/components/LiveFriendAudioCoordinator.css', import.meta.url), 'utf8');

    expect(css).toMatch(/\.live-friend-audio-actions button,[\s\S]*?min-height:\s*44px;/);
    expect(css).toMatch(/\.live-friend-audio-actions button:focus-visible,[\s\S]*?outline:\s*3px solid/);
    expect(css).toContain('@media (max-width: 820px)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toMatch(/\.live-friend-audio-layer\s*{[^}]*pointer-events:\s*none;/);
    expect(css).toMatch(/\.live-friend-audio-card\s*{[^}]*pointer-events:\s*auto;/);
  });
});
