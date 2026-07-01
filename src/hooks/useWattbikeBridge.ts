import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BikeControlAction,
  BikeControlCommand,
  BikeControlResultMessage,
  BikeSample,
  BridgeMode,
  BridgeSourceState,
  BridgeStatusMessage,
} from '../types';

type ConnectionState = 'connecting' | 'open' | 'closed' | 'error';

type BridgeSnapshot = {
  connection: ConnectionState;
  mode: BridgeMode | 'unknown';
  sourceState: BridgeSourceState | 'unknown';
  status: string;
  error: string | null;
  samplesByDevice: Map<number, BikeSample>;
  controlStatus: string | null;
  startLocalBridge: () => Promise<boolean>;
  stopLocalBridge: () => Promise<boolean>;
  sendControlCommand: (action: BikeControlAction) => boolean;
};

const bridgeUrl = import.meta.env.VITE_WATTBIKE_BRIDGE_URL?.trim() || 'ws://127.0.0.1:8787';

function bridgeHttpUrl(path: string) {
  const url = new URL(bridgeUrl);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = path;
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function useWattbikeBridge(): BridgeSnapshot {
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [mode, setMode] = useState<BridgeSnapshot['mode']>('unknown');
  const [sourceState, setSourceState] = useState<BridgeSnapshot['sourceState']>('unknown');
  const [status, setStatus] = useState('Connecting to local Wattbike bridge.');
  const [error, setError] = useState<string | null>(null);
  const [controlStatus, setControlStatus] = useState<string | null>(null);
  const [samplesByDevice, setSamplesByDevice] = useState<Map<number, BikeSample>>(new Map());
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer = 0;

    const connect = () => {
      if (cancelled) {
        return;
      }

      setConnection('connecting');
      const socket = new WebSocket(bridgeUrl);
      socketRef.current = socket;

      socket.addEventListener('open', () => {
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
        }

        if (parsed.type === 'bridge-error') {
          setSourceState(parsed.sourceState ?? 'error');
          setError(parsed.message);
          setStatus(parsed.message);
        }

        if (parsed.type === 'bike-sample') {
          const sample = parsed as BikeSample;
          setMode(sample.source);
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
        socketRef.current = null;
        if (!cancelled) {
          reconnectTimer = window.setTimeout(connect, 1200);
        }
      });

      socket.addEventListener('error', () => {
        setConnection('error');
        setSourceState('unknown');
        setError(`Could not reach the Wattbike bridge on ${bridgeUrl}.`);
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
    try {
      const response = await fetch(bridgeHttpUrl(`/api/bridge/${action}`), { method: 'POST' });
      const payload = await response.json() as Partial<BridgeStatusMessage> & { message?: string };
      if (payload.mode) {
        setMode(payload.mode);
      }
      if (payload.sourceState) {
        setSourceState(payload.sourceState);
      }
      if (payload.message) {
        setStatus(payload.message);
      }
      if (!response.ok) {
        setError(payload.message ?? `Local bridge ${action} failed.`);
        return false;
      }
      setError(null);
      return true;
    } catch (commandError) {
      const message = commandError instanceof Error ? commandError.message : String(commandError);
      setConnection('error');
      setError(`Could not ${action} the local bridge on ${bridgeHttpUrl(`/api/bridge/${action}`)}. ${message}`);
      return false;
    }
  }, []);

  const startLocalBridge = useCallback(() => sendBridgeApiCommand('start'), [sendBridgeApiCommand]);
  const stopLocalBridge = useCallback(() => sendBridgeApiCommand('stop'), [sendBridgeApiCommand]);

  const sendControlCommand = useCallback((action: BikeControlAction) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setControlStatus('Wattbike bridge is not connected, so bike control command was not sent.');
      return false;
    }

    const command: BikeControlCommand = {
      type: 'bike-control',
      action,
      at: Date.now(),
    };
    socket.send(JSON.stringify(command));
    setControlStatus(`Sent ${action.replace('-', ' ')} command to Wattbike bridge.`);
    return true;
  }, []);

  return useMemo(() => ({
    connection,
    controlStatus,
    mode,
    sourceState,
    status,
    error,
    samplesByDevice,
    startLocalBridge,
    stopLocalBridge,
    sendControlCommand,
  }), [connection, controlStatus, error, mode, samplesByDevice, sendControlCommand, sourceState, startLocalBridge, status, stopLocalBridge]);
}
