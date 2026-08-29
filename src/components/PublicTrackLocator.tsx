import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  Globe2,
  Instagram,
  Landmark,
  MapPin,
  Music2,
  Navigation,
  Phone,
  Search,
  Share2,
  Star,
  Users,
  X,
  Youtube,
} from 'lucide-react';
import {
  copyTrackLocatorLink,
  trackGoogleMapsDirectionsUrl,
  trackGoogleEarthUrl,
  normalizeTrackLocatorId,
  trackLocatorShareUrl,
} from '../lib/mapLinks';
import { trackExternalLinks } from '../lib/trackExternalLinks';
import { createTrackFavoritesApi } from '../lib/trackFavorites';
import { createFriendsApi, type FriendProfile } from '../lib/friends';
import type { TrackLocatorRecord, TrackRecord } from '../types';
import { PublicTrackMap } from './PublicTrackMap';

type PublicTrackLocatorProps = {
  accountId?: string | null;
  catalogReady: boolean;
  tracks: TrackRecord[];
};

const allCountries = 'All countries';
const allRegions = 'All states / regions';
const maximumVisibleResults = 24;

function trackLocation(track: TrackLocatorRecord) {
  return [track.city, track.state, track.country].filter(Boolean).join(', ');
}

function trackSearchText(track: TrackLocatorRecord) {
  return [
    track.name,
    track.address,
    track.city,
    track.county,
    track.district,
    track.state,
    track.country,
    track.postalCode,
  ].filter(Boolean).join(' ').toLowerCase();
}

function initialLocatorRequest() {
  if (typeof window === 'undefined') return { id: null, invalid: false };
  const params = new URLSearchParams(window.location.search);
  const id = normalizeTrackLocatorId(params.get('locator')) || null;
  return { id, invalid: params.has('locator') && !id };
}

