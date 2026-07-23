import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearWeatherCache, loadTrackWeather } from '../../cloud/weather.mjs';

describe('track weather', () => {
  beforeEach(() => {
    clearWeatherCache();
  });

  it('loads, converts, attributes, rounds, and caches MET Norway conditions', async () => {
    const fetchImplementation = vi.fn(async () => new Response(JSON.stringify({
      properties: {
        timeseries: [{
          time: '2026-07-23T18:00:00Z',
          data: {
            instant: {
              details: {
                air_temperature: 23.5,
                relative_humidity: 41,
                wind_speed: 3,
                wind_from_direction: 270,
                wind_speed_of_gust: 4.5,
              },
            },
            next_1_hours: {
              summary: { symbol_code: 'partlycloudy_day' },
              details: { precipitation_amount: 0 },
            },
          },
        }],
      },
    }), {
      status: 200,
      headers: { Expires: 'Thu, 23 Jul 2026 18:30:00 GMT' },
    }));

    const first = await loadTrackWeather(38.244567, -122.283987, {
      now: Date.parse('2026-07-23T18:00:00Z'),
      fetchImplementation,
    });
    const second = await loadTrackWeather(38.244568, -122.283986, {
      now: Date.parse('2026-07-23T18:01:00Z'),
      fetchImplementation,
    });

    expect(first).toMatchObject({
      available: true,
      provider: 'MET Norway',
      summary: 'partly cloudy',
      temperatureC: 23.5,
      humidityPercent: 41,
      windKph: 10.8,
      windDirection: 'west',
      gustKph: 16.2,
      precipitationMm: 0,
    });
    expect(first.attributionUrl).toContain('met.no');
    expect(second).toEqual(first);
    expect(fetchImplementation).toHaveBeenCalledOnce();
    const requestUrl = String(fetchImplementation.mock.calls[0][0]);
    expect(requestUrl).toContain('lat=38.2446');
    expect(requestUrl).toContain('lon=-122.284');
  });

  it('fails closed when coordinates are missing', async () => {
    await expect(loadTrackWeather(undefined, undefined)).resolves.toEqual({ available: false });
  });
});
