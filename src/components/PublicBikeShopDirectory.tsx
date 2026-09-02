import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  Bike,
  Check,
  Clock3,
  ExternalLink,
  Globe2,
  ListTree,
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
  browseBikeShopsByScope,
  distanceBetweenMiles,
  listBikeShopHierarchy,
  listBikeShopClaimsForAdmin,
  listMyBikeShopClaimRequests,
  nearbyTracksForShop,
  reviewBikeShopClaimRequest,
  searchBikeShopsByName,
  searchBikeShopsInViewport,
  searchNearbyBikeShops,
  submitBikeShopClaimRequest,
  withdrawBikeShopClaimRequest,
  type BikeShopAdminClaimRecord,
  type BikeShopClaimRecord,
  type BikeShopClaimRole,
  type BikeShopClaimStatus,
  type BikeShopClaimVerificationMethod,
  type BikeShopHierarchyItem,
  type BikeShopPoint,
  type BikeShopRecord,
  type BikeShopViewport,
} from '../lib/bikeShops';
import {
  fetchLocationPredictions,
  resetPlaceAutocompleteSession,
  resolveLocationText,
  resolvePlacePrediction,
  type PlacePredictionOption,
} from '../lib/googleMaps';
import { trackLocatorRelativeUrl } from '../lib/mapLinks';
import type { TrackLocatorRecord, TrackRecord } from '../types';
import {
  BikeShopDirectoryMap,
  bikeShopViewportMinimumZoom,
  type BikeShopMapFocusRequest,
} from './BikeShopDirectoryMap';
import './PublicBikeShopDirectory.css';

type PublicBikeShopDirectoryProps = {
  accountId?: string | null;
  isAdmin?: boolean;
  tracks: ReadonlyArray<TrackRecord | TrackLocatorRecord>;
  onRequireFreeAccount?: (shop: BikeShopRecord) => void;
};

type LocatedSearch = BikeShopPoint & { label: string };

type ShopHierarchy = {
  country: string;
  region: string;
  city: string;
};

const radiusOptions = Array.from({ length: 10 }, (_, index) => (index + 1) * 5);
const allHierarchyValues = '__all__';
const missingCountry = '__country-not-listed__';
const missingRegion = '__region-not-listed__';
const missingCity = '__city-not-listed__';

function hierarchyCountryItemsForDisplay(items: BikeShopHierarchyItem[]) {
  return [...items].sort((left, right) => {
    const leftIsUnitedStates = left.value.toUpperCase() === 'US';
    const rightIsUnitedStates = right.value.toUpperCase() === 'US';
    if (leftIsUnitedStates !== rightIsUnitedStates) return leftIsUnitedStates ? -1 : 1;
    return hierarchyLabel('country', left.value).localeCompare(hierarchyLabel('country', right.value), undefined, { sensitivity: 'base' })
      || left.value.localeCompare(right.value);
  });
}

function localizedCountryName(countryCode: string) {
  if (!countryCode) return 'Country not listed';
  try {
    const DisplayNames = Intl.DisplayNames;
    return DisplayNames ? new DisplayNames(undefined, { type: 'region' }).of(countryCode) || countryCode : countryCode;
  } catch {
    return countryCode;
  }
}

function claimSnapshotAddress(claim: BikeShopClaimRecord) {
  const address = claim.shopSnapshot?.address;
  if (!address) return '';
  return address.formatted
    || [address.line1, address.locality, address.region, address.postalCode, address.countryCode]
      .filter(Boolean)
      .join(', ');
}

function shopHierarchy(shop: BikeShopRecord): ShopHierarchy {
  return {
    country: shop.address.countryCode || missingCountry,
    region: shop.address.region || missingRegion,
    city: shop.address.locality || missingCity,
  };
}

function hierarchyLabel(level: keyof ShopHierarchy, value: string) {
  if (value === missingCountry) return 'Country not listed';
  if (value === missingRegion) return 'State / province not listed';
  if (value === missingCity) return 'City not listed';
  return level === 'country' ? localizedCountryName(value) : value;
}

function mapFocusPoints(origin: BikeShopPoint, radiusMiles: number) {
  const latitudeDelta = radiusMiles / 69;
  const longitudeScale = Math.max(0.2, Math.cos(origin.latitude * Math.PI / 180));
  const longitudeDelta = radiusMiles / (69 * longitudeScale);
  return [
    { latitude: Math.max(-85, origin.latitude - latitudeDelta), longitude: Math.max(-180, origin.longitude - longitudeDelta) },
    { latitude: Math.min(85, origin.latitude + latitudeDelta), longitude: Math.min(180, origin.longitude + longitudeDelta) },
  ];
}

