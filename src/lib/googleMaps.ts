import { distanceBetweenTrackPoints } from './trackMapping';
import type { TrackPoint, TrackRecord, TrackZone } from '../types';

type LatLngLiteral = {
  lat: number;
  lng: number;
};

type GoogleMap = {
  addListener: (eventName: string, handler: (event?: GoogleMapClickEvent) => void) => GoogleMapsEventListener;
  fitBounds: (bounds: GoogleLatLngBounds, padding?: number) => void;
  getCenter?: () => { toJSON: () => LatLngLiteral };
  getHeading?: () => number | undefined;
  getTilt?: () => number | undefined;
  moveCamera?: (cameraOptions: Record<string, unknown>) => void;
  setHeading: (heading: number) => void;
  setOptions: (options: Record<string, unknown>) => void;
  setTilt: (tilt: number) => void;
};

type GoogleMapClickEvent = {
  latLng?: {
    toJSON: () => LatLngLiteral;
  };
};

type GoogleMapsEventListener = {
  remove: () => void;
};

type GoogleLatLngBounds = {
  extend: (point: LatLngLiteral) => void;
};

type GooglePolyline = {
  setMap: (map: GoogleMap | null) => void;
};

type GoogleMarker = {
  addListener: (eventName: string, handler: (event?: GoogleMapClickEvent) => void) => GoogleMapsEventListener;
  setIcon: (icon: Record<string, unknown>) => void;
  setMap: (map: GoogleMap | null) => void;
  setPosition: (position: LatLngLiteral) => void;
  setTitle?: (title: string) => void;
};

type GoogleGeocoder = {
  geocode: (request: { address: string }) => Promise<{
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
  location?: {
    toJSON: () => LatLngLiteral;
  };
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
  name?: string;
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
  PlacesService?: new (element: HTMLElement) => GoogleLegacyPlacesService;
};

type GoogleStreetViewPanorama = {
  setPano: (pano: string) => void;
  setPosition: (position: LatLngLiteral) => void;
  setPov: (pov: { heading: number; pitch: number }) => void;
  setVisible: (visible: boolean) => void;
};

type GoogleStreetViewService = {
  getPanorama: (request: { location: LatLngLiteral; radius: number }) => Promise<{
    data?: {
      location?: {
        pano?: string;
      };
    };
  }>;
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
    LatLngBounds: new () => GoogleLatLngBounds;
    Geocoder?: new () => GoogleGeocoder;
    Map: GoogleMapConstructor;
    Marker: new (options: Record<string, unknown>) => GoogleMarker;
    places?: GooglePlacesLibrary;
    Point: new (x: number, y: number) => unknown;
    Polyline: new (options: Record<string, unknown>) => GooglePolyline;
    RenderingType?: {
      VECTOR: unknown;
    };
    Size: new (width: number, height: number) => unknown;
    StreetViewPanorama?: new (element: HTMLElement, options?: Record<string, unknown>) => GoogleStreetViewPanorama;
    StreetViewService?: new () => GoogleStreetViewService;
    SymbolPath: {
      CIRCLE: unknown;
    };
  };
};

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

declare global {
  interface Window {
    google?: GoogleMapsRuntime;
    __trackLabGoogleMapsPromise?: Promise<GoogleMapsRuntime>;
  }
}

export function getGoogleMapsApiKey() {
  return import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() ?? '';
}

export function hasGoogleMapsApiKey() {
  return getGoogleMapsApiKey().length > 0;
}

export function loadGoogleMaps() {
  if (window.google?.maps) {
    return Promise.resolve(window.google);
  }

  if (window.__trackLabGoogleMapsPromise) {
    return window.__trackLabGoogleMapsPromise;
  }

  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) {
    return Promise.reject(new Error('Google Maps API key is not configured.'));
  }

  window.__trackLabGoogleMapsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?${new URLSearchParams({
      key: apiKey,
      libraries: 'geometry,places',
      loading: 'async',
      v: 'weekly',
    }).toString()}`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      const resolveRuntime = async () => {
        if (!window.google?.maps) {
          reject(new Error('Google Maps loaded without the maps runtime.'));
          return;
        }

        if (window.google.maps.importLibrary) {
          await Promise.all([
            window.google.maps.importLibrary('maps'),
            window.google.maps.importLibrary('geometry'),
            window.google.maps.importLibrary('geocoding'),
            window.google.maps.importLibrary('places'),
            window.google.maps.importLibrary('streetView'),
          ]);
        }

        if (window.google.maps.Map) {
          resolve(window.google);
        } else {
          reject(new Error('Google Maps loaded without the map constructor.'));
        }
      };

      resolveRuntime().catch((error: Error) => reject(error));
    };
    script.onerror = () => reject(new Error('Google Maps failed to load.'));
    document.head.appendChild(script);
  });

  return window.__trackLabGoogleMapsPromise;
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
      fields: ['formatted_address', 'geometry', 'name'],
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

export async function resolvePlacePrediction(
  prediction: PlacePredictionOption,
): Promise<{ point: LatLngLiteral; label?: string }> {
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
}

export function hasUserMappedRoute(track: TrackRecord) {
  return track.routeStatus === 'user-mapped' && Boolean(track.centerline && track.centerline.length > 1);
}

export function mappedTrackRoute(track: TrackRecord) {
  return hasUserMappedRoute(track) && track.centerline ? track.centerline : [];
}

export function trackCenter(track: TrackRecord): LatLngLiteral {
  const route = mappedTrackRoute(track);

  return route.length > 0 ? averagePoint(route) : locatorPoint(track);
}

export function trackRoute(track: TrackRecord) {
  return track.centerline && track.centerline.length > 1 ? track.centerline : track.outline;
}

export function trackBoundsPoints(track: TrackRecord) {
  const route = mappedTrackRoute(track);
  if (route.length > 0) {
    return route;
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
  const route = mappedTrackRoute(track);
  if (route.length < 2) {
    return [];
  }

  return Array.from({ length: 24 }, (_, index) => {
    const t = index / 23;
    const meter = zone.startMeter + (zone.endMeter - zone.startMeter) * t;
    return pointAtProgress(route, meter / track.lengthMeters);
  });
}

export function riderLatLng(track: TrackRecord, distanceMeters: number) {
  const route = mappedTrackRoute(track);
  if (route.length < 2) {
    return null;
  }

  return pointAtProgress(route, distanceMeters / track.lengthMeters);
}

export function riderRoutePose(track: TrackRecord, distanceMeters: number) {
  const route = mappedTrackRoute(track);
  if (route.length < 2) {
    return null;
  }

  const target = Math.max(0, Math.min(track.lengthMeters, distanceMeters));
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
  GooglePolyline,
  LatLngLiteral,
};
