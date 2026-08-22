import { describe, expect, it } from 'vitest';
import {
  safeExternalHttpUrl,
  trackExternalLinks,
} from '../../src/lib/trackExternalLinks';

describe('official track external links', () => {
  it('keeps only ordinary external HTTP links without embedded credentials', () => {
    expect(safeExternalHttpUrl('https://oakcreekbmx.com/club')).toBe('https://oakcreekbmx.com/club');
    expect(safeExternalHttpUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeExternalHttpUrl('data:text/html,unsafe')).toBeUndefined();
    expect(safeExternalHttpUrl('https://owner:secret@oakcreekbmx.com/')).toBeUndefined();
  });

  it('returns the authoritative website, Facebook, and Instagram URLs', () => {
    expect(trackExternalLinks({
      websiteUrl: 'https://oakcreekbmx.com/',
      facebookUrl: 'http://www.facebook.com/oakcreekbmx/',
      instagramUrl: 'instagram.com/oakcreekbmx/',
    })).toEqual({
      websiteUrl: 'https://oakcreekbmx.com/',
      facebookUrl: 'https://www.facebook.com/oakcreekbmx/',
      instagramUrl: 'https://instagram.com/oakcreekbmx/',
    });
  });

  it('classifies a social profile stored in the website field instead of labeling it a website', () => {
    expect(trackExternalLinks({ websiteUrl: 'https://facebook.com/oakcreekbmx' })).toEqual({
      facebookUrl: 'https://facebook.com/oakcreekbmx',
    });
    expect(trackExternalLinks({ websiteUrl: 'https://instagram.com/oakcreekbmx' })).toEqual({
      instagramUrl: 'https://instagram.com/oakcreekbmx',
    });
  });

  it('does not fabricate links from handles or trust lookalike social domains', () => {
    expect(trackExternalLinks({
      facebookUrl: 'https://facebook.com.evil.example/oakcreekbmx',
      instagramUrl: '@oakcreekbmx',
    })).toEqual({});
  });
});
