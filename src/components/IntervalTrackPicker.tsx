import { useEffect, useMemo, useState } from 'react';
import type { TrackRecord, UserTrackMapping } from '../types';
import './IntervalTrackPicker.css';
import IntervalTrackPreview from './IntervalTrackPreview';
export function playableIntervalTracks(tracks: TrackRecord[], mappings: Record<string, UserTrackMapping>) {
  return tracks.filter(track => {
    const m=mappings[track.id];
    return m?.routeStatus === 'user-mapped' && m.centerline?.length >= 2
      && m.zones?.some(zone => zone.type === 'pedal' && zone.endMeter > zone.startMeter);
  });
}
export default function IntervalTrackPicker({tracks,mappings,selectedId,onSelect,locked,userId}: {
  tracks: TrackRecord[]; mappings: Record<string,UserTrackMapping>; selectedId: string;
  onSelect:(id:string)=>void; locked:boolean; userId?:string;
}) {
  const [all,setAll]=useState(false);
  const [search,setSearch]=useState('');
  const [requested,setRequested]=useState<Record<string,boolean>>({});
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');
  const playable=useMemo(()=>playableIntervalTracks(tracks,mappings),[tracks,mappings]);
  const playableIds=useMemo(()=>new Set(playable.map(t=>t.id)),[playable]);
  const matches=useMemo(()=>tracks.filter(t=>`${t.name} ${t.state} ${t.country}`.toLowerCase().includes(search.trim().toLowerCase())),[tracks,search]);
  useEffect(()=>{
    if (!locked && playable.length && !playableIds.has(selectedId)) onSelect(playable[0].id);
  },[locked,onSelect,playable,playableIds,selectedId]);
  useEffect(()=>{
    let active=true;setRequested({});setMessage('');
    if(userId)void fetch('/api/track-mapping-requests').then(async r=>{
      if(!r.ok)throw new Error('Could not load your mapping requests.');
      const data=await r.json();if(active)setRequested(Object.fromEntries((data.requests??[]).map((r:{trackId:string;notified:boolean})=>[r.trackId,r.notified])));
    }).catch(()=>{if(active)setMessage('Could not load previous requests. You can still retry a request.');});
    return()=>{active=false;};
  },[userId]);
  async function requestTrack(trackId:string) {
    setBusy(trackId);setMessage('');
    try {
      const response=await fetch('/api/track-mapping-requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({trackId})});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Could not send request. Please retry.');
      setRequested(current=>({...current,[trackId]:true}));setMessage('Requested — the TrackLab team has been notified.');
    } catch(error) {setRequested(current=>({...current,[trackId]:false}));setMessage(error instanceof Error?error.message:'Could not send request.');}
    finally {setBusy('');}
  }
  return <section className="interval-picker" aria-label="BMX interval tracks">
    <div className="interval-picker-tabs" role="group" aria-label="Track list">
      <button type="button" aria-pressed={!all} onClick={()=>setAll(false)}>Ready to race ({playable.length})</button>
      <button type="button" aria-pressed={all} onClick={()=>setAll(true)}>All tracks · Request mapping</button>
    </div>
    {!all ? <label>Playable track
      <select aria-label="Playable interval track" disabled={locked||!playable.length} value={playableIds.has(selectedId)?selectedId:''} onChange={e=>onSelect(e.target.value)}>
        {!playableIds.has(selectedId)&&<option value="">Choose a mapped track</option>}
        {playable.map(t=><option key={t.id} value={t.id}>{t.name} — {t.state}, {t.country}</option>)}
      </select>
      {!playable.length&&<span>No playable mappings loaded yet. Browse all tracks to request one.</span>}
    </label> : <>
      <p>Missing your track? Request it for a future update. Availability is not guaranteed.</p>
      <input type="search" aria-label="Search all tracks" placeholder="Search track, state or country" value={search} onChange={e=>setSearch(e.target.value)}/>
      <div className="interval-track-results" role="list" aria-label="All BMX tracks">
        {matches.map(t=><div role="listitem" key={t.id}>
          <span><strong>{t.name}</strong><small>{t.state}, {t.country}</small></span>
          {playableIds.has(t.id)?<button disabled={locked} onClick={()=>{onSelect(t.id);setAll(false);}}>Race</button>
            :<button disabled={!userId||Boolean(busy)||requested[t.id]===true} onClick={()=>void requestTrack(t.id)} aria-label={`${requested[t.id]?'Requested': 'Request mapping for'} ${t.name}`}>
              {busy===t.id?'Sending…':requested[t.id]===true?'✓ Requested':requested[t.id]===false?'Retry notification':'Request mapping'}
            </button>}
        </div>)}
        {!matches.length&&<p>No tracks match your search.</p>}
      </div>
      {!userId&&<p>Sign in to request a track.</p>}
    </>}
    {!all && playableIds.has(selectedId) && <IntervalTrackPreview key={selectedId} mapping={mappings[selectedId]}/> }
    <div role="status">{message}</div>
  </section>;
}
