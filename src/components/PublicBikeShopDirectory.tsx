import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  Bike,
  Check,
  Clock3,
  ExternalLink,
  Globe2,
  LocateFixed,
  MapPin,
  Navigation,
  Phone,
  Search,
  ShieldCheck,
  ShoppingBag,
  Store,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import {
  bikeShopAddress,
  bikeShopClaimSourceUrl,
  listBikeShopClaimsForAdmin,
  listMyBikeShopClaimRequests,
  nearbyTracksForShop,
  reviewBikeShopClaimRequest,
  searchNearbyBikeShops,
  submitBikeShopClaimRequest,
  withdrawBikeShopClaimRequest,
  type BikeShopAdminClaimRecord,
  type BikeShopClaimRecord,
  type BikeShopClaimRole,
  type BikeShopClaimStatus,
  type BikeShopClaimVerificationMethod,
  type BikeShopPoint,
  type BikeShopRecord,
} from '../lib/bikeShops';
import { resolveLocationText } from '../lib/googleMaps';
import { trackLocatorRelativeUrl } from '../lib/mapLinks';
import type { TrackLocatorRecord, TrackRecord } from '../types';
import './PublicBikeShopDirectory.css';

type PublicBikeShopDirectoryProps = {
  accountId?: string | null;
  isAdmin?: boolean;
  tracks: ReadonlyArray<TrackRecord | TrackLocatorRecord>;
  onRequireFreeAccount?: (shop: BikeShopRecord) => void;
};

type LocatedSearch = BikeShopPoint & { label: string };

const radiusOptions = Array.from({ length: 10 }, (_, index) => (index + 1) * 5);

function currentPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Location is unavailable on this device. Enter a city, ZIP code, or address instead.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      maximumAge: 5 * 60 * 1000,
      timeout: 12_000,
    });
  });
}

function locationPermissionDenied(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error
    && Number((error as { code?: unknown }).code) === 1);
}

function serviceLabels(shop: BikeShopRecord) {
  return [
    shop.services.sales && 'Bike sales',
    shop.services.repair && 'Repairs',
    shop.services.rental && 'Rentals',
    shop.services.ebike && 'E-bike service',
  ].filter((label): label is string => Boolean(label));
}

