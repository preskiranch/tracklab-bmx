import { useEffect, useRef, useState } from 'react';
import { Satellite } from 'lucide-react';
import {
  hasGoogleMapsApiKey,
  loadGoogleBaseMap,
  type GoogleMap,
  type GoogleMapsRuntime,
  type GoogleMarker,
} from '../lib/googleMaps';
import {
  publicTrackExplorerMarkerTitle,
  publicTrackExplorerPoint,
} from '../lib/publicTrackExplorer';
import type { TrackLocatorRecord } from '../types';

type PublicTrackMapProps = {
  track: TrackLocatorRecord;
};

function locatorBounds(center: { lat: number; lng: number }) {
  const offset = 0.0014;
  return [
    { lat: center.lat - offset, lng: center.lng - offset },
    { lat: center.lat + offset, lng: center.lng + offset },
  ];
}

function selectedMarkerIcon(google: GoogleMapsRuntime) {
  return {
    fillColor: '#65d636',
    fillOpacity: 1,
    path: google.maps.SymbolPath.CIRCLE,
    scale: 9,
    strokeColor: '#0b1117',
    strokeOpacity: 1,
    strokeWeight: 3,
  };
}

function focusTrack(
  map: GoogleMap,
  google: GoogleMapsRuntime,
  marker: GoogleMarker,
  track: TrackLocatorRecord,
) {
  const center = publicTrackExplorerPoint(track);
  if (!center) return false;
  marker.setMap(map);
  marker.setPosition(center);
  marker.setIcon(selectedMarkerIcon(google));
  marker.setTitle?.(publicTrackExplorerMarkerTitle(track));
  const bounds = new google.maps.LatLngBounds();
  locatorBounds(center).forEach((point) => bounds.extend(point));
  map.fitBounds(bounds, 42);
  map.setHeading(0);
  map.setTilt(0);
  return true;
}

export function PublicTrackMap({ track }: PublicTrackMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GoogleMap | null>(null);
  const googleRef = useRef<GoogleMapsRuntime | null>(null);
  const markerRef = useRef<GoogleMarker | null>(null);
  const selectedTrackRef = useRef(track);
  const [mapVersion, setMapVersion] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    hasGoogleMapsApiKey() || (typeof window !== 'undefined' && Boolean(window.google?.maps?.Map)) ? 'loading' : 'error',
  );
  selectedTrackRef.current = track;

  useEffect(() => {
    if (!hasGoogleMapsApiKey() && !window.google?.maps?.Map) {
      setStatus('error');
      return undefined;
    }

    let cancelled = false;
    let tileTimeout: number | undefined;
    let tilesLoadedListener: { remove: () => void } | undefined;
    setStatus('loading');

    loadGoogleBaseMap()
      .then((google) => {
        if (cancelled || !containerRef.current) return;
        const center = publicTrackExplorerPoint(selectedTrackRef.current);
        if (!center) {
          setStatus('error');
          return;
        }
        const map = new google.maps.Map(containerRef.current, {
          cameraControl: true,
          center,
          clickableIcons: false,
          controlSize: 30,
          disableDefaultUI: false,
          fullscreenControl: false,
          gestureHandling: 'greedy',
          heading: 0,
          headingInteractionEnabled: false,
          isFractionalZoomEnabled: true,
          keyboardShortcuts: true,
          mapTypeControl: false,
          mapTypeId: 'satellite',
          rotateControl: false,
          scaleControl: true,
          streetViewControl: false,
          tilt: 0,
          tiltInteractionEnabled: false,
          zoom: 18,
          zoomControl: true,
        });
        const marker = new google.maps.Marker({ map, position: center });
        mapRef.current = map;
        googleRef.current = google;
        markerRef.current = marker;

        tilesLoadedListener = map.addListener('tilesloaded', () => {
          if (cancelled) return;
          if (tileTimeout !== undefined) window.clearTimeout(tileTimeout);
          tilesLoadedListener?.remove();
          tilesLoadedListener = undefined;
          setStatus('ready');
        });
        tileTimeout = window.setTimeout(() => {
          if (cancelled) return;
          tilesLoadedListener?.remove();
          tilesLoadedListener = undefined;
          setStatus('error');
        }, 15_000);
        google.maps.event?.trigger(map, 'resize');
        setMapVersion((current) => current + 1);
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });

    return () => {
      cancelled = true;
      tilesLoadedListener?.remove();
      if (tileTimeout !== undefined) window.clearTimeout(tileTimeout);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const google = googleRef.current;
    const marker = markerRef.current;
    if (!map || !google || !marker || mapVersion === 0) return;
    if (!focusTrack(map, google, marker, track)) setStatus('error');
  }, [mapVersion, track]);

  useEffect(() => () => {
    markerRef.current?.setMap(null);
    markerRef.current = null;
    googleRef.current = null;
    mapRef.current = null;
  }, []);

  return (
    <div className="public-track-map" aria-label={`Satellite view of ${track.name}`}>
      <div className="public-track-map-canvas" ref={containerRef} />
      {status !== 'ready' && (
        <div className={`public-track-map-status ${status}`}>
          <Satellite size={22} />
          <strong>{status === 'loading' ? 'Loading satellite view' : 'Satellite view unavailable'}</strong>
          <span>{status === 'loading'
            ? `Centering on ${track.name}`
            : 'Use one of the map links below to view this track.'}</span>
        </div>
      )}
    </div>
  );
}
