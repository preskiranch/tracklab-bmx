export type AuthenticatedServerEvent = Readonly<{
  type: string;
  data: string;
  lastEventId: string;
}>;

export type AuthenticatedEventStreamOptions = Readonly<{
  onEvent: (event: AuthenticatedServerEvent) => void;
  onOpen?: () => void;
  onError?: (error: unknown) => void;
  reconnectMs?: number;
  fetcher?: typeof fetch;
}>;

function parseEventBlock(block: string): AuthenticatedServerEvent | null {
  let type = 'message';
  let lastEventId = '';
  const data: string[] = [];
  block.split('\n').forEach((line) => {
    if (!line || line.startsWith(':')) return;
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /u, '');
    if (field === 'event') type = value || 'message';
    else if (field === 'data') data.push(value);
    else if (field === 'id' && !value.includes('\u0000')) lastEventId = value;
  });
  return data.length || type !== 'message'
    ? { type, data: data.join('\n'), lastEventId }
    : null;
}

/**
 * Fetch-based SSE transport. Unlike EventSource it can carry the iOS Bearer
 * session injected by serviceTransport, while browsers continue to send their
 * HttpOnly same-origin cookie. No credential is ever put in a URL.
 */
export function subscribeToAuthenticatedEventStream(
  path: string,
  options: AuthenticatedEventStreamOptions,
) {
  const fetcher = options.fetcher ?? fetch;
  const reconnectMs = Math.max(250, options.reconnectMs ?? 1_400);
  let closed = false;
  let controller: AbortController | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;

  const scheduleReconnect = () => {
    if (closed || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, reconnectMs);
  };

  const connect = async () => {
    if (closed) return;
    const attempt = ++generation;
    controller?.abort();
    controller = new AbortController();
    try {
      const response = await fetcher(path, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'text/event-stream' },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`TrackLab live updates returned ${response.status}.`);
      }
      if (closed || attempt !== generation) return;
      options.onOpen?.();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (!closed && attempt === generation) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n?/gu, '\n');
        let separator = buffer.indexOf('\n\n');
        while (separator >= 0) {
          const event = parseEventBlock(buffer.slice(0, separator));
          buffer = buffer.slice(separator + 2);
          if (event) options.onEvent(event);
          separator = buffer.indexOf('\n\n');
        }
      }
      if (!closed && attempt === generation) scheduleReconnect();
    } catch (error) {
      if (closed || attempt !== generation || (error instanceof DOMException && error.name === 'AbortError')) return;
      options.onError?.(error);
      scheduleReconnect();
    }
  };

  void connect();
  return () => {
    closed = true;
    generation += 1;
    controller?.abort();
    controller = null;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };
}
