import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acceptBetaInvitation, betaFeedbackHref, betaInviteTokenFromHref, createBetaInvitation,
} from '../../src/lib/betaAccess';
import { betaInviteTokenFromAppLink } from '../../src/lib/nativeAppLinks';
import { multiplayerMessageAllowed } from '../../src/lib/liveMultiplayerAvailability';
import { shouldOpenCommunityHomeOnLaunch } from '../../src/lib/startupLanding';

const token = 'q'.repeat(43);
afterEach(() => vi.unstubAllGlobals());

describe('beta invitation handoff', () => {
  it('reads a fragment token without accepting a token in the query or malformed value', () => {
    expect(betaInviteTokenFromHref(`https://tracklab-bmx.onrender.com/#betaInvite=${token}`)).toBe(token);
    expect(betaInviteTokenFromHref(`https://tracklab-bmx.onrender.com/?betaInvite=${token}`)).toBe('');
    expect(betaInviteTokenFromHref('https://tracklab-bmx.onrender.com/#betaInvite=bad!')).toBe('');
    expect(shouldOpenCommunityHomeOnLaunch(`https://tracklab-bmx.onrender.com/#betaInvite=${token}`)).toBe(false);
  });

  it('accepts native beta links only from the exact production root', () => {
    expect(betaInviteTokenFromAppLink(`https://tracklab-bmx.onrender.com/#betaInvite=${token}`)).toBe(token);
    for (const origin of [
      'https://evil.example', 'http://tracklab-bmx.onrender.com',
      'https://tracklab-bmx.onrender.com:8443', 'https://tracklab-bmx.onrender.com/unrelated',
    ]) expect(betaInviteTokenFromAppLink(`${origin}/#betaInvite=${token}`)).toBe('');
  });

  it('submits the token in an authenticated POST body, never a request URL', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ beta: {}, user: { id: 'tester' } })));
    vi.stubGlobal('fetch', fetcher);
    await acceptBetaInvitation(token);
    expect(fetcher).toHaveBeenCalledWith('/api/beta-access/accept', expect.objectContaining({
      method: 'POST', credentials: 'same-origin', body: JSON.stringify({ token }),
    }));
    expect(fetcher.mock.calls[0][0]).not.toContain(token);
  });

  it('shows a server denial instead of treating an invitation as created', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Administrator access required.' }), { status: 403 })));
    await expect(createBetaInvitation('tester@example.com', 4, 90)).rejects.toThrow('Administrator access required.');
  });

  it('opens an editable feedback template with device details and no invitation credential', () => {
    const href = betaFeedbackHref('iPad Safari', '1.1 (77)');
    const url = new URL(href);
    expect(url.protocol).toBe('mailto:');
    expect(url.pathname).toBe('preskiranch@gmail.com');
    expect(url.searchParams.get('body')).toContain('Device/browser: iPad Safari');
    expect(url.searchParams.get('body')).toContain('What happened?');
    expect(href).not.toContain('betaInvite');
  });
});

describe('beta live-room gate', () => {
  it('keeps Wattbike presence and connection cleanup while blocking live racing commands', () => {
    for (const type of ['presence', 'ping', 'leave-room']) expect(multiplayerMessageAllowed(type, false)).toBe(true);
    for (const type of ['create-room', 'join-room', 'create-match', 'quick-race', 'room-start', 'room-race-state', 'voice-signal']) {
      expect(multiplayerMessageAllowed(type, false)).toBe(false);
      expect(multiplayerMessageAllowed(type, true)).toBe(true);
    }
  });
});
