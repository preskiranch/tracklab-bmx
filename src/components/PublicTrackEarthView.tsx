import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Globe2, MapPin, RotateCcw } from 'lucide-react';
import {
  loadGoogleMaps3DLibrary,
  type GoogleMap3DElement,
  type GoogleMaps3DLibrary,
  type GoogleMarker3DElement,
} from '../lib/googleMaps';
import { isGoogleMaps3DSteadyEvent } from '../lib/googleMaps3d';
import { trackGoogleEarthUrl } from '../lib/mapLinks';
import {
  publicTrackEarthInitialRangeMeters,
  publicTrackEarthPinAltitudeMeters,
  publicTrackEarthVisibleMarkers,
  publicTrackExplorerMarkers,
  publicTrackExplorerMarkerTitle,
  publicTrackExplorerPoint,
} from '../lib/publicTrackExplorer';
import type { TrackLocatorRecord } from '../types';

type PublicTrackEarthViewProps = {
  onClose: () => void;
  onTrackSelect: (track: TrackLocatorRecord) => void;
  originTrack: TrackLocatorRecord;
  tracks: TrackLocatorRecord[];
};

type EarthViewState = 'loading' | 'ready' | 'error';

type EarthMarkerEntry = {
  altitude: number;
  clickListener: EventListener;
  marker: GoogleMarker3DElement;
};

type MarkerConstructor = new (options?: Record<string, unknown>) => GoogleMarker3DElement;

const markerUpdateDelayMs = 90;

function validCameraCenter(
  center: GoogleMap3DElement['center'],
  fallback: { lat: number; lng: number },
) {
  return center
    && Number.isFinite(center.lat)
    && Number.isFinite(center.lng)
    && Math.abs(center.lat) <= 90
    && Math.abs(center.lng) <= 180
    ? { lat: center.lat, lng: center.lng }
    : fallback;
}

function usableCameraRange(range: number | undefined) {
  return typeof range === 'number' && Number.isFinite(range) && range > 0
    ? range
    : publicTrackEarthInitialRangeMeters;
}

function createDirectoryMarker(
  library: GoogleMaps3DLibrary,
  track: TrackLocatorRecord,
  position: { lat: number; lng: number },
  altitude: number,
  selected: boolean,
) {
  const Constructor: MarkerConstructor | undefined = library.Marker3DInteractiveElement
    ?? library.MarkerInteractiveElement
    ?? library.Marker3DElement;
  if (!Constructor) return null;

  try {
    const marker = new Constructor({
      altitudeMode: 'RELATIVE_TO_GROUND',
      collisionBehavior: selected ? 'REQUIRED' : 'OPTIONAL_AND_HIDES_LOWER_PRIORITY',
      drawsWhenOccluded: selected,
      extruded: true,
      label: track.name,
      position: { ...position, altitude: selected ? altitude * 1.18 : altitude },
      sizePreserved: true,
      title: publicTrackExplorerMarkerTitle(track),
      zIndex: selected ? 10_000 : 1,
    });
    if (library.PinElement) {
      marker.append(new library.PinElement({
        background: selected ? '#65d636' : '#d8ff3e',
        borderColor: '#0b1117',
        glyphColor: '#0b1117',
        glyphText: '',
        scale: selected ? 1.24 : 1.05,
      }));
    }
    return marker;
  } catch (error) {
    console.error(`TrackLab could not place ${track.name} in the Earth view.`, error);
    return null;
  }
}

