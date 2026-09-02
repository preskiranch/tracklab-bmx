import {
  normalizeRecoveryEffortSummary,
  type RecoveryActivityType,
  type RecoveryEffortSummary,
} from './recoveryAlert';
import { normalizeRecoveryAccountId } from './recoveryAlertCloud';
import {
  getPulledRecoveryFinishSignal,
  raceRecoveryFinishSignals,
  type RecoveryFinishSignal,
  type RecoveryGetPulledResult,
  type RecoveryRaceSnapshot,
} from './recoveryFinishSignals';
import {
  clubTabletRecoveryOutboxStorageKey,
  clubTabletResultUploadHeader,
  clubTabletSessionHeader,
  readStoredClubTabletDevice,
  type ClubTabletSessionCredential,
} from './clubTabletStorage';

export type CreateClubTabletRecoveryEpisodeInput = Readonly<{
  requestId: string;
  activityType: RecoveryActivityType;
  sessionId: string;
  repetitionId: string;
  finishedAt: number;
  effortSummary?: RecoveryEffortSummary;
}>;

export type ClubTabletRecoveryFinishContext = Readonly<{
  credential: ClubTabletSessionCredential;
  mode: 'race' | 'straight-sprint' | 'get-pulled';
  raceCapture: Readonly<{
    sessionId: string;
    startedAt: number | null;
    source: 'live' | 'demo';
    players: readonly Readonly<{
      id: string | number;
      riderId?: string;
    }>[];
  }> | null;
  raceRiders: readonly Readonly<{
    playerId: string | number;
    finishedAt: number | null;
  }>[];
  getPulledResult: RecoveryGetPulledResult | null;
}>;

export type ClubTabletRecoverySubmitOptions = Readonly<{
  /** Keep the small opaque finish request alive through an athlete handoff. */
  keepalive?: boolean;
}>;

type ClubTabletRecoveryResponse = Readonly<{
  accountId: string;
  replayed: boolean;
}>;

type ClubTabletRecoveryOutboxEntry = Readonly<{
  version: 1;
  id: string;
  deviceId: string;
  sessionToken: string;
  resultUploadToken: string;
  resultUploadExpiresAt: number;
  input: CreateClubTabletRecoveryEpisodeInput;
  createdAt: number;
  attempts: number;
}>;

const clubTabletRecoveryOutboxMaximum = 64;
/** Must remain aligned with the server's `recoveryAlertFinishDeliveryWindowMs`.
 * Retaining a recovery completion for days would produce a misleading late
 * alert, so the durable result credential covers the brief handoff/offline
 * window in which that athlete's recovery is still meaningful. */
export const clubTabletRecoveryFinishDeliveryWindowMs = 10 * 60 * 1_000;

function identifier(value: unknown, maximumLength = 160) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return /^[a-zA-Z0-9][a-zA-Z0-9:._-]*$/u.test(normalized) && normalized.length <= maximumLength
    ? normalized
    : '';
}

function requestId(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return /^[a-zA-Z0-9_-]{24,160}$/u.test(normalized) ? normalized : '';
}

function recoveryError(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === 'string' && error.trim()) return error.trim();
  }
  return fallback;
}

function normalizedRecoveryInput(
  input: CreateClubTabletRecoveryEpisodeInput,
): CreateClubTabletRecoveryEpisodeInput | null {
  const normalizedRequestId = requestId(input.requestId);
  const sessionId = identifier(input.sessionId);
  const repetitionId = identifier(input.repetitionId);
  const finishedAt = Number(input.finishedAt);
  const effortSummary = normalizeRecoveryEffortSummary(input.effortSummary);
  if (
    !normalizedRequestId || !sessionId || !repetitionId
    || !Number.isSafeInteger(finishedAt) || finishedAt < 0 || effortSummary == null
  ) return null;
  return {
    requestId: normalizedRequestId,
    activityType: input.activityType,
    sessionId,
    repetitionId,
    finishedAt,
    effortSummary,
  };
}

function recoveryOutboxId(deviceId: string, requestIdValue: string) {
  return `${deviceId}:${requestIdValue}`;
}

