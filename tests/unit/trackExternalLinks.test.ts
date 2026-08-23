import { describe, expect, it } from 'vitest';
import {
  safeExternalHttpUrl,
  safePhoneNumber,
  trackExternalLinks,
} from '../../src/lib/trackExternalLinks';

describe('official track external links', () => {
  it('keeps only ordinary external HTTP links without embedded credentials', () => {
    expect(safeExternalHttpUrl('https://oakcreekbmx.com/club')).toBe('https://oakcreekbmx.com/club');
    expect(safeExternalHttpUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeExternalHttpUrl('data:text/html,unsafe')).toBeUndefined();
    expect(safeExternalHttpUrl('https://owner:secret@oakcreekbmx.com/')).toBeUndefined();
  });

  it('returns the authoritative website, social, phone, and federation links', () => {
    expect(trackExternalLinks({
      websiteUrl: 'https://oakcreekbmx.com/',
      facebookUrl: 'http://www.facebook.com/oakcreekbmx/',
      instagramUrl: 'instagram.com/oakcreekbmx/',
      tiktokUrl: 'tiktok.com/@oakcreekbmx',
      youtubeUrl: 'https://www.youtube.com/@oakcreekbmx',
      phoneNumber: '+1 (916) 555-0184',
      federationName: ' USA BMX ',
      federationUrl: 'https://www.usabmx.com/tracks/1908',
    })).toEqual({
      websiteUrl: 'https://oakcreekbmx.com/',
      facebookUrl: 'https://www.facebook.com/oakcreekbmx/',
      instagramUrl: 'https://instagram.com/oakcreekbmx/',
      tiktokUrl: 'https://tiktok.com/@oakcreekbmx',
      youtubeUrl: 'https://www.youtube.com/@oakcreekbmx',
      phoneNumber: '+1 (916) 555-0184',
      phoneHref: 'tel:+19165550184',
      federationName: 'USA BMX',
      federationUrl: 'https://www.usabmx.com/tracks/1908',
    });
  });

  it('classifies a social profile stored in the website field instead of labeling it a website', () => {
    expect(trackExternalLinks({ websiteUrl: 'https://facebook.com/oakcreekbmx' })).toEqual({
      facebookUrl: 'https://facebook.com/oakcreekbmx',
    });
    expect(trackExternalLinks({ websiteUrl: 'https://instagram.com/oakcreekbmx' })).toEqual({
      instagramUrl: 'https://instagram.com/oakcreekbmx',
    });
    expect(trackExternalLinks({ websiteUrl: 'youtube.com/@oakcreekbmx' })).toEqual({
      youtubeUrl: 'https://youtube.com/@oakcreekbmx',
    });
    expect(trackExternalLinks({ websiteUrl: 'https://www.tiktok.com/@oakcreekbmx' })).toEqual({
      tiktokUrl: 'https://www.tiktok.com/@oakcreekbmx',
    });
  });

  it('does not fabricate links from handles or trust lookalike social domains', () => {
    expect(trackExternalLinks({
      facebookUrl: 'https://facebook.com.evil.example/oakcreekbmx',
      instagramUrl: '@oakcreekbmx',
      tiktokUrl: 'https://tiktok.com.evil.example/@oakcreekbmx',
      youtubeUrl: 'https://notyoutube.com/@oakcreekbmx',
    })).toEqual({});
  });

  it('creates a tel link only from one conservatively normalized phone number', () => {
    expect(safePhoneNumber('(916) 555-0184')).toBe('(916) 555-0184');
    expect(safePhoneNumber('+61   405 525 970')).toBe('+61 405 525 970');
    expect(safePhoneNumber('+1 916 555 0184; +1 916 555 0199')).toBeUndefined();
    expect(safePhoneNumber('555-CALL-NOW')).toBeUndefined();
    expect(safePhoneNumber('12345')).toBeUndefined();
    expect(safePhoneNumber('++19165550184')).toBeUndefined();
    expect(safePhoneNumber('+1 (916 555-0184')).toBeUndefined();
    expect(safePhoneNumber('+1 916) 555-0184')).toBeUndefined();
  });

  it('only returns a federation when both its supplied name and safe URL are present', () => {
    expect(trackExternalLinks({
      federationName: 'USA BMX',
      federationUrl: 'javascript:alert(1)',
    })).toEqual({});
    expect(trackExternalLinks({ federationUrl: 'https://www.usabmx.com/' })).toEqual({});
    expect(trackExternalLinks({ federationName: 'USA BMX' })).toEqual({});
  });
});
