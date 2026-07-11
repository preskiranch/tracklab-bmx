import { useEffect, useState, type CSSProperties } from 'react';
import { Bluetooth, Link, Link2Off, RadioTower, Signal, Usb } from 'lucide-react';
import type { BikeSample, ConnectedBikeDevice, PlayerSlot } from '../types';

type PairingRailProps = {
  players: PlayerSlot[];
  samplesByDevice: Map<number, BikeSample>;
  devices?: ConnectedBikeDevice[];
  onAssign: (playerId: PlayerSlot['id'], deviceId: number | null) => void;
  onAutoAssign: () => void;
  onRename?: (playerId: PlayerSlot['id'], name: string) => void;
  onBluetoothConnect?: () => void;
  bluetoothSupported?: boolean;
  bluetoothStatus?: string;
  bluetoothDeviceCount?: number;
  title?: string;
  subtitle?: string;
  emptyMessage?: string;
  deviceLabel?: string;
  readOnly?: boolean;
  maxPlayers?: number;
};

function sampleDevice(sample: BikeSample): ConnectedBikeDevice {
  return {
    at: sample.at,
    connected: true,
    deviceId: sample.deviceId,
    label: sample.label,
    signal: sample.signal,
    source: sample.source,
  };
}

function signalLabel(sample: BikeSample | undefined, device: ConnectedBikeDevice | undefined) {
  if (!sample || Date.now() - sample.at > 2400) {
    if (device?.connected) {
      return device.signal != null ? `${Math.round(device.signal * 100)}%` : 'Connected';
    }

    return 'Waiting';
  }

  return `${Math.round(sample.signal * 100)}%`;
}

function normalizeDraftName(name: string) {
  return name.trim().replace(/\s+/g, ' ').slice(0, 64);
}

