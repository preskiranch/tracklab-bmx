import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { chromium } from 'playwright';
import {
  extractUsaBmxMicrositeContact,
  usaBmxMicrositeUrl,
} from './lib/usa-bmx-microsite.mjs';
import {
  isPublicIpAddress,
  normalizePublicHttpUrl,
} from './lib/track-social-links.mjs';

const databasePath = new URL('../public/data/track-database.json', import.meta.url);
const osmImportPath = new URL('../data/imports/openstreetmap-bmx-global.json', import.meta.url);
const reviewPath = new URL('../data/track-social-review.json', import.meta.url);
const manifestPath = new URL('../data/audits/track-social-audit.json', import.meta.url);
const registryPath = new URL('../data/track-social-links.json', import.meta.url);
const reportPath = new URL('../docs/TRACK_SOCIAL_AUDIT.md', import.meta.url);
const usaBmxEndpoint = 'https://www.usabmx.com/api/backend/bmx-tracks?page=1&limit=0';
const allowPending = process.argv.includes('--allow-pending');
const maximumPageBytes = 3_000_000;
const fetchConcurrency = 6;
const browserConcurrency = 3;
const userAgent = 'TrackLabBMX/0.1 (exact-source public social-link audit)';
const exactBmxNzAddressSources = new Map([
  ['bmxnz-christchurch-city-bmx-club', 'https://www.cinch.org.nz/mobile/2875/entry/3062'],
  ['bmxnz-east-city-bmx-club', 'https://www.aucklandcouncil.govt.nz/en/parks-recreation/find-park-beach/park-detail/130.html'],
  ['bmxnz-mountain-raiders-bmx-club', 'https://mtrbmx.co.nz/'],
  ['bmxnz-north-avon-christchurch-bmx-club', 'https://www.sporty.co.nz/nacbmx'],
  ['bmxnz-north-canterbury-bmx-club', 'https://www.sporty.co.nz/northcanterburybmx/home-1'],
  ['bmxnz-north-harbour-bmx-club', 'https://www.sporty.co.nz/nhbmx/Home'],
  ['bmxnz-southland-bmx-club', 'https://southlandnz.com/listing/elizabeth-park/108/'],
  ['bmxnz-taupo-bmx-club', 'https://taupobmx.org.nz/welcome/'],
]);
const exactBmxNzCoordinateSources = new Map([
  ['bmxnz-mountain-raiders-bmx-club', 'https://mtrbmx.co.nz/'],
  ['bmxnz-north-harbour-bmx-club', 'https://www.sporty.co.nz/nhbmx/Home'],
]);
const excludedImportOsmUrls = new Map([
  ['osm-hu-bmx-palya-way-1089100079', {
    url: 'http://turistautak.hu/poi.php?id=162100',
    disposition: 'excluded-generic-poi-platform',
    reason: 'The retained URL is a generic tourism POI platform entry, not an exact official club page.',
  }],
  ['osm-hu-bmx-palya-way-1312598868', {
    url: 'https://nagymaros.hu/wp-content/uploads/2021/05/El%C5%91terjeszt%C3%A9s-Bringapark.pdf',
    disposition: 'excluded-document-proposal',
    reason: 'The retained URL is a PDF planning proposal, not a current track or club social page.',
  }],
]);

function normalizedName(value) {
  return String(value ?? '').trim().replace(/\s+/gu, ' ').toLowerCase();
}

function safeString(value, maximumLength = 512) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim().replace(/\s+/gu, ' ');
  return trimmed ? trimmed.slice(0, maximumLength) : undefined;
}

