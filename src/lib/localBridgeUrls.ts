const defaultBridgeUrls = ['ws://127.0.0.1:8787', 'ws://localhost:8787'];

export function getBridgeWebSocketUrls() {
  const configured = import.meta.env.VITE_WATTBIKE_BRIDGE_URL?.trim();
  return [...new Set([configured, ...defaultBridgeUrls].filter(Boolean))] as string[];
}

export function bridgeHttpUrlFromWebSocket(webSocketUrl: string, path: string) {
  const url = new URL(webSocketUrl);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = path;
  url.search = '';
  url.hash = '';
  return url.toString();
}

export async function fetchBridgeEndpoint(path: string, init?: RequestInit) {
  let lastError: unknown = null;

  for (const bridgeUrl of getBridgeWebSocketUrls()) {
    try {
      return await fetch(bridgeHttpUrlFromWebSocket(bridgeUrl, path), init);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Could not reach TrackLab Bike Connector on ${getBridgeWebSocketUrls().join(' or ')}.`);
}
