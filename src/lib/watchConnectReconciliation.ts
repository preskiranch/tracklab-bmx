import type { NativeWatchConnectState } from './nativeHeartRate';
import type { WatchConnectConnection } from './watchConnect';

export type WatchConnectReconciliation =
  | 'waiting-for-account'
  | 'idle'
  | 'matched'
  | 'foreign-native-session'
  | 'native-start-required';

export function reconcileWatchConnectAccount({
  accountId,
  hydratedAccountId,
  connections,
  native,
  now = Date.now(),
}: {
  accountId: string | null;
  hydratedAccountId: string | null;
  connections: readonly WatchConnectConnection[];
  native: NativeWatchConnectState | null;
  now?: number;
}): WatchConnectReconciliation {
  if (!accountId || hydratedAccountId !== accountId) return 'waiting-for-account';
  const activeConnections = connections.filter((connection) => (
    (connection.state === 'connecting' || connection.state === 'connected')
    && connection.connectedUntil > now
  ));
  if (!native?.connectionId || !['connecting', 'connected', 'syncing', 'disconnecting'].includes(native.state)) {
    return activeConnections.length > 0 ? 'native-start-required' : 'idle';
  }
  const exactHistorical = connections.some((connection) => (
    connection.id === native.connectionId
    && connection.scope === native.scope
    && connection.connectedUntil === native.connectedUntil
    && `watch-connect:${connection.id}` === native.sessionId
  ));
  if ((native.state === 'syncing' || native.state === 'disconnecting') && exactHistorical) {
    return 'matched';
  }
  const exact = activeConnections.some((connection) => (
    connection.id === native.connectionId
    && connection.scope === native.scope
    && connection.connectedUntil === native.connectedUntil
    && `watch-connect:${connection.id}` === native.sessionId
  ));
  return exact ? 'matched' : 'foreign-native-session';
}
