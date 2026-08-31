import {
  Capacitor,
  registerPlugin,
  type PluginListenerHandle,
} from '@capacitor/core';

export const nativeClubLiveVideoStreamPluginName = 'TrackLabClubLiveVideoStream' as const;

export type ClubLiveIceServer = Readonly<{
  urls: string | string[];
  username?: string;
  credential?: string;
}>;

export type ClubLiveSessionDescription = Readonly<{
  peerId: string;
  negotiationId: string;
  type: 'offer' | 'answer';
  sdp: string;
}>;

export type ClubLiveIceCandidate = Readonly<{
  peerId: string;
  negotiationId: string;
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex: number;
}>;

export type ClubLivePeerState = Readonly<{
  peerId: string;
  negotiationId: string;
  state: 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed' | 'unknown';
  reason?: string;
}>;

export type ClubLiveStreamStats = Readonly<{
  capturedFps: number;
  peerCount: number;
}>;

type NativeClubLiveVideoStreamPlugin = {
  setActivityVisible(options: { visible: boolean }): Promise<{ visible: boolean }>;
  startCapture(): Promise<{ active: boolean; targetFps?: number }>;
  stopCapture(): Promise<{ active: boolean }>;
  createPeer(options: {
    peerId: string;
    negotiationId: string;
    iceServers?: ClubLiveIceServer[];
  }): Promise<unknown>;
  setRemoteDescription(description: ClubLiveSessionDescription): Promise<void>;
  addIceCandidate(candidate: ClubLiveIceCandidate): Promise<void>;
  closePeer(options: { peerId: string; negotiationId?: string }): Promise<void>;
  stopAll(): Promise<void>;
  addListener(
    eventName: 'iceCandidate',
    listener: (event: ClubLiveIceCandidate) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'peerState',
    listener: (event: ClubLivePeerState) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'captureState',
    listener: (event: { active: boolean; reason?: string; targetFps?: number }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'streamStats',
    listener: (event: ClubLiveStreamStats) => void,
  ): Promise<PluginListenerHandle>;
};

type CapacitorDetector = Pick<
  typeof Capacitor,
  'getPlatform' | 'isNativePlatform' | 'isPluginAvailable'
>;

const nativePlugin = registerPlugin<NativeClubLiveVideoStreamPlugin>(
  nativeClubLiveVideoStreamPluginName,
);

const peerIdPattern = /^[A-Za-z0-9:_-]{1,120}$/u;

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function normalizeNativeClubLiveOffer(value: unknown): ClubLiveSessionDescription | null {
  const candidate = record(value);
  const peerId = typeof candidate?.peerId === 'string' ? candidate.peerId.trim() : '';
  const negotiationId = typeof candidate?.negotiationId === 'string'
    ? candidate.negotiationId.trim()
    : '';
  const sdp = typeof candidate?.sdp === 'string' ? candidate.sdp : '';
  if (
    !peerIdPattern.test(peerId)
    || !peerIdPattern.test(negotiationId)
    || candidate?.type !== 'offer'
    || !sdp
    || new TextEncoder().encode(sdp).byteLength > 64 * 1_024
  ) return null;
  return { peerId, negotiationId, type: 'offer', sdp };
}

export function nativeClubLiveVideoStreamAvailable(
  detector: CapacitorDetector = Capacitor,
) {
  try {
    return detector.getPlatform() === 'ios'
      && detector.isNativePlatform()
      && detector.isPluginAvailable(nativeClubLiveVideoStreamPluginName);
  } catch {
    return false;
  }
}

export function setNativeClubLiveActivityVisible(visible: boolean) {
  return nativePlugin.setActivityVisible({ visible }).catch(() => ({ visible: false }));
}

export function startNativeClubLiveCapture() {
  return nativePlugin.startCapture();
}

export function stopNativeClubLiveCapture() {
  return nativePlugin.stopCapture().catch(() => ({ active: false }));
}

export async function createNativeClubLivePeer(
  peerId: string,
  negotiationId: string,
  iceServers: ClubLiveIceServer[] = [],
) {
  if (!peerIdPattern.test(peerId) || !peerIdPattern.test(negotiationId)) {
    throw new Error('Invalid Club Live viewer negotiation.');
  }
  const offer = normalizeNativeClubLiveOffer(await nativePlugin.createPeer({
    peerId,
    negotiationId,
    iceServers,
  }));
  if (!offer) throw new Error('The Club Live activity stream returned an invalid offer.');
  return offer;
}

export function setNativeClubLiveRemoteDescription(description: ClubLiveSessionDescription) {
  return nativePlugin.setRemoteDescription(description);
}

export function addNativeClubLiveIceCandidate(candidate: ClubLiveIceCandidate) {
  return nativePlugin.addIceCandidate(candidate);
}

export function closeNativeClubLivePeer(peerId: string, negotiationId?: string) {
  return nativePlugin.closePeer({ peerId, negotiationId }).catch(() => undefined);
}

export function stopAllNativeClubLiveVideo() {
  return nativePlugin.stopAll().catch(() => undefined);
}

export function onNativeClubLiveIceCandidate(
  listener: (event: ClubLiveIceCandidate) => void,
) {
  return nativePlugin.addListener('iceCandidate', listener);
}

export function onNativeClubLivePeerState(
  listener: (event: ClubLivePeerState) => void,
) {
  return nativePlugin.addListener('peerState', listener);
}

export function onNativeClubLiveStreamStats(
  listener: (event: ClubLiveStreamStats) => void,
) {
  return nativePlugin.addListener('streamStats', listener);
}
