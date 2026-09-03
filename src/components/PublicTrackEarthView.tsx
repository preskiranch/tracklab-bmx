import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Globe2,
  Map as MapIcon,
  MapPin,
  RotateCcw,
  Store,
} from 'lucide-react';
import {
  searchBikeShopsInViewport,
  type BikeShopAttribution,
  type BikeShopRecord,
} from '../lib/bikeShops';
import {
  loadGoogleMaps3DLibrary,
  type GoogleMap3DElement,
  type GoogleMaps3DLibrary,
  type GoogleMarker3DElement,
} from '../lib/googleMaps';
import { isGoogleMaps3DSteadyEvent } from '../lib/googleMaps3d';
import { trackGoogleEarthUrl } from '../lib/mapLinks';
import {
  publicTrackEarthBikeShopViewport,
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
  onShopSelect: (shop: BikeShopRecord) => void;
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

type ShopMarkerEntry = {
  clickListener: EventListener;
  marker: GoogleMarker3DElement;
};

type BikeShopViewportMeta = {
  attributions: BikeShopAttribution[];
  degraded: boolean;
  notice: string;
  truncated: boolean;
};

type MarkerConstructor = new (options?: Record<string, unknown>) => GoogleMarker3DElement;

const markerUpdateDelayMs = 90;
const shopUpdateDelayMs = 320;

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
        background: selected ? '#ff4d4f' : '#d91f26',
        borderColor: '#ffffff',
        glyphColor: '#ffffff',
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

function createBikeShopMarker(
  library: GoogleMaps3DLibrary,
  shop: BikeShopRecord,
  altitude: number,
) {
  const Constructor: MarkerConstructor | undefined = library.Marker3DInteractiveElement
    ?? library.MarkerInteractiveElement
    ?? library.Marker3DElement;
  if (!Constructor) return null;
  try {
    const marker = new Constructor({
      altitudeMode: 'RELATIVE_TO_GROUND',
      collisionBehavior: 'REQUIRED',
      drawsWhenOccluded: false,
      extruded: true,
      label: shop.name,
      position: { lat: shop.latitude, lng: shop.longitude, altitude },
      sizePreserved: true,
      title: `${shop.name}. Open TrackLab bike shop details`,
      zIndex: 500,
    });
    if (library.PinElement) {
      marker.append(new library.PinElement({
        background: '#1687ff',
        borderColor: '#ffffff',
        glyphColor: '#ffffff',
        glyphText: '',
        scale: 0.88,
      }));
    }
    return marker;
  } catch (error) {
    console.error(`TrackLab could not place ${shop.name} in the Earth view.`, error);
    return null;
  }
}

export function PublicTrackEarthView({
  onClose,
  onShopSelect,
  onTrackSelect,
  originTrack,
  tracks,
}: PublicTrackEarthViewProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GoogleMap3DElement | null>(null);
  const libraryRef = useRef<GoogleMaps3DLibrary | null>(null);
  const markerEntriesRef = useRef<Map<string, EarthMarkerEntry>>(new Map());
  const shopMarkerEntriesRef = useRef<Map<string, ShopMarkerEntry>>(new Map());
  const shopRequestRef = useRef<AbortController | null>(null);
  const mapLabelsRef = useRef(true);
  const updateTimerRef = useRef(0);
  const shopUpdateTimerRef = useRef(0);
  const onShopSelectRef = useRef(onShopSelect);
  const onTrackSelectRef = useRef(onTrackSelect);
  const allMarkers = useMemo(() => publicTrackExplorerMarkers(tracks), [tracks]);
  const originPoint = useMemo(() => publicTrackExplorerPoint(originTrack), [originTrack]);
  const [viewState, setViewState] = useState<EarthViewState>('loading');
  const [showMapLabels, setShowMapLabels] = useState(true);
  const [showBikeShops, setShowBikeShops] = useState(false);
  const [bikeShops, setBikeShops] = useState<BikeShopRecord[]>([]);
  const [bikeShopStatus, setBikeShopStatus] = useState<'off' | 'loading' | 'ready' | 'zoom' | 'error'>('off');
  const [bikeShopViewportMeta, setBikeShopViewportMeta] = useState<BikeShopViewportMeta | null>(null);
  const [cameraSnapshot, setCameraSnapshot] = useState(() => ({
    center: originPoint ?? { lat: 0, lng: 0 },
    range: publicTrackEarthInitialRangeMeters,
  }));
  const [visibleTrackCount, setVisibleTrackCount] = useState(1);
  onShopSelectRef.current = onShopSelect;
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
        libraryRef.current = library;

        const map = new library.Map3DElement({
          center: { ...originPoint, altitude: 0 },
          description: `Interactive global 3D BMX track map starting at ${originTrack.name}. Zoom out to reveal more named BMX tracks.`,
          gestureHandling: 'GREEDY',
          heading: 0,
          mode: mapLabelsRef.current ? 'HYBRID' : 'SATELLITE',
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
          setCameraSnapshot((current) => (
            Math.abs(current.center.lat - center.lat) < 0.000001
              && Math.abs(current.center.lng - center.lng) < 0.000001
              && Math.abs(current.range - range) < 0.5
              ? current
              : { center, range }
          ));
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
      window.clearTimeout(shopUpdateTimerRef.current);
      shopRequestRef.current?.abort();
      mapListeners.forEach(({ name, listener }) => mountedMap?.removeEventListener(name, listener));
      clearMarkers();
      shopMarkerEntriesRef.current.forEach(({ clickListener, marker }) => {
        marker.removeEventListener('gmp-click', clickListener);
        marker.remove();
      });
      shopMarkerEntriesRef.current.clear();
      if (containerRef.current) containerRef.current.replaceChildren();
      mapRef.current = null;
      libraryRef.current = null;
    };
  }, [allMarkers, originPoint, originTrack.id]);

  useEffect(() => {
    window.clearTimeout(shopUpdateTimerRef.current);
    shopRequestRef.current?.abort();
    shopRequestRef.current = null;
    if (!showBikeShops || viewState !== 'ready') {
      setBikeShops([]);
      setBikeShopViewportMeta(null);
      setBikeShopStatus(showBikeShops ? 'loading' : 'off');
      return undefined;
    }

    const viewport = publicTrackEarthBikeShopViewport(cameraSnapshot.center, cameraSnapshot.range);
    if (!viewport) {
      setBikeShops([]);
      setBikeShopViewportMeta(null);
      setBikeShopStatus('zoom');
      return undefined;
    }

    const controller = new AbortController();
    shopRequestRef.current = controller;
    setBikeShopStatus('loading');
    setBikeShops([]);
    setBikeShopViewportMeta(null);
    shopUpdateTimerRef.current = window.setTimeout(() => {
      void searchBikeShopsInViewport(viewport, fetch, controller.signal)
        .then((result) => {
          if (controller.signal.aborted || shopRequestRef.current !== controller) return;
          setBikeShops(result.shops);
          setBikeShopViewportMeta({
            attributions: result.attributions,
            degraded: result.degraded,
            notice: result.notice,
            truncated: result.truncated,
          });
          setBikeShopStatus('ready');
        })
        .catch(() => {
          if (controller.signal.aborted || shopRequestRef.current !== controller) return;
          setBikeShops([]);
          setBikeShopViewportMeta(null);
          setBikeShopStatus('error');
        });
    }, shopUpdateDelayMs);
    return () => {
      window.clearTimeout(shopUpdateTimerRef.current);
      controller.abort();
    };
  }, [
    cameraSnapshot.center.lat,
    cameraSnapshot.center.lng,
    cameraSnapshot.range,
    showBikeShops,
    viewState,
  ]);

  useEffect(() => {
    shopMarkerEntriesRef.current.forEach(({ clickListener, marker }) => {
      marker.removeEventListener('gmp-click', clickListener);
      marker.remove();
    });
    shopMarkerEntriesRef.current.clear();
    const map = mapRef.current;
    const library = libraryRef.current;
    if (!map || !library || !showBikeShops || bikeShopStatus !== 'ready') return undefined;

    const altitude = Math.max(35, publicTrackEarthPinAltitudeMeters(cameraSnapshot.range) * 0.45);
    bikeShops.forEach((shop) => {
      const marker = createBikeShopMarker(library, shop, altitude);
      if (!marker) return;
      const clickListener: EventListener = (event) => {
        event.stopPropagation();
        onShopSelectRef.current(shop);
      };
      marker.addEventListener('gmp-click', clickListener);
      map.append(marker);
      shopMarkerEntriesRef.current.set(shop.id, { clickListener, marker });
    });

    return () => {
      shopMarkerEntriesRef.current.forEach(({ clickListener, marker }) => {
        marker.removeEventListener('gmp-click', clickListener);
        marker.remove();
      });
      shopMarkerEntriesRef.current.clear();
    };
  }, [bikeShopStatus, bikeShops, showBikeShops]);

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

  const toggleMapLabels = () => {
    setShowMapLabels((current) => {
      const next = !current;
      mapLabelsRef.current = next;
      if (mapRef.current) mapRef.current.mode = next ? 'HYBRID' : 'SATELLITE';
      return next;
    });
  };

  const toggleBikeShops = () => {
    setShowBikeShops((current) => !current);
  };

  const bikeShopStatusLabel = bikeShopStatus === 'loading'
    ? 'Loading bike shops in this view…'
    : bikeShopStatus === 'zoom'
      ? 'Zoom in closer to load bike shops.'
      : bikeShopStatus === 'error'
        ? 'Bike shops could not be loaded. Move the map or try again.'
        : bikeShopStatus === 'ready'
          ? `${bikeShops.length.toLocaleString()} ${bikeShops.length === 1 ? 'bike shop' : 'bike shops'} loaded as blue pins.${bikeShopViewportMeta?.truncated ? ' This view reached its result limit; zoom in to reveal every shop in a smaller area.' : ''}`
          : 'Bike shop pins are off.';

  return (
    <dialog
      ref={dialogRef}
      className="public-track-earth-view"
      aria-label={`Global 3D track explorer starting at ${originTrack.name}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="public-track-earth-toolbar">
        <button type="button" onClick={onClose} aria-label="Back to TrackLab track details">
          <ArrowLeft size={19} /> <span>Back to TrackLab</span>
        </button>
        <div className="public-track-earth-title">
          <span>Global 3D Track Explorer</span>
          <strong>{originTrack.name}</strong>
        </div>
        <div className="public-track-earth-toolbar-actions">
          <button
            type="button"
            aria-pressed={showMapLabels}
            aria-label={showMapLabels ? 'Hide map boundaries and labels' : 'Show map boundaries and labels'}
            onClick={toggleMapLabels}
          >
            <MapIcon size={18} /> <span>{showMapLabels ? 'Labels on' : 'Labels off'}</span>
          </button>
          <button
            type="button"
            aria-pressed={showBikeShops}
            aria-label={showBikeShops ? 'Hide blue bike shop pins' : 'Show blue bike shop pins'}
            onClick={toggleBikeShops}
          >
            <Store size={18} /> <span>{showBikeShops ? 'Bike shops on' : 'Bike shops off'}</span>
          </button>
          <button type="button" onClick={resetToOrigin} aria-label={`Return global explorer to ${originTrack.name}`}>
            <RotateCcw size={18} /> <span>Return to track</span>
          </button>
        </div>
      </header>

      <div className="public-track-earth-map" ref={containerRef} />

      <div className="public-track-earth-guide" role="status" aria-live="polite">
        <MapPin size={18} />
        <span>
          <strong>{visibleTrackCount.toLocaleString()} red {visibleTrackCount === 1 ? 'track pin' : 'track pins'} loaded</strong>
          <small>
            <span>Zoom out for more tracks. {showBikeShops ? bikeShopStatusLabel : 'Turn on bike shops to add clickable blue bike-shop pins.'}</span>
            {showBikeShops && bikeShopStatus === 'ready' && bikeShopViewportMeta?.notice && (
              <span>{bikeShopViewportMeta.notice}</span>
            )}
            {showBikeShops && bikeShopStatus === 'ready' && bikeShopViewportMeta?.degraded && !bikeShopViewportMeta.notice && (
              <span>Some bike-shop sources are temporarily unavailable; the visible pins may be incomplete.</span>
            )}
            {showBikeShops && bikeShopStatus === 'ready' && bikeShopViewportMeta && bikeShopViewportMeta.attributions.length > 0 && (
              <span className="public-track-earth-guide__attribution">
                Bike shop sources:{' '}
                {bikeShopViewportMeta.attributions.map((attribution, index) => (
                  <span key={`${attribution.url}-${attribution.text}`}>
                    {index > 0 && ' · '}
                    <a href={attribution.url} target="_blank" rel="noreferrer">{attribution.text}</a>
                  </span>
                ))}
              </span>
            )}
          </small>
        </span>
      </div>

      {viewState !== 'ready' && (
        <div className={`public-track-earth-loading ${viewState}`}>
          <Globe2 size={34} />
          <strong>{viewState === 'loading' ? 'Opening the global track explorer' : 'Global 3D Track Explorer is unavailable'}</strong>
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
