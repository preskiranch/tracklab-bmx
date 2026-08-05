import { describe, expect, it } from 'vitest';
import {
  customBikeDisplayName,
  distinctBikeDisplayName,
  monitorBikeName,
  monitorIdLastThree,
  reconcileClonedBikeProfileNames,
  wattbikeMonitorLastThree,
} from '../../src/lib/bikeProfileIdentity';
import type { BikeProfile } from '../../src/types';

function profile(deviceId: number, name: string, updatedAt = 100): BikeProfile {
  return {
    accent: '#ffffff',
    colorName: 'lime',
    deviceId,
    name,
    updatedAt,
  };
}

describe('bike profile identity', () => {
  it('repairs a name copied from one connected monitor onto another', () => {
    const repaired = reconcileClonedBikeProfileNames([
      profile(43853, 'Bike 58701Watt'),
      profile(58701, 'Bike 58701Watt'),
    ], [43853, 58701]);

    expect(repaired.find((item) => item.deviceId === 43853)?.name).toBe('Bike 853');
    expect(repaired.find((item) => item.deviceId === 58701)?.name).toBe('Bike 58701Watt');
  });

  it('does not alter independent saved names', () => {
    const profiles = [
      profile(43853, 'Gate Trainer'),
      profile(58701, 'Rhythm Trainer'),
    ];

    expect(reconcileClonedBikeProfileNames(profiles, [43853, 58701])).toBe(profiles);
  });

  it('makes intentionally duplicated names distinguishable in Race Entry', () => {
    const bikes = [
      { deviceId: 43853, name: 'Studio Bike' },
      { deviceId: 58701, name: 'Studio Bike' },
    ];

    expect(distinctBikeDisplayName(bikes[0], bikes)).toBe('853 · Studio Bike');
    expect(distinctBikeDisplayName(bikes[1], bikes)).toBe('701 · Studio Bike');
  });

  it('uses only the last three monitor digits in compact Race Entry cards', () => {
    expect(monitorIdLastThree(701262)).toBe('262');
    expect(monitorIdLastThree(58701)).toBe('701');
    expect(monitorIdLastThree(7)).toBe('007');
    expect(monitorBikeName(701262)).toBe('Bike 262');
  });

  it('uses the physical Wattbike PM identity instead of the connector device ID', () => {
    expect(wattbikeMonitorLastThree('WattbikePM25043950', 733112)).toBe('950');
    expect(wattbikeMonitorLastThree('Wattbike PM #25043950', 733112)).toBe('950');
    expect(wattbikeMonitorLastThree('Connected Wattbike', 733112)).toBe('112');
    expect(monitorBikeName(733112, 'WattbikePM25043950')).toBe('Bike 950');
  });

  it('hides generated bike-number names but preserves intentional names', () => {
    expect(customBikeDisplayName({ deviceId: 701262, name: 'Bike 701262' })).toBeNull();
    expect(customBikeDisplayName({ deviceId: 58701, name: 'Bike 58701Watt' })).toBeNull();
    expect(customBikeDisplayName({ deviceId: 58701, name: 'Gate Trainer' })).toBe('Gate Trainer');
  });
});
