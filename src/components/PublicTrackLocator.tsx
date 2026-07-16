import { useEffect, useMemo, useState } from 'react';
import { Apple, ExternalLink, Globe2, MapPin, Navigation, Search, Users } from 'lucide-react';
import {
  trackAppleMapsUrl,
  trackGoogleMapsUrl,
  trackGoogleEarthUrl,
} from '../lib/mapLinks';
import type { TrackLocatorRecord, TrackRecord } from '../types';
import { PublicTrackMap } from './PublicTrackMap';

type PublicTrackLocatorProps = {
  catalogReady: boolean;
  tracks: TrackRecord[];
};

const allCountries = 'All countries';
const allRegions = 'All states / regions';
const maximumVisibleResults = 24;

function isFacebookUrl(value?: string) {
  if (!value) {
    return false;
  }

  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === 'facebook.com' || hostname.endsWith('.facebook.com');
  } catch {
    return false;
  }
}

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

function initialLocatorTrackId() {
  return new URLSearchParams(window.location.search).get('locator');
}

export function PublicTrackLocator({ catalogReady, tracks }: PublicTrackLocatorProps) {
  const [query, setQuery] = useState('');
  const [country, setCountry] = useState(allCountries);
  const [region, setRegion] = useState(allRegions);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(initialLocatorTrackId);
  const [publicTracks, setPublicTracks] = useState<TrackLocatorRecord[] | null>(null);
  const [publicDirectoryFailed, setPublicDirectoryFailed] = useState(false);
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
      (country === allCountries || track.country === country)
      && (region === allRegions || track.state === region)
      && (terms.length === 0 || terms.every((term) => trackSearchText(track).includes(term)))
    ));
  }, [country, query, region, sortedTracks]);
  const selectedTrack = filteredTracks.find((track) => track.id === selectedTrackId)
    ?? (filteredTracks.length > 0
      ? filteredTracks[0]
      : sortedTracks.find((track) => track.id === selectedTrackId) ?? sortedTracks[0] ?? null);
  const selectedWebsiteUrl = selectedTrack?.websiteUrl && !isFacebookUrl(selectedTrack.websiteUrl)
    ? selectedTrack.websiteUrl
    : undefined;
  const selectedFacebookUrl = selectedTrack?.facebookUrl
    ?? (isFacebookUrl(selectedTrack?.websiteUrl) ? selectedTrack?.websiteUrl : undefined);

  useEffect(() => {
    if (!directoryReady || !selectedTrack || selectedTrack.id === selectedTrackId) {
      return;
    }

    setSelectedTrackId(selectedTrack.id);
  }, [directoryReady, selectedTrack, selectedTrackId]);

  useEffect(() => {
    if (!directoryReady || !selectedTrack) {
      return;
    }

    const url = new URL(window.location.href);
    url.searchParams.set('locator', selectedTrack.id);
    window.history.replaceState({}, '', url);
  }, [directoryReady, selectedTrack]);

  const selectTrack = (track: TrackLocatorRecord) => {
    setSelectedTrackId(track.id);
  };

  const handleCountryChange = (nextCountry: string) => {
    setCountry(nextCountry);
    setRegion(allRegions);
  };

  return (
    <section className="public-locator-band" id="track-locator" aria-labelledby="public-track-locator-title">
      <div className="public-locator-inner">
        <header className="public-locator-header">
          <div>
            <span className="eyebrow"><Globe2 size={14} /> Global BMX directory</span>
            <h2 id="public-track-locator-title">Find a BMX racing track</h2>
            <p>Search verified federation directories and community track records, then inspect each track in your preferred mapping app.</p>
          </div>
          <strong>{directoryReady ? `${directoryTracks.length.toLocaleString()} tracks` : 'Loading directory'}</strong>
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
                  <strong>{track.name}</strong>
                  <span><MapPin size={13} /> {trackLocation(track)}</span>
                </button>
              ))}
              {directoryReady && filteredTracks.length === 0 && (
                <div className="public-track-empty">No tracks match those filters.</div>
              )}
            </div>
          </div>

          <div className="public-locator-preview">
            {selectedTrack ? (
              <>
                <PublicTrackMap track={selectedTrack} />
                <div className="public-track-details">
                  <div>
                    <span className="eyebrow">Selected track</span>
                    <h3>{selectedTrack.name}</h3>
                    <p>{selectedTrack.address ?? trackLocation(selectedTrack)}</p>
                    <small>Listed by {selectedTrack.source}</small>
                  </div>
                  <div className="public-track-actions" aria-label={`Track links for ${selectedTrack.name}`}>
                    {selectedWebsiteUrl && (
                      <a href={selectedWebsiteUrl} target="_blank" rel="noreferrer">
                        <Globe2 size={16} /> Official Website
                      </a>
                    )}
                    {selectedFacebookUrl && (
                      <a href={selectedFacebookUrl} target="_blank" rel="noreferrer">
                        <Users size={16} /> Facebook
                      </a>
                    )}
                    <a href={trackAppleMapsUrl(selectedTrack)} target="_blank" rel="noreferrer">
                      <Apple size={16} /> Apple Maps
                    </a>
                    <a href={trackGoogleMapsUrl(selectedTrack)} target="_blank" rel="noreferrer">
                      <Navigation size={16} /> Google Maps
                    </a>
                    <a href={trackGoogleEarthUrl(selectedTrack)} target="_blank" rel="noreferrer">
                      <ExternalLink size={16} /> Open Earth
                    </a>
                  </div>
                </div>
              </>
            ) : (
              <div className="public-track-empty">Loading the global track directory.</div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
