import { useEffect, useRef, useState } from 'react';
import { Satellite } from 'lucide-react';
import {
  hasGoogleMapsApiKey,
  loadGoogleMaps,
  type GoogleMap,
  type GoogleMarker,
  type LatLngLiteral,
} from '../lib/googleMaps';
import type { TrackLocatorRecord } from '../types';

type PublicTrackMapProps = {
  track: TrackLocatorRecord;
};

function locatorCenter(track: TrackLocatorRecord): LatLngLiteral {
  const lat = Number(track.latitude);
  const lng = Number(track.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : { lat: 0, lng: 0 };
}

function locatorBounds(center: LatLngLiteral) {
  const offset = 0.0014;
  return [
    { lat: center.lat - offset, lng: center.lng - offset },
    { lat: center.lat + offset, lng: center.lng + offset },
  ];
}

export function PublicTrackMap({ track }: PublicTrackMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GoogleMap | null>(null);
  const markerRef = useRef<GoogleMarker | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    hasGoogleMapsApiKey() ? 'loading' : 'error',
  );

  useEffect(() => {
    if (!hasGoogleMapsApiKey()) {
      setStatus('error');
      return undefined;
    }

    let cancelled = false;
    setStatus('loading');

    loadGoogleMaps()
      .then((google) => {
        if (cancelled || !containerRef.current) {
          return;
        }

        const center = locatorCenter(track);
        const map = new google.maps.Map(containerRef.current, {
          cameraControl: true,
          center,
          clickableIcons: false,
          controlSize: 30,
          disableDefaultUI: false,
          fullscreenControl: false,
          gestureHandling: 'greedy',
          heading: 0,
          headingInteractionEnabled: true,
          isFractionalZoomEnabled: true,
          keyboardShortcuts: true,
          mapTypeControl: false,
          mapTypeId: 'satellite',
          renderingType: google.maps.RenderingType?.VECTOR,
          rotateControl: true,
          scaleControl: true,
          streetViewControl: false,
          tilt: 45,
          tiltInteractionEnabled: true,
          zoom: 18,
          zoomControl: true,
        });
        const bounds = new google.maps.LatLngBounds();
        locatorBounds(center).forEach((point) => bounds.extend(point));
        map.fitBounds(bounds, 42);
        map.setHeading(0);
        map.setTilt(45);

        mapRef.current = map;
        markerRef.current = new google.maps.Marker({
          map,
          position: center,
          title: track.name,
        });
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('error');
        }
      });

    return () => {
      cancelled = true;
      markerRef.current?.setMap(null);
      markerRef.current = null;
      mapRef.current = null;
    };
  }, [track]);

  return (
    <div className="public-track-map" aria-label={`Satellite view of ${track.name}`}>
      <div className="public-track-map-canvas" ref={containerRef} />
      {status !== 'ready' && (
        <div className={`public-track-map-status ${status}`}>
          <Satellite size={22} />
          <strong>{status === 'loading' ? 'Loading satellite view' : 'Satellite view unavailable'}</strong>
          <span>
            {status === 'loading'
              ? `Centering on ${track.name}`
              : 'Use one of the map links below to view this track.'}
          </span>
        </div>
      )}
    </div>
  );
}
