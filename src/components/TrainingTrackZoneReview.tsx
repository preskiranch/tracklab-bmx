import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { DistanceUnit, SpeedUnit, TrackPoint, TrainingSession } from '../types';
import { formatDistanceRangeMeters, formatSpeedFromKph, speedUnitLabel } from '../units';
import {
  hasGoogleMapsApiKey,
  loadGoogleMaps,
  type GoogleMap,
  type GoogleMapsRuntime,
  type GoogleMarker,
  type GooglePolyline,
} from '../lib/googleMaps';
import { trainingSessionRaceSummaries, trainingSessionZoneResults } from '../lib/trainingHistory';
import {
  buildTrainingTrackSchematic,
  loadTrainingTrackReview,
  trainingTrackReviewRouteSegments,
  trainingTrackReviewZonePolyline,
  type TrainingTrackReviewResult,
  type TrainingTrackReviewZone,
} from '../lib/trainingTrackReview';
import './TrainingTrackZoneReview.css';

export type TrainingTrackZoneReviewProps = {
  session: TrainingSession;
  distanceUnit: DistanceUnit;
  speedUnit: SpeedUnit;
  selectedZoneId?: string | null;
  onSelectedZoneChange?: (zoneId: string) => void;
  className?: string;
};

const colors = { pedal: '#65a30d', recovery: '#f97316', technical: '#0ea5e9' } as const;
const panel: CSSProperties = { border: '1px solid #d8e0e8', borderRadius: 14, background: '#fff', overflow: 'hidden' };
const mapFrame: CSSProperties = { position: 'relative', minHeight: 240, height: 'clamp(240px,32vw,360px)', background: '#0f172a', overflow: 'hidden' };
const fill: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%' };
const badge: CSSProperties = { position: 'absolute', left: 10, top: 10, zIndex: 3, margin: 0, padding: '5px 8px', borderRadius: 999, color: '#fff', background: 'rgba(15,23,42,.88)', fontSize: 11, fontWeight: 800 };
const tableCell: CSSProperties = { padding: '7px 8px', borderBottom: '1px solid #d8e0e8', whiteSpace: 'nowrap', fontSize: 12, textAlign: 'right' };

function zoneTypeLabel(zone: TrainingTrackReviewZone) {
  return zone.type === 'technical' ? 'Technical' : zone.type === 'recovery' ? 'Recovery' : 'Pedal';
}

function zoneButtonStyle(zone: TrainingTrackReviewZone, selected: boolean): CSSProperties {
  return {
    minHeight: 44, minWidth: 150, padding: '5px 7px', borderRadius: 8, border: selected ? '2px solid #111827' : '1px solid #d8e0e8',
    borderLeft: `6px solid ${colors[zone.type]}`, background: selected ? '#f1f8e9' : '#fff', color: '#111827', textAlign: 'left', cursor: 'pointer',
  };
}

function elapsed(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? '—' : `${(Math.max(0, value) / 1_000).toFixed(2)}s`;
}

function pairedMetric(average: number | null | undefined, peak: number | null | undefined, suffix: string, precision = 0) {
  const format = (value: number | null | undefined) => value == null || !Number.isFinite(value)
    ? '—'
    : value.toLocaleString(undefined, { minimumFractionDigits: precision, maximumFractionDigits: precision });
  return `${format(average)} / ${format(peak)} ${suffix}`;
}

export function refitTrainingTrackReviewMap(
  google: GoogleMapsRuntime,
  map: GoogleMap,
  points: readonly TrackPoint[],
  padding = 34,
) {
  const safePoints = points.filter((point) => Number.isFinite(point.lat)
    && Number.isFinite(point.lng)
    && Math.abs(point.lat) <= 90
    && Math.abs(point.lng) <= 180);
  if (safePoints.length < 2) return false;
  google.maps.event?.trigger(map, 'resize');
  const bounds = new google.maps.LatLngBounds();
  safePoints.forEach((point) => bounds.extend(point));
  map.fitBounds(bounds, padding);
  return true;
}

