import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { subscribeToAuthenticatedEventStream } from '../../src/lib/authenticatedEventStream';
import { trackLabServiceFetch } from '../../src/lib/serviceTransport';
import { trackLabProductionOrigin } from '../../src/lib/serviceOrigins';
import { authenticatedWebSocketUrl, requestWebSocketTicket } from '../../src/lib/webSocketTicket';

describe('bundled native service transport', () => {
  it('routes only relative TrackLab API requests and carries the Keychain bearer out of URLs', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));
    const token = 'A'.repeat(43);
    await trackLabServiceFetch(fetcher, '/api/auth/me', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    }, { native: true, token });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe(`${trackLabProductionOrigin}/api/auth/me`);
    expect(String(url)).not.toContain(token);
    expect(init?.credentials).toBe('omit');
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${token}`);
    expect(new Headers(init?.headers).get('X-TrackLab-Native-Session')).toBe('1');

    fetcher.mockClear();
    await trackLabServiceFetch(fetcher, '/data/track-database.json', {}, { native: true, token });
    await trackLabServiceFetch(fetcher, 'http://127.0.0.1:8787/api/bridge/connect', {}, { native: true, token });
    expect(fetcher.mock.calls.map(([input]) => String(input))).toEqual([
      '/data/track-database.json',
      'http://127.0.0.1:8787/api/bridge/connect',
    ]);
    expect(fetcher.mock.calls.every(([, request]) => (
      !new Headers(request?.headers).has('Authorization')
    ))).toBe(true);

    fetcher.mockClear();
    await trackLabServiceFetch(fetcher, '/api/club-tablet/devices', {
      headers: { Authorization: 'Bearer device-specific-token' },
    }, { native: true, token });
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('Authorization'))
      .toBe('Bearer device-specific-token');
  });

  it('parses authenticated fetch streaming without putting credentials in an EventSource URL', async () => {
    const encoded = new TextEncoder().encode(
      'event: ready\ndata: {"ok":true}\n\nevent: changed\ndata: {"id":1}\n\n',
    );
    const fetcher = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoded);
      },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
    const events: Array<{ type: string; data: string }> = [];
    const stop = subscribeToAuthenticatedEventStream('/api/events', {
      fetcher,
      onEvent: ({ type, data }) => events.push({ type, data }),
    });
    await vi.waitFor(() => expect(events).toEqual([
      { type: 'ready', data: '{"ok":true}' },
      { type: 'changed', data: '{"id":1}' },
    ]));
    stop();
    expect(fetcher).toHaveBeenCalledWith('/api/events', expect.objectContaining({
      credentials: 'same-origin',
      headers: { Accept: 'text/event-stream' },
    }));
  });

  it('packages the audited web bundle and stores native auth only in a device-bound Keychain item', () => {
    const capacitor = readFileSync('capacitor.config.ts', 'utf8');
    const nativePlugin = readFileSync('ios/App/App/NativeSessionPlugin.swift', 'utf8');
    const nativeAuth = readFileSync('src/lib/nativeAuthSession.ts', 'utf8');
    const nativeClubTablet = readFileSync('src/lib/nativeClubTabletCredential.ts', 'utf8');
    const main = readFileSync('src/main.tsx', 'utf8');
    const clientSources = [
      readFileSync('src/lib/friends.ts', 'utf8'),
      readFileSync('src/lib/heartRateCloud.ts', 'utf8'),
      readFileSync('src/components/AccountProfileView.tsx', 'utf8'),
    ].join('\n');
    expect(capacitor).not.toMatch(/\burl\s*:\s*['"]https?:/u);
    expect(capacitor).toContain("webDir: 'dist'");
    expect(nativePlugin).toContain('kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly');
    expect(nativePlugin).toMatch(/kSecAttrSynchronizable as String\]\s*=\s*false/u);
    expect(nativePlugin).toContain('loadClubTabletCredential');
    expect(nativePlugin).toContain('saveClubTabletCredential');
    expect(nativePlugin).toContain('clearClubTabletCredential');
    expect(nativePlugin).toContain('com.preskilranch.tracklabbmx.club-tablet');
    expect(nativePlugin).toContain('device-credential-v1');
    expect(nativePlugin.match(/kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly/gu)).toHaveLength(2);
    expect(nativePlugin.match(/kSecAttrSynchronizable as String\]\s*=\s*false/gu)).toHaveLength(2);
    const personalClear = nativePlugin.slice(
      nativePlugin.indexOf('@objc public func clearSession'),
      nativePlugin.indexOf('@objc public func loadClubTabletCredential'),
    );
    const clubClear = nativePlugin.slice(
      nativePlugin.indexOf('@objc public func clearClubTabletCredential'),
      nativePlugin.indexOf('private static func query()'),
    );
    expect(personalClear).toContain('Self.query()');
    expect(personalClear).not.toContain('clubTabletQuery');
    expect(clubClear).toContain('Self.clubTabletQuery()');
    expect(clubClear).not.toContain('Self.query()');
    expect(nativeClubTablet).toContain('restoreNativeClubTabletCredential');
    expect(main.indexOf('await restoreNativeClubTabletCredential()'))
      .toBeLessThan(main.indexOf("await import('./App')"));
    expect(nativeAuth).not.toContain('localStorage');
    expect(clientSources).not.toContain('new EventSource(');
  });

  it('keeps the one-use WebSocket credential scoped to the TLS query and validates its envelope', async () => {
    const token = 'T'.repeat(43);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ticket: token,
      expiresAt: Date.now() + 10_000,
    }), { status: 201, headers: { 'Content-Type': 'application/json' } })));
    await expect(requestWebSocketTicket('live-audio')).resolves.toEqual(expect.objectContaining({ ticket: token }));
    expect(fetch).toHaveBeenCalledWith('/api/auth/websocket-ticket', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ scope: 'live-audio' }),
    }));

    vi.stubGlobal('window', {
      location: {
        href: `${trackLabProductionOrigin}/`,
        host: 'tracklab-bmx.onrender.com',
        protocol: 'https:',
      },
    });
    const socketUrl = authenticatedWebSocketUrl({ authTicket: token });
    expect(socketUrl).toBe(`wss://tracklab-bmx.onrender.com/multiplayer?authTicket=${token}`);
    expect(socketUrl).not.toContain('Bearer');
  });
});
