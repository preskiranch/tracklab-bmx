import { describe, expect, it } from 'vitest';
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
});
