import { normalizePhoneNumber } from './track-contact-fields.mjs';

const usaBmxOrigin = 'https://www.usabmx.com';

function slug(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/(^-|-$)/gu, '');
}

function normalizedName(value) {
  return String(value ?? '').trim().replace(/\s+/gu, ' ').toLowerCase();
}

export function usaBmxMicrositeUrl(record) {
  const state = String(record?.state_abbreviation ?? '').trim().toLowerCase();
  const name = slug(record?.name);
  if (!/^[a-z]{2,3}$/u.test(state) || !name || record?.id === undefined || record?.id === null) {
    return undefined;
  }
  return `${usaBmxOrigin}/tracks/${state}-${name}`;
}

export function extractUsaBmxMicrositeContact(html, expectedRecord) {
  if (typeof html !== 'string' || html.length === 0 || html.length > 2_000_000) {
    return undefined;
  }

  const match = html.match(/<script[^>]*\bid=(['"])__NEXT_DATA__\1[^>]*>([\s\S]*?)<\/script>/iu);
  if (!match?.[2]) {
    return undefined;
  }

  try {
    const payload = JSON.parse(match[2]);
    const pageProps = payload?.props?.pageProps;
    const micrositeTrack = pageProps?.track;
    const hero = pageProps?.msHomepageData?.hero_section;
    const expectedId = String(expectedRecord?.id ?? '');
    const expectedName = normalizedName(expectedRecord?.name);
    if (
      !expectedId
      || !expectedName
      || String(micrositeTrack?.id ?? '') !== expectedId
      || String(hero?.id ?? '') !== expectedId
      || normalizedName(micrositeTrack?.name) !== expectedName
      || normalizedName(hero?.name) !== expectedName
    ) {
      return undefined;
    }

    const phoneNumber = normalizePhoneNumber(hero.primary_contact_phone);
    return {
      matched: true,
      ...(phoneNumber ? { phoneNumber } : {}),
    };
  } catch {
    return undefined;
  }
}

export function isSafeUsaBmxMicrositeResponseUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === 'www.usabmx.com'
      && !url.username
      && !url.password
      && !url.port
      && url.pathname.startsWith('/tracks/');
  } catch {
    return false;
  }
}
