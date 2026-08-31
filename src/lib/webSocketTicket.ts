import { isTrackLabNativeShell, trackLabWebSocketUrl } from './serviceOrigins';

export type WebSocketTicketScope = 'multiplayer' | 'live-audio' | 'club-live-stream';

export async function requestWebSocketTicket(scope: WebSocketTicketScope) {
  const response = await fetch('/api/auth/websocket-ticket', {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ scope }),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  const ticket = typeof payload.ticket === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(payload.ticket)
    ? payload.ticket
    : '';
  const expiresAt = Number(payload.expiresAt);
  if (!response.ok || !ticket || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    const message = typeof payload.error === 'string' ? payload.error : '';
    throw new Error(message || 'TrackLab could not authorize the live connection.');
  }
  return { ticket, expiresAt };
}

export function authenticatedWebSocketUrl({
  authTicket = '',
  clubTabletTicket = '',
}: {
  authTicket?: string;
  clubTabletTicket?: string;
}) {
  const configured = import.meta.env.VITE_TRACKLAB_MULTIPLAYER_URL?.trim();
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const fallback = isTrackLabNativeShell()
    ? trackLabWebSocketUrl('/multiplayer')
    : `${protocol}//${window.location.host}/multiplayer`;
  const url = new URL(configured || fallback, window.location.href);
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('TrackLab live connection is misconfigured.');
  }
  if (authTicket) url.searchParams.set('authTicket', authTicket);
  if (clubTabletTicket) url.searchParams.set('clubTabletTicket', clubTabletTicket);
  return url.toString();
}
