export const socialServiceHostnames = Object.freeze({
  facebook: Object.freeze(['facebook.com']),
  instagram: Object.freeze(['instagram.com']),
  tiktok: Object.freeze(['tiktok.com']),
  youtube: Object.freeze(['youtube.com', 'youtu.be']),
});

const maximumExternalUrlLength = 2_048;
const maximumPhoneLength = 64;
const socialUrlWithoutProtocol = /^(?:(?:[a-z0-9-]+\.)*(?:facebook|instagram|tiktok|youtube)\.com|youtu\.be)(?:[/?#]|$)/iu;

export function normalizeExternalHttpUrl(value) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maximumExternalUrlLength) {
    return undefined;
  }

  const candidate = /^https?:\/\//iu.test(trimmed)
    ? trimmed
    : socialUrlWithoutProtocol.test(trimmed) ? `https://${trimmed}` : undefined;
  if (!candidate) {
    return undefined;
  }

  try {
    const url = new URL(candidate);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:')
      && url.hostname
      && !url.username
      && !url.password
    ) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function isServiceUrl(value, service) {
  const normalized = normalizeExternalHttpUrl(value);
  const hostnames = socialServiceHostnames[service];
  if (!normalized || !hostnames) {
    return false;
  }

  const hostname = new URL(normalized).hostname.toLowerCase();
  return hostnames.some((serviceHostname) => (
    hostname === serviceHostname || hostname.endsWith(`.${serviceHostname}`)
  ));
}

export function normalizeSocialUrl(value, service) {
  const normalized = normalizeExternalHttpUrl(value);
  if (!normalized || !isServiceUrl(normalized, service)) {
    return undefined;
  }

  const url = new URL(normalized);
  url.protocol = 'https:';
  return url.toString();
}

function hasBalancedParentheses(value) {
  let depth = 0;
  for (const character of value) {
    if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth -= 1;
    }
    if (depth < 0 || depth > 1) {
      return false;
    }
  }
  return depth === 0;
}

export function normalizePhoneNumber(value) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (
    !trimmed
    || trimmed.length > maximumPhoneLength
    || !/^\+?[\d\s().-]+$/u.test(trimmed)
    || !hasBalancedParentheses(trimmed)
  ) {
    return undefined;
  }

  const digits = trimmed.replace(/\D/gu, '');
  if (digits.length < 7 || digits.length > 15) {
    return undefined;
  }

  return trimmed.replace(/\s+/gu, ' ');
}

export function isNormalizedPhoneNumber(value) {
  return typeof value === 'string' && normalizePhoneNumber(value) === value;
}

export function phoneHrefFor(value) {
  const phoneNumber = normalizePhoneNumber(value);
  if (!phoneNumber) {
    return undefined;
  }

  return `tel:${phoneNumber.startsWith('+') ? '+' : ''}${phoneNumber.replace(/\D/gu, '')}`;
}

function sourceMetadataValues(track, ...keys) {
  const tags = track?.sourceRecord?.osmTags;
  if (!tags || typeof tags !== 'object') {
    return [];
  }

  return keys
    .map((key) => tags[key])
    .filter((value) => typeof value === 'string' && value.trim());
}

function firstNormalized(normalizer, ...values) {
  for (const value of values.flat()) {
    const normalized = normalizer(value);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

export function normalizeTrackContactFields(track) {
  const normalizedWebsiteUrl = firstNormalized(
    normalizeExternalHttpUrl,
    track?.websiteUrl,
    sourceMetadataValues(track, 'website', 'contact:website'),
  );
  const serviceUrl = (field, service, ...sourceKeys) => firstNormalized(
    (value) => normalizeSocialUrl(value, service),
    track?.[field],
    sourceMetadataValues(track, ...sourceKeys),
  ) ?? normalizeSocialUrl(normalizedWebsiteUrl, service);
  const websiteIsSocial = Object.keys(socialServiceHostnames)
    .some((service) => isServiceUrl(normalizedWebsiteUrl, service));

  const websiteUrl = websiteIsSocial ? undefined : normalizedWebsiteUrl;
  const facebookUrl = serviceUrl('facebookUrl', 'facebook', 'contact:facebook', 'facebook');
  const instagramUrl = serviceUrl('instagramUrl', 'instagram', 'contact:instagram', 'instagram');
  const phoneNumber = firstNormalized(
    normalizePhoneNumber,
    track?.phoneNumber,
    sourceMetadataValues(track, 'phone', 'contact:phone', 'mobile', 'contact:mobile'),
  );

  return {
    ...(websiteUrl ? { websiteUrl } : {}),
    ...(facebookUrl ? { facebookUrl } : {}),
    ...(instagramUrl ? { instagramUrl } : {}),
    ...(phoneNumber ? { phoneNumber } : {}),
  };
}
