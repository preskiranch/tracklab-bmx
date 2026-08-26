import type { ClubTabletSessionCredential } from './clubTabletStorage';

export const clubTabletResultReviewHoldMs = 15_000;

export type ClubTabletResultReviewHold = (delayMs: number) => PromiseLike<unknown>;

export function waitForClubTabletResultReview(delayMs = clubTabletResultReviewHoldMs) {
  return new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, Math.max(0, delayMs));
  });
}

type ClubTabletExerciseReleaseOptions = Readonly<{
  reviewHoldMs?: number;
  waitForReview?: ClubTabletResultReviewHold;
}>;

/**
 * A shared tablet must retain its athlete credential until every durable
 * workout artifact has finished saving. Clearing the credential sooner also
 * clears that athlete's private outbox and can misattribute or lose results.
 */
export async function releaseClubTabletAthleteAfterSaves(
  saves: readonly PromiseLike<unknown>[],
  release: () => Promise<void> | void,
  options: ClubTabletExerciseReleaseOptions = {},
) {
  // Start the review clock at the same moment as the durable-save wait. Fast
  // saves therefore leave the result visible for the full review window, while
  // a slow save can safely extend that window without ever releasing early.
  const reviewHold = (options.waitForReview ?? waitForClubTabletResultReview)(
    options.reviewHoldMs ?? clubTabletResultReviewHoldMs,
  );
  await Promise.all([...saves, reviewHold]);
  await release();
}

export function clubTabletSessionsMatch(
  left: ClubTabletSessionCredential | null | undefined,
  right: ClubTabletSessionCredential | null | undefined,
) {
  return Boolean(
    left
    && right
    && left.deviceId === right.deviceId
    && left.sessionToken === right.sessionToken
    && left.session.clubId === right.session.clubId
    && left.session.studioRiderId === right.session.studioRiderId,
  );
}

export async function safelyReleaseCompletedClubTabletSession(options: Readonly<{
  completedSession: ClubTabletSessionCredential;
  currentSession: () => ClubTabletSessionCredential | null;
  clearCurrentSession: () => Promise<void> | void;
  endCompletedSession: (session: ClubTabletSessionCredential) => Promise<void> | void;
}>) {
  if (clubTabletSessionsMatch(options.currentSession(), options.completedSession)) {
    await options.clearCurrentSession();
  }
  await options.endCompletedSession(options.completedSession);
}
