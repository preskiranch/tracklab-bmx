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

function locatorCenter(track: TrackLocatorRecord): LatLngLiteral | null {
  const lat = Number(track.latitude);
  const lng = Number(track.longitude);
  return Number.isFinite(lat)
    && lat >= -90
    && lat <= 90
    && Number.isFinite(lng)
    && lng >= -180
    && lng <= 180
    ? { lat, lng }
    : null;
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
    let tileTimeout: number | undefined;
    let tilesLoadedListener: { remove: () => void } | undefined;
    setStatus('loading');

    loadGoogleMaps()
      .then((google) => {
        if (cancelled || !containerRef.current) {
          return;
        }

        const center = locatorCenter(track);
        if (!center) {
          setStatus('error');
          return;
        }
        const map = mapRef.current ?? new google.maps.Map(containerRef.current, {
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
        mapRef.current = map;

        const marker = markerRef.current ?? new google.maps.Marker({ map, position: center });
        marker.setMap(map);
        marker.setPosition(center);
        marker.setTitle?.(track.name);
        markerRef.current = marker;

        tilesLoadedListener = map.addListener('tilesloaded', () => {
          if (cancelled) {
            return;
          }
          if (tileTimeout !== undefined) {
            window.clearTimeout(tileTimeout);
          }
          tilesLoadedListener?.remove();
          tilesLoadedListener = undefined;
          setStatus('ready');
        });
        tileTimeout = window.setTimeout(() => {
          if (!cancelled) {
            tilesLoadedListener?.remove();
            tilesLoadedListener = undefined;
            setStatus('error');
          }
        }, 15_000);

        google.maps.event?.trigger(map, 'resize');
        const bounds = new google.maps.LatLngBounds();
        locatorBounds(center).forEach((point) => bounds.extend(point));
        map.fitBounds(bounds, 42);
        map.setHeading(0);
        map.setTilt(0);
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('error');
        }
      });

    return () => {
      cancelled = true;
      tilesLoadedListener?.remove();
      if (tileTimeout !== undefined) {
        window.clearTimeout(tileTimeout);
      }
    };
  }, [track.id, track.latitude, track.longitude, track.name]);

  useEffect(() => () => {
    markerRef.current?.setMap(null);
    markerRef.current = null;
    mapRef.current = null;
  }, []);

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
