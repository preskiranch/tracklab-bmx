import {
  addNativeClubLiveIceCandidate,
  closeNativeClubLivePeer,
  createNativeClubLivePeer,
  nativeClubLiveVideoStreamAvailable,
  onNativeClubLiveIceCandidate,
  onNativeClubLivePeerState,
  setNativeClubLiveActivityVisible,
  setNativeClubLiveRemoteDescription,
  startNativeClubLiveCapture,
  stopAllNativeClubLiveVideo,
  stopNativeClubLiveCapture,
  type ClubLiveIceCandidate,
} from './nativeClubLiveVideoStream';
import {
  clubTabletSessionHeaders,
  currentClubTabletSessionToken,
} from './clubTabletStorage';
import { isTrackLabNativeShell, trackLabWebSocketUrl } from './serviceOrigins';
import { requestWebSocketTicket } from './webSocketTicket';

export const clubLiveVideoTargetFps = 60;
export type ClubLiveVideoPublisher = Readonly<{
  id: string;
  clubId: string;
  studioRiderId: string;
  sessionId: string;
  deviceId?: string;
  activityType?: string;
  sharedViewId?: string;
  presentation?: 'shared' | 'individual';
}>;

export type ClubLiveVideoFrame = Readonly<{
  publisherId: string;
  stream: MediaStream;
  connectedAt: number;
}>;

type SignalDescription = { type: 'offer' | 'answer'; sdp: string; negotiationId: string };
type SignalCandidate = {
  type: 'candidate';
  negotiationId: string;
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
};
type ClubLiveSignal = SignalDescription | SignalCandidate;

type SocketMessage = Record<string, unknown> & { type?: unknown };

type StartPublisherOptions = Readonly<{
  sessionId: string;
  activityVisible: () => boolean;
  onState?: (state: string) => void;
}>;

type ViewerOptions = Readonly<{
  onPublishers: (publishers: ClubLiveVideoPublisher[]) => void;
  onFrame: (frame: ClubLiveVideoFrame) => void;
  onFrameRemoved: (publisherId: string) => void;
  onState?: (state: string) => void;
}>;

const ticketPattern = /^[A-Za-z0-9_-]{32,2048}$/u;
const idPattern = /^[A-Za-z0-9:_-]{1,160}$/u;
const maximumSignalSdpBytes = 64 * 1_024;
const maximumCandidateBytes = 4 * 1_024;
const maximumSignalMessageBytes = 72 * 1_024;
const defaultIceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

export function clubLivePublisherSignalErrorIsRecoverable(code: string) {
  return code === 'signal-not-authorized'
    || code === 'invalid-signal'
    || code === 'rate-limit';
}

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cleanId(value: unknown, maximum = 160) {
  if (typeof value !== 'string') return '';
  const cleaned = value.trim();
  return cleaned.length <= maximum && idPattern.test(cleaned) ? cleaned : '';
}

function optionalText(value: unknown, maximum = 240) {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.trim();
  return cleaned && cleaned.length <= maximum ? cleaned : undefined;
}

function normalizePublisher(value: unknown): ClubLiveVideoPublisher | null {
  const item = record(value);
  if (!item) return null;
  const id = cleanId(item.publisherId) || cleanId(item.id);
  const clubId = cleanId(item.clubId);
  const studioRiderId = cleanId(item.studioRiderId);
  const sessionId = cleanId(item.sessionId);
  if (!id || !clubId || !studioRiderId || !sessionId) return null;
  const deviceId = optionalText(item.deviceId, 160);
  const activityType = optionalText(item.activityType, 40);
  const sharedViewId = optionalText(item.sharedViewId, 160);
  const presentation = item.presentation === 'shared' || item.presentation === 'individual'
    ? item.presentation
    : undefined;
  return {
    id,
    clubId,
    studioRiderId,
    sessionId,
    ...(deviceId ? { deviceId } : {}),
    ...(activityType ? { activityType } : {}),
    ...(sharedViewId ? { sharedViewId } : {}),
    ...(presentation ? { presentation } : {}),
  };
}

