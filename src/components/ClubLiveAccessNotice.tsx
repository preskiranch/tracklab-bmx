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
            ? 'Club monitor open — one Bluetooth bike and one multiplayer racer seat enabled.'
            : accessStatus === 'checking'
              ? 'Checking whether the club owner has Club Live Monitor open…'
              : 'Ask the club owner to open Club Live Monitor. The studio bike and racer seat stay locked until then.'
          : selected
            ? 'Club training selected. Results save to your calendar and club dashboard.'
            : 'Personal training stays private.'}
      </p>
      {selected && (
        <p>
          Club Live Monitor shares your program, status, progress, track or destination, power, cadence, and speed
          with the club owner. Sharing—and temporary Club Athlete bike and racer-seat access—stops when the monitor
          closes or you leave club training.
        </p>
      )}
    </>
  );
}
