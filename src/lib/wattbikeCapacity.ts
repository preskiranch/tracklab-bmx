export type WattbikeCapacityState = Readonly<{
  type: 'wattbike-capacity';
  requestedConnections: number;
  grantedConnections: number;
  connectionLimit: number;
  accountConnectionsInUse: number;
  action: 'disconnect-excess' | 'none';
  reason: string;
}>;

const maximumLocalWattbikeConnections = 4;
const maximumReportedAccountConnections = 64;
/**
 * The server normally renews a connection lease every 15 seconds or sooner.
 * A browser grant deliberately expires before the 45-second server lease so a
 * half-open/offline tab cannot keep physical Bluetooth access indefinitely.
 */
export const wattbikeCapacityClientGrantTtlMs = 30_000;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedInteger(value: unknown, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= maximum ? parsed : null;
}

export function normalizeWattbikeCapacityMessage(value: unknown): WattbikeCapacityState | null {
  const candidate = record(value);
  if (!candidate || candidate.type !== 'wattbike-capacity') return null;
  const requestedConnections = boundedInteger(candidate.requestedConnections, maximumLocalWattbikeConnections);
  const grantedConnections = boundedInteger(candidate.grantedConnections, maximumLocalWattbikeConnections);
  const connectionLimit = boundedInteger(candidate.connectionLimit, maximumReportedAccountConnections);
  const accountConnectionsInUse = boundedInteger(
    candidate.accountConnectionsInUse,
    maximumReportedAccountConnections,
  );
  const action = candidate.action === 'disconnect-excess' || candidate.action === 'none'
    ? candidate.action
    : null;
  const reason = typeof candidate.reason === 'string' ? candidate.reason.trim().slice(0, 160) : '';
  if (
    requestedConnections == null
    || grantedConnections == null
    || connectionLimit == null
    || accountConnectionsInUse == null
    || action == null
    || !reason
    || grantedConnections > requestedConnections
    || accountConnectionsInUse < grantedConnections
    || (action === 'disconnect-excess' && requestedConnections <= grantedConnections)
    || (action === 'none' && requestedConnections > grantedConnections)
  ) return null;
  return {
    type: 'wattbike-capacity',
    requestedConnections,
    grantedConnections,
    connectionLimit,
    accountConnectionsInUse,
    action,
    reason,
  };
}

/**
 * A successfully authenticated Club Tablet socket represents the tablet's
 * already-reserved, single server lease. The server closes that socket when
 * the athlete session or its lease is revoked; client heartbeat expiry is an
 * additional fail-closed guard for half-open network connections.
 */
export function clubTabletWattbikeCapacityGrant(): WattbikeCapacityState {
  return {
    type: 'wattbike-capacity',
    requestedConnections: 1,
    grantedConnections: 1,
    connectionLimit: 1,
    accountConnectionsInUse: 1,
    action: 'none',
    reason: 'club-tablet-session-authenticated',
  };
}

export function effectiveWattbikeConnectionLimit(
  localConnectionLimit: number,
  capacity: WattbikeCapacityState | null,
) {
  const normalizedLocalLimit = Math.max(
    0,
    Math.min(maximumLocalWattbikeConnections, Math.round(Number(localConnectionLimit) || 0)),
  );
  // Paid/authenticated physical Wattbike access is server-authoritative. A
  // locally cached membership can render the UI, but it cannot open or retain
  // GATT without a current capacity grant.
  if (!capacity) return 0;
  if (capacity.action === 'disconnect-excess') {
    return Math.min(normalizedLocalLimit, capacity.grantedConnections);
  }
  const unallocatedAccountConnections = Math.max(
    0,
    capacity.connectionLimit - capacity.accountConnectionsInUse,
  );
  return Math.min(
    normalizedLocalLimit,
    capacity.grantedConnections + unallocatedAccountConnections,
  );
}

export function wattbikeCapacityStatusMessage(capacity: WattbikeCapacityState | null) {
  if (!capacity) return null;
  const available = capacity.connectionLimit - capacity.accountConnectionsInUse;
  if (capacity.action === 'disconnect-excess') {
    if (capacity.grantedConnections === 0) {
      if (capacity.connectionLimit === 0) {
        return 'Wattbike connections are not currently included for this account. Connected bikes were disconnected.';
      }
      return `No Wattbike connection is available on this device. ${capacity.accountConnectionsInUse} of ${capacity.connectionLimit} account connections are in use on other TrackLab devices.`;
    }
    return `This device was granted ${capacity.grantedConnections} of ${capacity.requestedConnections} requested Wattbike connections. Excess bikes were disconnected.`;
  }
  if (capacity.requestedConnections > 0) {
    return `${capacity.grantedConnections} Wattbike ${capacity.grantedConnections === 1 ? 'connection' : 'connections'} granted on this device · ${Math.max(0, available)} account ${Math.max(0, available) === 1 ? 'connection' : 'connections'} still available.`;
  }
  return `Up to ${capacity.connectionLimit} Wattbike ${capacity.connectionLimit === 1 ? 'connection is' : 'connections are'} available across this account.`;
}
