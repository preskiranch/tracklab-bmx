import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExploreRider } from '../../src/types';

async function setup(failFirstDownload = false) {
  vi.resetModules();
  const gains: Array<{ value: number }> = [];
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
      return { playbackRate: parameter(), connect() {}, start() {}, stop() {} };
    },
  };
  vi.doMock('../../src/lib/audioCues', () => ({ getTrackLabAudioContext: () => context }));
  let downloads = 0;
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: !failFirstDownload || downloads++ > 0, arrayBuffer: async () => new ArrayBuffer(1) })));
  const audio = await import('../../src/lib/bikeRaceAudio');
  await audio.primeBikeRaceAudio();
  const rider = { playerId: 1, cadence: 90, velocityMps: 8, finishedAt: null } as ExploreRider;
  return { audio, context, gains, rider };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.doUnmock('../../src/lib/audioCues'); });

describe('Explore audio interruption recovery', () => {
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