export function PairingRail({
  players,
  samplesByDevice,
  devices,
  onAssign,
  onAutoAssign,
  onRename,
  onBluetoothConnect,
  bluetoothSupported = false,
  bluetoothStatus,
  bluetoothDeviceCount = 0,
  title = 'Bike Pairing',
  subtitle,
  emptyMessage = 'Pedal a Wattbike for a few seconds so the Advanced Connector can detect it.',
  deviceLabel = 'ANT device',
  readOnly = false,
  maxPlayers = 4,
}: PairingRailProps) {
  const [nameDrafts, setNameDrafts] = useState<Partial<Record<PlayerSlot['id'], string>>>({});
  const [editingPlayerId, setEditingPlayerId] = useState<PlayerSlot['id'] | null>(null);
  const detectedDevices = (devices ?? [...samplesByDevice.values()].map(sampleDevice))
    .sort((a, b) => a.deviceId - b.deviceId);
  const deviceById = new Map(detectedDevices.map((device) => [device.deviceId, device]));

  useEffect(() => {
    setNameDrafts((current) => {
      const next: Partial<Record<PlayerSlot['id'], string>> = {};
      let changed = Object.keys(current).length !== players.length;

      players.forEach((player) => {
        const currentDraft = current[player.id];
        const nextDraft = editingPlayerId === player.id && currentDraft != null
          ? currentDraft
          : player.name;

        next[player.id] = nextDraft;
        if (currentDraft !== nextDraft) {
          changed = true;
        }
      });

      return changed ? next : current;
    });
  }, [editingPlayerId, players]);

  const updateNameDraft = (playerId: PlayerSlot['id'], name: string) => {
    setNameDrafts((current) => ({ ...current, [playerId]: name }));
  };

  const commitNameDraft = (player: PlayerSlot, name: string) => {
    const safeName = normalizeDraftName(name);
    setEditingPlayerId(null);
    if (!safeName) {
      updateNameDraft(player.id, player.name);
      return;
    }

    updateNameDraft(player.id, safeName);
    onRename?.(player.id, safeName);
  };

  return (
    <aside className="pairing-rail" aria-label="Bike pairing">
      <div className="rail-heading">
        <div>
          <h2>{title}</h2>
          <p>{subtitle ?? `${players.length} connected / ${detectedDevices.length} detected / max ${maxPlayers}`}</p>
        </div>
        <div className="rail-actions">
          {onBluetoothConnect && (
            <button
              className="square-button"
              type="button"
              onClick={onBluetoothConnect}
              disabled={readOnly || !bluetoothSupported}
              aria-label="Pair Bluetooth bike"
              title={bluetoothStatus}
            >
              <Bluetooth size={18} />
            </button>
          )}
          <button
            className="square-button"
            type="button"
            onClick={onAutoAssign}
            disabled={readOnly}
            aria-label="Auto assign bikes"
          >
            <Link size={18} />
          </button>
        </div>
      </div>

      {onBluetoothConnect && (
        <div className="bluetooth-status">
          <Bluetooth size={14} />
          <span>{bluetoothStatus}</span>
          {bluetoothDeviceCount > 0 && <strong>{bluetoothDeviceCount}</strong>}
        </div>
      )}

      <div className="pairing-list">
        {players.length === 0 && (
          <div className="empty-panel">
            {emptyMessage}
          </div>
        )}

        {players.map((player) => {
          const sample = player.deviceId == null ? undefined : samplesByDevice.get(player.deviceId);
          const device = player.deviceId == null ? undefined : deviceById.get(player.deviceId);
          const online = Boolean(device?.connected || (sample && Date.now() - sample.at < 2400));

          return (
            <section className={`pair-card ${online ? 'online' : ''}`} key={player.id}>
              <div className="pair-card-header">
                <span className="player-chip" style={{ '--player-color': player.accent } as CSSProperties}>
                  P{player.id}
                </span>
                <div>
                  {readOnly || !onRename ? (
                    <h3>{player.name}</h3>
                  ) : (
                    <input
                      className="player-name-input"
                      value={nameDrafts[player.id] ?? player.name}
                      onFocus={() => {
                        setEditingPlayerId(player.id);
                        updateNameDraft(player.id, nameDrafts[player.id] ?? player.name);
                      }}
                      onChange={(event) => {
                        const nextName = event.target.value;
                        updateNameDraft(player.id, nextName);
                        const safeName = normalizeDraftName(nextName);
                        if (safeName) {
                          onRename?.(player.id, safeName);
                        }
                      }}
                      onBlur={(event) => commitNameDraft(player, event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.currentTarget.blur();
                        }
                      }}
                      aria-label={`Name for player ${player.id}`}
                    />
                  )}
                  <p>{player.deviceId ? `Monitor ID ${player.deviceId}` : 'No bike assigned'}</p>
                </div>
                {!readOnly && (
                  <button
                    className="clear-button"
                    type="button"
                    onClick={() => onAssign(player.id, null)}
                    aria-label={`Reset ${player.name} saved name`}
                    title="Reset saved name"
                  >
                    <Link2Off size={15} />
                  </button>
                )}
              </div>

              <label className="select-label" htmlFor={`player-${player.id}-device`}>
                <Usb size={14} />
                <span>{deviceLabel}</span>
              </label>
              {readOnly ? (
                <div className="device-static-value" id={`player-${player.id}-device`}>
                  {sample ? `${sample.label} / ID ${sample.deviceId}` : 'Waiting for demo feed'}
                </div>
              ) : (
                <select
                  id={`player-${player.id}-device`}
                  value={player.deviceId ?? ''}
                  onChange={(event) => onAssign(player.id, event.target.value ? Number(event.target.value) : null)}
                >
                  <option value="">Unassigned</option>
                  {detectedDevices.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label} / ID {device.deviceId}
                    </option>
                  ))}
                </select>
              )}

              <div className="pair-stats">
                <span>
                  <Signal size={14} />
                  {signalLabel(sample, device)}
                </span>
                <span>
                  <RadioTower size={14} />
                  {online ? 'Live' : 'Idle'}
                </span>
              </div>
            </section>
          );
        })}
      </div>
    </aside>
  );
}
