import {
  distanceBetweenTrackPoints,
  pointAtRouteMeter,
  routeLengthMeters,
  routeIsClosedLoop,
  routeWithDefaultSplitBranches,
  routeWithSplitBranchSelections,
  splitSharedRouteSegments,
  type SplitBranchSelection,
} from './trackMapping';
import type { TrackPoint, TrackRecord, TrackZone } from '../types';
import { getRuntimeGoogleMapsApiKey } from './nativeRuntimeConfig';

type LatLngLiteral = {
  lat: number;
  lng: number;
};

type GoogleMap = {
  addListener: (eventName: string, handler: (event?: GoogleMapClickEvent) => void) => GoogleMapsEventListener;
  fitBounds: (bounds: GoogleLatLngBounds, padding?: number) => void;
  getCenter?: () => { toJSON: () => LatLngLiteral };
  getDiv?: () => HTMLElement;
  getHeading?: () => number | undefined;
  getTilt?: () => number | undefined;
  getZoom?: () => number | undefined;
  moveCamera?: (cameraOptions: Record<string, unknown>) => void;
  setCenter?: (position: LatLngLiteral) => void;
  setHeading: (heading: number) => void;
  setOptions: (options: Record<string, unknown>) => void;
  setTilt: (tilt: number) => void;
  setZoom?: (zoom: number) => void;
};

type GoogleMapClickEvent = {
  latLng?: {
    toJSON: () => LatLngLiteral;
  };
  placeId?: string;
  stop?: () => void;
};

type GoogleMapsEventListener = {
  remove: () => void;
};

type GoogleLatLngBounds = {
  extend: (point: LatLngLiteral) => void;
};

type GooglePolyline = {
  setMap: (map: GoogleMap | null) => void;
  setPath?: (path: LatLngLiteral[]) => void;
};

type GoogleMarker = {
  addListener: (eventName: string, handler: (event?: GoogleMapClickEvent) => void) => GoogleMapsEventListener;
  setIcon: (icon: Record<string, unknown>) => void;
  setLabel?: (label: string | Record<string, unknown> | null) => void;
  setMap: (map: GoogleMap | null) => void;
  setPosition: (position: LatLngLiteral) => void;
  setTitle?: (title: string) => void;
};

type GoogleMapCanvasProjection = {
  fromContainerPixelToLatLng: (point: unknown) => { toJSON: () => LatLngLiteral } | null;
  fromLatLngToDivPixel: (position: unknown) => { x: number; y: number } | null;
};

type GoogleMapPanes = {
  floatPane?: HTMLElement;
  overlayLayer?: HTMLElement;
  overlayMouseTarget?: HTMLElement;
};

type GoogleOverlayView = {
  draw: () => void;
  getPanes: () => GoogleMapPanes | null;
  getProjection: () => GoogleMapCanvasProjection | null;
  onAdd: () => void;
  onRemove: () => void;
  setMap: (map: GoogleMap | null) => void;
};

type GoogleGeocoder = {
  geocode: (request: { address?: string; location?: LatLngLiteral }) => Promise<{
    results?: Array<{
      formatted_address?: string;
      geometry?: {
        location?: {
          toJSON: () => LatLngLiteral;
        };
      };
    }>;
  }>;
};

type GooglePlaceTextValue = string | {
  text?: string;
  toString?: () => string;
};

type GooglePlace = {
  displayName?: string;
  formattedAddress?: string;
  googleMapsURI?: string;
  location?: {
    toJSON: () => LatLngLiteral;
  };
  nationalPhoneNumber?: string;
  primaryTypeDisplayName?: string;
  rating?: number;
  userRatingCount?: number;
  websiteURI?: string;
  fetchFields: (request: { fields: string[] }) => Promise<void>;
};

export type GooglePlacePrediction = {
  placeId: string;
  text?: GooglePlaceTextValue;
  mainText?: GooglePlaceTextValue;
  secondaryText?: GooglePlaceTextValue;
  toPlace: () => GooglePlace;
};

type GoogleAutocompleteSessionToken = object;

type GoogleLegacyAutocompletePrediction = {
  description?: string;
  place_id: string;
  structured_formatting?: {
    main_text?: string;
    secondary_text?: string;
  };
};

type GoogleLegacyAutocompleteResponse = {
  predictions?: GoogleLegacyAutocompletePrediction[];
};

type GoogleLegacyAutocompleteService = {
  getPlacePredictions: (
    request: { input: string; sessionToken?: GoogleAutocompleteSessionToken },
    callback?: (predictions: GoogleLegacyAutocompletePrediction[] | null, status: string) => void,
  ) => Promise<GoogleLegacyAutocompleteResponse> | void;
};

