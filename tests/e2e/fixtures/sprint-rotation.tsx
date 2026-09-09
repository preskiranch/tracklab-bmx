import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DragStripGameArenaLayer } from '../../../src/components/DragStripGameArenaLayer';
import '../../../src/styles.css';
import '../../../src/components/EarthTrackView.mobile.css';
import { canonicalPlayerAccent } from '../../../src/lib/playerPalette';
import type { PlayerSlot, RiderState } from '../../../src/types';
const players = ['Student One', 'Student Two', 'Student Three', 'Student Four'].map((name, i) => ({ id: i + 1, name, colorName: (['lime','blue','red','yellow'] as const)[i], accent: canonicalPlayerAccent((['lime','blue','red','yellow'] as const)[i]) })) as PlayerSlot[];
function Fixture() {
  const [distance, setDistance] = useState(3);
  useEffect(() => { const timer = setInterval(() => setDistance(d => d + .1), 100); return () => clearInterval(timer); }, []);
  const riders = players.map((p,i) => ({playerId: p.id, distance: distance + i, velocity: 4, rank: i+1, pedalPhase: distance, finishedAt: null})) as RiderState[];
  return <div className="race-fullscreen" style={{position:'fixed',inset:0}}><DragStripGameArenaLayer riders={riders} players={players} ghostRiders={[]} remoteRaceStates={[]} samplesByDevice={new Map()} raceState="racing" startGateActive={false} startGatePhase="idle" raceDistanceMeters={100} speedUnit="mph" distanceUnit="feet" showHud newPersonalRecordsByPlayer={{}} disqualifiedPlayerIds={[]}/></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
