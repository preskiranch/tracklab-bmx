import { Flag, MapPin, RotateCcw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  loadGoogleMaps,
  reverseGeocodeGooglePoint,
  type GoogleMap,
  type GoogleMarker,
  type GooglePolyline,
} from '../lib/googleMaps';
import type { TrackPoint } from '../types';
import './ExploreRouteMapPicker.css';

type ExploreRouteMapPickerProps = {
  initialOrigin: TrackPoint | null;
  initialOriginLabel?: string;
  initialDestination: TrackPoint | null;
  initialDestinationLabel?: string;
  onApply: (
    origin: { point: TrackPoint; label: string },
    destination: { point: TrackPoint; label: string },
  ) => void;
  onClose: () => void;
};

type SelectionMode = 'origin' | 'destination';

function coordinateFallback(point: TrackPoint) {
  return `Selected map point near ${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`;
}

export function ExploreRouteMapPicker({
  initialOrigin,
  initialOriginLabel,
  initialDestination,
  initialDestinationLabel,
  onApply,
  onClose,
}: ExploreRouteMapPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GoogleMap | null>(null);
  const originMarkerRef = useRef<GoogleMarker | null>(null);
  const destinationMarkerRef = useRef<GoogleMarker | null>(null);
  const connectorRef = useRef<GooglePolyline | null>(null);
  const modeRef = useRef<SelectionMode>('origin');
  const geocodeRequestRef = useRef({ origin: 0, destination: 0 });
  const [origin, setOrigin] = useState<TrackPoint | null>(initialOrigin);
  const [destination, setDestination] = useState<TrackPoint | null>(initialDestination);
  const [originLabel, setOriginLabel] = useState(initialOriginLabel ?? 'Not selected');
  const [destinationLabel, setDestinationLabel] = useState(initialDestinationLabel ?? 'Not selected');
  const [selectionMode, setSelectionMode] = useState<SelectionMode>(modeRef.current);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  modeRef.current = selectionMode;

  const selectPoint = (mode: SelectionMode, point: TrackPoint) => {
    const requestId = geocodeRequestRef.current[mode] + 1;
    geocodeRequestRef.current[mode] = requestId;
    if (mode === 'origin') {
      setOrigin(point);
      setOriginLabel('Finding street address…');
      setSelectionMode('destination');
    } else {
      setDestination(point);
      setDestinationLabel('Finding street address…');
    }
    void reverseGeocodeGooglePoint(point)
      .then(({ label }) => {
        if (geocodeRequestRef.current[mode] !== requestId) {
          return;
        }
        if (mode === 'origin') {
          setOriginLabel(label);
        } else {
          setDestinationLabel(label);
        }
      })
      .catch(() => {
        if (geocodeRequestRef.current[mode] !== requestId) {
          return;
        }
        if (mode === 'origin') {
          setOriginLabel(coordinateFallback(point));
        } else {
          setDestinationLabel(coordinateFallback(point));
        }
      });
  };

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    let clickListener: { remove: () => void } | null = null;
    setStatus('loading');
    setError('');
    void loadGoogleMaps()
      .then((google) => {
        if (cancelled || !containerRef.current) {
          return;
        }
        const initialPoint = initialOrigin ?? initialDestination ?? { lat: 20, lng: 0 };
        const map = new google.maps.Map(containerRef.current, {
          center: initialPoint,
          clickableIcons: false,
          controlSize: 30,
          disableDefaultUI: true,
          fullscreenControl: false,
          gestureHandling: 'greedy',
          keyboardShortcuts: true,
          mapTypeControl: false,
          mapTypeId: 'hybrid',
          rotateControl: false,
          scaleControl: true,
          streetViewControl: false,
          zoom: initialOrigin || initialDestination ? 13 : 2,
          zoomControl: true,
        });
        mapRef.current = map;
        originMarkerRef.current = new google.maps.Marker({
          label: { color: '#0f172a', fontSize: '11px', fontWeight: '900', text: 'S' },
          map: initialOrigin ? map : null,
          position: initialOrigin ?? initialPoint,
          title: 'Explore starting point',
          zIndex: 20,
        });
        destinationMarkerRef.current = new google.maps.Marker({
          label: { color: '#ffffff', fontSize: '11px', fontWeight: '900', text: 'F' },
          map: initialDestination ? map : null,
          position: initialDestination ?? initialPoint,
          title: 'Explore destination',
          zIndex: 21,
        });
        connectorRef.current = new google.maps.Polyline({
          clickable: false,
          map: initialOrigin && initialDestination ? map : null,
          path: initialOrigin && initialDestination ? [initialOrigin, initialDestination] : [],
          strokeColor: '#d8ff3e',
          strokeOpacity: 0.9,
          strokeWeight: 4,
        });
        if (initialOrigin && initialDestination) {
          const bounds = new google.maps.LatLngBounds();
          bounds.extend(initialOrigin);
          bounds.extend(initialDestination);
          map.fitBounds(bounds, 70);
        }
        clickListener = map.addListener('click', (event) => {
          const point = event?.latLng?.toJSON();
          if (!point) {
            return;
          }
          selectPoint(modeRef.current, point);
        });
        setStatus('ready');
      })
      .catch((loadError: Error) => {
        if (!cancelled) {
          setError(loadError.message);
          setStatus('error');
        }
      });

    return () => {
      cancelled = true;
      clickListener?.remove();
      originMarkerRef.current?.setMap(null);
      destinationMarkerRef.current?.setMap(null);
      connectorRef.current?.setMap(null);
      originMarkerRef.current = null;
      destinationMarkerRef.current = null;
      connectorRef.current = null;
      mapRef.current = null;
    };
  }, [initialDestination, initialOrigin]);

  useEffect(() => {
    const map = mapRef.current;
    const marker = originMarkerRef.current;
    if (!map || !marker || status !== 'ready') {
      return;
    }
    if (origin) {
      marker.setPosition(origin);
      marker.setMap(map);
    } else {
      marker.setMap(null);
    }
  }, [origin, status]);

  useEffect(() => {
    const map = mapRef.current;
    const marker = destinationMarkerRef.current;
    if (!map || !marker || status !== 'ready') {
      return;
    }
    if (destination) {
      marker.setPosition(destination);
      marker.setMap(map);
    } else {
      marker.setMap(null);
    }
  }, [destination, status]);

  useEffect(() => {
    const map = mapRef.current;
    const connector = connectorRef.current;
    if (!map || !connector || status !== 'ready') {
      return;
    }
    if (origin && destination) {
      connector.setPath?.([origin, destination]);
      connector.setMap(map);
    } else {
      connector.setMap(null);
    }
  }, [destination, origin, status]);

  const resetSelection = () => {
    geocodeRequestRef.current.origin += 1;
    geocodeRequestRef.current.destination += 1;
    setOrigin(null);
    setDestination(null);
    setOriginLabel('Not selected');
    setDestinationLabel('Not selected');
    setSelectionMode('origin');
  };

  return (
    <div className="explore-map-picker-layer" role="dialog" aria-modal="true" aria-labelledby="explore-map-picker-title">
      <section className="explore-map-picker">
        <header>
          <div>
            <span className="eyebrow">Choose on satellite map</span>
            <h3 id="explore-map-picker-title">Select your route endpoints</h3>
            <p>Tap once for the start, then tap where you want to finish. Pan and zoom anywhere in the world.</p>
          </div>
          <button type="button" aria-label="Close map route picker" onClick={onClose}><X size={20} /></button>
        </header>
        <div className="explore-map-picker-mode" role="group" aria-label="Point to place on map">
          <button
            className={selectionMode === 'origin' ? 'selected' : ''}
            type="button"
            aria-pressed={selectionMode === 'origin'}
            onClick={() => setSelectionMode('origin')}
          >
            <MapPin size={16} /> Set start
          </button>
          <button
            className={selectionMode === 'destination' ? 'selected' : ''}
            type="button"
            aria-pressed={selectionMode === 'destination'}
            onClick={() => setSelectionMode('destination')}
          >
            <Flag size={16} /> Set destination
          </button>
          <span>{selectionMode === 'origin' ? 'Tap the map to place the green start pin.' : 'Tap the map to place the finish pin.'}</span>
        </div>
        <div className="explore-map-picker-canvas" ref={containerRef} aria-label="Map for choosing Explore route points" />
        {status === 'loading' && <div className="explore-map-picker-status">Loading satellite map…</div>}
        {status === 'error' && <div className="explore-map-picker-status error">{error || 'The satellite map could not load.'}</div>}
        <div className="explore-map-picker-points">
          <div><MapPin size={17} /><span><small>Start address</small><strong>{originLabel}</strong></span></div>
          <div><Flag size={17} /><span><small>Destination address</small><strong>{destinationLabel}</strong></span></div>
        </div>
        <footer>
          <button type="button" onClick={resetSelection}><RotateCcw size={16} /> Start over</button>
          <button
            className="primary"
            type="button"
            disabled={
              !origin
              || !destination
              || originLabel === 'Finding street address…'
              || destinationLabel === 'Finding street address…'
            }
            onClick={() => {
              if (origin && destination) {
                onApply(
                  { point: origin, label: originLabel || coordinateFallback(origin) },
                  { point: destination, label: destinationLabel || coordinateFallback(destination) },
                );
              }
            }}
          >
            Use these map points
          </button>
        </footer>
      </section>
    </div>
  );
}
