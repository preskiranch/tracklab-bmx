import type { CSSProperties } from 'react';
import { Bluetooth, Link, Link2Off, RadioTower, Signal, Usb } from 'lucide-react';
import type { BikeSample, PlayerSlot } from '../types';

type PairingRailProps = {
  players: PlayerSlot[];
  samplesByDevice: Map<number, BikeSample>;
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

function signalLabel(sample: BikeSample | undefined) {
  if (!sample || Date.now() - sample.at > 2400) {
    return 'Waiting';
  }

  return `${Math.round(sample.signal * 100)}%`;
}

export function PairingRail({
  players,
  samplesByDevice,
  onAssign,
  onAutoAssign,
  onRename,
  onBluetoothConnect,
  bluetoothSupported = false,
  bluetoothStatus,
  bluetoothDeviceCount = 0,
  title = 'Bike Pairing',
  subtitle,
  emptyMessage = 'Pedal a Wattbike for a few seconds so the ANT+ bridge can detect it.',
  deviceLabel = 'ANT device',
  readOnly = false,
  maxPlayers = 8,
}: PairingRailProps) {
  const detectedDevices = [...samplesByDevice.values()].sort((a, b) => a.deviceId - b.deviceId);

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
          const online = Boolean(sample && Date.now() - sample.at < 2400);

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
                      value={player.name}
                      onChange={(event) => onRename(player.id, event.target.value)}
                      aria-label={`Name for player ${player.id}`}
                    />
                  )}
                  <p>{player.deviceId ? `Device ${player.deviceId}` : 'No bike assigned'}</p>
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
                  {sample ? `${sample.label} / ${sample.deviceId}` : 'Waiting for demo feed'}
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
                      {device.label} / {device.deviceId}
                    </option>
                  ))}
                </select>
              )}

              <div className="pair-stats">
                <span>
                  <Signal size={14} />
                  {signalLabel(sample)}
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
