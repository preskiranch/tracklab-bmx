import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { LoaderCircle, MapPinned, Search } from 'lucide-react';
import {
  loadGoogleBaseMap,
  type GoogleMap,
  type GoogleMapsEventListener,
  type GoogleMapsRuntime,
  type GoogleMarker,
} from '../lib/googleMaps';
import type { BikeShopRecord, BikeShopViewport } from '../lib/bikeShops';

export const bikeShopViewportMinimumZoom = 11;

export type BikeShopMapFocusRequest = {
  id: number;
  points: Array<{ latitude: number; longitude: number }>;
};

type BikeShopDirectoryMapProps = {
  shops: BikeShopRecord[];
  selectedShopId: string;
  busy: boolean;
  requestError: string;
  truncated: boolean;
  focusRequest: BikeShopMapFocusRequest | null;
  getResultIntentGeneration: () => number;
  onSelectShop: (shopId: string) => void;
  onViewportChange: (viewport: BikeShopViewport, observedResultIntentGeneration: number) => void;
};

type ShopCluster = {
  key: string;
  latitude: number;
  longitude: number;
  shops: BikeShopRecord[];
};

const mapDefaultCenter = { lat: 24, lng: 0 };
const viewportDebounceMilliseconds = 475;

function mercatorPixel(latitude: number, longitude: number, zoom: number) {
  const scale = 256 * 2 ** Math.max(0, zoom);
  const clampedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const sine = Math.sin(clampedLatitude * Math.PI / 180);
  return {
    x: (longitude + 180) / 360 * scale,
    y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * scale,
  };
}

function clusterShops(shops: BikeShopRecord[], zoom: number) {
  const gridSize = zoom >= 16 ? 44 : zoom >= 13 ? 54 : 66;
  const buckets = new Map<string, BikeShopRecord[]>();
  [...shops]
    .sort((left, right) => left.id.localeCompare(right.id))
    .forEach((shop) => {
      const pixel = mercatorPixel(shop.latitude, shop.longitude, zoom);
      const key = `${Math.floor(pixel.x / gridSize)}:${Math.floor(pixel.y / gridSize)}`;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(shop);
      else buckets.set(key, [shop]);
    });
  return [...buckets.entries()].map(([key, clusteredShops]) => ({
    key,
    latitude: clusteredShops.reduce((sum, shop) => sum + shop.latitude, 0) / clusteredShops.length,
    longitude: clusteredShops.reduce((sum, shop) => sum + shop.longitude, 0) / clusteredShops.length,
    shops: clusteredShops,
  } satisfies ShopCluster));
}

function readableMapError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  return message || 'Google Maps could not be loaded. The accessible shop list remains available.';
}

