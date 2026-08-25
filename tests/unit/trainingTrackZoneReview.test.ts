import { describe, expect, it, vi } from 'vitest';
import type { GoogleMap, GoogleMapsRuntime } from '../../src/lib/googleMaps';
import { refitTrainingTrackReviewMap } from '../../src/components/TrainingTrackZoneReview';

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
