import type { TrackPoint, TrackRecord, TrackZone } from '../types';

type LatLngLiteral = {
  lat: number;
  lng: number;
};

type GoogleMap = {
  addListener: (eventName: string, handler: (event: GoogleMapClickEvent) => void) => GoogleMapsEventListener;
  fitBounds: (bounds: GoogleLatLngBounds, padding?: number) => void;
  setHeading: (heading: number) => void;
  setOptions: (options: Record<string, unknown>) => void;
  setTilt: (tilt: number) => void;
};

type GoogleMapClickEvent = {
  latLng?: {
    toJSON: () => LatLngLiteral;
  };
};

type GoogleMapsEventListener = {
  remove: () => void;
};

type GoogleLatLngBounds = {
  extend: (point: LatLngLiteral) => void;
};

type GooglePolyline = {
  setMap: (map: GoogleMap | null) => void;
};

type GoogleMarker = {
  setMap: (map: GoogleMap | null) => void;
  setPosition: (position: LatLngLiteral) => void;
};

type GoogleMapsRuntime = {
  maps: {
    LatLngBounds: new () => GoogleLatLngBounds;
    Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMap;
    Marker: new (options: Record<string, unknown>) => GoogleMarker;
    Polyline: new (options: Record<string, unknown>) => GooglePolyline;
    SymbolPath: {
      CIRCLE: unknown;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleMapsRuntime;
    __trackLabGoogleMapsPromise?: Promise<GoogleMapsRuntime>;
  }
}

export function getGoogleMapsApiKey() {
  return import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() ?? '';
}

export function hasGoogleMapsApiKey() {
  return getGoogleMapsApiKey().length > 0;
}

export function loadGoogleMaps() {
  if (window.google?.maps) {
    return Promise.resolve(window.google);
  }

  if (window.__trackLabGoogleMapsPromise) {
    return window.__trackLabGoogleMapsPromise;
  }

  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) {
    return Promise.reject(new Error('Google Maps API key is not configured.'));
  }

  window.__trackLabGoogleMapsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?${new URLSearchParams({
      key: apiKey,
      v: 'weekly',
    }).toString()}`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.maps) {
        resolve(window.google);
      } else {
        reject(new Error('Google Maps loaded without the maps runtime.'));
      }
    };
    script.onerror = () => reject(new Error('Google Maps failed to load.'));
    document.head.appendChild(script);
  });

  return window.__trackLabGoogleMapsPromise;
}

export function trackCenter(track: TrackRecord): LatLngLiteral {
  const points = trackBoundsPoints(track);
  const total = points.reduce(
    (sum, point) => ({ lat: sum.lat + point.lat, lng: sum.lng + point.lng }),
    { lat: 0, lng: 0 },
  );

  return {
    lat: total.lat / points.length,
    lng: total.lng / points.length,
  };
}

export function trackRoute(track: TrackRecord) {
  return track.centerline && track.centerline.length > 1 ? track.centerline : track.outline;
}

export function trackBoundsPoints(track: TrackRecord) {
  const route = trackRoute(track);
  const points = [...track.outline, ...route];
  return points.length > 0 ? points : [{ lat: track.latitude ?? 0, lng: track.longitude ?? 0 }];
}

export function trackStartPoint(track: TrackRecord) {
  const route = trackRoute(track);
  return track.startGate ?? route[0];
}

export function trackFinishPoint(track: TrackRecord) {
  const route = trackRoute(track);
  return track.finishLine ?? route[route.length - 1];
}

function distanceBetween(a: TrackPoint, b: TrackPoint) {
  const latScale = 111_320;
  const lngScale = Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180)) * 111_320;
  return Math.hypot((b.lng - a.lng) * lngScale, (b.lat - a.lat) * latScale);
}

function pointAtProgress(outline: TrackPoint[], progress: number): LatLngLiteral {
  const segments = outline.slice(1).map((point, index) => ({
    start: outline[index],
    end: point,
    distance: distanceBetween(outline[index], point),
  }));
  const total = segments.reduce((sum, segment) => sum + segment.distance, 0);
  const target = Math.max(0, Math.min(1, progress)) * total;
  let traveled = 0;

  for (const segment of segments) {
    if (traveled + segment.distance >= target) {
      const localProgress = (target - traveled) / Math.max(1, segment.distance);
      return {
        lat: segment.start.lat + (segment.end.lat - segment.start.lat) * localProgress,
        lng: segment.start.lng + (segment.end.lng - segment.start.lng) * localProgress,
      };
    }

    traveled += segment.distance;
  }

  return outline[outline.length - 1];
}

export function zonePolyline(track: TrackRecord, zone: TrackZone) {
  const route = trackRoute(track);
  return Array.from({ length: 24 }, (_, index) => {
    const t = index / 23;
    const meter = zone.startMeter + (zone.endMeter - zone.startMeter) * t;
    return pointAtProgress(route, meter / track.lengthMeters);
  });
}

export function riderLatLng(track: TrackRecord, distanceMeters: number) {
  return pointAtProgress(trackRoute(track), distanceMeters / track.lengthMeters);
}

export type {
  GoogleLatLngBounds,
  GoogleMap,
  GoogleMapClickEvent,
  GoogleMapsEventListener,
  GoogleMapsRuntime,
  GoogleMarker,
  GooglePolyline,
  LatLngLiteral,
};
