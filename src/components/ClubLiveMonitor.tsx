import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Bike,
  Clock3,
  Compass,
  Gauge,
  Maximize2,
  Minimize2,
  RadioTower,
  RefreshCw,
  Route,
  Signal,
  Tablet,
  Users,
  Wifi,
  WifiOff,
  X,
  Zap,
} from 'lucide-react';
import {
  activeClubLiveSessions,
  ClubLiveRequestError,
  loadClubLiveSessions,
  type ClubLiveSession,
} from '../lib/clubLive';
import {
  clubLiveCanonicalSelections,
  selectClubLivePresentations,
  type ClubLiveCanonicalSelections,
  type ClubLivePresentation,
} from '../lib/clubLivePresentation';
import {
  ClubLiveVideoViewer,
  type ClubLiveVideoFrame,
  type ClubLiveVideoPublisher,
} from '../lib/clubLiveVideo';
import { loadClubTabletDevices, type ClubTabletDevice } from '../lib/clubTablet';
import { wattbikeMonitorLastThree } from '../lib/bikeProfileIdentity';
import { RiderAvatar } from './RiderAvatar';
import { PullSledScene } from './PullSledScene';
import { ClubEventConsole, type ClubEventCourseOption } from './ClubEventConsole';
import {
  formatDistanceMeters,
  formatExploreDistanceMeters,
  formatSpeedFromKph,
  speedUnitLabel,
} from '../units';
import type { DistanceUnit, SpeedUnit, StudioRider } from '../types';
import './ClubLiveMonitor.css';

type ClubLiveMonitorProps = {
  studioRiders: StudioRider[];
  speedUnit: SpeedUnit;
  distanceUnit: DistanceUnit;
  raceTracks?: readonly ClubEventCourseOption[];
  sprintRoutes?: readonly ClubEventCourseOption[];
  raceViewsReady?: boolean;
  fullscreen?: boolean;
  onFullscreenChange?: (enabled: boolean) => void;
};

type ClubLiveFrame = {
  id: string;
  clubId: string;
  studioRiderId: string;
  riderName: string;
  sessionId: string;
  activityType: ClubLiveSession['activityType'];
  contentType: 'image/jpeg';
  jpegDataUrl: `data:image/jpeg;base64,${string}`;
  width: number;
  height: number;
  capturedAt: number;
  updatedAt: number;
  expiresAt: number;
  byteLength: number;
  deviceId?: string;
};

type ClubLiveStreamMedia = ClubLiveVideoFrame & {
  id: string;
  kind: 'stream';
  updatedAt: number;
  expiresAt: number;
};

type ClubLiveDisplayMedia = ClubLiveFrame | ClubLiveStreamMedia;

function isClubLiveStreamMedia(media: ClubLiveDisplayMedia): media is ClubLiveStreamMedia {
  return 'kind' in media && media.kind === 'stream';
}

export function clubLiveVideoPublisherMatchesSession(
  publisher: ClubLiveVideoPublisher,
  session: ClubLiveSession,
) {
  return publisher.clubId === session.clubId
    && publisher.studioRiderId === session.studioRiderId
    && publisher.sessionId === session.sessionId
    && (!session.deviceId || publisher.deviceId === session.deviceId);
}

export function clubLiveSessionWithPublisherPresentation(
  session: ClubLiveSession,
  publisher: ClubLiveVideoPublisher | null | undefined,
): ClubLiveSession {
  if (!publisher || !clubLiveVideoPublisherMatchesSession(publisher, session)) return session;
  return {
    ...session,
    ...(publisher.sharedViewId ? { sharedViewId: publisher.sharedViewId } : {}),
    ...(publisher.presentation ? { presentation: publisher.presentation } : {}),
  };
}

export function clubLiveVideoPublisherIdsForPresentations(
  presentations: readonly ClubLivePresentation<unknown>[],
  publishers: readonly ClubLiveVideoPublisher[],
  standbyProbeIndex = 0,
) {
  const ids = new Set<string>();
  presentations.forEach((presentation) => {
    const publisherForSource = ({ session }: (typeof presentation.sources)[number]) => (
      publishers.find((candidate) => (
        clubLiveVideoPublisherMatchesSession(candidate, session)
      ))
    );
    const canonicalPublisher = publisherForSource(presentation.canonicalSource);
    if (canonicalPublisher) ids.add(canonicalPublisher.id);
    if (presentation.kind !== 'shared') return;
    const standbys = presentation.sources
      .filter(({ id }) => id !== presentation.canonicalSource.id)
      .map(publisherForSource)
      .filter((publisher): publisher is ClubLiveVideoPublisher => Boolean(publisher));
    if (standbys.length > 0) {
      const index = Math.abs(Math.trunc(standbyProbeIndex)) % standbys.length;
      ids.add(standbys[index].id);
    }
  });
  return [...ids].slice(0, 4);
}

