import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { MultiplayerRoom, MultiplayerRaceSetup } from '../types';
import './ClubStudentLobby.css';

type Props = {
  activity: 'bmx-race' | 'straight-sprint'; entered: boolean; connected: boolean;
  room: MultiplayerRoom | null; riderId: string | null; setup: MultiplayerRaceSetup | null;
  problem: string; status: string; setupReady: boolean; clockOffsetMs: number;
  onEnter: () => void; onSolo: () => void; onJoin: () => unknown;
  onConfirm: (setup: MultiplayerRaceSetup) => unknown; onReady: () => void; onReset: () => unknown;
  voice: { gatePaused: boolean; enabled: boolean; muted: boolean; supported: boolean; requesting: boolean; status: string; remoteCount: number; start: () => unknown; stop: () => void; toggleMuted: () => void };
  children: ReactNode;
};
export function ClubStudentLobby(p: Props) {
  const requested = useRef(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!p.entered || !p.connected) { requested.current = false; return; }
    if (!p.room && !requested.current) { requested.current = true; p.onJoin(); }
  }, [p.entered, p.connected, p.room, p.onJoin]);
  useEffect(() => {
    if (!p.room?.flow.raceStartAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [p.room?.flow.raceStartAt]);
  const title = p.activity === 'bmx-race' ? 'Race Intervals' : 'Straight Sprint';
  const locked = Boolean(p.room?.setup);
  const racing = p.room?.flow.phase === 'race';
  const seconds = Math.max(0, Math.ceil(((p.room?.flow.raceStartAt ?? 0) - now - p.clockOffsetMs) / 1000));
  const ready = p.room?.readyMemberIds?.includes(p.riderId ?? '');
  return <section className="club-student-lobby" aria-label="Private club race">
    <h2>{title} · Your club</h2>
    <p>Choose solo training or race with up to three other students. Your Wattbike stays connected to this tablet.</p>
    <div className="club-student-actions">
      <button type="button" aria-pressed={!p.entered} onClick={p.onSolo}>Race solo</button>
      <button type="button" aria-pressed={p.entered} onClick={p.onEnter} disabled={p.entered}>Join club {title} room</button>
    </div>
    {p.entered && <>
      {!p.room ? <><p role="status">{p.status || (p.connected ? 'Joining your club room…' : 'Connecting to your club…')}</p>
        <button type="button" disabled={!p.connected} onClick={() => p.onJoin()}>Retry joining</button></> : <>
        <div className="club-student-voice" aria-label="Club room microphone">
          <strong>Talk to your club room</strong>
          {!p.voice.enabled ? <button type="button" disabled={!p.voice.supported || p.voice.requesting} onClick={() => p.voice.start()}>{p.voice.requesting ? 'Opening microphone…' : 'Enable microphone'}</button> : <>
            <button type="button" aria-pressed={p.voice.muted} onClick={p.voice.toggleMuted}>{p.voice.muted ? 'Unmute microphone' : 'Mute microphone'}</button>
            <button type="button" onClick={p.voice.stop}>Leave voice chat</button>
          </>}
          <p role="status">{p.voice.gatePaused ? 'Room audio paused for the start cadence. Resumes after the final tone.' : p.voice.muted ? 'Microphone muted · you can still hear the room.' : p.voice.status} {p.voice.enabled ? `${p.voice.remoteCount} students connected to audio.` : ''}</p>
          <small>Allow microphone access when asked. Live room audio is not recorded. Chat pauses during the cadence and resumes after the final gate tone. Headphones help prevent echo.</small>
        </div>
        <p>{p.room.members.length} of 4 students joined. {locked ? 'Course and settings agreed.' : 'Everyone chooses the same course and settings, then confirms their choice.'}</p>
        <ul>{p.room.members.map(member => {
          const choice = p.room?.studentChoices?.[member.id]?.configuration;
          return <li key={member.id}><strong>{member.name}</strong><span>{member.ready ? 'Ready' : choice
            ? `${choice.name}${choice.routeVariantId ? ` · ${choice.routeVariantId}` : ''}${choice.distanceFeet ? ` · ${choice.distanceFeet} ft · Air ${choice.airSetting}` : ''}` : 'Choosing course/settings'}</span></li>;
        })}</ul>
        {!locked && <fieldset disabled={racing}><legend>Your course and settings</legend>{p.children}
          {p.problem && <p role="status">{p.problem}</p>}
          <button type="button" disabled={!p.setup || Boolean(p.problem) || !p.connected} onClick={() => p.setup && p.onConfirm(p.setup)}>Confirm my choice</button>
        </fieldset>}
        {locked && !racing && p.room.flow.phase !== 'round-complete' && <button type="button" disabled={!p.connected || !p.setupReady || ready} onClick={p.onReady}>{ready ? 'Ready · waiting for students' : p.setupReady ? 'Ready to race' : 'Loading agreed course…'}</button>}
        {!racing && locked && <button type="button" onClick={() => p.onReset()}>{p.room.flow.phase === 'round-complete' ? 'Choose next race' : 'Change course/settings'}</button>}
        {racing && seconds > 0 && <p className="club-student-countdown" role="timer">Starting together in {seconds}</p>}
        <p role="status">{p.status}</p>
        <small>At least two students must join. When everyone is Ready, a 10-second countdown begins. This room is private to your club.</small>
      </>}
    </>}
  </section>;
}