export function PublicTrackEarthView({
  onClose,
  onTrackSelect,
  originTrack,
  tracks,
}: PublicTrackEarthViewProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GoogleMap3DElement | null>(null);
  const markerEntriesRef = useRef<Map<string, EarthMarkerEntry>>(new Map());
  const updateTimerRef = useRef(0);
  const onTrackSelectRef = useRef(onTrackSelect);
  const allMarkers = useMemo(() => publicTrackExplorerMarkers(tracks), [tracks]);
  const originPoint = useMemo(() => publicTrackExplorerPoint(originTrack), [originTrack]);
  const [viewState, setViewState] = useState<EarthViewState>('loading');
  const [visibleTrackCount, setVisibleTrackCount] = useState(1);
  onTrackSelectRef.current = onTrackSelect;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusFrame = window.requestAnimationFrame(() => {
      dialog?.querySelector<HTMLButtonElement>('button')?.focus();
    });
    return () => {
      window.cancelAnimationFrame(focusFrame);
      if (dialog?.open) dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    if (!originPoint) {
      setViewState('error');
      return undefined;
    }

    let cancelled = false;
    let mountedMap: GoogleMap3DElement | null = null;
    let readinessTimer = 0;
    const mapListeners: Array<{ name: string; listener: EventListener }> = [];
    setViewState('loading');

    const clearMarkers = () => {
      markerEntriesRef.current.forEach(({ clickListener, marker }) => {
        marker.removeEventListener('gmp-click', clickListener);
        marker.remove();
      });
      markerEntriesRef.current.clear();
    };

    const fail = () => {
      if (cancelled) return;
      window.clearTimeout(readinessTimer);
      setViewState('error');
    };

    loadGoogleMaps3DLibrary()
      .then((library) => {
        if (cancelled || !containerRef.current) return;

        const map = new library.Map3DElement({
          center: { ...originPoint, altitude: 0 },
          description: `Interactive 3D satellite view centered on ${originTrack.name}. Zoom out to reveal more named BMX tracks.`,
          gestureHandling: 'GREEDY',
          heading: 0,
          mode: 'SATELLITE',
          range: publicTrackEarthInitialRangeMeters,
          tilt: 62,
        });
        map.style.display = 'block';
        map.style.height = '100%';
        map.style.width = '100%';
        mountedMap = map;
        mapRef.current = map;

        const updateMarkers = () => {
          if (cancelled) return;
          const range = usableCameraRange(map.range);
          const center = validCameraCenter(map.center, originPoint);
          const visibleMarkers = publicTrackEarthVisibleMarkers(
            allMarkers,
            center,
            range,
            originTrack.id,
          );
          const desiredIds = new Set(visibleMarkers.map(({ track }) => track.id));
          markerEntriesRef.current.forEach((entry, trackId) => {
            if (desiredIds.has(trackId)) return;
            entry.marker.removeEventListener('gmp-click', entry.clickListener);
            entry.marker.remove();
            markerEntriesRef.current.delete(trackId);
          });

          const altitude = publicTrackEarthPinAltitudeMeters(range);
          visibleMarkers.forEach(({ position, track }) => {
            const selected = track.id === originTrack.id;
            const markerAltitude = selected ? altitude * 1.18 : altitude;
            let entry = markerEntriesRef.current.get(track.id);
            if (!entry) {
              const marker = createDirectoryMarker(library, track, position, altitude, selected);
              if (!marker) return;
              const clickListener: EventListener = (event) => {
                event.stopPropagation();
                onTrackSelectRef.current(track);
              };
              marker.addEventListener('gmp-click', clickListener);
              map.append(marker);
              entry = { altitude: markerAltitude, clickListener, marker };
              markerEntriesRef.current.set(track.id, entry);
              return;
            }
            const altitudeThreshold = Math.max(25, markerAltitude * 0.08);
            if (Math.abs(entry.altitude - markerAltitude) >= altitudeThreshold) {
              entry.marker.position = { ...position, altitude: markerAltitude };
              entry.altitude = markerAltitude;
            }
          });
          setVisibleTrackCount(visibleMarkers.length);
        };

        const scheduleMarkerUpdate: EventListener = () => {
          window.clearTimeout(updateTimerRef.current);
          updateTimerRef.current = window.setTimeout(updateMarkers, markerUpdateDelayMs);
        };
        ['gmp-centerchange', 'gmp-rangechange'].forEach((name) => {
          map.addEventListener(name, scheduleMarkerUpdate);
          mapListeners.push({ name, listener: scheduleMarkerUpdate });
        });

        const steadyListener: EventListener = (event) => {
          if (!isGoogleMaps3DSteadyEvent(event)) return;
          window.clearTimeout(readinessTimer);
          setViewState('ready');
          updateMarkers();
        };
        map.addEventListener('gmp-steadychange', steadyListener);
        mapListeners.push({ name: 'gmp-steadychange', listener: steadyListener });

        const errorListener: EventListener = fail;
        map.addEventListener('gmp-error', errorListener);
        mapListeners.push({ name: 'gmp-error', listener: errorListener });

        containerRef.current.replaceChildren(map);
        updateMarkers();
        readinessTimer = window.setTimeout(fail, 15_000);
      })
      .catch(fail);

    return () => {
      cancelled = true;
      window.clearTimeout(readinessTimer);
      window.clearTimeout(updateTimerRef.current);
      mapListeners.forEach(({ name, listener }) => mountedMap?.removeEventListener(name, listener));
      clearMarkers();
      if (containerRef.current) containerRef.current.replaceChildren();
      mapRef.current = null;
    };
  }, [allMarkers, originPoint, originTrack.id]);

  const resetToOrigin = () => {
    const map = mapRef.current;
    if (!map || !originPoint) return;
    const camera = {
      altitudeMode: 'RELATIVE_TO_GROUND' as const,
      center: { ...originPoint, altitude: 0 },
      heading: 0,
      range: publicTrackEarthInitialRangeMeters,
      tilt: 62,
    };
    if (map.flyCameraTo) {
      try {
        const result = map.flyCameraTo({ endCamera: camera, durationMillis: 650 });
        if (result instanceof Promise) void result.catch(() => undefined);
        return;
      } catch {
        // Fall through for older 3D builds that expose flyCameraTo too early.
      }
    }
    map.center = camera.center;
    map.heading = camera.heading;
    map.range = camera.range;
    map.tilt = camera.tilt;
  };

  return (
    <dialog
      ref={dialogRef}
      className="public-track-earth-view"
      aria-label={`Google Earth track view starting at ${originTrack.name}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="public-track-earth-toolbar">
        <button type="button" onClick={onClose} aria-label="Back to TrackLab track details">
          <ArrowLeft size={19} /> <span>Back to TrackLab</span>
        </button>
        <div>
          <span>Google Earth view</span>
          <strong>{originTrack.name}</strong>
        </div>
        <button type="button" onClick={resetToOrigin} aria-label={`Return Earth view to ${originTrack.name}`}>
          <RotateCcw size={18} /> <span>Return to track</span>
        </button>
      </header>

      <div className="public-track-earth-map" ref={containerRef} />

      <div className="public-track-earth-guide" role="status" aria-live="polite">
        <MapPin size={18} />
        <span>
          <strong>{visibleTrackCount.toLocaleString()} {visibleTrackCount === 1 ? 'track pin' : 'track pins'} loaded</strong>
          <small>Zoom out to reveal more BMX tracks. Select any named pin to open that track in TrackLab.</small>
        </span>
      </div>

      {viewState !== 'ready' && (
        <div className={`public-track-earth-loading ${viewState}`}>
          <Globe2 size={34} />
          <strong>{viewState === 'loading' ? 'Opening the Earth at this track' : 'Google Earth view is unavailable'}</strong>
          <span>{viewState === 'loading'
            ? 'TrackLab is placing the nearby BMX track pins.'
            : 'You can still open this selected location directly in Google Earth.'}</span>
          {viewState === 'error' && (
            <a href={trackGoogleEarthUrl(originTrack)} target="_blank" rel="noopener noreferrer">
              Open selected track in Google Earth
            </a>
          )}
        </div>
      )}
    </dialog>
  );
}
