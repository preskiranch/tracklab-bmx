import {
  BadgeCheck,
  Bike,
  Check,
  Copy,
  ExternalLink,
  Flag,
  Inbox,
  Link2,
  LoaderCircle,
  LockKeyhole,
  MapPinned,
  QrCode,
  Search,
  Share2,
  ShieldOff,
  Sparkles,
  TimerReset,
  Trash2,
  UserMinus,
  UserRoundPlus,
  UsersRound,
  WifiOff,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import type { DistanceUnit } from '../types';
import { formatDistanceMeters } from '../units';
import {
  createClientRequestId,
  createFriendsApi,
  clearQueuedFriendRequests,
  flushQueuedFriendRequests,
  officialFriendLabel,
  queueFriendRequest,
  readQueuedFriendRequests,
  FriendsApiError,
  type FriendInvite,
  type FriendInviteMetadata,
  type FriendPage,
  type FriendPrivacy,
  type FriendProfile,
  type FriendReportReason,
  type FriendRequest,
  type FriendRequestPage,
  type FriendsApi,
  type FriendSuggestion,
} from '../lib/friends';
import { trackLocatorShareUrl } from '../lib/mapLinks';
import {
  createTrackSharesApi,
  type TrackShare,
  type TrackSharePage,
  type TrackSharesApi,
} from '../lib/trackShares';
import { RiderAvatar } from './RiderAvatar';
import './FriendsView.css';

export type FriendsTab = 'friends' | 'requests' | 'suggestions' | 'shared-tracks' | 'invite';

export type FriendsViewProps = {
  currentProfileId: string;
  api?: FriendsApi;
  trackSharesApi?: TrackSharesApi;
  initialTab?: FriendsTab;
  refreshToken?: string | number;
  friendInviteToken?: string | null;
  onPendingCountChange?: (count: number) => void;
  onFriendGraphChange?: () => void;
  onInviteToRace?: (profile: FriendProfile) => void;
  onRaceGhost?: (profile: FriendProfile) => void | string;
  onOpenProfile?: (profile: FriendProfile) => void;
  distanceUnit?: DistanceUnit;
};

const blankProfilePage: FriendPage<FriendProfile> = { items: [], nextCursor: null, total: 0 };
const blankSuggestionPage: FriendPage<FriendSuggestion> = { items: [], nextCursor: null, total: 0 };
const blankTrackSharePage: TrackSharePage = { items: [], nextCursor: null, total: 0, unreadTotal: 0 };
const blankRequestPage: FriendRequestPage = {
  incoming: [],
  outgoing: [],
  incomingTotal: 0,
  outgoingTotal: 0,
  incomingNextCursor: null,
  outgoingNextCursor: null,
  total: 0,
};

type CachedFriendValue<T> = {
  value?: T;
  loadedAt?: number;
  pending?: Promise<T>;
  refreshPending?: Promise<T>;
  queuedRefresh?: Promise<T>;
  generation?: number;
  pendingGeneration?: number;
};

type FriendHubCache = {
  friends: CachedFriendValue<FriendPage<FriendProfile>>;
  requestCount: CachedFriendValue<FriendRequestPage>;
  requests: CachedFriendValue<FriendRequestPage>;
  suggestions: CachedFriendValue<FriendPage<FriendSuggestion>>;
  invites: CachedFriendValue<FriendInviteMetadata[]>;
  privacy: CachedFriendValue<FriendPrivacy>;
};

type TrackShareHubCache = {
  count: CachedFriendValue<TrackSharePage>;
  received: CachedFriendValue<TrackSharePage>;
};

const friendHubCacheByApi = new WeakMap<FriendsApi, Map<string, FriendHubCache>>();
const trackShareHubCacheByApi = new WeakMap<TrackSharesApi, Map<string, TrackShareHubCache>>();
const friendHubFreshMs = 30_000;
const defaultTrackSharesApi = createTrackSharesApi();

function friendHubCache(api: FriendsApi, profileId: string) {
  let accountCaches = friendHubCacheByApi.get(api);
  if (!accountCaches) {
    accountCaches = new Map();
    friendHubCacheByApi.set(api, accountCaches);
  }
  let cache = accountCaches.get(profileId);
  if (!cache) {
    cache = { friends: {}, requestCount: {}, requests: {}, suggestions: {}, invites: {}, privacy: {} };
    accountCaches.set(profileId, cache);
  }
  return cache;
}

function trackShareHubCache(api: TrackSharesApi, profileId: string) {
  let accountCaches = trackShareHubCacheByApi.get(api);
  if (!accountCaches) {
    accountCaches = new Map();
    trackShareHubCacheByApi.set(api, accountCaches);
  }
  let cache = accountCaches.get(profileId);
  if (!cache) {
    cache = { count: {}, received: {} };
    accountCaches.set(profileId, cache);
  }
  return cache;
}

function startCachedFriendLoad<T>(slot: CachedFriendValue<T>, load: () => Promise<T>, refresh: boolean) {
  const generation = (slot.generation ?? 0) + 1;
  slot.generation = generation;
  slot.pendingGeneration = generation;
  const pending = load().then((value) => {
    if (slot.generation === generation) {
      slot.value = value;
      slot.loadedAt = Date.now();
    }
    return value;
  }).finally(() => {
    if (slot.pending === pending) {
      slot.pending = undefined;
      slot.pendingGeneration = undefined;
    }
    if (slot.refreshPending === pending) slot.refreshPending = undefined;
  });
  slot.pending = pending;
  if (refresh) slot.refreshPending = pending;
  return pending;
}

function cachedFriendLoad<T>(slot: CachedFriendValue<T>, load: () => Promise<T>, force = false) {
  if (slot.queuedRefresh) return slot.queuedRefresh;
  if (slot.pending) {
    if (!force && slot.pendingGeneration === slot.generation) return slot.pending;
    const active = slot.pending;
    slot.generation = (slot.generation ?? 0) + 1;
    const queuedRefresh = active.catch(() => undefined).then(() => {
      if (slot.queuedRefresh === queuedRefresh) slot.queuedRefresh = undefined;
      return startCachedFriendLoad(slot, load, true);
    });
    slot.queuedRefresh = queuedRefresh;
    return queuedRefresh;
  }
  if (!force && slot.value !== undefined && Date.now() - (slot.loadedAt ?? 0) < friendHubFreshMs) {
    return Promise.resolve(slot.value);
  }
  return startCachedFriendLoad(slot, load, force);
}

function invalidateCachedFriendValue<T>(slot: CachedFriendValue<T>) {
  slot.value = undefined;
  slot.loadedAt = undefined;
  slot.generation = (slot.generation ?? 0) + 1;
}

export function preloadFriendsView(
  currentProfileId: string,
  api: FriendsApi,
  force = false,
  sharesApi: TrackSharesApi = defaultTrackSharesApi,
) {
  const cache = friendHubCache(api, currentProfileId);
  const sharesCache = trackShareHubCache(sharesApi, currentProfileId);
  const friends = cachedFriendLoad(cache.friends, () => api.listFriends(), force);
  const requests = cachedFriendLoad(
    cache.requestCount,
    () => api.listRequests({ direction: 'incoming', limit: 1 }),
    force,
  );
  const trackShares = cachedFriendLoad(
    sharesCache.count,
    () => sharesApi.listReceived({ unread: true, limit: 1 }),
    force,
  ).catch(() => blankTrackSharePage);
  if (force) invalidateCachedFriendValue(sharesCache.received);
  void cachedFriendLoad(cache.privacy, () => api.getPrivacy(), force).catch(() => undefined);
  return Promise.all([friends, requests, trackShares]).then(([friendPage, requestPage, trackSharePage]) => ({
    friendPage,
    requestPage,
    trackSharePage,
    pendingTotal: requestPage.incomingTotal + trackSharePage.unreadTotal,
  }));
}

const tabs: Array<{ id: FriendsTab; label: string; icon: typeof UsersRound }> = [
  { id: 'friends', label: 'Friends', icon: UsersRound },
  { id: 'requests', label: 'Requests', icon: Inbox },
  { id: 'suggestions', label: 'Suggestions', icon: Sparkles },
  { id: 'shared-tracks', label: 'Shared tracks', icon: MapPinned },
  { id: 'invite', label: 'Invite', icon: UserRoundPlus },
];

const reportReasons: Array<{ value: FriendReportReason; label: string }> = [
  { value: 'spam', label: 'Spam' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'unsafe-behavior', label: 'Unsafe behavior' },
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'other', label: 'Something else' },
];