function clubLiveStreamIsLive(frame: ClubLiveVideoFrame) {
  return frame.stream.getVideoTracks().some((track) => track.readyState === 'live');
}

function ClubLiveMediaView({
  media,
  label,
}: {
  media: ClubLiveDisplayMedia;
  label: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stream = isClubLiveStreamMedia(media) ? media.stream : null;
  useEffect(() => {
    if (!stream) return undefined;
    const video = videoRef.current;
    if (!video) return undefined;
    if (video.srcObject !== stream) video.srcObject = stream;
    void video.play().catch(() => undefined);
    return () => {
      if (video.srcObject === stream) video.srcObject = null;
    };
  }, [stream]);
  if (stream) {
    return (
      <video
        ref={videoRef}
        aria-label={label}
        autoPlay
        disablePictureInPicture
        muted
        playsInline
      />
    );
  }
  if (isClubLiveStreamMedia(media)) return null;
  return <img src={media.jpegDataUrl} alt={label} draggable={false} />;
}

function requiredText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeClubLiveFrame(value: unknown): ClubLiveFrame | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<ClubLiveFrame>;
  const clubId = requiredText(candidate.clubId);
  const studioRiderId = requiredText(candidate.studioRiderId);
  const riderName = requiredText(candidate.riderName);
  const sessionId = requiredText(candidate.sessionId);
  const deviceId = requiredText(candidate.deviceId);
  const jpegDataUrl = requiredText(candidate.jpegDataUrl);
  const width = Number(candidate.width);
  const height = Number(candidate.height);
  const capturedAt = Number(candidate.capturedAt);
  const updatedAt = Number(candidate.updatedAt);
  const expiresAt = Number(candidate.expiresAt);
  const byteLength = Number(candidate.byteLength);
  const activityType = candidate.activityType;
  const encodedJpeg = jpegDataUrl?.slice('data:image/jpeg;base64,'.length) ?? '';
  if (
    !clubId
    || !studioRiderId
    || !riderName
    || !sessionId
    || candidate.contentType !== 'image/jpeg'
    || !jpegDataUrl?.startsWith('data:image/jpeg;base64,')
    || !encodedJpeg
    || encodedJpeg.length > Math.ceil((350 * 1_024) / 3) * 4
    || !/^[A-Za-z0-9+/]+={0,2}$/u.test(encodedJpeg)
    || !Number.isInteger(width)
    || width < 1
    || width > 1_280
    || !Number.isInteger(height)
    || height < 1
    || height > 1_280
    || !Number.isInteger(byteLength)
    || byteLength < 4
    || byteLength > 350 * 1_024
    || !Number.isFinite(capturedAt)
    || capturedAt <= 0
    || !Number.isFinite(updatedAt)
    || updatedAt <= 0
    || !Number.isFinite(expiresAt)
    || expiresAt <= 0
    || (activityType !== 'bmx-race'
      && activityType !== 'straight-sprint'
      && activityType !== 'get-pulled'
      && activityType !== 'explore'
      && activityType !== 'monitor-sprint')
  ) {
    return null;
  }
  return {
    id: `${clubId}:${studioRiderId}:${sessionId}`,
    clubId,
    studioRiderId,
    riderName,
    sessionId,
    activityType,
    contentType: 'image/jpeg',
    jpegDataUrl: jpegDataUrl as `data:image/jpeg;base64,${string}`,
    width,
    height,
    capturedAt,
    updatedAt,
    expiresAt,
    byteLength,
    ...(deviceId ? { deviceId } : {}),
  };
}

export function normalizeClubLiveFrames(value: unknown) {
  const candidate = value && typeof value === 'object'
    ? value as { frames?: unknown }
    : {};
  if (!Array.isArray(candidate.frames)) return [];
  const newestByAthlete = new Map<string, ClubLiveFrame>();
  candidate.frames.forEach((frame) => {
    const normalized = normalizeClubLiveFrame(frame);
    if (!normalized) return;
    const key = `${normalized.clubId}:${normalized.studioRiderId}`;
    const current = newestByAthlete.get(key);
    if (!current || normalized.updatedAt > current.updatedAt) newestByAthlete.set(key, normalized);
  });
  return [...newestByAthlete.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 4);
}

async function loadClubLiveFrames() {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (clubLiveFrameEtag) headers['If-None-Match'] = clubLiveFrameEtag;
  const response = await fetch('/api/club-live/frames', {
    cache: 'no-store',
    headers,
  });
  if (response.status === 304) return cachedClubLiveFrames;
  if (!response.ok) throw new ClubLiveRequestError('Live activity screens are temporarily unavailable.', response.status);
  const frames = normalizeClubLiveFrames(await response.json().catch(() => ({})));
  clubLiveFrameEtag = response.headers.get('ETag') ?? '';
  cachedClubLiveFrames = frames;
  return frames;
}

