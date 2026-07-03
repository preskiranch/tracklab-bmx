import { useEffect, useMemo, useState } from 'react';
import { defaultPlayerSlots, maxPlayers } from '../data';
import { bmxSpeedKphFromCadence } from '../game/bmxRollout';
import { wattbikeProAirHighWattsFromCadence } from '../game/wattbikePowerTable';
import type { BikeSample, PlayerSlot } from '../types';

export const demoDeviceIds = [91001, 91002, 91003, 91004, 91005, 91006, 91007, 91008] as const;

export const demoRaceVariableNames = [
  'launchSnap',
  'gateReaction',
  'accelerationCurve',
  'maxCadence',
  'cadenceFloor',
  'cadenceSmoothness',
  'cadenceNoise',
  'powerBase',
  'sprintPower',
  'wattNoise',
  'fatigueRate',
  'recoveryRate',
  'cornerCaution',
  'pumpEfficiency',
  'rhythmTiming',
  'manualTiming',
  'jumpConfidence',
  'landingEfficiency',
  'lineChoice',
  'balance',
  'consistency',
  'aggression',
  'endurance',
  'anaerobicCapacity',
  'torque',
  'gearFeel',
  'rollingResistance',
  'trackRead',
  'startHillCommit',
  'firstStraightBurst',
  'secondStraightBurst',
  'finalStraightKick',
  'midRaceLull',
  'breathingRhythm',
  'upperBodyStability',
  'traction',
  'wheelSpeedNoise',
  'heartRateDrift',
  'focus',
  'crowdPressure',
  'rivalryBoost',
  'mistakeChance',
  'mistakeRecovery',
  'lineDrift',
  'snapBack',
  'cadenceDropOnLanding',
  'sprintZoneDiscipline',
  'restCompliance',
  'nervousEnergy',
  'bikeSetup',
  'chainEfficiency',
  'tirePressure',
  'windDrag',
  'bodyPosition',
  'crankSmoothness',
  'seatedTransition',
  'standingTransition',
  'startGateLoad',
  'pedalStrokeAsymmetry',
  'gripFatigue',
  'thermalFade',
  'mentalReset',
  'passingRisk',
  'finishAwareness',
] as const;

type DemoRaceVariableName = typeof demoRaceVariableNames[number];
type DemoRaceVariables = Record<DemoRaceVariableName, number>;

type DemoProfile = {
  deviceId: number;
  label: string;
  accent: string;
  index: number;
  phaseOffset: number;
  variables: DemoRaceVariables;
  mistakeTime: number;
  mistakeDuration: number;
  mistakeSeverity: number;
};