function appendUnique<T>(current: T[], incoming: T[], key: (item: T) => string) {
  const values = new Map(current.map((item) => [key(item), item]));
  incoming.forEach((item) => values.set(key(item), item));
  return [...values.values()];
}

function searchPlaceholder(tab: FriendsTab) {
  if (tab === 'friends') return 'Search friends by name or @handle';
  if (tab === 'requests') return 'Search requests by name or @handle';
  return 'Find a rider by name or @handle';
}

function tabEmptyCopy(tab: FriendsTab, searching: boolean) {
  if (searching) return 'No riders match that name or handle.';
  if (tab === 'friends') return 'Your friend list is ready for its first rider.';
  if (tab === 'requests') return 'You have no friend requests right now.';
  if (tab === 'shared-tracks') return 'Tracks your friends share with you will appear here.';
  return 'No suggestions are available yet. Try searching for a rider.';
}

function isNetworkFailure(error: unknown) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /failed to fetch|network|offline|load failed/i.test(message);
}

function readableDate(value: string) {
  if (!value) return 'Recently';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Recently';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

function readableGhostTime(finishTimeMs: number) {
  return `${(finishTimeMs / 1_000).toFixed(2)}s`;
}

export function friendGhostDetail(
  preview: NonNullable<FriendProfile['ghostPreview']>,
  distanceUnit: DistanceUnit = 'ft',
) {
  const setup = preview.sprintDistanceFeet != null && preview.sprintAirSetting != null
    ? ` · ${formatDistanceMeters(preview.sprintDistanceFeet * 0.3048, distanceUnit)} · Air ${preview.sprintAirSetting}`
    : preview.lapCount > 1
      ? ` · ${preview.lapCount} laps`
      : '';
  return `Recent ghost · ${preview.trackName} · ${readableGhostTime(preview.finishTimeMs)}${setup}`;
}

function suggestionDetail(profile: FriendProfile, reason: string) {
  if (reason === 'shared-club') return 'You ride with the same club';
  if (reason === 'recent-race') return 'You recently raced together';
  if (reason === 'mutual-friends' || (!reason && profile.mutualFriendCount > 0)) {
    return `${profile.mutualFriendCount} mutual friend${profile.mutualFriendCount === 1 ? '' : 's'}`;
  }
  if (reason === 'tracklab-rider') return 'TrackLab rider';
  return reason || 'TrackLab rider';
}

export function friendInviteTokenFromHref(href: string) {
  const url = new URL(href, 'https://tracklab.invalid');
  const legacyPath = /^\/friends\/invite\/?$/.test(url.pathname);
  return (url.searchParams.get('friendInvite')
    ?? (legacyPath ? url.searchParams.get('token') : ''))?.trim() ?? '';
}

function inviteTokenFromUrl() {
  if (typeof window === 'undefined') return '';
  return friendInviteTokenFromHref(window.location.href);
}

function removeInviteTokenFromUrl() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (url.searchParams.has('friendInvite')) {
    url.searchParams.delete('friendInvite');
  } else if (url.pathname === '/friends/invite' && url.searchParams.has('token')) {
    url.searchParams.delete('token');
  } else {
    return;
  }
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

function ProfileIdentity({ profile, detail }: { profile: FriendProfile; detail?: ReactNode }) {
  const officialLabel = officialFriendLabel(profile.officialKind);
  return (
    <div className="friend-profile-identity">
      <span className={`friend-presence ${profile.online ? 'online' : ''}`} aria-label={profile.online ? 'Online' : 'Offline'}>
        <RiderAvatar name={profile.displayName} photoUrl={profile.photoUrl} />
      </span>
      <div className="friend-profile-name">
        <span className="friend-name-row">
          <strong>{profile.displayName}</strong>
          {officialLabel && (
            <span className="friend-official-badge" title={officialLabel} aria-label={officialLabel}>
              <BadgeCheck size={16} aria-hidden="true" />
            </span>
          )}
        </span>
        <span>@{profile.handle}</span>
        {detail}
      </div>
    </div>
  );
}

type ProfileCardProps = {
  profile: FriendProfile;
  detail?: ReactNode;
  children: ReactNode;
  onOpenProfile?: (profile: FriendProfile) => void;
};

function ProfileCard({ profile, detail, children, onOpenProfile }: ProfileCardProps) {
  return (
    <article className={`friend-profile-card ${profile.officialKind ? 'official' : ''}`}>
      {onOpenProfile ? (
        <button className="friend-profile-open" type="button" onClick={() => onOpenProfile(profile)}>
          <ProfileIdentity profile={profile} detail={detail} />
        </button>
      ) : (
        <ProfileIdentity profile={profile} detail={detail} />
      )}
      <div className="friend-card-actions">{children}</div>
    </article>
  );
}

function LoadingCards() {
  return (
    <div className="friend-loading" role="status" aria-label="Loading riders">
      {[0, 1, 2].map((item) => <span key={item} />)}
    </div>
  );
}

function EmptyState({ tab, searching }: { tab: FriendsTab; searching: boolean }) {
  return (
    <div className="friend-empty-state">
      {searching ? <Search size={28} /> : tab === 'shared-tracks' ? <MapPinned size={28} /> : <UsersRound size={28} />}
      <strong>{searching ? 'No match found' : tab === 'shared-tracks' ? 'No shared tracks yet' : 'Nothing waiting'}</strong>
      <span>{tabEmptyCopy(tab, searching)}</span>
    </div>
  );
}

function LoadMoreButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <button className="friend-load-more" type="button" disabled={loading} onClick={onClick}>
      {loading && <LoaderCircle className="spin" size={16} />}
      {loading ? 'Loading riders…' : 'Load more'}
    </button>
  );
}

