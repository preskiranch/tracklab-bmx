import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublicInfoPage } from '../../src/components/PublicInfoPage';
import { resolvePublicPage } from '../../src/lib/publicPages';

describe('public App Store pages', () => {
  it('routes the stable privacy and support URLs without loading the signed-in app', () => {
    expect(resolvePublicPage('/privacy')).toBe('privacy');
    expect(resolvePublicPage('/privacy/')).toBe('privacy');
    expect(resolvePublicPage('/privacy-policy')).toBe('privacy');
    expect(resolvePublicPage('/support')).toBe('support');
  });

  it('normalizes case but does not intercept unrelated application paths', () => {
    expect(resolvePublicPage('/SUPPORT/')).toBe('support');
    expect(resolvePublicPage('/')).toBeNull();
    expect(resolvePublicPage('/privacy/account')).toBeNull();
    expect(resolvePublicPage('/supports')).toBeNull();
  });

  it('discloses optional private heart rate and separates club live consent', () => {
    const markup = renderToStaticMarkup(createElement(PublicInfoPage, { page: 'privacy' }));

    expect(markup).toContain('Optional Apple Watch heart rate');
    expect(markup).toContain('continue using every training mode without granting Apple Health access');
    expect(markup).toContain('does not sell heart-rate data');
    expect(markup).toContain('trusted Watch Connect enrollment for one');
    expect(markup).toContain('starts each four-hour studio connection with one');
    expect(markup).toContain('club owner can disconnect studio');
    expect(markup).toContain('does not automatically erase heart-rate samples already saved');
    expect(markup).toContain('excluded from generic session JSON/CSV, the standard selected-day workbook, and public or club exports');
    expect(markup).toContain('separate private Numbers/Excel workbook containing heart-rate summaries');
    expect(markup).toContain('does not include raw heart-rate samples');
    expect(markup).toContain('must not be enabled for a minor without the permission');
    expect(markup).toContain('does not store personal health information in iCloud');
    expect(markup).toContain('Explicitly accepted friends can see whether the other account is');
    expect(markup).toContain('An auto-added official connection cannot see an ordinary rider');
    expect(markup).toContain('request to talk live');
    expect(markup).toContain('does not create a message history or inbox');
    expect(markup).toContain('limited to the two connected friends');
    expect(markup).toContain('Optional app notifications');
    expect(markup).toContain('opaque device token');
    expect(markup).toContain('not workout, heart-rate, microphone, message, or payment data');
    expect(markup).toContain('cannot accept an invitation, join live audio, or enable the microphone');
    expect(markup).toContain('iOS Keychain using device-only storage');
    expect(markup).toContain('does not register personal push alerts in Club Tablet kiosk mode');
  });
});