export function normalizeClubLiveVideoPublishers(value: unknown) {
  const values = Array.isArray(value) ? value : [];
  const unique = new Map<string, ClubLiveVideoPublisher>();
  values.forEach((candidate) => {
    const publisher = normalizePublisher(candidate);
    if (publisher) unique.set(publisher.id, publisher);
  });
  return [...unique.values()].slice(0, 4);
}

function parseMessage(data: unknown): SocketMessage | null {
  if (typeof data !== 'string' || new TextEncoder().encode(data).byteLength > maximumSignalMessageBytes) {
    return null;
  }
  try {
    const parsed = JSON.parse(data);
    return record(parsed) as SocketMessage | null;
  } catch {
    return null;
  }
}

export function normalizeClubLiveVideoSignal(value: unknown): ClubLiveSignal | null {
  const item = record(value);
  if (!item) return null;
  const negotiationId = cleanId(item.negotiationId, 120);
  if (!negotiationId) return null;
  if ((item.type === 'offer' || item.type === 'answer') && typeof item.sdp === 'string') {
    if (!item.sdp || new TextEncoder().encode(item.sdp).byteLength > maximumSignalSdpBytes) return null;
    return { type: item.type, sdp: item.sdp, negotiationId };
  }
  if (item.type !== 'candidate' || typeof item.candidate !== 'string' || !item.candidate) return null;
  if (new TextEncoder().encode(item.candidate).byteLength > maximumCandidateBytes) return null;
  return {
    type: 'candidate',
    negotiationId,
    candidate: item.candidate,
    ...(typeof item.sdpMid === 'string' ? { sdpMid: item.sdpMid } : {}),
    ...(Number.isSafeInteger(item.sdpMLineIndex)
      ? { sdpMLineIndex: Number(item.sdpMLineIndex) }
      : {}),
    ...(typeof item.usernameFragment === 'string'
      ? { usernameFragment: item.usernameFragment }
      : {}),
  };
}

function streamWebSocketUrl({
  ticket = '',
  clubTabletTicket = '',
}: {
  ticket?: string;
  clubTabletTicket?: string;
}) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const fallback = isTrackLabNativeShell()
    ? trackLabWebSocketUrl('/club-live-stream')
    : `${protocol}//${window.location.host}/club-live-stream`;
  const url = new URL(fallback, window.location.href);
  if (ticket) url.searchParams.set('authTicket', ticket);
  if (clubTabletTicket) url.searchParams.set('clubTabletTicket', clubTabletTicket);
  return url.toString();
}

function sendJson(socket: WebSocket | null, message: Record<string, unknown>) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(message));
  return true;
}

