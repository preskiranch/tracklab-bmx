import { describe, expect, it } from 'vitest';
import {
  displayedProfileSessionTitle,
  formatProfileRaceTime,
  formatProfileExploreDistance,
  formatProfileHistoryDistance,
  formatProfileRecordedDistance,
  formatProfileRecordedDistanceRange,
  profileSplitDistanceLabel,
} from '../../src/components/AccountProfileView';
import { formatClubLiveActivityDistance } from '../../src/components/ClubLiveMonitor';
import type { TrainingSession } from '../../src/types';

function sprintSession(): TrainingSession {
  return {
    id: 'unit-display-sprint',
    activityType: 'straight-sprint',
    title: '300 ft sprint at TrackLab Drag Strip',
    startedAt: 1,
    endedAt: 2,
    durationMs: 1,
    distanceMeters: 91.44,
    source: 'live',
    details: { sprintDistanceFeet: 300, sprintAirSetting: 5 },
    createdAt: 1,
    updatedAt: 2,
  };
}

describe('account profile unit presentation', () => {
  it('shows persisted millisecond race clocks with their established display precision', () => {
    expect(formatProfileRaceTime(22_399, 2)).toBe('22.40s');
    expect(formatProfileRaceTime(4_806, 3)).toBe('4.806s');
    expect(formatProfileRaceTime(undefined, 2)).toBe('—');
    expect(formatProfileRaceTime(Number.NaN, 3)).toBe('—');
  });

  it('uses long units for accumulated and Explore distances', () => {
    expect(formatProfileHistoryDistance(2_414, 'ft')).toBe('1.50 mi');
    expect(formatProfileHistoryDistance(2_414, 'm')).toBe('2.41 km');
    expect(formatProfileExploreDistance(2_414, 'ft')).toBe('1.50 mi');
    expect(formatProfileExploreDistance(2_414, 'm')).toBe('2.41 km');
  });

  it('converts canonical sprint and split distances only for display', () => {
    const session = sprintSession();
    expect(displayedProfileSessionTitle(session, 'ft')).toBe('300 ft sprint at TrackLab Drag Strip');
    expect(displayedProfileSessionTitle(session, 'm')).toBe('91 m sprint at TrackLab Drag Strip');
    expect(session.title).toBe('300 ft sprint at TrackLab Drag Strip');
    expect(session.details.sprintDistanceFeet).toBe(300);
    expect(profileSplitDistanceLabel('ft')).toBe('30 ft');
    expect(profileSplitDistanceLabel('m')).toBe('9 m');
  });

  it('preserves two-decimal recorded precision in either preferred distance unit', () => {
    expect(formatProfileRecordedDistance(44.2, 'm')).toBe('44.20 m');
    expect(formatProfileRecordedDistance(44.2, 'ft')).toBe('145.01 ft');
    expect(formatProfileRecordedDistanceRange(4.5, 22.1, 'm')).toBe('4.50–22.10 m');
    expect(formatProfileRecordedDistanceRange(4.5, 22.1, 'ft')).toBe('14.76–72.51 ft');
    expect(formatProfileRecordedDistance(undefined, 'm')).toBe('—');
    expect(formatProfileRecordedDistanceRange(0, undefined, 'ft')).toBe('—');
  });
});

describe('Club Live Monitor unit presentation', () => {
  it('uses long units for Explore and short units for studio programs', () => {
    expect(formatClubLiveActivityDistance(2_414, 'ft', 'explore')).toBe('1.50 mi');
    expect(formatClubLiveActivityDistance(2_414, 'm', 'explore')).toBe('2.41 km');
    expect(formatClubLiveActivityDistance(44.2, 'ft', 'bmx-race')).toBe('145 ft');
    expect(formatClubLiveActivityDistance(44.2, 'm', 'bmx-race')).toBe('44 m');
  });
});
