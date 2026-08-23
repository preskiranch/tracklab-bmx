import { isIP } from 'node:net';
import {
  normalizeExternalHttpUrl,
  normalizeSocialUrl,
} from './track-contact-fields.mjs';

const services = ['tiktok', 'youtube'];
const sourceKinds = new Set([
  'exact-official-website',
  'exact-usa-bmx-microsite',
  'exact-osm-url',
  'exact-bmxnz-source-page',
  'retained-source-metadata',
]);

function retainedSourceUrlValues(track) {
  const values = [];
  const add = (field, value) => {
    if (value !== undefined) {
      values.push({ field, value: typeof value === 'string' ? value.trim() : null });
    }
  };
  add('websiteUrl', track.websiteUrl);
  const tags = track.sourceRecord?.osmTags;
  if (tags && typeof tags === 'object') {
    for (const field of ['website', 'contact:website', 'url', 'operator:url', 'disused:website']) {
      add(`sourceRecord.osmTags.${field}`, tags[field]);
    }
  }
  if (track.providerId === 'bmxnz') {
    add('sourceRecord.normalizedAddressSource', track.sourceRecord?.normalizedAddressSource);
    add('sourceRecord.coordinateEvidence.url', track.sourceRecord?.coordinateEvidence?.url);
    add('sourceRecord.sourcePage', track.sourceRecord?.sourcePage);
  }
  return values.sort((left, right) => left.field.localeCompare(right.field));
}

function retainedSocialMetadataValues(track) {
  const tags = track.sourceRecord?.osmTags;
  if (!tags || typeof tags !== 'object') {
    return [];
  }
  return ['contact:tiktok', 'tiktok', 'contact:youtube', 'youtube'].flatMap((field) => (
    tags[field] === undefined ? [] : [{
      field: `sourceRecord.osmTags.${field}`,
      value: tags[field],
    }]
  )).sort((left, right) => left.field.localeCompare(right.field));
}

const reservedHostnameSuffixes = [
  '.example',
  '.home',
  '.home.arpa',
  '.internal',
  '.invalid',
  '.lan',
  '.local',
  '.localhost',
  '.test',
];

function isReservedIpv4(hostname) {
  const parts = hostname.split('.').map(Number);
  if (
    parts.length !== 4
    || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [first, second, third] = parts;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0 && [0, 2].includes(third))
    || (first === 192 && second === 88 && third === 99)
    || (first === 192 && second === 168)
    || (first === 198 && [18, 19].includes(second))
    || (first === 198 && second === 51 && third === 100)
    || (first === 203 && second === 0 && third === 113)
    || first >= 224;
}

function isReservedIpv6(hostname) {
  const value = hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  if (!value.includes(':')) {
    return false;
  }
  const mappedIpv4 = value.match(/(?:^|:)ffff:(\d+\.\d+\.\d+\.\d+)$/u)?.[1];
  return value === '::'
    || value === '::1'
    || value.startsWith('fc')
    || value.startsWith('fd')
    || /^fe[89ab]/u.test(value)
    || value.startsWith('ff')
    || value.startsWith('2001:db8:')
    || value.startsWith('::ffff:')
    || (mappedIpv4 ? isReservedIpv4(mappedIpv4) : false);
}

export function isPublicIpAddress(value) {
  const address = String(value ?? '').replace(/^\[|\]$/gu, '').toLowerCase();
  const version = isIP(address);
  return version === 4
    ? !isReservedIpv4(address)
    : version === 6 ? !isReservedIpv6(address) : false;
}

export function normalizePublicHttpUrl(value) {
  const normalized = normalizeExternalHttpUrl(value);
  if (!normalized) {
    return undefined;
  }
  const url = new URL(normalized);
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, '');
  if (
    url.port
    || hostname === 'localhost'
    || (!hostname.includes('.') && isIP(hostname) === 0)
    || hostname === 'example.com'
    || hostname === 'example.net'
    || hostname === 'example.org'
    || hostname === 'home.arpa'
    || reservedHostnameSuffixes.some((suffix) => hostname.endsWith(suffix))
    || isReservedIpv4(hostname)
    || isReservedIpv6(hostname)
  ) {
    return undefined;
  }
  return normalized;
}