export function FriendsView({
  currentProfileId,
  api,
  trackSharesApi,
  initialTab = 'friends',
  refreshToken = 0,
  friendInviteToken = null,
  onPendingCountChange,
  onFriendGraphChange,
  onInviteToRace,
  onRaceGhost,
  onOpenProfile,
  distanceUnit = 'ft',
}: FriendsViewProps) {
  const friendsApi = useMemo(() => api ?? createFriendsApi(), [api]);
  const sharesApi = useMemo(() => trackSharesApi ?? defaultTrackSharesApi, [trackSharesApi]);
  const hubCache = useMemo(() => friendHubCache(friendsApi, currentProfileId), [currentProfileId, friendsApi]);
  const sharesCache = useMemo(
    () => trackShareHubCache(sharesApi, currentProfileId),
    [currentProfileId, sharesApi],
  );
  const [activeTab, setActiveTab] = useState<FriendsTab>(initialTab);
  const [searchDraft, setSearchDraft] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [friends, setFriends] = useState(() => hubCache.friends.value ?? blankProfilePage);
  const [requests, setRequests] = useState(() => hubCache.requests.value ?? blankRequestPage);
  const [suggestions, setSuggestions] = useState(() => hubCache.suggestions.value ?? blankSuggestionPage);
  const [sharedTracks, setSharedTracks] = useState(() => sharesCache.received.value ?? blankTrackSharePage);
  const [unreadTrackShareCount, setUnreadTrackShareCount] = useState(
    () => sharesCache.received.value?.unreadTotal ?? sharesCache.count.value?.unreadTotal ?? 0,
  );
  const [invite, setInvite] = useState<FriendInvite | null>(null);
  const [activeInvites, setActiveInvites] = useState<FriendInviteMetadata[]>(() => hubCache.invites.value ?? []);
  const [loadingTabs, setLoadingTabs] = useState<Set<FriendsTab>>(() => new Set());
  const [loadingMore, setLoadingMore] = useState(false);
  const [actionKeys, setActionKeys] = useState<Set<string>>(() => new Set());
  const [queuedTargetIds, setQueuedTargetIds] = useState<Set<string>>(
    () => new Set(readQueuedFriendRequests(currentProfileId).map((request) => request.targetProfileId)),
  );
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [reportingProfile, setReportingProfile] = useState<FriendProfile | null>(null);
  const [reportReason, setReportReason] = useState<FriendReportReason>('unsafe-behavior');
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [blockedProfiles, setBlockedProfiles] = useState(blankProfilePage);
  const [blockedLoading, setBlockedLoading] = useState(false);
  const [privacy, setPrivacy] = useState<FriendPrivacy>(() => hubCache.privacy.value ?? { discoverable: false, profile: null });
  const [privacyLoading, setPrivacyLoading] = useState(() => hubCache.privacy.value === undefined);
  const [privacySaving, setPrivacySaving] = useState(false);
  const [claimRetryToken, setClaimRetryToken] = useState(0);
  const requestSequenceRef = useRef<Record<FriendsTab, number>>({
    friends: 0,
    requests: 0,
    suggestions: 0,
    'shared-tracks': 0,
    invite: 0,
  });
  const loadedTabsRef = useRef<Record<FriendsTab, boolean>>({
    friends: hubCache.friends.value !== undefined,
    requests: hubCache.requests.value !== undefined,
    suggestions: hubCache.suggestions.value !== undefined,
    'shared-tracks': sharesCache.received.value !== undefined,
    invite: hubCache.invites.value !== undefined,
  });
  const refreshTokenRef = useRef(refreshToken);
  const trackShareCountRefreshTokenRef = useRef(refreshToken);
  const privacyRefreshTokenRef = useRef(refreshToken);
  const claimedTokenRef = useRef('');
  const queueOwnerRef = useRef(currentProfileId);
  const tabRefs = useRef<Partial<Record<FriendsTab, HTMLButtonElement | null>>>({});
  const reportDialogRef = useRef<HTMLElement | null>(null);
  const blockedDialogRef = useRef<HTMLElement | null>(null);
  const reportDialogTriggerRef = useRef<HTMLButtonElement | null>(null);
  const blockedDialogTriggerRef = useRef<HTMLButtonElement | null>(null);

  const activateTab = useCallback((id: FriendsTab) => {
    if (id === 'friends' && hubCache.friends.value) setFriends(hubCache.friends.value);
    if (id === 'requests' && hubCache.requests.value) setRequests(hubCache.requests.value);
    if (id === 'suggestions' && hubCache.suggestions.value) setSuggestions(hubCache.suggestions.value);
    if (id === 'shared-tracks' && sharesCache.received.value) setSharedTracks(sharesCache.received.value);
    if (id === 'invite' && hubCache.invites.value) setActiveInvites(hubCache.invites.value);
    loadedTabsRef.current[id] = (id === 'friends' ? hubCache.friends.value
      : id === 'requests' ? hubCache.requests.value
        : id === 'suggestions' ? hubCache.suggestions.value
          : id === 'shared-tracks' ? sharesCache.received.value
            : hubCache.invites.value) !== undefined;
    setActiveTab(id);
    setSearchDraft('');
    setSearchQuery('');
    setError('');
  }, [hubCache, sharesCache]);

  const preloadTab = useCallback((id: FriendsTab) => {
    if (id === 'requests') {
      void cachedFriendLoad(hubCache.requests, () => friendsApi.listRequests()).catch(() => undefined);
    } else if (id === 'suggestions') {
      void cachedFriendLoad(hubCache.suggestions, () => friendsApi.listSuggestions()).catch(() => undefined);
    } else if (id === 'shared-tracks') {
      void cachedFriendLoad(sharesCache.received, () => sharesApi.listReceived()).catch(() => undefined);
    } else if (id === 'invite') {
      void cachedFriendLoad(hubCache.invites, () => friendsApi.listActiveInvites()).catch(() => undefined);
    }
  }, [friendsApi, hubCache, sharesApi, sharesCache]);

  const handleTabKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>, id: FriendsTab) => {
    const currentIndex = tabs.findIndex((tab) => tab.id === id);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    else return;

    event.preventDefault();
    const nextTab = tabs[nextIndex].id;
    activateTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  }, [activateTab]);

  const openReportDialog = useCallback((profile: FriendProfile, trigger: HTMLButtonElement) => {
    reportDialogTriggerRef.current = trigger;
    setReportingProfile(profile);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery(searchDraft.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  useEffect(() => {
    if (queueOwnerRef.current && queueOwnerRef.current !== currentProfileId) {
      clearQueuedFriendRequests(queueOwnerRef.current);
    }
    queueOwnerRef.current = currentProfileId;
    setQueuedTargetIds(new Set(readQueuedFriendRequests(currentProfileId).map((request) => request.targetProfileId)));
  }, [currentProfileId]);

  useEffect(() => {
    const dialog = reportingProfile ? reportDialogRef.current : blockedOpen ? blockedDialogRef.current : null;
    if (!dialog) return undefined;
    const returnFocus = reportingProfile ? reportDialogTriggerRef.current : blockedDialogTriggerRef.current;
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), a[href]')];
    focusable()[0]?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setReportingProfile(null);
        setBlockedOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (elements.length === 0) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, [blockedOpen, reportingProfile]);

  useEffect(() => {
    const incomingTotal = hubCache.requests.value?.incomingTotal
      ?? hubCache.requestCount.value?.incomingTotal
      ?? requests.incomingTotal;
    onPendingCountChange?.(incomingTotal + unreadTrackShareCount);
  }, [hubCache, onPendingCountChange, requests.incomingTotal, unreadTrackShareCount]);

  useEffect(() => {
    let active = true;
    const force = trackShareCountRefreshTokenRef.current !== refreshToken;
    trackShareCountRefreshTokenRef.current = refreshToken;
    if (force) {
      invalidateCachedFriendValue(sharesCache.received);
      loadedTabsRef.current['shared-tracks'] = false;
      setSharedTracks(blankTrackSharePage);
    }
    void cachedFriendLoad(
      sharesCache.count,
      () => sharesApi.listReceived({ unread: true, limit: 1 }),
      force,
    ).then((page) => {
      if (active) setUnreadTrackShareCount(page.unreadTotal);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [currentProfileId, refreshToken, sharesApi, sharesCache]);

  useEffect(() => {
    let active = true;
    const force = privacyRefreshTokenRef.current !== refreshToken;
    privacyRefreshTokenRef.current = refreshToken;
    if (hubCache.privacy.value === undefined) setPrivacyLoading(true);
    void cachedFriendLoad(hubCache.privacy, () => friendsApi.getPrivacy(), force)
      .then((nextPrivacy) => {
        if (active) setPrivacy(nextPrivacy);
      })
      .catch((privacyError) => {
        if (active) setError(privacyError instanceof Error ? privacyError.message : 'Friend privacy settings could not be loaded.');
      })
      .finally(() => {
        if (active) setPrivacyLoading(false);
      });
    return () => { active = false; };
  }, [currentProfileId, friendsApi, hubCache, refreshToken]);

  const changeDiscoverability = useCallback(async () => {
    const nextValue = !privacy.discoverable;
    setPrivacySaving(true);
    setError('');
    try {
      const saved = await friendsApi.updatePrivacy(nextValue);
      const nextPrivacy = { ...saved, profile: saved.profile ?? privacy.profile };
      hubCache.privacy.value = nextPrivacy;
      hubCache.privacy.loadedAt = Date.now();
      setPrivacy(nextPrivacy);
      setMessage(saved.discoverable
        ? 'Riders can now find you in search and trusted suggestions.'
        : 'You are hidden from rider search and suggestions. Secure invites still work.');
    } catch (privacyError) {
      setError(privacyError instanceof Error ? privacyError.message : 'That privacy choice could not be saved.');
    } finally {
      setPrivacySaving(false);
    }
  }, [friendsApi, hubCache, privacy.discoverable, privacy.profile]);

  const setTabLoading = useCallback((tab: FriendsTab, loading: boolean) => {
    setLoadingTabs((current) => {
      const next = new Set(current);
      loading ? next.add(tab) : next.delete(tab);
      return next;
    });
  }, []);

  const loadFriends = useCallback(async (append = false, force = false) => {
    const cursor = append ? friends.nextCursor : null;
    const sequence = ++requestSequenceRef.current.friends;
    append ? setLoadingMore(true) : (!loadedTabsRef.current.friends || Boolean(searchQuery)) && setTabLoading('friends', true);
    setError('');
    try {
      const page = !append && !searchQuery
        ? await cachedFriendLoad(hubCache.friends, () => friendsApi.listFriends(), force)
        : await friendsApi.listFriends({ query: searchQuery, cursor });
      if (sequence !== requestSequenceRef.current.friends) return;
      loadedTabsRef.current.friends = true;
      setFriends((current) => ({
        ...page,
        items: append ? appendUnique(current.items, page.items, (item) => item.id) : page.items,
      }));
    } catch (loadError) {
      if (sequence === requestSequenceRef.current.friends) setError(loadError instanceof Error ? loadError.message : 'Friends could not be loaded.');
    } finally {
      if (sequence === requestSequenceRef.current.friends) {
        setTabLoading('friends', false);
        setLoadingMore(false);
      }
    }
  }, [friends.nextCursor, friendsApi, hubCache, searchQuery, setTabLoading]);

  const loadRequests = useCallback(async (append = false, direction: 'incoming' | 'outgoing' | 'all' = 'all', force = false) => {
    const cursor = append
      ? direction === 'incoming' ? requests.incomingNextCursor : requests.outgoingNextCursor
      : null;
    const sequence = ++requestSequenceRef.current.requests;
    append ? setLoadingMore(true) : (!loadedTabsRef.current.requests || Boolean(searchQuery)) && setTabLoading('requests', true);
    setError('');
    try {
      const page = !append && !searchQuery && direction === 'all'
        ? await cachedFriendLoad(hubCache.requests, () => friendsApi.listRequests(), force)
        : await friendsApi.listRequests({ query: searchQuery, cursor, direction });
      if (sequence !== requestSequenceRef.current.requests) return;
      loadedTabsRef.current.requests = true;
      setRequests((current) => append ? {
        incoming: direction === 'incoming' ? appendUnique(current.incoming, page.incoming, (item) => item.id) : current.incoming,
        outgoing: direction === 'outgoing' ? appendUnique(current.outgoing, page.outgoing, (item) => item.id) : current.outgoing,
        incomingTotal: direction === 'incoming' ? page.incomingTotal : current.incomingTotal,
        outgoingTotal: direction === 'outgoing' ? page.outgoingTotal : current.outgoingTotal,
        incomingNextCursor: direction === 'incoming' ? page.incomingNextCursor : current.incomingNextCursor,
        outgoingNextCursor: direction === 'outgoing' ? page.outgoingNextCursor : current.outgoingNextCursor,
        total: direction === 'incoming'
          ? page.incomingTotal + current.outgoingTotal
          : current.incomingTotal + page.outgoingTotal,
      } : page);
    } catch (loadError) {
      if (sequence === requestSequenceRef.current.requests) setError(loadError instanceof Error ? loadError.message : 'Requests could not be loaded.');
    } finally {
      if (sequence === requestSequenceRef.current.requests) {
        setTabLoading('requests', false);
        setLoadingMore(false);
      }
    }
  }, [friendsApi, hubCache, requests.incomingNextCursor, requests.outgoingNextCursor, searchQuery, setTabLoading]);

  const loadSuggestions = useCallback(async (append = false, force = false) => {
    const cursor = append ? suggestions.nextCursor : null;
    const sequence = ++requestSequenceRef.current.suggestions;
    append ? setLoadingMore(true) : (!loadedTabsRef.current.suggestions || Boolean(searchQuery)) && setTabLoading('suggestions', true);
    setError('');
    try {
      const page = !append && !searchQuery
        ? await cachedFriendLoad(hubCache.suggestions, () => friendsApi.listSuggestions(), force)
        : await friendsApi.listSuggestions({ query: searchQuery, cursor });
      if (sequence !== requestSequenceRef.current.suggestions) return;
      loadedTabsRef.current.suggestions = true;
      setSuggestions((current) => ({
        ...page,
        items: append ? appendUnique(current.items, page.items, (item) => item.profile.id) : page.items,
      }));
    } catch (loadError) {
      if (sequence === requestSequenceRef.current.suggestions) setError(loadError instanceof Error ? loadError.message : 'Suggestions could not be loaded.');
    } finally {
      if (sequence === requestSequenceRef.current.suggestions) {
        setTabLoading('suggestions', false);
        setLoadingMore(false);
      }
    }
  }, [friendsApi, hubCache, searchQuery, setTabLoading, suggestions.nextCursor]);

  const loadSharedTracks = useCallback(async (append = false, force = false) => {
    const cursor = append ? sharedTracks.nextCursor : null;
    const sequence = ++requestSequenceRef.current['shared-tracks'];
    append
      ? setLoadingMore(true)
      : !loadedTabsRef.current['shared-tracks'] && setTabLoading('shared-tracks', true);
    setError('');
    try {
      const page = !append
        ? await cachedFriendLoad(sharesCache.received, () => sharesApi.listReceived(), force)
        : await sharesApi.listReceived({ cursor });
      if (sequence !== requestSequenceRef.current['shared-tracks']) return;
      loadedTabsRef.current['shared-tracks'] = true;
      setUnreadTrackShareCount(page.unreadTotal);
      sharesCache.count.value = { ...blankTrackSharePage, unreadTotal: page.unreadTotal };
      sharesCache.count.loadedAt = Date.now();
      setSharedTracks((current) => {
        const next = {
          ...page,
          items: append ? appendUnique(current.items, page.items, (item) => item.id) : page.items,
        };
        sharesCache.received.value = next;
        sharesCache.received.loadedAt = Date.now();
        return next;
      });
    } catch (loadError) {
      if (sequence === requestSequenceRef.current['shared-tracks']) {
        setError(loadError instanceof Error ? loadError.message : 'Shared tracks could not be loaded.');
      }
    } finally {
      if (sequence === requestSequenceRef.current['shared-tracks']) {
        setTabLoading('shared-tracks', false);
        setLoadingMore(false);
      }
    }
  }, [sharedTracks.nextCursor, sharesApi, sharesCache, setTabLoading]);

  const loadInvite = useCallback(async (force = false) => {
    const sequence = ++requestSequenceRef.current.invite;
    if (!loadedTabsRef.current.invite) setTabLoading('invite', true);
    setError('');
    try {
      const nextInvites = await cachedFriendLoad(hubCache.invites, () => friendsApi.listActiveInvites(), force);
      if (sequence === requestSequenceRef.current.invite) {
        loadedTabsRef.current.invite = true;
        setActiveInvites(nextInvites);
        setInvite((current) => current && nextInvites.some((candidate) => candidate.id === current.id)
          ? current
          : null);
      }
    } catch (loadError) {
      if (sequence === requestSequenceRef.current.invite) setError(loadError instanceof Error ? loadError.message : 'Your active invites could not be loaded.');
    } finally {
      if (sequence === requestSequenceRef.current.invite) setTabLoading('invite', false);
    }
  }, [friendsApi, hubCache, setTabLoading]);

  const refreshActiveTab = useCallback((force = false) => {
    if (activeTab === 'friends') return loadFriends(false, force);
    if (activeTab === 'requests') return loadRequests(false, 'all', force);
    if (activeTab === 'suggestions') return loadSuggestions(false, force);
    if (activeTab === 'shared-tracks') return loadSharedTracks(false, force);
    return loadInvite(force);
  }, [activeTab, loadFriends, loadInvite, loadRequests, loadSharedTracks, loadSuggestions]);

  useEffect(() => {
    const force = refreshTokenRef.current !== refreshToken;
    refreshTokenRef.current = refreshToken;
    void refreshActiveTab(force);
  }, [activeTab, searchQuery, refreshToken]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handleFocus = () => {
      if (document.visibilityState === 'visible') {
        setClaimRetryToken((current) => current + 1);
        void refreshActiveTab(true);
      }
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleFocus);
    };
  }, [refreshActiveTab]);

  useEffect(() => {
    const flushQueue = async () => {
      const result = await flushQueuedFriendRequests(currentProfileId, friendsApi);
      setQueuedTargetIds(new Set(result.remaining.map((request) => request.targetProfileId)));
      if (result.sent > 0) {
        setMessage(`${result.sent} saved friend request${result.sent === 1 ? '' : 's'} sent.`);
        void loadRequests(false, 'all', true);
        if (activeTab === 'suggestions') void loadSuggestions(false, true);
      }
    };
    const handleOnline = () => {
      setClaimRetryToken((current) => current + 1);
      void flushQueue();
    };
    void flushQueue();
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [activeTab, currentProfileId, friendsApi, loadRequests, loadSuggestions]);

  useEffect(() => {
    const token = (friendInviteToken ?? inviteTokenFromUrl()).trim();
    if (!token || claimedTokenRef.current === token) return;
    claimedTokenRef.current = token;
    setMessage('Connecting you with your friend…');
    setError('');
    void friendsApi.claimInvite(token)
      .then(() => {
        setMessage('Friend connection added. Welcome to their TrackLab network.');
        onFriendGraphChange?.();
        setActiveTab('friends');
        void loadFriends(false, true);
        void loadRequests(false, 'all', true);
        if (friendInviteToken == null) removeInviteTokenFromUrl();
      })
      .catch((claimError) => {
        const terminalClientError = claimError instanceof FriendsApiError
          && claimError.status >= 400
          && claimError.status < 500
          && claimError.status !== 429;
        if (!terminalClientError) {
          claimedTokenRef.current = '';
          setError('TrackLab could not claim that invitation yet. The link is preserved and will retry when you reconnect.');
          return;
        }
        setError(claimError.message || 'That friend invitation could not be accepted.');
        if (friendInviteToken == null) removeInviteTokenFromUrl();
      });
  }, [claimRetryToken, friendInviteToken, friendsApi, loadFriends, loadRequests, onFriendGraphChange]);

  const runAction = useCallback(async (
    key: string,
    task: () => Promise<void>,
    successMessage: string,
    reload: FriendsTab[],
    friendGraphChanged = false,
  ) => {
    setActionKeys((current) => new Set(current).add(key));
    setError('');
    try {
      await task();
      setMessage(successMessage);
      if (friendGraphChanged) onFriendGraphChange?.();
      if (reload.includes('friends')) void loadFriends(false, true);
      if (reload.includes('requests')) void loadRequests(false, 'all', true);
      if (reload.includes('suggestions')) void loadSuggestions(false, true);
      return true;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'That friend action could not be completed.');
      return false;
    } finally {
      setActionKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }, [loadFriends, loadRequests, loadSuggestions, onFriendGraphChange]);

  const handleFriendRequest = useCallback(async (profile: FriendProfile) => {
    const key = `send:${profile.id}`;
    setActionKeys((current) => new Set(current).add(key));
    setError('');
    const clientRequestId = createClientRequestId();
    try {
      await friendsApi.sendFriendRequest(profile.id, clientRequestId);
      setMessage(`Friend request sent to ${profile.displayName}. They can accept it whenever they sign in.`);
      void loadRequests(false, 'all', true);
      void loadSuggestions(false, true);
    } catch (sendError) {
      if (isNetworkFailure(sendError)) {
        const queued = queueFriendRequest(currentProfileId, profile.id, clientRequestId);
        if (queued) {
          setQueuedTargetIds((current) => new Set(current).add(profile.id));
          setMessage(`Request saved for ${profile.displayName}. TrackLab will send it when this device reconnects.`);
        } else {
          setError('TrackLab could not safely save that request on this device.');
        }
      } else {
        setError(sendError instanceof Error ? sendError.message : 'That friend request could not be sent.');
      }
    } finally {
      setActionKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }, [currentProfileId, friendsApi, loadRequests, loadSuggestions]);

  const handleBlock = useCallback((profile: FriendProfile) => {
    if (!window.confirm(`Block ${profile.displayName}? You will no longer see or receive friend activity from this rider.`)) return;
    void runAction(`block:${profile.id}`, () => friendsApi.blockProfile(profile.id), `${profile.displayName} was blocked.`, ['friends', 'requests', 'suggestions'], true);
  }, [friendsApi, runAction]);

  const loadBlockedProfiles = useCallback(async (append = false) => {
    setBlockedLoading(true);
    setError('');
    try {
      const page = await friendsApi.listBlocked({ cursor: append ? blockedProfiles.nextCursor : null });
      setBlockedProfiles((current) => ({
        ...page,
        items: append ? appendUnique(current.items, page.items, (item) => item.id) : page.items,
      }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Blocked riders could not be loaded.');
    } finally {
      setBlockedLoading(false);
    }
  }, [blockedProfiles.nextCursor, friendsApi]);

  const copyInvite = useCallback(async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.inviteUrl);
      setMessage('Friend invitation link copied.');
    } catch {
      setError('The link could not be copied. Press and hold the link to copy it manually.');
    }
  }, [invite]);

  const shareInvite = useCallback(async () => {
    if (!invite) return;
    if (!navigator.share) {
      await copyInvite();
      return;
    }
    try {
      await navigator.share({
        title: 'Join me on TrackLab BMX',
        text: 'Use this one-use invitation to add me on TrackLab BMX so we can race and train together.',
        url: invite.inviteUrl,
      });
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === 'AbortError') return;
      setError('The invitation could not be shared. You can still copy the link.');
    }
  }, [copyInvite, invite]);

  const createInvite = useCallback(async () => {
    setActionKeys((current) => new Set(current).add('invite:create'));
    setError('');
    try {
      const nextInvite = await friendsApi.getInvite();
      setInvite(nextInvite);
      setMessage('Secure invitation created. Send it to one intended rider.');
      await loadInvite(true);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'A secure invitation could not be created.');
    } finally {
      setActionKeys((current) => {
        const next = new Set(current);
        next.delete('invite:create');
        return next;
      });
    }
  }, [friendsApi, loadInvite]);

  const revokeInvite = useCallback(async () => {
    if (!invite || !window.confirm('Revoke this invitation link? It will stop working immediately.')) return;
    setActionKeys((current) => new Set(current).add('invite:revoke'));
    setError('');
    try {
      await friendsApi.revokeInvite(invite.id);
      setInvite(null);
      setMessage('Invitation revoked. You can create a new one when you are ready.');
      await loadInvite(true);
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'That invitation could not be revoked.');
    } finally {
      setActionKeys((current) => {
        const next = new Set(current);
        next.delete('invite:revoke');
        return next;
      });
    }
  }, [friendsApi, invite, loadInvite]);

  const revokeAllInvites = useCallback(async () => {
    if (
      activeInvites.length === 0
      || !window.confirm(`Revoke all ${activeInvites.length} active invitation link${activeInvites.length === 1 ? '' : 's'}? They will stop working immediately.`)
    ) return;
    setActionKeys((current) => new Set(current).add('invite:revoke-all'));
    setError('');
    try {
      const revoked = await friendsApi.revokeAllInvites();
      setInvite(null);
      setMessage(`${revoked} invitation link${revoked === 1 ? '' : 's'} revoked.`);
      await loadInvite(true);
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'Your invitation links could not be revoked.');
    } finally {
      setActionKeys((current) => {
        const next = new Set(current);
        next.delete('invite:revoke-all');
        return next;
      });
    }
  }, [activeInvites.length, friendsApi, loadInvite]);

  const markTrackShareOpened = useCallback((share: TrackShare) => {
    if (!share.openedAt) {
      const openedAt = new Date().toISOString();
      setSharedTracks((current) => {
        const next = {
          ...current,
          unreadTotal: Math.max(0, current.unreadTotal - 1),
          items: current.items.map((item) => item.id === share.id ? { ...item, openedAt } : item),
        };
        sharesCache.received.value = next;
        sharesCache.received.loadedAt = Date.now();
        return next;
      });
      setUnreadTrackShareCount((current) => {
        const next = Math.max(0, current - 1);
        sharesCache.count.value = { ...blankTrackSharePage, unreadTotal: next };
        sharesCache.count.loadedAt = Date.now();
        return next;
      });
    }
    void sharesApi.markOpened(share.id).catch(() => undefined);
  }, [sharesApi, sharesCache]);

  const dismissTrackShare = useCallback(async (share: TrackShare) => {
    const key = `track-share:dismiss:${share.id}`;
    setActionKeys((current) => new Set(current).add(key));
    setError('');
    try {
      await sharesApi.dismiss(share.id);
      setSharedTracks((current) => {
        const next = {
          ...current,
          items: current.items.filter((item) => item.id !== share.id),
          total: Math.max(0, current.total - 1),
          unreadTotal: Math.max(0, current.unreadTotal - (share.openedAt ? 0 : 1)),
        };
        sharesCache.received.value = next;
        sharesCache.received.loadedAt = Date.now();
        return next;
      });
      if (!share.openedAt) {
        setUnreadTrackShareCount((current) => {
          const next = Math.max(0, current - 1);
          sharesCache.count.value = { ...blankTrackSharePage, unreadTotal: next };
          sharesCache.count.loadedAt = Date.now();
          return next;
        });
      }
      setMessage(`Shared track from ${share.sender.displayName} dismissed.`);
    } catch (dismissError) {
      setError(dismissError instanceof Error ? dismissError.message : 'That shared track could not be dismissed.');
    } finally {
      setActionKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }, [sharesApi, sharesCache]);

  const allRequests = requests.incoming.length + requests.outgoing.length;
  const statusMessage = error || message;

  return (
    <div className="friends-view">
      <section className="friends-hero">
        <div>
          <span className="eyebrow">TrackLab network</span>
          <h1>Friends</h1>
          <p>Find riders you already know, invite your BMX community, and line up your next challenge.</p>
        </div>
        <div className="friends-privacy-note">
          <LockKeyhole size={19} aria-hidden="true" />
          <span><strong>Friends, not followers</strong><small>Ordinary requests need approval. Opening a personal invite accepts that connection; the verified club and founder are added when you join. A friend connection does not unlock private rides, live location, or training history.</small></span>
          <div className="friends-discovery-setting">
            <span>
              <strong>Appear in rider search and trusted suggestions</strong>
              <small>Off by default. When on, TrackLab may suggest you through shared clubs, recent races, or mutual friends. Secure invites work either way.</small>
              {privacy.profile?.handle && <small className="friends-own-handle">Your TrackLab handle: <b>@{privacy.profile.handle}</b></small>}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={privacy.discoverable}
              aria-label="Appear in rider search and trusted suggestions"
              className={`friends-privacy-switch ${privacy.discoverable ? 'on' : ''}`}
              disabled={privacyLoading || privacySaving}
              onClick={() => void changeDiscoverability()}
            ><span aria-hidden="true" /></button>
          </div>
          <button
            type="button"
            onClick={(event) => {
              blockedDialogTriggerRef.current = event.currentTarget;
              setBlockedOpen(true);
              void loadBlockedProfiles(false);
            }}
          ><ShieldOff size={15} /> Blocked riders</button>
        </div>
      </section>

      <section className="friends-panel" aria-label="Friend network">
        <div className="friends-tabs" role="tablist" aria-label="Friend sections">
          {tabs.map(({ id, label, icon: Icon }) => {
            const badge = id === 'requests'
              ? requests.incomingTotal
              : id === 'friends'
                ? friends.total
                : id === 'shared-tracks'
                  ? unreadTrackShareCount
                  : id === 'invite' ? activeInvites.length : 0;
            return (
              <button
                id={`friends-tab-${id}`}
                key={id}
                ref={(element) => { tabRefs.current[id] = element; }}
                type="button"
                role="tab"
                aria-selected={activeTab === id}
                aria-controls="friends-panel"
                tabIndex={activeTab === id ? 0 : -1}
                className={activeTab === id ? 'selected' : ''}
                onClick={() => activateTab(id)}
                onFocus={() => preloadTab(id)}
                onKeyDown={(event) => handleTabKeyDown(event, id)}
                onPointerEnter={() => preloadTab(id)}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{label}</span>
                {badge > 0 && <b aria-label={`${badge} ${id}`}>{badge > 99 ? '99+' : badge}</b>}
              </button>
            );
          })}
        </div>

        {activeTab !== 'invite' && activeTab !== 'shared-tracks' && (
          <label className="friends-search">
            <Search size={19} aria-hidden="true" />
            <span className="sr-only">{searchPlaceholder(activeTab)}</span>
            <input
              type="search"
              value={searchDraft}
              placeholder={searchPlaceholder(activeTab)}
              autoComplete="off"
              onChange={(event) => setSearchDraft(event.currentTarget.value.slice(0, 80))}
            />
            {searchDraft && (
              <button type="button" aria-label="Clear search" onClick={() => setSearchDraft('')}><X size={17} /></button>
            )}
          </label>
        )}

        {statusMessage && (
          <div className={`friends-status ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'} aria-live="polite">
            {error ? <WifiOff size={17} /> : <Check size={17} />}
            <span>{statusMessage}</span>
            <button type="button" aria-label="Dismiss message" onClick={() => { setMessage(''); setError(''); }}><X size={15} /></button>
          </div>
        )}

        <div
          id="friends-panel"
          role="tabpanel"
          aria-labelledby={`friends-tab-${activeTab}`}
          className="friends-tab-panel"
        >
          {loadingTabs.has(activeTab) && activeTab !== 'invite' && <LoadingCards />}

          {activeTab === 'friends' && !loadingTabs.has('friends') && (
            <>
              {friends.items.length === 0 ? <EmptyState tab="friends" searching={Boolean(searchQuery)} /> : (
                <div className="friend-card-grid">
                  {friends.items.map((profile) => {
                    const official = officialFriendLabel(profile.officialKind);
                    const presenceMeta = official
                      ? `${official} · Verified and added when you joined`
                      : profile.online
                        ? profile.available ? 'Online · ready to race' : 'Online'
                        : profile.clubName || profile.locationLabel || 'Offline';
                    const meta = profile.ghostPreview
                      ? `${presenceMeta} · ${friendGhostDetail(profile.ghostPreview, distanceUnit)}`
                      : presenceMeta;
                    return (
                      <ProfileCard key={profile.id} profile={profile} detail={<small>{meta}</small>} onOpenProfile={onOpenProfile}>
                        {onInviteToRace && profile.online && profile.available && (
                          <button type="button" className="primary" onClick={() => onInviteToRace(profile)}><Bike size={15} /> Invite to race</button>
                        )}
                        {onRaceGhost && profile.ghostPreview && (
                          <button
                            type="button"
                            title={`Race ${profile.displayName}'s ${profile.ghostPreview.trackName} ghost in ${readableGhostTime(profile.ghostPreview.finishTimeMs)}`}
                            onClick={() => {
                              const raceError = onRaceGhost(profile);
                              if (raceError) {
                                setMessage('');
                                setError(raceError);
                              }
                            }}
                          ><TimerReset size={15} /> Race ghost</button>
                        )}
                        <details className="friend-more-actions">
                          <summary aria-label={`More actions for ${profile.displayName}`}>More</summary>
                          <div>
                            <button
                              type="button"
                              disabled={actionKeys.has(`unfriend:${profile.id}`)}
                              onClick={() => {
                                if (!window.confirm(`Remove ${profile.displayName} from your friends?`)) return;
                                void runAction(
                                  `unfriend:${profile.id}`,
                                  () => friendsApi.unfriend(profile.id),
                                  `${profile.displayName} was removed from your friends.`,
                                  ['friends', 'suggestions'],
                                  true,
                                );
                              }}
                            ><UserMinus size={14} /> Unfriend</button>
                            <button type="button" onClick={() => handleBlock(profile)}><ShieldOff size={14} /> Block</button>
                            <button type="button" onClick={(event) => openReportDialog(profile, event.currentTarget)}><Flag size={14} /> Report</button>
                          </div>
                        </details>
                      </ProfileCard>
                    );
                  })}
                </div>
              )}
              {friends.nextCursor && <LoadMoreButton loading={loadingMore} onClick={() => void loadFriends(true)} />}
            </>
          )}

          {activeTab === 'requests' && !loadingTabs.has('requests') && (
            <>
              {allRequests === 0 ? <EmptyState tab="requests" searching={Boolean(searchQuery)} /> : (
                <div className="friend-request-sections">
                  {requests.incoming.length > 0 && (
                    <section aria-labelledby="incoming-requests-heading">
                      <header><div><span className="eyebrow">Waiting for you</span><h2 id="incoming-requests-heading">Received</h2></div><b>{requests.incomingTotal}</b></header>
                      <div className="friend-card-grid">
                        {requests.incoming.map((request) => (
                          <ProfileCard
                            key={request.id}
                            profile={request.profile}
                            detail={<small>Sent {readableDate(request.createdAt)} · works even while you were offline</small>}
                            onOpenProfile={onOpenProfile}
                          >
                            <button
                              type="button"
                              className="primary"
                              disabled={actionKeys.has(`accept:${request.id}`)}
                              onClick={() => void runAction(`accept:${request.id}`, () => friendsApi.acceptFriendRequest(request.id), `You and ${request.profile.displayName} are now friends.`, ['friends', 'requests', 'suggestions'], true)}
                            ><Check size={15} /> Accept</button>
                            <button
                              type="button"
                              disabled={actionKeys.has(`decline:${request.id}`)}
                              onClick={() => void runAction(`decline:${request.id}`, () => friendsApi.declineFriendRequest(request.id), 'Friend request declined.', ['requests', 'suggestions'])}
                            ><X size={15} /> Decline</button>
                            <details className="friend-more-actions"><summary aria-label={`Safety actions for ${request.profile.displayName}`}>Safety</summary><div><button type="button" onClick={() => handleBlock(request.profile)}><ShieldOff size={14} /> Block</button><button type="button" onClick={(event) => openReportDialog(request.profile, event.currentTarget)}><Flag size={14} /> Report</button></div></details>
                          </ProfileCard>
                        ))}
                      </div>
                      {requests.incomingNextCursor && <LoadMoreButton loading={loadingMore} onClick={() => void loadRequests(true, 'incoming')} />}
                    </section>
                  )}
                  {requests.outgoing.length > 0 && (
                    <section aria-labelledby="outgoing-requests-heading">
                      <header><div><span className="eyebrow">Sent by you</span><h2 id="outgoing-requests-heading">Pending</h2></div><b>{requests.outgoingTotal}</b></header>
                      <div className="friend-card-grid">
                        {requests.outgoing.map((request: FriendRequest) => (
                          <ProfileCard key={request.id} profile={request.profile} detail={<small>Waiting since {readableDate(request.createdAt)} · they can accept when they return</small>} onOpenProfile={onOpenProfile}>
                            <button
                              type="button"
                              disabled={actionKeys.has(`cancel:${request.id}`)}
                              onClick={() => void runAction(`cancel:${request.id}`, () => friendsApi.cancelFriendRequest(request.id), 'Friend request canceled.', ['requests', 'suggestions'])}
                            ><X size={15} /> Cancel request</button>
                          </ProfileCard>
                        ))}
                      </div>
                      {requests.outgoingNextCursor && <LoadMoreButton loading={loadingMore} onClick={() => void loadRequests(true, 'outgoing')} />}
                    </section>
                  )}
                </div>
              )}
            </>
          )}

          {activeTab === 'suggestions' && !loadingTabs.has('suggestions') && (
            <>
              <div className="friend-suggestion-note">
                <Sparkles size={18} />
                <span><strong>{searchQuery ? 'Rider search' : 'Suggested for you'}</strong><small>Suggestions use shared clubs, recent races, and mutual friends—not private training activity.</small></span>
              </div>
              {suggestions.items.length === 0 ? <EmptyState tab="suggestions" searching={Boolean(searchQuery)} /> : (
                <div className="friend-card-grid">
                  {suggestions.items.map(({ profile, reason }) => {
                    const queued = queuedTargetIds.has(profile.id);
                    return (
                      <ProfileCard
                        key={profile.id}
                        profile={profile}
                        detail={<small>{suggestionDetail(profile, reason)}</small>}
                        onOpenProfile={onOpenProfile}
                      >
                        {profile.relationship === 'incoming-request' ? (
                          <button type="button" className="primary" onClick={() => setActiveTab('requests')}>
                            <Inbox size={15} /> Review request
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={profile.relationship === 'none' ? 'primary' : ''}
                            disabled={profile.relationship !== 'none' || queued || actionKeys.has(`send:${profile.id}`)}
                            onClick={() => void handleFriendRequest(profile)}
                          >
                            {queued ? <WifiOff size={15} /> : profile.relationship === 'friend' ? <Check size={15} /> : <UserRoundPlus size={15} />}
                            {queued
                              ? 'Saved offline'
                              : profile.relationship === 'friend'
                                ? 'Friend'
                                : profile.relationship === 'outgoing-request'
                                  ? 'Request sent'
                                  : profile.relationship === 'self'
                                    ? 'Your profile'
                                    : profile.relationship === 'blocked'
                                      ? 'Blocked'
                                      : actionKeys.has(`send:${profile.id}`) ? 'Sending…' : 'Add friend'}
                          </button>
                        )}
                        <details className="friend-more-actions"><summary aria-label={`Safety actions for ${profile.displayName}`}>Safety</summary><div><button type="button" onClick={() => handleBlock(profile)}><ShieldOff size={14} /> Block</button><button type="button" onClick={(event) => openReportDialog(profile, event.currentTarget)}><Flag size={14} /> Report</button></div></details>
                      </ProfileCard>
                    );
                  })}
                </div>
              )}
              {suggestions.nextCursor && <LoadMoreButton loading={loadingMore} onClick={() => void loadSuggestions(true)} />}
            </>
          )}

          {activeTab === 'shared-tracks' && !loadingTabs.has('shared-tracks') && (
            <>
              {sharedTracks.items.length === 0 ? <EmptyState tab="shared-tracks" searching={false} /> : (
                <div className="friend-track-share-list">
                  {sharedTracks.items.map((share) => {
                    const href = trackLocatorShareUrl(share.trackId);
                    const senderName = share.sender.displayName || `@${share.sender.handle}`;
                    return (
                      <article
                        key={share.id}
                        className={`friend-track-share-card ${share.openedAt ? '' : 'unread'}`}
                      >
                        <span className="friend-track-share-icon" aria-hidden="true"><MapPinned size={21} /></span>
                        <div className="friend-track-share-copy">
                          <span className="eyebrow">{share.openedAt ? 'Shared track' : 'New shared track'}</span>
                          <h2>{share.trackName}</h2>
                          {share.trackLocation && <p>{share.trackLocation}</p>}
                          <span className="friend-track-share-sender">
                            <RiderAvatar name={senderName} photoUrl={share.sender.photoUrl} />
                            <small>
                              Shared by <strong>{senderName}</strong> · @{share.sender.handle} · {readableDate(share.createdAt)}
                            </small>
                          </span>
                        </div>
                        <div className="friend-track-share-actions">
                          {href && (
                            <a className="primary" href={href} onClick={() => markTrackShareOpened(share)}>
                              <ExternalLink size={15} aria-hidden="true" /> Open track
                            </a>
                          )}
                          <button
                            type="button"
                            disabled={actionKeys.has(`track-share:dismiss:${share.id}`)}
                            onClick={() => void dismissTrackShare(share)}
                          >
                            <X size={15} aria-hidden="true" />
                            {actionKeys.has(`track-share:dismiss:${share.id}`) ? 'Dismissing…' : 'Dismiss'}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
              {sharedTracks.nextCursor && (
                <LoadMoreButton loading={loadingMore} onClick={() => void loadSharedTracks(true)} />
              )}
            </>
          )}

          {activeTab === 'invite' && (
            <div className="friend-invite-panel">
              {loadingTabs.has('invite') && <div className="friend-invite-loading" role="status"><LoaderCircle className="spin" size={22} /> Loading secure invitation links…</div>}
              {!loadingTabs.has('invite') && (
                <div className="friend-invite-management">
                  <span>
                    <strong>{activeInvites.length} active invitation link{activeInvites.length === 1 ? '' : 's'}</strong>
                    <small>Existing link addresses are never shown again. Create a new link when you need another copy.</small>
                  </span>
                  <button
                    type="button"
                    disabled={activeInvites.length === 0 || actionKeys.has('invite:revoke-all')}
                    onClick={() => void revokeAllInvites()}
                  ><Trash2 size={16} /> {actionKeys.has('invite:revoke-all') ? 'Revoking…' : 'Revoke all links'}</button>
                </div>
              )}
              {!loadingTabs.has('invite') && invite && (
                <>
                  <div className="friend-invite-copy">
                    <span className="eyebrow">Your invitation</span>
                    <h2>Bring your BMX friends to TrackLab</h2>
                    <p>A rider who opens this secure link can sign in or create an account, then connect with you. The link never reveals your email address.</p>
                    <div className="friend-invite-link">
                      <Link2 size={18} aria-hidden="true" />
                      <a href={invite.inviteUrl}>{invite.inviteUrl}</a>
                      <button type="button" onClick={() => void copyInvite()}><Copy size={16} /> Copy</button>
                    </div>
                    <button className="friend-share-button" type="button" onClick={() => void shareInvite()}><Share2 size={17} /> Share invitation</button>
                    <button type="button" disabled={actionKeys.has('invite:revoke')} onClick={() => void revokeInvite()}><Trash2 size={16} /> Revoke this link</button>
                    <small>Send this one-use link to one person through Messages, WhatsApp, Facebook, Instagram, TikTok, email, or another app in your device’s share menu.</small>
                  </div>
                  <div className="friend-qr-card">
                    <span><QrCode size={18} /> Scan to add me</span>
                    <img src={invite.qrCodeUrl} alt="QR code for this TrackLab friend invitation" />
                    <small>{invite.expiresAt ? `One-use link · expires ${readableDate(invite.expiresAt)}.` : 'Secure one-use invitation'}</small>
                  </div>
                </>
              )}
              {!loadingTabs.has('invite') && !invite && !error && (
                <div className="friend-invite-reset">
                  <UserRoundPlus size={28} aria-hidden="true" />
                  <strong>Create a secure invitation</strong>
                  <span>Each link is single-use, expires automatically, and should be sent only to its intended rider.</span>
                  <button className="friend-share-button" type="button" disabled={actionKeys.has('invite:create')} onClick={() => void createInvite()}>
                    <Link2 size={17} /> {actionKeys.has('invite:create') ? 'Creating…' : 'Create a new secure invite'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {reportingProfile && (
        <div className="friend-dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setReportingProfile(null);
        }}>
          <section ref={reportDialogRef} className="friend-report-dialog" role="dialog" aria-modal="true" aria-labelledby="friend-report-heading">
            <header><div><span className="eyebrow">Rider safety</span><h2 id="friend-report-heading">Report {reportingProfile.displayName}</h2></div><button type="button" aria-label="Close report dialog" onClick={() => setReportingProfile(null)}><X size={18} /></button></header>
            <p>Choose the issue that best describes what happened. TrackLab will not tell the rider who submitted the report.</p>
            <label>Reason<select value={reportReason} onChange={(event) => setReportReason(event.currentTarget.value as FriendReportReason)}>{reportReasons.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}</select></label>
            <div className="friend-dialog-actions">
              <button type="button" onClick={() => setReportingProfile(null)}>Cancel</button>
              <button
                type="button"
                className="danger"
                disabled={actionKeys.has(`report:${reportingProfile.id}`)}
                onClick={() => {
                  const profile = reportingProfile;
                  void runAction(`report:${profile.id}`, () => friendsApi.reportProfile(profile.id, reportReason), 'Report received. TrackLab will review it.', [])
                    .then((saved) => { if (saved) setReportingProfile(null); });
                }}
              ><Flag size={15} /> Submit report</button>
            </div>
          </section>
        </div>
      )}

      {blockedOpen && (
        <div className="friend-dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setBlockedOpen(false);
        }}>
          <section ref={blockedDialogRef} className="friend-report-dialog friend-blocked-dialog" role="dialog" aria-modal="true" aria-labelledby="friend-blocked-heading">
            <header><div><span className="eyebrow">Privacy controls</span><h2 id="friend-blocked-heading">Blocked riders</h2></div><button type="button" aria-label="Close blocked riders" onClick={() => setBlockedOpen(false)}><X size={18} /></button></header>
            <p>Blocked riders cannot find you, send requests, or interact with your TrackLab activity.</p>
            {blockedLoading && blockedProfiles.items.length === 0 ? (
              <div className="friend-invite-loading" role="status"><LoaderCircle className="spin" size={20} /> Loading blocked riders…</div>
            ) : blockedProfiles.items.length === 0 ? (
              <div className="friend-blocked-empty"><ShieldOff size={24} /><span>You have not blocked any riders.</span></div>
            ) : (
              <div className="friend-blocked-list">
                {blockedProfiles.items.map((profile) => (
                  <div key={profile.id}>
                    <ProfileIdentity profile={profile} />
                    <button
                      type="button"
                      disabled={actionKeys.has(`unblock:${profile.id}`)}
                      onClick={() => void runAction(`unblock:${profile.id}`, () => friendsApi.unblockProfile(profile.id), `${profile.displayName} was unblocked.`, ['suggestions'], true)
                        .then((saved) => { if (saved) void loadBlockedProfiles(false); })}
                    >Unblock</button>
                  </div>
                ))}
                {blockedProfiles.nextCursor && <LoadMoreButton loading={blockedLoading} onClick={() => void loadBlockedProfiles(true)} />}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
