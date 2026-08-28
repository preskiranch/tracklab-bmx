function environmentValue(environment, name) {
  return String(environment?.[name] || '').trim();
}

export function clientGoogleMapsJsApiKey(environment = process.env) {
  return environmentValue(environment, 'TRACKLAB_GOOGLE_MAPS_JS_API_KEY')
    || environmentValue(environment, 'VITE_GOOGLE_MAPS_API_KEY');
}

export function nativeRuntimeConfigPayload(environment = process.env) {
  const apiKey = clientGoogleMapsJsApiKey(environment);
  return {
    version: 1,
    googleMaps: {
      configured: Boolean(apiKey),
      apiKey: apiKey || null,
    },
  };
}