function isAccountUrl(value, service) {
  const normalized = normalizeSocialUrl(value, service);
  if (!normalized || normalized !== value) {
    return false;
  }
  const url = new URL(normalized);
  const allowedHostnames = service === 'tiktok'
    ? ['tiktok.com', 'www.tiktok.com', 'm.tiktok.com']
    : ['youtube.com', 'www.youtube.com', 'm.youtube.com'];
  if (
    !allowedHostnames.includes(url.hostname.toLowerCase())
    || url.search
    || url.hash
    || url.port
  ) {
    return false;
  }
  const pathname = url.pathname.replace(/\/$/u, '');
  return service === 'tiktok'
    ? /^\/@[^/]+$/u.test(pathname)
    : /^\/(?:@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)$/u.test(pathname);
}

export function validateTrackSocialLinkRegistry(registry, tracks) {
  const errors = [];
  const trackIds = new Set(tracks.map((track) => track.id));
  const entryIds = new Set();
  const serviceUrls = new Map();
  if (registry?.schemaVersion !== 1) {
    errors.push('track social-link registry: schemaVersion must be 1');
  }
  if (Number(registry?.tracksEvaluated) !== tracks.length) {
    errors.push(`track social-link registry: tracksEvaluated must be ${tracks.length}`);
  }
  if (!Array.isArray(registry?.links)) {
    return [...errors, 'track social-link registry: links must be an array'];
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(registry?.auditedAt ?? '')) {
    errors.push('track social-link registry: auditedAt must be an ISO UTC timestamp');
  }
  const sortedTrackIds = registry.links.map((entry) => entry?.trackId);
  if (JSON.stringify(sortedTrackIds) !== JSON.stringify([...sortedTrackIds].sort())) {
    errors.push('track social-link registry: links must be sorted by trackId');
  }
  for (const entry of registry.links) {
    const label = `track social-link registry ${entry?.trackId ?? 'unknown'}`;
    const unexpectedFields = Object.keys(entry ?? {}).filter((field) => (
      !['trackId', ...services].includes(field)
    ));
    if (unexpectedFields.length > 0) {
      errors.push(`${label}: unexpected fields ${unexpectedFields.join(', ')}`);
    }
    if (!trackIds.has(entry?.trackId)) {
      errors.push(`${label}: unknown trackId`);
    }
    if (entryIds.has(entry?.trackId)) {
      errors.push(`${label}: duplicate trackId`);
    }
    entryIds.add(entry?.trackId);
    const presentServices = services.filter((service) => entry?.[service] !== undefined);
    if (presentServices.length === 0) {
      errors.push(`${label}: no social link supplied`);
    }
    for (const service of presentServices) {
      const link = entry[service];
      if (!isAccountUrl(link?.url, service)) {
        errors.push(`${label}: invalid ${service} account URL`);
      }
      if (!normalizePublicHttpUrl(link?.sourceUrl)) {
        errors.push(`${label}: invalid ${service} sourceUrl`);
      }
      if (!normalizePublicHttpUrl(link?.requestedSourceUrl)) {
        errors.push(`${label}: invalid ${service} requestedSourceUrl`);
      }
      if (!sourceKinds.has(link?.sourceKind)) {
        errors.push(`${label}: invalid ${service} sourceKind`);
      }
      if (!Array.isArray(link?.evidence) || link.evidence.length === 0) {
        errors.push(`${label}: missing ${service} evidence`);
      } else if (link.evidence.some((evidence) => (
        !evidence || typeof evidence !== 'object' || Array.isArray(evidence)
      ))) {
        errors.push(`${label}: malformed ${service} evidence`);
      }
      const key = `${service}|${link?.url}`;
      const existing = serviceUrls.get(key);
      if (existing && existing !== entry.trackId) {
        errors.push(`${label}: ${service} URL duplicates ${existing}`);
      }
      serviceUrls.set(key, entry.trackId);
    }
  }
  return errors;
}

