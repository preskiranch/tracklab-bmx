import { describe, expect, it } from 'vitest';
import { analyticsPage } from '../../src/lib/adminAnalytics';

describe('analytics privacy boundaries', () => {
  it('never includes invitation credentials or arbitrary URLs in page categories', () => {
    expect(analyticsPage('#clubInvite=secret')).toBe('app');
    expect(analyticsPage('#familyInvite=private')).toBe('app');
    expect(analyticsPage('#track-locator?token=private')).toBe('tracks');
    expect(analyticsPage('#bike-shop-directory')).toBe('shops');
    expect(analyticsPage('')).toBe('home');
  });
});
