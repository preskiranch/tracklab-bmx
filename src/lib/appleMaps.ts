import type { TrackPoint } from '../types';

export type AppleMapKitAnnotation = {
  coordinate: TrackPoint;
};

export type AppleMapKitOverlay = object;

export type AppleMapKitMap = {
  addAnnotation: (annotation: AppleMapKitAnnotation) => void;
  addAnnotations: (annotations: AppleMapKitAnnotation[]) => void;
  addOverlay: (overlay: AppleMapKitOverlay) => void;
  cameraDistance: number;
  center: TrackPoint;
  destroy?: () => void;
  mapType: string;
  removeAnnotations?: (annotations: AppleMapKitAnnotation[]) => void;
  removeOverlays?: (overlays: AppleMapKitOverlay[]) => void;
  rotation: number;
  setCameraDistanceAnimated?: (distance: number, animated: boolean) => void;
  setCenterAnimated?: (coordinate: TrackPoint, animated: boolean) => void;
  showsPointsOfInterest: boolean;
};

export type AppleMapKitRuntime = {
  Map: new (container: HTMLElement, options?: Record<string, unknown>) => AppleMapKitMap;
  MapType: {
    Hybrid: string;
    Satellite: string;
  };
  MarkerAnnotation: new (
    coordinate: TrackPoint,
    options?: Record<string, unknown>,
  ) => AppleMapKitAnnotation;
  PolylineOverlay: new (
    coordinates: TrackPoint[],
    options?: Record<string, unknown>,
  ) => AppleMapKitOverlay;
  Style: new (options?: Record<string, unknown>) => object;
};

declare global {
  interface Window {
    mapkit?: AppleMapKitRuntime;
    __trackLabAppleMapKitPromise?: Promise<AppleMapKitRuntime>;
    [key: `__trackLabAppleMapKitReady_${string}`]: (() => void) | undefined;
  }
}

type AppleMapConfig = {
  configured?: boolean;
  token?: string | null;
};

async function fetchAppleMapToken() {
  const response = await fetch('/api/admin/apple-map-config', {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  const payload = await response.json().catch(() => ({})) as AppleMapConfig & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || 'Apple Satellite configuration could not be loaded.');
  }
  const token = typeof payload.token === 'string' ? payload.token.trim() : '';
  if (!payload.configured || !token) {
    throw new Error('Apple Satellite is not configured yet. Add the MapKit JS token in Render.');
  }
  return token;
}

export function loadAppleMapKit(): Promise<AppleMapKitRuntime> {
  if (window.mapkit?.Map) {
    return Promise.resolve(window.mapkit);
  }
  if (window.__trackLabAppleMapKitPromise) {
    return window.__trackLabAppleMapKitPromise;
  }

  window.__trackLabAppleMapKitPromise = fetchAppleMapToken()
    .then((token) => new Promise<AppleMapKitRuntime>((resolve, reject) => {
      const callbackName = `__trackLabAppleMapKitReady_${crypto.randomUUID().replaceAll('-', '')}` as const;
      const script = document.createElement('script');
      const cleanup = () => {
        delete window[callbackName];
      };
      window[callbackName] = () => {
        cleanup();
        if (window.mapkit?.Map) {
          resolve(window.mapkit);
        } else {
          reject(new Error('Apple Satellite loaded without the MapKit map library.'));
        }
      };
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.dataset.callback = callbackName;
      script.dataset.libraries = 'full-map';
      script.dataset.token = token;
      script.src = 'https://cdn.apple-mapkit.com/mk/x/mapkit.core.js';
      script.onerror = () => {
        cleanup();
        script.remove();
        reject(new Error('Apple Satellite could not load from the MapKit CDN.'));
      };
      document.head.append(script);
    }))
    .catch((error) => {
      delete window.__trackLabAppleMapKitPromise;
      throw error;
    });

  return window.__trackLabAppleMapKitPromise;
}