type GoogleLegacyPlaceResult = {
  formatted_address?: string;
  formatted_phone_number?: string;
  name?: string;
  opening_hours?: {
    isOpen?: () => boolean;
    open_now?: boolean;
    weekday_text?: string[];
  };
  rating?: number;
  types?: string[];
  url?: string;
  user_ratings_total?: number;
  website?: string;
  geometry?: {
    location?: {
      toJSON: () => LatLngLiteral;
    };
  };
};

type GoogleLegacyPlacesService = {
  getDetails: (
    request: { placeId: string; fields: string[]; sessionToken?: GoogleAutocompleteSessionToken },
    callback?: (place: GoogleLegacyPlaceResult | null, status: string) => void,
  ) => Promise<{ place?: GoogleLegacyPlaceResult }> | void;
};

type GoogleAutocompleteSuggestion = {
  placePrediction?: GooglePlacePrediction;
};

type GooglePlacesLibrary = {
  AutocompleteSessionToken?: new () => GoogleAutocompleteSessionToken;
  AutocompleteSuggestion?: {
    fetchAutocompleteSuggestions: (request: {
      input: string;
      sessionToken?: GoogleAutocompleteSessionToken;
    }) => Promise<{ suggestions?: GoogleAutocompleteSuggestion[] }>;
  };
  AutocompleteService?: new () => GoogleLegacyAutocompleteService;
  Place?: new (options: { id: string }) => GooglePlace;
  PlacesService?: new (element: HTMLElement) => GoogleLegacyPlacesService;
};

type GoogleStreetViewPanoramaData = {
  copyright?: string;
  imageDate?: string;
  location?: {
    description?: string;
    pano?: string;
    shortDescription?: string;
  };
};

type GoogleStreetViewPanorama = {
  focus?: () => void;
  setVisible: (visible: boolean) => void;
};

type GoogleStreetViewLibrary = {
  StreetViewPanorama?: new (
    element: HTMLElement,
    options?: Record<string, unknown>,
  ) => GoogleStreetViewPanorama;
  StreetViewService?: new () => {
    getPanorama: (request: {
      location: LatLngLiteral;
      preference?: string;
      radius?: number;
    }) => Promise<{ data: GoogleStreetViewPanoramaData }>;
  };
};

type GoogleMapConstructor = {
  new (element: HTMLElement, options: Record<string, unknown>): GoogleMap;
};

type GoogleMapsRuntime = {
  maps: {
    importLibrary?: (libraryName: string) => Promise<unknown>;
    geometry?: {
      spherical?: {
        computeLength: (path: LatLngLiteral[]) => number;
      };
    };
    event?: {
      trigger: (target: unknown, eventName: string) => void;
    };
    LatLng: new (lat: number, lng: number) => unknown;
    LatLngBounds: new () => GoogleLatLngBounds;
    Geocoder?: new () => GoogleGeocoder;
    Map: GoogleMapConstructor;
    Marker: new (options: Record<string, unknown>) => GoogleMarker;
    OverlayView?: new () => GoogleOverlayView;
    places?: GooglePlacesLibrary;
    Point: new (x: number, y: number) => unknown;
    Polyline: new (options: Record<string, unknown>) => GooglePolyline;
    RenderingType?: {
      VECTOR: unknown;
    };
    Size: new (width: number, height: number) => unknown;
    SymbolPath: {
      CIRCLE: unknown;
    };
  };
};

export type GoogleMap3DElement = HTMLElement & {
  cameraPosition?: { lat: number; lng: number; altitude?: number };
  center?: { lat: number; lng: number; altitude?: number };
  flyCameraTo?: (options: {
    endCamera: {
      altitudeMode?: 'ABSOLUTE' | 'RELATIVE_TO_GROUND';
      center: { lat: number; lng: number; altitude?: number };
      heading?: number;
      range?: number;
      tilt?: number;
    };
    durationMillis?: number;
  }) => Promise<void> | void;
  fov?: number;
  gestureHandling?: 'AUTO' | 'COOPERATIVE' | 'GREEDY' | string;
  heading?: number;
  mode?: string;
  range?: number;
  tilt?: number;
};

export type GooglePolyline3DElement = HTMLElement;

export type GoogleMarker3DElement = HTMLElement & {
  label?: string;
  position?: { lat: number; lng: number; altitude?: number };
  title?: string;
  zIndex?: number;
};

type Google3DMarkerConstructor = new (options?: Record<string, unknown>) => GoogleMarker3DElement;

export type GoogleMaps3DLibrary = {
  Map3DElement: new (options?: Record<string, unknown>) => GoogleMap3DElement;
  Marker3DElement?: Google3DMarkerConstructor;
  Marker3DInteractiveElement?: Google3DMarkerConstructor;
  MarkerElement?: Google3DMarkerConstructor;
  MarkerInteractiveElement?: Google3DMarkerConstructor;
  Polyline3DElement: new (options?: Record<string, unknown>) => GooglePolyline3DElement;
};

type GoogleMapsLibraryImport = Record<string, unknown> | null | undefined;

