import { describe, expect, it } from 'vitest';
import {
  normalizeRiderPhotoDataUrl,
  riderInitials,
  riderPhotoMaxDataUrlLength,
} from '../../src/lib/riderPhotos';

const jpegPhoto = 'data:image/jpeg;base64,QUJDRA==';

describe('rider profile photos', () => {
  it('accepts bounded raster data URLs and rejects unsafe image sources', () => {
    expect(normalizeRiderPhotoDataUrl(jpegPhoto)).toBe(jpegPhoto);
    expect(normalizeRiderPhotoDataUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBe('');
    expect(normalizeRiderPhotoDataUrl('https://example.com/rider.jpg')).toBe('');
    expect(normalizeRiderPhotoDataUrl(`data:image/jpeg;base64,${'A'.repeat(riderPhotoMaxDataUrlLength)}`)).toBe('');
  });

  it('creates a compact fallback from rider names', () => {
    expect(riderInitials('Maya Torres')).toBe('MT');
    expect(riderInitials('Wasabi')).toBe('W');
    expect(riderInitials('Rasheen "The Rocket" Hicks')).toBe('RH');
    expect(riderInitials('')).toBe('R');
  });
});
