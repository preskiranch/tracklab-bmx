import type { AccountProfile, TrainingActivityType, TrainingSession } from '../types';
import type { ClubAthleteMembership } from './clubConnect';
import { normalizePersonalRecords } from './personalRecords';
import { normalizeRiderPhotoDataUrl } from './riderPhotos';
import {
  isReactionTestSession,
  sanitizeTrainingSessionForExport,
  type TrainingHistoryResponse,
} from './trainingHistory';

export type FamilyPermissions = Readonly<{ activity: true; health: false }>;
export type FamilyChild = Readonly<{
  id: string;
  kind: 'managed' | 'linked';
  name: string;
  photoUrl?: string;
  createdAt: number;
  updatedAt: number;
  permissions: FamilyPermissions;
}>;
export type FamilyInvite = Readonly<{
  id: string;
  expiresAt: number;
  claimedAt: number | null;
  revokedAt: number | null;
}>;
export type FamilyShare = Readonly<{
  id: string;
  parentName: string;
  createdAt: number;
  permissions: FamilyPermissions;
}>;
export type FamilyState = Readonly<{
  children: FamilyChild[];
  archivedChildren: FamilyChild[];
  invitations: FamilyInvite[];
  sharedWith: FamilyShare[];
}>;
export type FamilyProfile = Readonly<{
  child: FamilyChild;
  accountProfile: AccountProfile;
  memberships: ClubAthleteMembership[];
  healthAvailable: false;
}>;
export type FamilyHistory = TrainingHistoryResponse & Readonly<{
  child: FamilyChild;
  healthAvailable: false;
}>;
export type FamilyInvitationPreview = Readonly<{
  invite: FamilyInvite;
  parentName: string;
  canAccept: boolean;
}>;

export class FamilyRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'FamilyRequestError';
    this.status = status;
  }
}

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const activityTypes = new Set<TrainingActivityType>([
  'bmx-race', 'straight-sprint', 'explore', 'get-pulled', 'monitor-sprint',
]);

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Family data could not be read. Refresh and try again.');
  }
  return value as Record<string, unknown>;
}

function identifier(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9:_-]{1,180}$/.test(value)) {
    throw new Error('Family data contained an invalid profile reference.');
  }
  return value;
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim().slice(0, 240) : fallback;
}

