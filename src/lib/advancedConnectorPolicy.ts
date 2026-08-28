export function authenticatedRacerBikeAccess(
  authStatus: 'loading' | 'signed-out' | 'signed-in',
  serverMembershipTier: string | undefined,
) {
  return authStatus === 'signed-in' && serverMembershipTier === 'racer';
}

export function authenticatedRacerBikeSeatLimit(
  authStatus: 'loading' | 'signed-out' | 'signed-in',
  serverMembershipTier: string | undefined,
  serverBikeSeats: number | undefined,
  maximum = 4,
) {
  if (!authenticatedRacerBikeAccess(authStatus, serverMembershipTier)) return 0;
  const seats = Number.isFinite(Number(serverBikeSeats)) ? Math.round(Number(serverBikeSeats)) : 1;
  return Math.max(1, Math.min(Math.max(1, Math.round(maximum)), seats));
}

export function shouldStopAdvancedConnector(input: {
  authStatus: 'loading' | 'signed-out' | 'signed-in';
  authenticatedRacerAccess: boolean;
  clubMonitorOpen: boolean;
  sourceState: string;
}) {
  return input.authStatus !== 'loading'
    && (!input.authenticatedRacerAccess || input.clubMonitorOpen)
    && input.sourceState !== 'idle'
    && input.sourceState !== 'stopping';
}

export function shouldAutoStartAdvancedConnector(input: {
  bikeConnectionSource: 'bluetooth' | 'advanced' | 'demo';
  bridgeConnection: string;
  bridgeSourceState: string;
  clubMonitorOpen: boolean;
  demoMode: boolean;
  membershipTier: string;
}) {
  return !input.clubMonitorOpen
    && !input.demoMode
    && input.bikeConnectionSource === 'advanced'
    && input.membershipTier === 'racer'
    && input.bridgeConnection === 'open'
    && input.bridgeSourceState === 'idle';
}