export function PublicTrackLocator({ accountId = null, catalogReady, tracks }: PublicTrackLocatorProps) {
  const [initialLocator] = useState(initialLocatorRequest);
  const [query, setQuery] = useState('');
  const [country, setCountry] = useState(allCountries);
  const [region, setRegion] = useState(allRegions);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(initialLocator.id);
  const [linkedTrackId, setLinkedTrackId] = useState<string | null>(initialLocator.id);
  const [invalidLinkedTrack, setInvalidLinkedTrack] = useState(initialLocator.invalid);
  const [publicTracks, setPublicTracks] = useState<TrackLocatorRecord[] | null>(null);
  const [publicDirectoryFailed, setPublicDirectoryFailed] = useState(false);
  const [trackCategory, setTrackCategory] = useState<'all' | 'favorites'>('all');
  const [favoriteTrackIds, setFavoriteTrackIds] = useState<Set<string>>(new Set());
  const [favoritesLoading, setFavoritesLoading] = useState(false);
  const [favoriteSaving, setFavoriteSaving] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [shareFriends, setShareFriends] = useState<FriendProfile[]>([]);
  const [shareSearch, setShareSearch] = useState('');
  const [shareLoading, setShareLoading] = useState(false);
  const [sharingProfileId, setSharingProfileId] = useState('');
  const accountGenerationRef = useRef(0);
  const favoriteMutationRef = useRef<object | null>(null);
  const shareDialogRef = useRef<HTMLElement | null>(null);
  const shareTriggerRef = useRef<HTMLButtonElement | null>(null);
  const directoryTracks: TrackLocatorRecord[] = publicTracks ?? tracks;
  const directoryReady = publicTracks !== null || (publicDirectoryFailed && catalogReady);

  useEffect(() => {
    let cancelled = false;

    fetch('/data/track-locator.json', { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Public track directory returned ${response.status}`);
        }
        return response.json() as Promise<{ tracks?: TrackLocatorRecord[] }>;
      })
      .then((directory) => {
        if (cancelled) {
          return;
        }
        if (!Array.isArray(directory.tracks) || directory.tracks.length === 0) {
          throw new Error('Public track directory is empty');
        }
        setPublicTracks(directory.tracks);
      })
      .catch((error: Error) => {
        if (!cancelled) {
          console.warn(`Using the application track catalog for public search: ${error.message}`);
          setPublicDirectoryFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const syncLinkedTrack = () => {
      const request = initialLocatorRequest();
      if (!request.id && !request.invalid) return;
      setLinkedTrackId(request.id);
      setInvalidLinkedTrack(request.invalid);
      setSelectedTrackId(request.id);
      setTrackCategory('all');
      setCountry(allCountries);
      setRegion(allRegions);
    };
    window.addEventListener('popstate', syncLinkedTrack);
    return () => window.removeEventListener('popstate', syncLinkedTrack);
  }, []);

  const sortedTracks = useMemo(
    () => [...directoryTracks].sort((left, right) => (
      left.country.localeCompare(right.country)
      || left.state.localeCompare(right.state)
      || left.name.localeCompare(right.name)
    )),
    [directoryTracks],
  );
  const countries = useMemo(
    () => [...new Set(sortedTracks.map((track) => track.country))],
    [sortedTracks],
  );
  const regions = useMemo(
    () => [...new Set(sortedTracks
      .filter((track) => country === allCountries || track.country === country)
      .map((track) => track.state))].sort(),
    [country, sortedTracks],
  );
  const filteredTracks = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return sortedTracks.filter((track) => (
      (trackCategory === 'all' || favoriteTrackIds.has(track.id))
      && (country === allCountries || track.country === country)
      && (region === allRegions || track.state === region)
      && (terms.length === 0 || terms.every((term) => trackSearchText(track).includes(term)))
    ));
  }, [country, favoriteTrackIds, query, region, sortedTracks, trackCategory]);
  const linkedTrack = linkedTrackId ? sortedTracks.find((track) => track.id === linkedTrackId) ?? null : null;
  const linkedTrackRequested = invalidLinkedTrack || Boolean(linkedTrackId);
  const linkedTrackUnavailable = Boolean(directoryReady && linkedTrackRequested && !linkedTrack);
  const selectedTrack = linkedTrackRequested
    ? linkedTrack
    : filteredTracks.find((track) => track.id === selectedTrackId)
      ?? (filteredTracks.length > 0
        ? filteredTracks[0]
        : trackCategory === 'favorites'
          ? null
          : sortedTracks.find((track) => track.id === selectedTrackId) ?? sortedTracks[0] ?? null);
  const selectedExternalLinks = selectedTrack ? trackExternalLinks(selectedTrack) : {};
  const selectedFavorite = Boolean(selectedTrack && favoriteTrackIds.has(selectedTrack.id));
  const shareableFriends = useMemo(() => {
    const search = shareSearch.trim().replace(/^@/, '').toLocaleLowerCase();
    return shareFriends.filter((profile) => (
      profile.canShareTrack === true
      && (!search
        || profile.displayName.toLocaleLowerCase().includes(search)
        || profile.handle.toLocaleLowerCase().includes(search))
    ));
  }, [shareFriends, shareSearch]);

  useEffect(() => {
    accountGenerationRef.current += 1;
    const generation = accountGenerationRef.current;
    setFavoriteTrackIds(new Set());
    setTrackCategory('all');
    setActionMessage('');
    setActionError('');
    setShareOpen(false);
    setShareFriends([]);
    favoriteMutationRef.current = null;
    setFavoriteSaving(false);
    if (!accountId) {
      setFavoritesLoading(false);
      return;
    }
    setFavoritesLoading(true);
    void createTrackFavoritesApi().list()
      .then((trackIds) => {
        if (generation === accountGenerationRef.current) setFavoriteTrackIds(new Set(trackIds));
      })
      .catch((error: unknown) => {
        if (generation === accountGenerationRef.current) {
          setActionError(error instanceof Error ? error.message : 'Your favorite tracks could not be loaded.');
        }
      })
      .finally(() => {
        if (generation === accountGenerationRef.current) setFavoritesLoading(false);
      });
  }, [accountId]);

  useEffect(() => {
    if (!directoryReady || !selectedTrack || selectedTrack.id === selectedTrackId) {
      return;
    }

    setSelectedTrackId(selectedTrack.id);
  }, [directoryReady, selectedTrack, selectedTrackId]);

  useEffect(() => {
    if (!directoryReady || !linkedTrackId) return;
    if (!linkedTrack) return;
    setSelectedTrackId(linkedTrack.id);
    setCountry(allCountries);
    setRegion(allRegions);
    setTrackCategory('all');
    setLinkedTrackId(null);
    setInvalidLinkedTrack(false);
    window.requestAnimationFrame(() => {
      document.getElementById('track-locator')?.scrollIntoView({ block: 'start' });
    });
  }, [directoryReady, linkedTrack, linkedTrackId]);

  const selectTrack = (track: TrackLocatorRecord) => {
    setLinkedTrackId(null);
    setInvalidLinkedTrack(false);
    setSelectedTrackId(track.id);
    const href = trackLocatorShareUrl(track.id, window.location.origin);
    if (href) window.history.replaceState(window.history.state, '', href);
  };

  const handleCountryChange = (nextCountry: string) => {
    setCountry(nextCountry);
    setRegion(allRegions);
  };

  const chooseCategory = (nextCategory: 'all' | 'favorites') => {
    setTrackCategory(nextCategory);
    setCountry(allCountries);
    setRegion(allRegions);
  };

  const promptForAccount = () => {
    setActionMessage('Sign in below to save favorites and share tracks with your TrackLab friends.');
    setActionError('');
    document.querySelector('.profile-gate')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const toggleFavorite = async () => {
    if (!selectedTrack) return;
    if (!accountId) {
      promptForAccount();
      return;
    }
    if (favoritesLoading || favoriteMutationRef.current) return;
    const generation = accountGenerationRef.current;
    const mutation = {};
    favoriteMutationRef.current = mutation;
    setFavoriteSaving(true);
    const wasFavorite = favoriteTrackIds.has(selectedTrack.id);
    setFavoriteTrackIds((current) => {
      const next = new Set(current);
      if (wasFavorite) next.delete(selectedTrack.id);
      else next.add(selectedTrack.id);
      return next;
    });
    setActionMessage('');
    setActionError('');
    try {
      const api = createTrackFavoritesApi();
      if (wasFavorite) await api.remove(selectedTrack.id);
      else await api.save(selectedTrack.id);
      if (generation === accountGenerationRef.current) {
        setActionMessage(wasFavorite ? 'Removed from your favorite tracks.' : 'Saved to your favorite tracks.');
      }
    } catch (error) {
      if (generation !== accountGenerationRef.current) return;
      setFavoriteTrackIds((current) => {
        const next = new Set(current);
        if (wasFavorite) next.add(selectedTrack.id);
        else next.delete(selectedTrack.id);
        return next;
      });
      setActionError(error instanceof Error ? error.message : 'That favorite could not be saved.');
    } finally {
      if (generation === accountGenerationRef.current && favoriteMutationRef.current === mutation) {
        favoriteMutationRef.current = null;
        setFavoriteSaving(false);
      }
    }
  };

  const copySelectedTrackLink = async () => {
    if (!selectedTrack) return;
    setActionError('');
    try {
      await copyTrackLocatorLink(selectedTrack.id);
      setActionMessage('Track link copied.');
    } catch (error) {
      setActionMessage('');
      setActionError(error instanceof Error ? error.message : 'The track link could not be copied.');
    }
  };

  const openShareDialog = async () => {
    if (!selectedTrack) return;
    if (!accountId) {
      promptForAccount();
      return;
    }
    const generation = accountGenerationRef.current;
    setShareOpen(true);
    setShareSearch('');
    setShareLoading(true);
    setActionMessage('');
    setActionError('');
    window.requestAnimationFrame(() => shareDialogRef.current?.querySelector<HTMLElement>('button, input, a[href]')?.focus());
    try {
      const api = createFriendsApi();
      const friends: FriendProfile[] = [];
      let cursor: string | null = null;
      do {
        const page = await api.listFriends({ cursor, limit: 50 });
        friends.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor && friends.length < 500);
      if (generation === accountGenerationRef.current) setShareFriends(friends);
    } catch (error) {
      if (generation === accountGenerationRef.current) {
        setActionError(error instanceof Error ? error.message : 'Your friends could not be loaded.');
      }
    } finally {
      if (generation === accountGenerationRef.current) setShareLoading(false);
    }
  };

  const closeShareDialog = () => {
    setShareOpen(false);
    window.requestAnimationFrame(() => shareTriggerRef.current?.focus());
  };

  const trapShareDialogFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), a[href]',
    )].filter((element) => element.offsetParent !== null);
    if (controls.length === 0) return;
    const first = controls[0];
    const last = controls.at(-1)!;
    if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const shareWithFriend = async (profile: FriendProfile) => {
    if (!selectedTrack || !accountId || profile.canShareTrack !== true) return;
    const generation = accountGenerationRef.current;
    setSharingProfileId(profile.id);
    setActionMessage('');
    setActionError('');
    try {
      const { createTrackSharesApi } = await import('../lib/trackShares');
      await createTrackSharesApi().send(profile.id, selectedTrack.id);
      if (generation === accountGenerationRef.current) {
        setActionMessage(`${selectedTrack.name} was shared with ${profile.displayName}.`);
      }
    } catch (error) {
      if (generation === accountGenerationRef.current) {
        setActionError(error instanceof Error ? error.message : 'That track could not be shared.');
      }
    } finally {
      if (generation === accountGenerationRef.current) setSharingProfileId('');
    }
  };

  useEffect(() => {
    if (!shareOpen) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeShareDialog();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [shareOpen]);

  return (
    <section className="public-locator-band" id="track-locator" aria-labelledby="public-track-locator-title">
      <div className="public-locator-inner">
        <header className="public-locator-header">
          <div>
            <span className="eyebrow"><Globe2 size={14} /> Global BMX directory</span>
            <h2 id="public-track-locator-title">Find a BMX racing track</h2>
            <p>Search verified federation directories and community track records, then inspect each track in your preferred mapping app.</p>
          </div>
          <strong>{directoryReady
            ? `${directoryTracks.length.toLocaleString()} ${directoryTracks.length === 1 ? 'track' : 'tracks'}`
            : 'Loading directory'}</strong>
        </header>

        <div className="public-locator-layout">
          <div className="public-locator-search-panel">
            <label className="public-track-search">
              <span>Search tracks</span>
              <div>
                <Search size={17} />
                <input
                  type="search"
                  placeholder="Track, city, state, or country"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            </label>
            <div className="public-locator-filters">
              <label>
                <span>Country</span>
                <select value={country} onChange={(event) => handleCountryChange(event.target.value)}>
                  <option>{allCountries}</option>
                  {countries.map((item) => <option key={item}>{item}</option>)}
                </select>
              </label>
              <label>
                <span>State / region</span>
                <select value={region} onChange={(event) => setRegion(event.target.value)}>
                  <option>{allRegions}</option>
                  {regions.map((item) => <option key={item}>{item}</option>)}
                </select>
              </label>
            </div>

            <div className="public-track-categories" role="group" aria-label="Track category">
              <button
                type="button"
                aria-pressed={trackCategory === 'all'}
                className={trackCategory === 'all' ? 'selected' : ''}
                onClick={() => chooseCategory('all')}
              >All tracks</button>
              <button
                type="button"
                aria-pressed={trackCategory === 'favorites'}
                className={trackCategory === 'favorites' ? 'selected' : ''}
                onClick={() => accountId ? chooseCategory('favorites') : promptForAccount()}
              ><Star size={15} fill={trackCategory === 'favorites' ? 'currentColor' : 'none'} /> Favorites{accountId ? ` (${favoriteTrackIds.size})` : ''}</button>
            </div>

            <div className="public-track-results-heading">
              <strong>{filteredTracks.length.toLocaleString()} found</strong>
              {filteredTracks.length > maximumVisibleResults && <span>Refine the search to see more</span>}
            </div>
            <div className="public-track-results" aria-label="BMX track search results">
              {filteredTracks.slice(0, maximumVisibleResults).map((track) => (
                <button
                  className={track.id === selectedTrack?.id ? 'selected' : ''}
                  key={track.id}
                  type="button"
                  aria-pressed={track.id === selectedTrack?.id}
                  onClick={() => selectTrack(track)}
                >
                  <strong>{track.name}{favoriteTrackIds.has(track.id) && <Star size={14} fill="currentColor" aria-label="Favorite" />}</strong>
                  <span><MapPin size={13} /> {trackLocation(track)}</span>
                </button>
              ))}
              {directoryReady && filteredTracks.length === 0 && (
                <div className="public-track-empty">{trackCategory === 'favorites' && favoriteTrackIds.size === 0
                  ? favoritesLoading ? 'Loading your favorite tracks…' : 'You have not saved any favorite tracks yet.'
                  : 'No tracks match those filters.'}</div>
              )}
            </div>
          </div>

          <div className="public-locator-preview">
            {selectedTrack ? (
              <>
                <PublicTrackMap track={selectedTrack} />
                {(selectedExternalLinks.websiteUrl
                  || selectedExternalLinks.facebookUrl
                  || selectedExternalLinks.instagramUrl
                  || selectedExternalLinks.tiktokUrl
                  || selectedExternalLinks.youtubeUrl
                  || selectedExternalLinks.phoneHref
                  || selectedExternalLinks.federationUrl) && (
                  <nav
                    className="public-track-official-links"
                    aria-label={`Social and contact links for ${selectedTrack.name}`}
                  >
                    {selectedExternalLinks.websiteUrl && (
                      <a href={selectedExternalLinks.websiteUrl} target="_blank" rel="noopener noreferrer">
                        <Globe2 size={17} /> Official Website
                      </a>
                    )}
                    {selectedExternalLinks.facebookUrl && (
                      <a href={selectedExternalLinks.facebookUrl} target="_blank" rel="noopener noreferrer">
                        <Users size={17} /> Facebook
                      </a>
                    )}
                    {selectedExternalLinks.instagramUrl && (
                      <a href={selectedExternalLinks.instagramUrl} target="_blank" rel="noopener noreferrer">
                        <Instagram size={17} /> Instagram
                      </a>
                    )}
                    {selectedExternalLinks.tiktokUrl && (
                      <a href={selectedExternalLinks.tiktokUrl} target="_blank" rel="noopener noreferrer">
                        <Music2 size={17} /> TikTok
                      </a>
                    )}
                    {selectedExternalLinks.youtubeUrl && (
                      <a href={selectedExternalLinks.youtubeUrl} target="_blank" rel="noopener noreferrer">
                        <Youtube size={17} /> YouTube
                      </a>
                    )}
                    {selectedExternalLinks.phoneHref && selectedExternalLinks.phoneNumber && (
                      <a
                        className="public-track-phone-link"
                        href={selectedExternalLinks.phoneHref}
                        aria-label={`Call ${selectedTrack.name} at ${selectedExternalLinks.phoneNumber}`}
                      >
                        <Phone size={17} /> {selectedExternalLinks.phoneNumber}
                      </a>
                    )}
                    {selectedExternalLinks.federationUrl && selectedExternalLinks.federationName && (
                      <a
                        className="public-track-federation-link"
                        href={selectedExternalLinks.federationUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Federation: ${selectedExternalLinks.federationName}`}
                      >
                        <Landmark size={17} /> {selectedExternalLinks.federationName}
                      </a>
                    )}
                  </nav>
                )}
                <div className="public-track-details">
                  <div>
                    <span className="eyebrow">Selected track</span>
                    <h3>{selectedTrack.name}</h3>
                    <p>{selectedTrack.address ?? trackLocation(selectedTrack)}</p>
                    <small>Listed by {selectedTrack.source}</small>
                  </div>
                  <div className="public-track-link-groups" aria-label={`Map links for ${selectedTrack.name}`}>
                    <div className="public-track-link-group public-track-save-group" role="group" aria-label={`Save and share ${selectedTrack.name}`}>
                      <span>Save &amp; share</span>
                      <div className="public-track-actions">
                        <button type="button" aria-pressed={selectedFavorite} disabled={favoritesLoading || favoriteSaving} onClick={() => void toggleFavorite()}>
                          <Star size={16} fill={selectedFavorite ? 'currentColor' : 'none'} /> {selectedFavorite ? 'Saved' : 'Favorite'}
                        </button>
                        <button ref={shareTriggerRef} type="button" onClick={() => void openShareDialog()}><Share2 size={16} /> Share with friend</button>
                        <button type="button" onClick={() => void copySelectedTrackLink()}><Copy size={16} /> Copy link</button>
                      </div>
                    </div>
                    <div className="public-track-link-group" role="group" aria-label={`Directions to ${selectedTrack.name}`}>
                      <span>Directions</span>
                      <div className="public-track-actions">
                        <a href={trackGoogleMapsDirectionsUrl(selectedTrack)} target="_blank" rel="noopener noreferrer">
                          <Navigation size={16} /> Google Maps
                        </a>
                      </div>
                    </div>
                    <div className="public-track-link-group public-track-earth-group" role="group" aria-label="Explore in 3D—not directions">
                      <span>Explore in 3D</span>
                      <div className="public-track-actions">
                        <a
                          href={trackGoogleEarthUrl(selectedTrack)}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Explore ${selectedTrack.name} in Google Earth—not turn-by-turn directions`}
                        >
                          <ExternalLink size={16} /> Google Earth
                        </a>
                      </div>
                      <small>3D exploration—not turn-by-turn directions.</small>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="public-track-empty">{linkedTrackUnavailable
                ? 'This shared track is no longer listed in the TrackLab directory.'
                : 'Loading the global track directory.'}</div>
            )}
          </div>
        </div>
        {(actionMessage || actionError) && (
          <div className={`public-track-action-status ${actionError ? 'error' : ''}`} role={actionError ? 'alert' : 'status'} aria-live="polite">
            {actionError ? <X size={16} /> : <Check size={16} />}
            <span>{actionError || actionMessage}</span>
            <button type="button" aria-label="Dismiss track message" onClick={() => { setActionMessage(''); setActionError(''); }}><X size={15} /></button>
          </div>
        )}
      </div>
      {shareOpen && selectedTrack && (
        <div className="public-track-share-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeShareDialog();
        }}>
          <section ref={shareDialogRef} className="public-track-share-dialog" role="dialog" aria-modal="true" aria-labelledby="public-track-share-title" tabIndex={-1} onKeyDown={trapShareDialogFocus}>
            <header>
              <div><span className="eyebrow">Share a public track</span><h3 id="public-track-share-title">{selectedTrack.name}</h3></div>
              <button type="button" aria-label="Close track sharing" onClick={closeShareDialog}><X size={18} /></button>
            </header>
            <div className="public-track-share-outside">
              <span><strong>Outside TrackLab</strong><small>Anyone can open this public track page. Your account is never included.</small></span>
              <button type="button" onClick={() => void copySelectedTrackLink()}><Copy size={16} /> Copy link</button>
            </div>
            {(actionMessage || actionError) && (
              <div className={`public-track-action-status ${actionError ? 'error' : ''}`} role={actionError ? 'alert' : 'status'} aria-live="polite">
                {actionError ? <X size={16} /> : <Check size={16} />}
                <span>{actionError || actionMessage}</span>
              </div>
            )}
            <div className="public-track-share-friends">
              <label><span>Send inside TrackLab</span><div><Search size={17} /><input type="search" value={shareSearch} placeholder="Search your friends" onChange={(event) => setShareSearch(event.currentTarget.value.slice(0, 80))} /></div></label>
              {shareLoading ? <div className="public-track-share-empty" role="status">Loading your friends…</div> : shareableFriends.length > 0 ? (
                <div className="public-track-share-list">
                  {shareableFriends.map((profile) => (
                    <div key={profile.id}>
                      <span><strong>{profile.displayName}</strong><small>@{profile.handle}</small></span>
                      <button type="button" disabled={sharingProfileId === profile.id} onClick={() => void shareWithFriend(profile)}>
                        <Share2 size={15} /> {sharingProfileId === profile.id ? 'Sending…' : 'Send'}
                      </button>
                    </div>
                  ))}
                </div>
              ) : <div className="public-track-share-empty">{shareSearch ? 'No friends match that search.' : 'Add a rider as a friend before sharing tracks inside TrackLab.'}</div>}
            </div>
            <a className="public-track-share-preview" href={trackLocatorShareUrl(selectedTrack.id)}><ExternalLink size={15} /> Preview the shareable track link</a>
          </section>
        </div>
      )}
    </section>
  );
}