let clubLiveFrameEtag = '';
let cachedClubLiveFrames: ClubLiveFrame[] = [];

export function unexpiredClubLiveFrames(frames: readonly ClubLiveFrame[], now: number) {
  return frames.filter((frame) => frame.expiresAt > now);
}

export function frameMatchesSession(frame: ClubLiveFrame, session: ClubLiveSession) {
  return frame.clubId === session.clubId
    && frame.studioRiderId === session.studioRiderId
    && frame.sessionId === session.sessionId
    && (!session.deviceId || frame.deviceId === session.deviceId);
}

function activityLabel(activityType: ClubLiveSession['activityType']) {
  if (activityType === 'get-pulled') return 'Get Pulled';
  if (activityType === 'straight-sprint') return 'Straight Sprint';
  if (activityType === 'explore') return 'Explore the World';
  return 'BMX Race';
}

function ActivityIcon({ activityType }: { activityType: ClubLiveSession['activityType'] }) {
  if (activityType === 'get-pulled') return <Zap size={18} />;
  if (activityType === 'straight-sprint') return <Route size={18} />;
  if (activityType === 'explore') return <Compass size={18} />;
  return <Bike size={18} />;
}

function statusLabel(status: ClubLiveSession['status']) {
  if (status === 'staging') return 'At the gate';
  if (status === 'active') return 'Training live';
  if (status === 'paused') return 'Paused';
  if (status === 'finished') return 'Finished';
  return 'Getting ready';
}

