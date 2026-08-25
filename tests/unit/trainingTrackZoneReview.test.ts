import { describe, expect, it, vi } from 'vitest';
import type { GoogleMap, GoogleMapsRuntime } from '../../src/lib/googleMaps';
import {
  privateZoneHeartRateLabels,
  refitTrainingTrackReviewMap,
} from '../../src/components/TrainingTrackZoneReview';
import type { PrivateTrainingHeartRateProjection } from '../../src/lib/privateTrainingHeartRate';

function projection(
  overrides: Partial<PrivateTrainingHeartRateProjection> = {},
): PrivateTrainingHeartRateProjection {
  return {
    access: 'athlete-private',
    displayedSessionId: 'session-1',
    canonicalSessionId: 'session-1',
    state: 'saved',
    playerId: 1,
    summary: null,
    zoneSummaries: [{
      zoneId: 'zone-1',
      zoneName: 'First straight',
      startElapsedMs: 300,
      endElapsedMs: 1_180,
      summary: {
        sampleCount: 4,
        coverageMs: 700,
        coveragePercent: 79.5,
        firstSampleElapsedMs: 320,
        lastSampleElapsedMs: 1_100,
        minimumBpm: 130,
        averageBpm: 151.4,
        peakBpm: 169,
      },
    }],
    ...overrides,
  };
}

describe('training track review live-map fitting', () => {
  it('triggers a map resize and refits every safe route point after its container changes', () => {
    const extended: Array<{ lat: number; lng: number }> = [];
    const trigger = vi.fn();
    const fitBounds = vi.fn();
    class Bounds {
      extend(point: { lat: number; lng: number }) {
        extended.push(point);
      }
    }
    const google = {
      maps: {
        event: { trigger },
        LatLngBounds: Bounds,
      },
    } as unknown as GoogleMapsRuntime;
    const map = { fitBounds } as unknown as GoogleMap;
    const points = [{ lat: 32, lng: -117 }, { lat: 32.001, lng: -117.002 }];

    expect(refitTrainingTrackReviewMap(google, map, points, 40)).toBe(true);
    expect(trigger).toHaveBeenCalledWith(map, 'resize');
    expect(extended).toEqual(points);
    expect(fitBounds).toHaveBeenCalledWith(expect.any(Bounds), 40);
  });

  it('does not fit an incomplete or invalid route', () => {
    const trigger = vi.fn();
    const fitBounds = vi.fn();
    const google = {
      maps: {
        event: { trigger },
        LatLngBounds: class { extend() {} },
      },
    } as unknown as GoogleMapsRuntime;
    const map = { fitBounds } as unknown as GoogleMap;

    expect(refitTrainingTrackReviewMap(google, map, [{ lat: Number.NaN, lng: -117 }])).toBe(false);
    expect(trigger).not.toHaveBeenCalled();
    expect(fitBounds).not.toHaveBeenCalled();
  });
});

describe('private heart rate in recorded zone rows', () => {
  it('joins exact player, source zone, and saved entry/exit window', () => {
    expect(privateZoneHeartRateLabels(
      [projection()],
      1,
      2,
      'zone-1',
      { startElapsedMs: 300, endElapsedMs: 1_180 },
    )).toEqual({
      averagePeak: '151 / 169 BPM',
      coverage: '4 samples · 79.5%',
    });
  });

  it('fails closed for another player or a changed saved window', () => {
    expect(privateZoneHeartRateLabels(
      [projection()], 2, 2, 'zone-1', { startElapsedMs: 300, endElapsedMs: 1_180 },
    ).averagePeak).toBe('Private rider only');
    expect(privateZoneHeartRateLabels(
      [projection()], 1, 1, 'zone-1', { startElapsedMs: 301, endElapsedMs: 1_180 },
    ).averagePeak).toBe('No valid zone samples');
  });

  it('does not join by zone id alone when the recorded entry/exit window is missing', () => {
    expect(privateZoneHeartRateLabels(
      [projection()], 1, 1, 'zone-1', undefined,
    )).toEqual({
      averagePeak: 'No recorded zone window',
      coverage: 'No recorded zone window',
    });
    expect(privateZoneHeartRateLabels(
      [projection()], 1, 1, 'zone-1', { startElapsedMs: 300, endElapsedMs: 300 },
    ).averagePeak).toBe('No recorded zone window');
  });

  it('keeps multiple Watch segments distinct instead of averaging them', () => {
    const labels = privateZoneHeartRateLabels(
      [projection(), projection({ zoneSummaries: [] })],
      1,
      1,
      'zone-1',
      { startElapsedMs: 300, endElapsedMs: 1_180 },
    );
    expect(labels.averagePeak).toBe('Multiple Watch segments — see private details');
    expect(labels.coverage).toBe('Multiple Watch segments — see private details');
  });
});