export type PlacePredictionOption = {
  id: string;
  label: string;
  mainText: string;
  secondaryText: string;
  placeId: string;
} & (
  | {
      source: 'new';
      placePrediction: GooglePlacePrediction;
    }
  | {
      source: 'legacy';
    }
);

export type GoogleLandmarkDetails = {
  address: string;
  category: string;
  googleMapsUrl: string;
  name: string;
  openNow?: boolean;
  phoneNumber: string;
  placeId: string;
  point: LatLngLiteral | null;
  rating?: number;
  userRatingCount?: number;
  websiteUrl: string;
};

export type GoogleStreetViewSession = {
  copyright: string;
  description: string;
  destroy: () => void;
  imageDate: string;
};

declare global {
  interface Window {
    google?: GoogleMapsRuntime;
    gm_authFailure?: () => void;
    __trackLabGoogleMapsAuthHandlerInstalled?: boolean;
    __trackLabGoogleMapsBootstrapPromise?: Promise<GoogleMapsRuntime>;
    __trackLabGoogleMapsBootstrapLoaded?: () => void;
    __trackLabGoogleMapsPromise?: Promise<GoogleMapsRuntime>;
  }
}

export function getGoogleMapsApiKey() {
  return getRuntimeGoogleMapsApiKey()
    || import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim()
    || '';
}

export function hasGoogleMapsApiKey() {
  return getGoogleMapsApiKey().length > 0;
}

function mergeImportedGoogleLibrary(target: Record<string, unknown>, imported: GoogleMapsLibraryImport) {
  if (!imported || typeof imported !== 'object') {
    return;
  }

  Object.assign(target, imported);
}

function mergeGoogleGeometryLibrary(google: GoogleMapsRuntime, imported: GoogleMapsLibraryImport) {
  if (!imported || typeof imported !== 'object') {
    return;
  }

  google.maps.geometry = {
    ...(google.maps.geometry ?? {}),
    ...(imported as NonNullable<GoogleMapsRuntime['maps']['geometry']>),
  };
}

function mergeGooglePlacesLibrary(google: GoogleMapsRuntime, imported: GoogleMapsLibraryImport) {
  if (!imported || typeof imported !== 'object') {
    return;
  }

  google.maps.places = {
    ...(google.maps.places ?? {}),
    ...(imported as GooglePlacesLibrary),
  };
}

async function hydrateGoogleMapsRuntime(google: GoogleMapsRuntime) {
  if (google.maps.importLibrary) {
    const [
      coreLibrary,
      mapsLibrary,
      markerLibrary,
      geometryLibrary,
      geocodingLibrary,
      placesLibrary,
    ] = await Promise.all([
      google.maps.importLibrary('core'),
      google.maps.importLibrary('maps'),
      google.maps.importLibrary('marker'),
      google.maps.importLibrary('geometry'),
      google.maps.importLibrary('geocoding'),
      google.maps.importLibrary('places'),
    ]);

    mergeImportedGoogleLibrary(google.maps as unknown as Record<string, unknown>, coreLibrary as GoogleMapsLibraryImport);
    mergeImportedGoogleLibrary(google.maps as unknown as Record<string, unknown>, mapsLibrary as GoogleMapsLibraryImport);
    mergeImportedGoogleLibrary(google.maps as unknown as Record<string, unknown>, markerLibrary as GoogleMapsLibraryImport);
    mergeImportedGoogleLibrary(google.maps as unknown as Record<string, unknown>, geocodingLibrary as GoogleMapsLibraryImport);
    mergeGoogleGeometryLibrary(google, geometryLibrary as GoogleMapsLibraryImport);
    mergeGooglePlacesLibrary(google, placesLibrary as GoogleMapsLibraryImport);
  }

  if (!google.maps.Map) {
    throw new Error('Google Maps loaded without the map constructor.');
  }

  return google;
}

function bootstrapGoogleMapsRuntime() {
  if (window.google?.maps?.importLibrary) {
    return Promise.resolve(window.google);
  }

  if (window.__trackLabGoogleMapsBootstrapPromise) {
    return window.__trackLabGoogleMapsBootstrapPromise;
  }

  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) {
    return Promise.reject(new Error('Google Maps API key is not configured.'));
  }

  window.__trackLabGoogleMapsBootstrapPromise = new Promise((resolve, reject) => {
    if (!window.__trackLabGoogleMapsAuthHandlerInstalled) {
      const existingAuthFailureHandler = window.gm_authFailure;
      window.gm_authFailure = () => {
        existingAuthFailureHandler?.();
        window.dispatchEvent(new Event('tracklab-google-maps-auth-failure'));
      };
      window.__trackLabGoogleMapsAuthHandlerInstalled = true;
    }

    const cleanup = () => {
      delete window.__trackLabGoogleMapsBootstrapLoaded;
    };

    const rejectWithCleanup = (error: Error) => {
      cleanup();
      delete window.__trackLabGoogleMapsBootstrapPromise;
      reject(error);
    };

    const resolveRuntime = () => {
      if (!window.google?.maps) {
        rejectWithCleanup(new Error('Google Maps loaded without the maps runtime.'));
        return;
      }

      cleanup();
      resolve(window.google);
    };

    window.__trackLabGoogleMapsBootstrapLoaded = resolveRuntime;

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?${new URLSearchParams({
      key: apiKey,
      callback: '__trackLabGoogleMapsBootstrapLoaded',
      loading: 'async',
      v: 'weekly',
    }).toString()}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => rejectWithCleanup(new Error('Google Maps failed to load.'));
    document.head.appendChild(script);
  });

  return window.__trackLabGoogleMapsBootstrapPromise;
}

