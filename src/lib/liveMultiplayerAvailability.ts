// Public live rooms are paused during the beta. Cloud results, ghosts, and
// the authenticated Wattbike capacity connection remain available.
export const publicLiveMultiplayerAvailable = false;

export function multiplayerMessageAllowed(type: unknown, liveRacingAvailable: boolean) {
  return liveRacingAvailable || type === 'presence' || type === 'ping' || type === 'leave-room';
}
