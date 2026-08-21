import { describe, expect, it } from 'vitest';
import { formatAnalyticsFeetDistance } from '../../src/components/AnalyticsPanel';
import {
  exploreSmartRoutePlaceholder,
  formatExploreDemoRollout,
} from '../../src/components/ExploreView';
import { formatProSetPedalStart3DTitle } from '../../src/components/GoogleMaps3DTrackLayer';
import { formatProSetPedalStartTitle } from '../../src/components/GoogleMapsTrackLayer';
import { formatRaceReviewSplitDistance } from '../../src/components/RaceReviewPanel';
import {
  formatProSetMinimumSpeed,
  formatStraightSprintFeet,
} from '../../src/components/SessionControlPanel';
import { formatMultiplayerProSetMinimumSpeed } from '../../src/components/MultiplayerPanel';
import { straightSprintConfigurationKey } from '../../src/lib/straightSprint';
import { proSplitMinimumMph } from '../../src/lib/trackMapping';

describe('race panel unit presentation', () => {
  it('formats canonical sprint feet in the selected display unit', () => {
    expect(formatStraightSprintFeet(300, 'ft')).toBe('300 ft');
    expect(formatStraightSprintFeet(300, 'm')).toBe('91 m');
    expect(formatAnalyticsFeetDistance(30, 'ft')).toBe('30 ft');
    expect(formatAnalyticsFeetDistance(30, 'm')).toBe('9 m');
  });

  it('formats the fixed Pro Set threshold in the selected speed unit', () => {
    expect(formatProSetMinimumSpeed('mph')).toBe(`${proSplitMinimumMph.toFixed(1)} MPH`);
    expect(formatProSetMinimumSpeed('kph')).toBe(`${(proSplitMinimumMph * 1.609344).toFixed(1)} KPH`);
    expect(formatMultiplayerProSetMinimumSpeed('mph')).toBe(`${proSplitMinimumMph.toFixed(1)} MPH`);
    expect(formatMultiplayerProSetMinimumSpeed('kph')).toBe(`${(proSplitMinimumMph * 1.609344).toFixed(1)} KPH`);
  });

  it('does not change canonical feet-based sprint identifiers', () => {
    expect(straightSprintConfigurationKey(300, 5)).toBe('sprint:300ft:air:5');
  });

  it('uses the distance preference for map guidance and post-race split labels', () => {
    expect(formatProSetPedalStartTitle('ft')).toContain('(0 ft)');
    expect(formatProSetPedalStartTitle('m')).toContain('(0 m)');
    expect(formatProSetPedalStart3DTitle('ft')).toContain('(0 ft)');
    expect(formatProSetPedalStart3DTitle('m')).toContain('(0 m)');
    expect(formatRaceReviewSplitDistance('ft')).toBe('30 ft');
    expect(formatRaceReviewSplitDistance('m')).toBe('9 m');
  });

  it('shows only the selected distance unit in the Explore demo rollout', () => {
    expect(formatExploreDemoRollout('m')).toBe('6.9 m');
    expect(formatExploreDemoRollout('ft')).toBe('22.6 ft');
    expect(exploreSmartRoutePlaceholder('m')).toContain('16-kilometer');
    expect(exploreSmartRoutePlaceholder('ft')).toContain('10-mile');
  });
});
