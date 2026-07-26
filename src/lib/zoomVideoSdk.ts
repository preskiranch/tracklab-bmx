export const zoomVideoSdkVersion = '2.4.5';
const zoomVideoSdkScriptId = 'tracklab-zoom-video-sdk';
const zoomVideoSdkScriptUrl = `https://source.zoom.us/videosdk/zoom-video-${zoomVideoSdkVersion}.min.js`;

export type ZoomVideoParticipant = {
  userId: number;
  displayName: string;
  bVideoOn: boolean;
  muted?: boolean;
  userKey?: string;
};

export type ZoomVideoStream = {
  attachVideo: (userId: number, quality: number) => Promise<HTMLElement | unknown>;
  detachVideo: (userId: number) => Promise<HTMLElement | HTMLElement[]>;
  startVideo: (options?: {
    fps?: number;
    hd?: boolean;
    originalRatio?: boolean;
  }) => Promise<unknown>;
  stopVideo: () => Promise<unknown>;
  startAudio: (options?: {
    mute?: boolean;
    backgroundNoiseSuppression?: boolean;
  }) => Promise<unknown>;
  stopAudio: () => Promise<unknown>;
  muteAudio: (userId?: number) => Promise<unknown>;
  unmuteAudio: (userId?: number) => Promise<unknown>;
};

export type ZoomVideoClient = {
  init: (
    language: string,
    dependentAssets: 'Global' | 'CDN' | 'CN' | string,
    options?: {
      enforceMultipleVideos?: boolean;
      isLogDetailed?: boolean;
      leaveOnPageUnload?: boolean;
      patchJsMedia?: boolean;
      stayAwake?: boolean;
    },
  ) => Promise<unknown>;
  join: (
    sessionName: string,
    token: string,
    userName: string,
    sessionPassword?: string,
    sessionIdleTimeoutMins?: number,
  ) => Promise<unknown>;
  leave: (end?: boolean) => Promise<unknown>;
  getMediaStream: () => ZoomVideoStream;
  getAllUser: () => ZoomVideoParticipant[];
  getCurrentUserInfo: () => ZoomVideoParticipant;
  on: (event: string, listener: (payload: unknown) => void) => void;
  off: (event: string, listener: (payload: unknown) => void) => void;
};

export type ZoomVideoSdk = {
  VERSION: string;
  checkSystemRequirements: () => {
    audio: boolean;
    video: boolean;
    screen: boolean;
  };
  createClient: () => ZoomVideoClient;
  destroyClient: () => Promise<void>;
};

declare global {
  interface Window {
    WebVideoSDK?: {
      default?: ZoomVideoSdk;
    };
  }
}

let zoomSdkPromise: Promise<ZoomVideoSdk> | null = null;

function loadedZoomSdk() {
  return window.WebVideoSDK?.default ?? null;
}

export function loadZoomVideoSdk() {
  const loaded = loadedZoomSdk();
  if (loaded) {
    return Promise.resolve(loaded);
  }

  if (zoomSdkPromise) {
    return zoomSdkPromise;
  }

  zoomSdkPromise = new Promise<ZoomVideoSdk>((resolve, reject) => {
    const existingScript = document.getElementById(zoomVideoSdkScriptId) as HTMLScriptElement | null;
    const script = existingScript ?? document.createElement('script');
    const finish = () => {
      const sdk = loadedZoomSdk();
      if (sdk) {
        resolve(sdk);
        return;
      }

      zoomSdkPromise = null;
      reject(new Error('Zoom loaded without its video controls. Refresh and try again.'));
    };
    const fail = () => {
      zoomSdkPromise = null;
      if (!existingScript) {
        script.remove();
      }
      reject(new Error('TrackLab could not load Zoom workout video.'));
    };

    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', fail, { once: true });
    if (!existingScript) {
      script.id = zoomVideoSdkScriptId;
      script.src = zoomVideoSdkScriptUrl;
      script.async = true;
      script.crossOrigin = 'anonymous';
      document.head.appendChild(script);
    }
  });

  return zoomSdkPromise;
}

export function zoomVideoErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (error && typeof error === 'object') {
    const message = 'reason' in error && typeof error.reason === 'string'
      ? error.reason
      : 'message' in error && typeof error.message === 'string'
        ? error.message
        : '';
    if (message.trim()) {
      return message;
    }
  }

  return fallback;
}