async function requestClubTabletStreamTicket(signal?: AbortSignal) {
  const token = currentClubTabletSessionToken();
  if (!token) throw new Error('No active Club Tablet athlete session.');
  const response = await fetch('/api/club-tablet/club-live-stream-ticket', {
    method: 'POST',
    cache: 'no-store',
    signal,
    headers: {
      Accept: 'application/json',
      ...clubTabletSessionHeaders(token),
    },
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  const ticket = typeof payload.ticket === 'string' ? payload.ticket : '';
  if (!response.ok || !ticketPattern.test(ticket)) {
    throw new Error(typeof payload.error === 'string'
      ? payload.error
      : 'TrackLab could not authorize this tablet screen.');
  }
  return ticket;
}

/**
 * Starts a direct native iOS publisher. The server sees only small SDP/ICE
 * setup messages; video packets flow peer-to-peer over the studio network.
 */
export function startClubLiveVideoPublisher(options: StartPublisherOptions) {
  if (!nativeClubLiveVideoStreamAvailable() || !cleanId(options.sessionId)) return () => undefined;
  let disposed = false;
  let socket: WebSocket | null = null;
  let retryTimer = 0;
  let retries = 0;
  let opening = false;
  let captureStartPromise: Promise<void> | null = null;
  let captureReady = false;
  let initializationInFlight = false;
  const viewers = new Set<string>();
  const connectedViewers = new Set<string>();
  const viewerNegotiations = new Map<string, string>();
  const pendingRemoteCandidates = new Map<string, Map<string, ClubLiveIceCandidate[]>>();
  const abortController = new AbortController();
  const listenerHandles: Array<{ remove: () => Promise<void> }> = [];

  const stopPeers = async () => {
    viewers.clear();
    connectedViewers.clear();
    viewerNegotiations.clear();
    pendingRemoteCandidates.clear();
    captureReady = false;
    if (!disposed) options.onState?.('waiting-for-viewer');
    await stopAllNativeClubLiveVideo();
  };

  const reportStreamingIfReady = () => {
    if (!disposed && captureReady && connectedViewers.size > 0) {
      options.onState?.('streaming');
    }
  };

  const sendSignal = (targetId: string, signal: ClubLiveSignal) => sendJson(socket, {
    type: 'club-live-stream-signal',
    targetId,
    signal,
  });

  const ensureCaptureStarted = () => {
    if (!captureStartPromise) {
      captureStartPromise = startNativeClubLiveCapture()
        .then(() => undefined)
        .finally(() => {
          captureStartPromise = null;
        });
    }
    return captureStartPromise;
  };

  const startPeer = async (viewerId: string) => {
    if (disposed || !options.activityVisible() || !cleanId(viewerId)) return;
    if (viewers.has(viewerId)) return;
    viewers.add(viewerId);
    const negotiationId = globalThis.crypto?.randomUUID?.()
      ?? `offer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
    viewerNegotiations.set(viewerId, negotiationId);
    try {
      await setNativeClubLiveActivityVisible(true);
      const offer = await createNativeClubLivePeer(viewerId, negotiationId, defaultIceServers);
      if (
        disposed
        || !viewers.has(viewerId)
        || viewerNegotiations.get(viewerId) !== negotiationId
        || !options.activityVisible()
      ) {
        await closeNativeClubLivePeer(viewerId, negotiationId);
        return;
      }
      if (!sendSignal(viewerId, { type: 'offer', sdp: offer.sdp, negotiationId })) {
        throw new Error('The Club Live signaling connection ended before streaming began.');
      }
      // Two authenticated owner displays may subscribe at the same instant.
      // ReplayKit has one shared capture session, so both peers await the same
      // startup promise instead of racing two native startCapture calls.
      await ensureCaptureStarted();
      if (viewerNegotiations.get(viewerId) !== negotiationId) return;
      captureReady = true;
      reportStreamingIfReady();
    } catch (error) {
      if (viewerNegotiations.get(viewerId) === negotiationId) {
        viewers.delete(viewerId);
        viewerNegotiations.delete(viewerId);
        await closeNativeClubLivePeer(viewerId, negotiationId);
        options.onState?.(error instanceof Error ? error.message : 'stream-error');
      }
    }
  };

  const stopPeer = async (viewerId: string) => {
    const negotiationId = viewerNegotiations.get(viewerId);
    viewers.delete(viewerId);
    connectedViewers.delete(viewerId);
    viewerNegotiations.delete(viewerId);
    pendingRemoteCandidates.delete(viewerId);
    await closeNativeClubLivePeer(viewerId, negotiationId);
    if (viewers.size === 0) {
      captureReady = false;
      await stopNativeClubLiveCapture();
    }
    if (!disposed && connectedViewers.size === 0) options.onState?.('waiting-for-viewer');
  };

  const handleSignal = async (fromId: string, signal: ClubLiveSignal) => {
    if (!viewers.has(fromId)) return;
    if (viewerNegotiations.get(fromId) !== signal.negotiationId) return;
    if (signal.type === 'answer') {
      await setNativeClubLiveRemoteDescription({ peerId: fromId, ...signal });
      if (viewerNegotiations.get(fromId) !== signal.negotiationId) return;
      const queuedByNegotiation = pendingRemoteCandidates.get(fromId);
      const queued = queuedByNegotiation?.get(signal.negotiationId) ?? [];
      queuedByNegotiation?.delete(signal.negotiationId);
      if (queuedByNegotiation?.size === 0) pendingRemoteCandidates.delete(fromId);
      await Promise.all(queued.map(addNativeClubLiveIceCandidate));
      return;
    }
    if (signal.type === 'candidate') {
      const candidate: ClubLiveIceCandidate = {
        peerId: fromId,
        negotiationId: signal.negotiationId,
        candidate: signal.candidate,
        sdpMid: signal.sdpMid,
        sdpMLineIndex: signal.sdpMLineIndex ?? 0,
      };
      try {
        await addNativeClubLiveIceCandidate(candidate);
      } catch {
        if (viewerNegotiations.get(fromId) !== signal.negotiationId) return;
        const queuedByNegotiation = pendingRemoteCandidates.get(fromId) ?? new Map();
        const queue = queuedByNegotiation.get(signal.negotiationId) ?? [];
        queue.push(candidate);
        queuedByNegotiation.set(signal.negotiationId, queue.slice(-32));
        pendingRemoteCandidates.set(fromId, queuedByNegotiation);
      }
    }
  };

  const connect = async () => {
    if (disposed || opening || !options.activityVisible()) return;
    opening = true;
    try {
      const ticket = await requestClubTabletStreamTicket(abortController.signal);
      if (disposed || !options.activityVisible()) return;
      const next = new WebSocket(streamWebSocketUrl({ clubTabletTicket: ticket }));
      socket = next;
      next.addEventListener('open', () => {
        if (disposed || next !== socket) return;
        retries = 0;
        sendJson(next, {
          type: 'club-live-stream-register-publisher',
          sessionId: options.sessionId,
        });
        options.onState?.('waiting-for-viewer');
      });
      next.addEventListener('message', (event) => {
        if (disposed || next !== socket) return;
        const message = parseMessage(event.data);
        const type = message?.type;
        if (type === 'club-live-stream-viewer') {
          const viewerId = cleanId(message?.viewerId);
          if (!viewerId) return;
          if (message?.subscribed === true) void startPeer(viewerId);
          else void stopPeer(viewerId);
          return;
        }
        if (type === 'club-live-stream-signal') {
          const fromId = cleanId(message?.fromId);
          const signal = normalizeClubLiveVideoSignal(message?.signal);
          if (fromId && signal) {
            void handleSignal(fromId, signal).catch(() => {
              if (viewerNegotiations.get(fromId) === signal.negotiationId) void stopPeer(fromId);
            });
          }
          return;
        }
        if (type === 'club-live-stream-error') {
          const code = optionalText(message?.code, 80) ?? '';
          // ICE/SDP from a peer can cross an unsubscribe on the two independent
          // WebSockets. That exact relationship is already gone, so treating
          // the late packet as fatal would unnecessarily interrupt the other
          // owner display and every remaining peer on this tablet.
          if (clubLivePublisherSignalErrorIsRecoverable(code)) return;
          options.onState?.(optionalText(message?.message, 240) ?? 'Club Live screen connection error.');
          next.close();
        }
      });
      next.addEventListener('close', () => {
        if (next !== socket) return;
        socket = null;
        options.onState?.('reconnecting');
        void stopPeers();
        if (!disposed && options.activityVisible()) {
          const delay = Math.min(15_000, 750 * (2 ** Math.min(retries, 4)));
          retries += 1;
          retryTimer = window.setTimeout(() => void connect(), delay);
        }
      });
      next.addEventListener('error', () => next.close());
    } catch (error) {
      if (!disposed && options.activityVisible()) {
        options.onState?.(error instanceof Error ? error.message : 'connection-error');
        retryTimer = window.setTimeout(() => void connect(), 2_000);
      }
    } finally {
      opening = false;
    }
  };

  const initialize = async () => {
    if (disposed || initializationInFlight) return;
    initializationInFlight = true;
    let iceHandle: { remove: () => Promise<void> } | null = null;
    let peerHandle: { remove: () => Promise<void> } | null = null;
    try {
      const visibility = await setNativeClubLiveActivityVisible(true);
      if (!visibility.visible) throw new Error('The activity screen is unavailable for Club Live.');
      // Listener registration must finish before the signaling socket opens;
      // otherwise the first host ICE candidates can be emitted and lost.
      iceHandle = await onNativeClubLiveIceCandidate((candidate) => {
        if (!viewers.has(candidate.peerId)) return;
        const negotiationId = viewerNegotiations.get(candidate.peerId);
        if (!negotiationId || candidate.negotiationId !== negotiationId) return;
        sendSignal(candidate.peerId, {
          type: 'candidate',
          negotiationId,
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid,
          sdpMLineIndex: candidate.sdpMLineIndex,
        });
      });
      peerHandle = await onNativeClubLivePeerState((state) => {
        if (
          viewers.has(state.peerId)
          && viewerNegotiations.get(state.peerId) === state.negotiationId
        ) {
          if (state.state === 'connected') {
            connectedViewers.add(state.peerId);
            reportStreamingIfReady();
          } else if (
            state.state === 'disconnected'
            || state.state === 'failed'
            || state.state === 'closed'
          ) {
            connectedViewers.delete(state.peerId);
            if (!disposed && connectedViewers.size === 0) options.onState?.('waiting-for-viewer');
          }
        }
        if (
          (state.state === 'failed' || state.state === 'closed')
          && viewers.has(state.peerId)
          && viewerNegotiations.get(state.peerId) === state.negotiationId
        ) {
          void stopPeer(state.peerId);
        }
      });
      if (disposed) {
        await Promise.all([iceHandle.remove(), peerHandle.remove()]);
        return;
      }
      listenerHandles.push(iceHandle, peerHandle);
      await connect();
    } catch (error) {
      await Promise.all([
        iceHandle?.remove().catch(() => undefined),
        peerHandle?.remove().catch(() => undefined),
      ]);
      if (!disposed && options.activityVisible()) {
        options.onState?.(error instanceof Error ? error.message : 'stream-initialization-error');
        retryTimer = window.setTimeout(() => void initialize(), 2_000);
      }
    } finally {
      initializationInFlight = false;
    }
  };
  void initialize();

  return () => {
    disposed = true;
    abortController.abort();
    window.clearTimeout(retryTimer);
    if (socket?.readyState === WebSocket.OPEN) {
      sendJson(socket, { type: 'club-live-stream-stop' });
    }
    socket?.close();
    socket = null;
    listenerHandles.forEach((handle) => void handle.remove());
    void setNativeClubLiveActivityVisible(false);
    void stopPeers();
  };
}

type ViewerPeer = {
  connection: RTCPeerConnection;
  negotiationId: string;
  pendingCandidates: RTCIceCandidateInit[];
  connectedAt: number;
  disconnectedAt: number | null;
  lastMediaAt: number;
  lastInboundFrames: number;
};

/** Browser-side owner viewer. Call setSubscriptions with publisher IDs chosen
 * by the activity-aware presentation selector. */
export class ClubLiveVideoViewer {
  private socket: WebSocket | null = null;
  private disposed = false;
  private desired = new Set<string>();
  private publishers = new Map<string, ClubLiveVideoPublisher>();
  private peers = new Map<string, ViewerPeer>();
  private earlyCandidates = new Map<string, Map<string, RTCIceCandidateInit[]>>();
  private restartTimers = new Map<string, number>();
  private retryTimer = 0;
  private retries = 0;
  private watchdogTimer = 0;

  constructor(private readonly options: ViewerOptions) {}

  start() {
    this.watchdogTimer = window.setInterval(() => void this.checkPeerFreshness(), 2_000);
    void this.connect();
    return this;
  }

  stop() {
    this.disposed = true;
    window.clearTimeout(this.retryTimer);
    window.clearInterval(this.watchdogTimer);
    if (this.socket?.readyState === WebSocket.OPEN) {
      sendJson(this.socket, { type: 'club-live-stream-stop' });
    }
    this.socket?.close();
    this.socket = null;
    this.restartTimers.forEach((timer) => window.clearTimeout(timer));
    this.restartTimers.clear();
    this.earlyCandidates.clear();
    [...this.peers.keys()].forEach((publisherId) => this.closePeer(publisherId));
  }

  setSubscriptions(publisherIds: Iterable<string>) {
    const next = new Set([...publisherIds].filter((id) => this.publishers.has(id)).slice(0, 4));
    this.desired.forEach((publisherId) => {
      if (!next.has(publisherId)) {
        sendJson(this.socket, {
          type: 'club-live-stream-subscribe',
          publisherId,
          subscribed: false,
        });
        this.earlyCandidates.delete(publisherId);
        const restartTimer = this.restartTimers.get(publisherId);
        if (restartTimer != null) window.clearTimeout(restartTimer);
        this.restartTimers.delete(publisherId);
        this.closePeer(publisherId);
      }
    });
    next.forEach((publisherId) => {
      if (!this.desired.has(publisherId)) {
        sendJson(this.socket, {
          type: 'club-live-stream-subscribe',
          publisherId,
          subscribed: true,
        });
      }
    });
    this.desired = next;
  }

  private async connect() {
    if (this.disposed) return;
    try {
      const authorization = await requestWebSocketTicket('club-live-stream');
      if (this.disposed) return;
      const socket = new WebSocket(streamWebSocketUrl({ ticket: authorization.ticket }));
      this.socket = socket;
      socket.addEventListener('open', () => {
        if (this.disposed || socket !== this.socket) return;
        this.retries = 0;
        sendJson(socket, { type: 'club-live-stream-register-viewer' });
        this.options.onState?.('authorizing');
      });
      socket.addEventListener('message', (event) => this.handleMessage(socket, event.data));
      socket.addEventListener('close', () => {
        if (socket !== this.socket) return;
        this.socket = null;
        [...this.peers.keys()].forEach((publisherId) => this.closePeer(publisherId));
        this.options.onState?.('reconnecting');
        if (!this.disposed) {
          const delay = Math.min(15_000, 750 * (2 ** Math.min(this.retries, 4)));
          this.retries += 1;
          this.retryTimer = window.setTimeout(() => void this.connect(), delay);
        }
      });
      socket.addEventListener('error', () => socket.close());
    } catch (error) {
      this.options.onState?.(error instanceof Error ? error.message : 'connection-error');
      if (!this.disposed) this.retryTimer = window.setTimeout(() => void this.connect(), 2_000);
    }
  }

  private handleMessage(socket: WebSocket, data: unknown) {
    if (this.disposed || socket !== this.socket) return;
    const message = parseMessage(data);
    const type = message?.type;
    if (type === 'club-live-stream-registered' || type === 'club-live-stream-publishers') {
      this.replacePublishers(message?.publishers);
      if (type === 'club-live-stream-registered') {
        this.options.onState?.('connected');
        this.resubscribeDesired();
      }
      return;
    }
    if (type === 'club-live-stream-error') {
      const errorMessage = optionalText(message?.message, 240) ?? 'Club Live screen connection error.';
      this.options.onState?.(errorMessage);
      return;
    }
    if (type === 'club-live-stream-publisher-added') {
      const publisher = normalizePublisher(message?.publisher);
      if (publisher) {
        this.publishers.set(publisher.id, publisher);
        this.emitPublishers();
      }
      return;
    }
    if (type === 'club-live-stream-publisher-removed') {
      const publisherId = cleanId(message?.publisherId)
        || cleanId(record(message?.publisher)?.publisherId)
        || cleanId(record(message?.publisher)?.id);
      if (publisherId) {
        this.publishers.delete(publisherId);
        this.desired.delete(publisherId);
        this.earlyCandidates.delete(publisherId);
        const restartTimer = this.restartTimers.get(publisherId);
        if (restartTimer != null) window.clearTimeout(restartTimer);
        this.restartTimers.delete(publisherId);
        this.closePeer(publisherId);
        this.emitPublishers();
      }
      return;
    }
    if (type === 'club-live-stream-signal') {
      const fromId = cleanId(message?.fromId);
      const signal = normalizeClubLiveVideoSignal(message?.signal);
      if (fromId && signal && this.desired.has(fromId)) {
        void this.handleSignal(fromId, signal).catch(() => {
          const peer = this.peers.get(fromId);
          if (!peer || peer.negotiationId === signal.negotiationId) {
            this.restartSubscription(fromId);
          }
        });
      }
    }
  }

  private replacePublishers(value: unknown) {
    const nextPublishers = new Map(normalizeClubLiveVideoPublishers(value).map((item) => [item.id, item]));
    this.publishers.forEach((_publisher, publisherId) => {
      if (nextPublishers.has(publisherId)) return;
      this.earlyCandidates.delete(publisherId);
      const restartTimer = this.restartTimers.get(publisherId);
      if (restartTimer != null) window.clearTimeout(restartTimer);
      this.restartTimers.delete(publisherId);
      this.closePeer(publisherId);
    });
    this.publishers = nextPublishers;
    const desired = [...this.desired].filter((id) => this.publishers.has(id));
    this.desired = new Set(desired);
    this.emitPublishers();
  }

  private emitPublishers() {
    this.options.onPublishers([...this.publishers.values()]);
  }

  private resubscribeDesired() {
    this.desired.forEach((publisherId) => {
      if (!this.publishers.has(publisherId)) return;
      sendJson(this.socket, {
        type: 'club-live-stream-subscribe',
        publisherId,
        subscribed: true,
      });
    });
  }

  private restartSubscription(publisherId: string) {
    if (this.disposed || !this.desired.has(publisherId) || !this.publishers.has(publisherId)) return;
    if (this.restartTimers.has(publisherId)) return;
    sendJson(this.socket, {
      type: 'club-live-stream-subscribe',
      publisherId,
      subscribed: false,
    });
    this.earlyCandidates.delete(publisherId);
    this.closePeer(publisherId);
    const timer = window.setTimeout(() => {
      this.restartTimers.delete(publisherId);
      if (this.disposed || !this.desired.has(publisherId) || !this.publishers.has(publisherId)) return;
      sendJson(this.socket, {
        type: 'club-live-stream-subscribe',
        publisherId,
        subscribed: true,
      });
      this.earlyCandidates.delete(publisherId);
    }, 500);
    this.restartTimers.set(publisherId, timer);
  }

  private async handleSignal(publisherId: string, signal: ClubLiveSignal) {
    if (signal.type === 'offer') {
      this.closePeer(publisherId);
      const connection = new RTCPeerConnection({ iceServers: defaultIceServers });
      const earlyByNegotiation = this.earlyCandidates.get(publisherId);
      const state: ViewerPeer = {
        connection,
        negotiationId: signal.negotiationId,
        pendingCandidates: earlyByNegotiation?.get(signal.negotiationId) ?? [],
        connectedAt: 0,
        disconnectedAt: null,
        lastMediaAt: Date.now(),
        lastInboundFrames: 0,
      };
      this.earlyCandidates.delete(publisherId);
      this.peers.set(publisherId, state);
      connection.onicecandidate = ({ candidate }) => {
        if (!candidate || this.peers.get(publisherId) !== state) return;
        sendJson(this.socket, {
          type: 'club-live-stream-signal',
          targetId: publisherId,
          signal: {
            type: 'candidate',
            negotiationId: state.negotiationId,
            ...candidate.toJSON(),
          },
        });
      };
      connection.ontrack = ({ track, streams }) => {
        if (track.kind !== 'video' || this.peers.get(publisherId) !== state) return;
        const stream = streams[0] ?? new MediaStream([track]);
        state.lastMediaAt = Date.now();
        track.onended = () => {
          if (this.peers.get(publisherId) === state) this.restartSubscription(publisherId);
        };
        this.options.onFrame({ publisherId, stream, connectedAt: Date.now() });
      };
      connection.onconnectionstatechange = () => {
        if (this.peers.get(publisherId) !== state) return;
        if (connection.connectionState === 'connected') {
          state.connectedAt = Date.now();
          state.disconnectedAt = null;
          state.lastMediaAt = Date.now();
        } else if (connection.connectionState === 'disconnected') {
          state.disconnectedAt ??= Date.now();
        }
        if (connection.connectionState === 'failed' || connection.connectionState === 'closed') {
          this.restartSubscription(publisherId);
        }
      };
      await connection.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
      if (this.peers.get(publisherId) !== state) return;
      ClubLiveVideoViewer.preferH264(connection);
      const answer = await connection.createAnswer();
      if (this.peers.get(publisherId) !== state) return;
      await connection.setLocalDescription(answer);
      if (this.peers.get(publisherId) !== state) return;
      sendJson(this.socket, {
        type: 'club-live-stream-signal',
        targetId: publisherId,
        signal: {
          type: 'answer',
          sdp: answer.sdp ?? '',
          negotiationId: state.negotiationId,
        },
      });
      const pending = state.pendingCandidates.splice(0);
      await Promise.all(pending.map((candidate) => connection.addIceCandidate(candidate)));
      return;
    }
    if (signal.type === 'candidate') {
      const candidate: RTCIceCandidateInit = {
        candidate: signal.candidate,
        sdpMid: signal.sdpMid,
        sdpMLineIndex: signal.sdpMLineIndex,
        usernameFragment: signal.usernameFragment,
      };
      const peer = this.peers.get(publisherId);
      if (!peer) {
        const pendingByNegotiation = this.earlyCandidates.get(publisherId) ?? new Map();
        const pending = pendingByNegotiation.get(signal.negotiationId) ?? [];
        pending.push(candidate);
        pendingByNegotiation.set(signal.negotiationId, pending.slice(-32));
        while (pendingByNegotiation.size > 2) {
          const oldest = pendingByNegotiation.keys().next().value as string | undefined;
          if (!oldest) break;
          pendingByNegotiation.delete(oldest);
        }
        this.earlyCandidates.set(publisherId, pendingByNegotiation);
        return;
      }
      if (peer.negotiationId !== signal.negotiationId) return;
      if (!peer.connection.remoteDescription) {
        peer.pendingCandidates.push(candidate);
      } else {
        await peer.connection.addIceCandidate(candidate);
      }
    }
  }

  private closePeer(publisherId: string) {
    const peer = this.peers.get(publisherId);
    if (!peer) return;
    this.peers.delete(publisherId);
    peer.connection.onicecandidate = null;
    peer.connection.ontrack = null;
    peer.connection.onconnectionstatechange = null;
    peer.connection.getReceivers().forEach((receiver) => {
      receiver.track.onended = null;
      receiver.track.stop();
    });
    peer.connection.close();
    this.options.onFrameRemoved(publisherId);
  }

  private async checkPeerFreshness() {
    if (this.disposed || document.visibilityState === 'hidden') return;
    const now = Date.now();
    await Promise.all([...this.peers.entries()].map(async ([publisherId, peer]) => {
      if (peer.disconnectedAt != null && now - peer.disconnectedAt > 5_000) {
        this.restartSubscription(publisherId);
        return;
      }
      if (peer.connection.connectionState !== 'connected') {
        if (
          (peer.connection.connectionState === 'new' || peer.connection.connectionState === 'connecting')
          && now - peer.lastMediaAt > 12_000
        ) this.restartSubscription(publisherId);
        return;
      }
      try {
        const report = await peer.connection.getStats();
        if (this.peers.get(publisherId) !== peer) return;
        let inboundFrames = 0;
        report.forEach((entry) => {
          const stats = entry as RTCStats & {
            kind?: string;
            mediaType?: string;
            framesDecoded?: number;
            framesReceived?: number;
          };
          if (stats.type !== 'inbound-rtp' || (stats.kind ?? stats.mediaType) !== 'video') return;
          inboundFrames += Number(stats.framesDecoded ?? stats.framesReceived ?? 0);
        });
        if (inboundFrames > peer.lastInboundFrames) {
          peer.lastInboundFrames = inboundFrames;
          peer.lastMediaAt = now;
          return;
        }
        // A live MediaStream track can remain "live" after packets freeze.
        // Restart the exact subscription so the JPEG safety feed can take
        // over while a fresh P2P connection is negotiated.
        if (now - peer.lastMediaAt > 7_000) this.restartSubscription(publisherId);
      } catch {
        if (this.peers.get(publisherId) !== peer) return;
        if (now - peer.lastMediaAt > 7_000) this.restartSubscription(publisherId);
      }
    }));
  }

  private static preferH264(connection: RTCPeerConnection) {
    if (typeof RTCRtpReceiver === 'undefined' || typeof RTCRtpReceiver.getCapabilities !== 'function') return;
    const capabilities = RTCRtpReceiver.getCapabilities('video');
    if (!capabilities) return;
    const codecs = [...capabilities.codecs].sort((left, right) => {
      const leftH264 = left.mimeType.toLowerCase() === 'video/h264' ? 1 : 0;
      const rightH264 = right.mimeType.toLowerCase() === 'video/h264' ? 1 : 0;
      return rightH264 - leftH264;
    });
    connection.getTransceivers().forEach((transceiver) => {
      if (transceiver.receiver.track.kind === 'video' && typeof transceiver.setCodecPreferences === 'function') {
        transceiver.setCodecPreferences(codecs);
      }
    });
  }
}
