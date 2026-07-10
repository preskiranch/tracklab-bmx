const defaultHostedOrigins = ['https://tracklab-bmx.onrender.com'];

function configuredOrigins() {
  return new Set([
    ...defaultHostedOrigins,
    ...String(process.env.TRACKLAB_ALLOWED_ORIGINS || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  ]);
}

function isLoopbackOrigin(origin) {
  try {
    const url = new URL(origin);
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
  } catch {
    return false;
  }
}

export function bridgeOriginAllowed(origin) {
  if (!origin) {
    return true;
  }

  let normalized;
  try {
    normalized = new URL(origin).origin;
  } catch {
    return false;
  }

  return isLoopbackOrigin(normalized) || configuredOrigins().has(normalized);
}

export function bridgeCorsOrigin(origin) {
  return bridgeOriginAllowed(origin) && origin ? new URL(origin).origin : null;
}
