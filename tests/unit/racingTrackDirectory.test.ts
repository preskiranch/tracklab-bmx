import { describe, it, expect } from 'vitest';
import { isRacingDirectoryTrack } from '../../src/lib/racingTrackDirectory';
describe('global BMX race directory eligibility', () => {
  it('requires a race directory source, not a BMX name or country federation link', () => {
    expect(isRacingDirectoryTrack({ providerId: 'openstreetmap-overpass', sourceType: 'community-map', verificationStatus: 'supplemental' })).toBe(false);
    expect(isRacingDirectoryTrack({ providerId: 'uci', sourceType: 'governing-body-reference', verificationStatus: 'reference-only' })).toBe(false);
    expect(isRacingDirectoryTrack({})).toBe(false);
    expect(isRacingDirectoryTrack({ providerId: 'openstreetmap-overpass', sourceType: 'national-federation-track-directory', verificationStatus: 'federation-directory' })).toBe(false);
  });
  it('accepts federation race directories even when a legitimate venue is called a park', () => {
    for (const providerId of ['usabmx', 'ffc-bmx-racing', 'auscycling', 'bmxnz']) {
      expect(isRacingDirectoryTrack({ providerId, sourceType: 'national-federation-track-directory', verificationStatus: 'federation-directory' })).toBe(true);
    }
  });
});
