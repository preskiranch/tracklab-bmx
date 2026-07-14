import type {
  BikeControlAction,
  BikeControlResultMessage,
  BikeSampleMessage,
  BridgeErrorMessage,
  BridgeMessage,
  BridgeMode,
  BridgeSourceState,
  BridgeStatusMessage,
} from '../types';

const bridgeModes = new Set<BridgeMode>(['auto', 'sim', 'ant', 'demo', 'bluetooth', 'usb']);
const bridgeSourceStates = new Set<BridgeSourceState>(['idle', 'starting', 'running', 'stopping', 'error']);
const bikeControlActions = new Set<BikeControlAction>(['race-arm', 'race-start', 'race-reset']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function decodePayload(payload: unknown) {
  if (typeof payload === 'string') {
    return JSON.parse(payload) as unknown;
  }

  if (payload instanceof ArrayBuffer) {
    return JSON.parse(new TextDecoder().decode(payload)) as unknown;
  }

  if (ArrayBuffer.isView(payload)) {
    return JSON.parse(new TextDecoder().decode(payload)) as unknown;
  }

  return payload;
}

export function parseBridgeMessage(payload: unknown): BridgeMessage | null {
  let parsed: unknown;
  try {
    parsed = decodePayload(payload);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || typeof parsed.type !== 'string') {
    return null;
  }

  if (parsed.type === 'bridge-status') {
    if (
      !bridgeModes.has(parsed.mode as BridgeMode)
      || typeof parsed.message !== 'string'
      || (parsed.sourceState != null && !bridgeSourceStates.has(parsed.sourceState as BridgeSourceState))
    ) {
      return null;
    }
    return parsed as BridgeStatusMessage;
  }

  if (parsed.type === 'bridge-error') {
    return typeof parsed.message === 'string' ? parsed as BridgeErrorMessage : null;
  }

  if (parsed.type === 'bike-sample') {
    return parsed as BikeSampleMessage;
  }

  if (parsed.type === 'bike-control-result') {
    if (
      !bikeControlActions.has(parsed.action as BikeControlAction)
      || typeof parsed.ok !== 'boolean'
      || typeof parsed.message !== 'string'
    ) {
      return null;
    }
    return parsed as BikeControlResultMessage;
  }

  return null;
}
