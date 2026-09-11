import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExploreRider } from '../../src/types';

async function setup(failFirstDownload = false, status = 200) {
  vi.resetModules();
  const gains: Array<{ value: number }> = [];
  const rates: Array<{ value: number }> = [];
  const parameter = () => ({
    value: 0,
    setValueAtTime(value: number) { this.value = value; },
    setTargetAtTime(value: number) { this.value = value; },
    cancelScheduledValues() {},
  });
  const context = {
    state: 'running', currentTime: 0, destination: {},
    resume: vi.fn(async () => { context.state = 'running'; }),
    decodeAudioData: vi.fn(async () => ({ duration: 30 })),
    createGain() {
      const gain = parameter();
      gains.push(gain);
      return { gain, connect() {} };
    },
    createBufferSource() {
      const playbackRate = parameter();
      rates.push(playbackRate);
      return { playbackRate, connect() {}, start() {}, stop() {} };
    },
  };
  vi.doMock('../../src/lib/audioCues', () => ({ getTrackLabAudioContext: () => context }));
  let downloads = 0;
  vi.stubGlobal('fetch', vi.fn(async () => ({ status, ok: status === 200 && (!failFirstDownload || downloads++ > 0), arrayBuffer: async () => new ArrayBuffer(1) })));
  const audio = await import('../../src/lib/bikeRaceAudio');
  await audio.primeBikeRaceAudio();
  const rider = { playerId: 1, cadence: 90, velocityMps: 8, finishedAt: null } as ExploreRider;
  return { audio, context, gains, rates, rider };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.doUnmock('../../src/lib/audioCues'); });

describe('Explore audio interruption recovery', () => {
  it('decodes bundled iOS audio with status zero instead of treating it as a failed download', async () => {
    vi.stubGlobal('window', { location: { protocol: 'capacitor:' } });
    const { audio, context, gains, rider } = await setup(false, 0);
    expect(context.decodeAudioData).toHaveBeenCalledTimes(1);
    audio.updateExploreBikeAudio('riding', [rider]);
    expect(audio.isBikeRaceAudioReady()).toBe(true);
    expect(gains[1].value).toBeGreaterThan(0);
  });

  it('does not accept status zero as a successful web download', async () => {
    vi.stubGlobal('window', { location: { protocol: 'https:' } });
    const { audio, context } = await setup(false, 0);
    expect(context.decodeAudioData).not.toHaveBeenCalled();
    expect(audio.isBikeRaceAudioReady()).toBe(false);
  });

  it('plays the original recording at normal speed while switching pedal and coast layers', async () => {
    const { audio, rates, gains, rider } = await setup();
    for (const cadence of [20, 90, 160]) {
      audio.updateExploreBikeAudio('riding', [{ ...rider, cadence }]);
      expect(rates[0].value).toBe(1);
      expect(gains[1].value).toBeGreaterThan(0);
      expect(gains[2].value).toBe(0);
    }
    for (const velocityMps of [1, 5, 12]) {
      audio.updateExploreBikeAudio('riding', [{ ...rider, cadence: 0, velocityMps }]);
      expect(rates[1].value).toBe(1);
      expect(gains[1].value).toBe(0);
      expect(gains[2].value).toBeGreaterThan(0);
    }
    audio.updateExploreBikeAudio('riding', [{ ...rider, cadence: 0, velocityMps: 0 }]);
    expect(gains[1].value).toBe(0);
    expect(gains[2].value).toBe(0);
  });
  it('recovers an existing suspended context and switches from pedaling to freewheel', async () => {
    const { audio, context, gains, rider } = await setup();
    audio.updateExploreBikeAudio('riding', [rider]);
    expect(gains[1].value).toBeGreaterThan(0);
    expect(gains[2].value).toBe(0);
    context.state = 'suspended';
    audio.updateExploreBikeAudio('riding', [{ ...rider, cadence: 0 }]);
    await vi.waitFor(() => expect(gains[2].value).toBeGreaterThan(0));
    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(gains[1].value).toBe(0);
    audio.updateExploreBikeAudio('paused', [rider]);
    expect(gains[1].value).toBe(0);
    expect(gains[2].value).toBe(0);
  });

  it('retries a failed recording download instead of caching silence for the session', async () => {
    const { audio, gains, rider } = await setup(true);
    expect(gains).toHaveLength(0);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 5_001);
    audio.updateExploreBikeAudio('riding', [rider]);
    await vi.waitFor(() => expect(gains[1]?.value).toBeGreaterThan(0));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('a fresh user gesture retries resume even while background recovery is pending', async () => {
    const { audio, context, gains, rider } = await setup();
    context.state = 'suspended';
    let unblock!: () => void;
    context.resume.mockImplementationOnce(() => new Promise<void>(resolve => { unblock = resolve; }));
    audio.updateExploreBikeAudio('riding', [rider]);
    expect(audio.isBikeRaceAudioReady()).toBe(false);
    const prime = audio.primeBikeRaceAudio();
    expect(context.resume).toHaveBeenCalledTimes(2);
    unblock();
    await prime;
    audio.updateExploreBikeAudio('riding', [rider]);
    expect(audio.isBikeRaceAudioReady()).toBe(true);
    expect(gains[1].value).toBeGreaterThan(0);
  });

  it('does not restart sound if the ride stops while recovery is pending', async () => {
    const { audio, context, gains, rider } = await setup();
    let resume!: () => void;
    context.state = 'suspended';
    context.resume.mockImplementation(() => new Promise<void>((resolve) => {
      resume = () => { context.state = 'running'; resolve(); };
    }));
    audio.updateExploreBikeAudio('riding', [rider]);
    audio.stopBikeRaceAudio();
    resume();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(gains[1].value).toBe(0);
    expect(gains[2].value).toBe(0);
  });
});
