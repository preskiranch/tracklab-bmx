import type { TrackLocatorRecord, TrackRecord } from '../types';

type TrackLinkSource = Pick<TrackRecord,
  | 'websiteUrl'
  | 'facebookUrl'
  | 'instagramUrl'
  | 'tiktokUrl'
  | 'youtubeUrl'
  | 'phoneNumber'
  | 'federationName'
  | 'federationUrl'
> | Pick<TrackLocatorRecord,
  | 'websiteUrl'
  | 'facebookUrl'
  | 'instagramUrl'
  | 'tiktokUrl'
  | 'youtubeUrl'
  | 'phoneNumber'
  | 'federationName'
  | 'federationUrl'
>;

export type TrackExternalLinks = {
  websiteUrl?: string;
  facebookUrl?: string;
  instagramUrl?: string;
  tiktokUrl?: string;
  youtubeUrl?: string;
  phoneNumber?: string;
  phoneHref?: string;
  federationName?: string;
  federationUrl?: string;
};

const maximumExternalUrlLength = 2_048;
const socialUrlWithoutProtocol = /^(?:(?:[a-z0-9-]+\.)*(?:facebook|instagram|tiktok|youtube)\.com|youtu\.be)(?:[/?#]|$)/iu;
const serviceHostnames = {
  facebook: ['facebook.com'],
  instagram: ['instagram.com'],
  tiktok: ['tiktok.com'],
  youtube: ['youtube.com', 'youtu.be'],
} as const;
type SocialService = keyof typeof serviceHostnames;

export function safeExternalHttpUrl(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maximumExternalUrlLength) {
    return undefined;
  }

  const candidate = socialUrlWithoutProtocol.test(trimmed) ? `https://${trimmed}` : trimmed;
  try {
    const url = new URL(candidate);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:')
      || !url.hostname
      || url.username
      || url.password
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function isServiceUrl(value: string | undefined, service: SocialService) {
  if (!value) {
    return false;
  }

  const hostname = new URL(value).hostname.toLowerCase();
  return serviceHostnames[service].some((serviceHostname) => (
    hostname === serviceHostname || hostname.endsWith(`.${serviceHostname}`)
  ));
}

function safeServiceUrl(value: unknown, service: SocialService) {
  const safeUrl = safeExternalHttpUrl(value);
  if (!isServiceUrl(safeUrl, service)) {
    return undefined;
  }

  const url = new URL(safeUrl!);
  url.protocol = 'https:';
  return url.toString();
}

export function safePhoneNumber(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64 || !/^\+?[\d\s().-]+$/u.test(trimmed)) {
    return undefined;
  }

  let parenthesisDepth = 0;
  for (const character of trimmed) {
    if (character === '(') {
      parenthesisDepth += 1;
    } else if (character === ')') {
      parenthesisDepth -= 1;
    }
    if (parenthesisDepth < 0 || parenthesisDepth > 1) {
      return undefined;
    }
  }
  if (parenthesisDepth !== 0) {
    return undefined;
  }

  const digits = trimmed.replace(/\D/gu, '');
  if (digits.length < 7 || digits.length > 15) {
    return undefined;
  }

  return trimmed.replace(/\s+/gu, ' ');
}

export function trackExternalLinks(track: TrackLinkSource): TrackExternalLinks {
  const candidateWebsiteUrl = safeExternalHttpUrl(track.websiteUrl);
  const websiteFacebookUrl = safeServiceUrl(track.websiteUrl, 'facebook');
  const websiteInstagramUrl = safeServiceUrl(track.websiteUrl, 'instagram');
  const websiteTiktokUrl = safeServiceUrl(track.websiteUrl, 'tiktok');
  const websiteYoutubeUrl = safeServiceUrl(track.websiteUrl, 'youtube');
  const facebookUrl = safeServiceUrl(track.facebookUrl, 'facebook')
    ?? websiteFacebookUrl;
  const instagramUrl = safeServiceUrl(track.instagramUrl, 'instagram')
    ?? websiteInstagramUrl;
  const tiktokUrl = safeServiceUrl(track.tiktokUrl, 'tiktok')
    ?? websiteTiktokUrl;
  const youtubeUrl = safeServiceUrl(track.youtubeUrl, 'youtube')
    ?? websiteYoutubeUrl;
  const phoneNumber = safePhoneNumber(track.phoneNumber);
  const federationName = typeof track.federationName === 'string'
    ? track.federationName.trim()
    : '';
  const federationUrl = safeExternalHttpUrl(track.federationUrl);

  return {
    ...(!websiteFacebookUrl && !websiteInstagramUrl && !websiteTiktokUrl && !websiteYoutubeUrl && candidateWebsiteUrl
      ? { websiteUrl: candidateWebsiteUrl }
      : {}),
    ...(facebookUrl ? { facebookUrl } : {}),
    ...(instagramUrl ? { instagramUrl } : {}),
    ...(tiktokUrl ? { tiktokUrl } : {}),
    ...(youtubeUrl ? { youtubeUrl } : {}),
    ...(phoneNumber ? {
      phoneNumber,
      phoneHref: `tel:${phoneNumber.startsWith('+') ? '+' : ''}${phoneNumber.replace(/\D/gu, '')}`,
    } : {}),
    ...(federationName && federationUrl ? { federationName, federationUrl } : {}),
  };
}