export function loadGoogleMaps() {
  if (window.google?.maps?.Map) {
    return Promise.resolve(window.google);
  }

  if (window.__trackLabGoogleMapsPromise) {
    return window.__trackLabGoogleMapsPromise;
  }

  window.__trackLabGoogleMapsPromise = bootstrapGoogleMapsRuntime()
    .then(hydrateGoogleMapsRuntime)
    .catch((error) => {
      delete window.__trackLabGoogleMapsPromise;
      throw error;
    });

  return window.__trackLabGoogleMapsPromise;
}

export async function loadGoogleMaps3DLibrary(): Promise<GoogleMaps3DLibrary> {
  // 3D scenes only need the maps3d library. Keeping this independent from
  // Places/geocoding prevents an unrelated API restriction from blocking 3D.
  const google = await bootstrapGoogleMapsRuntime();
  if (!google.maps.importLibrary) {
    throw new Error('Google 3D Maps requires a current Maps JavaScript runtime.');
  }

  const library = await google.maps.importLibrary('maps3d') as Partial<GoogleMaps3DLibrary>;
  if (!library.Map3DElement || !library.Polyline3DElement) {
    throw new Error('Google 3D Maps is unavailable for this API key.');
  }

  return library as GoogleMaps3DLibrary;
}

export function parseLatLngText(value: string): LatLngLiteral | null {
  const match = value.trim().match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!match) {
    return null;
  }

  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }

  return { lat, lng };
}

export async function resolveLocationText(value: string): Promise<{ point: LatLngLiteral; label?: string }> {
  const coordinates = parseLatLngText(value);
  if (coordinates) {
    return { point: coordinates };
  }

  const google = await loadGoogleMaps();
  if (!google.maps.Geocoder) {
    throw new Error('Google geocoding is unavailable for this Maps key.');
  }

  const geocoder = new google.maps.Geocoder();
  const response = await geocoder.geocode({ address: value });
  const result = response.results?.[0];
  const point = result?.geometry?.location?.toJSON();
  if (!result || !point) {
    throw new Error('No Google location match was found.');
  }

  return {
    point,
    label: result.formatted_address,
  };
}

export async function reverseGeocodeGooglePoint(
  point: LatLngLiteral,
): Promise<{ point: LatLngLiteral; label: string }> {
  const google = await loadGoogleMaps();
  if (!google.maps.Geocoder) {
    throw new Error('Google reverse geocoding is unavailable for this Maps key.');
  }
  const geocoder = new google.maps.Geocoder();
  const response = await geocoder.geocode({ location: point });
  const label = response.results?.[0]?.formatted_address?.trim();
  if (!label) {
    throw new Error('No street address was found for that map point.');
  }
  return { point, label };
}

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function averagePoint(points: TrackPoint[]): LatLngLiteral {
  const total = points.reduce(
    (sum, point) => ({ lat: sum.lat + point.lat, lng: sum.lng + point.lng }),
    { lat: 0, lng: 0 },
  );

  return {
    lat: total.lat / points.length,
    lng: total.lng / points.length,
  };
}

function locatorPoint(track: TrackRecord): LatLngLiteral {
  if (isFiniteCoordinate(track.latitude) && isFiniteCoordinate(track.longitude)) {
    return { lat: track.latitude, lng: track.longitude };
  }

  if (track.startGate) {
    return track.startGate;
  }

  if (track.centerline && track.centerline.length > 0) {
    return averagePoint(track.centerline);
  }

  if (track.outline.length > 0) {
    return averagePoint(track.outline);
  }

  return { lat: 0, lng: 0 };
}

let placeAutocompleteSessionToken: GoogleAutocompleteSessionToken | null = null;

function placeTextToString(value: GooglePlaceTextValue | undefined) {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value.text === 'string') {
    return value.text;
  }

  return value.toString?.() ?? '';
}

