import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DragStripGameArenaLayer } from '../../../src/components/DragStripGameArenaLayer';
import '../../../src/styles.css';
import '../../../src/components/EarthTrackView.mobile.css';
import { canonicalPlayerAccent } from '../../../src/lib/playerPalette';
import type { PlayerSlot, RiderState, RaceState } from '../../../src/types';
const players = ['Student One', 'Student Two', 'Student Three', 'Student Four'].map((name, i) => ({ id: i + 1, deviceId: i + 1, name, colorName: (['lime','blue','red','yellow'] as const)[i], accent: canonicalPlayerAccent((['lime','blue','red','yellow'] as const)[i]) })) as PlayerSlot[];
function Fixture() {
  const [distance, setDistance] = useState(3);
  const [raceState,setRaceState] = useState<RaceState>(new URLSearchParams(location.search).has('ready') ? 'ready' : 'racing');
  const ready = raceState === 'ready';
  useEffect(() => {
    const control = (event: Event) => {const detail=(event as CustomEvent<{state:RaceState;distance:number}>).detail;setRaceState(detail.state);setDistance(detail.distance);};
    window.addEventListener('tracklab-test-race',control);
    return () => window.removeEventListener('tracklab-test-race',control);
  }, []);
  useEffect(() => { if (raceState !== 'racing') return; const timer = setInterval(() => setDistance(d => d + .1), 100); return () => clearInterval(timer); }, [raceState]);
  const riders = players.map((p,i) => ({playerId: p.id, distance: ready ? 0 : distance + i, velocity: ready ? 0 : 4, rank: i+1, pedalPhase: distance, finishedAt: raceState === 'finished' ? 1000+i : null})) as RiderState[];
  return <div data-test-race-state={raceState} className="race-fullscreen" style={{position:'fixed',inset:0}}><DragStripGameArenaLayer privateStadium={new URLSearchParams(location.search).has("stadium")} riders={riders} players={players} ghostRiders={[]} remoteRaceStates={[]} samplesByDevice={new Map(players.map(p => [p.id, {at:Date.now(),source:'demo' as const,deviceId:p.id,label:p.name,watts:250,cadence:90,speedKph:14.4,signal:100}]))} raceState={raceState} startGateActive={false} startGatePhase="idle" raceDistanceMeters={100} speedUnit="mph" distanceUnit="ft" showHud newPersonalRecordsByPlayer={{}} disqualifiedPlayerIds={[]}/></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
