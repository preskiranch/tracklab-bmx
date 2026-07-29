import type { ExploreRider, RaceState, RiderState } from '../types';
import { getTrackLabAudioContext } from './audioCues';

export const bmxBikeMechanicsUrl = '/assets/bmx-bike-mechanics.mp3';

const maxBikeAudioRiders = 4;
const pedalLoopStartSeconds = 1.5;
const pedalLoopEndSeconds = 8.2;
const freewheelLoopStartSeconds = 10.2;
const freewheelLoopEndSeconds = 26.5;
const bikeAudioMasterVolume = 0.34;
const pedalLayerVolume = 0.44;
const freewheelLayerVolume = 0.085;
const minimumCoastingVelocityMps = 0.4;

export type BikeRaceAudioMode = 'silent' | 'pedaling' | 'freewheel';

type BikeAudioChannel = {
  pedalSource: AudioBufferSourceNode;
  pedalGain: GainNode;
  freewheelSource: AudioBufferSourceNode;
  freewheelGain: GainNode;
};

type BikeRaceAudioDebug = {
  ready: boolean;
  modes: Record<number, BikeRaceAudioMode>;
  seenModes: Record<number, BikeRaceAudioMode[]>;
};

let bikeAudioBufferPromise: Promise<AudioBuffer | null> | null = null;
let bikeAudioContext: AudioContext | null = null;
let bikeAudioMasterGain: GainNode | null = null;
let bikeAudioChannels = new Map<number, BikeAudioChannel>();
let bikeAudioSeenModes = new Map<number, Set<BikeRaceAudioMode>>();

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function bikeRaceAudioMode(
  raceState: RaceState,
  rider: Pick<
    RiderState,
    'driveAllowed' | 'finishedAt' | 'lastRawCadence' | 'velocity'
  >,
): BikeRaceAudioMode {
  if (raceState !== 'racing' || rider.finishedAt != null || rider.velocity <= 0) {
    return 'silent';
  }
  if (rider.driveAllowed && rider.lastRawCadence >= 1) {
    return 'pedaling';
  }
  if (!rider.driveAllowed && rider.velocity >= minimumCoastingVelocityMps) {
    return 'freewheel';
  }
  return 'silent';
}

function publishBikeAudioDebug(modes: Record<number, BikeRaceAudioMode>) {
  if (typeof window === 'undefined') {
    return;
  }
  Object.entries(modes).forEach(([playerId, mode]) => {
    if (mode === 'silent') {
      return;
    }
    const numericPlayerId = Number(playerId);
    const seen = bikeAudioSeenModes.get(numericPlayerId) ?? new Set();
    seen.add(mode);
    bikeAudioSeenModes.set(numericPlayerId, seen);
  });
  (window as typeof window & {
    __tracklabBikeRaceAudio?: BikeRaceAudioDebug;
  }).__tracklabBikeRaceAudio = {
    ready: bikeAudioChannels.size > 0,
    modes,
    seenModes: Object.fromEntries(
      [...bikeAudioSeenModes.entries()].map(([playerId, seen]) => [
        playerId,
        [...seen],
      ]),
    ),
  };
}

function loadBikeAudioBuffer(context: AudioContext) {
  if (!bikeAudioBufferPromise) {
    bikeAudioBufferPromise = fetch(bmxBikeMechanicsUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`BMX bike audio returned ${response.status}`);
        }
        return response.arrayBuffer();
      })
      .then((buffer) => context.decodeAudioData(buffer))
      .catch(() => null);
  }
  return bikeAudioBufferPromise;
}

function createLoopSource(
  context: AudioContext,
  buffer: AudioBuffer,
  loopStart: number,
  loopEnd: number,
  playbackRate: number,
) {
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.loopStart = Math.min(loopStart, Math.max(0, buffer.duration - 0.2));
  source.loopEnd = Math.max(
    source.loopStart + 0.1,
    Math.min(loopEnd, buffer.duration),
  );
  source.playbackRate.value = playbackRate;
  return source;
}

function createBikeAudioChannel(
  context: AudioContext,
  buffer: AudioBuffer,
  playerId: number,
) {
  const pedalGain = context.createGain();
  const freewheelGain = context.createGain();
  const mixGain = context.createGain();
  const pitchVariation = 0.965 + (playerId - 1) * 0.022;
  const pedalSource = createLoopSource(
    context,
    buffer,
    pedalLoopStartSeconds,
    pedalLoopEndSeconds,
    pitchVariation,
  );
  const freewheelSource = createLoopSource(
    context,
    buffer,
    freewheelLoopStartSeconds,
    freewheelLoopEndSeconds,
    pitchVariation,
  );
  const panner = typeof context.createStereoPanner === 'function'
    ? context.createStereoPanner()
    : null;
  const lanePan = ((playerId - 1) / (maxBikeAudioRiders - 1)) * 0.7 - 0.35;
  const now = context.currentTime;

  pedalGain.gain.setValueAtTime(0, now);
  freewheelGain.gain.setValueAtTime(0, now);
  mixGain.gain.setValueAtTime(1, now);
  if (panner) {
    panner.pan.setValueAtTime(lanePan, now);
  }

  pedalSource.connect(pedalGain);
  freewheelSource.connect(freewheelGain);
  pedalGain.connect(mixGain);
  freewheelGain.connect(mixGain);
  if (panner) {
    mixGain.connect(panner);
    panner.connect(bikeAudioMasterGain!);
  } else {
    mixGain.connect(bikeAudioMasterGain!);
  }

  const pedalOffset = pedalSource.loopStart
    + ((playerId - 1) / maxBikeAudioRiders)
    * (pedalSource.loopEnd - pedalSource.loopStart);
  const freewheelOffset = freewheelSource.loopStart
    + ((playerId - 1) / maxBikeAudioRiders)
    * (freewheelSource.loopEnd - freewheelSource.loopStart);
  pedalSource.start(now, pedalOffset);
  freewheelSource.start(now, freewheelOffset);

  return {
    pedalSource,
    pedalGain,
    freewheelSource,
    freewheelGain,
  };
}

