const iso31661Alpha2Codes = new Set((
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ '
  + 'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO '
  + 'FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE '
  + 'JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO '
  + 'MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW '
  + 'PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN '
  + 'TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
).split(' '));

const maximumFederationUrlLength = 2_048;

function normalizedText(value) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizedCountryCode(value) {
  return normalizedText(value)?.toUpperCase();
}

function normalizedState(value) {
  return normalizedText(value)?.toLocaleLowerCase('en-US');
}

function registryKey(entry) {
  const countryCode = normalizedCountryCode(entry.countryCode) ?? '';
  if (normalizedText(entry.trackId)) {
    return `track:${countryCode}:${normalizedText(entry.trackId)}`;
  }
  if (normalizedText(entry.source)) {
    return `source:${countryCode}:${normalizedText(entry.source)}`;
  }
  if (normalizedState(entry.state)) {
    return `state:${countryCode}:${normalizedState(entry.state)}`;
  }
  return `country:${countryCode}`;
}

export function isKnownIsoCountryCode(value) {
  return typeof value === 'string'
    && value === value.toUpperCase()
    && iso31661Alpha2Codes.has(value);
}

export function isSafeFederationUrl(value) {
  if (typeof value !== 'string') {
    return false;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maximumFederationUrlLength) {
    return false;
  }

  try {
    const url = new URL(trimmed);
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && Boolean(url.hostname)
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

export function validateFederationPair(source, label = 'federation') {
  const federationName = normalizedText(source?.federationName);
  const federationUrl = normalizedText(source?.federationUrl);
  const errors = [];
  if (Boolean(federationName) !== Boolean(federationUrl)) {
    errors.push(`${label}: federationName and federationUrl must be supplied together`);
  }
  if (federationUrl && !isSafeFederationUrl(federationUrl)) {
    errors.push(`${label}: federationUrl must be a safe HTTP(S) URL without credentials`);
  }
  return errors;
}

export function validateFederationRegistry(registry) {
  const errors = [];
  if (!Array.isArray(registry)) {
    return ['federation registry must be an array'];
  }

  const seen = new Set();
  registry.forEach((entry, index) => {
    const label = `federation registry entry ${index + 1}`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${label}: must be an object`);
      return;
    }

    const countryCode = normalizedText(entry.countryCode);
    const trackId = normalizedText(entry.trackId);
    const source = normalizedText(entry.source);
    const state = normalizedText(entry.state);
    const federationName = normalizedText(entry.federationName);
    const federationUrl = normalizedText(entry.federationUrl);
    if (!countryCode || !isKnownIsoCountryCode(countryCode)) {
      errors.push(`${label}: countryCode must be a known uppercase ISO 3166-1 alpha-2 code`);
    }
    const selectorCount = [trackId, source, state].filter(Boolean).length;
    if (selectorCount > 1) {
      errors.push(`${label}: use only one of trackId, source, or state`);
    }
    if ('trackId' in entry && !trackId) {
      errors.push(`${label}: trackId must be a non-empty string when supplied`);
    }
    if ('source' in entry && !source) {
      errors.push(`${label}: source must be a non-empty string when supplied`);
    }
    if ('state' in entry && !state) {
      errors.push(`${label}: state must be a non-empty string when supplied`);
    }
    if (!federationName) {
      errors.push(`${label}: missing federationName`);
    }
    if (!federationUrl) {
      errors.push(`${label}: missing federationUrl`);
    } else if (!isSafeFederationUrl(federationUrl)) {
      errors.push(`${label}: federationUrl must be a safe HTTP(S) URL without credentials`);
    }
    if (!['official', 'authoritative-directory-fallback'].includes(entry.linkKind)) {
      errors.push(`${label}: linkKind must be official or authoritative-directory-fallback`);
    }

    const key = registryKey(entry);
    if (seen.has(key)) {
      errors.push(`${label}: duplicate federation selector ${key}`);
    }
    seen.add(key);
  });

  return errors;
}

function federationPair(source) {
  const federationName = normalizedText(source?.federationName);
  const federationUrl = normalizedText(source?.federationUrl);
  return {
    ...(federationName ? { federationName } : {}),
    ...(federationUrl ? { federationUrl } : {}),
  };
}

export function createFederationResolver(registry) {
  const validationErrors = validateFederationRegistry(registry);
  if (validationErrors.length > 0) {
    throw new Error(`Invalid federation registry:\n- ${validationErrors.join('\n- ')}`);
  }

  const byJurisdiction = new Map(registry.map((entry) => [registryKey(entry), federationPair(entry)]));
  return (track) => {
    const explicitFederation = federationPair(track);
    if (explicitFederation.federationName || explicitFederation.federationUrl) {
      return explicitFederation;
    }

    const countryCode = normalizedCountryCode(track?.countryCode);
    if (!countryCode) {
      return undefined;
    }
    const trackId = normalizedText(track?.id);
    const source = normalizedText(track?.source);
    const state = normalizedState(track?.state);
    return (trackId ? byJurisdiction.get(`track:${countryCode}:${trackId}`) : undefined)
      ?? (source ? byJurisdiction.get(`source:${countryCode}:${source}`) : undefined)
      ?? (state ? byJurisdiction.get(`state:${countryCode}:${state}`) : undefined)
      ?? byJurisdiction.get(`country:${countryCode}`);
  };
}

export function applyFederationRegistry(tracks, registry) {
  const resolveFederation = createFederationResolver(registry);
  return tracks.map((track) => {
    const federation = resolveFederation(track);
    return federation ? { ...track, ...federation } : track;
  });
}
