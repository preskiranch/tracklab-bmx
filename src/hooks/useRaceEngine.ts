import { useCallback, useEffect, useRef, useState } from 'react';
import { createInitialRiders, stepRiders, type BranchChoicesByPlayer } from '../game/physics';
import { nextRaceFinishDeadline } from '../lib/raceLifecycle';
import type { SplitRouteDecisionPoint } from '../lib/trackMapping';
import type { BikeSample, PlayerSlot, RaceState, RaceSummaryEntry, RiderState, TrackZone } from '../types';

type RaceMetricAccumulator = {
  deviceLabel: string;
  sampleCount: number;
  lastSampleAt: number;
  topSpeedKph: number;
  speedTotalKph: number;
  speedSamples: number;
  topCadence: number;
  cadenceTotal: number;
  cadenceSamples: number;
  topWatts: number;
  wattsTotal: number;
  wattsSamples: number;
};

function createMetricAccumulator(label: string): RaceMetricAccumulator {
  return {
    deviceLabel: label,
    sampleCount: 0,
    lastSampleAt: 0,
    topSpeedKph: 0,
    speedTotalKph: 0,
    speedSamples: 0,
    topCadence: 0,
    cadenceTotal: 0,
    cadenceSamples: 0,
    topWatts: 0,
    wattsTotal: 0,
    wattsSamples: 0,
  };
}

function average(total: number, samples: number) {
  return samples > 0 ? total / samples : null;
}

function metricIsFromRace(sample: BikeSample, metricAt: number | undefined, raceStartedAt: number) {
  return (metricAt ?? sample.at) >= raceStartedAt;
}

function recordRaceSamples(
  players: PlayerSlot[],
  riders: RiderState[],
  samplesByDevice: Map<number, BikeSample>,
  statsByPlayer: Map<PlayerSlot['id'], RaceMetricAccumulator>,
  raceStartedAt: number,
) {
  players.forEach((player) => {
    if (player.deviceId == null) {
      return;
    }

    const sample = samplesByDevice.get(player.deviceId);
    if (!sample || sample.at < raceStartedAt || sample.at === statsByPlayer.get(player.id)?.lastSampleAt) {
      return;
    }

    const rider = riders.find((item) => item.playerId === player.id);
    const stats = statsByPlayer.get(player.id) ?? createMetricAccumulator(sample.label);
    const speedKph = rider && rider.velocity > 0 ? rider.velocity * 3.6 : null;

    stats.deviceLabel = sample.label;
    stats.sampleCount += 1;
    stats.lastSampleAt = sample.at;

    if (speedKph != null && Number.isFinite(speedKph)) {
      stats.topSpeedKph = Math.max(stats.topSpeedKph, speedKph);
      stats.speedTotalKph += speedKph;
      stats.speedSamples += 1;
    }

    if (metricIsFromRace(sample, sample.cadenceAt, raceStartedAt) && sample.cadence != null && Number.isFinite(sample.cadence)) {
      stats.topCadence = Math.max(stats.topCadence, sample.cadence);
      stats.cadenceTotal += sample.cadence;
      stats.cadenceSamples += 1;
    }

    if (metricIsFromRace(sample, sample.wattsAt, raceStartedAt) && Number.isFinite(sample.watts)) {
      stats.topWatts = Math.max(stats.topWatts, sample.watts);
      stats.wattsTotal += sample.watts;
      stats.wattsSamples += 1;
    }

    statsByPlayer.set(player.id, stats);
  });
}

function buildRaceSummary(
  players: PlayerSlot[],
  riders: RiderState[],
  statsByPlayer: Map<PlayerSlot['id'], RaceMetricAccumulator>,
  raceLengthMeters: number,
): RaceSummaryEntry[] {
  return riders
    .map((rider) => {
      const player = players.find((slot) => slot.id === rider.playerId);
      const stats = statsByPlayer.get(rider.playerId);

      return {
        playerId: rider.playerId,
        riderName: player?.name ?? `Rider ${rider.playerId}`,
        colorName: player?.colorName ?? 'lime',
        accent: player?.accent ?? '#84e047',
        deviceLabel: stats?.deviceLabel ?? 'No device',
        rank: rider.rank,
        finishTimeMs: rider.finishedAt,
        thirtyFootTimeMs: rider.thirtyFootTimeMs,
        distanceMeters: Math.min(raceLengthMeters, rider.distance),
        sampleCount: stats?.sampleCount ?? 0,
        topSpeedKph: stats && stats.speedSamples > 0 ? stats.topSpeedKph : null,
        averageSpeedKph: stats ? average(stats.speedTotalKph, stats.speedSamples) : null,
        topCadence: stats && stats.cadenceSamples > 0 ? stats.topCadence : null,
        averageCadence: stats ? average(stats.cadenceTotal, stats.cadenceSamples) : null,
        topWatts: stats && stats.wattsSamples > 0 ? stats.topWatts : null,
        averageWatts: stats ? average(stats.wattsTotal, stats.wattsSamples) : null,
      };
    })
    .sort((a, b) => a.rank - b.rank);
}

