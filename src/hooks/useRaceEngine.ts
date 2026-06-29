import { useCallback, useEffect, useRef, useState } from 'react';
import { createInitialRiders, stepRiders } from '../game/physics';
import type { BikeSample, PlayerSlot, RaceState, RiderState } from '../types';

export function useRaceEngine(
  players: PlayerSlot[],
  samplesByDevice: Map<number, BikeSample>,
  raceLengthMeters: number,
) {
  const [raceState, setRaceState] = useState<RaceState>('ready');
  const [riders, setRiders] = useState<RiderState[]>(() => createInitialRiders(players));
  const raceStartedAtRef = useRef(0);
  const frameRef = useRef(0);
  const lastFrameRef = useRef(0);
  const playersRef = useRef(players);
  const samplesRef = useRef(samplesByDevice);
  const raceLengthRef = useRef(raceLengthMeters);

  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  useEffect(() => {
    samplesRef.current = samplesByDevice;
  }, [samplesByDevice]);

  useEffect(() => {
    raceLengthRef.current = raceLengthMeters;
  }, [raceLengthMeters]);

  const resetRace = useCallback(() => {
    window.cancelAnimationFrame(frameRef.current);
    raceStartedAtRef.current = 0;
    lastFrameRef.current = 0;
    setRaceState('ready');
    setRiders(createInitialRiders(playersRef.current));
  }, []);

  const startRace = useCallback(() => {
    setRiders(createInitialRiders(playersRef.current));
    raceStartedAtRef.current = Date.now();
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
        const next = stepRiders(
          current,
          playersRef.current,
          samplesRef.current,
          dt,
          raceStartedAtRef.current,
          raceLengthRef.current,
        );
        if (next.every((rider) => rider.finishedAt !== null)) {
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
      setRiders(createInitialRiders(players));
    }
  }, [players, raceState]);

  return {
    raceState,
    riders,
    startRace,
    resetRace,
  };
}
