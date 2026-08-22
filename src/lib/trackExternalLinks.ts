import type { TrackLocatorRecord, TrackRecord } from '../types';

type TrackLinkSource = Pick<TrackRecord,
  | 'websiteUrl'
  | 'facebookUrl'
  | 'instagramUrl'
  | 'federationName'
  | 'federationUrl'
> | Pick<TrackLocatorRecord,
  | 'websiteUrl'
  | 'facebookUrl'
  | 'instagramUrl'
  | 'federationName'
  | 'federationUrl'
>;

export type TrackExternalLinks = {
  websiteUrl?: string;
  facebookUrl?: string;
  instagramUrl?: string;
  federationName?: string;
  federationUrl?: string;
};

const maximumExternalUrlLength = 2_048;
const socialUrlWithoutProtocol = /^(?:(?:[a-z0-9-]+\.)*(?:facebook|instagram)\.com)(?:[/?#]|$)/iu;

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

function isServiceUrl(value: string | undefined, service: 'facebook' | 'instagram') {
  if (!value) {
    return false;
  }

  const hostname = new URL(value).hostname.toLowerCase();
  const serviceHostname = `${service}.com`;
  return hostname === serviceHostname || hostname.endsWith(`.${serviceHostname}`);
}

function safeServiceUrl(value: unknown, service: 'facebook' | 'instagram') {
  const safeUrl = safeExternalHttpUrl(value);
  if (!isServiceUrl(safeUrl, service)) {
    return undefined;
  }

  const url = new URL(safeUrl!);
  url.protocol = 'https:';
  return url.toString();
}

export function trackExternalLinks(track: TrackLinkSource): TrackExternalLinks {
  const candidateWebsiteUrl = safeExternalHttpUrl(track.websiteUrl);
  const websiteFacebookUrl = safeServiceUrl(track.websiteUrl, 'facebook');
  const websiteInstagramUrl = safeServiceUrl(track.websiteUrl, 'instagram');
  const facebookUrl = safeServiceUrl(track.facebookUrl, 'facebook')
    ?? websiteFacebookUrl;
  const instagramUrl = safeServiceUrl(track.instagramUrl, 'instagram')
    ?? websiteInstagramUrl;
  const federationName = typeof track.federationName === 'string'
    ? track.federationName.trim()
    : '';
  const federationUrl = safeExternalHttpUrl(track.federationUrl);

  return {
    ...(!websiteFacebookUrl && !websiteInstagramUrl && candidateWebsiteUrl
      ? { websiteUrl: candidateWebsiteUrl }
      : {}),
    ...(facebookUrl ? { facebookUrl } : {}),
    ...(instagramUrl ? { instagramUrl } : {}),
    ...(federationName && federationUrl ? { federationName, federationUrl } : {}),
  };
}
