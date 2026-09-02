import { useEffect, useMemo, useRef, useState } from 'react';
import { Satellite } from 'lucide-react';
import {
  hasGoogleMapsApiKey,
  loadGoogleBaseMap,
  type GoogleMap,
  type GoogleMapsEventListener,
  type GoogleMapsRuntime,
  type GoogleMarker,
} from '../lib/googleMaps';
import {
  publicTrackExplorerMarkers,
  publicTrackExplorerMarkerTitle,
  publicTrackExplorerPoint,
} from '../lib/publicTrackExplorer';
import type { TrackLocatorRecord } from '../types';

type PublicTrackMapProps = {
  exploreAll: boolean;
  onTrackSelect: (track: TrackLocatorRecord) => void;
  track: TrackLocatorRecord;
  tracks: TrackLocatorRecord[];
};

function locatorBounds(center: { lat: number; lng: number }) {
  const offset = 0.0014;
  return [
    { lat: center.lat - offset, lng: center.lng - offset },
    { lat: center.lat + offset, lng: center.lng + offset },
  ];
}

type TrackMarkerEntry = {
  listener: GoogleMapsEventListener;
  marker: GoogleMarker;
  track: TrackLocatorRecord;
};

function markerIcon(google: GoogleMapsRuntime, selected: boolean) {
  return {
    fillColor: selected ? '#65d636' : '#d8ff3e',
    fillOpacity: 1,
    path: google.maps.SymbolPath.CIRCLE,
    scale: selected ? 9 : 6,
    strokeColor: selected ? '#0b1117' : '#17212b',
    strokeOpacity: 1,
    strokeWeight: selected ? 3 : 2,
  };
}