function readClubTabletRecoveryOutbox() {
  if (typeof window === 'undefined') return [] as ClubTabletRecoveryOutboxEntry[];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(clubTabletRecoveryOutboxStorageKey) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [] as ClubTabletRecoveryOutboxEntry[];
    const now = Date.now();
    return parsed.flatMap((value) => {
      if (!value || typeof value !== 'object') return [];
      const candidate = value as Partial<ClubTabletRecoveryOutboxEntry>;
      const deviceId = identifier(candidate.deviceId, 160);
      const sessionToken = typeof candidate.sessionToken === 'string' ? candidate.sessionToken.trim() : '';
      const resultUploadToken = typeof candidate.resultUploadToken === 'string'
        ? candidate.resultUploadToken.trim()
        : '';
      const resultUploadExpiresAt = Number(candidate.resultUploadExpiresAt);
      const createdAt = Number(candidate.createdAt);
      const input = candidate.input && normalizedRecoveryInput(candidate.input);
      if (
        candidate.version !== 1
        || !deviceId
        || !sessionToken
        || !input
        || !Number.isSafeInteger(createdAt)
        || createdAt <= 0
        || now - createdAt > clubTabletRecoveryFinishDeliveryWindowMs
        || input.finishedAt < now - clubTabletRecoveryFinishDeliveryWindowMs
      ) return [];
      return [{
        version: 1 as const,
        id: recoveryOutboxId(deviceId, input.requestId),
        deviceId,
        sessionToken,
        resultUploadToken,
        resultUploadExpiresAt: Number.isSafeInteger(resultUploadExpiresAt) && resultUploadExpiresAt > 0
          ? resultUploadExpiresAt
          : 0,
        input,
        createdAt,
        attempts: Math.max(0, Math.floor(Number(candidate.attempts) || 0)),
      }];
    }).slice(-clubTabletRecoveryOutboxMaximum);
  } catch {
    return [] as ClubTabletRecoveryOutboxEntry[];
  }
}

function writeClubTabletRecoveryOutbox(entries: readonly ClubTabletRecoveryOutboxEntry[]) {
  if (typeof window === 'undefined') return;
  const serialized = JSON.stringify(entries.slice(-clubTabletRecoveryOutboxMaximum));
  try {
    window.localStorage.setItem(clubTabletRecoveryOutboxStorageKey, serialized);
    if (window.localStorage.getItem(clubTabletRecoveryOutboxStorageKey) !== serialized) {
      throw new Error('The tablet could not verify its recovery finish queue.');
    }
  } catch {
    throw new Error('The tablet could not retain this recovery finish for the selected athlete.');
  }
}

function queueClubTabletRecoveryEpisode(
  input: CreateClubTabletRecoveryEpisodeInput,
  credential: ClubTabletSessionCredential,
) {
  const normalized = normalizedRecoveryInput(input);
  if (!normalized || !credential.deviceId || !credential.sessionToken) {
    throw new Error('Recovery Alert needs a valid finished repetition.');
  }
  const entry: ClubTabletRecoveryOutboxEntry = {
    version: 1,
    id: recoveryOutboxId(credential.deviceId, normalized.requestId),
    deviceId: credential.deviceId,
    sessionToken: credential.sessionToken,
    resultUploadToken: credential.resultUploadToken ?? '',
    resultUploadExpiresAt: credential.resultUploadExpiresAt ?? 0,
    input: normalized,
    createdAt: Date.now(),
    attempts: 0,
  };
  const existing = readClubTabletRecoveryOutbox().filter((candidate) => candidate.id !== entry.id);
  writeClubTabletRecoveryOutbox([...existing, entry]);
  return entry;
}

function removeClubTabletRecoveryOutboxEntry(entryId: string) {
  writeClubTabletRecoveryOutbox(
    readClubTabletRecoveryOutbox().filter((candidate) => candidate.id !== entryId),
  );
}

function incrementClubTabletRecoveryOutboxAttempt(entryId: string) {
  writeClubTabletRecoveryOutbox(readClubTabletRecoveryOutbox().map((candidate) => (
    candidate.id === entryId
      ? { ...candidate, attempts: candidate.attempts + 1 }
      : candidate
  )));
}

