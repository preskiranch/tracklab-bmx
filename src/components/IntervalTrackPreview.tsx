import './IntervalTrackPicker.css';
import { useEffect, useRef, useState } from 'react';
import { loadGoogleBaseMap } from '../lib/googleMaps';
import type { UserTrackMapping } from '../types';

export default function IntervalTrackPreview({ mapping }: { mapping: UserTrackMapping }) {
  const container = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('Loading satellite preview…');
  useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};
    setStatus('Loading satellite preview…');
    void loadGoogleBaseMap().then(google => {
      if (cancelled || !container.current) return;
      const map = new google.maps.Map(container.current, {
        center: mapping.centerline[0], zoom: 18, mapTypeId: 'satellite',
        disableDefaultUI: true, gestureHandling: 'none', keyboardShortcuts: false,
        tilt: 0, heading: 0, clickableIcons: false,
      });
      const line = new google.maps.Polyline({ map, path: mapping.centerline,
        strokeColor: '#75ed45', strokeWeight: 4, strokeOpacity: 1 });
      const bounds = new google.maps.LatLngBounds();
      mapping.centerline.forEach(point => bounds.extend(point));
      map.fitBounds(bounds, 28);
      const listener = map.addListener('tilesloaded', () => {
        if (!cancelled) setStatus('');
      });
      const timer = window.setTimeout(() => {
        if (!cancelled) setStatus(current => current ? 'Satellite unavailable · mapped course shown below' : '');
      }, 15000);
      const observer = new ResizeObserver(() => {
        google.maps.event?.trigger(map, 'resize');
        map.fitBounds(bounds, 28);
      });
      observer.observe(container.current);
      cleanup = () => { window.clearTimeout(timer); observer.disconnect(); listener.remove(); line.setMap(null); };
    }).catch(() => { if (!cancelled) setStatus('Satellite unavailable · mapped course shown below'); });
    return () => { cancelled = true; cleanup(); };
  }, [mapping]);
  const points = mapping.centerline;
  const minLat = Math.min(...points.map(p => p.lat));
  const maxLat = Math.max(...points.map(p => p.lat));
  const minLng = Math.min(...points.map(p => p.lng));
  const cos = Math.cos(minLat * Math.PI / 180);
  const width = (Math.max(...points.map(p => p.lng)) - minLng) * cos;
  const scale = 280 / Math.max(width, maxLat - minLat, 0.000001);
  const path = points.map(p => `${10 + (p.lng - minLng) * cos * scale},${10 + (maxLat - p.lat) * scale}`).join(' ');
  return <figure className="interval-track-preview" aria-label={`Track preview: ${mapping.trackName}`}>
    <figcaption><strong>{mapping.trackName}</strong><span>Mapped course · {Math.round(mapping.lengthMeters)} m</span></figcaption>
    <div className="interval-track-preview-map" style={status.startsWith('Satellite unavailable') ? { display: 'none' } : undefined} ref={container}/>
    {status && <div role="status">{status}</div>}
    {status.startsWith('Satellite unavailable') && <svg viewBox={`0 0 ${Math.max(40, width * scale + 20)} ${Math.max(40, (maxLat - minLat) * scale + 20)}`} role="img" aria-label="Saved course outline">
      <polyline points={path} fill="none" stroke="currentColor" strokeWidth="3"/>
    </svg>}
  </figure>;
}