export function PublicTrackMap({ exploreAll, onTrackSelect, track, tracks }: PublicTrackMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GoogleMap | null>(null);
  const googleRef = useRef<GoogleMapsRuntime | null>(null);
  const markerEntriesRef = useRef<Map<string, TrackMarkerEntry>>(new Map());
  const selectedTrackRef = useRef(track);
  const onTrackSelectRef = useRef(onTrackSelect);
  const previousExploreAllRef = useRef(false);
  const previousFocusedTrackIdRef = useRef('');
  const [mapVersion, setMapVersion] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    hasGoogleMapsApiKey() || (typeof window !== 'undefined' && Boolean(window.google?.maps?.Map)) ? 'loading' : 'error',
  );
  selectedTrackRef.current = track;
  onTrackSelectRef.current = onTrackSelect;
  const explorerMarkers = useMemo(() => publicTrackExplorerMarkers(tracks), [tracks]);

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
        if (cancelled || !containerRef.current) {
          return;
        }

        const center = publicTrackExplorerPoint(selectedTrackRef.current);
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
        googleRef.current = google;

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
        previousFocusedTrackIdRef.current = selectedTrackRef.current.id;
        setMapVersion((current) => current + 1);
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
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const google = googleRef.current;
    if (!map || !google || mapVersion === 0) return;

    const desiredMarkers = exploreAll
      ? explorerMarkers
      : explorerMarkers.filter(({ track: markerTrack }) => markerTrack.id === selectedTrackRef.current.id);
    const desiredIds = new Set(desiredMarkers.map(({ track: markerTrack }) => markerTrack.id));
    markerEntriesRef.current.forEach((entry, trackId) => {
      if (desiredIds.has(trackId)) return;
      entry.listener.remove();
      entry.marker.setMap(null);
      markerEntriesRef.current.delete(trackId);
    });

    desiredMarkers.forEach(({ position, track: markerTrack }) => {
      let entry = markerEntriesRef.current.get(markerTrack.id);
      if (!entry) {
        const marker = new google.maps.Marker({ map, position });
        const listener = marker.addListener('click', () => {
          const currentTrack = markerEntriesRef.current.get(markerTrack.id)?.track;
          if (currentTrack) onTrackSelectRef.current(currentTrack);
        });
        entry = { listener, marker, track: markerTrack };
        markerEntriesRef.current.set(markerTrack.id, entry);
      }
      entry.track = markerTrack;
      entry.marker.setMap(map);
      entry.marker.setPosition(position);
      entry.marker.setIcon(markerIcon(google, markerTrack.id === selectedTrackRef.current.id));
      entry.marker.setTitle?.(publicTrackExplorerMarkerTitle(markerTrack));
    });

    const enteringExplorer = exploreAll && !previousExploreAllRef.current;
    const leavingExplorer = !exploreAll && previousExploreAllRef.current;
    if (enteringExplorer) {
      const bounds = new google.maps.LatLngBounds();
      desiredMarkers.forEach(({ position }) => bounds.extend(position));
      map.fitBounds(bounds, 42);
      map.setHeading(0);
      map.setTilt(0);
    } else if (!exploreAll && leavingExplorer) {
      const selectedPoint = publicTrackExplorerPoint(selectedTrackRef.current);
      if (!selectedPoint) return;
      const bounds = new google.maps.LatLngBounds();
      locatorBounds(selectedPoint).forEach((point) => bounds.extend(point));
      map.fitBounds(bounds, 42);
      map.setHeading(0);
      map.setTilt(0);
    }
    previousExploreAllRef.current = exploreAll;
  }, [exploreAll, explorerMarkers, mapVersion]);

  useEffect(() => {
    const map = mapRef.current;
    const google = googleRef.current;
    if (!map || !google || mapVersion === 0) return;
    const previousTrackId = previousFocusedTrackIdRef.current;
    if (previousTrackId === track.id) return;

    if (exploreAll) {
      const previousMarker = markerEntriesRef.current.get(previousTrackId)?.marker;
      const selectedMarker = markerEntriesRef.current.get(track.id)?.marker;
      previousMarker?.setIcon(markerIcon(google, false));
      selectedMarker?.setIcon(markerIcon(google, true));
      previousFocusedTrackIdRef.current = track.id;
      return;
    }

    markerEntriesRef.current.forEach((entry, trackId) => {
      if (trackId === track.id) return;
      entry.listener.remove();
      entry.marker.setMap(null);
      markerEntriesRef.current.delete(trackId);
    });
    const selectedPoint = publicTrackExplorerPoint(track);
    if (!selectedPoint) {
      setStatus('error');
      return;
    }
    let entry = markerEntriesRef.current.get(track.id);
    if (!entry) {
      const marker = new google.maps.Marker({ map, position: selectedPoint });
      const listener = marker.addListener('click', () => {
        const currentTrack = markerEntriesRef.current.get(track.id)?.track;
        if (currentTrack) onTrackSelectRef.current(currentTrack);
      });
      entry = { listener, marker, track };
      markerEntriesRef.current.set(track.id, entry);
    }
    entry.track = track;
    entry.marker.setMap(map);
    entry.marker.setPosition(selectedPoint);
    entry.marker.setIcon(markerIcon(google, true));
    entry.marker.setTitle?.(publicTrackExplorerMarkerTitle(track));
    const bounds = new google.maps.LatLngBounds();
    locatorBounds(selectedPoint).forEach((point) => bounds.extend(point));
    map.fitBounds(bounds, 42);
    map.setHeading(0);
    map.setTilt(0);
    previousFocusedTrackIdRef.current = track.id;
  }, [exploreAll, mapVersion, track]);

  useEffect(() => () => {
    markerEntriesRef.current.forEach(({ listener, marker }) => {
      listener.remove();
      marker.setMap(null);
    });
    markerEntriesRef.current.clear();
    googleRef.current = null;
    mapRef.current = null;
  }, []);

  return (
    <div
      className={`public-track-map${exploreAll ? ' exploring-all-tracks' : ''}`}
      aria-label={exploreAll ? 'Global TrackLab satellite explorer' : `Satellite view of ${track.name}`}
    >
      <div className="public-track-map-canvas" ref={containerRef} />
      {exploreAll && status === 'ready' && (
        <div className="public-track-map-explorer-status" role="status" aria-live="polite">
          <strong>{explorerMarkers.length.toLocaleString()} TrackLab track markers on the satellite map</strong>
          <span>Zoom and select any marker to open that track in TrackLab.</span>
        </div>
      )}
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
