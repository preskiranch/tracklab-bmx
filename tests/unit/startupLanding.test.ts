import { describe, expect, it } from 'vitest';
import { shouldOpenCommunityHomeOnLaunch } from '../../src/lib/startupLanding';

describe('startup Community landing', () => {
  it('opens the Community home for ordinary web and native launches', () => {
    expect(shouldOpenCommunityHomeOnLaunch('https://tracklab-bmx.onrender.com/')).toBe(true);
    expect(shouldOpenCommunityHomeOnLaunch('capacitor://localhost/')).toBe(true);
    expect(shouldOpenCommunityHomeOnLaunch('not a valid URL')).toBe(true);
  });

  it('keeps public directory deep links in the Community landing', () => {
    expect(shouldOpenCommunityHomeOnLaunch(
      'https://tracklab-bmx.onrender.com/?locator=north-bay-bmx#track-locator',
    )).toBe(true);
    expect(shouldOpenCommunityHomeOnLaunch(
      'https://tracklab-bmx.onrender.com/#bike-shop-directory',
    )).toBe(true);
  });

  it('keeps a selected track for Open App but starts the session from Community home', () => {
    expect(shouldOpenCommunityHomeOnLaunch(
      'https://tracklab-bmx.onrender.com/?track=chula-vista-elite-bmx',
    )).toBe(true);
  });

  it('does not replace a room, invitation, or account handoff deep link', () => {
    expect(shouldOpenCommunityHomeOnLaunch(
      'https://tracklab-bmx.onrender.com/?room=club-race',
    )).toBe(false);
    expect(shouldOpenCommunityHomeOnLaunch(
      'https://tracklab-bmx.onrender.com/?friendInvite=token',
    )).toBe(false);
    expect(shouldOpenCommunityHomeOnLaunch(
      'https://tracklab-bmx.onrender.com/#clubInvite=token',
    )).toBe(false);
  });
});