async function getPlacesLibrary(google: GoogleMapsRuntime): Promise<GooglePlacesLibrary> {
  const imported = google.maps.importLibrary
    ? await google.maps.importLibrary('places') as GooglePlacesLibrary
    : null;

  const places = google.maps.places ?? imported ?? {};
  if (imported) {
    places.AutocompleteSessionToken = places.AutocompleteSessionToken ?? imported.AutocompleteSessionToken;
    places.AutocompleteSuggestion = places.AutocompleteSuggestion ?? imported.AutocompleteSuggestion;
    places.AutocompleteService = places.AutocompleteService ?? imported.AutocompleteService;
    places.Place = places.Place ?? imported.Place;
    places.PlacesService = places.PlacesService ?? imported.PlacesService;
  }

  google.maps.places = places;
  return places;
}

export function resetPlaceAutocompleteSession() {
  placeAutocompleteSessionToken = null;
}

async function fetchModernLocationPredictions(
  places: GooglePlacesLibrary,
  input: string,
): Promise<PlacePredictionOption[]> {
  const AutocompleteSuggestion = places.AutocompleteSuggestion;
  const AutocompleteSessionToken = places.AutocompleteSessionToken;

  if (!AutocompleteSuggestion || !AutocompleteSessionToken) {
    throw new Error('Google Places autocomplete is unavailable for this Maps key.');
  }

  placeAutocompleteSessionToken = placeAutocompleteSessionToken ?? new AutocompleteSessionToken();
  const response = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
    input,
    sessionToken: placeAutocompleteSessionToken,
  });

  return (response.suggestions ?? [])
    .map((suggestion) => suggestion.placePrediction)
    .filter((prediction): prediction is GooglePlacePrediction => Boolean(prediction))
    .map((placePrediction, index) => {
      const mainText = placeTextToString(placePrediction.mainText);
      const secondaryText = placeTextToString(placePrediction.secondaryText);
      const label = placeTextToString(placePrediction.text)
        || [mainText, secondaryText].filter(Boolean).join(', ')
        || placePrediction.placeId;

      return {
        id: `${placePrediction.placeId}-${index}`,
        label,
        mainText: mainText || label,
        secondaryText,
        placeId: placePrediction.placeId,
        source: 'new' as const,
        placePrediction,
      };
    });
}

function getLegacyAutocompletePredictions(
  service: GoogleLegacyAutocompleteService,
  input: string,
): Promise<GoogleLegacyAutocompletePrediction[]> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (handler: () => void) => {
      if (!settled) {
        settled = true;
        handler();
      }
    };

    const request = {
      input,
      sessionToken: placeAutocompleteSessionToken ?? undefined,
    };
    const response = service.getPlacePredictions(request, (predictions, status) => {
      if (status === 'OK') {
        settle(() => resolve(predictions ?? []));
        return;
      }

      if (status === 'ZERO_RESULTS') {
        settle(() => resolve([]));
        return;
      }

      settle(() => reject(new Error(`Google Places autocomplete failed (${status}).`)));
    });

    if (response && typeof response.then === 'function') {
      response
        .then((result) => settle(() => resolve(result.predictions ?? [])))
        .catch((error: unknown) => settle(() => reject(error)));
    }
  });
}

async function fetchLegacyLocationPredictions(
  places: GooglePlacesLibrary,
  input: string,
): Promise<PlacePredictionOption[]> {
  const AutocompleteService = places.AutocompleteService;
  if (!AutocompleteService) {
    throw new Error('Google Places autocomplete is unavailable for this Maps key.');
  }

  const service = new AutocompleteService();
  const predictions = await getLegacyAutocompletePredictions(service, input);
  return predictions.map((prediction, index) => {
    const mainText = prediction.structured_formatting?.main_text ?? prediction.description ?? prediction.place_id;
    const secondaryText = prediction.structured_formatting?.secondary_text ?? '';
    const label = prediction.description ?? [mainText, secondaryText].filter(Boolean).join(', ');

    return {
      id: `${prediction.place_id}-${index}`,
      label,
      mainText,
      secondaryText,
      placeId: prediction.place_id,
      source: 'legacy' as const,
    };
  });
}

export async function fetchLocationPredictions(input: string): Promise<PlacePredictionOption[]> {
  const trimmed = input.trim();
  if (trimmed.length < 3 || parseLatLngText(trimmed)) {
    return [];
  }

  const google = await loadGoogleMaps();
  const places = await getPlacesLibrary(google);
  let modernError: unknown = null;

  try {
    return await fetchModernLocationPredictions(places, trimmed);
  } catch (error) {
    modernError = error;
  }

  try {
    return await fetchLegacyLocationPredictions(places, trimmed);
  } catch (legacyError) {
    if (legacyError instanceof Error) {
      throw legacyError;
    }

    if (modernError instanceof Error) {
      throw modernError;
    }

    throw new Error('Google Places autocomplete is unavailable for this Maps key.');
  }
}

let legacyPlacesService: GoogleLegacyPlacesService | null = null;