type DemoBikesOptions = {
  enabled: boolean;
  bikeCount: number;
  raceSeed: number;
  raceStartedAt: number | null;
  signalState: 'ready' | 'racing' | 'stopped';
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function average(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / Math.max(1, values.length);
}

function mulberry32(seed: number) {
  return () => {
    let next = seed += 0x6D2B79F5;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function createVariables(seed: number): DemoRaceVariables {
  const random = mulberry32(seed);
  return demoRaceVariableNames.reduce((variables, name) => ({
    ...variables,
    [name]: random(),
  }), {} as DemoRaceVariables);
}

function createProfiles(bikeCount: number, raceSeed: number): DemoProfile[] {
  const safeCount = clamp(Math.round(bikeCount), 1, maxPlayers);
  return demoDeviceIds.slice(0, safeCount).map((deviceId, index) => {
    const seed = Math.trunc(raceSeed + deviceId * 97 + index * 1009);
    const variables = createVariables(seed);
    const random = mulberry32(seed + 4049);

    return {
      deviceId,
      label: `Demo Bike ${String.fromCharCode(65 + index)}`,
      accent: defaultPlayerSlots[index]?.accent ?? '#7ade36',
      index,
      phaseOffset: random() * Math.PI * 2,
      variables,
      mistakeTime: 6 + random() * 23,
      mistakeDuration: 0.55 + random() * 1.6,
      mistakeSeverity: 0.08 + random() * 0.2,
    };
  });
}

export function createDemoPlayers(bikeCount: number): PlayerSlot[] {
  const safeCount = clamp(Math.round(bikeCount), 1, maxPlayers);
  return defaultPlayerSlots.slice(0, safeCount).map((slot, index) => ({
    ...slot,
    name: `Demo Rider ${index + 1}`,
    deviceId: demoDeviceIds[index],
  }));
}

function restingSample(profile: DemoProfile, signal: number): BikeSample {
  const at = Date.now();
  return {
    at,
    source: 'demo',
    deviceId: profile.deviceId,
    label: profile.label,
    watts: 0,
    cadence: 0,
    speedKph: 0,
    wattsAt: at,
    cadenceAt: at,
    speedAt: at,
    signal,
    battery: Math.round(clamp(96 - profile.index * 2, 82, 100)),
  };
}

function sampleForProfile(profile: DemoProfile, elapsedSeconds: number, racing: boolean): BikeSample {
  const variables = profile.variables;
  const time = Math.max(0, elapsedSeconds);
  const phase = profile.phaseOffset;
  const baseSignal = clamp(0.78 + variables.consistency * 0.16 + Math.sin(time * 0.47 + phase) * 0.025, 0.62, 0.99);
  if (!racing) {
    return restingSample(profile, baseSignal);
  }

  const startEnvelope = Math.exp(-time / (3.9 + variables.endurance * 2.2));
  const rollout = clamp(
    1 - Math.exp(-time / (2.9 + variables.accelerationCurve * 2.3 + (1 - variables.launchSnap) * 0.9)),
    0,
    1,
  );
  const launchRise = clamp(
    1 - Math.exp(-time / (0.58 + (1 - variables.launchSnap) * 0.34 + variables.gateReaction * 0.16)),
    0,
    1,
  );
  const launchWindow = Math.exp(-time / (1.45 + variables.startHillCommit * 0.7));
  const cadenceEnvelope = clamp(rollout * 0.52 + launchRise * 0.48, 0, 1);
  const fatigue = clamp(
    time / (36 + variables.endurance * 34)
      * (0.42 + variables.fatigueRate * 0.78 + variables.thermalFade * 0.22),
    0,
    0.58,
  );
  const recovery = variables.recoveryRate * 0.15 + variables.breathingRhythm * 0.1 + variables.mentalReset * 0.08;
  const rhythmWave = (Math.sin(time * (1.1 + variables.rhythmTiming * 0.55) + phase) + 1) / 2;
  const burstWave = (Math.sin(time * (0.52 + variables.sprintZoneDiscipline * 0.26) + phase * 0.5) + 1) / 2;
  const lineWave = (Math.sin(time * (0.19 + variables.lineDrift * 0.12) + phase * 1.7) + 1) / 2;
  const finishKick = clamp((time - (25 + variables.finishAwareness * 8)) / 8, 0, 1);
  const firstStraight = Math.exp(-Math.pow((time - (3.2 + variables.gateReaction * 1.1)) / 2.45, 2));
  const secondStraight = Math.exp(-Math.pow((time - (14 + variables.trackRead * 4)) / 4.6, 2));
  const fatigueLull = Math.exp(-Math.pow((time - (17 + variables.midRaceLull * 6)) / (2.4 + variables.gripFatigue * 2.4), 2))
    * variables.midRaceLull
    * (0.35 + variables.fatigueRate * 0.65);
  const mistakeEnvelope = Math.exp(-Math.pow((time - profile.mistakeTime) / profile.mistakeDuration, 2))
    * variables.mistakeChance
    * profile.mistakeSeverity;

  const skill = average([
    variables.trackRead,
    variables.lineChoice,
    variables.pumpEfficiency,
    variables.rhythmTiming,
    variables.manualTiming,
    variables.jumpConfidence,
    variables.landingEfficiency,
    variables.balance,
    variables.bodyPosition,
    variables.crankSmoothness,
    variables.upperBodyStability,
  ]);
  const drivetrain = average([
    variables.bikeSetup,
    variables.chainEfficiency,
    variables.tirePressure,
    variables.gearFeel,
    1 - variables.rollingResistance,
    1 - variables.windDrag,
  ]);
  const aggression = average([
    variables.aggression,
    variables.startHillCommit,
    variables.startGateLoad,
    variables.nervousEnergy,
    variables.rivalryBoost,
    variables.passingRisk,
  ]);
  const steadiness = average([
    variables.consistency,
    variables.focus,
    variables.traction,
    variables.snapBack,
    variables.mistakeRecovery,
    variables.restCompliance,
  ]);

  const rawEffort =
    0.24
    + startEnvelope * (0.18 + variables.launchSnap * 0.24 + variables.startHillCommit * 0.1)
    + firstStraight * variables.firstStraightBurst * 0.22
    + secondStraight * variables.secondStraightBurst * 0.2
    + finishKick * variables.finalStraightKick * 0.26
    + burstWave * (0.12 + variables.anaerobicCapacity * 0.18)
    + rhythmWave * variables.pumpEfficiency * 0.12
    + skill * 0.12
    + aggression * 0.13
    + recovery
    - fatigue
    - variables.midRaceLull * Math.exp(-Math.pow((time - 19) / 5.8, 2)) * 0.22
    - variables.cornerCaution * lineWave * 0.07
    - mistakeEnvelope;
  const effort = clamp(rawEffort, 0.14, 1.22);
  const noise = (
    Math.sin(time * (5.4 + variables.cadenceNoise * 2.8) + phase)
    + Math.sin(time * (8.6 + variables.wattNoise * 4.5) + phase * 2.2) * 0.5
  ) / 1.5;
  const cadenceDrop = mistakeEnvelope * (18 + variables.cadenceDropOnLanding * 28)
    + fatigueLull * (28 + variables.thermalFade * 30 + variables.gripFatigue * 18);
  const cadence = Math.round(clamp(
    cadenceEnvelope * (
      112
      + variables.cadenceFloor * 18
      + effort * (82 + variables.maxCadence * 60)
      + launchWindow * (18 + variables.launchSnap * 24 + variables.startGateLoad * 16)
      + firstStraight * (16 + variables.firstStraightBurst * 28)
      + secondStraight * (8 + variables.secondStraightBurst * 20)
      + finishKick * variables.finalStraightKick * 22
      + variables.standingTransition * startEnvelope * 22
      - variables.seatedTransition * finishKick * 8
      - cadenceDrop
      + noise * (3 + variables.cadenceNoise * 9)
      - variables.pedalStrokeAsymmetry * 2
    ),
    0,
    190,
  ));
  const resistanceLevel = 1;
  const tableWatts = wattbikeProAirHighWattsFromCadence(cadence, resistanceLevel);
  const watts = Math.round(clamp(
    tableWatts * clamp(
      0.94
        + variables.torque * 0.08
        + variables.crankSmoothness * 0.04
        + firstStraight * variables.launchSnap * 0.06
        + burstWave * variables.anaerobicCapacity * 0.05
        - fatigueLull * 0.08
        - mistakeEnvelope * 0.1,
      0.82,
      1.16,
    ),
    0,
    2500,
  ));
  const speedKph = Number(clamp(
    bmxSpeedKphFromCadence(cadence)
      + variables.wheelSpeedNoise * noise * 0.7
      - fatigueLull * 1.2
      - mistakeEnvelope * 1.4,
    0,
    53,
  ).toFixed(1));
  const signal = clamp(
    0.78
      + steadiness * 0.16
      + Math.sin(time * 0.47 + phase) * 0.025
      - variables.heartRateDrift * fatigue * 0.08,
    0.62,
    0.99,
  );

  const at = Date.now();

  return {
    at,
    source: 'demo',
    deviceId: profile.deviceId,
    label: profile.label,
    watts,
    cadence,
    speedKph,
    wattsAt: at,
    cadenceAt: at,
    speedAt: at,
    signal,
    battery: Math.round(clamp(92 - time * 0.012 - profile.index * 2 + drivetrain * 4, 76, 100)),
  };
}

export function useDemoBikes({ enabled, bikeCount, raceSeed, raceStartedAt, signalState }: DemoBikesOptions) {
  const [samplesByDevice, setSamplesByDevice] = useState<Map<number, BikeSample>>(new Map());
  const profiles = useMemo(() => createProfiles(bikeCount, raceSeed), [bikeCount, raceSeed]);

  useEffect(() => {
    if (!enabled || signalState === 'stopped') {
      setSamplesByDevice(new Map());
      return undefined;
    }

    const updateSamples = () => {
      const racing = signalState === 'racing' && raceStartedAt != null;
      const elapsedSeconds = racing ? (Date.now() - raceStartedAt) / 1000 : 0;
      setSamplesByDevice(new Map(profiles.map((profile) => [
        profile.deviceId,
        sampleForProfile(profile, elapsedSeconds, racing),
      ])));
    };

    updateSamples();
    const timer = window.setInterval(updateSamples, 120);
    return () => window.clearInterval(timer);
  }, [enabled, profiles, raceStartedAt, signalState]);

  return {
    samplesByDevice,
    variableCount: demoRaceVariableNames.length,
  };
}