function timestamp(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function permissions(value: unknown): FamilyPermissions {
  const raw = object(value);
  if (raw.activity !== true || raw.health !== false) {
    throw new Error('This family permission could not be verified. Refresh family access.');
  }
  return { activity: true, health: false };
}

export function normalizeFamilyChild(value: unknown): FamilyChild {
  const raw = object(value);
  if ((raw.kind !== 'managed' && raw.kind !== 'linked') || !text(raw.name)) {
    throw new Error('This family profile could not be verified.');
  }
  const photoUrl = normalizeRiderPhotoDataUrl(raw.photoUrl);
  return {
    id: identifier(raw.id), kind: raw.kind, name: text(raw.name),
    ...(photoUrl ? { photoUrl } : {}),
    createdAt: timestamp(raw.createdAt), updatedAt: timestamp(raw.updatedAt),
    permissions: permissions(raw.permissions),
  };
}

function normalizeInvite(value: unknown): FamilyInvite {
  const raw = object(value);
  return {
    id: identifier(raw.id), expiresAt: timestamp(raw.expiresAt),
    claimedAt: raw.claimedAt == null ? null : timestamp(raw.claimedAt),
    revokedAt: raw.revokedAt == null ? null : timestamp(raw.revokedAt),
  };
}

function normalizeShare(value: unknown): FamilyShare {
  const raw = object(value);
  return {
    id: identifier(raw.id), parentName: text(raw.parentName, 'Parent'),
    createdAt: timestamp(raw.createdAt), permissions: permissions(raw.permissions),
  };
}

function verifiedSubject(raw: Record<string, unknown>, childId: string) {
  const child = normalizeFamilyChild(raw.child);
  if (child.id !== childId || raw.healthAvailable !== false) {
    throw new Error('The returned records did not match the selected family profile.');
  }
  return child;
}

export function normalizeFamilyProfile(value: unknown, childId: string): FamilyProfile {
  const raw = object(value);
  const child = verifiedSubject(raw, childId);
  const profile = object(raw.accountProfile);
  const photoUrl = normalizeRiderPhotoDataUrl(profile.photoUrl);
  const personalRecords = normalizePersonalRecords(profile.personalRecords);
  const memberships = Array.isArray(raw.memberships) ? raw.memberships.map((item) => {
    const member = object(item);
    return {
      clubId: identifier(member.clubId), clubName: text(member.clubName),
      studioRiderId: identifier(member.studioRiderId), riderName: text(member.riderName),
      claimedAt: member.claimedAt == null ? null : timestamp(member.claimedAt),
    };
  }) : [];
  return {
    child,
    accountProfile: {
      ...(photoUrl ? { photoUrl } : {}), ...(personalRecords ? { personalRecords } : {}),
      updatedAt: timestamp(profile.updatedAt),
    },
    memberships, healthAvailable: false,
  };
}

export function normalizeFamilyHistory(value: unknown, childId: string): FamilyHistory {
  const raw = object(value);
  const child = verifiedSubject(raw, childId);
  if (!Array.isArray(raw.sessions)) throw new Error('Family activity records could not be read.');
  const sessions = raw.sessions.flatMap((item): TrainingSession[] => {
    const candidate = object(item);
    if (!activityTypes.has(candidate.activityType as TrainingActivityType)
      || typeof candidate.id !== 'string' || !candidate.id.trim()
      || typeof candidate.startedAt !== 'number' || !Number.isFinite(candidate.startedAt)
      || typeof candidate.endedAt !== 'number' || !Number.isFinite(candidate.endedAt)) {
      throw new Error('A family activity record could not be verified.');
    }
    const session = sanitizeTrainingSessionForExport(candidate as unknown as TrainingSession);
    return isReactionTestSession(session) ? [] : [session];
  });
  return {
    child, sessions, healthAvailable: false,
    totals: {
      sessions: sessions.length,
      bmxRaces: sessions.filter((session) => session.activityType === 'bmx-race').length,
      straightSprints: sessions.filter((session) => session.activityType === 'straight-sprint').length,
      exploreRides: sessions.filter((session) => session.activityType === 'explore').length,
      getPulledTests: sessions.filter((session) => session.activityType === 'get-pulled').length,
      monitorSprints: sessions.filter((session) => session.activityType === 'monitor-sprint').length,
      distanceMeters: sessions.reduce((sum, session) => sum + session.distanceMeters, 0),
      durationMs: sessions.reduce((sum, session) => sum + session.durationMs, 0),
    },
  };
}

async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(path, {
    ...options, cache: 'no-store', credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = payload && typeof payload === 'object' ? text((payload as { error?: unknown }).error) : '';
    throw new FamilyRequestError(error || `Family access returned ${response.status}.`, response.status);
  }
  return object(payload);
}

function childPath(childId: string) {
  return `/api/family/children/${encodeURIComponent(identifier(childId))}`;
}

export async function loadFamily(signal?: AbortSignal): Promise<FamilyState> {
  const raw = await request('/api/family', { signal });
  if (!Array.isArray(raw.children) || !Array.isArray(raw.invitations) || !Array.isArray(raw.sharedWith)) {
    throw new Error('Family access could not be verified. Refresh and try again.');
  }
  const archivedChildren = Array.isArray(raw.archivedChildren) ? raw.archivedChildren.map(normalizeFamilyChild) : [];
  if (archivedChildren.some((child) => child.kind !== 'managed')) throw new Error('An archived family profile could not be verified.');
  return { children: raw.children.map(normalizeFamilyChild), archivedChildren, invitations: raw.invitations.map(normalizeInvite), sharedWith: raw.sharedWith.map(normalizeShare) };
}

export async function createFamilyChild(name: string, signal?: AbortSignal) {
  const raw = await request('/api/family/children', { method: 'POST', body: JSON.stringify({ name: name.trim() }), signal });
  return normalizeFamilyChild(raw.child);
}

export async function loadFamilyProfile(childId: string, signal?: AbortSignal) {
  return normalizeFamilyProfile(await request(`${childPath(childId)}/profile`, { signal }), childId);
}

export async function loadFamilyHistory(childId: string, from: number, to: number, signal?: AbortSignal) {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from) {
    throw new Error('Choose a valid family activity date range.');
  }
  const path = `${childPath(childId)}/training-sessions`;
  let requests = 0;
  async function loadWindow(start: number, end: number): Promise<FamilyHistory> {
    signal?.throwIfAborted();
    if (++requests > 127) throw new Error('This activity period is too large to load completely. Please contact support.');
    const query = new URLSearchParams({ from: String(start), to: String(end), limit: '1000' });
    const raw = await request(`${path}?${query}`, { signal });
    signal?.throwIfAborted();
    const history = normalizeFamilyHistory(raw, childId);
    // A full response may omit older records. Split the inclusive date range
    // so the calendar and exports never silently present a truncated month.
    if ((raw.sessions as unknown[]).length < 1000) return history;
    if (start === end) throw new Error('These activity records could not be loaded completely. Please contact support.');
    const midpoint = start + Math.floor((end - start) / 2);
    const earlier = await loadWindow(start, midpoint);
    const later = await loadWindow(midpoint + 1, end);
    const sessions = [...new Map([...earlier.sessions, ...later.sessions].map((record) => [record.id, record])).values()]
      .sort((a, b) => b.startedAt - a.startedAt || a.id.localeCompare(b.id));
    return normalizeFamilyHistory({ ...later, sessions }, childId);
  }
  return loadWindow(from, to);
}

