import { useEffect, useRef, useState } from 'react';
import type { ArenaRider } from './DragStripGameArenaLayer';
import type { DistanceUnit, RaceState, SpeedUnit } from '../types';
import { formatDistanceMeters, formatSpeedFromKph } from '../units';
import './PrivateSprintStadium.css';

type Props = {
  riders: ArenaRider[];
  raceDistanceMeters: number;
  raceState: RaceState;
  startGatePhase: string;
  speedUnit: SpeedUnit;
  distanceUnit: DistanceUnit;
};

import { stadiumProgress } from '../lib/privateStadiumMath';
export { stadiumProgress } from '../lib/privateStadiumMath';

export function PrivateSprintStadium(props: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef(props);
  live.current = props;
  const inspector = useRef<(value: boolean) => void>(() => {});
  const [inspecting, setInspecting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (props.raceState === 'racing') { inspector.current(false); setInspecting(false); }
  }, [props.raceState]);
  useEffect(() => {
    const surface = canvas.current;
    if (!surface) return;
    let disposed = false, contextLost = false, frame = 0, previous = 0;
    let scene: Awaited<ReturnType<typeof import('../lib/privateStadiumScene')['createPrivateStadiumScene']>> | undefined;
    const lost = (event: Event) => { event.preventDefault(); contextLost = true; setError('3D graphics paused. Exit the race view and reopen the stadium to reload.'); cancelAnimationFrame(frame); };
    surface.addEventListener('webglcontextlost', lost);
    import('../lib/privateStadiumScene').then(module => module.createPrivateStadiumScene(surface)).then(created => {
      if (disposed || contextLost) { created.dispose(); return; }
      scene = created; inspector.current = created.setInspection; setLoading(false);
      const draw = (now: number) => {
        if (disposed) return;
        frame = requestAnimationFrame(draw);
        if (document.hidden) { previous = now; return; }
        const active = live.current.raceState === 'racing' || ['staging','cadence'].includes(live.current.startGatePhase);
        if (now - previous < (active ? 32 : 200)) return;
        const dt = Math.min(.1, (now - previous) / 1000); previous = now;
        scene?.update(live.current, dt);
      };
      frame = requestAnimationFrame(draw);
    }).catch(() => { if (!disposed) { setLoading(false); setError('The 3D stadium could not load. Return to the original arena and try again.'); } });
    return () => { disposed = true; cancelAnimationFrame(frame); surface.removeEventListener('webglcontextlost', lost); scene?.dispose(); };
  }, []);
  return <section className="private-sprint-stadium" aria-label="Private Sprint Stadium" data-camera="fixed">
    <div className="private-sprint-surface"><canvas ref={canvas} aria-label="Four-lane sprint stadium with fixed start and finish" />
      {(loading || error) && <div className="private-stadium-status" role="status">{error || 'Loading 3D stadium…'}</div>}
    </div>
    <footer className="private-sprint-scoreboard" aria-label="Stadium rider results">
      <header><span>SPRINT STADIUM · PRIVATE TEST</span>{props.raceState !== 'racing' && <button type="button" disabled={loading || !!error} onClick={() => { inspector.current(!inspecting); setInspecting(!inspecting); }}>{inspecting ? 'Course view' : 'Inspect rider'}</button>}<span>{formatDistanceMeters(props.raceDistanceMeters,props.distanceUnit)}</span></header>
      <div className="private-sprint-cards">{props.riders.filter(r=>!r.ghost).slice(0,4).map(rider=><article key={rider.id} style={{borderTopColor:rider.accent}}>
        <strong>{rider.name}</strong><span>P{rider.playerId} · {rider.disqualified?'DQ':rider.finishedAt!=null?`Place ${rider.rank}`:props.raceState==='racing'?`${Math.round(stadiumProgress(rider.distanceMeters,props.raceDistanceMeters)*100)}%`:'Ready'}</span>
        <b style={{color:rider.accent}}>{formatSpeedFromKph(rider.speedKph??0,props.speedUnit)} <small>{props.speedUnit.toUpperCase()}</small></b>
      </article>)}</div>
    </footer>
  </section>;
}