function recoveryHeadersForCredential(credential: ClubTabletSessionCredential): Record<string, string> {
  const device = readStoredClubTabletDevice();
  const durableTokenValid = Boolean(
    credential.resultUploadToken
    && credential.resultUploadExpiresAt
    && credential.resultUploadExpiresAt > Date.now()
    && device
    && device.device.id === credential.deviceId
    && device.device.clubId === credential.session.clubId,
  );
  if (durableTokenValid && device) {
    return {
      Authorization: `Bearer ${device.deviceToken}`,
      [clubTabletSessionHeader]: credential.sessionToken,
      [clubTabletResultUploadHeader]: credential.resultUploadToken!,
    };
  }
  return credential.sessionToken ? { [clubTabletSessionHeader]: credential.sessionToken } : {};
}

function recoveryHeadersForOutboxEntry(entry: ClubTabletRecoveryOutboxEntry): Record<string, string> {
  const device = readStoredClubTabletDevice();
  const durableTokenValid = Boolean(
    entry.resultUploadToken
    && entry.resultUploadExpiresAt > Date.now()
    && device
    && device.device.id === entry.deviceId,
  );
  if (durableTokenValid && device) {
    return {
      Authorization: `Bearer ${device.deviceToken}`,
      [clubTabletSessionHeader]: entry.sessionToken,
      [clubTabletResultUploadHeader]: entry.resultUploadToken,
    };
  }
  return entry.sessionToken ? { [clubTabletSessionHeader]: entry.sessionToken } : {};
}