export async function claimFamilyClubInvitation(childId: string, token: string, signal?: AbortSignal) {
  if (!tokenPattern.test(token)) throw new Error('Paste a valid Club Connect invitation link or code.');
  return normalizeFamilyProfile(await request(`${childPath(childId)}/club-claim`, {
    method: 'POST', body: JSON.stringify({ token }), signal,
  }), childId);
}

export async function createFamilyInvitation(signal?: AbortSignal) {
  const raw = await request('/api/family/link-invites', { method: 'POST', body: '{}', signal });
  const claimUrl = text(raw.claimUrl);
  if (!familyInviteTokenFromHref(claimUrl)) throw new Error('The family invitation link could not be read.');
  return { invite: normalizeInvite(raw.invite), claimUrl };
}

export async function previewFamilyInvitation(token: string, signal?: AbortSignal): Promise<FamilyInvitationPreview> {
  if (!tokenPattern.test(token)) throw new Error('This family invitation link is invalid.');
  const raw = await request(`/api/family/link-invites/preview?${new URLSearchParams({ token })}`, { signal });
  return { invite: normalizeInvite(raw.invite), parentName: text(raw.parentName, 'Parent'), canAccept: raw.canAccept === true };
}

export async function acceptFamilyInvitation(token: string, signal?: AbortSignal) {
  if (!tokenPattern.test(token)) throw new Error('This family invitation link is invalid.');
  const raw = await request('/api/family/link-invites/accept', {
    method: 'POST', body: JSON.stringify({ token, activityConsent: true }), signal,
  });
  if (raw.ok !== true) throw new Error('Family permission could not be confirmed. Refresh family access.');
  return { parentName: text(raw.parentName, 'Parent') };
}

export async function removeFamilyChild(childId: string, signal?: AbortSignal) {
  await request(childPath(childId), { method: 'DELETE', signal });
}

export async function restoreFamilyChild(childId: string, signal?: AbortSignal) {
  const raw = await request(`${childPath(childId)}/restore`, { method: 'POST', body: '{}', signal });
  const child = normalizeFamilyChild(raw.child);
  if (child.id !== childId || child.kind !== 'managed') throw new Error('The restored family profile could not be verified.');
  return child;
}

export async function revokeFamilyShare(shareId: string, signal?: AbortSignal) {
  await request(`/api/family/shared-with/${encodeURIComponent(identifier(shareId))}`, { method: 'DELETE', signal });
}

export async function revokeFamilyInvitation(inviteId: string, signal?: AbortSignal) {
  await request(`/api/family/link-invites/${encodeURIComponent(identifier(inviteId))}`, { method: 'DELETE', signal });
}

export function familyInviteTokenFromHref(href: string) {
  try {
    const url = new URL(href);
    const token = new URLSearchParams(url.hash.replace(/^#/, '')).get('familyInvite') ?? '';
    return tokenPattern.test(token) ? token : '';
  } catch { return ''; }
}

export function familyClubInviteToken(value: string) {
  const trimmed = value.trim();
  if (tokenPattern.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    const token = url.searchParams.get('clubInvite')
      || new URLSearchParams(url.hash.replace(/^#/, '')).get('clubInvite') || '';
    return tokenPattern.test(token) ? token : '';
  } catch { return ''; }
}

export function clearFamilyInviteFromUrl() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  hash.delete('familyInvite');
  url.hash = hash.toString();
  window.history.replaceState(window.history.state, '', url);
}
