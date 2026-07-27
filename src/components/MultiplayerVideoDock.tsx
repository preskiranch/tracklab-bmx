import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  Video,
  VideoOff,
  X,
} from 'lucide-react';
import type {
  DailyRoomVideoController,
  TrackLabVideoParticipant,
} from '../hooks/useDailyRoomVideo';

type MultiplayerVideoDockProps = {
  controller: DailyRoomVideoController;
  raceActive: boolean;
};

function WorkoutVideoTile({
  bindVideoTile,
  participant,
}: {
  bindVideoTile: DailyRoomVideoController['bindVideoTile'];
  participant: TrackLabVideoParticipant;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bindVideoTile(participant.id, hostRef.current);
    return () => bindVideoTile(participant.id, null);
  }, [bindVideoTile, participant.id]);

  return (
    <article className={`workout-video-tile${participant.cameraOn ? ' camera-on' : ' camera-off'}`}>
      <div className="workout-video-render" ref={hostRef} aria-hidden={!participant.cameraOn} />
      {!participant.cameraOn && (
        <div className="workout-video-placeholder">
          <VideoOff size={22} />
          <span>Camera off</span>
        </div>
      )}
      <footer>
        <strong>{participant.name}</strong>
        {participant.local && <span>You</span>}
        <ShieldCheck size={13} aria-label="Private camera-only video" />
      </footer>
    </article>
  );
}

export function MultiplayerVideoDock({
  controller,
  raceActive,
}: MultiplayerVideoDockProps) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!controller.joined) {
      setCollapsed(false);
    }
  }, [controller.joined]);

  if (!controller.joined) {
    return null;
  }

  return (
    <section
      className={`workout-video-dock${collapsed ? ' collapsed' : ''}${raceActive ? ' race-active' : ''}`}
      aria-label="Live multiplayer workout cameras"
    >
      <header>
        <div>
          <span className="workout-video-live-dot" />
          <Video size={17} />
          <strong>Workout cameras</strong>
          <small>{controller.participants.length}/{controller.maxParticipants}</small>
        </div>
        <div>
          <button
            type="button"
            onClick={() => setCollapsed((current) => !current)}
            aria-label={collapsed ? 'Expand workout cameras' : 'Collapse workout cameras'}
          >
            {collapsed ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
          </button>
          <button type="button" onClick={() => void controller.leave()} aria-label="Leave workout video">
            <X size={17} />
          </button>
        </div>
      </header>

      {!collapsed && (
        <>
          <div className="workout-video-grid">
            {controller.participants.map((participant) => (
              <WorkoutVideoTile
                bindVideoTile={controller.bindVideoTile}
                participant={participant}
                key={participant.id}
              />
            ))}
          </div>
          <div className="workout-video-dock-controls">
            <button type="button" onClick={() => void controller.toggleCamera()}>
              {controller.cameraOn ? <VideoOff size={15} /> : <Video size={15} />}
              {controller.cameraOn ? 'Camera off' : 'Camera on'}
            </button>
            <span>Camera only · private · not recorded</span>
          </div>
          <p role="status">{controller.status}</p>
        </>
      )}
    </section>
  );
}
