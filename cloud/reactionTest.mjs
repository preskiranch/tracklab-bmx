const ratings = { red: 'excellent', 'yellow-1': 'great', 'yellow-2': 'okay', green: 'late' };

export function isReactionTestSession(session) {
  return Boolean(session?.details && Object.hasOwn(session.details, 'reactionTest'))
    || /^Reaction Test(?:\s|$|[·:])/iu.test(String(session?.title || ''))
    || /^reaction-test[:_-]/iu.test(String(session?.id || ''));
}

/** Basic client-result integrity checks; these are not proof of physical input. */
export function measuredReactionTestBestMs(result, { legacy = false } = {}) {
  if (!result || typeof result !== 'object' || Array.isArray(result)
    || result.valid !== true || result.falseStart !== false
    || !Object.hasOwn(ratings, result.stage) || ratings[result.stage] !== result.rating
    || result.late !== (result.stage === 'green')
    || typeof result.reactionTimeMs !== 'number' || !Number.isFinite(result.reactionTimeMs)
    || result.reactionTimeMs <= 0 || result.reactionTimeMs > 60_000) return null;
  if (!legacy && (
    typeof result.id !== 'string' || result.id.length === 0 || result.id.length > 160
    || typeof result.startedAt !== 'number' || !Number.isFinite(result.startedAt) || result.startedAt < 0
    || typeof result.recordedAt !== 'number' || !Number.isFinite(result.recordedAt)
    || Math.abs(result.recordedAt - result.startedAt - result.reactionTimeMs) > 0.01
    || typeof result.startedAtEpoch !== 'number' || !Number.isFinite(result.startedAtEpoch)
    || typeof result.recordedAtEpoch !== 'number' || !Number.isFinite(result.recordedAtEpoch)
    || result.startedAtEpoch <= 0 || result.recordedAtEpoch < result.startedAtEpoch
    || result.recordedAtEpoch > Date.now() + 60_000
    || typeof result.cadenceDelayMs !== 'number' || !Number.isFinite(result.cadenceDelayMs)
    || result.cadenceDelayMs < 100 || result.cadenceDelayMs > 2700
  )) return null;
  const rounded = Math.round(result.reactionTimeMs * 1000) / 1000;
  return rounded > 0 ? rounded : null;
}

export function reactionLeaderboardDisplayName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/gu, ' ');
  if (name.length < 2 || name.length > 32 || /[\p{Cc}\p{Cf}<>@]/u.test(name)) return null;
  return name;
}