function getLegacyPlacesService(places: GooglePlacesLibrary) {
  if (!places.PlacesService) {
    throw new Error('Google Places details are unavailable for this Maps key.');
  }

  if (!legacyPlacesService) {
    const element = document.createElement('div');
    element.hidden = true;
    document.body.appendChild(element);
    legacyPlacesService = new places.PlacesService(element);
  }

  return legacyPlacesService;
}

function getLegacyPlaceDetails(
  service: GoogleLegacyPlacesService,
  placeId: string,
  fields: string[] = ['formatted_address', 'geometry', 'name'],
): Promise<GoogleLegacyPlaceResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (handler: () => void) => {
      if (!settled) {
        settled = true;
        handler();
      }
    };

    const request = {
      placeId,
      fields,
      sessionToken: placeAutocompleteSessionToken ?? undefined,
    };
    const response = service.getDetails(request, (place, status) => {
      if (status === 'OK' && place) {
        settle(() => resolve(place));
        return;
      }

      settle(() => reject(new Error(`Google could not resolve that selected address (${status}).`)));
    });

    if (response && typeof response.then === 'function') {
      response
        .then((result) => {
          if (result.place) {
            settle(() => resolve(result.place as GoogleLegacyPlaceResult));
            return;
          }

          settle(() => reject(new Error('Google could not resolve that selected address.')));
        })
        .catch((error: unknown) => settle(() => reject(error)));
    }
  });
}

function readableGooglePlaceType(value: string | undefined) {
  if (!value) {
    return '';
  }

  return value
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function googleMapsPlaceUrl(placeId: string, name: string) {
  const query = encodeURIComponent(name || placeId);
  const encodedPlaceId = encodeURIComponent(placeId);
  return `https://www.google.com/maps/search/?api=1&query=${query}&query_place_id=${encodedPlaceId}`;
}

export async function fetchGoogleLandmarkDetails(placeId: string): Promise<GoogleLandmarkDetails> {
  const trimmedPlaceId = placeId.trim();
  if (!trimmedPlaceId) {
    throw new Error('That landmark does not include a Google place ID.');
  }

  const google = await loadGoogleMaps();
  const places = await getPlacesLibrary(google);
  let modernError: unknown = null;

  if (places.Place) {
    try {
      const place = new places.Place({ id: trimmedPlaceId });
      await place.fetchFields({
        fields: [
          'displayName',
          'formattedAddress',
          'googleMapsURI',
          'location',
          'nationalPhoneNumber',
          'primaryTypeDisplayName',
          'rating',
          'userRatingCount',
          'websiteURI',
        ],
      });
      const name = place.displayName?.trim() || 'Selected landmark';
      return {
        address: place.formattedAddress?.trim() ?? '',
        category: place.primaryTypeDisplayName?.trim() ?? '',
        googleMapsUrl: place.googleMapsURI?.trim() || googleMapsPlaceUrl(trimmedPlaceId, name),
        name,
        phoneNumber: place.nationalPhoneNumber?.trim() ?? '',
        placeId: trimmedPlaceId,
        point: place.location?.toJSON() ?? null,
        rating: place.rating,
        userRatingCount: place.userRatingCount,
        websiteUrl: place.websiteURI?.trim() ?? '',
      };
    } catch (error) {
      modernError = error;
    }
  }

  try {
    const service = getLegacyPlacesService(places);
    const place = await getLegacyPlaceDetails(service, trimmedPlaceId, [
      'formatted_address',
      'formatted_phone_number',
      'geometry',
      'name',
      'opening_hours',
      'rating',
      'types',
      'url',
      'user_ratings_total',
      'website',
    ]);
    const name = place.name?.trim() || 'Selected landmark';
    const openNow = place.opening_hours?.isOpen?.() ?? place.opening_hours?.open_now;
    return {
      address: place.formatted_address?.trim() ?? '',
      category: readableGooglePlaceType(place.types?.[0]),
      googleMapsUrl: place.url?.trim() || googleMapsPlaceUrl(trimmedPlaceId, name),
      name,
      openNow,
      phoneNumber: place.formatted_phone_number?.trim() ?? '',
      placeId: trimmedPlaceId,
      point: place.geometry?.location?.toJSON() ?? null,
      rating: place.rating,
      userRatingCount: place.user_ratings_total,
      websiteUrl: place.website?.trim() ?? '',
    };
  } catch (legacyError) {
    if (modernError instanceof Error) {
      throw modernError;
    }
    if (legacyError instanceof Error) {
      throw legacyError;
    }
    throw new Error('Google could not load details for that landmark.');
  }
}

export async function createGoogleStreetViewSession(
  element: HTMLElement,
  point: LatLngLiteral,
): Promise<GoogleStreetViewSession> {
  const google = await loadGoogleMaps();
  const imported = google.maps.importLibrary
    ? await google.maps.importLibrary('streetView') as GoogleStreetViewLibrary
    : {};
  const StreetViewService = imported.StreetViewService;
  const StreetViewPanorama = imported.StreetViewPanorama;

  if (!StreetViewService || !StreetViewPanorama) {
    throw new Error('Google Street View is unavailable for this Maps key.');
  }

  let response: { data: GoogleStreetViewPanoramaData };
  try {
    response = await new StreetViewService().getPanorama({
      location: point,
      preference: 'best',
      radius: 120,
    });
  } catch {
    throw new Error('No Street View imagery was found near this landmark.');
  }

  const pano = response.data.location?.pano;
  if (!pano) {
    throw new Error('No Street View imagery was found near this landmark.');
  }

  const panorama = new StreetViewPanorama(element, {
    addressControl: true,
    clickToGo: true,
    disableDefaultUI: false,
    enableCloseButton: false,
    fullscreenControl: false,
    linksControl: true,
    motionTracking: false,
    motionTrackingControl: false,
    pano,
    panControl: true,
    visible: true,
    zoomControl: true,
  });
  window.requestAnimationFrame(() => {
    google.maps.event?.trigger(panorama, 'resize');
    panorama.focus?.();
  });

  return {
    copyright: response.data.copyright?.trim() ?? '',
    description: response.data.location?.description?.trim()
      || response.data.location?.shortDescription?.trim()
      || '',
    destroy: () => panorama.setVisible(false),
    imageDate: response.data.imageDate?.trim() ?? '',
  };
}

export async function resolvePlacePrediction(
  prediction: PlacePredictionOption,
): Promise<{ point: LatLngLiteral; label?: string }> {
  try {
    if (prediction.source === 'legacy') {
      const google = await loadGoogleMaps();
      const places = await getPlacesLibrary(google);
      const service = getLegacyPlacesService(places);
      const place = await getLegacyPlaceDetails(service, prediction.placeId);
      const point = place.geometry?.location?.toJSON();
      resetPlaceAutocompleteSession();

      if (!point) {
        throw new Error('Google could not resolve that selected address.');
      }

      return {
        point,
        label: place.formatted_address ?? place.name ?? prediction.label,
      };
    }

    const place = prediction.placePrediction.toPlace();
    await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] });
    const point = place.location?.toJSON();
    resetPlaceAutocompleteSession();

    if (!point) {
      throw new Error('Google could not resolve that selected address.');
    }

    return {
      point,
      label: place.formattedAddress ?? place.displayName ?? prediction.label,
    };
  } catch {
    resetPlaceAutocompleteSession();
    const resolved = await resolveLocationText(prediction.label);
    return {
      point: resolved.point,
      label: resolved.label ?? prediction.label,
    };
  }
}

