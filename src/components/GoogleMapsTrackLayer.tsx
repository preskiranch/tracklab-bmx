import { useEffect, useRef, useState } from 'react';
import type { BikeSample, PlayerSlot, RiderState, SpeedUnit, TrackPoint, TrackRecord, TrackZone } from '../types';
import { formatSpeedFromKph, speedUnitLabel } from '../units';
import {
  loadGoogleMaps,
  riderLatLng,
  trackBoundsPoints,
  trackCenter,
  trackRoute,
  type GoogleMap,
  type GoogleMarker,
  type GoogleMapsEventListener,
  type GooglePolyline,
  type GoogleMapsRuntime,
  zonePolyline,
} from '../lib/googleMaps';

type GoogleMapsTrackLayerProps = {
  track: TrackRecord;
  activeZones: TrackZone[];
  riders: RiderState[];
  players: PlayerSlot[];
  samplesByDevice: Map<number, BikeSample>;
  speedUnit: SpeedUnit;
  earthAngle: number;
  mappingMode?: boolean;
  draftPoints?: TrackPoint[];
  onMappingPointAdd?: (point: TrackPoint) => void;
};

const zoneColors: Record<TrackZone['type'], string> = {
  pedal: '#4ade80',
  recovery: '#facc15',
  technical: '#38bdf8',
};

