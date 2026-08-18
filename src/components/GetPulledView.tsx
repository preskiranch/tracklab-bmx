import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Gauge, Minimize2, Play, RotateCcw, TimerReset, Zap } from 'lucide-react';
import {
  addGetPulledSample,
  createGetPulledAccumulator,
  getPulledCountdownSeconds,
  getPulledDemoMetrics,
  getPulledAirSettings,
  getPulledMetrics,
  getPulledPresetSeconds,
  getPulledResultFromAccumulator,
  getPulledResultHoldMs,
  getPulledTakeoffSignal,
  normalizeGetPulledSeconds,
  normalizeGetPulledAirSetting,
  type GetPulledAccumulator,
  type GetPulledLiveState,
  type GetPulledPhase,
  type GetPulledResult,
} from '../lib/getPulled';
import { formatSpeedFromKph, speedUnitLabel } from '../units';
import type { BikeSample, PlayerSlot, SpeedUnit } from '../types';
import { playStartGateTone, primeAudioCues } from '../lib/audioCues';
import {
  primeBikeRaceAudio,
  stopBikeRaceAudio,
  updateGetPulledBikeAudio,
} from '../lib/bikeRaceAudio';
import { PullSledScene } from './PullSledScene';
import './GetPulledView.css';

type GetPulledViewProps = {
  demoMode: boolean;
  players: PlayerSlot[];
  samplesByDevice: Map<number, BikeSample>;
  speedUnit: SpeedUnit;
  fullscreen?: boolean;
  onComplete: (result: GetPulledResult) => void;
  onFullscreenChange?: (enabled: boolean) => void;
  onLiveStateChange: (state: GetPulledLiveState | null) => void;
};

