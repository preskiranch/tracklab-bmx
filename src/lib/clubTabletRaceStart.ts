export type RaceStartSource = 'manual' | 'club-tablet-control' | 'room-clock';

type ClubTabletRaceStartPolicy = Readonly<{
  clubTabletKioskMode: boolean;
  roomClockAuthorized: boolean;
  source: RaceStartSource;
}>;

/**
 * A shared Club Tablet must never enter the gate cadence just because an
 * activity was opened. Independent sessions require the rider's explicit
 * start control; coach-led events may only follow their synchronized clock.
 */
export function clubTabletRaceStartAllowed({
  clubTabletKioskMode,
  roomClockAuthorized,
  source,
}: ClubTabletRaceStartPolicy) {
  if (!clubTabletKioskMode) return true;
  if (source === 'club-tablet-control') return true;
  return source === 'room-clock' && roomClockAuthorized;
}
