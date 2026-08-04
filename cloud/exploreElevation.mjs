const maximumElevationSamples = 256;
const targetElevationSpacingMeters = 20;
const maximumElevationPathPoints = 128;

export function exploreElevationSampleCount(distanceMeters) {
  const distance = Number.isFinite(distanceMeters) ? Math.max(1, distanceMeters) : 1;
  return Math.max(
    2,
    Math.min(maximumElevationSamples, Math.ceil(distance / targetElevationSpacingMeters) + 1),
  );
}

export function decodeExplorePolyline(encodedPolyline) {
  const points = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  const nextDelta = () => {
    let result = 0;
    let shift = 0;
    let byte = 0;
    do {
      if (index >= encodedPolyline.length) {
        throw new Error('Google returned an incomplete Explore route line.');
      }
      byte = encodedPolyline.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return (result & 1) ? ~(result >> 1) : result >> 1;
  };

  while (index < encodedPolyline.length) {
    latitude += nextDelta();
    longitude += nextDelta();
    points.push({ lat: latitude / 1e5, lng: longitude / 1e5 });
  }
  return points;
}

function sampledElevationPath(encodedPolyline) {
  const points = decodeExplorePolyline(encodedPolyline);
  if (points.length <= maximumElevationPathPoints) {
    return points;
  }
  return Array.from({ length: maximumElevationPathPoints }, (_, index) => (
    points[Math.round(index / (maximumElevationPathPoints - 1) * (points.length - 1))]
  ));
}

export function exploreElevationPathParameter(encodedPolyline) {
  // Google Routes polylines can contain URL-sensitive characters or enough
  // detail to make an encoded Elevation API path fail with HTTP 400. A bounded
  // coordinate path is accepted by the same API and preserves the road shape.
  return sampledElevationPath(encodedPolyline)
    .map((point) => `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`)
    .join('|');
}

function smoothElevations(elevations) {
  if (elevations.length < 3) {
    return elevations;
  }
  return elevations.map((elevation, index) => {
    if (index === 0 || index === elevations.length - 1) {
      return elevation;
    }
    return (elevations[index - 1] + elevation * 2 + elevations[index + 1]) / 4;
  });
}

export function normalizeExploreElevationProfile(results, distanceMeters) {
  const elevations = Array.isArray(results)
    ? results.map((result) => Number(result?.elevation)).filter(Number.isFinite)
    : [];
  if (elevations.length < 2) {
    return null;
  }

  const smoothed = smoothElevations(elevations);
  const distance = Math.max(1, Number(distanceMeters) || 1);
  const samples = smoothed.map((elevationMeters, index) => ({
    distanceMeters: index / (smoothed.length - 1) * distance,
    elevationMeters,
  }));
  let gainMeters = 0;
  let lossMeters = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const delta = samples[index].elevationMeters - samples[index - 1].elevationMeters;
    if (delta > 0) {
      gainMeters += delta;
    } else {
      lossMeters += Math.abs(delta);
    }
  }

  return { samples, gainMeters, lossMeters };
}

export async function fetchExploreElevationProfile({
  apiKey,
  distanceMeters,
  encodedPolyline,
  fetchImpl = fetch,
  signal,
}) {
  if (!apiKey || !encodedPolyline) {
    return null;
  }
  const query = new URLSearchParams({
    key: apiKey,
    path: exploreElevationPathParameter(encodedPolyline),
    samples: String(exploreElevationSampleCount(distanceMeters)),
  });
  const response = await fetchImpl(
    `https://maps.googleapis.com/maps/api/elevation/json?${query.toString()}`,
    { signal },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.status !== 'OK') {
    const status = typeof payload?.status === 'string' ? payload.status : `HTTP_${response.status}`;
    const providerMessage = typeof payload?.error_message === 'string'
      ? ` ${payload.error_message}`
      : '';
    const error = new Error(`Google Elevation request failed (${status}).${providerMessage}`);
    error.code = status;
    throw error;
  }
  return normalizeExploreElevationProfile(payload.results, distanceMeters);
}