export function useRaceEngine(
  players: PlayerSlot[],
  samplesByDevice: Map<number, BikeSample>,
  raceLengthMeters: number,
  branchChoicesByPlayer: BranchChoicesByPlayer = {},
  splitDecisionPoints: SplitRouteDecisionPoint[] = [],
  trackZones: TrackZone[] = [],
) {
  const [raceState, setRaceState] = useState<RaceState>('ready');
  const [riders, setRiders] = useState<RiderState[]>(() => createInitialRiders(players, branchChoicesByPlayer));
  const [raceSummary, setRaceSummary] = useState<RaceSummaryEntry[]>([]);
  const [finishWindowEndsAt, setFinishWindowEndsAt] = useState<number | null>(null);
  const raceStartedAtRef = useRef(0);
  const inputAllowedAtRef = useRef(0);
  const finishWindowEndsAtRef = useRef<number | null>(null);
  const racePlayersRef = useRef(players);
  const raceStatsRef = useRef<Map<PlayerSlot['id'], RaceMetricAccumulator>>(new Map());
  const frameRef = useRef(0);
  const lastFrameRef = useRef(0);
  const playersRef = useRef(players);
  const samplesRef = useRef(samplesByDevice);
  const configuredRaceLengthRef = useRef(raceLengthMeters);
  const raceLengthRef = useRef(raceLengthMeters);
  const branchChoicesRef = useRef(branchChoicesByPlayer);
  const splitDecisionPointsRef = useRef(splitDecisionPoints);
  const trackZonesRef = useRef(trackZones);

  // Keep the animation loop on the newest render values immediately. Waiting for
  // effects adds an avoidable frame between a live Wattbike packet and rider motion.
  playersRef.current = players;
  samplesRef.current = samplesByDevice;
  configuredRaceLengthRef.current = raceLengthMeters;
  if (raceStartedAtRef.current === 0) {
    raceLengthRef.current = raceLengthMeters;
  }
  branchChoicesRef.current = branchChoicesByPlayer;
  splitDecisionPointsRef.current = splitDecisionPoints;
  trackZonesRef.current = trackZones;

  const resetRace = useCallback(() => {
    window.cancelAnimationFrame(frameRef.current);
    raceStartedAtRef.current = 0;
    raceLengthRef.current = configuredRaceLengthRef.current;
    inputAllowedAtRef.current = 0;
    finishWindowEndsAtRef.current = null;
    raceStatsRef.current = new Map();
    lastFrameRef.current = 0;
    setRaceState('ready');
    setRaceSummary([]);
    setFinishWindowEndsAt(null);
    setRiders(createInitialRiders(playersRef.current, branchChoicesRef.current));
  }, []);

  const startRace = useCallback((startedAt = Date.now(), inputAllowedAt = startedAt) => {
    const racePlayers = playersRef.current;
    racePlayersRef.current = racePlayers;
    finishWindowEndsAtRef.current = null;
    raceStatsRef.current = new Map();
    setRaceSummary([]);
    setFinishWindowEndsAt(null);
    setRiders(createInitialRiders(racePlayers, branchChoicesRef.current));
    // Freeze the configured distance at the gate. View changes and unrelated
    // dashboard rerenders must never shorten or lengthen an active race.
    raceLengthRef.current = configuredRaceLengthRef.current;
    raceStartedAtRef.current = startedAt;
    inputAllowedAtRef.current = inputAllowedAt;
    lastFrameRef.current = performance.now();
    setRaceState('racing');
  }, []);

  useEffect(() => {
    if (raceState !== 'racing') {
      return undefined;
    }

    const tick = (now: number) => {
      const last = lastFrameRef.current || now;
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      lastFrameRef.current = now;

      setRiders((current) => {
        const frameNow = Date.now();
        const next = stepRiders(
          current,
          playersRef.current,
          samplesRef.current,
          dt,
          raceStartedAtRef.current,
          raceLengthRef.current,
          branchChoicesRef.current,
          splitDecisionPointsRef.current,
          trackZonesRef.current,
          frameNow,
          inputAllowedAtRef.current,
        );
        const finishDeadline = nextRaceFinishDeadline(finishWindowEndsAtRef.current, next, frameNow);
        if (finishDeadline !== finishWindowEndsAtRef.current) {
          finishWindowEndsAtRef.current = finishDeadline;
          setFinishWindowEndsAt(finishDeadline);
        }

        if (finishDeadline != null && frameNow >= finishDeadline) {
          setRaceSummary(buildRaceSummary(
            racePlayersRef.current,
            next,
            raceStatsRef.current,
            raceLengthRef.current,
          ));
          setRaceState('finished');
        }
        return next;
      });

      frameRef.current = window.requestAnimationFrame(tick);
    };

    frameRef.current = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameRef.current);
  }, [raceState]);

  useEffect(() => {
    if (raceState === 'ready') {
      setRiders(createInitialRiders(players, branchChoicesByPlayer));
    }
  }, [branchChoicesByPlayer, players, raceState]);

  useEffect(() => {
    if (raceState !== 'racing' || raceStartedAtRef.current === 0) {
      return;
    }

    recordRaceSamples(
      racePlayersRef.current,
      riders,
      samplesByDevice,
      raceStatsRef.current,
      raceStartedAtRef.current,
    );
  }, [raceState, riders, samplesByDevice]);

  useEffect(() => {
    if (raceState !== 'finished' || raceSummary.length > 0) {
      return;
    }

    setRaceSummary(buildRaceSummary(
      racePlayersRef.current,
      riders,
      raceStatsRef.current,
      raceLengthRef.current,
    ));
  }, [raceState, raceSummary.length, riders]);

  return {
    raceState,
    riders,
    raceSummary,
    finishWindowEndsAt,
    startRace,
    resetRace,
  };
}
