export function childDeviceTokenFromHref(href: string) {
  try {
    const token = new URLSearchParams(new URL(href).hash.slice(1)).get('childDevice') ?? '';
    return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : '';
  } catch { return ''; }
}
export async function childDeviceRequest(path: string, body?: unknown, method = 'POST', signal?: AbortSignal) {
  const response = await fetch(path, { method, credentials: 'same-origin', signal,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'The child phone could not be set up. Please try again.');
  return payload;
}
