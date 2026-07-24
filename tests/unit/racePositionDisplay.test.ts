import { describe, expect, it } from 'vitest';
import {
  racePositionSeparationMeters,
  racePositionsAreEstablished,
} from '../../src/lib/racePositionDisplay';

describe('race position display', () => {
  const contender = (distanceMeters: number, finishedAt: number | null = null) => ({
    distanceMeters,
    finishedAt,
  });

  it('hides arbitrary player-number ranks before the race and while riders are tied', () => {
    expect(racePositionsAreEstablished('ready', [
      contender(0),
      contender(0),
      contender(0),
      contender(0),
    ])).toBe(false);
    expect(racePositionsAreEstablished('racing', [
      contender(2),
      contender(2),
      contender(2),
      contender(2),
    ])).toBe(false);
  });

  it('shows every place once riders have measurable separation', () => {
    expect(racePositionsAreEstablished('racing', [
      contender(2 + racePositionSeparationMeters),
      contender(2),
      contender(2),
      contender(2),
    ])).toBe(true);
  });

  it('shows place for a solo rider after leaving the gate and throughout the finished state', () => {
    expect(racePositionsAreEstablished('racing', [contender(0)])).toBe(false);
    expect(racePositionsAreEstablished('racing', [
      contender(racePositionSeparationMeters),
    ])).toBe(true);
    expect(racePositionsAreEstablished('racing', [
      contender(100, Date.now()),
      contender(100),
    ])).toBe(true);
    expect(racePositionsAreEstablished('finished', [
      contender(100, Date.now()),
      contender(100, Date.now() + 100),
      contender(100, Date.now() + 200),
      contender(100, Date.now() + 300),
    ])).toBe(true);
  });
});