function mapLabel(review: TrainingTrackReviewResult, selected: TrainingTrackReviewZone | undefined) {
  const trackName = review.track?.name ?? 'saved track';
  if (review.status !== 'ready') {
    return `${trackName} geometry unavailable; ${review.zones.length} saved zone rows remain in the table`;
  }
  if (selected && !selected.placeable) {
    return `${trackName} current route; zone ${selected.number}, ${selected.name}, cannot be placed from this historical result`;
  }
  return selected
    ? `${trackName} current route with zone ${selected.number}, ${selected.name}, highlighted`
    : `${trackName} current route with ${review.zones.filter((zone) => zone.placeable).length} placed recorded zones`;
}

function Schematic({
  review,
  selectedId,
}: {
  review: TrainingTrackReviewResult;
  selectedId: string | null;
}) {
  const schematic = useMemo(() => review.status === 'ready' && review.track
    ? buildTrainingTrackSchematic(review.track, review.zones)
    : null, [review]);
  if (!schematic) {
    return (
      <div style={{ ...fill, display: 'grid', placeItems: 'center', padding: 24, color: '#e2e8f0', textAlign: 'center' }} role="img" aria-label="Track geometry unavailable">
        <p style={{ margin: 0, maxWidth: 380 }}>Track image unavailable for this historical session. Saved zone rows are still shown.</p>
      </div>
    );
  }
  return (
    <svg viewBox="0 0 640 360" preserveAspectRatio="xMidYMid meet" style={fill} role="img" aria-label={mapLabel(review, review.zones.find((zone) => zone.id === selectedId))}>
      <title>Current track route schematic with recorded race zones</title>
      <rect width="640" height="360" fill="#0f172a" />
      {schematic.routePaths.map((path, index) => <path key={`r-${index}`} d={path} fill="none" stroke="#cbd5e1" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" opacity=".7" />)}
      {schematic.zones.map((zone) => {
        const selected = zone.id === selectedId;
        return <path key={zone.id} d={zone.path} fill="none" stroke={selected ? '#d8ff3e' : colors[zone.type]} strokeWidth={selected ? 13 : 8} strokeLinecap="round" strokeLinejoin="round" opacity={selected ? 1 : .78} />;
      })}
      {schematic.zones.map((zone) => {
        const selected = zone.id === selectedId;
        return (
          <g key={`n-${zone.id}`} transform={`translate(${zone.labelX} ${zone.labelY})`}>
            <circle r={selected ? 17 : 14} fill={selected ? '#d8ff3e' : '#fff'} stroke="#111827" strokeWidth="3" />
            <text textAnchor="middle" dominantBaseline="central" fill="#111827" fontSize="13" fontWeight="900">{zone.number}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function TrainingTrackZoneReview({
  session,
  distanceUnit,
  speedUnit,
  selectedZoneId,
  onSelectedZoneChange,
  className = '',
}: TrainingTrackZoneReviewProps) {
  const recordedZones = useMemo(() => trainingSessionZoneResults(session), [session]);
  const raceSummaries = useMemo(() => trainingSessionRaceSummaries(session), [session]);
  const details = session.details as { routeVariantId?: unknown; lapCount?: unknown };
  const routeVariantId = typeof details.routeVariantId === 'string' ? details.routeVariantId : null;
  const lapCount = Number(details.lapCount) || 1;
  const reviewKey = `${session.id}:${session.updatedAt}:${session.trackId ?? ''}:${routeVariantId ?? ''}:${lapCount}`;
  const [reviewState, setReviewState] = useState<{ key: string; value: TrainingTrackReviewResult } | null>(null);
  const review = reviewState?.key === reviewKey ? reviewState.value : null;
  const [loadError, setLoadError] = useState('');
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);
  const [satelliteState, setSatelliteState] = useState<'schematic' | 'loading' | 'ready'>('schematic');
  const mapHostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GoogleMap | null>(null);
  const mapsRuntimeRef = useRef<GoogleMapsRuntime | null>(null);
  const mapBoundsPointsRef = useRef<TrackPoint[]>([]);
  const fitKeyRef = useRef('');
  const overlaysRef = useRef<Array<GoogleMarker | GooglePolyline>>([]);
  const uncontrolledSelection = selectedZoneId === undefined;
  const effectiveSelectedId = selectedZoneId === undefined ? internalSelectedId : selectedZoneId;

  useEffect(() => {
    let disposed = false;
    overlaysRef.current.splice(0).forEach((overlay) => overlay.setMap(null));
    mapRef.current = null;
    mapsRuntimeRef.current = null;
    mapBoundsPointsRef.current = [];
    fitKeyRef.current = '';
    setSatelliteState('schematic');
    setReviewState(null);
    setLoadError('');
    void loadTrainingTrackReview({
      trackId: session.trackId,
      routeVariantId,
      lapCount,
      zones: recordedZones,
    }).then((next) => {
      if (disposed) return;
      setReviewState({ key: reviewKey, value: next });
      if (uncontrolledSelection) {
        setInternalSelectedId((current) => next.zones.some((zone) => zone.id === current) ? current : next.zones[0]?.id ?? null);
      }
    }).catch(() => {
      if (!disposed) setLoadError('Track review is temporarily unavailable. Your saved result data is unchanged.');
    });
    return () => { disposed = true; };
  }, [lapCount, recordedZones, reviewKey, routeVariantId, session.trackId, uncontrolledSelection]);

  useEffect(() => {
    const overlays = overlaysRef.current;
    overlays.splice(0).forEach((overlay) => overlay.setMap(null));
    if (!review?.track || review.status !== 'ready' || !mapHostRef.current || !hasGoogleMapsApiKey()) {
      setSatelliteState('schematic');
      return undefined;
    }
    let disposed = false;
    const onAuthFailure = () => { if (!disposed) setSatelliteState('schematic'); };
    window.addEventListener('tracklab-google-maps-auth-failure', onAuthFailure);
    if (!mapRef.current) setSatelliteState('loading');
    void loadGoogleMaps().then((google) => {
      if (disposed || !mapHostRef.current || !review.track) return;
      const map = mapRef.current ?? new google.maps.Map(mapHostRef.current, {
        mapTypeId: 'satellite', disableDefaultUI: true, zoomControl: true, clickableIcons: false,
        gestureHandling: 'cooperative', keyboardShortcuts: true, tilt: 0, heading: 0,
      });
      mapRef.current = map;
      mapsRuntimeRef.current = google;
      const routePaths = [
        ...trainingTrackReviewRouteSegments(review.track),
        ...(review.track.splitSections ?? []).flatMap((section) => section.branches.map((branch) => branch.points)),
      ];
      mapBoundsPointsRef.current = routePaths.flat();
      routePaths.filter((path) => path.length > 1).forEach((path) => {
        overlays.push(new google.maps.Polyline({ map, path, clickable: false, strokeColor: '#f8fafc', strokeOpacity: .72, strokeWeight: 6, zIndex: 100 }));
      });
      review.zones.forEach((zone) => {
        const selected = zone.id === effectiveSelectedId;
        const path = trainingTrackReviewZonePolyline(review.track!, zone);
        if (path.length < 2) return;
        overlays.push(new google.maps.Polyline({
          map, path, clickable: false, strokeColor: selected ? '#d8ff3e' : colors[zone.type],
          strokeOpacity: selected ? 1 : .78, strokeWeight: selected ? 12 : 7, zIndex: selected ? 500 : 300,
        }));
        const position = path[Math.floor(path.length / 2)];
        overlays.push(new google.maps.Marker({
          map, position, title: `Zone ${zone.number}: ${zone.name}`, zIndex: selected ? 2_000 : 600 + zone.number,
          icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: selected ? '#d8ff3e' : '#fff', fillOpacity: 1, scale: selected ? 16 : 13, strokeColor: '#111827', strokeWeight: 3 },
          label: { text: String(zone.number), color: '#111827', fontSize: '12px', fontWeight: '900' },
        }));
      });
      if (fitKeyRef.current !== `${session.id}:${review.track.id}`) {
        refitTrainingTrackReviewMap(google, map, mapBoundsPointsRef.current);
        fitKeyRef.current = `${session.id}:${review.track.id}`;
      } else {
        google.maps.event?.trigger(map, 'resize');
      }
      setSatelliteState('ready');
    }).catch(() => { if (!disposed) setSatelliteState('schematic'); });
    return () => {
      disposed = true;
      window.removeEventListener('tracklab-google-maps-auth-failure', onAuthFailure);
      overlays.splice(0).forEach((overlay) => overlay.setMap(null));
    };
  }, [effectiveSelectedId, review, session.id]);

  useEffect(() => {
    if (satelliteState !== 'ready' || !mapHostRef.current) return undefined;
    let frame: number | null = null;
    const timers: number[] = [];
    const refit = () => {
      if (frame != null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = null;
        const google = mapsRuntimeRef.current;
        const map = mapRef.current;
        if (google && map) refitTrainingTrackReviewMap(google, map, mapBoundsPointsRef.current);
      });
    };
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(refit);
    if (observer) observer.observe(mapHostRef.current);
    else window.addEventListener('resize', refit);
    window.addEventListener('orientationchange', refit);
    timers.push(window.setTimeout(refit, 120), window.setTimeout(refit, 420));
    return () => {
      observer?.disconnect();
      if (!observer) window.removeEventListener('resize', refit);
      window.removeEventListener('orientationchange', refit);
      if (frame != null) window.cancelAnimationFrame(frame);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [reviewKey, satelliteState]);

  useEffect(() => () => {
    overlaysRef.current.splice(0).forEach((overlay) => overlay.setMap(null));
    mapRef.current = null;
    mapsRuntimeRef.current = null;
    mapBoundsPointsRef.current = [];
  }, []);

  if (loadError) return <p role="alert" style={{ margin: 0, padding: 12, borderRadius: 10, background: '#fff4e5', color: '#7c2d12' }}>{loadError}</p>;
  if (!review) return <p role="status" style={{ margin: 0, padding: 12, color: '#64748b' }}>Loading track and zone review…</p>;

  const selected = review.zones.find((zone) => zone.id === effectiveSelectedId);
  const riderNames = new Map(raceSummaries.map((summary) => [String(summary.playerId), summary.riderName?.trim() || `Rider ${summary.playerId}`]));
  const chooseZone = (zoneId: string) => {
    if (uncontrolledSelection) setInternalSelectedId(zoneId);
    onSelectedZoneChange?.(zoneId);
  };
  const satelliteVisible = satelliteState === 'ready';
  return (
    <section className={`training-zone-review ${className}`.trim()} aria-label={`Track and zone review for ${session.trackName ?? session.title}`} style={panel}>
      <header style={{ padding: '10px 12px', borderBottom: '1px solid #d8e0e8' }}>
        <strong style={{ display: 'block', color: '#111827' }}>Track + zone review</strong>
        <small style={{ color: '#64748b' }}>{review.track?.name ?? session.trackName ?? 'Historical track'}</small>
      </header>
      <div className="training-zone-review__layout" style={{ padding: 12 }}>
        <figure style={{ margin: 0, minWidth: 0 }} aria-label={mapLabel(review, selected)}>
          <div className="training-zone-review__map" style={mapFrame}>
            <div aria-hidden={satelliteVisible}><Schematic review={review} selectedId={effectiveSelectedId ?? null} /></div>
            <div key={reviewKey} ref={mapHostRef} style={{ ...fill, opacity: satelliteVisible ? 1 : 0, zIndex: satelliteVisible ? 2 : 0, pointerEvents: satelliteVisible ? 'auto' : 'none' }} aria-hidden={!satelliteVisible} />
            <p style={badge}>{satelliteVisible
              ? 'Satellite map · current route'
              : satelliteState === 'loading'
                ? 'Loading satellite map…'
                : review.status === 'ready' ? 'Current route schematic' : 'Track geometry unavailable'}</p>
          </div>
          <figcaption style={{ paddingTop: 7, color: '#64748b', fontSize: 12 }}>{review.note}</figcaption>
        </figure>
        <div role="region" tabIndex={0} aria-label="Recorded track zone spreadsheet" style={{ maxHeight: 360, overflow: 'auto', border: '1px solid #d8e0e8', borderRadius: 10 }}>
          {review.zones.length > 0 ? (
            <table style={{ borderCollapse: 'separate', borderSpacing: 0, minWidth: 980, width: '100%', fontVariantNumeric: 'tabular-nums' }}>
              <caption style={{ padding: 8, textAlign: 'left', fontWeight: 800, color: '#111827' }}>Recorded zone data · select a zone to review it on the map when current geometry supports placement</caption>
              <thead>
                <tr>{['Zone', 'Type / saved range', 'Rider', 'Entry', 'Exit', 'Zone time', 'Points', `Avg / peak ${speedUnitLabel(speedUnit)}`, 'Avg / peak cadence', 'Avg / peak power'].map((label) => (
                  <th key={label} scope="col" style={{ ...tableCell, position: 'sticky', top: 0, zIndex: 2, background: '#eef2f7', color: '#475569', fontWeight: 800 }}>{label}</th>
                ))}</tr>
              </thead>
              <tbody>
                {review.zones.flatMap((zone) => {
                  const recorded = recordedZones[zone.sourceIndex];
                  const riders = recorded?.riders.length ? recorded.riders : [null];
                  return riders.map((rider, riderIndex) => {
                    const active = zone.id === effectiveSelectedId;
                    const speedAverage = rider?.averageSpeedKph == null ? null : `${formatSpeedFromKph(rider.averageSpeedKph, speedUnit)}`;
                    const speedPeak = rider?.topSpeedKph == null ? null : `${formatSpeedFromKph(rider.topSpeedKph, speedUnit)}`;
                    return (
                      <tr key={`${zone.id}:${rider?.playerId ?? riderIndex}`} style={{ background: active ? '#f7fee7' : '#fff' }}>
                        <th scope="row" style={{ ...tableCell, textAlign: 'left', position: 'sticky', left: 0, zIndex: 1, background: active ? '#f7fee7' : '#fff' }}>
                          <button type="button" aria-pressed={active} aria-label={`Zone ${zone.number}: ${zone.name}${zone.placeable ? '' : '. Saved data only; not placed on the current route.'}`} onClick={() => chooseZone(zone.id)} style={zoneButtonStyle(zone, active)}>
                            <strong>{zone.number}. {zone.name}</strong>
                          </button>
                        </th>
                        <td style={{ ...tableCell, textAlign: 'left', whiteSpace: 'normal', minWidth: 210 }}>
                          {zoneTypeLabel(zone)} · {formatDistanceRangeMeters(zone.recordedStartMeter, zone.recordedEndMeter, distanceUnit)}
                          {!zone.placeable && <small style={{ display: 'block', marginTop: 2, color: '#9a3412' }}>Not placed · {zone.placementNote}</small>}
                        </td>
                        <td style={{ ...tableCell, textAlign: 'left' }}>{rider ? riderNames.get(String(rider.playerId)) ?? `Rider ${rider.playerId}` : '—'}</td>
                        <td style={tableCell}>{elapsed(rider?.entryElapsedMs)}</td>
                        <td style={tableCell}>{elapsed(rider?.exitElapsedMs)}</td>
                        <td style={tableCell}>{elapsed(rider?.durationMs)}</td>
                        <td style={tableCell}>{rider?.sampleCount?.toLocaleString() ?? '—'}</td>
                        <td style={tableCell}>{`${speedAverage ?? '—'} / ${speedPeak ?? '—'} ${speedUnitLabel(speedUnit)}`}</td>
                        <td style={tableCell}>{pairedMetric(rider?.averageCadence, rider?.topCadence, 'rpm', 1)}</td>
                        <td style={tableCell}>{pairedMetric(rider?.averageWatts, rider?.topWatts, 'W')}</td>
                      </tr>
                    );
                  });
                })}
              </tbody>
            </table>
          ) : <p style={{ margin: 0, padding: 12, color: '#64748b' }}>No zone samples were saved for this session.</p>}
        </div>
      </div>
    </section>
  );
}

export default TrainingTrackZoneReview;