function decodeHtml(value) {
  return String(value ?? '')
    .replace(/&amp;/giu, '&')
    .replace(/&quot;/giu, '"')
    .replace(/&#(?:x27|39);/giu, "'")
    .replace(/&#(?:x2f|47);/giu, '/')
    .replace(/&#x([0-9a-f]+);/giu, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/gu, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)));
}

function stripHtml(value) {
  return safeString(decodeHtml(String(value ?? '').replace(/<[^>]*>/gu, ' ')), 160);
}

function canonicalSocialAccountUrl(value) {
  if (typeof value !== 'string' || value.length > 2_048) {
    return undefined;
  }
  try {
    const url = new URL(decodeHtml(value).replace(/\\\//gu, '/'));
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:')
      || url.username
      || url.password
      || url.port
    ) {
      return undefined;
    }
    const hostname = url.hostname.toLowerCase();
    const pathname = url.pathname.replace(/\/{2,}/gu, '/').replace(/\/$/u, '');
    let service;
    if (
      ['tiktok.com', 'www.tiktok.com', 'm.tiktok.com'].includes(hostname)
      && /^\/@[^/]+$/u.test(pathname)
    ) {
      service = 'tiktok';
    } else if (
      ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(hostname)
      && /^\/(?:@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)$/u.test(pathname)
    ) {
      service = 'youtube';
    } else {
      return undefined;
    }
    url.protocol = 'https:';
    url.hostname = hostname === `www.${service}.com` ? hostname : hostname;
    url.pathname = pathname;
    url.search = '';
    url.hash = '';
    return { service, url: url.toString() };
  } catch {
    return undefined;
  }
}

function candidateKey(candidate) {
  return `${candidate.service}|${candidate.url}`;
}

function mergeCandidates(candidates) {
  const byKey = new Map();
  for (const candidate of candidates) {
    const evidenceItems = (Array.isArray(candidate.evidence) ? candidate.evidence.flat(Infinity) : [candidate.evidence])
      .filter(Boolean);
    const existing = byKey.get(candidateKey(candidate));
    if (!existing) {
      byKey.set(candidateKey(candidate), {
        service: candidate.service,
        url: candidate.url,
        evidence: evidenceItems,
      });
      continue;
    }
    for (const evidenceItem of evidenceItems) {
      if (!existing.evidence.some((evidence) => JSON.stringify(evidence) === JSON.stringify(evidenceItem))) {
        existing.evidence.push(evidenceItem);
      }
    }
  }
  return [...byKey.values()].sort((left, right) => (
    left.service.localeCompare(right.service) || left.url.localeCompare(right.url)
  ));
}

function anchorCandidatesFromHtml(html) {
  const candidates = [];
  for (const match of html.matchAll(/<a\b([^>]*)\bhref\s*=\s*(["'])(.*?)\2([^>]*)>([\s\S]*?)<\/a>/giu)) {
    const normalized = canonicalSocialAccountUrl(match[3]);
    if (normalized) {
      candidates.push({
        ...normalized,
        evidence: {
          method: 'html-anchor',
          anchorText: stripHtml(match[5]),
        },
      });
    }
  }
  return candidates;
}

function structuredCandidatesFromHtml(html) {
  const candidates = [];
  for (const match of html.matchAll(/["']((?:tiktok|youtube)(?:_url|Url)?)["']\s*:\s*["']([^"']+)["']/giu)) {
    const normalized = canonicalSocialAccountUrl(match[2]);
    if (normalized) {
      candidates.push({
        ...normalized,
        evidence: { method: 'structured-field', field: match[1] },
      });
    }
  }
  return candidates;
}

function metadataCandidates(track) {
  const candidates = [];
  const fields = [
    ['tiktokUrl', track.sourceRecord?.socialLinkProvenance?.tiktok ? undefined : track.tiktokUrl],
    ['youtubeUrl', track.sourceRecord?.socialLinkProvenance?.youtube ? undefined : track.youtubeUrl],
    ['sourceRecord.osmTags.contact:tiktok', track.sourceRecord?.osmTags?.['contact:tiktok']],
    ['sourceRecord.osmTags.tiktok', track.sourceRecord?.osmTags?.tiktok],
    ['sourceRecord.osmTags.contact:youtube', track.sourceRecord?.osmTags?.['contact:youtube']],
    ['sourceRecord.osmTags.youtube', track.sourceRecord?.osmTags?.youtube],
  ];
  for (const [field, value] of fields) {
    const normalized = canonicalSocialAccountUrl(value);
    if (normalized) {
      candidates.push({
        ...normalized,
        evidence: { method: 'retained-source-metadata', field },
      });
    }
  }
  return mergeCandidates(candidates);
}

function retainedSocialMetadataEvaluations(track) {
  const fields = [
    ['sourceRecord.osmTags.contact:tiktok', track.sourceRecord?.osmTags?.['contact:tiktok']],
    ['sourceRecord.osmTags.tiktok', track.sourceRecord?.osmTags?.tiktok],
    ['sourceRecord.osmTags.contact:youtube', track.sourceRecord?.osmTags?.['contact:youtube']],
    ['sourceRecord.osmTags.youtube', track.sourceRecord?.osmTags?.youtube],
  ];
  return fields.flatMap(([field, value]) => {
    if (value === undefined) {
      return [];
    }
    const normalized = canonicalSocialAccountUrl(value);
    return [{
      field,
      value,
      status: normalized ? 'candidate' : 'rejected-invalid-account-url',
      ...(normalized ?? {}),
    }];
  });
}

function errorCode(error) {
  if (error?.name === 'TimeoutError') {
    return 'timeout';
  }
  const causeCode = safeString(error?.cause?.code, 80);
  return causeCode ? `network-${causeCode.toLowerCase()}` : 'network-error';
}

const publicHostnameChecks = new Map();

async function networkUrlSafety(value) {
  const normalized = normalizePublicHttpUrl(value);
  if (!normalized) {
    return { safe: false, status: 'blocked-host' };
  }
  const hostname = new URL(normalized).hostname.replace(/^\[|\]$/gu, '');
  if (isIP(hostname)) {
    return {
      safe: isPublicIpAddress(hostname),
      status: isPublicIpAddress(hostname) ? 'public' : 'blocked-host',
    };
  }
  if (!publicHostnameChecks.has(hostname)) {
    publicHostnameChecks.set(hostname, lookup(hostname, { all: true, verbatim: true })
      .then((addresses) => {
        const safe = addresses.length > 0
          && addresses.every(({ address }) => isPublicIpAddress(address));
        return { safe, status: safe ? 'public' : 'blocked-host' };
      })
      .catch(() => ({ safe: false, status: 'dns-error' })));
  }
  return publicHostnameChecks.get(hostname);
}

async function fetchText(url, accept = 'text/html') {
  const initialUrl = normalizePublicHttpUrl(url);
  const initialSafety = await networkUrlSafety(initialUrl);
  if (!initialUrl || !initialSafety.safe) {
    return { status: initialSafety.status };
  }
  let lastResult;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      let currentUrl = initialUrl;
      let response;
      for (let redirectCount = 0; redirectCount <= 8; redirectCount += 1) {
        response = await fetch(currentUrl, {
          headers: { Accept: accept, 'User-Agent': userAgent },
          redirect: 'manual',
          signal: AbortSignal.timeout(15_000),
        });
        if (![301, 302, 303, 307, 308].includes(response.status)) {
          break;
        }
        if (redirectCount === 8) {
          return { status: 'too-many-redirects', httpStatus: response.status, finalUrl: currentUrl };
        }
        const location = response.headers.get('location');
        const redirectedUrl = location
          ? normalizePublicHttpUrl(new URL(location, currentUrl).toString())
          : undefined;
        if (!redirectedUrl) {
          await response.body?.cancel();
          return { status: 'blocked-redirect', httpStatus: response.status, finalUrl: currentUrl };
        }
        const redirectSafety = await networkUrlSafety(redirectedUrl);
        if (!redirectSafety.safe) {
          await response.body?.cancel();
          return {
            status: redirectSafety.status === 'dns-error' ? 'redirect-dns-error' : 'blocked-redirect',
            httpStatus: response.status,
            finalUrl: currentUrl,
          };
        }
        await response.body?.cancel();
        currentUrl = redirectedUrl;
      }
      const contentLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > maximumPageBytes) {
        return { status: 'too-large', httpStatus: response.status, finalUrl: response.url };
      }
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let receivedBytes = 0;
      let body = '';
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          receivedBytes += value.byteLength;
          if (receivedBytes > maximumPageBytes) {
            await reader.cancel();
            return { status: 'too-large', httpStatus: response.status, finalUrl: response.url };
          }
          body += decoder.decode(value, { stream: true });
        }
        body += decoder.decode();
      }
      if (receivedBytes > maximumPageBytes) {
        return { status: 'too-large', httpStatus: response.status, finalUrl: response.url };
      }
      lastResult = {
        status: response.ok ? 'ok' : 'http-error',
        httpStatus: response.status,
        finalUrl: response.url,
        body,
      };
      if (response.ok || ![408, 425, 429, 500, 502, 503, 504].includes(response.status)) {
        return lastResult;
      }
    } catch (error) {
      lastResult = { status: errorCode(error) };
    }
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  return lastResult;
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(concurrency, values.length) },
    () => worker(),
  ));
  return results;
}

async function browserAudit(urls) {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    return new Map(urls.map((url) => [url, { status: 'browser-unavailable', candidates: [] }]));
  }
  const context = await browser.newContext({ userAgent });
  const results = await mapWithConcurrency(urls, browserConcurrency, async (url) => {
    const targetSafety = await networkUrlSafety(url);
    if (!targetSafety.safe) {
      return { status: targetSafety.status, candidates: [] };
    }
    const page = await context.newPage();
    await page.route('**/*', async (route) => {
      const requestUrl = route.request().url();
      const networkUrl = /^https?:/iu.test(requestUrl);
      const requestSafety = networkUrl
        ? await networkUrlSafety(requestUrl)
        : { safe: true };
      if (
        (networkUrl && !requestSafety.safe)
        || ['font', 'image', 'media', 'stylesheet'].includes(route.request().resourceType())
      ) {
        await route.abort();
      } else {
        await route.continue();
      }
    });
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      await page.waitForTimeout(750);
      const finalSafety = await networkUrlSafety(page.url());
      if (!finalSafety.safe) {
        return {
          status: finalSafety.status === 'dns-error' ? 'redirect-dns-error' : 'blocked-redirect',
          candidates: [],
        };
      }
      const pageData = await page.evaluate(() => ({
        title: document.title,
        anchors: [...document.querySelectorAll('a[href]')].map((anchor) => ({
          href: anchor.href,
          text: anchor.getAttribute('aria-label') || anchor.getAttribute('title') || anchor.textContent || '',
        })),
      }));
      const candidates = pageData.anchors.flatMap((anchor) => {
        const normalized = canonicalSocialAccountUrl(anchor.href);
        return normalized ? [{
          ...normalized,
          evidence: { method: 'browser-anchor', anchorText: safeString(anchor.text, 160) },
        }] : [];
      });
      return {
        status: response?.ok() ? 'ok' : 'http-error',
        httpStatus: response?.status(),
        finalUrl: page.url(),
        title: safeString(pageData.title, 240),
        candidates: mergeCandidates(candidates),
      };
    } catch (error) {
      return { status: errorCode(error), candidates: [] };
    } finally {
      await page.close();
    }
  });
  await context.close();
  await browser.close();
  return new Map(urls.map((url, index) => [url, results[index]]));
}

function stableHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function pageCandidateWithSource(candidate, page) {
  return {
    ...candidate,
    sourceKind: page.kind,
    sourceUrl: page.finalUrl ?? page.requestedUrl,
    requestedSourceUrl: page.requestedUrl,
  };
}

function reviewKey(value) {
  return `${value.trackId}|${value.service}|${value.url}`;
}

function countBy(values, selector) {
  return Object.fromEntries([...values.reduce((counts, value) => {
    const key = selector(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  }, new Map()).entries()].sort(([left], [right]) => String(left).localeCompare(String(right))));
}

function canonicalPageUrl(value) {
  const normalized = normalizePublicHttpUrl(value);
  if (!normalized) {
    return undefined;
  }
  const url = new URL(normalized);
  url.hash = '';
  return url.toString();
}

function retainedUrlEntry(field, value, disposition, reason, kind) {
  const requestedUrl = typeof value === 'string' ? value.trim() : undefined;
  const normalizedUrl = canonicalPageUrl(requestedUrl);
  if (!normalizedUrl) {
    return {
      field,
      requestedUrl,
      disposition: 'excluded-invalid-or-private-url',
      reason: 'The retained value is not a public HTTP(S) URL and is never requested.',
    };
  }
  return {
    field,
    requestedUrl,
    normalizedUrl,
    disposition,
    reason,
    ...(kind ? { kind } : {}),
  };
}

function retainedSourceUrlEntries(track) {
  const entries = [];
  const add = (...args) => entries.push(retainedUrlEntry(...args));
  if (track.websiteUrl) {
    add(
      'websiteUrl',
      track.websiteUrl,
      'exact-page',
      'The normalized catalog website is retained as the exact track, club, or facility page.',
      'exact-official-website',
    );
  }

  const tags = track.sourceRecord?.osmTags;
  if (tags && typeof tags === 'object') {
    for (const field of ['website', 'contact:website', 'url']) {
      if (tags[field] !== undefined) {
        add(
          `sourceRecord.osmTags.${field}`,
          tags[field],
          'exact-page',
          'The URL is attached to this exact OpenStreetMap track element.',
          'exact-osm-url',
        );
      }
    }
    if (tags['operator:url'] !== undefined) {
      const operatorEntry = retainedUrlEntry(
        'sourceRecord.osmTags.operator:url',
        tags['operator:url'],
        'excluded-operator-page',
        'Operator-level pages are not assumed to be the track or club social identity.',
      );
      const exactUrls = new Set(entries
        .filter((entry) => entry.disposition === 'exact-page')
        .map((entry) => entry.normalizedUrl));
      if (operatorEntry.normalizedUrl && exactUrls.has(operatorEntry.normalizedUrl)) {
        operatorEntry.disposition = 'duplicate-exact-page';
        operatorEntry.reason = 'This operator URL duplicates an exact URL attached to the same track element.';
      }
      entries.push(operatorEntry);
    }
    if (tags['disused:website'] !== undefined) {
      add(
        'sourceRecord.osmTags.disused:website',
        tags['disused:website'],
        'excluded-disused-page',
        'A disused website tag is retained as historical metadata and is not a current social-link source.',
      );
    }
  }

  if (track.providerId === 'bmxnz') {
    const normalizedAddressSource = track.sourceRecord?.normalizedAddressSource;
    if (normalizedAddressSource !== undefined) {
      const normalized = canonicalPageUrl(normalizedAddressSource);
      const parsed = normalized ? new URL(normalized) : undefined;
      if (parsed?.hostname === 'bmx.net.nz' && parsed.pathname.replace(/\/+$/u, '') === '/clubs') {
        add(
          'sourceRecord.normalizedAddressSource',
          normalizedAddressSource,
          'excluded-generic-directory',
          'The BMX.NET.NZ clubs directory is shared across clubs and is not an exact club page.',
        );
      } else if (parsed?.hostname === 'www.openstreetmap.org') {
        add(
          'sourceRecord.normalizedAddressSource',
          normalizedAddressSource,
          'excluded-map-geometry',
          'The OpenStreetMap geometry page establishes location, not the track social identity.',
        );
      } else if (
        exactBmxNzAddressSources.has(track.id)
        && normalized === canonicalPageUrl(exactBmxNzAddressSources.get(track.id))
      ) {
        add(
          'sourceRecord.normalizedAddressSource',
          normalizedAddressSource,
          'exact-page',
          'This retained address source is an exact club or facility page associated with the record.',
          'exact-bmxnz-source-page',
        );
      } else {
        add(
          'sourceRecord.normalizedAddressSource',
          normalizedAddressSource,
          'unclassified',
          'A new BMXNZ address-source URL requires an explicit exact-association classification.',
        );
      }
    }

    const coordinateEvidence = track.sourceRecord?.coordinateEvidence;
    if (coordinateEvidence?.url !== undefined) {
      const normalized = canonicalPageUrl(coordinateEvidence.url);
      const parsed = normalized ? new URL(normalized) : undefined;
      if (parsed?.hostname === 'bmx.net.nz' && parsed.pathname.replace(/\/+$/u, '') === '/clubs') {
        add(
          'sourceRecord.coordinateEvidence.url',
          coordinateEvidence.url,
          'excluded-generic-directory',
          'The shared BMX.NET.NZ coordinate directory is location evidence, not an exact club page.',
        );
      } else if (parsed?.hostname === 'www.openstreetmap.org') {
        add(
          'sourceRecord.coordinateEvidence.url',
          coordinateEvidence.url,
          'excluded-map-geometry',
          'The OpenStreetMap element is coordinate evidence, not a social-link source.',
        );
      } else if (
        exactBmxNzCoordinateSources.has(track.id)
        && normalized === canonicalPageUrl(exactBmxNzCoordinateSources.get(track.id))
      ) {
        add(
          'sourceRecord.coordinateEvidence.url',
          coordinateEvidence.url,
          'exact-page',
          'The retained coordinate evidence explicitly identifies this as the official club page.',
          'exact-bmxnz-source-page',
        );
      } else {
        add(
          'sourceRecord.coordinateEvidence.url',
          coordinateEvidence.url,
          'excluded-coordinate-evidence',
          'Coordinate evidence without an exact official-club assertion is not used for social identity.',
        );
      }
    }
    if (track.sourceRecord?.sourcePage !== undefined) {
      add(
        'sourceRecord.sourcePage',
        track.sourceRecord.sourcePage,
        'excluded-generic-directory',
        'The BMX New Zealand directory page is federation-wide, not an exact club social page.',
      );
    }
  }

  const exactUrls = new Set();
  return entries.map((entry) => {
    if (entry.disposition !== 'exact-page' || !entry.normalizedUrl) {
      return entry;
    }
    if (exactUrls.has(entry.normalizedUrl)) {
      return {
        ...entry,
        disposition: 'duplicate-exact-page',
        reason: 'This retained field duplicates another exact page for the same track.',
      };
    }
    exactUrls.add(entry.normalizedUrl);
    return entry;
  });
}

const [database, osmImport, review] = await Promise.all([
  readFile(databasePath, 'utf8').then(JSON.parse),
  readFile(osmImportPath, 'utf8').then(JSON.parse),
  readFile(reviewPath, 'utf8').then(JSON.parse),
]);
const tracks = Array.isArray(database.tracks) ? database.tracks : [];
if (tracks.length !== 1_305 || new Set(tracks.map((track) => track.id)).size !== tracks.length) {
  throw new Error(`Expected 1,305 unique catalog tracks; found ${tracks.length}.`);
}
const catalogTrackIds = new Set(tracks.map((track) => track.id));
const catalogExcludedRetainedUrls = (osmImport.tracks ?? []).flatMap((track) => {
  const value = track.sourceRecord?.osmTags?.url;
  if (catalogTrackIds.has(track.id) || value === undefined) {
    return [];
  }
  const normalizedUrl = canonicalPageUrl(value);
  let disposition = 'unclassified';
  let reason = 'A newly excluded import URL requires an explicit audit classification.';
  const reviewedExclusion = excludedImportOsmUrls.get(track.id);
  if (
    reviewedExclusion
    && normalizedUrl === canonicalPageUrl(reviewedExclusion.url)
  ) {
    ({ disposition, reason } = reviewedExclusion);
  }
  return [{
    trackId: track.id,
    name: track.name,
    field: 'sourceRecord.osmTags.url',
    requestedUrl: value,
    normalizedUrl,
    disposition,
    reason,
  }];
}).sort((left, right) => left.trackId.localeCompare(right.trackId));

const usaResponse = await fetchText(usaBmxEndpoint, 'application/json');
let usaRecords = [];
if (usaResponse.status === 'ok') {
  try {
    usaRecords = JSON.parse(usaResponse.body).data ?? [];
  } catch {
    usaResponse.status = 'invalid-json';
  }
}
const usaById = new Map(usaRecords.map((record) => [String(record.id), record]));

const retainedSourcesByTrack = new Map();
const pagePlans = [];
for (const track of tracks) {
  const retainedSources = retainedSourceUrlEntries(track);
  retainedSourcesByTrack.set(track.id, retainedSources);
  for (const source of retainedSources) {
    if (source.disposition === 'exact-page') {
      pagePlans.push({
        trackId: track.id,
        kind: source.kind,
        requestedUrl: source.normalizedUrl,
        sourceFields: [source.field],
      });
    }
  }
  if (track.providerId === 'usabmx' && track.sourceRecord?.id !== undefined) {
    const record = usaById.get(String(track.sourceRecord.id));
    if (record && normalizedName(record.name) === normalizedName(track.name)) {
      const requestedUrl = usaBmxMicrositeUrl(record);
      if (requestedUrl) {
        pagePlans.push({
          trackId: track.id,
          kind: 'exact-usa-bmx-microsite',
          requestedUrl,
          usaRecordId: record.id,
          sourceFields: ['USA BMX live directory exact id/name microsite'],
        });
      }
    }
  }
}

const uniqueUrls = [...new Set(pagePlans.map((plan) => plan.requestedUrl))].sort();
const fetchedPages = await mapWithConcurrency(uniqueUrls, fetchConcurrency, async (url) => {
  const result = await fetchText(url);
  const candidates = result.body
    ? mergeCandidates([...anchorCandidatesFromHtml(result.body), ...structuredCandidatesFromHtml(result.body)])
    : [];
  return { ...result, candidates };
});
const fetchedByUrl = new Map(uniqueUrls.map((url, index) => [url, fetchedPages[index]]));
const websiteUrls = [...new Set(pagePlans
  .filter((plan) => plan.kind !== 'exact-usa-bmx-microsite')
  .map((plan) => plan.requestedUrl))].sort();
const browserByUrl = await browserAudit(websiteUrls);

const plansByTrack = new Map();
for (const plan of pagePlans) {
  const fetched = fetchedByUrl.get(plan.requestedUrl) ?? { status: 'not-fetched', candidates: [] };
  const browser = plan.kind !== 'exact-usa-bmx-microsite'
    ? browserByUrl.get(plan.requestedUrl)
    : undefined;
  let association = plan.kind !== 'exact-usa-bmx-microsite' ? 'exact-source-metadata' : 'failed';
  if (plan.kind === 'exact-usa-bmx-microsite' && fetched.body) {
    association = extractUsaBmxMicrositeContact(fetched.body, {
      id: plan.usaRecordId,
      name: tracks.find((track) => track.id === plan.trackId)?.name,
    })?.matched ? 'exact-id-name' : 'failed';
  }
  const page = {
    kind: plan.kind,
    sourceFields: plan.sourceFields,
    requestedUrl: plan.requestedUrl,
    finalUrl: fetched.finalUrl ?? browser?.finalUrl,
    status: fetched.status,
    httpStatus: fetched.httpStatus,
    association,
    ...(browser ? {
      browser: {
        status: browser.status,
        httpStatus: browser.httpStatus,
        finalUrl: browser.finalUrl,
        title: browser.title,
      },
    } : {}),
    candidates: association === 'failed' ? [] : mergeCandidates([
      ...(fetched.status === 'ok' ? fetched.candidates ?? [] : []),
      ...(browser?.status === 'ok' ? browser.candidates ?? [] : []),
    ]),
  };
  const current = plansByTrack.get(plan.trackId) ?? [];
  current.push(page);
  plansByTrack.set(plan.trackId, current);
}

const reviewDecisions = Array.isArray(review.decisions) ? review.decisions : [];
const reviewByKey = new Map(reviewDecisions.map((decision) => [reviewKey(decision), decision]));
const observedReviewKeys = new Set();
const records = tracks.map((track) => {
  const metadata = metadataCandidates(track).map((candidate) => ({
    ...candidate,
    sourceKind: 'retained-source-metadata',
    sourceUrl: track.sourceUrl,
    requestedSourceUrl: track.sourceUrl,
  }));
  const pages = (plansByTrack.get(track.id) ?? []).sort((left, right) => left.kind.localeCompare(right.kind));
  const pageCandidates = pages.flatMap((page) => page.candidates.map((candidate) => (
    pageCandidateWithSource(candidate, page)
  )));
  const candidates = mergeCandidates([...metadata, ...pageCandidates].map((candidate) => ({
    service: candidate.service,
    url: candidate.url,
    evidence: {
      sourceKind: candidate.sourceKind,
      sourceUrl: candidate.sourceUrl,
      requestedSourceUrl: candidate.requestedSourceUrl,
      evidence: candidate.evidence,
    },
  }))).map((candidate) => {
    const decision = reviewByKey.get(reviewKey({ trackId: track.id, ...candidate }));
    if (decision) {
      observedReviewKeys.add(reviewKey(decision));
    }
    return {
      ...candidate,
      decision: decision?.decision ?? 'unreviewed',
      reason: decision?.reason ?? 'New exact-source candidate requires explicit review.',
    };
  });
  const verified = candidates.filter((candidate) => candidate.decision === 'verified');
  const outcome = candidates.some((candidate) => candidate.decision === 'unreviewed')
    ? 'review-required'
    : verified.length > 0 ? 'verified-links' : pages.length > 0 ? 'checked-no-verified-links' : 'no-exact-page-available';
  return {
    trackId: track.id,
    name: track.name,
    providerId: track.providerId,
    metadataStatus: 'checked',
    retainedSocialMetadata: retainedSocialMetadataEvaluations(track),
    retainedSourceUrls: retainedSourcesByTrack.get(track.id) ?? [],
    pages,
    candidates,
    outcome,
  };
});

const staleReview = reviewDecisions.filter((decision) => !observedReviewKeys.has(reviewKey(decision)));
const pendingCandidates = records.flatMap((record) => record.candidates
  .filter((candidate) => candidate.decision === 'unreviewed')
  .map((candidate) => ({ trackId: record.trackId, name: record.name, ...candidate })));
const invalidDecisionValues = reviewDecisions.filter((decision) => !['verified', 'rejected'].includes(decision.decision));
const conflictingVerified = records.flatMap((record) => ['tiktok', 'youtube'].flatMap((service) => {
  const links = record.candidates.filter((candidate) => (
    candidate.service === service && candidate.decision === 'verified'
  ));
  return links.length > 1 ? [{ trackId: record.trackId, service, links: links.map((link) => link.url) }] : [];
}));
const verifiedLinks = records.flatMap((record) => {
  const verified = record.candidates.filter((candidate) => candidate.decision === 'verified');
  if (verified.length === 0) {
    return [];
  }
  return [{
    trackId: record.trackId,
    ...Object.fromEntries(verified.map((candidate) => {
      const evidence = candidate.evidence[0];
      return [candidate.service, {
        url: candidate.url,
        sourceUrl: evidence.sourceUrl,
        requestedSourceUrl: evidence.requestedSourceUrl,
        sourceKind: evidence.sourceKind,
        evidence: evidence.evidence,
      }];
    })),
  }];
});
const duplicateVerifiedUrls = Object.entries(countBy(
  verifiedLinks.flatMap((entry) => ['tiktok', 'youtube'].flatMap((service) => (
    entry[service] ? [{ service, url: entry[service].url, trackId: entry.trackId }] : []
  ))),
  (entry) => `${entry.service}|${entry.url}`,
)).filter(([, count]) => count > 1).map(([key, count]) => ({ key, count }));

const summary = {
  tracksEvaluated: records.length,
  metadataEvaluated: records.length,
  retainedSourceUrlsEvaluated: records.reduce((count, record) => (
    count + record.retainedSourceUrls.length
  ), 0),
  retainedSourceDispositionCounts: countBy(
    records.flatMap((record) => record.retainedSourceUrls),
    (entry) => entry.disposition,
  ),
  retainedSocialMetadataValuesEvaluated: records.reduce((count, record) => (
    count + record.retainedSocialMetadata.length
  ), 0),
  retainedSourceFieldCounts: countBy(
    records.flatMap((record) => record.retainedSourceUrls),
    (entry) => entry.field,
  ),
  catalogExcludedRetainedUrlsEvaluated: catalogExcludedRetainedUrls.length,
  unclassifiedRetainedUrls: records.reduce((count, record) => (
    count + record.retainedSourceUrls.filter((entry) => entry.disposition === 'unclassified').length
  ), 0) + catalogExcludedRetainedUrls.filter((entry) => entry.disposition === 'unclassified').length,
  exactPagesPlanned: pagePlans.length,
  uniquePagesRequested: uniqueUrls.length,
  exactPagesReached: records.flatMap((record) => record.pages).filter((page) => (
    page.association !== 'failed' && (page.status === 'ok' || page.browser?.status === 'ok')
  )).length,
  exactPagesUnreachable: records.flatMap((record) => record.pages).filter((page) => (
    page.association !== 'failed' && page.status !== 'ok' && page.browser?.status !== 'ok'
  )).length,
  exactAssociationsFailed: records.flatMap((record) => record.pages)
    .filter((page) => page.association === 'failed').length,
  pageStatusCounts: countBy(records.flatMap((record) => record.pages), (page) => page.status),
  browserStatusCounts: countBy(records.flatMap((record) => record.pages.flatMap((page) => (
    page.browser ? [page.browser] : []
  ))), (browser) => browser.status),
  outcomeCounts: countBy(records, (record) => record.outcome),
  candidatesFound: records.reduce((count, record) => count + record.candidates.length, 0),
  pendingCandidates: pendingCandidates.length,
  verifiedTikTok: verifiedLinks.filter((entry) => entry.tiktok).length,
  verifiedYouTube: verifiedLinks.filter((entry) => entry.youtube).length,
  rejectedCandidates: records.reduce((count, record) => count + record.candidates.filter((candidate) => (
    candidate.decision === 'rejected'
  )).length, 0),
  staleReviewDecisions: staleReview.length,
  conflictingVerified: conflictingVerified.length,
  duplicateVerifiedUrls: duplicateVerifiedUrls.length,
};
const manifestBody = {
  schemaVersion: 1,
  catalogGeneratedAt: database.generatedAt,
  policy: {
    exactSourcesOnly: true,
    acceptedTikTokPaths: '/@account',
    acceptedYouTubePaths: '/@account, /channel/id, /c/name, /user/name',
    rejectedContentPaths: 'YouTube watch/shorts/live/playlist and TikTok post/share links',
    nameSearchUsed: false,
    normalBuildUsesNetwork: false,
    privateAndReservedHostsRequested: false,
  },
  usaBmxDirectoryStatus: usaResponse.status,
  summary,
  duplicateVerifiedUrls,
  staleReview,
  invalidDecisionValues,
  conflictingVerified,
  pendingCandidates,
  catalogExcludedRetainedUrls,
  records,
};
const existingManifest = await readFile(manifestPath, 'utf8').then(JSON.parse).catch(() => null);
const auditedAt = existingManifest
  && stableHash({ ...existingManifest, auditedAt: undefined }) === stableHash(manifestBody)
  ? existingManifest.auditedAt
  : new Date().toISOString();
const manifest = { auditedAt, ...manifestBody };
const registry = {
  schemaVersion: 1,
  auditedAt,
  tracksEvaluated: records.length,
  links: verifiedLinks.sort((left, right) => left.trackId.localeCompare(right.trackId)),
};
const report = `# Track social-link audit\n\n`
  + `Audited: ${auditedAt}\n\n`
  + `- Tracks evaluated: ${summary.tracksEvaluated}\n`
  + `- Retained metadata records checked: ${summary.metadataEvaluated}\n`
  + `- Retained TikTok/YouTube metadata values evaluated: ${summary.retainedSocialMetadataValuesEvaluated}\n`
  + `- Retained source URLs evaluated: ${summary.retainedSourceUrlsEvaluated} ${JSON.stringify(summary.retainedSourceDispositionCounts)}\n`
  + `- Excluded import-only retained URLs evaluated: ${summary.catalogExcludedRetainedUrlsEvaluated}\n`
  + `- Exact pages planned / unique requested: ${summary.exactPagesPlanned} / ${summary.uniquePagesRequested}\n`
  + `- Exact pages reached / unreachable / association failed: ${summary.exactPagesReached} / ${summary.exactPagesUnreachable} / ${summary.exactAssociationsFailed}\n`
  + `- Candidates: ${summary.candidatesFound} (${summary.pendingCandidates} pending, ${summary.rejectedCandidates} rejected)\n`
  + `- Verified TikTok: ${summary.verifiedTikTok}\n`
  + `- Verified YouTube: ${summary.verifiedYouTube}\n`
  + `- Page statuses: ${JSON.stringify(summary.pageStatusCounts)}\n`
  + `- Browser statuses: ${JSON.stringify(summary.browserStatusCounts)}\n`
  + `- Outcomes: ${JSON.stringify(summary.outcomeCounts)}\n`
  + `- Name-only searches used: no\n`
  + `- Normal build network access: none\n\n`
  + `Candidate decisions and per-track page errors are retained in `
  + '`data/audits/track-social-audit.json`.'
  + `\n`;

await mkdir(new URL('../data/audits/', import.meta.url), { recursive: true });
await Promise.all([
  writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`),
  writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`),
  writeFile(reportPath, report),
]);

console.log(JSON.stringify(summary, null, 2));
if (
  (!allowPending && pendingCandidates.length > 0)
  || staleReview.length > 0
  || invalidDecisionValues.length > 0
  || conflictingVerified.length > 0
  || duplicateVerifiedUrls.length > 0
  || summary.unclassifiedRetainedUrls > 0
  || tracks.length !== 1_305
) {
  process.exitCode = 1;
}