function viewportCenter(viewport: BikeShopViewport): BikeShopPoint {
  const longitudeSpan = viewport.east >= viewport.west
    ? viewport.east - viewport.west
    : viewport.east + 360 - viewport.west;
  const longitude = viewport.west + longitudeSpan / 2;
  return {
    latitude: (viewport.north + viewport.south) / 2,
    longitude: longitude > 180 ? longitude - 360 : longitude,
  };
}

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
  const [shopSearchMode, setShopSearchMode] = useState<'location' | 'name'>('location');
  const [locationPrediction, setLocationPrediction] = useState<PlacePredictionOption | null>(null);
  const [locationPredictions, setLocationPredictions] = useState<PlacePredictionOption[]>([]);
  const [locationPredictionStatus, setLocationPredictionStatus] = useState('');
  const [radiusMiles, setRadiusMiles] = useState(25);
  const [shops, setShops] = useState<BikeShopRecord[]>([]);
  const [selectedShopId, setSelectedShopId] = useState('');
  const [status, setStatus] = useState<'idle' | 'locating' | 'searching' | 'ready'>('idle');
  const [error, setError] = useState('');
  const [directoryNotice, setDirectoryNotice] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [resultMode, setResultMode] = useState<'none' | 'nearby' | 'viewport' | 'hierarchy' | 'name'>('none');
  const [nearbyContext, setNearbyContext] = useState<{ label: string; radiusMiles: number } | null>(null);
  const [mapZoom, setMapZoom] = useState(2);
  const [mapFocusRequest, setMapFocusRequest] = useState<BikeShopMapFocusRequest | null>(null);
  const [viewportTruncated, setViewportTruncated] = useState(false);
  const [countryFilter, setCountryFilter] = useState(allHierarchyValues);
  const [regionFilter, setRegionFilter] = useState(allHierarchyValues);
  const [cityFilter, setCityFilter] = useState(allHierarchyValues);
  const [hierarchyCountries, setHierarchyCountries] = useState<BikeShopHierarchyItem[]>([]);
  const [hierarchyRegions, setHierarchyRegions] = useState<BikeShopHierarchyItem[]>([]);
  const [hierarchyCities, setHierarchyCities] = useState<BikeShopHierarchyItem[]>([]);
  const [hierarchyStatus, setHierarchyStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [hierarchyError, setHierarchyError] = useState('');
  const [hierarchyTotal, setHierarchyTotal] = useState(0);
  const [hierarchyOffset, setHierarchyOffset] = useState(0);
  const [hierarchyLoadingMore, setHierarchyLoadingMore] = useState(false);
  const [nameSearchTerm, setNameSearchTerm] = useState('');
  const [nameSearchTotal, setNameSearchTotal] = useState(0);
  const [nameSearchOffset, setNameSearchOffset] = useState(0);
  const [nameSearchLoadingMore, setNameSearchLoadingMore] = useState(false);
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
  const resultListRef = useRef<HTMLOListElement | null>(null);
  const mapFocusGenerationRef = useRef(0);
  const resultIntentGenerationRef = useRef(0);
  const accountIdRef = useRef(accountId);
  const publicSearchRef = useRef<{
    generation: number;
    resultIntentGeneration: number;
    controller: AbortController | null;
    busy: boolean;
  }>({
    generation: 0,
    resultIntentGeneration: 0,
    controller: null,
    busy: false,
  });
  const viewportRequestRef = useRef<{
    generation: number;
    controller: AbortController | null;
    key: string;
  }>({ generation: 0, controller: null, key: '' });
  const myClaimsRequestRef = useRef<{ generation: number; controller: AbortController | null }>({
    generation: 0,
    controller: null,
  });
  const adminClaimsRequestRef = useRef<{ generation: number; controller: AbortController | null }>({
    generation: 0,
    controller: null,
  });
  accountIdRef.current = accountId;

  const visibleShops = useMemo(() => resultMode === 'hierarchy' ? shops
    .filter((shop) => countryFilter === allHierarchyValues || shopHierarchy(shop).country === countryFilter)
    .filter((shop) => regionFilter === allHierarchyValues || shopHierarchy(shop).region === regionFilter)
    .filter((shop) => cityFilter === allHierarchyValues || shopHierarchy(shop).city === cityFilter) : shops, [
    cityFilter,
    countryFilter,
    regionFilter,
    resultMode,
    shops,
  ]);
  const hierarchyHasMore = resultMode === 'hierarchy' && hierarchyOffset < hierarchyTotal;
  const nameSearchHasMore = resultMode === 'name' && nameSearchOffset < nameSearchTotal;
  const hierarchyCountriesForDisplay = useMemo(
    () => hierarchyCountryItemsForDisplay(hierarchyCountries),
    [hierarchyCountries],
  );
  const hierarchyCatalogTotal = hierarchyCountries.reduce((total, item) => total + item.count, 0);
  const selectedShop = visibleShops.find((shop) => shop.id === selectedShopId) ?? visibleShops[0] ?? null;
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
    viewportRequestRef.current.controller?.abort();
    viewportRequestRef.current = {
      generation: viewportRequestRef.current.generation + 1,
      controller: null,
      key: '',
    };
    publicSearchRef.current.controller?.abort();
    const resultIntentGeneration = resultIntentGenerationRef.current + 1;
    resultIntentGenerationRef.current = resultIntentGeneration;
    const request = {
      generation: publicSearchRef.current.generation + 1,
      resultIntentGeneration,
      controller: new AbortController(),
    };
    publicSearchRef.current = { ...request, busy: true };
    return request;
  };

  const publicSearchIsCurrent = (request: {
    generation: number;
    resultIntentGeneration: number;
    controller: AbortController;
  }) => (
    !request.controller.signal.aborted
    && publicSearchRef.current.generation === request.generation
    && publicSearchRef.current.resultIntentGeneration === request.resultIntentGeneration
    && publicSearchRef.current.controller === request.controller
    && resultIntentGenerationRef.current === request.resultIntentGeneration
  );

  const finishPublicSearch = (request: {
    generation: number;
    resultIntentGeneration: number;
    controller: AbortController;
  }) => {
    if (!publicSearchIsCurrent(request)) return;
    publicSearchRef.current = {
      generation: request.generation,
      resultIntentGeneration: request.resultIntentGeneration,
      controller: null,
      busy: false,
    };
  };

  const clearPublicResults = () => {
    resultIntentGenerationRef.current += 1;
    publicSearchRef.current.controller?.abort();
    publicSearchRef.current = {
      generation: publicSearchRef.current.generation + 1,
      resultIntentGeneration: resultIntentGenerationRef.current,
      controller: null,
      busy: false,
    };
    viewportRequestRef.current.controller?.abort();
    viewportRequestRef.current = {
      generation: viewportRequestRef.current.generation + 1,
      controller: null,
      key: '',
    };
    setShops([]);
    setSelectedShopId('');
    setStatus('idle');
    setError('');
    setDirectoryNotice('');
    setHasSearched(false);
    setResultMode('none');
    setNearbyContext(null);
    setViewportTruncated(false);
    setMapFocusRequest(null);
    setHierarchyTotal(0);
    setHierarchyOffset(0);
    setHierarchyLoadingMore(false);
    setNameSearchTerm('');
    setNameSearchTotal(0);
    setNameSearchOffset(0);
    setNameSearchLoadingMore(false);
  };

  const focusMapAt = (origin: LocatedSearch, requestedRadiusMiles = radiusMiles) => {
    mapFocusGenerationRef.current += 1;
    setMapFocusRequest({
      id: mapFocusGenerationRef.current,
      points: mapFocusPoints(origin, requestedRadiusMiles),
    });
  };

  const focusMapAtBounds = (bounds: { north: number; south: number; east: number; west: number } | null) => {
    if (!bounds) return;
    mapFocusGenerationRef.current += 1;
    setMapFocusRequest({
      id: mapFocusGenerationRef.current,
      points: [
        { latitude: bounds.south, longitude: bounds.west },
        { latitude: bounds.north, longitude: bounds.east },
      ],
    });
  };

  const runNearbyFallbackSearch = async (
    origin: LocatedSearch,
    request: { generation: number; resultIntentGeneration: number; controller: AbortController },
  ) => {
    const requestedRadiusMiles = radiusMiles;
    if (!publicSearchIsCurrent(request)) return;
    setStatus('searching');
    setError('');
    setDirectoryNotice('');
    setHasSearched(true);
    try {
      const result = await searchNearbyBikeShops(origin, requestedRadiusMiles, fetch, request.controller.signal);
      if (!publicSearchIsCurrent(request)) return;
      setShops(result.shops);
      setSelectedShopId(result.shops[0]?.id ?? '');
      setResultMode('nearby');
      setNearbyContext({ label: origin.label, radiusMiles: requestedRadiusMiles });
      setViewportTruncated(false);
      setDirectoryNotice(result.degraded ? result.notice : '');
    } catch (caught) {
      if (!publicSearchIsCurrent(request)) return;
      setShops([]);
      setSelectedShopId('');
      setResultMode('none');
      setNearbyContext(null);
      setError(caught instanceof Error ? caught.message : 'Bike shops could not be loaded. Please try again.');
      setDirectoryNotice('');
    } finally {
      if (!publicSearchIsCurrent(request)) return;
      focusMapAt(origin, requestedRadiusMiles);
      setStatus('ready');
      finishPublicSearch(request);
    }
  };

  const runBikeShopNameSearch = async (term: string, append = false) => {
    const requestedTerm = append ? nameSearchTerm : term.trim();
    const request = beginPublicSearch();
    if (!request) return;
    if (requestedTerm.length < 2) {
      setError('Enter at least 2 characters of a bike shop name.');
      finishPublicSearch(request);
      return;
    }
    setStatus('searching');
    setError('');
    setDirectoryNotice('');
    setHasSearched(true);
    setNameSearchLoadingMore(append);
    try {
      const result = await searchBikeShopsByName(requestedTerm, {
        offset: append ? nameSearchOffset : 0,
        fetcher: fetch,
        signal: request.controller.signal,
      });
      if (!publicSearchIsCurrent(request)) return;
      const nextShops = append
        ? [...new Map([...shops, ...result.shops].map((shop) => [shop.id, shop])).values()]
        : result.shops;
      setShops(nextShops);
      setSelectedShopId((current) => nextShops.some((shop) => shop.id === current)
        ? current
        : nextShops[0]?.id ?? '');
      setResultMode('name');
      setNearbyContext(null);
      setViewportTruncated(result.truncated);
      setNameSearchTerm(result.query);
      setNameSearchTotal(result.total);
      setNameSearchOffset(Math.min(result.total, result.offset + result.shops.length));
      if (!append) focusMapAtBounds(result.bounds);
      setStatus('ready');
    } catch (caught) {
      if (!publicSearchIsCurrent(request)) return;
      if (!append) {
        setShops([]);
        setSelectedShopId('');
        setResultMode('none');
        setNearbyContext(null);
        setViewportTruncated(false);
        setNameSearchTotal(0);
        setNameSearchOffset(0);
      }
      setStatus('ready');
      setError(caught instanceof Error ? caught.message : 'Bike shops matching that name could not be loaded.');
    } finally {
      if (!publicSearchIsCurrent(request)) return;
      setNameSearchLoadingMore(false);
      finishPublicSearch(request);
    }
  };

  const changeShopSearchMode = (nextMode: 'location' | 'name') => {
    if (nextMode === shopSearchMode) return;
    clearPublicResults();
    resetPlaceAutocompleteSession();
    setShopSearchMode(nextMode);
    setLocationInput('');
    setLocationPrediction(null);
    setLocationPredictions([]);
    setLocationPredictionStatus('');
  };

  const handleLocationInputChange = (value: string) => {
    if (locationPrediction && locationPrediction.label !== value) {
      setLocationPrediction(null);
      setLocationPredictions([]);
      setLocationPredictionStatus('');
      resetPlaceAutocompleteSession();
    }
    setLocationInput(value.slice(0, 240));
  };

  const loadMapViewport = async (
    viewport: BikeShopViewport,
    observedResultIntentGeneration: number,
  ) => {
    if (observedResultIntentGeneration !== resultIntentGenerationRef.current) return;
    setMapZoom(viewport.zoom);
    if (viewport.zoom < bikeShopViewportMinimumZoom) {
      viewportRequestRef.current.controller?.abort();
      viewportRequestRef.current = {
        generation: viewportRequestRef.current.generation + 1,
        controller: null,
        key: '',
      };
      if (!['nearby', 'hierarchy', 'name'].includes(resultMode)) {
        setShops([]);
        setSelectedShopId('');
        setHasSearched(false);
        setResultMode('none');
        setNearbyContext(null);
        setViewportTruncated(false);
      }
      setStatus((current) => publicSearchRef.current.busy ? current : 'idle');
      return;
    }

    const key = [viewport.north, viewport.south, viewport.east, viewport.west, viewport.zoom]
      .map((value) => value.toFixed(5))
      .join(':');
    if (viewportRequestRef.current.key === key && !error) return;
    publicSearchRef.current.controller?.abort();
    publicSearchRef.current = {
      generation: publicSearchRef.current.generation + 1,
      resultIntentGeneration: publicSearchRef.current.resultIntentGeneration,
      controller: null,
      busy: false,
    };
    viewportRequestRef.current.controller?.abort();
    const generation = viewportRequestRef.current.generation + 1;
    const resultIntentGeneration = resultIntentGenerationRef.current + 1;
    resultIntentGenerationRef.current = resultIntentGeneration;
    const controller = new AbortController();
    const preserveSearchFallback = ['nearby', 'hierarchy', 'name'].includes(resultMode) && shops.length > 0;
    viewportRequestRef.current = { generation, controller, key };
    const isCurrent = () => (
      !controller.signal.aborted
      && viewportRequestRef.current.generation === generation
      && viewportRequestRef.current.controller === controller
      && resultIntentGenerationRef.current === resultIntentGeneration
    );
    setStatus('searching');
    setError('');
    setDirectoryNotice('');
    setHasSearched(true);
    try {
      const result = await searchBikeShopsInViewport(viewport, fetch, controller.signal);
      if (!isCurrent()) return;
      const center = viewportCenter(result.viewport);
      const locatedShops = result.shops
        .map((shop) => ({ ...shop, distanceMiles: distanceBetweenMiles(center, shop) }))
        .sort((left, right) => left.distanceMiles - right.distanceMiles
          || left.name.localeCompare(right.name)
          || left.id.localeCompare(right.id));
      setShops(locatedShops);
      setSelectedShopId((current) => locatedShops.some((shop) => shop.id === current)
        ? current
        : locatedShops[0]?.id ?? '');
      setViewportTruncated(result.truncated);
      setResultMode('viewport');
      setNearbyContext(null);
      setDirectoryNotice(result.degraded ? result.notice : '');
      setStatus('ready');
    } catch (caught) {
      if (!isCurrent()) return;
      if (!preserveSearchFallback) {
        setShops([]);
        setSelectedShopId('');
        setResultMode('none');
        setNearbyContext(null);
        setViewportTruncated(false);
      }
      setStatus('ready');
      setError(caught instanceof Error ? caught.message : 'Bike shops could not be loaded. Please try again.');
      if (!preserveSearchFallback) setDirectoryNotice('');
    } finally {
      if (!isCurrent()) return;
      viewportRequestRef.current = { generation, controller: null, key };
    }
  };

  const focusHierarchyShops = (matchingShops: BikeShopRecord[]) => {
    if (matchingShops.length === 0) return;
    mapFocusGenerationRef.current += 1;
    setMapFocusRequest({
      id: mapFocusGenerationRef.current,
      points: matchingShops.map((shop) => ({ latitude: shop.latitude, longitude: shop.longitude })),
    });
    setSelectedShopId((current) => matchingShops.some((shop) => shop.id === current)
      ? current
      : matchingShops[0].id);
  };

  const selectShopFromMap = (shopId: string) => {
    setSelectedShopId(shopId);
    window.requestAnimationFrame(() => {
      resultListRef.current?.querySelector<HTMLElement>('[data-selected-shop="true"]')?.scrollIntoView({
        block: 'nearest',
      });
    });
  };

  const searchSelectedLocation = async (prediction: PlacePredictionOption) => {
    const request = beginPublicSearch();
    if (!request) return;
    setLocationPrediction(prediction);
    setLocationPredictions([]);
    setLocationPredictionStatus('');
    setCountryFilter(allHierarchyValues);
    setRegionFilter(allHierarchyValues);
    setCityFilter(allHierarchyValues);
    setStatus('locating');
    setError('');
    try {
      const result = await resolvePlacePrediction(prediction);
      if (!publicSearchIsCurrent(request)) return;
      const origin = {
        latitude: result.point.lat,
        longitude: result.point.lng,
        label: result.label || prediction.label,
      };
      setLocationInput(origin.label);
      await runNearbyFallbackSearch(origin, request);
    } catch (caught) {
      if (!publicSearchIsCurrent(request)) return;
      setStatus('idle');
      setError(caught instanceof Error ? caught.message : 'That location could not be found.');
      finishPublicSearch(request);
    }
  };

  const searchManualLocation = async (event: FormEvent) => {
    event.preventDefault();
    if (shopSearchMode === 'name') {
      await runBikeShopNameSearch(locationInput);
      return;
    }
    const request = beginPublicSearch();
    if (!request) return;
    setCountryFilter(allHierarchyValues);
    setRegionFilter(allHierarchyValues);
    setCityFilter(allHierarchyValues);
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
      await runNearbyFallbackSearch(origin, request);
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
    setCountryFilter(allHierarchyValues);
    setRegionFilter(allHierarchyValues);
    setCityFilter(allHierarchyValues);
    setStatus('locating');
    setError('');
    try {
      const position = await currentPosition();
      if (!publicSearchIsCurrent(request)) return;
      const origin = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        label: 'Current location',
      };
      setLocationInput(origin.label);
      await runNearbyFallbackSearch(origin, request);
    } catch (caught) {
      if (!publicSearchIsCurrent(request)) return;
      setStatus('idle');
      setError(locationPermissionDenied(caught)
        ? 'Location permission was denied. Enter a city, ZIP code, or address instead.'
        : caught instanceof Error ? caught.message : 'Your current location could not be found.');
      finishPublicSearch(request);
    }
  };

  const browseHierarchyScope = async (
    location: {
      countryCode: string;
      region?: string;
      locality?: string;
      offset?: number;
    },
    append = false,
  ) => {
    const request = beginPublicSearch();
    if (!request) return;
    setHierarchyLoadingMore(append);
    setStatus('searching');
    setError('');
    setDirectoryNotice('');
    setHasSearched(true);
    try {
      const result = await browseBikeShopsByScope(location, fetch, request.controller.signal);
      if (!publicSearchIsCurrent(request)) return;
      const nextShops = append
        ? [...new Map([...shops, ...result.shops].map((shop) => [shop.id, shop])).values()]
        : result.shops;
      setShops(nextShops);
      setSelectedShopId((current) => nextShops.some((shop) => shop.id === current)
        ? current
        : nextShops[0]?.id ?? '');
      setResultMode('hierarchy');
      setNearbyContext(null);
      setViewportTruncated(result.truncated);
      setHierarchyTotal(result.total);
      setHierarchyOffset(Math.min(result.total, result.offset + result.shops.length));
      if (!append && result.shops.length > 0) focusHierarchyShops(result.shops);
    } catch (caught) {
      if (!publicSearchIsCurrent(request)) return;
      if (!append) {
        setShops([]);
        setSelectedShopId('');
        setResultMode('none');
        setNearbyContext(null);
        setViewportTruncated(false);
        setHierarchyTotal(0);
        setHierarchyOffset(0);
      }
      setError(caught instanceof Error ? caught.message : 'Bike shops for this directory area could not be loaded.');
    } finally {
      if (!publicSearchIsCurrent(request)) return;
      setStatus('ready');
      setHierarchyLoadingMore(false);
      finishPublicSearch(request);
    }
  };

  const loadMoreHierarchyShops = () => {
    if (!hierarchyHasMore || hierarchyLoadingMore || busy) return;
    void browseHierarchyScope({
      countryCode: countryFilter,
      ...(regionFilter !== allHierarchyValues ? { region: regionFilter } : {}),
      ...(cityFilter !== allHierarchyValues ? { locality: cityFilter } : {}),
      offset: hierarchyOffset,
    }, true);
  };

  const hierarchyResultContext = resultMode === 'hierarchy' && countryFilter !== allHierarchyValues
    ? cityFilter !== allHierarchyValues
      ? `${hierarchyLabel('city', cityFilter)}, ${hierarchyLabel('region', regionFilter)} · ${hierarchyLabel('country', countryFilter)}`
      : regionFilter !== allHierarchyValues
        ? `${hierarchyLabel('region', regionFilter)} · ${hierarchyLabel('country', countryFilter)}`
        : `${hierarchyLabel('country', countryFilter)} · all states / provinces`
    : '';

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

  useEffect(() => {
    const controller = new AbortController();
    setHierarchyStatus('loading');
    setHierarchyError('');
    void listBikeShopHierarchy({}, fetch, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setHierarchyCountries(result.items);
      setHierarchyStatus('ready');
    }).catch((caught) => {
      if (controller.signal.aborted) return;
      setHierarchyCountries([]);
      setHierarchyStatus('error');
      setHierarchyError(caught instanceof Error ? caught.message : 'Countries could not be loaded.');
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    setHierarchyRegions([]);
    setHierarchyCities([]);
    if (countryFilter === allHierarchyValues) return undefined;
    const controller = new AbortController();
    setHierarchyStatus('loading');
    setHierarchyError('');
    void listBikeShopHierarchy({ countryCode: countryFilter }, fetch, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setHierarchyRegions(result.items);
      setHierarchyStatus('ready');
    }).catch((caught) => {
      if (controller.signal.aborted) return;
      setHierarchyStatus('error');
      setHierarchyError(caught instanceof Error ? caught.message : 'States and provinces could not be loaded.');
    });
    return () => controller.abort();
  }, [countryFilter]);

  useEffect(() => {
    setHierarchyCities([]);
    if (countryFilter === allHierarchyValues || regionFilter === allHierarchyValues) return undefined;
    const controller = new AbortController();
    setHierarchyStatus('loading');
    setHierarchyError('');
    void listBikeShopHierarchy({
      countryCode: countryFilter,
      region: regionFilter,
    }, fetch, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setHierarchyCities(result.items);
      setHierarchyStatus('ready');
    }).catch((caught) => {
      if (controller.signal.aborted) return;
      setHierarchyStatus('error');
      setHierarchyError(caught instanceof Error ? caught.message : 'Cities could not be loaded.');
    });
    return () => controller.abort();
  }, [countryFilter, regionFilter]);

  useEffect(() => {
    const input = locationInput.trim();
    if (
      shopSearchMode !== 'location'
      || input.length < 3
      || input === 'Current location'
      || Boolean(locationPrediction)
    ) {
      setLocationPredictions([]);
      setLocationPredictionStatus('');
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLocationPredictionStatus('Loading location suggestions…');
      void fetchLocationPredictions(input).then((predictions) => {
        if (cancelled) return;
        setLocationPredictions(predictions.slice(0, 6));
        setLocationPredictionStatus(predictions.length > 0 ? '' : 'No matching location suggestions');
      }).catch(() => {
        if (cancelled) return;
        setLocationPredictions([]);
        setLocationPredictionStatus('');
      });
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [locationInput, locationPrediction, shopSearchMode]);

  useEffect(() => () => {
    resultIntentGenerationRef.current += 1;
    publicSearchRef.current.controller?.abort();
    publicSearchRef.current = {
      generation: publicSearchRef.current.generation + 1,
      resultIntentGeneration: publicSearchRef.current.resultIntentGeneration,
      controller: null,
      busy: false,
    };
    viewportRequestRef.current.controller?.abort();
    viewportRequestRef.current = {
      generation: viewportRequestRef.current.generation + 1,
      controller: null,
      key: '',
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
    resetPlaceAutocompleteSession();
  }, []);

  const busy = status === 'locating' || status === 'searching';

  return (
    <section className="public-bike-shop-directory" id="bike-shop-directory" aria-labelledby="bike-shop-directory-title">
      <div className="public-bike-shop-directory__inner">
        <header className="public-bike-shop-directory__header">
          <div>
            <span className="eyebrow"><Globe2 size={14} /> Global bike shop directory</span>
            <h2 id="bike-shop-directory-title">Find a bike shop near you</h2>
            <p>No TrackLab account is needed to search. Explore the Google map, or browse the full catalog by country, state / province, and city just like the track directory.</p>
          </div>
          <span><Store size={17} /> Public directory</span>
        </header>

        <form className="public-bike-shop-directory__search" onSubmit={(event) => void searchManualLocation(event)}>
          <div className="public-bike-shop-directory__search-mode" role="group" aria-label="Bike shop search type">
            <span>Search by</span>
            <button type="button" className={shopSearchMode === 'location' ? 'selected' : ''} aria-pressed={shopSearchMode === 'location'} onClick={() => changeShopSearchMode('location')}>
              <MapPin size={16} /> Location
            </button>
            <button type="button" className={shopSearchMode === 'name' ? 'selected' : ''} aria-pressed={shopSearchMode === 'name'} onClick={() => changeShopSearchMode('name')}>
              <Store size={16} /> Bike shop name
            </button>
          </div>
          <label className="public-bike-shop-directory__location">
            <span>{shopSearchMode === 'name' ? 'Search by bike shop name' : 'Jump to a location'}</span>
            <div>
              {shopSearchMode === 'name' ? <Store size={18} /> : <MapPin size={18} />}
              <input
                type="search"
                disabled={busy}
                value={locationInput}
                onChange={(event) => handleLocationInputChange(event.currentTarget.value)}
                placeholder={shopSearchMode === 'name' ? 'Shop name (for example, Ray’s Cycle)' : 'City, state, country, ZIP code, or address'}
                autoComplete="off"
                aria-autocomplete={shopSearchMode === 'location' ? 'list' : 'none'}
                aria-controls={shopSearchMode === 'location' ? 'bike-shop-location-suggestions' : undefined}
                aria-expanded={shopSearchMode === 'location' && locationPredictions.length > 0}
              />
            </div>
            {shopSearchMode === 'location' && locationPredictions.length > 0 && (
              <div id="bike-shop-location-suggestions" className="public-bike-shop-directory__location-suggestions" role="listbox" aria-label="Location suggestions">
                {locationPredictions.map((prediction) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={locationPrediction?.id === prediction.id}
                    key={prediction.id}
                    disabled={busy}
                    onClick={() => void searchSelectedLocation(prediction)}
                  >
                    <strong>{prediction.mainText || prediction.label}</strong>
                    {prediction.secondaryText && <small>{prediction.secondaryText}</small>}
                  </button>
                ))}
              </div>
            )}
            {shopSearchMode === 'location' && locationPredictionStatus && <small className="public-bike-shop-directory__location-hint" role="status">{locationPredictionStatus}</small>}
          </label>
          <label className="public-bike-shop-directory__radius">
            <span>{shopSearchMode === 'name' ? 'Map area (after search)' : 'Map area'}</span>
            <select aria-label="Map area" value={radiusMiles} disabled={busy || shopSearchMode === 'name'} onChange={(event) => setRadiusMiles(Number(event.currentTarget.value))}>
              {radiusOptions.map((radius) => <option value={radius} key={radius}>{radius} miles</option>)}
            </select>
          </label>
          <button className="public-bike-shop-directory__submit" type="submit" disabled={busy}>
            <Search size={18} /> {status === 'locating' ? 'Finding location…' : status === 'searching' ? 'Searching…' : shopSearchMode === 'name' ? 'Search shop name' : 'Show on map'}
          </button>
          <button className="public-bike-shop-directory__locate" type="button" disabled={busy || shopSearchMode === 'name'} onClick={() => void useCurrentLocation()}>
            <LocateFixed size={18} /> Use current location
          </button>
        </form>

        {error && <div className="public-bike-shop-directory__error" role="alert">{error}</div>}
        {directoryNotice && (
          <div className="public-bike-shop-directory__notice" role="status">{directoryNotice}</div>
        )}

        <div className="public-bike-shop-directory__layout">
          <div className="public-bike-shop-directory__map-panel">
            <BikeShopDirectoryMap
              shops={visibleShops}
              selectedShopId={selectedShop?.id ?? ''}
              busy={status === 'searching'}
              requestError={error}
              truncated={viewportTruncated}
              focusRequest={mapFocusRequest}
              getResultIntentGeneration={() => resultIntentGenerationRef.current}
              onSelectShop={selectShopFromMap}
              onViewportChange={(viewport, observedResultIntentGeneration) => (
                void loadMapViewport(viewport, observedResultIntentGeneration)
              )}
            />
          </div>

          <aside className="public-bike-shop-directory__results" aria-label="Bike shops in the visible map area">
            <div className="public-bike-shop-directory__results-heading">
              <div>
                <strong>{busy && shops.length === 0
                  ? 'Loading this map area'
                  : hasSearched
                    ? resultMode === 'hierarchy'
                      ? `${Math.min(visibleShops.length, hierarchyTotal || visibleShops.length).toLocaleString()}${hierarchyTotal > visibleShops.length ? ` of ${hierarchyTotal.toLocaleString()}` : ''} mapped bike ${hierarchyTotal === 1 ? 'shop' : 'shops'}`
                      : resultMode === 'name'
                        ? `${Math.min(visibleShops.length, nameSearchTotal || visibleShops.length).toLocaleString()}${nameSearchTotal > visibleShops.length ? ` of ${nameSearchTotal.toLocaleString()}` : ''} name ${nameSearchTotal === 1 ? 'match' : 'matches'}`
                      : `${visibleShops.length}${visibleShops.length !== shops.length ? ` of ${shops.length}` : ''} mapped bike ${visibleShops.length === 1 ? 'shop' : 'shops'}`
                    : 'Explore the map'}</strong>
                <small>{resultMode === 'nearby' && nearbyContext
                  ? `Near ${nearbyContext.label} · within ${nearbyContext.radiusMiles} miles`
                  : hierarchyResultContext
                    ? hierarchyResultContext
                  : resultMode === 'name' && nameSearchTerm
                    ? `Matching “${nameSearchTerm}” · select a shop for details`
                  : mapZoom < bikeShopViewportMinimumZoom
                    ? `Zoom in to level ${bikeShopViewportMinimumZoom} to load individual shops`
                  : 'The list refreshes automatically after you move or zoom the map'}</small>
              </div>
              {resultMode === 'hierarchy' && countryFilter !== allHierarchyValues && (
                <button type="button" onClick={() => {
                  clearPublicResults();
                  setCountryFilter(allHierarchyValues);
                  setRegionFilter(allHierarchyValues);
                  setCityFilter(allHierarchyValues);
                }}>Return to map browsing</button>
              )}
            </div>

            <div className="public-bike-shop-directory__hierarchy" aria-label="Browse the global directory by country, state or province, and city">
              <span><ListTree size={15} /> Global list: country → state / province → city{hierarchyCatalogTotal > 0 ? ` · ${hierarchyCatalogTotal.toLocaleString()} cataloged shops` : ''}</span>
              <div>
                <label>
                  <span>Country</span>
                  <select value={countryFilter} onChange={(event) => {
                    const country = event.currentTarget.value;
                    clearPublicResults();
                    setCountryFilter(country);
                    setRegionFilter(allHierarchyValues);
                    setCityFilter(allHierarchyValues);
                    if (country !== allHierarchyValues) {
                      void browseHierarchyScope({ countryCode: country });
                    }
                  }} disabled={busy || (hierarchyStatus === 'loading' && hierarchyCountries.length === 0)}>
                    <option value={allHierarchyValues}>{hierarchyStatus === 'loading' && hierarchyCountries.length === 0 ? 'Loading countries…' : 'Choose a country'}</option>
                    {hierarchyCountriesForDisplay.map((item) => <option value={item.value} key={item.value}>{hierarchyLabel('country', item.value)} ({item.count.toLocaleString()})</option>)}
                  </select>
                </label>
                <label>
                  <span>State / province</span>
                  <select disabled={busy || countryFilter === allHierarchyValues} value={regionFilter} onChange={(event) => {
                    const region = event.currentTarget.value;
                    clearPublicResults();
                    setRegionFilter(region);
                    setCityFilter(allHierarchyValues);
                    if (countryFilter !== allHierarchyValues && region !== allHierarchyValues) {
                      void browseHierarchyScope({ countryCode: countryFilter, region });
                    }
                  }}>
                    <option value={allHierarchyValues}>{hierarchyStatus === 'loading' && countryFilter !== allHierarchyValues && hierarchyRegions.length === 0 ? 'Loading states / provinces…' : 'Choose a state / province'}</option>
                    {hierarchyRegions.map((item) => <option value={item.value} key={item.value}>{hierarchyLabel('region', item.value)} ({item.count.toLocaleString()})</option>)}
                  </select>
                </label>
                <label>
                  <span>City</span>
                  <select disabled={busy || countryFilter === allHierarchyValues || regionFilter === allHierarchyValues} value={cityFilter} onChange={(event) => {
                    const city = event.currentTarget.value;
                    clearPublicResults();
                    setCityFilter(city);
                    if (city !== allHierarchyValues) {
                      void browseHierarchyScope({
                        countryCode: countryFilter,
                        region: regionFilter,
                        locality: city,
                      });
                    }
                  }}>
                    <option value={allHierarchyValues}>{hierarchyStatus === 'loading' && regionFilter !== allHierarchyValues && hierarchyCities.length === 0 ? 'Loading cities…' : 'Choose a city'}</option>
                    {hierarchyCities.map((item) => <option value={item.value} key={item.value}>{hierarchyLabel('city', item.value)} ({item.count.toLocaleString()})</option>)}
                  </select>
                </label>
              </div>
              {hierarchyError && <small className="public-bike-shop-directory__hierarchy-error" role="alert">{hierarchyError}</small>}
            </div>

            {viewportTruncated && (
              <p className="public-bike-shop-directory__truncated" role="status">{resultMode === 'hierarchy'
                ? `Showing the first ${shops.length.toLocaleString()} cataloged shops for this directory area. Narrow by state / province or city, or load more below.`
                : resultMode === 'name'
                  ? `Showing the first ${shops.length.toLocaleString()} matches. Load more below to see additional shops with this name.`
                : 'This area contains more shops than can be shown at once. Zoom in for a complete local view.'}</p>
            )}

            <ol ref={resultListRef} className="public-bike-shop-directory__result-list" aria-label="Loaded bike shop listings">
              {visibleShops.map((shop) => {
                const labels = serviceLabels(shop);
                const selected = shop.id === selectedShop?.id;
                return (
                  <li key={shop.id}>
                    <button
                      type="button"
                      className={selected ? 'selected' : ''}
                      aria-pressed={selected}
                      data-selected-shop={selected ? 'true' : 'false'}
                      onClick={() => setSelectedShopId(shop.id)}
                    >
                      <span className="public-bike-shop-directory__result-title"><strong>{shop.name}{shop.claimed ? ' · ✓ Claimed' : ''}</strong>{['nearby', 'viewport'].includes(resultMode) && <b>{shop.distanceMiles.toFixed(1)} mi</b>}</span>
                      <span><MapPin size={14} /> {bikeShopAddress(shop)}</span>
                      {labels.length > 0 && <small>{labels.join(' · ')}</small>}
                    </button>
                  </li>
                );
              })}
              {!busy && hasSearched && shops.length === 0 && !error && (
                <li className="public-bike-shop-directory__empty">
                  <Bike size={26} />
                  <strong>{resultMode === 'name' ? 'No bike shops matched that name' : 'No mapped bike shops found'}</strong>
                  <span>{resultMode === 'name' ? 'Try a shorter name or a different spelling.' : 'Move the map to another nearby area or zoom out slightly.'}</span>
                </li>
              )}
              {shops.length > 0 && visibleShops.length === 0 && (
                <li className="public-bike-shop-directory__empty">
                  <ListTree size={26} />
                  <strong>No shops match this location group</strong>
                  <span>Choose a broader country, state / province, or city above.</span>
                </li>
              )}
              {!hasSearched && (
                <li className="public-bike-shop-directory__empty">
                  <Search size={26} />
                  <strong>Choose a country or zoom closer to browse shops</strong>
                  <span>Every cataloged country, state / province, and city is available in the global list.</span>
                </li>
              )}
              {(hierarchyHasMore || nameSearchHasMore) && visibleShops.length > 0 && (
                <li className="public-bike-shop-directory__load-more">
                  <button type="button" onClick={() => {
                    if (resultMode === 'name') void runBikeShopNameSearch(nameSearchTerm, true);
                    else loadMoreHierarchyShops();
                  }} disabled={hierarchyLoadingMore || nameSearchLoadingMore || busy}>
                    {hierarchyLoadingMore || nameSearchLoadingMore ? 'Loading more shops…' : `Load more shops (${(resultMode === 'name' ? nameSearchTotal - nameSearchOffset : hierarchyTotal - hierarchyOffset).toLocaleString()} remaining)`}
                  </button>
                </li>
              )}
            </ol>
          </aside>
        </div>

        <div className="public-bike-shop-directory__detail">
            {selectedShop ? (
              <>
                <div className="public-bike-shop-directory__shop-card">
                  <div className="public-bike-shop-directory__shop-intro">
                    <span className="eyebrow">{resultMode === 'hierarchy'
                      ? 'Global directory listing'
                      : `${selectedShop.distanceMiles.toFixed(1)} miles from ${resultMode === 'nearby' ? 'your chosen location' : 'the map center'}`}</span>
                    <h3>{selectedShop.name}</h3>
                    <p><MapPin size={16} /> {bikeShopAddress(selectedShop)}</p>
                    <p>Directory {selectedShop.source.provenance && selectedShop.source.provenance.length > 1 ? 'sources' : 'source'}: {(selectedShop.source.provenance?.length
                      ? selectedShop.source.provenance
                      : [selectedShop.source.provider]).join(' + ')}</p>
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
                <strong>{busy ? 'Finding bike shops in this map area…' : 'Select a bike shop'}</strong>
                <span>Shop details, map links, and nearby BMX tracks will appear here.</span>
              </div>
            )}
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
                      {claim.source === 'overture'
                        ? `Overture Maps place ${claim.osmElementId}`
                        : `OpenStreetMap ${claim.osmElementType} ${claim.osmElementId}`} <ExternalLink size={13} />
                    </a>
                  </p>
                  {claim.shopSnapshot && (
                    <section className="public-bike-shop-directory__claim-snapshot" aria-label={`Canonical listing details for ${claim.shopSnapshot.name}`}>
                      <strong>Canonical listing snapshot</strong>
                      <span>{claim.shopSnapshot.name}</span>
                      {claimSnapshotAddress(claim) && <span>{claimSnapshotAddress(claim)}</span>}
                      <span>
                        Source:{' '}
                        {claim.shopSnapshot.source.url
                          ? <a href={claim.shopSnapshot.source.url} target="_blank" rel="noopener noreferrer">{claim.shopSnapshot.source.provider} <ExternalLink size={13} /></a>
                          : claim.shopSnapshot.source.provider}
                      </span>
                      {claim.shopSnapshot.phone && <span>Listed phone: {claim.shopSnapshot.phone}</span>}
                      {claim.shopSnapshot.website && <span>Listed website: <a href={claim.shopSnapshot.website} target="_blank" rel="noopener noreferrer">{claim.shopSnapshot.website} <ExternalLink size={13} /></a></span>}
                    </section>
                  )}
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
          <span>Preloaded catalog: <a href="https://docs.overturemaps.org/attribution/" target="_blank" rel="noopener noreferrer">Overture Maps</a></span>
          <span>Maps, directions, and Street View: <a href="https://www.google.com/maps" target="_blank" rel="noopener noreferrer">Google Maps</a></span>
          <span><a href="/legal/bike-shop-directory-data" target="_blank" rel="noopener noreferrer">Bike shop data licenses and change notice</a></span>
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