function formatElapsed(elapsedMs: number) {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function tabletSeenLabel(lastSeenAt: number | undefined, now: number) {
  if (!lastSeenAt) return 'Waiting for first check-in';
  const elapsedSeconds = Math.max(0, Math.floor((now - lastSeenAt) / 1_000));
  if (elapsedSeconds < 10) return 'Online now';
  if (elapsedSeconds < 60) return `Seen ${elapsedSeconds}s ago`;
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `Seen ${elapsedMinutes}m ago`;
  return `Last seen ${new Date(lastSeenAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

export function clubTabletMonitorOnline(
  tablet: ClubTabletDevice | null | undefined,
  session: ClubLiveSession | null | undefined,
  now: number,
) {
  return Boolean(
    tablet?.lastSeenAt && now - tablet.lastSeenAt < 30_000
    || session && session.expiresAt > now && now - session.updatedAt < 30_000,
  );
}

export function clubTabletMonitorConnectedBike(
  tablet: ClubTabletDevice | null | undefined,
  deviceFeedAvailable = true,
) {
  if (!deviceFeedAvailable) return null;
  // The owner endpoint has already checked expiry against the server clock.
  // Rechecking with this PC's clock can hide a valid tablet when clocks differ.
  return tablet?.connectedBike ?? null;
}

export function clubTabletDeviceFeedErrorMessage(error: unknown) {
  const detail = error instanceof Error ? error.message.trim() : '';
  return detail
    ? `Connected-bike status is unavailable: ${detail}`
    : 'Connected-bike status is unavailable. Refresh the monitor to try again.';
}

export function selectClubTabletOverviewDevices(
  tablets: readonly ClubTabletDevice[],
  sessions: readonly ClubLiveSession[],
  now: number,
) {
  if (tablets.length <= 4) return [...tablets];
  const sessionByDeviceId = new Map(sessions.flatMap((session) => (
    session.deviceId ? [[session.deviceId, session] as const] : []
  )));
  return [...tablets]
    .sort((left, right) => {
      const leftSession = sessionByDeviceId.get(left.id);
      const rightSession = sessionByDeviceId.get(right.id);
      const onlineDifference = Number(clubTabletMonitorOnline(right, rightSession, now))
        - Number(clubTabletMonitorOnline(left, leftSession, now));
      if (onlineDifference) return onlineDifference;
      const leftSeenAt = Math.max(left.lastSeenAt ?? 0, leftSession?.updatedAt ?? 0);
      const rightSeenAt = Math.max(right.lastSeenAt ?? 0, rightSession?.updatedAt ?? 0);
      return rightSeenAt - leftSeenAt || (right.createdAt ?? 0) - (left.createdAt ?? 0);
    })
    .slice(0, 4);
}

export function formatClubLiveActivityDistance(
  distanceMeters: number,
  distanceUnit: DistanceUnit,
  activityType: ClubLiveSession['activityType'],
) {
  return activityType === 'explore'
    ? formatExploreDistanceMeters(distanceMeters, distanceUnit === 'm' ? 'km' : 'mi')
    : formatDistanceMeters(distanceMeters, distanceUnit);
}

export function ClubLiveMonitor({
  studioRiders,
  speedUnit,
  distanceUnit,
  raceTracks = [],
  sprintRoutes = [],
  raceViewsReady = true,
  fullscreen = false,
  onFullscreenChange,
}: ClubLiveMonitorProps) {
  const requestGenerationRef = useRef(0);
  const lastTabletRefreshAtRef = useRef(0);
  const canonicalPresentationSourcesRef = useRef<ClubLiveCanonicalSelections>({});
  const videoViewerRef = useRef<ClubLiveVideoViewer | null>(null);
  const [sessions, setSessions] = useState<ClubLiveSession[]>([]);
  const [frames, setFrames] = useState<ClubLiveFrame[]>([]);
  const [videoPublishers, setVideoPublishers] = useState<ClubLiveVideoPublisher[]>([]);
  const [videoFrames, setVideoFrames] = useState<Map<string, ClubLiveVideoFrame>>(new Map());
  const [standbyProbeIndex, setStandbyProbeIndex] = useState(0);
  const [monitorVisible, setMonitorVisible] = useState(() => (
    typeof document === 'undefined' || document.visibilityState !== 'hidden'
  ));
  const [enlargedPresentationId, setEnlargedPresentationId] = useState<string | null>(null);
  const [tablets, setTablets] = useState<ClubTabletDevice[]>([]);
  const [tabletFeedError, setTabletFeedError] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('Opening the private club feed…');
  const [now, setNow] = useState(Date.now());
  const photoByRiderId = useMemo(
    () => new Map(studioRiders.map((rider) => [rider.id, rider.photoUrl])),
    [studioRiders],
  );
  const liveSessions = useMemo(
    () => activeClubLiveSessions(sessions, now),
    [now, sessions],
  );
  const liveFrames = useMemo(
    () => unexpiredClubLiveFrames(frames, now),
    [frames, now],
  );
  const livePresentationSources = useMemo(
    () => liveSessions.map((session) => {
      const publisher = videoPublishers.find((candidate) => (
        clubLiveVideoPublisherMatchesSession(candidate, session)
      ));
      // Shared-stage identity is accepted only from the authenticated stream
      // publisher list. The tablet never chooses this grouping metadata.
      const presentationSession = clubLiveSessionWithPublisherPresentation(session, publisher);
      const directFrame = publisher ? videoFrames.get(publisher.id) ?? null : null;
      const streamMedia: ClubLiveStreamMedia | null = directFrame && clubLiveStreamIsLive(directFrame)
        ? {
            ...directFrame,
            id: `stream:${directFrame.publisherId}`,
            kind: 'stream',
            updatedAt: directFrame.connectedAt,
            expiresAt: Number.POSITIVE_INFINITY,
          }
        : null;
      const fallbackFrame = liveFrames.find((candidate) => frameMatchesSession(candidate, session)) ?? null;
      const media: ClubLiveDisplayMedia | null = streamMedia ?? fallbackFrame;
      return {
        id: [
          session.clubId,
          session.deviceId ?? 'personal-device',
          session.studioRiderId,
          session.sessionId ?? session.id,
        ].join(':'),
        session: presentationSession,
        media,
        ...(streamMedia
          ? { mediaTransport: 'direct' as const }
          : fallbackFrame
            ? { mediaTransport: 'fallback' as const }
            : {}),
        mediaLive: Boolean(
          streamMedia
          || fallbackFrame && now <= fallbackFrame.expiresAt && now - fallbackFrame.updatedAt <= 4_000,
        ),
      };
    }),
    [liveFrames, liveSessions, now, videoFrames, videoPublishers],
  );
  const livePresentations = useMemo(
    () => selectClubLivePresentations(
      livePresentationSources,
      canonicalPresentationSourcesRef.current,
    ),
    [livePresentationSources],
  );
  const enlargedPresentation = useMemo(
    () => livePresentations.find((presentation) => presentation.id === enlargedPresentationId) ?? null,
    [enlargedPresentationId, livePresentations],
  );
  const enlargedMedia = enlargedPresentation?.canonicalSource.media ?? null;
  const enlargedSession = enlargedPresentation?.canonicalSource.session ?? null;
  const enlargedParticipantNames = useMemo(
    () => [...new Set(enlargedPresentation?.sources.map(({ session }) => (
      session.athleteName || session.riderName
    )) ?? [])],
    [enlargedPresentation],
  );
  const enlargedPresentationName = enlargedSession
    ? enlargedPresentation?.kind === 'shared'
      ? `${activityLabel(enlargedSession.activityType)} shared screen`
      : enlargedSession.athleteName || enlargedSession.riderName
    : '';
  const connectedBikeCount = useMemo(
    () => tablets.filter((tablet) => clubTabletMonitorConnectedBike(tablet, tabletFeedError == null)).length,
    [tabletFeedError, tablets],
  );
  const liveDemoCount = useMemo(
    () => liveSessions.filter((session) => session.demo).length,
    [liveSessions],
  );
  const tabletSlots = useMemo(() => {
    const enrolled = selectClubTabletOverviewDevices(tablets, liveSessions, now).map((tablet, index) => ({
      seatNumber: index + 1,
      tablet,
      session: liveSessions.find((candidate) => candidate.deviceId === tablet.id) ?? null,
    }));
    return [
      ...enrolled,
      ...Array.from({ length: Math.max(0, 4 - enrolled.length) }, (_, index) => ({
        seatNumber: enrolled.length + index + 1,
        tablet: null,
        session: null,
      })),
    ];
  }, [liveSessions, now, tablets]);

  const refresh = useCallback(async (forceTabletFeed = false) => {
    const generation = ++requestGenerationRef.current;
    try {
      const refreshTablets = forceTabletFeed || Date.now() - lastTabletRefreshAtRef.current >= 5_000;
      if (refreshTablets) lastTabletRefreshAtRef.current = Date.now();
      let nextTabletFeedError: string | null = null;
      const [next, nextTablets, nextFrames] = await Promise.all([
        loadClubLiveSessions(),
        refreshTablets ? loadClubTabletDevices().catch((error: unknown) => {
          nextTabletFeedError = clubTabletDeviceFeedErrorMessage(error);
          return null;
        }) : Promise.resolve(null),
        loadClubLiveFrames().catch(() => null),
      ]);
      if (generation !== requestGenerationRef.current) return;
      setSessions(next);
      if (nextFrames) setFrames(nextFrames);
      if (refreshTablets) {
        if (nextTablets) setTablets(nextTablets);
        setTabletFeedError(nextTabletFeedError);
      }
      setStatus('ready');
      setMessage(next.length > 0 ? '' : 'No club athletes are sharing a live training session right now.');
      setNow(Date.now());
    } catch (error) {
      if (generation !== requestGenerationRef.current) return;
      if (error instanceof ClubLiveRequestError && (error.status === 401 || error.status === 403)) {
        setSessions([]);
        setFrames([]);
      }
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'The club live feed is temporarily unavailable.');
    }
  }, []);

  useEffect(() => {
    if (
      !monitorVisible
      || typeof RTCPeerConnection === 'undefined'
      || typeof WebSocket === 'undefined'
    ) return undefined;
    const viewer = new ClubLiveVideoViewer({
      onPublishers: setVideoPublishers,
      onFrame: (frame) => setVideoFrames((current) => {
        const next = new Map(current);
        next.set(frame.publisherId, frame);
        return next;
      }),
      onFrameRemoved: (publisherId) => setVideoFrames((current) => {
        if (!current.has(publisherId)) return current;
        const next = new Map(current);
        next.delete(publisherId);
        return next;
      }),
    }).start();
    videoViewerRef.current = viewer;
    return () => {
      videoViewerRef.current = null;
      viewer.stop();
      setVideoFrames(new Map());
      setVideoPublishers([]);
    };
  }, [monitorVisible]);

  useEffect(() => {
    const updateVisibility = () => setMonitorVisible(document.visibilityState !== 'hidden');
    const handlePageHide = () => setMonitorVisible(false);
    const handlePageShow = () => updateVisibility();
    document.addEventListener('visibilitychange', updateVisibility);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
    return () => {
      document.removeEventListener('visibilitychange', updateVisibility);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, []);

  useEffect(() => {
    const desiredPublishers = clubLiveVideoPublisherIdsForPresentations(
      livePresentations,
      videoPublishers,
      standbyProbeIndex,
    );
    videoViewerRef.current?.setSubscriptions(desiredPublishers);
  }, [livePresentations, standbyProbeIndex, videoPublishers]);

  useEffect(() => {
    if (!monitorVisible) return undefined;
    const timer = window.setInterval(() => {
      // A shared stage carries only its canonical direct stream plus one
      // rotating standby. This probes every tablet without continuously
      // decoding four high-bitrate streams on each owner display.
      setStandbyProbeIndex((current) => current + 1);
    }, 6_000);
    return () => window.clearInterval(timer);
  }, [monitorVisible]);

  useEffect(() => {
    canonicalPresentationSourcesRef.current = clubLiveCanonicalSelections(livePresentations);
  }, [livePresentations]);

  useEffect(() => {
    let disposed = false;
    let requestActive = false;
    const poll = async () => {
      if (disposed || requestActive || document.visibilityState === 'hidden') return;
      requestActive = true;
      await refresh();
      requestActive = false;
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1_000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      disposed = true;
      requestGenerationRef.current += 1;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const currentNow = Date.now();
      setNow(currentNow);
      setFrames((current) => {
        const active = unexpiredClubLiveFrames(current, currentNow);
        return active.length === current.length ? current : active;
      });
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (enlargedPresentationId && (!enlargedPresentation || !enlargedMedia)) {
      setEnlargedPresentationId(null);
    }
  }, [enlargedMedia, enlargedPresentation, enlargedPresentationId]);

  useEffect(() => {
    if (!enlargedMedia) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEnlargedPresentationId(null);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [enlargedMedia]);

  return (
    <main className="club-live-monitor" aria-label="Club Live Monitor">
      <header className="club-live-header">
        <div>
          <span className="eyebrow"><RadioTower size={15} /> Owner-only view</span>
          <h2>Club Live Monitor</h2>
          <p>Optional read-only display for athletes using your club. Opening this screen is not required for their bike access.</p>
        </div>
        <div className={`club-live-connection ${status}`}>
          <Signal size={17} />
          <span>{status === 'error'
            ? 'Feed interrupted'
            : `${liveSessions.length} live${liveDemoCount ? ` · ${liveDemoCount} demo` : ''}`}</span>
          <button type="button" onClick={() => void refresh(true)} aria-label="Refresh Club Live Monitor">
            <RefreshCw size={16} />
          </button>
          {fullscreen && (
            <button
              className="club-live-exit-fullscreen"
              type="button"
              onClick={() => onFullscreenChange?.(false)}
              aria-label="Exit full screen Club Live Monitor"
            >
              <Minimize2 size={16} />
            </button>
          )}
        </div>
      </header>

      <ClubEventConsole
        raceTracks={raceTracks}
        sprintRoutes={sprintRoutes}
        raceViewsReady={raceViewsReady}
      />

      <section className="club-live-tablet-overview" aria-label="Four Club Tablet status">
        <div className="club-live-tablet-overview-copy">
          <span><Tablet size={18} /> Four Club Tablets</span>
          <p>
            <strong className={`club-live-bike-count${tabletFeedError ? ' error' : ''}`}>
              {tabletFeedError
                ? <><WifiOff size={14} /> Bike status unavailable</>
                : <><Bike size={14} /> {connectedBikeCount} bike{connectedBikeCount === 1 ? '' : 's'} connected</>}
            </strong>
            Independent Training stays available on every tablet. Riders choose their own athlete and program while this owner screen only watches.
          </p>
        </div>
        {tabletFeedError && (
          <p className="club-live-tablet-overflow-warning" role="alert">{tabletFeedError}</p>
        )}
        {tablets.length > 4 && (
          <p className="club-live-tablet-overflow-warning" role="alert">
            {tablets.length} tablets are enrolled. The four online or most recently seen tablets are shown here; revoke retired authorizations before opening a four-tablet coach lobby.
          </p>
        )}
        <div className="club-live-tablet-slots">
          {tabletSlots.map(({ seatNumber, tablet, session }) => {
            const online = clubTabletMonitorOnline(tablet, session, now);
            const connectedBike = clubTabletMonitorConnectedBike(tablet, tabletFeedError == null);
            const lastSeenAt = Math.max(tablet?.lastSeenAt ?? 0, session?.updatedAt ?? 0) || undefined;
            const displayName = session?.athleteName || session?.riderName;
            return (
              <article
                className={`club-live-tablet-slot${session ? ' training' : ''}${online ? ' online' : ''}`}
                key={tablet?.id ?? `empty-${seatNumber}`}
              >
                <span className="club-live-tablet-number">{seatNumber}</span>
                <div>
                  <strong>{tablet?.name ?? `Tablet ${seatNumber}`}</strong>
                  <small>{session
                    ? `${displayName} · ${session.demo ? 'DEMO · ' : ''}${activityLabel(session.activityType)}`
                    : tablet
                      ? 'Ready for an athlete'
                      : 'Not enrolled yet'}</small>
                  {connectedBike && (
                    <small className="club-live-tablet-bike">
                      Bike connected · PM {wattbikeMonitorLastThree(
                        connectedBike.label,
                        connectedBike.deviceId,
                      )}
                    </small>
                  )}
                </div>
                <span className={`club-live-tablet-presence ${online ? 'online' : 'offline'}`}>
                  {online ? <Wifi size={14} /> : <WifiOff size={14} />}
                  {tablet ? tabletSeenLabel(lastSeenAt, now) : 'Open slot'}
                </span>
              </article>
            );
          })}
        </div>
      </section>

      {liveSessions.length > 0 ? (
        <div className={`club-live-grid count-${livePresentations.length}${livePresentations.some((presentation) => presentation.kind === 'shared') ? ' has-shared' : ''}`}>
          {livePresentations.map((presentation) => {
            const { session, media: frame } = presentation.canonicalSource;
            const shared = presentation.kind === 'shared';
            const stale = presentation.sources.every(({ session: sourceSession }) => (
              now > sourceSession.expiresAt || now - sourceSession.updatedAt > 4_000
            ));
            const presentationStatus = presentation.sources.some(({ session: sourceSession }) => sourceSession.status === 'active')
              ? 'active'
              : presentation.sources.some(({ session: sourceSession }) => sourceSession.status === 'staging')
                ? 'staging'
                : presentation.sources.every(({ session: sourceSession }) => sourceSession.status === 'paused')
                  ? 'paused'
                  : session.status;
            const displayName = session.athleteName || session.riderName;
            const directVideo = Boolean(frame && isClubLiveStreamMedia(frame));
            const frameStale = Boolean(
              frame
              && !isClubLiveStreamMedia(frame)
              && (now > frame.expiresAt || now - frame.updatedAt > 4_000),
            );
            const subtitle = session.athleteName && session.athleteName !== session.riderName
              ? `Studio rider: ${session.riderName}`
              : 'Club athlete';
            const participantNames = [...new Set(presentation.sources.map(({ session: sourceSession }) => (
              sourceSession.athleteName || sourceSession.riderName
            )))];
      const accessiblePresentationName = shared
        ? `${activityLabel(session.activityType)} shared activity screen`
        : `live activity screen for ${displayName}`;
            const percent = Math.round(session.progress.fraction * 100);
            const location = session.trackName ?? session.destinationLabel ?? 'Training session';
            const position = session.metrics.position && session.metrics.participantCount > 0
              ? `${session.metrics.position} of ${session.metrics.participantCount}`
              : '—';
            const showTelemetry = !shared || !frame;
            return (
              <section
                className={`club-live-tile ${presentationStatus}${stale ? ' stale' : ''}${shared ? ' shared' : ''}${session.demo ? ' demo' : ''}`}
                key={presentation.id}
              >
                <div className="club-live-athlete">
                  {shared ? (
                    <span className="club-live-shared-avatar" aria-hidden="true">
                      <ActivityIcon activityType={session.activityType} />
                    </span>
                  ) : (
                    <RiderAvatar
                      name={displayName}
                      photoUrl={photoByRiderId.get(session.studioRiderId)}
                      accent="#78df3b"
                      className="club-live-avatar"
                    />
                  )}
                  <div>
                    <h3>{shared ? `${activityLabel(session.activityType)} shared screen` : displayName}</h3>
                    <p>{session.demo
                      ? shared
                        ? `DEMO · ${participantNames.join(' · ')} · nothing is saved`
                        : 'DEMO · simulated club tablet · nothing is saved'
                      : shared ? participantNames.join(' · ') : subtitle}</p>
                  </div>
                  <span className={`club-live-status ${stale ? 'stale' : presentationStatus}`}>
                    <i /> {stale ? 'Reconnecting' : statusLabel(presentationStatus)}
                  </span>
                </div>

                {frame && (
                  <div className={`club-live-screen${frameStale ? ' stale' : ''}${presentationStatus === 'paused' ? ' paused' : ''}`}>
                    <div className="club-live-screen-toolbar">
                      <span className="club-live-screen-label">
                        {session.demo ? 'DEMO · ' : ''}{directVideo
                          ? `Direct 60 FPS target${shared ? ` · ${presentation.sources.length} riders` : ''}`
                          : frameStale
                          ? 'Screen reconnecting'
                          : presentationStatus === 'paused'
                            ? 'Screen paused'
                            : shared
                              ? `Shared activity screen · ${presentation.sources.length} riders`
                              : 'Live activity screen'}
                      </span>
                      <button
                        type="button"
                        className="club-live-screen-enlarge"
                        onClick={() => setEnlargedPresentationId(presentation.id)}
                        aria-label={`Enlarge ${accessiblePresentationName}`}
                      >
                        <Maximize2 size={17} /> Enlarge
                      </button>
                    </div>
                    <button
                      type="button"
                      className="club-live-screen-open"
                      style={isClubLiveStreamMedia(frame)
                        ? undefined
                        : { aspectRatio: `${frame.width} / ${frame.height}` }}
                      onClick={() => setEnlargedPresentationId(presentation.id)}
                      aria-label={`Open full-screen ${accessiblePresentationName}`}
                    >
                      <ClubLiveMediaView
                        media={frame}
                        label={shared
                          ? `Live shared TrackLab ${activityLabel(session.activityType)} screen for ${participantNames.join(', ')}`
                          : `Live TrackLab activity screen for ${displayName}`}
                      />
                    </button>
                  </div>
                )}

                {shared && (
                  <div className="club-live-shared-participants" aria-label="Athletes shown on the shared activity screen">
                    <strong><Users size={15} /> {presentation.sources.length} {session.demo ? 'demo riders' : 'riders'} on this screen</strong>
                    <span>{participantNames.join(' · ')}</span>
                  </div>
                )}

                {showTelemetry && (
                  <>
                    <div className="club-live-activity">
                      <span><ActivityIcon activityType={session.activityType} /></span>
                      <div>
                        <strong>{activityLabel(session.activityType)}</strong>
                        <small>{location}</small>
                      </div>
                      {session.multiplayer && <b><Users size={14} /> Private room</b>}
                    </div>

                    {session.activityType === 'get-pulled' && (
                      <div className="club-live-pull-scene">
                        <PullSledScene
                          active={!stale && session.status === 'active'}
                          cadenceRpm={session.metrics.cadence}
                          compact
                          label={`${displayName} in a Get Pulled test`}
                          progress={session.progress.fraction}
                          speedKph={session.metrics.speedKph}
                        />
                      </div>
                    )}

                    <div className="club-live-progress-copy">
                      <strong>{session.progress.label ?? `${percent}% complete`}</strong>
                      <span>{formatClubLiveActivityDistance(
                        session.metrics.distanceMeters,
                        distanceUnit,
                        session.activityType,
                      )}</span>
                    </div>
                    <div className="club-live-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                      <span style={{ width: `${percent}%` }} />
                    </div>

                    <div className="club-live-metrics">
                      <div><Activity size={18} /><strong>{session.metrics.cadence}</strong><small>rpm</small></div>
                      <div><Zap size={18} /><strong>{session.metrics.watts}</strong><small>watts</small></div>
                      <div><Gauge size={18} /><strong>{formatSpeedFromKph(session.metrics.speedKph, speedUnit)}</strong><small>{speedUnitLabel(speedUnit)}</small></div>
                      <div><Clock3 size={18} /><strong>{formatElapsed(session.metrics.elapsedMs)}</strong><small>elapsed</small></div>
                    </div>
                  </>
                )}

                <div className="club-live-tile-footer">
                  {shared ? (
                    <>
                      <span><strong>{location}</strong></span>
                      <span>{stale
                        ? `Waiting for the ${session.demo ? 'demo tablets' : 'athlete devices'}`
                        : session.demo ? 'Read-only DEMO view · not saved' : 'Read-only shared view'}</span>
                    </>
                  ) : (
                    <>
                      <span>Position <strong>{position}</strong></span>
                      <span>{stale
                        ? `Waiting for the ${session.demo ? 'demo tablet' : 'athlete device'}`
                        : session.demo ? 'Read-only DEMO feed · not saved' : 'Read-only live feed'}</span>
                    </>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <section className={`club-live-empty ${status}`}>
          <RadioTower size={38} />
          <strong>{status === 'loading' ? 'Connecting to your club…' : 'Waiting for athletes'}</strong>
          <p>{message || 'No club athletes are sharing a live training session right now.'}</p>
          {status === 'error' && <button type="button" onClick={() => void refresh()}>Try again</button>}
        </section>
      )}

      {enlargedPresentation && enlargedMedia && enlargedSession && (
        <div
          className="club-live-screen-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setEnlargedPresentationId(null);
          }}
        >
          <section
            className="club-live-screen-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`Live activity screen for ${enlargedPresentationName}`}
          >
            <header>
              <div>
                <span>{enlargedPresentation.kind === 'shared'
                  ? `${enlargedSession.demo ? 'DEMO · ' : ''}Read-only shared activity screen`
                  : `${enlargedSession.demo ? 'DEMO · ' : ''}Read-only live activity screen`}</span>
                <strong>{enlargedPresentation.kind === 'shared'
                  ? `${enlargedPresentationName} · ${enlargedPresentation.sources.length} riders`
                  : enlargedPresentationName}</strong>
              </div>
              {!isClubLiveStreamMedia(enlargedMedia) && now - enlargedMedia.updatedAt > 4_000 ? (
                <span className="club-live-screen-dialog-status">Screen reconnecting</span>
              ) : enlargedSession.status === 'paused' && (
                <span className="club-live-screen-dialog-status">Screen paused</span>
              )}
              <button
                type="button"
                autoFocus
                onClick={() => setEnlargedPresentationId(null)}
                aria-label="Close full-screen live activity screen"
              >
                <X size={22} />
              </button>
            </header>
            <div
              className="club-live-screen-dialog-frame"
              style={isClubLiveStreamMedia(enlargedMedia)
                ? undefined
                : { aspectRatio: `${enlargedMedia.width} / ${enlargedMedia.height}` }}
            >
              <ClubLiveMediaView
                media={enlargedMedia}
                label={enlargedPresentation.kind === 'shared'
                  ? `Full-screen live shared TrackLab activity for ${enlargedParticipantNames.join(', ')}`
                  : `Full-screen live TrackLab activity screen for ${enlargedPresentationName}`}
              />
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default ClubLiveMonitor;
