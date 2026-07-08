import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BikeControlAction,
  BikeControlCommand,
  BikeControlResultMessage,
  BikeSample,
  BridgeMode,
  BridgeSourceState,
  BridgeStatusMessage,
  ConnectedBikeDevice,
} from '../types';
import { bridgeHttpUrlFromWebSocket, getBridgeWebSocketUrls } from '../lib/localBridgeUrls';

type ConnectionState = 'connecting' | 'open' | 'closed' | 'error';

type BridgeSnapshot = {
  connection: ConnectionState;
  mode: BridgeMode | 'unknown';
  sourceState: BridgeSourceState | 'unknown';
  status: string;
  error: string | null;
  devices: ConnectedBikeDevice[];
  samplesByDevice: Map<number, BikeSample>;
  controlStatus: string | null;
  startLocalBridge: () => Promise<boolean>;
  stopLocalBridge: () => Promise<boolean>;
  sendControlCommand: (action: BikeControlAction) => boolean;
};

const bridgeUrls = getBridgeWebSocketUrls();

function normalizeConnectedDevices(
  rawDevices: ConnectedBikeDevice[] | undefined,
  sourceState: BridgeSourceState | 'unknown' = 'unknown',
) {
  const devicesById = new Map<number, ConnectedBikeDevice>();

  for (const rawDevice of rawDevices ?? []) {
    const deviceId = Number(rawDevice.deviceId);
    if (!Number.isFinite(deviceId) || deviceId <= 0) {
      continue;
    }

    devicesById.set(deviceId, {
      at: Number.isFinite(rawDevice.at) ? Number(rawDevice.at) : undefined,
      connected: rawDevice.connected ?? sourceState === 'running',
      deviceId: Math.round(deviceId),
      label: String(rawDevice.label || `Wattbike ${Math.round(deviceId)}`),
      signal: Number.isFinite(rawDevice.signal) ? Number(rawDevice.signal) : undefined,
      source: rawDevice.source,
    });
  }

  return [...devicesById.values()].sort((a, b) => a.deviceId - b.deviceId);
}

function connectedDeviceFromSample(sample: BikeSample): ConnectedBikeDevice {
  return {
    at: sample.at,
    connected: true,
    deviceId: sample.deviceId,
    label: sample.label,
    signal: sample.signal,
    source: sample.source,
  };
}