export function hasUserMappedRoute(track: TrackRecord) {
  return track.routeStatus === 'user-mapped' && Boolean(track.centerline && track.centerline.length > 1);
}

export function mappedTrackRoute(track: TrackRecord) {
  return hasUserMappedRoute(track) && track.centerline
    ? routeWithDefaultSplitBranches(track.centerline, track.splitSections ?? [])
    : [];
}

export function mappedTrackRouteWithBranchSelections(track: TrackRecord, selections: SplitBranchSelection = {}) {
  return hasUserMappedRoute(track) && track.centerline
    ? routeWithSplitBranchSelections(track.centerline, track.splitSections ?? [], selections)
    : [];
}

export function mappedTrackRouteSegments(track: TrackRecord) {
  return hasUserMappedRoute(track) && track.centerline
    ? splitSharedRouteSegments(track.centerline, track.splitSections ?? [])
    : [];
}

export function trackCenter(track: TrackRecord): LatLngLiteral {
  const route = mappedTrackRoute(track);

  return route.length > 0 ? averagePoint(route) : locatorPoint(track);
}

export function trackRoute(track: TrackRecord) {
  const route = mappedTrackRoute(track);
  return route.length > 1 ? route : track.outline;
}

export function trackBoundsPoints(track: TrackRecord) {
  const routeSegments = mappedTrackRouteSegments(track);
  if (routeSegments.length > 0) {
    return [
      ...routeSegments.flat(),
      ...(track.splitSections ?? []).flatMap((section) => (
        section.branches.flatMap((branch) => branch.points)
      )),
    ];
  }

  const center = locatorPoint(track);
  const offset = 0.0014;
  return [
    { lat: center.lat - offset, lng: center.lng - offset },
    { lat: center.lat + offset, lng: center.lng + offset },
  ];
}

export function trackStartPoint(track: TrackRecord) {
  const route = mappedTrackRoute(track);
  return track.startGate ?? route[0] ?? locatorPoint(track);
}

export function trackFinishPoint(track: TrackRecord) {
  const route = mappedTrackRoute(track);
  return track.finishLine ?? route[route.length - 1] ?? locatorPoint(track);
}

