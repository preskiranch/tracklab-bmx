import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTrackLabAudioContext } from '../../src/lib/audioCues';
import { playReactionGateAirSound, prepareReactionGateAirSounds, reactionGateAirProfiles } from '../../src/lib/reactionGateAudio';

vi.mock('../../src/lib/audioCues', () => ({ getTrackLabAudioContext: vi.fn() }));

function asset(direction: 'drop' | 'raise') {
  const file = readFileSync(new URL(`../../public${reactionGateAirProfiles[direction].url}`, import.meta.url));
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
}
function wavSamples(raw: ArrayBuffer) {
  const view = new DataView(raw);
  let position = 12;
  while (position + 8 <= raw.byteLength) {
    const name = String.fromCharCode(...new Uint8Array(raw, position, 4));
    const size = view.getUint32(position + 4, true);
    if (name === 'data') return Float32Array.from({ length: size / 2 }, (_, i) => view.getInt16(position + 8 + i * 2, true) / 32768);
    position += 8 + size + (size % 2);
  }
  throw new Error('Missing WAV samples');
}
const rms = (samples: Float32Array) => Math.sqrt(samples.reduce((total, value) => total + value * value, 0) / samples.length);

function fakeContext() {
  const makeSource = () => ({ buffer: null as AudioBuffer | null, onended: null as (() => void) | null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() });
  const sources: ReturnType<typeof makeSource>[] = [];
  const context = Object.assign(new EventTarget(), {
    state: 'running', sampleRate: 44_100, currentTime: 17, destination: {}, resume: vi.fn(),
    decodeAudioData: vi.fn(async (raw: ArrayBuffer) => ({ numberOfChannels: 1, duration: wavSamples(raw).length / 48_000, sampleRate: 44_100 }) as AudioBuffer),
    createBufferSource: vi.fn(() => { const source = makeSource(); sources.push(source); return source; }),
  });
  vi.mocked(getTrackLabAudioContext).mockReturnValue(context as unknown as AudioContext);
  return { context, sources };
}

describe('reaction gate audio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(asset(url.includes('drop') ? 'drop' : 'raise'))));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('ships the chosen one-second whistle and faint two-second return without clipping', () => {
    const drop = wavSamples(asset('drop'));
    const raise = wavSamples(asset('raise'));
    expect(drop.length).toBe(48_000);
    expect(raise.length).toBe(96_000);
    for (const sound of [drop, raise]) {
      expect(sound[0]).toBe(0);
      expect(sound.at(-1)).toBe(0);
      expect(sound.every(sample => Number.isFinite(sample) && Math.abs(sample) <= .281)).toBe(true);
    }
    expect(20 * Math.log10(rms(raise) / rms(drop))).toBeLessThan(-16);
    expect(20 * Math.log10(rms(raise))).toBeGreaterThan(-42);
    expect(20 * Math.log10(rms(raise))).toBeLessThan(-38);
  });

  it('preloads and decodes once before movement, then starts cached audio synchronously', async () => {
    const { context, sources } = fakeContext();
    await Promise.all([prepareReactionGateAirSounds(), prepareReactionGateAirSounds()]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(context.decodeAudioData).toHaveBeenCalledTimes(2);
    await prepareReactionGateAirSounds();
    expect(fetch).toHaveBeenCalledTimes(2);
    playReactionGateAirSound('drop');
    playReactionGateAirSound('drop');
    playReactionGateAirSound('raise');
    expect(sources.map(source => source.buffer?.duration)).toEqual([1, 1, 2]);
    expect(sources[1].buffer).toBe(sources[0].buffer);
    expect(sources[0].start).toHaveBeenCalledExactlyOnceWith(17);
    expect(context.resume).not.toHaveBeenCalled();
  });

  it('never downloads or replays a stale movement when assets or the context are not ready', async () => {
    const { context } = fakeContext();
    playReactionGateAirSound('drop');
    expect(fetch).not.toHaveBeenCalled();
    await prepareReactionGateAirSounds();
    expect(context.createBufferSource).not.toHaveBeenCalled();
    context.state = 'suspended';
    const cancel = playReactionGateAirSound('raise');
    context.state = 'running';
    context.dispatchEvent(new Event('statechange'));
    expect(context.createBufferSource).not.toHaveBeenCalled();
    expect(cancel).not.toThrow();
    vi.mocked(getTrackLabAudioContext).mockReturnValue(null);
    expect(await prepareReactionGateAirSounds()).toBe(false);
    expect(playReactionGateAirSound('drop')).not.toThrow();
    vi.mocked(getTrackLabAudioContext).mockImplementation(() => { throw new Error('Unavailable'); });
    expect(await prepareReactionGateAirSounds()).toBe(false);
    expect(playReactionGateAirSound('raise')).not.toThrow();
  });

  it('retries a failed load without playing a partial or mistimed pair', async () => {
    const { context } = fakeContext();
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 404 }));
    expect(await prepareReactionGateAirSounds()).toBe(false);
    playReactionGateAirSound('drop');
    expect(context.createBufferSource).not.toHaveBeenCalled();
    expect(await prepareReactionGateAirSounds()).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('rejects an asset with the wrong duration', async () => {
    const { context } = fakeContext();
    context.decodeAudioData.mockResolvedValue({ duration: .45, numberOfChannels: 1 } as AudioBuffer);
    expect(await prepareReactionGateAirSounds()).toBe(false);
    playReactionGateAirSound('drop');
    expect(context.createBufferSource).not.toHaveBeenCalled();
  });

  it('bounds an unavailable download so optional gate audio cannot block cadence preparation', async () => {
    vi.useFakeTimers();
    fakeContext();
    vi.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
    }));
    const preparation = prepareReactionGateAirSounds();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await preparation).toBe(false);
  });

  it('cancels and disconnects once on navigation or context interruption', async () => {
    const { context, sources } = fakeContext();
    await prepareReactionGateAirSounds();
    const cancel = playReactionGateAirSound('drop');
    cancel(); cancel();
    expect(sources[0].stop).toHaveBeenCalledTimes(1);
    expect(sources[0].disconnect).toHaveBeenCalledTimes(1);
    const cancelRaise = playReactionGateAirSound('raise');
    context.state = 'suspended';
    context.dispatchEvent(new Event('statechange'));
    context.state = 'running';
    context.dispatchEvent(new Event('statechange'));
    cancelRaise();
    expect(sources[1].stop).toHaveBeenCalledTimes(1);
    expect(sources[1].start).toHaveBeenCalledTimes(1);
  });

  it('releases nodes after natural completion and playback failure', async () => {
    const { context, sources } = fakeContext();
    await prepareReactionGateAirSounds();
    const cancel = playReactionGateAirSound('drop');
    sources[0].onended!(); cancel();
    expect(sources[0].disconnect).toHaveBeenCalledTimes(1);
    expect(sources[0].stop).not.toHaveBeenCalled();
    const create = context.createBufferSource.getMockImplementation()!;
    context.createBufferSource.mockImplementation(() => {
      const source = create(); source.start.mockImplementation(() => { throw new Error('Interrupted'); }); return source;
    });
    expect(playReactionGateAirSound('raise')).not.toThrow();
    expect(sources[1].disconnect).toHaveBeenCalledTimes(1);
    expect(sources[1].onended).toBeNull();
  });
});
