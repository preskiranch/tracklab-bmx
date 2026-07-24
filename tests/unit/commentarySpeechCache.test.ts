import { describe, expect, it, vi } from 'vitest';
import { createCommentarySpeechCache } from '../../cloud/commentarySpeechCache.mjs';

describe('commentary speech cache', () => {
  it('shares an in-flight synthesis and reuses the completed audio', async () => {
    let resolveAudio = (_audio: Buffer) => {};
    const audioPromise = new Promise<Buffer>((resolve) => {
      resolveAudio = resolve;
    });
    const cache = createCommentarySpeechCache();

    expect(cache.setPending('same-call', audioPromise).status).toBe('miss');
    const shared = cache.get('same-call');
    expect(shared?.status).toBe('shared');

    const audio = Buffer.from('natural commentary');
    resolveAudio(audio);
    await expect(shared?.promise).resolves.toBe(audio);
    await Promise.resolve();

    const completed = cache.get('same-call');
    expect(completed?.status).toBe('hit');
    await expect(completed?.promise).resolves.toBe(audio);
  });

  it('expires old audio and caps memory entries', async () => {
    let currentTime = 1_000;
    const cache = createCommentarySpeechCache({
      maxEntries: 2,
      ttlMs: 100,
      now: () => currentTime,
    });

    cache.setPending('one', Promise.resolve(Buffer.from('one')));
    cache.setPending('two', Promise.resolve(Buffer.from('two')));
    cache.setPending('three', Promise.resolve(Buffer.from('three')));
    await vi.waitFor(() => expect(cache.size).toBe(2));
    expect(cache.get('one')).toBeNull();

    currentTime += 101;
    expect(cache.get('two')).toBeNull();
    expect(cache.get('three')).toBeNull();
    expect(cache.size).toBe(0);
  });

  it('removes failed synthesis so the next request can retry', async () => {
    const cache = createCommentarySpeechCache();
    const failed = Promise.reject(new Error('provider unavailable'));
    cache.setPending('retryable', failed);
    await expect(failed).rejects.toThrow('provider unavailable');
    await Promise.resolve();
    expect(cache.get('retryable')).toBeNull();
  });
});