export function applyTrackSocialLinkRegistry(tracks, registry) {
  const byTrackId = new Map((registry?.links ?? []).map((entry) => [entry.trackId, entry]));
  return tracks.map((track) => {
    const {
      tiktokUrl: _unreviewedTikTokUrl,
      youtubeUrl: _unreviewedYouTubeUrl,
      ...trackWithoutReviewedSocialLinks
    } = track;
    const {
      socialLinkProvenance: _unreviewedSocialLinkProvenance,
      ...sourceRecordWithoutReviewedSocialLinks
    } = track.sourceRecord ?? {};
    const cleanedTrack = {
      ...trackWithoutReviewedSocialLinks,
      ...(track.sourceRecord ? { sourceRecord: sourceRecordWithoutReviewedSocialLinks } : {}),
    };
    const entry = byTrackId.get(track.id);
    if (!entry) {
      return cleanedTrack;
    }
    const socialLinkProvenance = Object.fromEntries(services.flatMap((service) => (
      entry[service] ? [[service, {
        sourceUrl: entry[service].sourceUrl,
        requestedSourceUrl: entry[service].requestedSourceUrl,
        sourceKind: entry[service].sourceKind,
        evidence: entry[service].evidence,
      }]] : []
    )));
    return {
      ...cleanedTrack,
      ...(entry.tiktok ? { tiktokUrl: entry.tiktok.url } : {}),
      ...(entry.youtube ? { youtubeUrl: entry.youtube.url } : {}),
      sourceRecord: {
        ...sourceRecordWithoutReviewedSocialLinks,
        socialLinkProvenance,
      },
    };
  });
}

export function validateTrackSocialLinkParity(registry, tracks, label = 'track database') {
  const errors = [];
  const registryByTrackId = new Map((registry?.links ?? []).map((entry) => [entry.trackId, entry]));
  const tracksById = new Map(tracks.map((track) => [track.id, track]));
  for (const track of tracks) {
    const entry = registryByTrackId.get(track.id);
    for (const service of services) {
      const field = `${service}Url`;
      const expected = entry?.[service]?.url;
      if (track[field] !== expected) {
        errors.push(`${label} ${track.id}: ${field} does not exactly match reviewed registry`);
      }
      if (track.sourceRecord !== undefined) {
        const expectedProvenance = entry?.[service] ? {
          sourceUrl: entry[service].sourceUrl,
          requestedSourceUrl: entry[service].requestedSourceUrl,
          sourceKind: entry[service].sourceKind,
          evidence: entry[service].evidence,
        } : undefined;
        const actualProvenance = track.sourceRecord?.socialLinkProvenance?.[service];
        if (JSON.stringify(actualProvenance) !== JSON.stringify(expectedProvenance)) {
          errors.push(`${label} ${track.id}: ${service} provenance does not match reviewed registry`);
        }
      }
    }
  }
  for (const entry of registry?.links ?? []) {
    if (!tracksById.has(entry.trackId)) {
      errors.push(`${label}: reviewed registry track ${entry.trackId} is missing`);
    }
  }
  return errors;
}

