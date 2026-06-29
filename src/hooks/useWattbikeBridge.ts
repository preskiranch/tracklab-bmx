import { useEffect, useMemo, useRef, useState } from 'react';
import type { BikeSample, BridgeMode, BridgeStatusMessage } from '../types';

type ConnectionState = 'connecting' | 'open' | 'closed' | 'error';

type BridgeSnapshot = {
  connection: ConnectionState;
  mode: BridgeMode | 'unknown';
  status: string;
  error: string | null;
  samplesByDevice: Map<number, BikeSample>;
};

const bridgeUrl = import.meta.env.VITE_WATTBIKE_BRIDGE_URL?.trim() || 'ws://127.0.0.1:8787';

export function useWattbikeBridge(): BridgeSnapshot {
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [mode, setMode] = useState<BridgeSnapshot['mode']>('unknown');
  const [status, setStatus] = useState('Connecting to local Wattbike bridge.');
  const [error, setError] = useState<string | null>(null);
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
          setStatus(statusMessage.message);
        }

        if (parsed.type === 'bridge-error') {
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

  return useMemo(() => ({
    connection,
    mode,
    status,
    error,
    samplesByDevice,
  }), [connection, error, mode, samplesByDevice, status]);
}
