import type { ClubTabletSessionCredential } from './clubTabletStorage';

/**
 * A shared tablet must retain its athlete credential until every durable
 * workout artifact has finished saving. Clearing the credential sooner also
 * clears that athlete's private outbox and can misattribute or lose results.
 */
export async function releaseClubTabletAthleteAfterSaves(
  saves: readonly PromiseLike<unknown>[],
  release: () => Promise<void> | void,
) {
  await Promise.all(saves);
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
