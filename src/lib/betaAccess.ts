import type { AuthUser } from './auth';

export type BetaGrant = {
  id: string;
  userId?: string;
  email?: string;
  active: boolean;
  bikeSeats: number;
  startsAt?: number;
  claimedAt?: number;
  expiresAt: number;
  revokedAt: number | null;
};

export type BetaInvitation = {
  id: string;
  email: string;
  bikeSeats: number;
  durationDays: number;
  expiresAt: number;
  claimedAt: number | null;
  revokedAt: number | null;
  createdAt: number;
};

export type BetaAdminState = { invites: BetaInvitation[]; grants: BetaGrant[] };

async function betaRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Beta access is unavailable. Please try again.');
  return payload as T;
}

export const readBetaAccess = () => betaRequest<{ beta: BetaGrant | null }>('/api/beta-access');
export const readBetaAdmin = () => betaRequest<BetaAdminState>('/api/admin/beta-access');
export const createBetaInvitation = (email: string, bikeSeats: number, durationDays: number) => (
  betaRequest<{ invite: BetaInvitation; claimUrl: string }>('/api/admin/beta-access/invites', {
    method: 'POST', body: JSON.stringify({ email, bikeSeats, durationDays }),
  })
);
export const revokeBetaAccess = (target: { inviteId: string } | { grantId: string }) => (
  betaRequest<{ ok: true }>('/api/admin/beta-access/revoke', {
    method: 'POST', body: JSON.stringify(target),
  })
);
export const acceptBetaInvitation = (token: string) => (
  betaRequest<{ beta: BetaGrant; user: AuthUser }>('/api/beta-access/accept', {
    method: 'POST', body: JSON.stringify({ token }),
  })
);

export function betaInviteTokenFromHref(href: string) {
  try {
    const token = new URLSearchParams(new URL(href, 'https://tracklab-bmx.onrender.com').hash.slice(1))
      .get('betaInvite') ?? '';
    return /^[A-Za-z0-9_-]{32,128}$/.test(token) ? token : '';
  } catch {
    return '';
  }
}

export function clearBetaInvitationFromUrl() {
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.slice(1));
  hash.delete('betaInvite');
  url.hash = hash.toString();
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

export function betaFeedbackHref(device: string, version = 'Web') {
  const body = [
    'What were you trying to do?', '',
    'What happened?', '',
    'What did you expect?', '',
    'Wattbike model:', '',
    'Steps to reproduce:', '',
    'Please attach a screenshot if helpful.', '',
    `TrackLab version: ${version}`,
    `Device/browser: ${device}`,
  ].join('\n');
  return `mailto:preskiranch@gmail.com?subject=${encodeURIComponent('TrackLab BMX beta feedback')}&body=${encodeURIComponent(body)}`;
}