export function useWattbikeBridge(): BridgeSnapshot {
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [mode, setMode] = useState<BridgeSnapshot['mode']>('unknown');
  const [sourceState, setSourceState] = useState<BridgeSnapshot['sourceState']>('unknown');
  const [status, setStatus] = useState('Connecting to TrackLab Bike Connector.');
  const [error, setError] = useState<string | null>(null);
  const [controlStatus, setControlStatus] = useState<string | null>(null);
  const [devices, setDevices] = useState<ConnectedBikeDevice[]>([]);
  const [samplesByDevice, setSamplesByDevice] = useState<Map<number, BikeSample>>(new Map());
  const [activeBridgeUrl, setActiveBridgeUrl] = useState(bridgeUrls[0]);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer = 0;

    const connect = (attemptIndex = 0) => {
      if (cancelled) {
        return;
      }

      const bridgeUrl = bridgeUrls[attemptIndex % bridgeUrls.length];
      setConnection('connecting');
      setActiveBridgeUrl(bridgeUrl);
      const socket = new WebSocket(bridgeUrl);
      socketRef.current = socket;
      let opened = false;

      socket.addEventListener('open', () => {
        opened = true;
        setActiveBridgeUrl(bridgeUrl);
        setConnection('open');
        setError(null);
      });

      socket.addEventListener('message', (event) => {
        const parsed = JSON.parse(event.data as string);

        if (parsed.type === 'bridge-status') {
          const statusMessage = parsed as BridgeStatusMessage;
          setMode(statusMessage.mode);
          setSourceState(statusMessage.sourceState ?? 'unknown');
          setStatus(statusMessage.message);
          const statusDevices = statusMessage.connectedDevices?.length
            ? statusMessage.connectedDevices
            : statusMessage.devices;
          if (statusDevices || statusMessage.sourceState === 'idle' || statusMessage.sourceState === 'stopping') {
            setDevices(normalizeConnectedDevices(statusDevices, statusMessage.sourceState ?? 'unknown'));
          }
        }

        if (parsed.type === 'bridge-error') {
          setSourceState(parsed.sourceState ?? 'error');
          setError(parsed.message);
          setStatus(parsed.message);
        }

        if (parsed.type === 'bike-sample') {
          const sample = parsed as BikeSample;
          setMode(sample.source);
          setDevices((current) => {
            const next = new Map(current.map((device) => [device.deviceId, device]));
            next.set(sample.deviceId, connectedDeviceFromSample(sample));
            return [...next.values()].sort((a, b) => a.deviceId - b.deviceId);
          });
          setSamplesByDevice((current) => {
            const next = new Map(current);
            next.set(sample.deviceId, sample);
            return next;
          });
        }

        if (parsed.type === 'bike-control-result') {
          const controlResult = parsed as BikeControlResultMessage;
          setControlStatus(controlResult.message);
        }
      });

      socket.addEventListener('close', () => {
        setConnection('closed');
        setDevices([]);
        socketRef.current = null;
        if (!cancelled) {
          const nextAttemptIndex = opened ? attemptIndex : attemptIndex + 1;
          reconnectTimer = window.setTimeout(() => connect(nextAttemptIndex), opened ? 1200 : 350);
        }
      });

      socket.addEventListener('error', () => {
        setConnection('error');
        setSourceState('unknown');
        setDevices([]);
        setError(`Could not reach TrackLab Bike Connector on ${bridgeUrls.join(' or ')}.`);
      });
    };

    connect();

    return () => {
      cancelled = true;
      window.clearTimeout(reconnectTimer);
      socketRef.current?.close();
    };
  }, []);

  const sendBridgeApiCommand = useCallback(async (action: 'start' | 'stop') => {
    const urls = [...new Set([activeBridgeUrl, ...bridgeUrls])];
    let lastMessage = '';

    for (const bridgeUrl of urls) {
      try {
        const response = await fetch(bridgeHttpUrlFromWebSocket(bridgeUrl, `/api/bridge/${action}`), { method: 'POST' });
        const payload = await response.json() as Partial<BridgeStatusMessage> & { message?: string };
        if (payload.mode) {
          setMode(payload.mode);
        }
        if (payload.sourceState) {
          setSourceState(payload.sourceState);
        }
        if (payload.message) {
          setStatus(payload.message);
          lastMessage = payload.message;
        }
        if (!response.ok) {
          setError(payload.message ?? `Advanced Connector ${action} failed.`);
          return false;
        }
        setActiveBridgeUrl(bridgeUrl);
        setError(null);
        return true;
      } catch (commandError) {
        lastMessage = commandError instanceof Error ? commandError.message : String(commandError);
      }
    }

    setConnection('error');
    setError(`Could not ${action} TrackLab Bike Connector on ${urls.join(' or ')}. ${lastMessage}`);
    return false;
  }, [activeBridgeUrl]);

  const startLocalBridge = useCallback(() => sendBridgeApiCommand('start'), [sendBridgeApiCommand]);
  const stopLocalBridge = useCallback(() => sendBridgeApiCommand('stop'), [sendBridgeApiCommand]);

  const sendControlCommand = useCallback((action: BikeControlAction) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setControlStatus('Advanced Connector is not connected, so bike control command was not sent.');
      return false;
    }

    const command: BikeControlCommand = {
      type: 'bike-control',
      action,
      at: Date.now(),
    };
    socket.send(JSON.stringify(command));
    setControlStatus(`Sent ${action.replace('-', ' ')} command to Advanced Connector.`);
    return true;
  }, []);

  return useMemo(() => ({
    connection,
    controlStatus,
    mode,
    sourceState,
    status,
      error,
      devices,
      samplesByDevice,
    startLocalBridge,
    stopLocalBridge,
    sendControlCommand,
  }), [connection, controlStatus, devices, error, mode, samplesByDevice, sendControlCommand, sourceState, startLocalBridge, status, stopLocalBridge]);
}
