import { describe, expect, it, vi } from 'vitest';
import {
  heartRateAccountBlockCodeFromAppLink,
  heartRateStudioInviteCodeFromAppLink,
  listenForHeartRateAccountBlockAppLinks,
  listenForHeartRateStudioInviteAppLinks,
  trackLocatorIdFromAppLink,
} from '../../src/lib/nativeAppLinks';

describe('TrackLab native universal links', () => {
  it('accepts only the exact production HTTPS host and a valid studio invitation', () => {
    expect(heartRateStudioInviteCodeFromAppLink(
      'https://tracklab-bmx.onrender.com/?heartRateStudioInvite=ABCD-EFGH',
    )).toBe('ABCD-EFGH');
    expect(heartRateStudioInviteCodeFromAppLink(
      'http://tracklab-bmx.onrender.com/?heartRateStudioInvite=ABCD-EFGH',
    )).toBe('');
    expect(heartRateStudioInviteCodeFromAppLink(
      'https://tracklab-bmx.onrender.com.evil.example/?heartRateStudioInvite=ABCD-EFGH',
    )).toBe('');
    expect(heartRateStudioInviteCodeFromAppLink(
      'https://tracklab-bmx.onrender.com/not-supported?heartRateStudioInvite=ABCD-EFGH',
    )).toBe('');
  });

  it('emits only a normalized code and can be removed', async () => {
    let listener: ((event: { url: string }) => void) | null = null;
    const remove = vi.fn(async () => undefined);
    const onInvite = vi.fn();
    const handle = await listenForHeartRateStudioInviteAppLinks(onInvite, {
      isNativePlatform: () => true,
      addListener: vi.fn(async (_name, nextListener) => {
        listener = nextListener;
        return { remove };
      }),
    });

    listener?.({ url: 'https://tracklab-bmx.onrender.com/?heartRateStudioInvite=abcd-efgh&secret=no' });
    expect(onInvite).toHaveBeenCalledWith('ABCD-EFGH');
    expect(onInvite).not.toHaveBeenCalledWith(expect.stringContaining('https://'));
    await handle.remove();
    expect(remove).toHaveBeenCalledOnce();
  });

  it('does not attach a listener in a browser shell', async () => {
    const addListener = vi.fn();
    const handle = await listenForHeartRateStudioInviteAppLinks(vi.fn(), {
      isNativePlatform: () => false,
      addListener,
    });
    expect(addListener).not.toHaveBeenCalled();
    await expect(handle.remove()).resolves.toBeUndefined();
  });

  it('accepts a private account handoff only from the fragment of the exact production link', () => {
    expect(heartRateAccountBlockCodeFromAppLink(
      'https://tracklab-bmx.onrender.com/#heartRateAccountBlock=abcd-efgh',
    )).toBe('ABCD-EFGH');
    expect(heartRateAccountBlockCodeFromAppLink(
      'https://tracklab-bmx.onrender.com/?heartRateAccountBlock=ABCD-EFGH',
    )).toBe('');
    expect(heartRateAccountBlockCodeFromAppLink(
      'https://tracklab-bmx.onrender.com.evil.example/#heartRateAccountBlock=ABCD-EFGH',
    )).toBe('');
    expect(heartRateAccountBlockCodeFromAppLink(
      'http://tracklab-bmx.onrender.com/#heartRateAccountBlock=ABCD-EFGH',
    )).toBe('');
    expect(heartRateAccountBlockCodeFromAppLink(
      'https://tracklab-bmx.onrender.com/settings#heartRateAccountBlock=ABCD-EFGH',
    )).toBe('');
  });

  it('emits only the normalized account handoff code to the native listener', async () => {
    let listener: ((event: { url: string }) => void) | null = null;
    const onHandoff = vi.fn();
    await listenForHeartRateAccountBlockAppLinks(onHandoff, {
      isNativePlatform: () => true,
      addListener: vi.fn(async (_name, nextListener) => {
        listener = nextListener;
        return { remove: async () => undefined };
      }),
    });

    listener?.({
      url: 'https://tracklab-bmx.onrender.com/#heartRateAccountBlock=abcd-efgh',
    });
    expect(onHandoff).toHaveBeenCalledWith('ABCD-EFGH');
    expect(onHandoff).not.toHaveBeenCalledWith(expect.stringContaining('https://'));
  });

  it('accepts only a safe public track ID on the exact production root link', () => {
    expect(trackLocatorIdFromAppLink(
      'https://tracklab-bmx.onrender.com/?locator=apple-valley-bmx-moto-park#track-locator',
    )).toBe('apple-valley-bmx-moto-park');
    expect(trackLocatorIdFromAppLink(
      'https://tracklab-bmx.onrender.com/track?locator=apple-valley-bmx-moto-park',
    )).toBe('');
    expect(trackLocatorIdFromAppLink(
      'https://tracklab-bmx.onrender.com.evil.test/?locator=apple-valley-bmx-moto-park',
    )).toBe('');
    expect(trackLocatorIdFromAppLink(
      `https://tracklab-bmx.onrender.com/?locator=${'x'.repeat(141)}`,
    )).toBe('');
    expect(trackLocatorIdFromAppLink(
      'https://tracklab-bmx.onrender.com/?locator=track%2Fprivate',
    )).toBe('');
  });

  it('deduplicates overlapping cold/event delivery but reopens the same track later', async () => {
    let listener: ((event: { url: string }) => void) | null = null;
    const onTrackLocator = vi.fn();
    const now = vi.spyOn(Date, 'now').mockReturnValue(10_000);
    await listenForHeartRateStudioInviteAppLinks(vi.fn(), {
      isNativePlatform: () => true,
      addListener: vi.fn(async (_name, nextListener) => {
        listener = nextListener;
        return { remove: async () => undefined };
      }),
      getLaunchUrl: vi.fn(async () => ({
        url: 'https://tracklab-bmx.onrender.com/?locator=apple-valley-bmx-moto-park#track-locator',
      })),
      onTrackLocator,
    });
    await Promise.resolve();
    expect(onTrackLocator).toHaveBeenCalledWith('apple-valley-bmx-moto-park');
    expect(onTrackLocator).not.toHaveBeenCalledWith(expect.stringContaining('https://'));
    listener?.({
      url: 'https://tracklab-bmx.onrender.com/?locator=apple-valley-bmx-moto-park#track-locator',
    });
    expect(onTrackLocator).toHaveBeenCalledTimes(1);
    now.mockReturnValue(11_001);
    listener?.({
      url: 'https://tracklab-bmx.onrender.com/?locator=apple-valley-bmx-moto-park#track-locator',
    });
    expect(onTrackLocator).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });
});
