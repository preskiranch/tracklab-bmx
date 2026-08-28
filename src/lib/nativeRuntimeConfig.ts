import { isTrackLabNativeShell } from './serviceOrigins';

const nativeRuntimeConfigEndpoint = '/api/native/runtime-config';
const defaultRuntimeConfigTimeoutMs = 5_000;
const googleMapsApiKeyPattern = /^AIza[0-9A-Za-z_-]{35}$/u;

let runtimeGoogleMapsApiKey = '';

export type NativeRuntimeConfigLoadResult = {
  googleMapsConfigured: boolean;
  state: 'loaded' | 'skipped' | 'unavailable';
};

type NativeRuntimeConfigResponse = {
  googleMaps?: {
    apiKey?: unknown;
    configured?: unknown;
  };
  version?: unknown;
};

function normalizedGoogleMapsApiKey(value: unknown) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return googleMapsApiKeyPattern.test(trimmed) ? trimmed : '';
}

function parseNativeRuntimeConfig(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const config = value as NativeRuntimeConfigResponse;
  if (config.version !== 1 || !config.googleMaps || typeof config.googleMaps !== 'object') return null;
  if (typeof config.googleMaps.configured !== 'boolean') return null;

  if (!config.googleMaps.configured) {
    return { googleMapsApiKey: '' };
  }

  const googleMapsApiKey = normalizedGoogleMapsApiKey(config.googleMaps.apiKey);
  return googleMapsApiKey ? { googleMapsApiKey } : null;
}

export function getRuntimeGoogleMapsApiKey() {
  return runtimeGoogleMapsApiKey;
}

/**
 * Loads public client configuration for the bundled native shell. Credentials
 * are retained only in this module's memory for the lifetime of the web view.
 */
export async function loadNativeRuntimeConfig(options: {
  fetcher?: typeof fetch;
  native?: boolean;
  timeoutMs?: number;
} = {}): Promise<NativeRuntimeConfigLoadResult> {
  if (!(options.native ?? isTrackLabNativeShell())) {
    return { googleMapsConfigured: false, state: 'skipped' };
  }

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? defaultRuntimeConfigTimeoutMs,
  );

  try {
    const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    const response = await fetcher(nativeRuntimeConfigEndpoint, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        googleMapsConfigured: runtimeGoogleMapsApiKey.length > 0,
        state: 'unavailable',
      };
    }

    const parsed = parseNativeRuntimeConfig(await response.json());
    if (!parsed) {
      return {
        googleMapsConfigured: runtimeGoogleMapsApiKey.length > 0,
        state: 'unavailable',
      };
    }

    runtimeGoogleMapsApiKey = parsed.googleMapsApiKey;
    return {
      googleMapsConfigured: runtimeGoogleMapsApiKey.length > 0,
      state: 'loaded',
    };
  } catch {
    return {
      googleMapsConfigured: runtimeGoogleMapsApiKey.length > 0,
      state: 'unavailable',
    };
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export function resetNativeRuntimeConfigForTests() {
  runtimeGoogleMapsApiKey = '';
}