function secondsLabel(seconds: number) {
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

function phaseLabel(phase: GetPulledPhase) {
  if (phase === 'countdown') return 'Get ready';
  if (phase === 'armed') return 'Ready · pedal to start';
  if (phase === 'active') return 'Pulling now';
  if (phase === 'results') return 'Pull complete';
  return 'Choose athlete and time';
}

export function GetPulledView({
  demoMode,
  players,
  samplesByDevice,
  speedUnit,
  fullscreen = false,
  onComplete,
  onFullscreenChange,
  onLiveStateChange,
}: GetPulledViewProps) {
  const connectedPlayers = useMemo(() => players.filter((player) => player.deviceId != null), [players]);
  const [selectedPlayerId, setSelectedPlayerId] = useState<PlayerSlot['id'] | null>(connectedPlayers[0]?.id ?? null);
  const [durationSeconds, setDurationSeconds] = useState<number>(3);
  const [airSetting, setAirSetting] = useState(1);
  const [customSeconds, setCustomSeconds] = useState('10');
  const [customSelected, setCustomSelected] = useState(false);
  const [phase, setPhase] = useState<GetPulledPhase>('setup');
  const [countdown, setCountdown] = useState(getPulledCountdownSeconds);
  const [now, setNow] = useState(Date.now());
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [result, setResult] = useState<GetPulledResult | null>(null);
  const accumulatorRef = useRef<GetPulledAccumulator>(createGetPulledAccumulator());
  const phaseRef = useRef<GetPulledPhase>('setup');
  const armedAtRef = useRef<number | null>(null);
  const completedRef = useRef(false);
  const lastCountdownToneRef = useRef<number | null>(null);
  const selectedPlayer = connectedPlayers.find((player) => player.id === selectedPlayerId) ?? null;
  const sample = selectedPlayer?.deviceId == null ? undefined : samplesByDevice.get(selectedPlayer.deviceId);
  const metrics = useMemo(() => {
    if (demoMode && phase === 'active' && startedAt != null) {
      return getPulledDemoMetrics(now - startedAt, airSetting);
    }
    return getPulledMetrics(sample, now);
  }, [airSetting, demoMode, now, phase, sample, startedAt]);
  const elapsedMs = phase === 'active' && startedAt != null
    ? Math.min(durationSeconds * 1_000, Math.max(0, now - startedAt))
    : result ? result.durationSeconds * 1_000 : 0;
  const progress = durationSeconds > 0 ? Math.min(1, elapsedMs / (durationSeconds * 1_000)) : 0;

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    if (selectedPlayerId != null && connectedPlayers.some((player) => player.id === selectedPlayerId)) return;
    setSelectedPlayerId(connectedPlayers[0]?.id ?? null);
  }, [connectedPlayers, selectedPlayerId]);

  const reset = useCallback(() => {
    phaseRef.current = 'setup';
    completedRef.current = false;
    accumulatorRef.current = createGetPulledAccumulator();
    armedAtRef.current = null;
    setPhase('setup');
    setCountdown(getPulledCountdownSeconds);
    setStartedAt(null);
    setResult(null);
    setNow(Date.now());
    onLiveStateChange(null);
    onFullscreenChange?.(false);
    stopBikeRaceAudio();
  }, [onFullscreenChange, onLiveStateChange]);

  const primePullAudio = useCallback(() => {
    void primeAudioCues();
    void primeBikeRaceAudio();
  }, []);

  const start = useCallback(() => {
    if (!selectedPlayer || selectedPlayer.deviceId == null || phaseRef.current !== 'setup') return;
    primePullAudio();
    onFullscreenChange?.(true);
    accumulatorRef.current = createGetPulledAccumulator();
    armedAtRef.current = null;
    completedRef.current = false;
    setResult(null);
    setCountdown(getPulledCountdownSeconds);
    phaseRef.current = 'countdown';
    lastCountdownToneRef.current = getPulledCountdownSeconds;
    playStartGateTone('tick');
    setPhase('countdown');
    setNow(Date.now());
  }, [onFullscreenChange, primePullAudio, selectedPlayer]);

  useEffect(() => {
    if (phase !== 'countdown') return undefined;
    const countdownStartedAt = Date.now();
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, getPulledCountdownSeconds - Math.floor((Date.now() - countdownStartedAt) / 1_000));
      setCountdown(remaining);
      setNow(Date.now());
      if (remaining !== lastCountdownToneRef.current) {
        lastCountdownToneRef.current = remaining;
        playStartGateTone(remaining > 0 ? 'tick' : 'gate');
      }
      if (remaining <= 0) {
        window.clearInterval(timer);
        const nextArmedAt = Date.now();
        accumulatorRef.current = createGetPulledAccumulator();
        armedAtRef.current = nextArmedAt;
        phaseRef.current = 'armed';
        setStartedAt(null);
        setPhase('armed');
        setNow(nextArmedAt);
      }
    }, 80);
    return () => window.clearInterval(timer);
  }, [phase]);

  const beginPull = useCallback((takeoffAt: number, initialMetrics?: ReturnType<typeof getPulledMetrics>) => {
    if (phaseRef.current !== 'armed') return;
    const startedAtSignal = Math.max(armedAtRef.current ?? takeoffAt, takeoffAt);
    accumulatorRef.current = initialMetrics
      ? addGetPulledSample(createGetPulledAccumulator(), initialMetrics, startedAtSignal)
      : createGetPulledAccumulator();
    completedRef.current = false;
    phaseRef.current = 'active';
    setStartedAt(startedAtSignal);
    setPhase('active');
    setNow(startedAtSignal);
  }, []);

  useEffect(() => {
    if (phase !== 'armed') return undefined;
    if (demoMode) {
      beginPull(Date.now());
      return undefined;
    }
    if (!selectedPlayer || selectedPlayer.deviceId == null || armedAtRef.current == null) return undefined;
    const takeoff = getPulledTakeoffSignal(
      samplesByDevice.get(selectedPlayer.deviceId),
      armedAtRef.current,
      Date.now(),
    );
    if (takeoff) beginPull(takeoff.at, takeoff.metrics);
    return undefined;
  }, [beginPull, demoMode, phase, samplesByDevice, selectedPlayer]);

  useEffect(() => {
    if (!selectedPlayer) {
      stopBikeRaceAudio();
      return;
    }
    updateGetPulledBikeAudio(
      phase === 'active' && metrics.cadence >= 1,
      selectedPlayer.id,
      metrics.cadence,
      metrics.speedKph,
    );
  }, [metrics.cadence, metrics.speedKph, phase, selectedPlayer]);

  useEffect(() => {
    if (phase !== 'active' || startedAt == null || !selectedPlayer) return undefined;
    const timer = window.setInterval(() => {
      const sampleAt = Date.now();
      const liveMetrics = demoMode
        ? getPulledDemoMetrics(sampleAt - startedAt, airSetting)
        : getPulledMetrics(
          selectedPlayer.deviceId == null ? undefined : samplesByDevice.get(selectedPlayer.deviceId),
          sampleAt,
        );
      accumulatorRef.current = addGetPulledSample(accumulatorRef.current, liveMetrics, sampleAt);
      setNow(sampleAt);
      if (sampleAt - startedAt < durationSeconds * 1_000 || completedRef.current) return;
      completedRef.current = true;
      const endedAt = startedAt + durationSeconds * 1_000;
      const nextResult = getPulledResultFromAccumulator(
        accumulatorRef.current,
        selectedPlayer,
        startedAt,
        endedAt,
        durationSeconds,
        airSetting,
      );
      phaseRef.current = 'results';
      setResult(nextResult);
      setPhase('results');
      setNow(endedAt);
      onComplete(nextResult);
    }, 100);
    return () => window.clearInterval(timer);
  }, [airSetting, demoMode, durationSeconds, onComplete, phase, samplesByDevice, selectedPlayer, startedAt]);

  useEffect(() => {
    if (phase !== 'results') return undefined;
    const timer = window.setTimeout(reset, getPulledResultHoldMs);
    return () => window.clearTimeout(timer);
  }, [phase, reset]);

  useEffect(() => {
    if (!selectedPlayer || phase === 'setup') {
      onLiveStateChange(null);
      return;
    }
    onLiveStateChange({
      phase,
      playerId: selectedPlayer.id,
      ...(selectedPlayer.riderId ? { riderId: selectedPlayer.riderId } : {}),
      riderName: selectedPlayer.name,
      durationSeconds,
      airSetting,
      elapsedMs,
      distanceMeters: result?.distanceMeters ?? accumulatorRef.current.distanceMeters,
      metrics: result ? {
        live: false,
        watts: result.averageWatts,
        cadence: result.averageCadence,
        speedKph: result.averageSpeedKph,
      } : metrics,
      result,
    });
  }, [airSetting, durationSeconds, elapsedMs, metrics, onLiveStateChange, phase, result, selectedPlayer]);

  useEffect(() => () => {
    onLiveStateChange(null);
    onFullscreenChange?.(false);
    stopBikeRaceAudio();
  }, [onFullscreenChange, onLiveStateChange]);

  const displayed = result ? {
    watts: result.averageWatts,
    peakWatts: result.peakWatts,
    cadence: result.averageCadence,
    peakCadence: result.peakCadence,
    speedKph: result.averageSpeedKph,
  } : {
    watts: metrics.watts,
    peakWatts: accumulatorRef.current.peakWatts,
    cadence: metrics.cadence,
    peakCadence: accumulatorRef.current.peakCadence,
    speedKph: metrics.speedKph,
  };

  return (
    <main className="get-pulled-view" aria-label="Get Pulled timed Wattbike test">
      {fullscreen && phase !== 'setup' && (
        <button className="get-pulled-exit-fullscreen" type="button" onClick={() => onFullscreenChange?.(false)}>
          <Minimize2 size={18} /> Exit full screen
        </button>
      )}
      <section className="get-pulled-hero">
        <PullSledScene
          active={phase === 'active'}
          cadenceRpm={metrics.cadence}
          durationSeconds={durationSeconds}
          progress={progress}
          speedKph={metrics.speedKph}
        />
        <div className="get-pulled-overlay">
          <div className="get-pulled-timer">
            <strong>{phase === 'countdown' ? `0:${String(countdown).padStart(2, '0')}` : `${(elapsedMs / 1_000).toFixed(2)}s`}</strong>
            <small>{phase === 'countdown'
              ? 'Countdown'
              : phase === 'armed' ? 'Starts on first pedal signal' : `of ${durationSeconds}s pull`}</small>
          </div>
          <div className="get-pulled-phase">
            <strong>{selectedPlayer?.name ?? 'No athlete selected'}</strong>
            <small>{phaseLabel(phase)} · Wattbike Air {airSetting}</small>
          </div>
        </div>
        {phase === 'countdown' && <div className="get-pulled-countdown"><strong>{countdown}</strong></div>}
        {phase === 'armed' && (
          <div className="get-pulled-countdown" role="status">
            <strong style={{ width: 'auto', height: 'auto', minWidth: 190, padding: '18px 26px', borderRadius: 18, fontSize: 'clamp(34px,5vw,62px)' }}>READY</strong>
            <small style={{ marginTop: 10, padding: '7px 12px', borderRadius: 999, color: '#fff', background: 'rgba(7,12,9,.86)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '.12em' }}>Pedal to start</small>
          </div>
        )}
      </section>

      {connectedPlayers.length === 0 ? (
        <section className="get-pulled-empty">
          <h3>Connect a Wattbike first</h3>
          <p>Get Pulled starts only after a connected bike and athlete are selected.</p>
        </section>
      ) : phase === 'setup' ? (
        <section className="get-pulled-config">
          <div className="get-pulled-panel">
            <h3><TimerReset size={18} /> Pull time</h3>
            <div className="get-pulled-options">
              {getPulledPresetSeconds.map((seconds) => (
                <button
                  className={!customSelected && durationSeconds === seconds ? 'selected' : ''}
                  key={seconds}
                  type="button"
                  onClick={() => { setDurationSeconds(seconds); setCustomSelected(false); }}
                >
                  {seconds}s
                </button>
              ))}
              <button className={customSelected ? 'selected' : ''} type="button" onClick={() => {
                setDurationSeconds(normalizeGetPulledSeconds(customSeconds));
                setCustomSelected(true);
              }}>Custom</button>
            </div>
            {customSelected && (
              <div className="get-pulled-custom">
                <input
                  aria-label="Custom pull duration in seconds"
                  inputMode="numeric"
                  min={1}
                  max={300}
                  type="number"
                  value={customSeconds}
                  onChange={(event) => {
                    setCustomSeconds(event.target.value);
                    setDurationSeconds(normalizeGetPulledSeconds(event.target.value));
                  }}
                />
                <span>seconds</span>
              </div>
            )}
          </div>
          <div className="get-pulled-panel get-pulled-air-panel">
            <h3><Gauge size={18} /> Wattbike Air setting</h3>
            <p>Select the physical Wattbike Air setting used for this pull. Records are compared only within the same time and Air setting.</p>
            <div className="get-pulled-air-options" aria-label="Wattbike Air setting">
              {getPulledAirSettings.map((setting) => (
                <button
                  className={airSetting === setting ? 'selected' : ''}
                  key={setting}
                  type="button"
                  onClick={() => setAirSetting(normalizeGetPulledAirSetting(setting))}
                >
                  {setting}
                </button>
              ))}
            </div>
          </div>
          <div className="get-pulled-panel">
            <h3>Athlete</h3>
            <div className="get-pulled-riders">
              {connectedPlayers.map((player) => (
                <button
                  className={selectedPlayerId === player.id ? 'selected' : ''}
                  key={player.id}
                  type="button"
                  onClick={() => setSelectedPlayerId(player.id)}
                >
                  <span><strong>{player.name}</strong><small>P{player.id} · {player.deviceLabel ?? 'Wattbike'}</small></span>
                  <span>{selectedPlayerId === player.id ? 'Selected' : 'Choose'}</span>
                </button>
              ))}
            </div>
          </div>
          <p className="get-pulled-privacy">Watts and power results are saved privately to the selected athlete. They are visible on the athlete’s records and authorized club monitors, never public leaderboards or shared ghosts.</p>
          <div className="get-pulled-actions">
            <button className="primary" type="button" onPointerDown={primePullAudio} onClick={start}><Play size={18} /> Start {secondsLabel(durationSeconds)} pull · Air {airSetting}</button>
          </div>
        </section>
      ) : (
        <>
          <section className={`get-pulled-metrics${phase === 'results' ? ' get-pulled-results' : ''}`}>
            <div className="get-pulled-metric"><Zap size={20} /><strong>{displayed.watts}</strong><small>{result ? 'Average watts' : 'Live watts'}</small></div>
            <div className="get-pulled-metric"><Zap size={20} /><strong>{displayed.peakWatts}</strong><small>Peak watts</small></div>
            <div className="get-pulled-metric"><Activity size={20} /><strong>{displayed.cadence}</strong><small>Cadence rpm</small></div>
            <div className="get-pulled-metric"><Activity size={20} /><strong>{displayed.peakCadence}</strong><small>Peak cadence</small></div>
            <div className="get-pulled-metric"><Gauge size={20} /><strong>{formatSpeedFromKph(displayed.speedKph, speedUnit)}</strong><small>{speedUnitLabel(speedUnit)}</small></div>
          </section>
          {phase === 'results' && (
            <div className="get-pulled-actions" aria-label={`Result recorded at Wattbike Air ${airSetting}`}>
              <button className="primary" type="button" onClick={reset}><RotateCcw size={18} /> Next athlete now</button>
            </div>
          )}
        </>
      )}
      {demoMode && <p className="get-pulled-privacy">Demo pull results are for testing only and are not saved or published.</p>}
    </main>
  );
}

export default GetPulledView;