async function postClubTabletRecoveryEpisode(
  input: CreateClubTabletRecoveryEpisodeInput,
  headers: Record<string, string>,
  options: ClubTabletRecoverySubmitOptions = {},
): Promise<ClubTabletRecoveryResponse> {
  const response = await fetch('/api/club-tablet/recovery-alert/episodes', {
    method: 'POST',
    cache: 'no-store',
    credentials: 'omit',
    keepalive: options.keepalive === true,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({})) as {
    accountId?: unknown;
    replayed?: unknown;
    error?: unknown;
  };
  if (!response.ok) {
    throw new Error(recoveryError(payload, `Recovery Alert returned ${response.status}.`));
  }
  const accountId = normalizeRecoveryAccountId(payload.accountId);
  if (!accountId || typeof payload.replayed !== 'boolean') {
    throw new Error('Recovery Alert returned an invalid account binding.');
  }
  return { accountId, replayed: payload.replayed };
}

/**
 * A shared tablet can submit only a finished effort. Its bearer token chooses
 * the current athlete on the server; account/profile/rider identifiers are
 * deliberately absent from this wire format.
 */
export async function createClubTabletRecoveryEpisode(
  input: CreateClubTabletRecoveryEpisodeInput,
  credential: ClubTabletSessionCredential | string,
  options: ClubTabletRecoverySubmitOptions = {},
): Promise<ClubTabletRecoveryResponse> {
  const normalized = normalizedRecoveryInput(input);
  if (!normalized) throw new Error('Recovery Alert needs a valid finished repetition.');
  const headers = typeof credential === 'string'
    ? (credential ? { [clubTabletSessionHeader]: credential } : {})
    : recoveryHeadersForCredential(credential);
  if (Object.keys(headers).length === 0) {
    throw new Error('This Club Tablet athlete session has ended.');
  }
  return postClubTabletRecoveryEpisode(normalized, headers, options);
}

/**
 * Writes the opaque finish to local device storage before networking. The
 * result-upload credential scopes the entry to the athlete who finished, so
 * it can safely flush after this tablet has moved to the next athlete.
 */
export async function submitClubTabletRecoveryEpisode(
  input: CreateClubTabletRecoveryEpisodeInput,
  credential: ClubTabletSessionCredential,
  options: ClubTabletRecoverySubmitOptions = {},
): Promise<ClubTabletRecoveryResponse> {
  let entry: ClubTabletRecoveryOutboxEntry;
  try {
    entry = queueClubTabletRecoveryEpisode(input, credential);
  } catch {
    // Storage can be unavailable in a private/low-space web view. Preserve
    // the normal immediate delivery path rather than discarding the finish.
    return createClubTabletRecoveryEpisode(input, credential, options);
  }
  try {
    const result = await postClubTabletRecoveryEpisode(
      entry.input,
      recoveryHeadersForOutboxEntry(entry),
      options,
    );
    removeClubTabletRecoveryOutboxEntry(entry.id);
    return result;
  } catch (error) {
    try {
      incrementClubTabletRecoveryOutboxAttempt(entry.id);
    } catch {
      // The original promise still reports the network error; the next normal
      // session can recover any entry that did persist successfully.
    }
    throw error;
  }
}

/** Flushes retained finishes whenever this enrolled tablet becomes usable. */
export async function flushClubTabletRecoveryOutbox(
  options: ClubTabletRecoverySubmitOptions = {},
) {
  // `readClubTabletRecoveryOutbox` validates and filters corrupt/stale records
  // before they can be sent. Persist that cleaned view too: otherwise an
  // expired finish would remain on disk forever and be re-parsed on every
  // future athlete handoff, even though it can no longer produce a meaningful
  // recovery alert.
  const entries = readClubTabletRecoveryOutbox();
  try {
    writeClubTabletRecoveryOutbox(entries);
  } catch {
    // A storage-quota failure must not prevent a still-valid original athlete
    // finish from being delivered in this attempt.
  }
  const device = readStoredClubTabletDevice();
  if (!device) return 0;
  let sent = 0;
  for (const entry of entries) {
    if (entry.deviceId !== device.device.id) continue;
    if (entry.resultUploadExpiresAt > 0 && entry.resultUploadExpiresAt <= Date.now()) {
      removeClubTabletRecoveryOutboxEntry(entry.id);
      continue;
    }
    try {
      await postClubTabletRecoveryEpisode(entry.input, recoveryHeadersForOutboxEntry(entry), options);
      removeClubTabletRecoveryOutboxEntry(entry.id);
      sent += 1;
    } catch {
      try {
        incrementClubTabletRecoveryOutboxAttempt(entry.id);
      } catch {
        // Keep trying the next time the authorized tablet is opened.
      }
      break;
    }
  }
  return sent;
}

/** Select only the current shared-tablet athlete's completed repetitions. */
export function clubTabletRecoveryFinishSignals({
  credential,
  mode,
  raceCapture,
  raceRiders,
  getPulledResult,
}: ClubTabletRecoveryFinishContext): RecoveryFinishSignal[] {
  const activityType: RecoveryActivityType = mode === 'race' ? 'bmx-race' : mode;
  const raceSnapshot: RecoveryRaceSnapshot | null = activityType !== 'get-pulled' && raceCapture ? {
    activityType,
    sessionId: raceCapture.sessionId,
    startedAt: raceCapture.startedAt,
    source: raceCapture.source,
    players: raceCapture.players.map((player) => ({
      playerId: player.id,
      riderId: player.riderId,
    })),
    riders: raceRiders,
  } : null;
  const raceSignals = raceRecoveryFinishSignals(raceSnapshot);
  const pullSignal = activityType === 'get-pulled'
    ? getPulledRecoveryFinishSignal(getPulledResult)
    : null;
  const currentStudioRiderId = credential.session.studioRiderId;
  return [...raceSignals, ...(pullSignal ? [pullSignal] : [])]
    .filter((signal) => signal.athleteId === currentStudioRiderId);
}

/**
 * Retains every just-finished repetition before beginning network delivery.
 * The server stays idempotent, so this is safe alongside the normal mounted
 * coordinator and protects the last finish from an immediate athlete switch.
 */
export function flushClubTabletRecoveryFinishSignals(
  context: ClubTabletRecoveryFinishContext,
  options: ClubTabletRecoverySubmitOptions = {},
) {
  const signals = clubTabletRecoveryFinishSignals(context);
  return Promise.allSettled(signals.map((signal) => submitClubTabletRecoveryEpisode({
    requestId: signal.requestId,
    activityType: signal.activityType,
    sessionId: signal.sessionId,
    repetitionId: signal.repetitionId,
    finishedAt: signal.finishedAt,
    effortSummary: signal.effortSummary,
  }, context.credential, options)));
}
