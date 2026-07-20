import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, RotateCcw } from 'lucide-react';
import type { EarthCamera, TrackPoint, TrackRecord, TrackZone } from '../types';
import {
  loadGoogleMaps3DLibrary,
  mappedTrackRoute,
  trackBoundsPoints,
  trackCenter,
  zonePolyline,
  type GoogleMap3DElement,
  type GoogleMaps3DLibrary,
} from '../lib/googleMaps';
import { elevatedPath, previewRangeMeters } from '../lib/googleMaps3d';

type GoogleMaps3DTrackLayerProps = {
  track: TrackRecord;
  activeZones: TrackZone[];
  earthAngle: number;
  earthHeading: number;
  onEarthCameraChange?: (camera: Partial<EarthCamera>) => void;
  onUseSatellite: () => void;
};

type PreviewState = 'loading' | 'ready' | 'error';

function appendPolyline(
  map: GoogleMap3DElement,
  Polyline3DElement: GoogleMaps3DLibrary['Polyline3DElement'],
  path: TrackPoint[],
  options: Record<string, unknown>,
) {
  if (path.length < 2) {
    return;
  }

  map.append(new Polyline3DElement({
    altitudeMode: 'RELATIVE_TO_GROUND',
    drawsOccludedSegments: true,
    path: elevatedPath(path),
    ...options,
  }));
}

export function GoogleMaps3DTrackLayer({
  track,
  activeZones,
  earthAngle,
  earthHeading,
  onEarthCameraChange,
  onUseSatellite,
}: GoogleMaps3DTrackLayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GoogleMap3DElement | null>(null);
  const cameraStateRef = useRef({ angle: earthAngle, heading: earthHeading });
  const cameraChangeRef = useRef(onEarthCameraChange);
  const [previewState, setPreviewState] = useState<PreviewState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const route = useMemo(() => mappedTrackRoute(track), [track]);
  const center = useMemo(() => trackCenter(track), [track]);
  const boundsPoints = useMemo(() => trackBoundsPoints(track), [track]);
  const range = useMemo(
    () => previewRangeMeters(boundsPoints.length > 0 ? boundsPoints : route, center),
    [boundsPoints, center, route],
  );
  cameraStateRef.current = { angle: earthAngle, heading: earthHeading };
  cameraChangeRef.current = onEarthCameraChange;

  useEffect(() => {
    let cancelled = false;
    let cameraTimer = 0;
    let mountedMap: GoogleMap3DElement | null = null;
    const cameraListeners: Array<{ name: string; listener: EventListener }> = [];

    setPreviewState('loading');
    setErrorMessage('');

    loadGoogleMaps3DLibrary()
      .then(({ Map3DElement, Polyline3DElement }) => {
        if (cancelled || !containerRef.current) {
          return;
        }

        const initialCamera = cameraStateRef.current;
        const map = new Map3DElement({
          center: { ...center, altitude: 0 },
          heading: initialCamera.heading,
          mode: 'SATELLITE',
          range,
          tilt: initialCamera.angle,
        });
        map.style.width = '100%';
        map.style.height = '100%';
        map.style.display = 'block';

        appendPolyline(map, Polyline3DElement, route, {
          outerColor: '#111827',
          outerWidth: 0.45,
          strokeColor: '#d8ff3e',
          strokeWidth: 7,
        });

        activeZones
          .filter((zone) => zone.type === 'pedal')
          .forEach((zone) => {
            appendPolyline(map, Polyline3DElement, zonePolyline(track, zone), {
              outerColor: '#052e16',
              outerWidth: 0.3,
              strokeColor: '#4ade80',
              strokeWidth: 10,
            });
          });

        (track.splitSections ?? []).forEach((section) => {
          section.branches.forEach((branch) => {
            appendPolyline(map, Polyline3DElement, branch.points, {
              outerColor: '#111827',
              outerWidth: 0.35,
              strokeColor: branch.id === 'a' ? '#ff2d55' : '#38bdf8',
              strokeWidth: 7,
            });
          });
        });

        const saveCamera = () => {
          if (!cameraChangeRef.current) {
            return;
          }

          window.clearTimeout(cameraTimer);
          cameraTimer = window.setTimeout(() => {
            const nextCenter = map.center;
            const fallbackCamera = cameraStateRef.current;
            cameraChangeRef.current?.({
              angle: Math.round(map.tilt ?? fallbackCamera.angle),
              center: nextCenter ? { lat: nextCenter.lat, lng: nextCenter.lng } : center,
              heading: Math.round(map.heading ?? fallbackCamera.heading),
            });
          }, 180);
        };

        ['gmp-centerchange', 'gmp-headingchange', 'gmp-tiltchange'].forEach((name) => {
          const listener: EventListener = () => saveCamera();
          map.addEventListener(name, listener);
          cameraListeners.push({ name, listener });
        });

        containerRef.current.replaceChildren(map);
        mountedMap = map;
        mapRef.current = map;
        setPreviewState('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        setPreviewState('error');
        setErrorMessage(error instanceof Error ? error.message : 'The 3D preview could not be loaded.');
      });

    return () => {
      cancelled = true;
      window.clearTimeout(cameraTimer);
      cameraListeners.forEach(({ name, listener }) => mountedMap?.removeEventListener(name, listener));
      if (mapRef.current === mountedMap) {
        mapRef.current = null;
      }
      containerRef.current?.replaceChildren();
    };
  }, [activeZones, center, range, route, track]);

  useEffect(() => {
    if (!mapRef.current) {
      return;
    }

    mapRef.current.heading = earthHeading;
    mapRef.current.tilt = earthAngle;
  }, [earthAngle, earthHeading]);

  return (
    <div className="google-map-3d-shell">
      <div className="google-map-layer google-map-3d-layer" ref={containerRef} />
      {previewState === 'loading' && (
        <div className="google-map-status loading" role="status">
          <Box size={20} />
          <strong>Loading photorealistic 3D</strong>
          <span>Preparing terrain, buildings, and saved track overlays.</span>
        </div>
      )}
      {previewState === 'error' && (
        <div className="google-map-status error" role="alert">
          <Box size={20} />
          <strong>3D preview unavailable</strong>
          <span>{errorMessage}</span>
          <button type="button" onClick={onUseSatellite}>
            <RotateCcw size={15} />
            Use satellite view
          </button>
        </div>
      )}
    </div>
  );
}
