import '../../../src/lib/roomVoiceLifecycle';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ClubStudentLobby } from '../../../src/components/ClubStudentLobby';
import { useRoomVoiceChat } from '../../../src/hooks/useRoomVoiceChat';
import type { MultiplayerRoom } from '../../../src/types';
const member = { id: 'student', name: 'Student One', roomRole: 'racer', bikeCount: 1 };
const baseRoom = { id: 'room-test', studentActivity: 'bmx-race', members: [member], readyMemberIds: [], flow: { phase: 'lobby' } } as unknown as MultiplayerRoom;
const signal = () => true;
const signals: [] = [];
function Harness() {
  const [entered, setEntered] = useState(false);
  const [room, setRoom] = useState<MultiplayerRoom | null>(null);
  const [cadence, setCadence] = useState(false);
  const voice = useRoomVoiceChat({ currentRoom: room, currentUserId: 'student', voiceSignals: signals, sendVoiceSignal: signal, cadenceActive: cadence });
  return <><ClubStudentLobby activity="bmx-race" entered={entered} connected room={room} riderId="student" setup={null} problem="Choose a course" status="" setupReady={false} clockOffsetMs={0}
    onEnter={() => setEntered(true)} onSolo={() => { voice.stop(); setEntered(false); setRoom(null); }} onJoin={() => setRoom(baseRoom)} onConfirm={() => {}} onReady={() => {}} onReset={() => {}} voice={voice}>
    <label>Course<select><option>A long named BMX race course for testing readable tablet controls</option></select></label>
  </ClubStudentLobby>
  <button onClick={() => setCadence(true)}>Test cadence</button>
  <button onClick={() => { window.dispatchEvent(new CustomEvent('tracklab-start-gate-tone', { detail: { kind: 'uci-green', atMonotonic: performance.now() } })); setCadence(false); }}>Test final tone</button>
  </>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
