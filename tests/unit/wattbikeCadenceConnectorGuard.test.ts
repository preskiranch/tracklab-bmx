import { describe, expect, it, vi } from 'vitest';
import {
  cleanWattbikeCadenceRpm,
  maximumAcceptedWattbikeCadenceRpm as connectorMaximumCadenceRpm,
} from '../../bridge/bike-metric-sanity.mjs';
import { normalizeAntSample } from '../../bridge/ant-source.mjs';
import { parseIndoorBikeData } from '../../bridge/ble-source.mjs';
import { maximumAcceptedWattbikeCadenceRpm as appMaximumCadenceRpm } from '../../src/lib/bikeSampleSanity';

function indoorBikeData(cadenceRpm: number) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt16LE(0x05, 0); // More Data + Instantaneous Cadence present.
  bytes.writeUInt16LE(Math.round(cadenceRpm * 2), 2);
  return bytes;
}

function indoorBikeDataWithSpeed(cadenceRpm: number, speedKph: number) {
  const bytes = Buffer.alloc(6);
  bytes.writeUInt16LE(0x04, 0); // Instantaneous speed + cadence are present.
  bytes.writeUInt16LE(Math.round(speedKph * 100), 2);
  bytes.writeUInt16LE(Math.round(cadenceRpm * 2), 4);
  return bytes;
}

describe('Wattbike connector cadence guard', () => {
  it('keeps the connector and app trust boundaries on the same inclusive limit', () => {
    expect(connectorMaximumCadenceRpm).toBe(200);
    expect(appMaximumCadenceRpm).toBe(connectorMaximumCadenceRpm);
    expect(cleanWattbikeCadenceRpm(200)).toBe(200);
    expect(cleanWattbikeCadenceRpm(200.01)).toBeNull();
  });

  it('drops invalid ANT cadence before estimated speed and preserves prior cadence age', () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000);
    const previous = {
      at: 1_000,
      cadence: 96,
      cadenceAt: 1_000,
      speedKph: 25,
      speedAt: 1_000,
      speedSource: 'estimated',
      watts: 500,
      wattsAt: 1_000,
    };

    const rejectedOnlyCadence = normalizeAntSample(
      'cadence',
      'cadenceData',
      { DeviceId: 58_701, Cadence: 923_334 },
      previous,
    );
    const rejectedCadenceWithPower = normalizeAntSample(
      'power',
      'powerData',
      { DeviceId: 58_701, Cadence: 923_334, Power: 600, SpeedKph: 151_080.1 },
      previous,
    );
    const validBoundary = normalizeAntSample(
      'cadence',
      'cadenceData',
      { DeviceId: 58_701, Cadence: 200 },
      previous,
    );

    expect(rejectedOnlyCadence).toBeNull();
    expect(rejectedCadenceWithPower).toMatchObject({
      cadence: 96,
      cadenceAt: 1_000,
      speedKph: 25,
      speedAt: 1_000,
      watts: 600,
      wattsAt: 2_000,
    });
    expect(validBoundary).toMatchObject({
      cadence: 200,
      cadenceAt: 2_000,
    });
    vi.useRealTimers();
  });

  it('drops over-limit FTMS cadence at the desktop BLE parser', () => {
    expect(parseIndoorBikeData(indoorBikeData(200))).toEqual({ cadence: 200 });
    expect(parseIndoorBikeData(indoorBikeData(200.5))).toEqual({});
    expect(parseIndoorBikeData(indoorBikeDataWithSpeed(200, 80))).toEqual({
      speedKph: 80,
      cadence: 200,
    });
    expect(parseIndoorBikeData(indoorBikeDataWithSpeed(200.5, 80))).toEqual({});
    expect(parseIndoorBikeData(indoorBikeDataWithSpeed(200, 80.01))).toEqual({ cadence: 200 });
  });
});