export function BikeShopDirectoryMap({
  shops,
  selectedShopId,
  busy,
  requestError,
  truncated,
  focusRequest,
  getResultIntentGeneration,
  onSelectShop,
  onViewportChange,
}: BikeShopDirectoryMapProps) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GoogleMap | null>(null);
  const googleRef = useRef<GoogleMapsRuntime | null>(null);
  const idleListenerRef = useRef<GoogleMapsEventListener | null>(null);
  const markerEntriesRef = useRef<Array<{ marker: GoogleMarker; listener: GoogleMapsEventListener }>>([]);
  const debounceRef = useRef<number | null>(null);
  const suppressViewportIdleRef = useRef(false);
  const releaseSuppressedIdleRef = useRef<number | null>(null);
  const viewportCallbackRef = useRef(onViewportChange);
  const resultIntentGenerationRef = useRef(getResultIntentGeneration);
  const selectCallbackRef = useRef(onSelectShop);
  const [mapStatus, setMapStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [mapError, setMapError] = useState('');
  const [zoom, setZoom] = useState(2);
  const [hasLoadedViewport, setHasLoadedViewport] = useState(false);
  viewportCallbackRef.current = onViewportChange;
  resultIntentGenerationRef.current = getResultIntentGeneration;
  selectCallbackRef.current = onSelectShop;

  const clearSuppressedProgrammaticIdle = useCallback(() => {
    suppressViewportIdleRef.current = false;
    if (releaseSuppressedIdleRef.current !== null) {
      window.clearTimeout(releaseSuppressedIdleRef.current);
      releaseSuppressedIdleRef.current = null;
    }
  }, []);

  const suppressNextProgrammaticIdle = useCallback(() => {
    suppressViewportIdleRef.current = true;
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (releaseSuppressedIdleRef.current !== null) {
      window.clearTimeout(releaseSuppressedIdleRef.current);
      releaseSuppressedIdleRef.current = null;
    }
  }, []);

  useEffect(() => {
    // Clearing a nearby/hierarchy result explicitly returns control to map
    // browsing. If a test map or browser did not emit the camera's synthetic
    // idle event, do not leave the next genuine user move suppressed.
    if (focusRequest === null) clearSuppressedProgrammaticIdle();
  }, [clearSuppressedProgrammaticIdle, focusRequest]);

  useLayoutEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const releaseForUserGesture = () => clearSuppressedProgrammaticIdle();
    canvas.addEventListener('pointerdown', releaseForUserGesture, true);
    canvas.addEventListener('wheel', releaseForUserGesture, true);
    canvas.addEventListener('keydown', releaseForUserGesture, true);

    void loadGoogleBaseMap().then((google) => {
      if (cancelled) return;
      googleRef.current = google;
      const map = new google.maps.Map(canvas, {
        center: mapDefaultCenter,
        zoom: 2,
        minZoom: 2,
        maxZoom: 20,
        mapTypeId: 'roadmap',
        clickableIcons: false,
        fullscreenControl: true,
        mapTypeControl: false,
        streetViewControl: false,
        gestureHandling: 'cooperative',
        keyboardShortcuts: true,
      });
      mapRef.current = map;
      idleListenerRef.current = map.addListener('idle', () => {
        if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
        const currentZoom = map.getZoom?.() ?? 2;
        setZoom(currentZoom);
        setHasLoadedViewport(true);
        if (suppressViewportIdleRef.current) {
          // fitBounds/setCenter are presentation updates for a hierarchy or
          // nearby result that is already loaded. Do not let their synthetic
          // idle event replace that result with a viewport request. Keep a
          // short quiet window so multi-step Google camera animations cannot
          // leak a second programmatic idle; the next real user gesture loads.
          if (releaseSuppressedIdleRef.current !== null) {
            window.clearTimeout(releaseSuppressedIdleRef.current);
          }
          releaseSuppressedIdleRef.current = window.setTimeout(() => {
            suppressViewportIdleRef.current = false;
            releaseSuppressedIdleRef.current = null;
          }, 250);
          return;
        }
        const observedResultIntentGeneration = resultIntentGenerationRef.current();
        debounceRef.current = window.setTimeout(() => {
          const bounds = map.getBounds?.();
          const northEast = bounds?.getNorthEast?.().toJSON();
          const southWest = bounds?.getSouthWest?.().toJSON();
          if (!northEast || !southWest) return;
          viewportCallbackRef.current({
            north: northEast.lat,
            south: southWest.lat,
            east: northEast.lng,
            west: southWest.lng,
            zoom: Math.floor(currentZoom),
          }, observedResultIntentGeneration);
        }, viewportDebounceMilliseconds);
      });
      resizeObserver = new ResizeObserver(() => {
        const center = map.getCenter?.().toJSON();
        google.maps.event?.trigger(map, 'resize');
        if (center) {
          suppressNextProgrammaticIdle();
          map.setCenter?.(center);
        }
      });
      resizeObserver.observe(canvas);
      setMapStatus('ready');
    }).catch((error) => {
      if (cancelled) return;
      setMapError(readableMapError(error));
      setMapStatus('error');
    });

    return () => {
      cancelled = true;
      canvas.removeEventListener('pointerdown', releaseForUserGesture, true);
      canvas.removeEventListener('wheel', releaseForUserGesture, true);
      canvas.removeEventListener('keydown', releaseForUserGesture, true);
      resizeObserver?.disconnect();
      idleListenerRef.current?.remove();
      idleListenerRef.current = null;
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      clearSuppressedProgrammaticIdle();
      markerEntriesRef.current.forEach(({ marker, listener }) => {
        listener.remove();
        marker.setMap(null);
      });
      markerEntriesRef.current = [];
      mapRef.current = null;
      googleRef.current = null;
    };
  }, [clearSuppressedProgrammaticIdle, suppressNextProgrammaticIdle]);

  useEffect(() => {
    const map = mapRef.current;
    const google = googleRef.current;
    if (!map || !google || !focusRequest || focusRequest.points.length === 0) return;
    suppressNextProgrammaticIdle();
    if (focusRequest.points.length === 1) {
      const point = focusRequest.points[0];
      map.setCenter?.({ lat: point.latitude, lng: point.longitude });
      map.setZoom?.(Math.max(bikeShopViewportMinimumZoom + 2, map.getZoom?.() ?? 0));
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    focusRequest.points.forEach((point) => bounds.extend({ lat: point.latitude, lng: point.longitude }));
    map.fitBounds(bounds, 52);
  }, [focusRequest, mapStatus, suppressNextProgrammaticIdle]);

  const clusters = useMemo(() => clusterShops(shops, zoom), [shops, zoom]);

  useEffect(() => {
    const map = mapRef.current;
    const google = googleRef.current;
    if (!map || !google || mapStatus !== 'ready') return undefined;
    markerEntriesRef.current.forEach(({ marker, listener }) => {
      listener.remove();
      marker.setMap(null);
    });
    markerEntriesRef.current = clusters.map((cluster) => {
      const isCluster = cluster.shops.length > 1;
      const includesSelected = cluster.shops.some((shop) => shop.id === selectedShopId);
      const marker = new google.maps.Marker({
        map,
        position: { lat: cluster.latitude, lng: cluster.longitude },
        title: isCluster
          ? `${cluster.shops.length} bike shops. Select to zoom in.`
          : cluster.shops[0].name,
        label: isCluster ? {
          text: cluster.shops.length > 99 ? '99+' : String(cluster.shops.length),
          color: includesSelected ? '#10220d' : '#ffffff',
          fontSize: '12px',
          fontWeight: '900',
        } : null,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: includesSelected ? '#7dff35' : isCluster ? '#142536' : '#1c7bd1',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeOpacity: 1,
          strokeWeight: includesSelected ? 4 : 3,
          scale: isCluster ? 21 : includesSelected ? 15 : 12,
        },
        zIndex: includesSelected ? 20_000 : isCluster ? 10_000 + cluster.shops.length : 1_000,
      });
      const listener = marker.addListener('click', () => {
        if (isCluster) {
          const bounds = new google.maps.LatLngBounds();
          cluster.shops.forEach((shop) => bounds.extend({ lat: shop.latitude, lng: shop.longitude }));
          map.fitBounds(bounds, 70);
        } else {
          selectCallbackRef.current(cluster.shops[0].id);
        }
      });
      return { marker, listener };
    });
    return () => {
      markerEntriesRef.current.forEach(({ marker, listener }) => {
        listener.remove();
        marker.setMap(null);
      });
      markerEntriesRef.current = [];
    };
  }, [clusters, mapStatus, selectedShopId]);

  const zoomStepsRemaining = Math.max(0, bikeShopViewportMinimumZoom - Math.floor(zoom));
  const liveMessage = mapStatus === 'loading'
    ? 'Loading Google Maps'
    : mapStatus === 'error'
      ? mapError
      : zoomStepsRemaining > 0
        ? `Zoom in ${zoomStepsRemaining} more ${zoomStepsRemaining === 1 ? 'level' : 'levels'} to load bike shops.`
        : busy
          ? 'Loading bike shops in this map area.'
          : requestError
            ? requestError
            : truncated
              ? 'Many shops are in this view. Zoom in to see a more complete area.'
              : hasLoadedViewport && shops.length === 0
                ? 'No mapped bike shops are visible in this area.'
                : `${shops.length} bike ${shops.length === 1 ? 'shop' : 'shops'} visible in this area.`;

  return (
    <section className="public-bike-shop-map" aria-label="Interactive global bike shop map">
      <div ref={canvasRef} className="public-bike-shop-map__canvas" aria-hidden={mapStatus === 'error'} />
      <div className={`public-bike-shop-map__status public-bike-shop-map__status--${mapStatus}`} role="status" aria-live="polite">
        {mapStatus === 'loading' && <LoaderCircle size={18} className="public-bike-shop-map__spinner" />}
        {mapStatus === 'error' && <MapPinned size={18} />}
        {mapStatus === 'ready' && zoomStepsRemaining > 0 && <Search size={18} />}
        <span>{liveMessage}</span>
      </div>
    </section>
  );
}
