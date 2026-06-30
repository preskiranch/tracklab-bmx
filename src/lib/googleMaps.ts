import { distanceBetweenTrackPoints } from './trackMapping';
import type { TrackPoint, TrackRecord, TrackZone } from '../types';

type LatLngLiteral = {
  lat: number;
  lng: number;
};

type GoogleMap = {
  addListener: (eventName: string, handler: (event?: GoogleMapClickEvent) => void) => GoogleMapsEventListener;
  fitBounds: (bounds: GoogleLatLngBounds, padding?: number) => void;
  getHeading?: () => number | undefined;
  getTilt?: () => number | undefined;
  moveCamera?: (cameraOptions: Record<string, unknown>) => void;
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
  setIcon: (icon: Record<string, unknown>) => void;
  setMap: (map: GoogleMap | null) => void;
  setPosition: (position: LatLngLiteral) => void;
  setTitle?: (title: string) => void;
};

type GoogleMapConstructor = {
  new (element: HTMLElement, options: Record<string, unknown>): GoogleMap;
};

type GoogleMapsRuntime = {
  maps: {
    importLibrary?: (libraryName: string) => Promise<unknown>;
    geometry?: {
      spherical?: {
        computeLength: (path: LatLngLiteral[]) => number;
      };
    };
    event?: {
      trigger: (target: unknown, eventName: string) => void;
    };
    LatLngBounds: new () => GoogleLatLngBounds;
    Map: GoogleMapConstructor;
    Marker: new (options: Record<string, unknown>) => GoogleMarker;
    Point: new (x: number, y: number) => unknown;
    Polyline: new (options: Record<string, unknown>) => GooglePolyline;
    RenderingType?: {
      VECTOR: unknown;
    };
    Size: new (width: number, height: number) => unknown;
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
      libraries: 'geometry',
      loading: 'async',
      v: 'weekly',
    }).toString()}`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      const resolveRuntime = async () => {
        if (!window.google?.maps) {
          reject(new Error('Google Maps loaded without the maps runtime.'));
          return;
        }

        if (window.google.maps.importLibrary) {
          await Promise.all([
            window.google.maps.importLibrary('maps'),
            window.google.maps.importLibrary('geometry'),
          ]);
        }

        if (window.google.maps.Map) {
          resolve(window.google);
        } else {
          reject(new Error('Google Maps loaded without the map constructor.'));
        }
      };

      resolveRuntime().catch((error: Error) => reject(error));
    };
    script.onerror = () => reject(new Error('Google Maps failed to load.'));
    document.head.appendChild(script);
  });

  return window.__trackLabGoogleMapsPromise;
}

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function averagePoint(points: TrackPoint[]): LatLngLiteral {
  const total = points.reduce(
    (sum, point) => ({ lat: sum.lat + point.lat, lng: sum.lng + point.lng }),
    { lat: 0, lng: 0 },
  );

  return {
    lat: total.lat / points.length,
    lng: total.lng / points.length,
  };
}

function locatorPoint(track: TrackRecord): LatLngLiteral {
  if (isFiniteCoordinate(track.latitude) && isFiniteCoordinate(track.longitude)) {
    return { lat: track.latitude, lng: track.longitude };
  }

  if (track.startGate) {
    return track.startGate;
  }

  if (track.centerline && track.centerline.length > 0) {
    return averagePoint(track.centerline);
  }

  if (track.outline.length > 0) {
    return averagePoint(track.outline);
  }

  return { lat: 0, lng: 0 };
}

export function hasUserMappedRoute(track: TrackRecord) {
  return track.routeStatus === 'user-mapped' && Boolean(track.centerline && track.centerline.length > 1);
}

export function mappedTrackRoute(track: TrackRecord) {
  return hasUserMappedRoute(track) && track.centerline ? track.centerline : [];
}

export function trackCenter(track: TrackRecord): LatLngLiteral {
  const route = mappedTrackRoute(track);

  return route.length > 0 ? averagePoint(route) : locatorPoint(track);
}

export function trackRoute(track: TrackRecord) {
  return track.centerline && track.centerline.length > 1 ? track.centerline : track.outline;
}

export function trackBoundsPoints(track: TrackRecord) {
  const route = mappedTrackRoute(track);
  if (route.length > 0) {
    return route;
  }

  const center = locatorPoint(track);
  const offset = 0.0014;
  return [
    { lat: center.lat - offset, lng: center.lng - offset },
    { lat: center.lat + offset, lng: center.lng + offset },
  ];
}

export function trackStartPoint(track: TrackRecord) {
  const route = mappedTrackRoute(track);
  return track.startGate ?? route[0] ?? locatorPoint(track);
}

export function trackFinishPoint(track: TrackRecord) {
  const route = mappedTrackRoute(track);
  return track.finishLine ?? route[route.length - 1] ?? locatorPoint(track);
}

function pointAtProgress(outline: TrackPoint[], progress: number): LatLngLiteral {
  const segments = outline.slice(1).map((point, index) => ({
    start: outline[index],
    end: point,
    distance: distanceBetweenTrackPoints(outline[index], point),
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

function bearingBetweenTrackPoints(start: TrackPoint, end: TrackPoint) {
  const startLat = start.lat * (Math.PI / 180);
  const endLat = end.lat * (Math.PI / 180);
  const deltaLng = (end.lng - start.lng) * (Math.PI / 180);
  const y = Math.sin(deltaLng) * Math.cos(endLat);
  const x = Math.cos(startLat) * Math.sin(endLat)
    - Math.sin(startLat) * Math.cos(endLat) * Math.cos(deltaLng);

  return ((Math.atan2(y, x) * (180 / Math.PI)) + 360) % 360;
}

export function zonePolyline(track: TrackRecord, zone: TrackZone) {
  const route = mappedTrackRoute(track);
  if (route.length < 2) {
    return [];
  }

  return Array.from({ length: 24 }, (_, index) => {
    const t = index / 23;
    const meter = zone.startMeter + (zone.endMeter - zone.startMeter) * t;
    return pointAtProgress(route, meter / track.lengthMeters);
  });
}

export function riderLatLng(track: TrackRecord, distanceMeters: number) {
  const route = mappedTrackRoute(track);
  if (route.length < 2) {
    return null;
  }

  return pointAtProgress(route, distanceMeters / track.lengthMeters);
}

export function riderRoutePose(track: TrackRecord, distanceMeters: number) {
  const route = mappedTrackRoute(track);
  if (route.length < 2) {
    return null;
  }

  const target = Math.max(0, Math.min(track.lengthMeters, distanceMeters));
  let traveled = 0;

  for (let index = 1; index < route.length; index += 1) {
    const start = route[index - 1];
    const end = route[index];
    const segmentDistance = distanceBetweenTrackPoints(start, end);

    if (traveled + segmentDistance >= target || index === route.length - 1) {
      const progress = segmentDistance <= 0 ? 0 : Math.max(0, Math.min(1, (target - traveled) / segmentDistance));
      return {
        bearing: bearingBetweenTrackPoints(start, end),
        position: {
          lat: start.lat + (end.lat - start.lat) * progress,
          lng: start.lng + (end.lng - start.lng) * progress,
        },
      };
    }

    traveled += segmentDistance;
  }

  return {
    bearing: bearingBetweenTrackPoints(route[route.length - 2], route[route.length - 1]),
    position: route[route.length - 1],
  };
}

export function pathLengthMeters(points: TrackPoint[], google?: GoogleMapsRuntime | null) {
  if (points.length < 2) {
    return 0;
  }

  const googleLength = google?.maps.geometry?.spherical?.computeLength(points);
  if (typeof googleLength === 'number' && Number.isFinite(googleLength)) {
    return googleLength;
  }

  return points.slice(1).reduce(
    (total, point, index) => total + distanceBetweenTrackPoints(points[index], point),
    0,
  );
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
