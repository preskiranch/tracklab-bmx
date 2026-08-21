import { describe, expect, it, vi } from 'vitest';
import {
  heartRateAccountBlockCodeFromAppLink,
  heartRateStudioInviteCodeFromAppLink,
  listenForHeartRateAccountBlockAppLinks,
  listenForHeartRateStudioInviteAppLinks,
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
});
