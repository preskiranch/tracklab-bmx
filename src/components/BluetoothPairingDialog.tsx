import { useEffect } from 'react';
import { Bluetooth, Check, RefreshCw, X } from 'lucide-react';
import type { ConnectedBikeDevice } from '../types';
import './BluetoothPairingDialog.css';

type BluetoothPairingDialogProps = {
  authorizedCount: number;
  busy: boolean;
  connectedDevices: ConnectedBikeDevice[];
  liveCount: number;
  maxPlayers: number;
  onClose: () => void;
  onPairBike: () => Promise<boolean>;
  onReconnectSaved: () => Promise<number>;
  open: boolean;
  status: string;
};

export function BluetoothPairingDialog({
  authorizedCount,
  busy,
  connectedDevices,
  liveCount,
  maxPlayers,
  onClose,
  onPairBike,
  onReconnectSaved,
  open,
  status,
}: BluetoothPairingDialogProps) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [busy, onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="bluetooth-pairing-backdrop" role="presentation">
      <section
        aria-label="Connect Wattbikes"
        aria-modal="true"
        className="bluetooth-pairing-dialog"
        role="dialog"
      >
        <header>
          <div>
            <span className="eyebrow">Direct Bluetooth</span>
            <h2>Connect up to four Wattbikes</h2>
          </div>
          <button
            aria-label="Close Wattbike pairing"
            className="square-button"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            <X size={19} />
          </button>
        </header>

        <p className="bluetooth-pairing-explainer">
          Previously approved Wattbikes reconnect together automatically. For a new bike,
          Chrome or Edge approves one monitor at a time; this TrackLab window stays open
          until all four are added.
        </p>

        <div className="bluetooth-pairing-progress" aria-live="polite">
          <Bluetooth size={18} />
          <strong>{liveCount} of {maxPlayers} live</strong>
          <span>{status}</span>
        </div>

        <div className="bluetooth-pairing-slots">
          {Array.from({ length: maxPlayers }, (_, index) => {
            const device = connectedDevices[index];
            const saved = !device && index < authorizedCount;
            return (
              <article className={device ? 'connected' : saved ? 'saved' : ''} key={index}>
                <span className="bluetooth-slot-number">{index + 1}</span>
                <div>
                  <strong>{device?.label ?? (saved ? 'Saved Wattbike' : 'Open bike slot')}</strong>
                  <small>{device ? 'Connected and ready' : saved ? 'Approved — restoring automatically' : 'Not paired yet'}</small>
                </div>
                {device && <Check aria-label="Connected" size={20} />}
              </article>
            );
          })}
        </div>

        <div className="bluetooth-pairing-actions">
          <button
            className="secondary-button"
            disabled={busy || authorizedCount === 0}
            onClick={() => void onReconnectSaved()}
            type="button"
          >
            <RefreshCw size={17} />
            Reconnect saved bikes
          </button>
          <button
            className="primary-button"
            disabled={busy || connectedDevices.length >= maxPlayers}
            onClick={() => void onPairBike()}
            type="button"
          >
            <Bluetooth size={17} />
            {busy ? 'Connecting…' : connectedDevices.length > 0 ? 'Choose another Wattbike' : 'Choose first Wattbike'}
          </button>
        </div>

        <button className="bluetooth-pairing-done" disabled={busy} onClick={onClose} type="button">
          Done
        </button>
      </section>
    </div>
  );
}