async function ensureBikeAudioChannels() {
  const context = getTrackLabAudioContext();
  if (!context || context.state === 'closed') {
    return false;
  }
  if (context.state !== 'running') {
    await context.resume().catch(() => undefined);
  }
  if (context.state !== 'running') {
    return false;
  }

  const buffer = await loadBikeAudioBuffer(context);
  if (!buffer || context.state !== 'running') {
    return false;
  }

  if (bikeAudioContext !== context || !bikeAudioMasterGain) {
    bikeAudioChannels.forEach((channel) => {
      try {
        channel.pedalSource.stop();
        channel.freewheelSource.stop();
      } catch {
        // A source may already have stopped with its previous context.
      }
    });
    bikeAudioChannels = new Map();
    bikeAudioContext = context;
    bikeAudioMasterGain = context.createGain();
    bikeAudioMasterGain.gain.setValueAtTime(
      bikeAudioMasterVolume,
      context.currentTime,
    );
    bikeAudioMasterGain.connect(context.destination);
  }

  for (let playerId = 1; playerId <= maxBikeAudioRiders; playerId += 1) {
    if (!bikeAudioChannels.has(playerId)) {
      bikeAudioChannels.set(
        playerId,
        createBikeAudioChannel(context, buffer, playerId),
      );
    }
  }
  return true;
}

function setLayerVolume(gain: GainNode, value: number, now: number) {
  gain.gain.cancelScheduledValues(now);
  gain.gain.setTargetAtTime(value, now, 0.035);
}

export async function primeBikeRaceAudio() {
  bikeAudioSeenModes = new Map();
  const ready = await ensureBikeAudioChannels();
  publishBikeAudioDebug({});
  return ready;
}

export function updateBikeRaceAudio(
  raceState: RaceState,
  riders: RiderState[],
) {
  updateBikeMechanicsAudio(
    raceState,
    riders.map((rider) => ({
      playerId: rider.playerId,
      driveAllowed: rider.driveAllowed,
      finishedAt: rider.finishedAt,
      lastRawCadence: rider.lastRawCadence,
      velocity: rider.velocity,
    })),
  );
}

function updateBikeMechanicsAudio(
  raceState: RaceState,
  riders: Array<Pick<
    RiderState,
    'playerId' | 'driveAllowed' | 'finishedAt' | 'lastRawCadence' | 'velocity'
  >>,
) {
  if (!bikeAudioContext || bikeAudioChannels.size === 0) {
    if (raceState === 'racing') {
      void ensureBikeAudioChannels().then((ready) => {
        if (ready) {
          updateBikeMechanicsAudio(raceState, riders);
        }
      });
    }
    publishBikeAudioDebug(Object.fromEntries(
      riders.map((rider) => [
        rider.playerId,
        bikeRaceAudioMode(raceState, rider),
      ]),
    ));
    return;
  }

  const now = bikeAudioContext.currentTime;
  const modes: Record<number, BikeRaceAudioMode> = {};
  bikeAudioChannels.forEach((channel, playerId) => {
    const rider = riders.find((item) => item.playerId === playerId);
    const mode = rider ? bikeRaceAudioMode(raceState, rider) : 'silent';
    modes[playerId] = mode;

    const cadenceRpm = rider?.lastRawCadence ?? 0;
    const velocityMps = rider?.velocity ?? 0;
    channel.pedalSource.playbackRate.setTargetAtTime(
      clamp(cadenceRpm / 92, 0.64, 1.55),
      now,
      0.08,
    );
    channel.freewheelSource.playbackRate.setTargetAtTime(
      clamp(velocityMps / 8, 0.55, 1.6),
      now,
      0.08,
    );
    setLayerVolume(
      channel.pedalGain,
      mode === 'pedaling' ? pedalLayerVolume : 0,
      now,
    );
    setLayerVolume(
      channel.freewheelGain,
      mode === 'freewheel' ? freewheelLayerVolume : 0,
      now,
    );
  });
  publishBikeAudioDebug(modes);
}

export function updateExploreBikeAudio(
  status: 'ready' | 'riding' | 'paused' | 'finished',
  riders: ExploreRider[],
) {
  updateBikeMechanicsAudio(
    status === 'riding' ? 'racing' : 'ready',
    riders.map((rider) => ({
      playerId: rider.playerId,
      driveAllowed: (rider.cadence ?? 0) >= 1,
      finishedAt: rider.finishedAt,
      lastRawCadence: rider.cadence ?? 0,
      velocity: rider.velocityMps,
    })),
  );
}

export function exploreBikeAudioMode(
  status: 'ready' | 'riding' | 'paused' | 'finished',
  rider: Pick<ExploreRider, 'cadence' | 'finishedAt' | 'velocityMps'>,
) {
  return bikeRaceAudioMode(
    status === 'riding' ? 'racing' : 'ready',
    {
      driveAllowed: (rider.cadence ?? 0) >= 1,
      finishedAt: rider.finishedAt,
      lastRawCadence: rider.cadence ?? 0,
      velocity: rider.velocityMps,
    },
  );
}

export function stopBikeRaceAudio() {
  if (!bikeAudioContext) {
    publishBikeAudioDebug({});
    return;
  }
  const now = bikeAudioContext.currentTime;
  bikeAudioChannels.forEach((channel) => {
    setLayerVolume(channel.pedalGain, 0, now);
    setLayerVolume(channel.freewheelGain, 0, now);
  });
  publishBikeAudioDebug({});
}