export function validateTrackSocialAuditManifest(manifest, registry, tracks) {
  const errors = [];
  const trackIds = new Set(tracks.map((track) => track.id));
  const tracksById = new Map(tracks.map((track) => [track.id, track]));
  const records = Array.isArray(manifest?.records) ? manifest.records : [];
  const recordIds = new Set();
  if (manifest?.schemaVersion !== 1) {
    errors.push('track social-link audit: schemaVersion must be 1');
  }
  if (records.length !== tracks.length || Number(manifest?.summary?.tracksEvaluated) !== tracks.length) {
    errors.push(`track social-link audit: must contain ${tracks.length} track records`);
  }
  if (Number(manifest?.summary?.metadataEvaluated) !== tracks.length) {
    errors.push(`track social-link audit: metadataEvaluated must be ${tracks.length}`);
  }
  if (manifest?.auditedAt !== registry?.auditedAt) {
    errors.push('track social-link audit: auditedAt does not match the reviewed registry');
  }
  if (
    manifest?.policy?.exactSourcesOnly !== true
    || manifest?.policy?.nameSearchUsed !== false
    || manifest?.policy?.normalBuildUsesNetwork !== false
    || manifest?.policy?.privateAndReservedHostsRequested !== false
  ) {
    errors.push('track social-link audit: required fail-closed policy flags are missing');
  }
  for (const [field, value] of [
    ['pendingCandidates', manifest?.pendingCandidates],
    ['staleReview', manifest?.staleReview],
    ['invalidDecisionValues', manifest?.invalidDecisionValues],
    ['conflictingVerified', manifest?.conflictingVerified],
    ['duplicateVerifiedUrls', manifest?.duplicateVerifiedUrls],
  ]) {
    if (!Array.isArray(value) || value.length !== 0) {
      errors.push(`track social-link audit: ${field} must be an empty array`);
    }
  }
  const retainedSourceCount = records.reduce((count, record) => (
    count + (Array.isArray(record?.retainedSourceUrls) ? record.retainedSourceUrls.length : 0)
  ), 0);
  if (Number(manifest?.summary?.retainedSourceUrlsEvaluated) !== retainedSourceCount) {
    errors.push('track social-link audit: retained source URL count is inconsistent');
  }
  const retainedSocialMetadataCount = records.reduce((count, record) => (
    count + (Array.isArray(record?.retainedSocialMetadata) ? record.retainedSocialMetadata.length : 0)
  ), 0);
  if (
    Number(manifest?.summary?.retainedSocialMetadataValuesEvaluated)
    !== retainedSocialMetadataCount
  ) {
    errors.push('track social-link audit: retained social metadata count is inconsistent');
  }
  const catalogExcludedRetainedUrls = Array.isArray(manifest?.catalogExcludedRetainedUrls)
    ? manifest.catalogExcludedRetainedUrls
    : [];
  if (!Array.isArray(manifest?.catalogExcludedRetainedUrls)) {
    errors.push('track social-link audit: excluded import URL evaluations are missing');
  }
  if (
    Number(manifest?.summary?.catalogExcludedRetainedUrlsEvaluated)
    !== catalogExcludedRetainedUrls.length
  ) {
    errors.push('track social-link audit: excluded import URL count is inconsistent');
  }
  for (const record of records) {
    const label = `track social-link audit ${record?.trackId ?? 'unknown'}`;
    if (!trackIds.has(record?.trackId)) {
      errors.push(`${label}: unknown trackId`);
    }
    if (recordIds.has(record?.trackId)) {
      errors.push(`${label}: duplicate trackId`);
    }
    recordIds.add(record?.trackId);
    if (record?.metadataStatus !== 'checked') {
      errors.push(`${label}: retained metadata was not checked`);
    }
    const track = tracksById.get(record?.trackId);
    if (track && (record.name !== track.name || record.providerId !== track.providerId)) {
      errors.push(`${label}: identifying metadata does not match the current catalog`);
    }
    if (!Array.isArray(record?.retainedSourceUrls)) {
      errors.push(`${label}: retained source URL evaluations are missing`);
    }
    const expectedRetainedSources = track ? retainedSourceUrlValues(track) : [];
    const actualRetainedSources = (record?.retainedSourceUrls ?? []).map((source) => ({
      field: source?.field,
      value: source?.requestedUrl ?? null,
    })).sort((left, right) => String(left.field).localeCompare(String(right.field)));
    if (JSON.stringify(actualRetainedSources) !== JSON.stringify(expectedRetainedSources)) {
      errors.push(`${label}: retained source URL inventory does not match the current catalog`);
    }
    if (!Array.isArray(record?.retainedSocialMetadata)) {
      errors.push(`${label}: retained TikTok/YouTube metadata inventory is missing`);
    } else if (
      JSON.stringify(record.retainedSocialMetadata.map((entry) => ({
        field: entry?.field,
        value: entry?.value,
      })).sort((left, right) => String(left.field).localeCompare(String(right.field))))
      !== JSON.stringify(track ? retainedSocialMetadataValues(track) : [])
    ) {
      errors.push(`${label}: retained TikTok/YouTube metadata inventory does not match the current catalog`);
    }
    for (const source of record?.retainedSourceUrls ?? []) {
      if (source?.disposition === 'unclassified') {
        errors.push(`${label}: retained source URL is unclassified`);
      }
      if (source?.disposition === 'exact-page') {
        const page = record?.pages?.find((value) => (
          value.kind === source.kind
          && value.requestedUrl === source.normalizedUrl
          && value.sourceFields?.includes(source.field)
        ));
        if (!page) {
          errors.push(`${label}: exact retained source ${source.field} lacks a page audit`);
        }
      }
    }
    for (const page of record?.pages ?? []) {
      if (!normalizePublicHttpUrl(page?.requestedUrl)) {
        errors.push(`${label}: page audit contains an unsafe requested URL`);
      }
      if (page?.finalUrl !== undefined && !normalizePublicHttpUrl(page.finalUrl)) {
        errors.push(`${label}: page audit contains an unsafe final URL`);
      }
      if (!Array.isArray(page?.sourceFields) || page.sourceFields.length === 0) {
        errors.push(`${label}: page audit lacks retained-source attribution`);
      }
    }
    for (const candidate of record?.candidates ?? []) {
      if (!['verified', 'rejected'].includes(candidate?.decision)) {
        errors.push(`${label}: candidate ${candidate?.url ?? 'unknown'} lacks a final review decision`);
      }
    }
  }

  for (const field of [
    'pendingCandidates',
    'staleReviewDecisions',
    'conflictingVerified',
    'duplicateVerifiedUrls',
    'unclassifiedRetainedUrls',
  ]) {
    if (Number(manifest?.summary?.[field]) !== 0) {
      errors.push(`track social-link audit: ${field} must be zero`);
    }
  }
  for (const entry of catalogExcludedRetainedUrls) {
    if (entry?.disposition === 'unclassified') {
      errors.push(`track social-link audit ${entry?.trackId ?? 'unknown'}: excluded import URL is unclassified`);
    }
  }

  const recordsById = new Map(records.map((record) => [record.trackId, record]));
  for (const entry of registry?.links ?? []) {
    const record = recordsById.get(entry.trackId);
    for (const service of services) {
      if (!entry[service]) {
        continue;
      }
      const candidate = record?.candidates?.find((value) => (
        value.service === service
        && value.url === entry[service].url
        && value.decision === 'verified'
      ));
      if (!candidate) {
        errors.push(`track social-link audit ${entry.trackId}: registry ${service} is not verified`);
        continue;
      }
      const matchingEvidence = candidate.evidence?.find((evidence) => (
        evidence.sourceKind === entry[service].sourceKind
        && evidence.sourceUrl === entry[service].sourceUrl
        && evidence.requestedSourceUrl === entry[service].requestedSourceUrl
      ));
      if (!matchingEvidence) {
        errors.push(`track social-link audit ${entry.trackId}: registry ${service} provenance is not present`);
        continue;
      }
      if (entry[service].sourceKind === 'retained-source-metadata') {
        const track = tracksById.get(entry.trackId);
        if (entry[service].requestedSourceUrl !== track?.sourceUrl) {
          errors.push(`track social-link audit ${entry.trackId}: metadata provenance is not tied to the track source`);
        }
      } else {
        const sourcePage = record.pages?.find((page) => (
          page.kind === entry[service].sourceKind
          && page.requestedUrl === entry[service].requestedSourceUrl
          && (page.finalUrl ?? page.requestedUrl) === entry[service].sourceUrl
          && page.association !== 'failed'
          && (page.status === 'ok' || page.browser?.status === 'ok')
          && page.candidates?.some((value) => (
            value.service === service && value.url === entry[service].url
          ))
        ));
        if (!sourcePage) {
          errors.push(`track social-link audit ${entry.trackId}: ${service} source page is not associated to that track`);
        }
      }
    }
  }

  const verifiedCandidates = records.flatMap((record) => (record.candidates ?? []).filter((candidate) => (
    candidate.decision === 'verified'
  )).map((candidate) => `${record.trackId}|${candidate.service}|${candidate.url}`));
  const registryCandidates = (registry?.links ?? []).flatMap((entry) => services.flatMap((service) => (
    entry[service] ? [`${entry.trackId}|${service}|${entry[service].url}`] : []
  )));
  if (JSON.stringify([...verifiedCandidates].sort()) !== JSON.stringify([...registryCandidates].sort())) {
    errors.push('track social-link audit: verified candidates do not exactly match the registry');
  }
  return errors;
}
