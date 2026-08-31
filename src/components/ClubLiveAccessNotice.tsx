type ClubLiveAccessNoticeProps = {
  accessActive: boolean;
  accessStatus: 'idle' | 'checking' | 'active' | 'inactive' | 'error';
  authenticatedRacerAccess: boolean;
  selected: boolean;
};

export default function ClubLiveAccessNotice({
  accessActive,
  accessStatus,
  authenticatedRacerAccess,
  selected,
}: ClubLiveAccessNoticeProps) {
  return (
    <>
      <p>
        {selected && !authenticatedRacerAccess
          ? accessActive
            ? 'Club bike access active — one Bluetooth bike and one multiplayer racer seat enabled from the club membership.'
            : accessStatus === 'checking'
              ? 'Checking the club membership and available bike seats…'
              : 'Club bike access is unavailable. The club may be using all purchased seats or its membership may need attention.'
          : selected
            ? 'Club training selected. Results save to your calendar and club dashboard.'
            : 'Personal training stays private.'}
      </p>
      {selected && (
        <p>
          The club owner can optionally open Club Live Monitor to view your program, status, progress, track or
          destination, cadence, speed, and current live watts. While you are actively sharing a Club Live session,
          the owner can also view a temporary, read-only image of the visible TrackLab activity screen. Screen sharing
          does not capture your device camera, microphone, taps, notifications, other apps, or content outside
          TrackLab. Frames expire and are deleted when Club Live sharing ends. Watts remain excluded from public
          leaderboards, shared ghosts, multiplayer participants, and shared exports; your saved power history remains
          in your own training record. Your temporary Club Athlete bike and racer-seat access is based on the club
          membership and stops when you leave club training.
        </p>
      )}
    </>
  );
}
