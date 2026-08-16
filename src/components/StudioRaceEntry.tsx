import { type CSSProperties, type FormEvent, useMemo, useState } from 'react';
import { Trash2, UserPlus, Users } from 'lucide-react';
import { customBikeDisplayName, wattbikeMonitorLastThree } from '../lib/bikeProfileIdentity';
import { normalizeStudioRiderName } from '../lib/studioRiders';
import type { PlayerSlot, StudioRider, StudioRiderAssignments } from '../types';
import { RiderAvatar, RiderPhotoEditor } from './RiderAvatar';

type StudioRaceEntryProps = {
  players: PlayerSlot[];
  enteredDeviceIds: number[];
  riders: StudioRider[];
  assignments: StudioRiderAssignments;
  accountRiderId?: string;
  canEdit: boolean;
  canManageRiders: boolean;
  onToggleEntry: (deviceId: number) => void;
  onEnterAll: () => void;
  onClearEntries: () => void;
  onAssignRider: (deviceId: number, riderId: string | null) => void;
  onAddRider: (name: string) => boolean;
  onRenameRider: (riderId: string, name: string) => void;
  onPhotoChange: (riderId: string, photoUrl: string | undefined) => void;
  onRemoveRider: (riderId: string) => void;
};

export function StudioRaceEntry({
  players,
  enteredDeviceIds,
  riders,
  assignments,
  accountRiderId,
  canEdit,
  canManageRiders,
  onToggleEntry,
  onEnterAll,
  onClearEntries,
  onAssignRider,
  onAddRider,
  onRenameRider,
  onPhotoChange,
  onRemoveRider,
}: StudioRaceEntryProps) {
  const [newRiderName, setNewRiderName] = useState('');
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const managedRiders = useMemo(
    () => riders.filter((rider) => rider.id !== accountRiderId),
    [accountRiderId, riders],
  );
  const [managerOpen, setManagerOpen] = useState(managedRiders.length === 0);
  const assignedDeviceByRider = useMemo(() => {
    const next = new Map<string, number>();
    Object.entries(assignments).forEach(([deviceId, riderId]) => {
      next.set(riderId, Number(deviceId));
    });
    return next;
  }, [assignments]);
  const playerByDevice = useMemo(
    () => new Map(players.flatMap((player) => (player.deviceId == null ? [] : [[player.deviceId, player] as const]))),
    [players],
  );

  const submitNewRider = (event: FormEvent) => {
    event.preventDefault();
    const normalizedName = normalizeStudioRiderName(newRiderName);
    if (!normalizedName) {
      setFormError('Enter a first name or nickname.');
      return;
    }

    if (!onAddRider(normalizedName)) {
      setFormError('That rider could not be added.');
      return;
    }

    setNewRiderName('');
    setFormError(null);
  };

  const commitRiderName = (rider: StudioRider) => {
    const draft = nameDrafts[rider.id];
    if (draft == null) {
      return;
    }

    const normalizedName = normalizeStudioRiderName(draft);
    if (normalizedName) {
      onRenameRider(rider.id, normalizedName);
    }
    setNameDrafts((current) => {
      const next = { ...current };
      delete next[rider.id];
      return next;
    });
  };

  return (
    <div className="workflow-race-entry" aria-label="Live race entry">
      <div className="workflow-race-entry-heading">
        <span>Race Entry</span>
        <small>{enteredDeviceIds.length} entered / {players.length} connected</small>
      </div>

      {players.length > 0 ? (
        <div className="workflow-race-entry-list">
          {players.map((player) => {
            const deviceId = player.deviceId;
            const entered = deviceId != null && enteredDeviceIds.includes(deviceId);
            const monitorId = deviceId == null
              ? null
              : wattbikeMonitorLastThree(player.deviceLabel, deviceId);
            const customBikeName = customBikeDisplayName(player);
            const entryLabel = monitorId == null
              ? 'unassigned monitor'
              : `monitor ID ${monitorId}${customBikeName ? `, ${customBikeName}` : ''}`;
            const assignedRiderId = deviceId == null ? '' : assignments[deviceId] ?? '';
            const assignedRider = assignedRiderId
              ? riders.find((rider) => rider.id === assignedRiderId)
              : undefined;

            return (
              <div className={`race-entry-card ${entered ? 'entered' : ''}`} key={deviceId ?? player.id}>
                <button
                  className={`race-entry-row ${entered ? 'entered' : ''}`}
                  type="button"
                  onClick={() => {
                    if (deviceId != null) {
                      onToggleEntry(deviceId);
                    }
                  }}
                  disabled={!canEdit || deviceId == null}
                  aria-pressed={entered}
                  aria-label={`${entered ? 'Remove' : 'Enter'} ${entryLabel} ${entered ? 'from' : 'in'} live race`}
                >
                  <span
                    className="player-chip"
                    style={{ '--player-color': player.accent } as CSSProperties}
                  >
                    P{player.id}
                  </span>
                  <span className="race-entry-copy">
                    {customBikeName && <small className="race-entry-bike-name">{customBikeName}</small>}
                    <strong className="race-entry-monitor-id">
                      <span>Monitor ID</span>
                      <b>{monitorId ?? '—'}</b>
                    </strong>
                  </span>
                  <span className={`race-entry-status ${entered ? 'entered' : ''}`}>
                    {entered ? 'Entered' : 'Standby'}
                  </span>
                </button>

                <label className="race-entry-rider-select">
                  <span>Student</span>
                  <select
                    aria-label={`Student assigned to ${entryLabel}`}
                    value={assignedRiderId}
                    disabled={!canEdit || deviceId == null}
                    onChange={(event) => {
                      if (deviceId != null) {
                        onAssignRider(deviceId, event.target.value || null);
                      }
                    }}
                  >
                    <option value="">Use bike name</option>
                    {riders.map((rider) => {
                      const assignedDeviceId = assignedDeviceByRider.get(rider.id);
                      const assignedElsewhere = assignedDeviceId != null && assignedDeviceId !== deviceId;
                      const assignedPlayer = assignedDeviceId == null ? undefined : playerByDevice.get(assignedDeviceId);
                      return (
                        <option value={rider.id} disabled={assignedElsewhere} key={rider.id}>
                          {rider.name}{rider.id === accountRiderId ? ' (My profile)' : ''}{assignedElsewhere && assignedPlayer ? ` - P${assignedPlayer.id}` : ''}
                        </option>
                      );
                    })}
                  </select>
                </label>
                {assignedRider ? (
                  <div className="race-entry-rider-photo">
                    <RiderAvatar
                      name={assignedRider.name}
                      photoUrl={assignedRider.photoUrl}
                      accent={player.accent}
                    />
                    <span>Rider profile</span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="race-entry-empty">Connect a Wattbike, then assign a student before entering the race.</p>
      )}

      {players.length > 0 && (
        <div className="race-entry-actions">
          <button type="button" onClick={onEnterAll} disabled={!canEdit || players.length === 0}>
            Enter all
          </button>
          <button type="button" onClick={onClearEntries} disabled={!canEdit || enteredDeviceIds.length === 0}>
            Clear
          </button>
        </div>
      )}

      {canManageRiders && (
        <details
          className="studio-rider-manager"
          open={managerOpen}
          onToggle={(event) => setManagerOpen(event.currentTarget.open)}
        >
          <summary>
            <span><Users size={14} /> Studio riders</span>
            <b>{managedRiders.length}</b>
          </summary>
          <div className="studio-rider-manager-body">
            <form className="studio-rider-add" onSubmit={submitNewRider}>
              <label>
                <span>First name or nickname</span>
                <input
                  type="text"
                  value={newRiderName}
                  maxLength={64}
                  autoComplete="off"
                  placeholder="Add student"
                  onChange={(event) => {
                    setNewRiderName(event.target.value);
                    setFormError(null);
                  }}
                />
              </label>
              <button type="submit" title="Add studio rider" aria-label="Add studio rider">
                <UserPlus size={16} />
              </button>
            </form>
            {formError && <p className="studio-rider-error" role="alert">{formError}</p>}

            {managedRiders.length > 0 ? (
              <div className="studio-rider-list">
                {managedRiders.map((rider) => {
                  const assignedDeviceId = assignedDeviceByRider.get(rider.id);
                  const assignedPlayer = assignedDeviceId == null ? undefined : playerByDevice.get(assignedDeviceId);
                  return (
                    <div className="studio-rider-row" key={rider.id}>
                      <div className="studio-rider-row-main">
                        <label>
                          <span className="sr-only">Rider name</span>
                          <input
                            type="text"
                            value={nameDrafts[rider.id] ?? rider.name}
                            maxLength={64}
                            onChange={(event) => setNameDrafts((current) => ({
                              ...current,
                              [rider.id]: event.target.value,
                            }))}
                            onBlur={() => commitRiderName(rider)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.currentTarget.blur();
                              } else if (event.key === 'Escape') {
                                setNameDrafts((current) => {
                                  const next = { ...current };
                                  delete next[rider.id];
                                  return next;
                                });
                              }
                            }}
                          />
                        </label>
                        <small>{assignedPlayer ? `P${assignedPlayer.id}` : 'Available'}</small>
                        <button
                          type="button"
                          title={`Remove ${rider.name}`}
                          aria-label={`Remove ${rider.name} from studio riders`}
                          onClick={() => onRemoveRider(rider.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <RiderPhotoEditor
                        name={rider.name}
                        photoUrl={rider.photoUrl}
                        onPhotoChange={(photoUrl) => onPhotoChange(rider.id, photoUrl)}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="studio-rider-empty">Add students once, then choose who is riding each bike.</p>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