function pointAtProgress(outline: TrackPoint[], progress: number): LatLngLiteral {
  const segments = outline.slice(1).map((point, index) => ({
    start: outline[index],
    end: point,
    distance: distanceBetweenTrackPoints(outline[index], point),
  }));
  const total = segments.reduce((sum, segment) => sum + segment.distance, 0);
  const target = Math.max(0, Math.min(1, progress)) * total;
  let traveled = 0;

  for (const segment of segments) {
    if (traveled + segment.distance >= target) {
      const localProgress = (target - traveled) / Math.max(1, segment.distance);
      return {
        lat: segment.start.lat + (segment.end.lat - segment.start.lat) * localProgress,
        lng: segment.start.lng + (segment.end.lng - segment.start.lng) * localProgress,
      };
    }

    traveled += segment.distance;
  }

  return outline[outline.length - 1];
}

function bearingBetweenTrackPoints(start: TrackPoint, end: TrackPoint) {
  const startLat = start.lat * (Math.PI / 180);
  const endLat = end.lat * (Math.PI / 180);
  const deltaLng = (end.lng - start.lng) * (Math.PI / 180);
  const y = Math.sin(deltaLng) * Math.cos(endLat);
  const x = Math.cos(startLat) * Math.sin(endLat)
    - Math.sin(startLat) * Math.cos(endLat) * Math.cos(deltaLng);

  return ((Math.atan2(y, x) * (180 / Math.PI)) + 360) % 360;
}

export function zonePolyline(track: TrackRecord, zone: TrackZone) {
  const route = mappedTrackRouteWithBranchSelections(track, zone.branchSelections);
  if (route.length < 2) {
    return [];
  }

  return Array.from({ length: 24 }, (_, index) => {
    const t = index / 23;
    const meter = zone.startMeter + (zone.endMeter - zone.startMeter) * t;
    return pointAtRouteMeter(route, meter) ?? pointAtProgress(route, meter / track.lengthMeters);
  });
}

export function riderLatLng(track: TrackRecord, distanceMeters: number) {
  const route = mappedTrackRoute(track);
  if (route.length < 2) {
    return null;
  }

  const routeLength = routeLengthMeters(route);
  const safeDistance = Math.max(0, distanceMeters);
  const targetDistance = routeIsClosedLoop(route) && routeLength > 0
    ? safeDistance % routeLength
    : Math.min(routeLength, safeDistance);
  return pointAtRouteMeter(route, targetDistance)
    ?? pointAtProgress(route, distanceMeters / Math.max(1, track.lengthMeters));
}

export function riderRoutePose(
  track: TrackRecord,
  distanceMeters: number,
  splitBranchSelections: SplitBranchSelection = {},
) {
  const route = mappedTrackRouteWithBranchSelections(track, splitBranchSelections);
  if (route.length < 2) {
    return null;
  }

  const routeLength = routeLengthMeters(route);
  const target = distanceMeters <= 0
    ? distanceMeters
    : routeIsClosedLoop(route) && routeLength > 0
      ? distanceMeters % routeLength
      : Math.min(routeLength, distanceMeters);
  if (target <= 0) {
    const start = route[0];
    const end = route[1];
    const segmentDistance = distanceBetweenTrackPoints(start, end);
    const progress = segmentDistance <= 0 ? 0 : target / segmentDistance;

    return {
      bearing: bearingBetweenTrackPoints(start, end),
      position: {
        lat: start.lat + (end.lat - start.lat) * progress,
        lng: start.lng + (end.lng - start.lng) * progress,
      },
    };
  }

  let traveled = 0;

  for (let index = 1; index < route.length; index += 1) {
    const start = route[index - 1];
    const end = route[index];
    const segmentDistance = distanceBetweenTrackPoints(start, end);

    if (traveled + segmentDistance >= target || index === route.length - 1) {
      const progress = segmentDistance <= 0 ? 0 : Math.max(0, Math.min(1, (target - traveled) / segmentDistance));
      return {
        bearing: bearingBetweenTrackPoints(start, end),
        position: {
          lat: start.lat + (end.lat - start.lat) * progress,
          lng: start.lng + (end.lng - start.lng) * progress,
        },
      };
    }

    traveled += segmentDistance;
  }

  return {
    bearing: bearingBetweenTrackPoints(route[route.length - 2], route[route.length - 1]),
    position: route[route.length - 1],
  };
}

export function pathLengthMeters(points: TrackPoint[], google?: GoogleMapsRuntime | null) {
  if (points.length < 2) {
    return 0;
  }

  const googleLength = google?.maps.geometry?.spherical?.computeLength(points);
  if (typeof googleLength === 'number' && Number.isFinite(googleLength)) {
    return googleLength;
  }

  return points.slice(1).reduce(
    (total, point, index) => total + distanceBetweenTrackPoints(points[index], point),
    0,
  );
}

export type {
  GoogleLatLngBounds,
  GoogleMap,
  GoogleMapClickEvent,
  GoogleMapsEventListener,
  GoogleMapsRuntime,
  GoogleMarker,
  GoogleOverlayView,
  GooglePolyline,
  LatLngLiteral,
};
