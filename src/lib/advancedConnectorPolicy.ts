export function authenticatedRacerBikeAccess(
  authStatus: 'loading' | 'signed-out' | 'signed-in',
  serverMembershipTier: string | undefined,
) {
  return authStatus === 'signed-in' && serverMembershipTier === 'racer';
}

export function shouldStopAdvancedConnector(input: {
  authenticatedRacerAccess: boolean;
  clubMonitorOpen: boolean;
  sourceState: string;
}) {
  return (!input.authenticatedRacerAccess || input.clubMonitorOpen)
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
