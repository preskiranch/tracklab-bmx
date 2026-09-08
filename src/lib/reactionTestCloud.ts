import { clubTabletSessionHeader, clubTabletResultUploadHeader, type ClubTabletSessionCredential } from './clubTabletStorage';
import type { ReactionTestResult } from './reactionTest';

export type ReactionRecordOwner = { kind: 'account'; accountId: string }
  | { kind: 'tablet'; credential: ClubTabletSessionCredential; deviceToken: string };

type LocalBest = { bestMs: number | null; averageBestMs?: number | null; seriesId?: string; seriesTimes?: number[]; queue?: Array<{ result: ReactionTestResult; owner: ReactionRecordOwner }>; pending?: { result: ReactionTestResult; owner: ReactionRecordOwner } };
const volatileBests = new Map<string, LocalBest>();
const uploads = new Map<string, Promise<ReactionProfile | null>>();
const erasedOwners = new Set<string>();

function ownerKey(owner: ReactionRecordOwner) {
  return `tracklab.reaction-best.v1:${owner.kind === 'account'
    ? `account:${owner.accountId}`
    : `tablet:${owner.credential.session.clubId}:${owner.credential.session.studioRiderId}`}`;
}

function localBest(owner: ReactionRecordOwner): LocalBest | null {
  const key = ownerKey(owner);
  if (erasedOwners.has(key)) return null;
  if (volatileBests.has(key)) return volatileBests.get(key)!;
  try {
    const stored = JSON.parse(localStorage.getItem(key) || 'null') as LocalBest | null;
    if (stored && (stored.bestMs === null || (Number.isFinite(stored.bestMs) && stored.bestMs > 0))
      && (!stored.pending || ownerKey(stored.pending.owner) === key)
      && (!stored.queue || (Array.isArray(stored.queue) && stored.queue.every(item => ownerKey(item.owner) === key)))) return stored;
  } catch { /* Retain the in-memory best if browser storage is unavailable. */ }
  return volatileBests.get(key) ?? null;
}

function storeBest(owner: ReactionRecordOwner, value: LocalBest) {
  const key = ownerKey(owner);
  if (erasedOwners.has(key)) return;
  volatileBests.set(key, value);
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage may be unavailable. */ }
}

export function localReactionPersonalBest(owner: ReactionRecordOwner) {
  return localBest(owner)?.bestMs ?? null;
}

export function localReactionAverageBest(owner: ReactionRecordOwner) {
  return localBest(owner)?.averageBestMs ?? null;
}

export function clearLocalReactionAccount(accountId: string) {
  const key = ownerKey({ kind: 'account', accountId });
  erasedOwners.add(key);
  volatileBests.delete(key);
  try { localStorage.removeItem(key); } catch { /* The account has still been erased on the server. */ }
}

export type ReactionProfile = {
  personalBestMs: number | null;
  averageBestMs?: number | null;
  seriesCount?: number;
  leaderboard: { joined: boolean; hidden?: boolean; displayName: string };
  canJoinLeaderboard: boolean;
};

export type ReactionLeader = {
  rank: number;
  displayName: string;
  reactionTimeMs: number;
  isYou: boolean;
};

async function reactionRequest<T>(path: string, owner: ReactionRecordOwner | null, method = 'GET', body?: unknown): Promise<T> {
  const tablet = owner?.kind === 'tablet' ? owner : null;
  const response = await fetch(`/api/reaction-test${path}`, {
    method,
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(tablet ? {
        [clubTabletSessionHeader]: tablet.credential.sessionToken,
        ...(tablet.deviceToken ? { Authorization: `Bearer ${tablet.deviceToken}` } : {}),
        ...(path === '/result' && tablet.deviceToken && tablet.credential.resultUploadToken
          ? { [clubTabletResultUploadHeader]: tablet.credential.resultUploadToken } : {}),
      } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error || 'Reaction Test could not connect. Please try again.');
  }
  return response.json() as Promise<T>;
}

export function loadReactionProfile(owner: ReactionRecordOwner | null) {
  const query = owner?.kind === 'account' ? `?expectedAccountId=${encodeURIComponent(owner.accountId)}` : '';
  return reactionRequest<ReactionProfile>(query, owner);
}

export function saveReactionPersonalBest(result: ReactionTestResult, owner: ReactionRecordOwner) {
  const previous = localBest(owner);
  const queue = [...(previous?.queue ?? (previous?.pending ? [previous.pending] : []))];
  if (queue.some(item => item.result.id === result.id)) return flushReactionPersonalBest(owner);
  queue.push({ result, owner });
  const times = previous?.seriesId === result.seriesId ? [...(previous?.seriesTimes ?? [])] : [];
  let averageBestMs = previous?.averageBestMs ?? null;
  if (result.falseStart) times.length = 0;
  else if (result.valid && result.reactionTimeMs != null && result.seriesId) times.push(result.reactionTimeMs);
  if (times.length === 3) {
    averageBestMs = Math.min(averageBestMs ?? Infinity, times.reduce((sum, value) => sum + value, 0) / 3);
    times.length = 0;
  }
  storeBest(owner, {
    averageBestMs, seriesId: result.seriesId, seriesTimes: times,
    bestMs: result.valid && result.reactionTimeMs != null
      ? Math.min(previous?.bestMs ?? Infinity, result.reactionTimeMs) : previous?.bestMs ?? null,
    queue,
  });
  return flushReactionPersonalBest(owner);
}

/** Upload every attempt in order, including false starts; never collapse to a minimum. */
export function flushReactionPersonalBest(owner: ReactionRecordOwner): Promise<ReactionProfile | null> {
  const key = ownerKey(owner);
  if (uploads.has(key)) return uploads.get(key)!;
  const upload = (async () => {
    let response: ReactionProfile | null = null;
    while (true) {
      const saved = localBest(owner);
      const queue = saved?.queue ?? (saved?.pending ? [saved.pending] : []);
      const pending = queue[0];
      if (!pending) break;
      response = await reactionRequest<ReactionProfile>('/result', pending.owner, 'POST', {
        result: pending.result,
        ...(pending.owner.kind === 'account' ? { expectedAccountId: pending.owner.accountId } : {}),
      });
      const latest = localBest(owner);
      if (!latest) break;
      storeBest(owner, { ...latest, pending: undefined, bestMs: latest.bestMs,
        queue: (latest.queue ?? (latest.pending ? [latest.pending] : [])).filter(item => item.result.id !== pending.result.id) });
    }
    return response;
  })();
  uploads.set(key, upload);
  void upload.finally(() => { uploads.delete(key); }).catch(() => undefined);
  return upload;
}

export function loadReactionLeaderboard(limit: number, owner: ReactionRecordOwner | null) {
  const account = owner?.kind === 'account' ? `&expectedAccountId=${encodeURIComponent(owner.accountId)}` : '';
  return reactionRequest<{ entries: ReactionLeader[] }>(`/leaderboard?limit=${limit}${account}`, owner);
}

export function setReactionLeaderboardParticipation(joined: boolean, displayName: string, owner: ReactionRecordOwner | null) {
  return reactionRequest<ReactionProfile>('/leaderboard', owner, 'PATCH', {
    joined, displayName, ...(owner?.kind === 'account' ? { expectedAccountId: owner.accountId } : {}),
  });
}
