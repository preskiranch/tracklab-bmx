const weatherCache = new Map();
const defaultCacheMs = 20 * 60 * 1000;
const requestTimeoutMs = 3500;
const metNorwayAttributionUrl = 'https://www.met.no/en/free-meteorological-data';
const trackLabUserAgent = 'TrackLabBMX/1.0 https://tracklab-bmx.onrender.com https://github.com/preskiranch/tracklab-bmx';

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundCoordinate(value) {
  return Number(Number(value).toFixed(4));
}

function weatherSummary(symbolCode) {
  const normalized = String(symbolCode || '').replace(/_(?:day|night|polartwilight)$/, '');
  const labels = {
    clearsky: 'clear',
    fair: 'mostly clear',
    partlycloudy: 'partly cloudy',
    cloudy: 'cloudy',
    fog: 'foggy',
    lightrainshowers: 'light rain showers',
    rainshowers: 'rain showers',
    heavyrainshowers: 'heavy rain showers',
    lightsleetshowers: 'light sleet showers',
    sleetshowers: 'sleet showers',
    heavysleetshowers: 'heavy sleet showers',
    lightsnowshowers: 'light snow showers',
    snowshowers: 'snow showers',
    heavysnowshowers: 'heavy snow showers',
    lightrain: 'light rain',
    rain: 'rain',
    heavyrain: 'heavy rain',
    lightsleet: 'light sleet',
    sleet: 'sleet',
    heavysleet: 'heavy sleet',
    lightsnow: 'light snow',
    snow: 'snow',
    heavysnow: 'heavy snow',
    rainandthunder: 'rain and thunder',
    heavyrainandthunder: 'heavy rain and thunder',
  };
  return labels[normalized] || normalized.replaceAll('_', ' ') || 'current';
}

function compassDirection(degrees) {
  const value = finite(degrees);
  if (value == null) {
    return undefined;
  }
  const labels = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
  return labels[Math.round((((value % 360) + 360) % 360) / 45) % labels.length];
}

function closestTimeseriesEntry(timeseries, now = Date.now()) {
  if (!Array.isArray(timeseries) || timeseries.length === 0) {
    return null;
  }
  return [...timeseries].sort((left, right) => (
    Math.abs(Date.parse(left?.time || '') - now) - Math.abs(Date.parse(right?.time || '') - now)
  ))[0] ?? null;
}

function cacheExpiry(response, now = Date.now()) {
  const expires = Date.parse(response.headers.get('expires') || '');
  if (Number.isFinite(expires) && expires > now) {
    return Math.min(expires, now + (60 * 60 * 1000));
  }
  return now + defaultCacheMs;
}

export function clearWeatherCache() {
  weatherCache.clear();
}

export async function loadTrackWeather(latitude, longitude, options = {}) {
  const lat = finite(latitude);
  const lon = finite(longitude);
  if (lat == null || lon == null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return { available: false };
  }

  const roundedLat = roundCoordinate(lat);
  const roundedLon = roundCoordinate(lon);
  const cacheKey = `${roundedLat},${roundedLon}`;
  const now = Number(options.now) || Date.now();
  const cached = weatherCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const fetchImplementation = options.fetchImplementation ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const requestUrl = new URL('https://api.met.no/weatherapi/locationforecast/2.0/compact');
    requestUrl.searchParams.set('lat', String(roundedLat));
    requestUrl.searchParams.set('lon', String(roundedLon));
    const response = await fetchImplementation(requestUrl, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': trackLabUserAgent,
      },
    });
    if (!response.ok) {
      throw new Error(`MET Norway returned ${response.status}.`);
    }
    const payload = await response.json();
    const entry = closestTimeseriesEntry(payload?.properties?.timeseries, now);
    const instant = entry?.data?.instant?.details ?? {};
    const nextHour = entry?.data?.next_1_hours ?? entry?.data?.next_6_hours ?? {};
    const precipitationMm = finite(nextHour?.details?.precipitation_amount);
    const value = {
      available: true,
      provider: 'MET Norway',
      attributionUrl: metNorwayAttributionUrl,
      observedAt: entry?.time || new Date(now).toISOString(),
      summary: weatherSummary(nextHour?.summary?.symbol_code),
      ...(finite(instant.air_temperature) != null
        ? { temperatureC: finite(instant.air_temperature) }
        : {}),
      ...(finite(instant.relative_humidity) != null
        ? { humidityPercent: finite(instant.relative_humidity) }
        : {}),
      ...(finite(instant.wind_speed) != null
        ? { windKph: Number((finite(instant.wind_speed) * 3.6).toFixed(1)) }
        : {}),
      ...(compassDirection(instant.wind_from_direction)
        ? { windDirection: compassDirection(instant.wind_from_direction) }
        : {}),
      ...(finite(instant.wind_speed_of_gust) != null
        ? { gustKph: Number((finite(instant.wind_speed_of_gust) * 3.6).toFixed(1)) }
        : {}),
      ...(precipitationMm != null ? { precipitationMm } : {}),
    };
    weatherCache.set(cacheKey, {
      expiresAt: cacheExpiry(response, now),
      value,
    });
    return value;
  } catch {
    return { available: false };
  } finally {
    clearTimeout(timeout);
  }
}