export function GoogleMapsTrackLayer({
  track,
  activeZones,
  riders,
  players,
  samplesByDevice,
  speedUnit,
  earthAngle,
  mappingMode = false,
  draftPoints = [],
  onMappingPointAdd,
}: GoogleMapsTrackLayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const googleRef = useRef<GoogleMapsRuntime | null>(null);
  const mapRef = useRef<GoogleMap | null>(null);
  const boundaryLineRef = useRef<GooglePolyline | null>(null);
  const trackLineRef = useRef<GooglePolyline | null>(null);
  const zoneLinesRef = useRef<GooglePolyline[]>([]);
  const draftLineRef = useRef<GooglePolyline | null>(null);
  const draftMarkerRefs = useRef<GoogleMarker[]>([]);
  const mapClickListenerRef = useRef<GoogleMapsEventListener | null>(null);
  const markerRefs = useRef<Map<number, GoogleMarker>>(new Map());
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    loadGoogleMaps()
      .then((google) => {
        if (cancelled || !containerRef.current) {
          return;
        }

        googleRef.current = google;
        const center = trackCenter(track);
        const map = new google.maps.Map(containerRef.current, {
          center,
          clickableIcons: false,
          disableDefaultUI: true,
          gestureHandling: 'greedy',
          heading: 24,
          mapTypeId: 'satellite',
          rotateControl: false,
          streetViewControl: false,
          tilt: earthAngle,
          zoom: 19,
        });
        mapRef.current = map;
        setStatus('ready');
      })
      .catch((loadError: Error) => {
        if (!cancelled) {
          setStatus('error');
          setError(loadError.message);
        }
      });

    return () => {
      cancelled = true;
      boundaryLineRef.current?.setMap(null);
      trackLineRef.current?.setMap(null);
      zoneLinesRef.current.forEach((line) => line.setMap(null));
      draftLineRef.current?.setMap(null);
      draftMarkerRefs.current.forEach((marker) => marker.setMap(null));
      mapClickListenerRef.current?.remove();
      markerRefs.current.forEach((marker) => marker.setMap(null));
      boundaryLineRef.current = null;
      trackLineRef.current = null;
      zoneLinesRef.current = [];
      draftLineRef.current = null;
      draftMarkerRefs.current = [];
      mapClickListenerRef.current = null;
      markerRefs.current.clear();
      mapRef.current = null;
    };
  }, [track]);

  useEffect(() => {
    const google = googleRef.current;
    const map = mapRef.current;
    if (!google || !map) {
      return;
    }

    map.setTilt(Math.max(0, Math.min(67, earthAngle)));
    map.setHeading(24);
  }, [earthAngle]);

  useEffect(() => {
    const google = googleRef.current;
    const map = mapRef.current;
    if (!google || !map || status !== 'ready') {
      return;
    }

    boundaryLineRef.current?.setMap(null);
    trackLineRef.current?.setMap(null);
    zoneLinesRef.current.forEach((line) => line.setMap(null));
    zoneLinesRef.current = [];

    const bounds = new google.maps.LatLngBounds();
    trackBoundsPoints(track).forEach((point) => bounds.extend(point));
    map.fitBounds(bounds, 58);

    boundaryLineRef.current = new google.maps.Polyline({
      map,
      path: track.outline,
      strokeColor: '#ffffff',
      strokeOpacity: 0.48,
      strokeWeight: 3,
    });

    trackLineRef.current = new google.maps.Polyline({
      map,
      path: trackRoute(track),
      strokeColor: '#ffffff',
      strokeOpacity: 0.96,
      strokeWeight: 8,
    });

    zoneLinesRef.current = activeZones.map((zone) => new google.maps.Polyline({
      map,
      path: zonePolyline(track, zone),
      strokeColor: zoneColors[zone.type],
      strokeOpacity: 0.92,
      strokeWeight: 6,
    }));
  }, [activeZones, status, track]);

  useEffect(() => {
    const google = googleRef.current;
    const map = mapRef.current;
    if (!google || !map || status !== 'ready') {
      return;
    }

    draftLineRef.current?.setMap(null);
    draftMarkerRefs.current.forEach((marker) => marker.setMap(null));
    draftMarkerRefs.current = [];

    if (!mappingMode || draftPoints.length === 0) {
      draftLineRef.current = null;
      return;
    }

    if (draftPoints.length > 1) {
      draftLineRef.current = new google.maps.Polyline({
        map,
        path: draftPoints,
        strokeColor: '#d8ff3e',
        strokeOpacity: 0.96,
        strokeWeight: 5,
      });
    }

    draftMarkerRefs.current = draftPoints.map((point, index) => new google.maps.Marker({
      icon: {
        fillColor: '#d8ff3e',
        fillOpacity: 1,
        path: google.maps.SymbolPath.CIRCLE,
        scale: 10,
        strokeColor: '#111827',
        strokeWeight: 2,
      },
      label: {
        color: '#111827',
        fontSize: '11px',
        fontWeight: '900',
        text: String(index + 1),
      },
      map,
      optimized: true,
      position: point,
      title: `Mapping pin ${index + 1}`,
    }));
  }, [draftPoints, mappingMode, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') {
      return undefined;
    }

    mapClickListenerRef.current?.remove();
    mapClickListenerRef.current = null;

    if (!mappingMode || !onMappingPointAdd) {
      return undefined;
    }

    mapClickListenerRef.current = map.addListener('click', (event) => {
      const point = event.latLng?.toJSON();
      if (point) {
        onMappingPointAdd(point);
      }
    });

    return () => {
      mapClickListenerRef.current?.remove();
      mapClickListenerRef.current = null;
    };
  }, [mappingMode, onMappingPointAdd, status]);

  useEffect(() => {
    const google = googleRef.current;
    const map = mapRef.current;
    if (!google || !map || status !== 'ready') {
      return;
    }

    const activePlayerIds = new Set(players.map((player) => player.id));
    markerRefs.current.forEach((marker, playerId) => {
      if (!activePlayerIds.has(playerId as PlayerSlot['id'])) {
        marker.setMap(null);
        markerRefs.current.delete(playerId);
      }
    });

    riders.forEach((rider) => {
      const player = players.find((slot) => slot.id === rider.playerId);
      if (!player) {
        return;
      }

      const sample = player.deviceId == null ? undefined : samplesByDevice.get(player.deviceId);
      const position = riderLatLng(track, rider.distance);
      const label = `${formatSpeedFromKph(sample?.speedKph, speedUnit)} ${speedUnitLabel(speedUnit)}`;
      const existing = markerRefs.current.get(player.id);

      if (existing) {
        existing.setPosition(position);
        return;
      }

      const marker = new google.maps.Marker({
        icon: {
          fillColor: player.accent,
          fillOpacity: 1,
          path: google.maps.SymbolPath.CIRCLE,
          scale: 12,
          strokeColor: '#ffffff',
          strokeWeight: 3,
        },
        label: {
          color: '#111827',
          fontSize: '12px',
          fontWeight: '900',
          text: `P${player.id}`,
        },
        map,
        optimized: true,
        position,
        title: `${player.name} / ${label}`,
      });
      markerRefs.current.set(player.id, marker);
    });
  }, [players, riders, samplesByDevice, speedUnit, status, track]);

  return (
    <>
      <div className="google-map-layer" ref={containerRef} />
      {status !== 'ready' && (
        <div className="google-map-status">
          <strong>{status === 'loading' ? 'Loading Google imagery' : 'Google imagery unavailable'}</strong>
          <span>{status === 'loading' ? 'Connecting to Google Maps satellite layer.' : error}</span>
        </div>
      )}
    </>
  );
}