function phoneHref(phone: string) {
  const normalized = phone.replace(/[^+\d,;*#]/g, '');
  return normalized.replace(/\D/g, '').length >= 7 ? `tel:${normalized}` : null;
}

export function PublicBikeShopDirectory({
  accountId = null,
  isAdmin = false,
  tracks,
  onRequireFreeAccount,
}: PublicBikeShopDirectoryProps) {
  const [locationInput, setLocationInput] = useState('');
  const [radiusMiles, setRadiusMiles] = useState(25);
  const [searchOrigin, setSearchOrigin] = useState<LocatedSearch | null>(null);
  const [searchRadiusMiles, setSearchRadiusMiles] = useState<number | null>(null);
  const [shops, setShops] = useState<BikeShopRecord[]>([]);
  const [selectedShopId, setSelectedShopId] = useState('');
  const [status, setStatus] = useState<'idle' | 'locating' | 'searching' | 'ready'>('idle');
  const [error, setError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [claimShop, setClaimShop] = useState<BikeShopRecord | null>(null);
  const [claimRole, setClaimRole] = useState<BikeShopClaimRole>('owner');
  const [verificationMethod, setVerificationMethod] = useState<BikeShopClaimVerificationMethod>('business-email');
  const [businessEmail, setBusinessEmail] = useState('');
  const [businessPhone, setBusinessPhone] = useState('');
  const [verificationNote, setVerificationNote] = useState('');
  const [claimStatus, setClaimStatus] = useState<'idle' | 'submitting' | 'submitted'>('idle');
  const [claimError, setClaimError] = useState('');
  const [myClaims, setMyClaims] = useState<BikeShopClaimRecord[]>([]);
  const [myClaimsAccountId, setMyClaimsAccountId] = useState<string | null>(null);
  const [myClaimsStatus, setMyClaimsStatus] = useState<'idle' | 'loading' | 'ready'>('idle');
  const [myClaimsError, setMyClaimsError] = useState('');
  const [withdrawingClaimId, setWithdrawingClaimId] = useState('');
  const [adminClaimFilter, setAdminClaimFilter] = useState<BikeShopClaimStatus | 'all'>('pending');
  const [adminClaims, setAdminClaims] = useState<BikeShopAdminClaimRecord[]>([]);
  const [adminClaimsQueryKey, setAdminClaimsQueryKey] = useState('');
  const [adminClaimOffset, setAdminClaimOffset] = useState(0);
  const [adminClaimPage, setAdminClaimPage] = useState({ total: 0, offset: 0, limit: 25 });
  const [adminClaimsStatus, setAdminClaimsStatus] = useState<'idle' | 'loading' | 'ready'>('idle');
  const [adminClaimsError, setAdminClaimsError] = useState('');
  const [adminReviewNotes, setAdminReviewNotes] = useState<Record<string, string>>({});
  const [reviewingClaimId, setReviewingClaimId] = useState('');
  const claimDialogRef = useRef<HTMLElement | null>(null);
  const claimTriggerRef = useRef<HTMLButtonElement | null>(null);
  const accountIdRef = useRef(accountId);
  const publicSearchRef = useRef<{ generation: number; controller: AbortController | null; busy: boolean }>({
    generation: 0,
    controller: null,
    busy: false,
  });
  const myClaimsRequestRef = useRef<{ generation: number; controller: AbortController | null }>({
    generation: 0,
    controller: null,
  });
  const adminClaimsRequestRef = useRef<{ generation: number; controller: AbortController | null }>({
    generation: 0,
    controller: null,
  });
  accountIdRef.current = accountId;

  const selectedShop = shops.find((shop) => shop.id === selectedShopId) ?? shops[0] ?? null;
  const nearbyTracks = useMemo(
    () => selectedShop ? nearbyTracksForShop(selectedShop, tracks, 50) : [],
    [selectedShop, tracks],
  );
  const selectedShopPhoneHref = selectedShop ? phoneHref(selectedShop.phone) : null;
  const currentAdminClaimsQueryKey = accountId
    ? `${accountId}\u0000${adminClaimFilter}\u0000${adminClaimOffset}`
    : '';
  const visibleMyClaims = myClaimsAccountId === accountId ? myClaims : [];
  const visibleAdminClaims = adminClaimsQueryKey === currentAdminClaimsQueryKey ? adminClaims : [];
  const visibleAdminClaimPage = adminClaimsQueryKey === currentAdminClaimsQueryKey
    ? adminClaimPage
    : { total: 0, offset: adminClaimOffset, limit: adminClaimPage.limit };

  const beginPublicSearch = () => {
    if (publicSearchRef.current.busy) return null;
    publicSearchRef.current.controller?.abort();
    const request = {
      generation: publicSearchRef.current.generation + 1,
      controller: new AbortController(),
    };
    publicSearchRef.current = { ...request, busy: true };
    return request;
  };

  const publicSearchIsCurrent = (request: { generation: number; controller: AbortController }) => (
    !request.controller.signal.aborted
    && publicSearchRef.current.generation === request.generation
    && publicSearchRef.current.controller === request.controller
  );

  const finishPublicSearch = (request: { generation: number; controller: AbortController }) => {
    if (!publicSearchIsCurrent(request)) return;
    publicSearchRef.current = { generation: request.generation, controller: null, busy: false };
  };

  const runSearch = async (
    origin: LocatedSearch,
    request: { generation: number; controller: AbortController },
  ) => {
    const requestedRadiusMiles = radiusMiles;
    if (!publicSearchIsCurrent(request)) return;
    setStatus('searching');
    setError('');
    setSearchOrigin(origin);
    setSearchRadiusMiles(requestedRadiusMiles);
    setHasSearched(true);
    try {
      const result = await searchNearbyBikeShops(origin, requestedRadiusMiles, fetch, request.controller.signal);
      if (!publicSearchIsCurrent(request)) return;
      setShops(result.shops);
      setSelectedShopId(result.shops[0]?.id ?? '');
      setStatus('ready');
    } catch (caught) {
      if (!publicSearchIsCurrent(request)) return;
      setShops([]);
      setSelectedShopId('');
      setStatus('ready');
      setError(caught instanceof Error ? caught.message : 'Bike shops could not be loaded. Please try again.');
    } finally {
      finishPublicSearch(request);
    }
  };

  const searchManualLocation = async (event: FormEvent) => {
    event.preventDefault();
    const request = beginPublicSearch();
    if (!request) return;
    const query = locationInput.trim();
    if (!query) {
      setError('Enter a city, ZIP code, or address.');
      finishPublicSearch(request);
      return;
    }
    setStatus('locating');
    setError('');
    try {
      const result = await resolveLocationText(query);
      if (!publicSearchIsCurrent(request)) return;
      const origin = {
        latitude: result.point.lat,
        longitude: result.point.lng,
        label: result.label || query,
      };
      setLocationInput(origin.label);
      await runSearch(origin, request);
    } catch (caught) {
      if (!publicSearchIsCurrent(request)) return;
      setStatus('idle');
      setError(caught instanceof Error ? caught.message : 'That location could not be found.');
      finishPublicSearch(request);
    }
  };

  const useCurrentLocation = async () => {
    const request = beginPublicSearch();
    if (!request) return;
    setStatus('locating');
    setError('');
    try {
      const position = await currentPosition();
      if (!publicSearchIsCurrent(request)) return;
      await runSearch({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        label: 'Current location',
      }, request);
    } catch (caught) {
      if (!publicSearchIsCurrent(request)) return;
      setStatus('idle');
      setError(locationPermissionDenied(caught)
        ? 'Location permission was denied. Enter a city, ZIP code, or address instead.'
        : caught instanceof Error ? caught.message : 'Your current location could not be found.');
      finishPublicSearch(request);
    }
  };

  const claimSelectedShop = () => {
    if (!selectedShop || selectedShop.claimed) return;
    if (!accountId) {
      onRequireFreeAccount?.(selectedShop);
      return;
    }
    setClaimShop(selectedShop);
    setClaimRole('owner');
    setVerificationMethod('business-email');
    setBusinessEmail('');
    setBusinessPhone('');
    setVerificationNote('');
    setClaimError('');
    setClaimStatus('idle');
    window.requestAnimationFrame(() => claimDialogRef.current?.querySelector<HTMLElement>('select, input, textarea, button')?.focus());
  };

  const closeClaimDialog = () => {
    if (claimStatus === 'submitting') return;
    setClaimShop(null);
    setClaimError('');
    window.requestAnimationFrame(() => claimTriggerRef.current?.focus());
  };

  const submitClaim = async (event: FormEvent) => {
    event.preventDefault();
    if (!claimShop || claimStatus === 'submitting') return;
    setClaimStatus('submitting');
    setClaimError('');
    try {
      await submitBikeShopClaimRequest({
        shop: claimShop,
        claimantRole: claimRole,
        verificationMethod,
        businessEmail,
        businessPhone,
        verificationNote,
      });
      setClaimStatus('submitted');
      void refreshMyClaims();
    } catch (caught) {
      setClaimStatus('idle');
      setClaimError(caught instanceof Error ? caught.message : 'Your claim request could not be submitted.');
    }
  };

  const trapClaimDialogFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]',
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

  useEffect(() => {
    if (!claimShop) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeClaimDialog();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [claimShop, claimStatus]);

  const refreshMyClaims = async () => {
    const requestedAccountId = accountId;
    if (!requestedAccountId) return;
    myClaimsRequestRef.current.controller?.abort();
    const generation = myClaimsRequestRef.current.generation + 1;
    const controller = new AbortController();
    myClaimsRequestRef.current = { generation, controller };
    const isCurrent = () => (
      !controller.signal.aborted
      && myClaimsRequestRef.current.generation === generation
      && myClaimsRequestRef.current.controller === controller
      && accountIdRef.current === requestedAccountId
    );
    setMyClaimsStatus('loading');
    setMyClaims([]);
    setMyClaimsAccountId(requestedAccountId);
    setMyClaimsError('');
    try {
      const claims = await listMyBikeShopClaimRequests(fetch, controller.signal);
      if (!isCurrent()) return;
      setMyClaims(claims);
      setMyClaimsAccountId(requestedAccountId);
    } catch (caught) {
      if (!isCurrent()) return;
      setMyClaimsError(caught instanceof Error ? caught.message : 'Your shop claims could not be loaded.');
    } finally {
      if (!isCurrent()) return;
      myClaimsRequestRef.current = { generation, controller: null };
      setMyClaimsStatus('ready');
    }
  };

  const withdrawClaim = async (claimId: string) => {
    if (withdrawingClaimId) return;
    const requestedAccountId = accountId;
    setWithdrawingClaimId(claimId);
    setMyClaimsError('');
    try {
      await withdrawBikeShopClaimRequest(claimId);
      if (accountIdRef.current !== requestedAccountId) return;
      setMyClaims((current) => current.map((claim) => (
        claim.id === claimId ? { ...claim, status: 'withdrawn', updatedAt: new Date().toISOString() } : claim
      )));
    } catch (caught) {
      if (accountIdRef.current !== requestedAccountId) return;
      setMyClaimsError(caught instanceof Error ? caught.message : 'This claim could not be withdrawn.');
    } finally {
      setWithdrawingClaimId('');
    }
  };

  const refreshAdminClaims = async (
    requestedOffset = adminClaimOffset,
    requestedFilter = adminClaimFilter,
  ) => {
    const requestedAccountId = accountId;
    if (!isAdmin || !requestedAccountId) return;
    adminClaimsRequestRef.current.controller?.abort();
    const generation = adminClaimsRequestRef.current.generation + 1;
    const controller = new AbortController();
    adminClaimsRequestRef.current = { generation, controller };
    const isCurrent = () => (
      !controller.signal.aborted
      && adminClaimsRequestRef.current.generation === generation
      && adminClaimsRequestRef.current.controller === controller
      && accountIdRef.current === requestedAccountId
    );
    setAdminClaimsStatus('loading');
    setAdminClaims([]);
    setAdminClaimsQueryKey(`${requestedAccountId}\u0000${requestedFilter}\u0000${requestedOffset}`);
    setAdminClaimPage((current) => ({ total: 0, offset: requestedOffset, limit: current.limit }));
    setAdminClaimsError('');
    try {
      const page = await listBikeShopClaimsForAdmin(requestedFilter, {
        offset: requestedOffset,
        limit: adminClaimPage.limit,
        signal: controller.signal,
      });
      if (!isCurrent()) return;
      setAdminClaims(page.items);
      setAdminClaimsQueryKey(`${requestedAccountId}\u0000${requestedFilter}\u0000${page.offset}`);
      setAdminClaimPage({ total: page.total, offset: page.offset, limit: page.limit });
    } catch (caught) {
      if (!isCurrent()) return;
      setAdminClaimsError(caught instanceof Error ? caught.message : 'The review queue could not be loaded.');
    } finally {
      if (!isCurrent()) return;
      adminClaimsRequestRef.current = { generation, controller: null };
      setAdminClaimsStatus('ready');
    }
  };

  const reviewClaim = async (claimId: string, decision: 'approved' | 'rejected') => {
    if (reviewingClaimId) return;
    const requestedAccountId = accountId;
    setReviewingClaimId(claimId);
    setAdminClaimsError('');
    try {
      const reviewed = await reviewBikeShopClaimRequest(
        claimId,
        decision,
        adminReviewNotes[claimId] || '',
      );
      if (accountIdRef.current !== requestedAccountId) return;
      setMyClaims((current) => current.map((claim) => claim.id === claimId ? reviewed : claim));
      if (decision === 'approved') {
        setShops((current) => current.map((shop) => (
          shop.source.elementType === reviewed.osmElementType
            && shop.source.elementId === reviewed.osmElementId
            ? { ...shop, claimed: true }
            : shop
        )));
      }
      if (adminClaimFilter === 'pending') {
        const nextTotal = Math.max(0, adminClaimPage.total - 1);
        const lastPageOffset = nextTotal > 0
          ? Math.floor((nextTotal - 1) / adminClaimPage.limit) * adminClaimPage.limit
          : 0;
        const nextOffset = Math.min(adminClaimOffset, lastPageOffset);
        if (nextOffset !== adminClaimOffset) setAdminClaimOffset(nextOffset);
        await refreshAdminClaims(nextOffset, adminClaimFilter);
      } else {
        setAdminClaims((current) => current.map((claim) => claim.id === claimId ? reviewed : claim));
      }
    } catch (caught) {
      if (accountIdRef.current !== requestedAccountId) return;
      setAdminClaimsError(caught instanceof Error ? caught.message : 'This claim could not be reviewed.');
    } finally {
      setReviewingClaimId('');
    }
  };

  useEffect(() => {
    myClaimsRequestRef.current.controller?.abort();
    myClaimsRequestRef.current = {
      generation: myClaimsRequestRef.current.generation + 1,
      controller: null,
    };
    if (!accountId) {
      setMyClaims([]);
      setMyClaimsAccountId(null);
      setMyClaimsStatus('idle');
      return;
    }
    void refreshMyClaims();
  }, [accountId]);

  useEffect(() => {
    adminClaimsRequestRef.current.controller?.abort();
    adminClaimsRequestRef.current = {
      generation: adminClaimsRequestRef.current.generation + 1,
      controller: null,
    };
    if (!isAdmin || !accountId) {
      setAdminClaims([]);
      setAdminClaimsQueryKey('');
      setAdminClaimOffset(0);
      setAdminClaimPage({ total: 0, offset: 0, limit: 25 });
      setAdminClaimsStatus('idle');
      return;
    }
    void refreshAdminClaims();
  }, [accountId, adminClaimFilter, adminClaimOffset, isAdmin]);

  useEffect(() => () => {
    publicSearchRef.current.controller?.abort();
    publicSearchRef.current = {
      generation: publicSearchRef.current.generation + 1,
      controller: null,
      busy: false,
    };
    myClaimsRequestRef.current.controller?.abort();
    myClaimsRequestRef.current = {
      generation: myClaimsRequestRef.current.generation + 1,
      controller: null,
    };
    adminClaimsRequestRef.current.controller?.abort();
    adminClaimsRequestRef.current = {
      generation: adminClaimsRequestRef.current.generation + 1,
      controller: null,
    };
  }, []);

  const busy = status === 'locating' || status === 'searching';

  return (
    <section className="public-bike-shop-directory" id="bike-shop-directory" aria-labelledby="bike-shop-directory-title">
      <div className="public-bike-shop-directory__inner">
        <header className="public-bike-shop-directory__header">
          <div>
            <span className="eyebrow"><Globe2 size={14} /> Global bike shop directory</span>
            <h2 id="bike-shop-directory-title">Find a bike shop near you</h2>
            <p>No TrackLab account is needed to search. Choose a starting point and see the closest mapped bike shops first.</p>
          </div>
          <span><Store size={17} /> Public directory</span>
        </header>

        <form className="public-bike-shop-directory__search" onSubmit={(event) => void searchManualLocation(event)}>
          <label className="public-bike-shop-directory__location">
            <span>Starting location</span>
            <div>
              <MapPin size={18} />
              <input
                type="search"
                value={locationInput}
                onChange={(event) => setLocationInput(event.currentTarget.value.slice(0, 240))}
                placeholder="City, ZIP code, or address"
                autoComplete="postal-code"
              />
            </div>
          </label>
          <label className="public-bike-shop-directory__radius">
            <span>Search radius</span>
            <select value={radiusMiles} onChange={(event) => setRadiusMiles(Number(event.currentTarget.value))}>
              {radiusOptions.map((radius) => <option value={radius} key={radius}>{radius} miles</option>)}
            </select>
          </label>
          <button className="public-bike-shop-directory__submit" type="submit" disabled={busy}>
            <Search size={18} /> {status === 'locating' ? 'Finding location…' : status === 'searching' ? 'Searching…' : 'Search shops'}
          </button>
          <button className="public-bike-shop-directory__locate" type="button" disabled={busy} onClick={() => void useCurrentLocation()}>
            <LocateFixed size={18} /> Use current location
          </button>
        </form>

        {error && <div className="public-bike-shop-directory__error" role="alert">{error}</div>}

        <div className="public-bike-shop-directory__layout">
          <aside className="public-bike-shop-directory__results" aria-label="Nearby bike shops">
            <div className="public-bike-shop-directory__results-heading">
              <div>
                <strong>{busy ? 'Searching nearby' : hasSearched ? `${shops.length} mapped bike ${shops.length === 1 ? 'shop' : 'shops'}` : 'Start your search'}</strong>
                <small>{searchOrigin && searchRadiusMiles !== null ? `Near ${searchOrigin.label} · within ${searchRadiusMiles} miles` : 'Use your location or enter a place above'}</small>
              </div>
            </div>
            <div className="public-bike-shop-directory__result-list">
              {shops.map((shop) => {
                const labels = serviceLabels(shop);
                return (
                  <button
                    type="button"
                    className={shop.id === selectedShop?.id ? 'selected' : ''}
                    aria-pressed={shop.id === selectedShop?.id}
                    onClick={() => setSelectedShopId(shop.id)}
                    key={shop.id}
                  >
                    <span className="public-bike-shop-directory__result-title"><strong>{shop.name}{shop.claimed ? ' · ✓ Claimed' : ''}</strong><b>{shop.distanceMiles.toFixed(1)} mi</b></span>
                    <span><MapPin size={14} /> {bikeShopAddress(shop)}</span>
                    {labels.length > 0 && <small>{labels.join(' · ')}</small>}
                  </button>
                );
              })}
              {!busy && hasSearched && shops.length === 0 && !error && (
                <div className="public-bike-shop-directory__empty">
                  <Bike size={26} />
                  <strong>No mapped bike shops found</strong>
                  <span>Try a larger radius or another nearby city.</span>
                </div>
              )}
              {!hasSearched && (
                <div className="public-bike-shop-directory__empty">
                  <Search size={26} />
                  <strong>Search anywhere</strong>
                  <span>Find nearby shops without signing in.</span>
                </div>
              )}
            </div>
          </aside>

          <div className="public-bike-shop-directory__detail">
            {selectedShop ? (
              <>
                <div className="public-bike-shop-directory__shop-card">
                  <div className="public-bike-shop-directory__shop-intro">
                    <span className="eyebrow">{selectedShop.distanceMiles.toFixed(1)} miles from your search</span>
                    <h3>{selectedShop.name}</h3>
                    <p><MapPin size={16} /> {bikeShopAddress(selectedShop)}</p>
                  </div>

                  <div className="public-bike-shop-directory__services" aria-label={`Services listed for ${selectedShop.name}`}>
                    {selectedShop.claimed && <span><ShieldCheck size={14} /> Claimed &amp; verified</span>}
                    {serviceLabels(selectedShop).map((label) => (
                      <span key={label}>{label === 'Repairs' ? <Wrench size={14} /> : <ShoppingBag size={14} />}{label}</span>
                    ))}
                    {serviceLabels(selectedShop).length === 0 && <span>Services not listed</span>}
                  </div>

                  <dl className="public-bike-shop-directory__facts">
                    {selectedShop.openingHours && <div><dt><Clock3 size={16} /> Listed hours</dt><dd>{selectedShop.openingHours}</dd></div>}
                    {selectedShop.phone && (
                      <div>
                        <dt><Phone size={16} /> Phone</dt>
                        <dd>{selectedShopPhoneHref
                          ? <a href={selectedShopPhoneHref}>{selectedShop.phone}</a>
                          : selectedShop.phone}</dd>
                      </div>
                    )}
                    {selectedShop.website && <div><dt><Globe2 size={16} /> Website</dt><dd><a href={selectedShop.website} target="_blank" rel="noopener noreferrer">Visit shop website <ExternalLink size={13} /></a></dd></div>}
                  </dl>

                  <nav className="public-bike-shop-directory__map-links" aria-label={`Map links for ${selectedShop.name}`}>
                    <a href={selectedShop.links.maps} target="_blank" rel="noopener noreferrer"><MapPin size={17} /> Google Maps</a>
                    <a href={selectedShop.links.directions} target="_blank" rel="noopener noreferrer"><Navigation size={17} /> Directions</a>
                    <a href={selectedShop.links.streetView} target="_blank" rel="noopener noreferrer"><ExternalLink size={17} /> Street View</a>
                  </nav>

                  <button ref={claimTriggerRef} className="public-bike-shop-directory__claim" type="button" disabled={selectedShop.claimed} onClick={claimSelectedShop}>
                    {selectedShop.claimed ? <ShieldCheck size={17} /> : <Store size={17} />}
                    {selectedShop.claimed ? 'This shop is claimed' : `Claim this shop${accountId ? '' : ' with a free account'}`}
                  </button>
                </div>

                <section className="public-bike-shop-directory__tracks" aria-labelledby="nearby-bike-shop-tracks-title">
                  <header>
                    <div><span className="eyebrow">TrackLab track directory</span><h3 id="nearby-bike-shop-tracks-title">BMX tracks within 50 miles</h3></div>
                    <strong>{nearbyTracks.length}</strong>
                  </header>
                  {nearbyTracks.length > 0 ? (
                    <div>
                      {nearbyTracks.map(({ track, distanceMiles }) => (
                        <a href={trackLocatorRelativeUrl(track.id)} key={track.id}>
                          <span><strong>{track.name}</strong><small>{[track.city, track.state, track.country].filter(Boolean).join(', ')}</small></span>
                          <b>{distanceMiles.toFixed(1)} mi <ExternalLink size={13} /></b>
                        </a>
                      ))}
                    </div>
                  ) : <p>No BMX tracks with verified coordinates are listed within 50 miles of this shop.</p>}
                </section>
              </>
            ) : (
              <div className="public-bike-shop-directory__detail-placeholder">
                <Store size={34} />
                <strong>{busy ? 'Finding nearby bike shops…' : 'Select a nearby shop'}</strong>
                <span>Shop details, map links, and nearby BMX tracks will appear here.</span>
              </div>
            )}
          </div>
        </div>

        {accountId && (
          <section className="public-bike-shop-directory__tracks" aria-labelledby="my-bike-shop-claims-title" style={{ marginTop: 14 }}>
            <header>
              <div><span className="eyebrow">Your free shop profiles</span><h3 id="my-bike-shop-claims-title">My shop claims</h3></div>
              <button className="public-bike-shop-directory__claim" style={{ width: 'auto', marginTop: 0 }} type="button" disabled={myClaimsStatus === 'loading'} onClick={() => void refreshMyClaims()}>
                {myClaimsStatus === 'loading' ? 'Refreshing…' : 'Refresh'}
              </button>
            </header>
            {myClaimsAccountId === accountId && myClaimsError && <div className="public-bike-shop-directory__error" role="alert" style={{ marginTop: 10, border: '1px solid #eb9a9a' }}>{myClaimsError}</div>}
            <div role="list">
              {visibleMyClaims.map((claim) => (
                <article key={claim.id} role="listitem" style={{ padding: 12, border: '1px solid var(--line)', borderRadius: 8, background: '#f8fafb' }}>
                  <div className="public-bike-shop-directory__result-title">
                    <strong>{claim.shopName}</strong>
                    <b>{claim.status}</b>
                  </div>
                  <p style={{ margin: '5px 0', color: 'var(--muted)' }}>Submitted {new Date(claim.createdAt).toLocaleDateString()}</p>
                  {claim.reviewNote && <p style={{ margin: '5px 0' }}><strong>TrackLab review:</strong> {claim.reviewNote}</p>}
                  {claim.status === 'pending' && (
                    <button className="public-bike-shop-directory__claim" style={{ width: 'auto', marginTop: 8 }} type="button" disabled={withdrawingClaimId === claim.id} onClick={() => void withdrawClaim(claim.id)}>
                      <Trash2 size={15} /> {withdrawingClaimId === claim.id ? 'Withdrawing…' : 'Withdraw pending claim'}
                    </button>
                  )}
                </article>
              ))}
              {myClaimsStatus !== 'loading' && visibleMyClaims.length === 0 && <p>No shop claim requests have been submitted from this account.</p>}
            </div>
          </section>
        )}

        {isAdmin && accountId && (
          <section className="public-bike-shop-directory__tracks" aria-labelledby="bike-shop-review-queue-title" style={{ marginTop: 14 }}>
            <header style={{ flexWrap: 'wrap' }}>
              <div><span className="eyebrow">Private administrator tools</span><h3 id="bike-shop-review-queue-title">Bike shop claim review</h3></div>
              <select aria-label="Claim review status" value={adminClaimFilter} onChange={(event) => {
                setAdminClaimOffset(0);
                setAdminClaimFilter(event.currentTarget.value as BikeShopClaimStatus | 'all');
              }} style={{ maxWidth: '100%', minHeight: 44, padding: '6px 10px', border: '1px solid var(--line-strong)', borderRadius: 8, background: '#fff', fontWeight: 800 }}>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="withdrawn">Withdrawn</option>
                <option value="all">All claims</option>
              </select>
            </header>
            {adminClaimsQueryKey === currentAdminClaimsQueryKey && adminClaimsError && <div className="public-bike-shop-directory__error" role="alert" style={{ marginTop: 10, border: '1px solid #eb9a9a' }}>{adminClaimsError}</div>}
            <div role="list">
              {visibleAdminClaims.map((claim) => (
                <article key={claim.id} role="listitem" style={{ display: 'grid', gap: 8, padding: 12, border: '1px solid var(--line)', borderRadius: 8, background: '#f8fafb' }}>
                  <div className="public-bike-shop-directory__result-title">
                    <strong>{claim.shopName}</strong>
                    <b>{claim.status}</b>
                  </div>
                  <p style={{ margin: 0 }}><strong>Claimant:</strong> {claim.claimant.displayName} · {claim.claimant.email}</p>
                  <p style={{ margin: 0 }}>
                    <strong>Canonical source:</strong>{' '}
                    <a href={bikeShopClaimSourceUrl(claim)} target="_blank" rel="noopener noreferrer">
                      OpenStreetMap {claim.osmElementType} {claim.osmElementId} <ExternalLink size={13} />
                    </a>
                  </p>
                  <p style={{ margin: 0 }}><strong>Relationship:</strong> {claim.claimantRole} · <strong>Method:</strong> {claim.verificationMethod}</p>
                  {claim.businessEmail && <p style={{ margin: 0 }}><strong>Business email:</strong> {claim.businessEmail}</p>}
                  {claim.businessPhone && <p style={{ margin: 0 }}><strong>Business phone:</strong> {claim.businessPhone}</p>}
                  {claim.verificationNote && <p style={{ margin: 0 }}><strong>Evidence note:</strong> {claim.verificationNote}</p>}
                  {claim.reviewNote && <p style={{ margin: 0 }}><strong>Claimant-visible review note:</strong> {claim.reviewNote}</p>}
                  {claim.status === 'pending' && (
                    <>
                      <label style={{ display: 'grid', gap: 5 }}>
                        <span style={{ fontWeight: 800 }}>Review note (shared with claimant)</span>
                        <textarea aria-label={`Claimant-visible review note for ${claim.shopName}`} maxLength={1000} value={adminReviewNotes[claim.id] || ''} onChange={(event) => setAdminReviewNotes((current) => ({ ...current, [claim.id]: event.currentTarget.value }))} style={{ width: '100%', minHeight: 76, padding: 9, border: '1px solid var(--line-strong)', borderRadius: 8, font: 'inherit' }} />
                      </label>
                      <div className="public-bike-shop-claim-actions">
                        <button className="secondary-button" type="button" disabled={reviewingClaimId === claim.id} onClick={() => void reviewClaim(claim.id, 'rejected')}>Reject</button>
                        <button className="primary-button" type="button" disabled={reviewingClaimId === claim.id} onClick={() => void reviewClaim(claim.id, 'approved')}>Approve</button>
                      </div>
                    </>
                  )}
                </article>
              ))}
              {adminClaimsStatus !== 'loading' && visibleAdminClaims.length === 0 && <p>No {adminClaimFilter === 'all' ? '' : `${adminClaimFilter} `}shop claims are in the queue.</p>}
            </div>
            <div className="public-bike-shop-claim-actions" aria-label="Claim review pages" style={{ alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
              <span style={{ marginRight: 'auto', color: 'var(--muted)', fontWeight: 750 }}>
                {visibleAdminClaimPage.total > 0
                  ? `Showing ${visibleAdminClaimPage.offset + 1}–${Math.min(visibleAdminClaimPage.offset + visibleAdminClaims.length, visibleAdminClaimPage.total)} of ${visibleAdminClaimPage.total}`
                  : '0 claims'}
              </span>
              <button className="secondary-button" type="button" disabled={adminClaimsStatus === 'loading' || adminClaimOffset === 0} onClick={() => setAdminClaimOffset(Math.max(0, adminClaimOffset - visibleAdminClaimPage.limit))}>Previous</button>
              <button className="secondary-button" type="button" disabled={adminClaimsStatus === 'loading' || adminClaimOffset + visibleAdminClaimPage.limit >= visibleAdminClaimPage.total} onClick={() => setAdminClaimOffset(adminClaimOffset + visibleAdminClaimPage.limit)}>Next</button>
            </div>
          </section>
        )}

        <footer className="public-bike-shop-directory__attribution">
          <span>Shop data: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors (ODbL)</a></span>
          <span>Maps, directions, and Street View: <a href="https://www.google.com/maps" target="_blank" rel="noopener noreferrer">Google Maps</a></span>
          <small>Directory details may change. Contact the shop before traveling or relying on a listed service.</small>
        </footer>
      </div>
      {claimShop && (
        <div className="public-bike-shop-claim-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeClaimDialog();
        }}>
          <section
            ref={claimDialogRef}
            className="public-bike-shop-claim-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="public-bike-shop-claim-title"
            tabIndex={-1}
            onKeyDown={trapClaimDialogFocus}
          >
            <header>
              <div><span className="eyebrow">Free shop profile</span><h3 id="public-bike-shop-claim-title">Claim {claimShop.name}</h3></div>
              <button type="button" aria-label="Close shop claim" disabled={claimStatus === 'submitting'} onClick={closeClaimDialog}><X size={18} /></button>
            </header>
            {claimStatus === 'submitted' ? (
              <div className="public-bike-shop-claim-success" role="status">
                <Check size={30} />
                <strong>Claim request received</strong>
                <p>TrackLab will review your relationship to this shop before changing its public profile.</p>
                <button type="button" onClick={closeClaimDialog}>Done</button>
              </div>
            ) : (
              <form onSubmit={(event) => void submitClaim(event)}>
                <p>Claims are reviewed. Submitting a request does not immediately mark this listing as verified.</p>
                <label>
                  <span>Your relationship</span>
                  <select value={claimRole} disabled={claimStatus === 'submitting'} onChange={(event) => setClaimRole(event.currentTarget.value as BikeShopClaimRole)}>
                    <option value="owner">Owner</option>
                    <option value="manager">Manager</option>
                    <option value="authorized-representative">Authorized representative</option>
                  </select>
                </label>
                <label>
                  <span>Verification method</span>
                  <select value={verificationMethod} disabled={claimStatus === 'submitting'} onChange={(event) => {
                    setVerificationMethod(event.currentTarget.value as BikeShopClaimVerificationMethod);
                    setVerificationNote('');
                  }}>
                    <option value="business-email">Business email</option>
                    <option value="business-phone">Business phone</option>
                    <option value="documentation">Ownership documentation</option>
                  </select>
                </label>
                {verificationMethod === 'business-email' && (
                  <label><span>Business email</span><input type="email" required autoComplete="email" value={businessEmail} disabled={claimStatus === 'submitting'} onChange={(event) => setBusinessEmail(event.currentTarget.value.slice(0, 254))} /></label>
                )}
                {verificationMethod === 'business-phone' && (
                  <label><span>Business phone</span><input type="tel" required autoComplete="tel" value={businessPhone} disabled={claimStatus === 'submitting'} onChange={(event) => setBusinessPhone(event.currentTarget.value.slice(0, 80))} /></label>
                )}
                {verificationMethod === 'documentation' && (
                  <label className="public-bike-shop-claim-note">
                    <span>Documentation details</span>
                    <textarea required value={verificationNote} disabled={claimStatus === 'submitting'} maxLength={1000} onChange={(event) => setVerificationNote(event.currentTarget.value)} placeholder="Describe the ownership documentation you can provide." />
                  </label>
                )}
                {claimError && <div className="public-bike-shop-claim-error" role="alert">{claimError}</div>}
                <div className="public-bike-shop-claim-actions">
                  <button type="button" disabled={claimStatus === 'submitting'} onClick={closeClaimDialog}>Cancel</button>
                  <button type="submit" disabled={claimStatus === 'submitting'}>{claimStatus === 'submitting' ? 'Submitting…' : 'Submit for review'}</button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
