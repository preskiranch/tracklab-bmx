import type { ClubTabletSessionCredential } from './clubTabletStorage';

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
