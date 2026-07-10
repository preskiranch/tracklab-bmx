import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import * as persistence from './persistence.mjs';
import {
  createRacerSubscriptionCheckout,
  racerMonthlyCents,
  squareCheckoutConfigStatus,
  verifyRacerSubscriptionOrder,
} from './squareBilling.mjs';
import {
  applySecurityHeaders,
  createRateLimiter,
  mutationOriginAllowed,
  pathIsInside,
  publicRequestOrigin,
  requestClientIp,
  staticCacheControl,
} from './httpSecurity.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(__dirname, '..');
const distDirectory = path.join(rootDirectory, 'dist');
const port = Number(process.env.PORT ?? 10000);
const websocketPath = '/multiplayer';

const clients = new Map();
const rooms = new Map();
const challenges = new Map();
const matchInvites = new Map();
const persistedRaceResultKeys = new Map();
const voteTimers = new Map();
const routeSelectTimers = new Map();
const maxRaceBikeCount = 4;
const latencyGoodMs = 90;
const latencyOkMs = 180;
const defaultAdminAccountEmail = 'preskiranch@gmail.com';
const authCookieName = 'tracklab_session';
const authSessionMaxAgeSeconds = 60 * 60 * 24 * 30;
const authSessionTouchIntervalMs = 5 * 60 * 1000;
const billingCheckoutMaxAgeMs = 60 * 60 * 1000;
const transientStateMaxAgeMs = 6 * 60 * 60 * 1000;
const scryptAsync = promisify(scryptCallback);
const authRateLimiter = createRateLimiter();
const billingRateLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000 });
const adminAccountEmails = new Set(
  String(process.env.TRACKLAB_ADMIN_EMAILS || defaultAdminAccountEmail)
    .split(',')
    .map((email) => sanitizeEmail(email))
    .filter(Boolean),
);

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.mp3', 'audio/mpeg'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
]);

function randomId(prefix, length = 8) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let value = '';
  for (let index = 0; index < length; index += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `${prefix}-${value}`;
}

function rememberRaceResultKey(key, now = Date.now()) {
  if (persistedRaceResultKeys.has(key)) {
    return false;
  }

  persistedRaceResultKeys.set(key, now);
  return true;
}

function pruneTransientState(now = Date.now()) {
  for (const [key, savedAt] of persistedRaceResultKeys.entries()) {
    if (savedAt <= now - transientStateMaxAgeMs) {
      persistedRaceResultKeys.delete(key);
    }
  }

  for (const [id, challenge] of challenges.entries()) {
    if (challenge.createdAt <= now - (15 * 60 * 1000)) {
      challenges.delete(id);
      void persistence.updateChallenge(id, 'expired');
    }
  }

  for (const [id, invite] of matchInvites.entries()) {
    if (invite.createdAt <= now - (15 * 60 * 1000)) {
      matchInvites.delete(id);
    }
  }
}

function sanitizeText(value, fallback, maxLength = 80) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  return (text || fallback).slice(0, maxLength);
}

function sanitizeGuestKey(value, fallback) {
  const text = sanitizeText(value, fallback, 160);
  return text.replace(/[^a-zA-Z0-9:._-]/g, '').slice(0, 160) || fallback;
}

function sanitizeEmail(value) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text.slice(0, 160) : '';
}

function defaultRoomFlow() {
  return {
    phase: 'lobby',
    candidates: [],
    votes: {},
    routeChoices: {},
    deadlineAt: null,
    selectedTrackId: null,
    raceToken: null,
    raceStartAt: null,
  };
}

function isAdminEmail(email) {
  return adminAccountEmails.has(sanitizeEmail(email));
}

function clampBikeSeats(value) {
  return Math.max(1, Math.min(maxRaceBikeCount, Math.round(Number(value) || 1)));
}

function membershipForAccount(user) {
  if (isAdminEmail(user?.email)) {
    return { tier: 'racer', bikeSeats: maxRaceBikeCount };
  }

  const tier = user?.membershipTier === 'racer' ? 'racer' : 'spectator';
  return {
    tier,
    bikeSeats: tier === 'racer' ? clampBikeSeats(user?.bikeSeats) : 1,
  };
}

function publicAuthUser(user) {
  if (!user) {
    return null;
  }

  const membership = membershipForAccount(user);
  return {
    id: user.id,
    profileKey: `user:${user.id}`,
    email: user.email,
    name: user.displayName,
    admin: isAdminEmail(user.email),
    membership,
  };
}

function sessionCookieOptions(request, maxAgeSeconds = authSessionMaxAgeSeconds) {
  const forwardedProto = String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const isSecure = forwardedProto === 'https' || request.headers.host?.includes('onrender.com');
  const secure = isSecure ? '; Secure' : '';
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

function setAuthCookie(response, request, token) {
  response.setHeader('Set-Cookie', `${authCookieName}=${encodeURIComponent(token)}; ${sessionCookieOptions(request)}`);
}

function clearAuthCookie(response, request) {
  response.setHeader('Set-Cookie', `${authCookieName}=; ${sessionCookieOptions(request, 0)}`);
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function createSessionToken() {
  return randomBytes(32).toString('base64url');
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString('base64url');
  const key = await scryptAsync(password, salt, 64);
  return `scrypt:${salt}:${Buffer.from(key).toString('base64url')}`;
}

async function verifyPassword(password, passwordHash) {
  const [algorithm, salt, expected] = String(passwordHash || '').split(':');
  if (algorithm !== 'scrypt' || !salt || !expected) {
    return false;
  }

  const expectedKey = Buffer.from(expected, 'base64url');
  const actualKey = Buffer.from(await scryptAsync(password, salt, expectedKey.length));
  return actualKey.length === expectedKey.length && timingSafeEqual(actualKey, expectedKey);
}

function sanitizePassword(value) {
  return typeof value === 'string' ? value : '';
}

function validateAccountPayload(payload, { requireName }) {
  const email = sanitizeEmail(payload?.email);
  const password = sanitizePassword(payload?.password);
  const name = sanitizeText(payload?.name, '', 64);

  if (!email) {
    return { error: 'Enter a valid email address.' };
  }

  if (password.length < 8) {
    return { error: 'Password must be at least 8 characters.' };
  }

  if (password.length > 128) {
    return { error: 'Password must be 128 characters or fewer.' };
  }

  if (requireName && !name) {
    return { error: 'Enter your name or studio name.' };
  }

  return { email, password, name };
}

async function createSignedInResponse(request, response, user, statusCode = 200) {
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + authSessionMaxAgeSeconds * 1000).toISOString();
  await persistence.createAuthSession({
    id: randomUUID(),
    userId: user.id,
    tokenHash: tokenHash(token),
    expiresAt,
  });
  setAuthCookie(response, request, token);
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
  response.end(JSON.stringify({ user: publicAuthUser(user) }));
}

async function currentAuthSession(request) {
  const token = cookieValue(request, authCookieName);
  if (!token) {
    return null;
  }

  const session = await persistence.findAuthSession(tokenHash(token));
  if (!session?.user) {
    return null;
  }

  const lastSeenAt = Date.parse(session.lastSeen ?? '');
  if (!Number.isFinite(lastSeenAt) || Date.now() - lastSeenAt >= authSessionTouchIntervalMs) {
    void persistence.touchAuthSession(tokenHash(token));
  }
  return { ...session, token };
}

async function requireAuthSession(request, response) {
  const session = await currentAuthSession(request);
  if (!session?.user) {
    writeJson(response, 401, { error: 'Sign in to continue.' });
    return null;
  }

  return session;
}

function authProfileKey(user) {
  return `user:${user.id}`;
}

function enforceRateLimit(request, response, limiter, limit, scope) {
  const result = limiter.check(`${scope}:${requestClientIp(request)}`, limit);
  response.setHeader('RateLimit-Limit', String(result.limit));
  response.setHeader('RateLimit-Remaining', String(result.remaining));
  if (result.allowed) {
    return true;
  }

  response.setHeader('Retry-After', String(result.retryAfterSeconds));
  writeJson(response, 429, { error: 'Too many requests. Wait a few minutes and try again.' });
  return false;
}

function writeJson(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache',
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

function cookieValue(request, name) {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) {
    return '';
  }

  const cookies = cookieHeader.split(';');
  for (const cookie of cookies) {
    const [rawName, ...rawValue] = cookie.trim().split('=');
    if (rawName === name) {
      return decodeURIComponent(rawValue.join('=') || '');
    }
  }

  return '';
}

function tracklabManifest(profileKey) {
  const safeProfileKey = sanitizeGuestKey(profileKey, '');
  const startUrl = safeProfileKey
    ? `/?profileKey=${encodeURIComponent(safeProfileKey)}`
    : '/';

  return {
    id: '/tracklab-bmx',
    name: 'TrackLab BMX',
    short_name: 'TrackLab',
    description: 'Wattbike BMX racing and training platform.',
    start_url: startUrl,
    scope: '/',
    display: 'fullscreen',
    orientation: 'landscape',
    background_color: '#05080c',
    theme_color: '#05080c',
    icons: [
      {
        src: '/tracklab-icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any maskable',
      },
    ],
  };
}

function sanitizeTrack(value) {
  if (!value || typeof value !== 'object') {
    return {
      id: 'unknown-track',
      name: 'Unselected track',
      country: 'Unknown',
      state: 'Unknown',
    };
  }

  return {
    id: sanitizeText(value.id, 'unknown-track', 120),
    name: sanitizeText(value.name, 'Unselected track', 120),
    country: sanitizeText(value.country, 'Unknown', 80),
    state: sanitizeText(value.state, 'Unknown', 80),
  };
}

function sanitizeTrackVoteCandidate(value) {
  const track = sanitizeTrack(value);
  return {
    ...track,
    hasPedalZones: Boolean(value?.hasPedalZones),
    hasSplits: Boolean(value?.hasSplits),
  };
}

function sanitizeTrackVoteCandidates(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  return value
    .map(sanitizeTrackVoteCandidate)
    .filter((candidate) => {
      if (!candidate.id || candidate.id === 'unknown-track' || !candidate.hasPedalZones || seen.has(candidate.id)) {
        return false;
      }

      seen.add(candidate.id);
      return true;
    })
    .slice(0, 3);
}

function sanitizeBranchChoice(value) {
  return value === 'b' ? 'b' : 'a';
}

function sanitizeUserDataPatch(value) {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const patch = {};
  if (value.trackMappings && typeof value.trackMappings === 'object' && !Array.isArray(value.trackMappings)) {
    patch.trackMappings = value.trackMappings;
  }
  if (Array.isArray(value.customRoutes)) {
    patch.customRoutes = value.customRoutes.slice(0, 250);
  }
  if (Array.isArray(value.bikeProfiles)) {
    patch.bikeProfiles = value.bikeProfiles.slice(0, 64);
  }
  return patch;
}

function sanitizeTrackPoint(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const lat = finiteNumber(value.lat, Number.NaN);
  const lng = finiteNumber(value.lng, Number.NaN);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }

  return {
    lat: Number(lat.toFixed(7)),
    lng: Number(lng.toFixed(7)),
  };
}

function sanitizeTrackPoints(value, maxPoints = 1500) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, maxPoints)
    .map(sanitizeTrackPoint)
    .filter(Boolean);
}

function sanitizeZoneBranchSelections(value, splitSections = []) {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const knownSplitIds = new Set(splitSections.map((section) => section.id));
  const entries = Object.entries(value)
    .filter(([splitId, branch]) => (
      typeof splitId === 'string'
      && splitId
      && (knownSplitIds.size === 0 || knownSplitIds.has(splitId))
      && (branch === 'a' || branch === 'b')
    ))
    .sort(([left], [right]) => left.localeCompare(right));

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function sanitizeZone(value, index, lengthMeters, restAfterSeconds, splitSections = []) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const startMeter = Math.max(0, Math.min(lengthMeters, finiteNumber(value.startMeter, 0)));
  const endMeter = Math.max(0, Math.min(lengthMeters, finiteNumber(value.endMeter, 0)));
  if (endMeter - startMeter < 1) {
    return null;
  }

  const zoneType = ['pedal', 'recovery', 'technical'].includes(value.type) ? value.type : 'pedal';
  const branchSelections = sanitizeZoneBranchSelections(value.branchSelections, splitSections);
  return {
    id: sanitizeText(value.id, `pedal-zone-${index + 1}`, 80),
    name: sanitizeText(value.name, `Pedal Zone ${index + 1}`, 80),
    startMeter: Number(startMeter.toFixed(2)),
    endMeter: Number(endMeter.toFixed(2)),
    type: zoneType,
    restAfterSeconds: Math.max(0, Math.min(30, finiteNumber(value.restAfterSeconds, restAfterSeconds))),
    ...(branchSelections ? { branchSelections } : {}),
  };
}

function sanitizeZoneBoundarySet(value, index, lengthMeters, splitSections = []) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const branchSelections = sanitizeZoneBranchSelections(value.branchSelections, splitSections);
  const maxBoundaryMeters = Math.max(10000, lengthMeters);
  const boundaryMeters = Array.isArray(value.boundaryMeters)
    ? value.boundaryMeters
      .slice(0, 500)
      .map((meter) => Math.max(0, Math.min(maxBoundaryMeters, finiteNumber(meter, 0))))
      .sort((a, b) => a - b)
    : [];

  if (boundaryMeters.length === 0 && branchSelections) {
    return null;
  }

  return {
    id: sanitizeText(value.id, branchSelections ? `branch-zone-set-${index + 1}` : 'default', 120),
    name: sanitizeText(value.name, branchSelections?.[Object.keys(branchSelections)[0]] === 'b' ? 'Pro Set' : 'Amateur Line', 120),
    ...(branchSelections ? { branchSelections } : {}),
    boundaryMeters: boundaryMeters.map((meter) => Number(meter.toFixed(2))),
  };
}

function sanitizeSplitSections(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 12).map((section, sectionIndex) => {
    if (!section || typeof section !== 'object') {
      return null;
    }

    const splitPoint = sanitizeTrackPoint(section.splitPoint);
    const mergePoint = sanitizeTrackPoint(section.mergePoint);
    if (!splitPoint || !mergePoint) {
      return null;
    }

    const branches = Array.isArray(section.branches)
      ? section.branches
        .filter((branch) => branch?.id === 'a' || branch?.id === 'b')
        .slice(0, 2)
        .map((branch) => {
          const points = sanitizeTrackPoints(branch.points, 400);
          if (points.length < 2) {
            return null;
          }

          return {
            id: branch.id,
            name: sanitizeText(branch.name, branch.id === 'b' ? 'Pro Set' : 'Amateur Line', 80),
            points,
            lengthMeters: Math.max(1, finiteNumber(branch.lengthMeters, 1)),
          };
        })
        .filter(Boolean)
      : [];

    if (branches.length === 0) {
      return null;
    }

    return {
      id: sanitizeText(section.id, `split-${sectionIndex + 1}`, 80),
      name: sanitizeText(section.name, `Split ${sectionIndex + 1} / Merge ${sectionIndex + 1}`, 80),
      index: Math.max(1, Math.round(finiteNumber(section.index, sectionIndex + 1))),
      splitPoint,
      mergePoint,
      branches,
    };
  }).filter(Boolean);
}

function sanitizeRouteVariant(value, fallbackId = 'amateur') {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const centerline = sanitizeTrackPoints(value.centerline);
  if (centerline.length < 2) {
    return null;
  }

  const id = value.id === 'pro' ? 'pro' : fallbackId === 'pro' ? 'pro' : 'amateur';
  const lengthMeters = Math.max(1, finiteNumber(value.lengthMeters, 1));
  const restAfterSeconds = Math.max(0, Math.min(30, finiteNumber(value.restAfterSeconds, 1)));
  const splitSections = sanitizeSplitSections(value.splitSections);
  const zoneBoundaryMeters = Array.isArray(value.zoneBoundaryMeters)
    ? value.zoneBoundaryMeters
      .slice(0, 500)
      .map((meter) => Math.max(0, Math.min(lengthMeters, finiteNumber(meter, 0))))
      .sort((a, b) => a - b)
    : [];

  return {
    id,
    name: sanitizeText(value.name, id === 'pro' ? 'Pro Track' : 'Amateur Track', 80),
    restAfterSeconds,
    lengthMeters,
    centerline,
    startGate: sanitizeTrackPoint(value.startGate) ?? centerline[0],
    finishLine: sanitizeTrackPoint(value.finishLine) ?? centerline[centerline.length - 1],
    zoneBoundaryMeters,
    zones: Array.isArray(value.zones)
      ? value.zones
        .slice(0, 250)
        .map((zone, index) => sanitizeZone(zone, index, lengthMeters, restAfterSeconds, splitSections))
        .filter(Boolean)
      : [],
    zoneBoundarySets: Array.isArray(value.zoneBoundarySets)
      ? value.zoneBoundarySets
        .slice(0, 24)
        .map((set, index) => sanitizeZoneBoundarySet(set, index, lengthMeters, splitSections))
        .filter(Boolean)
      : [],
    splitSections,
  };
}

function sanitizePublicTrackMapping(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const routeVariants = Array.isArray(value.routeVariants)
    ? value.routeVariants
      .slice(0, 2)
      .map((variant, index) => sanitizeRouteVariant(variant, index === 1 ? 'pro' : 'amateur'))
      .filter(Boolean)
    : [];
  const topLevelRoute = sanitizeRouteVariant(value);

  if (!topLevelRoute && routeVariants.length === 0) {
    return null;
  }

  const primaryRoute = topLevelRoute ?? routeVariants[0];
  const lengthMeters = Math.max(1, finiteNumber(value.lengthMeters, primaryRoute.lengthMeters));
  const restAfterSeconds = Math.max(0, Math.min(30, finiteNumber(value.restAfterSeconds, primaryRoute.restAfterSeconds)));
  const splitSections = sanitizeSplitSections(value.splitSections ?? primaryRoute.splitSections);
  const mapping = {
    version: 1,
    trackId: sanitizeText(value.trackId, '', 140),
    trackName: sanitizeText(value.trackName, 'Mapped BMX track', 140),
    country: sanitizeText(value.country, 'Unknown', 80),
    state: sanitizeText(value.state, 'Unknown', 80),
    savedAt: sanitizeText(value.savedAt, new Date().toISOString(), 40),
    routeStatus: 'user-mapped',
    restAfterSeconds,
    lengthMeters,
    centerline: primaryRoute.centerline,
    startGate: primaryRoute.startGate,
    finishLine: primaryRoute.finishLine,
    zoneBoundaryMeters: Array.isArray(value.zoneBoundaryMeters)
      ? value.zoneBoundaryMeters
        .slice(0, 500)
        .map((meter) => Math.max(0, Math.min(lengthMeters, finiteNumber(meter, 0))))
        .sort((a, b) => a - b)
      : primaryRoute.zoneBoundaryMeters,
    zones: Array.isArray(value.zones)
      ? value.zones
        .slice(0, 250)
        .map((zone, index) => sanitizeZone(zone, index, lengthMeters, restAfterSeconds, splitSections))
        .filter(Boolean)
      : primaryRoute.zones,
    zoneBoundarySets: Array.isArray(value.zoneBoundarySets)
      ? value.zoneBoundarySets
        .slice(0, 24)
        .map((set, index) => sanitizeZoneBoundarySet(set, index, lengthMeters, splitSections))
        .filter(Boolean)
      : primaryRoute.zoneBoundarySets,
    splitSections,
  };

  if (!mapping.trackId || mapping.centerline.length < 2) {
    return null;
  }

  if (routeVariants.length > 0) {
    mapping.routeVariants = routeVariants;
  }

  return mapping;
}

function sanitizePublicTrackMappingsPayload(value) {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const rawMappings = value.mapping
    ? { [value.mapping.trackId ?? 'mapping']: value.mapping }
    : value.trackMappings;
  if (!rawMappings || typeof rawMappings !== 'object' || Array.isArray(rawMappings)) {
    return {};
  }

  return Object.fromEntries(
    Object.values(rawMappings)
      .slice(0, 100)
      .map(sanitizePublicTrackMapping)
      .filter(Boolean)
      .map((mapping) => [mapping.trackId, mapping]),
  );
}

function sanitizeGhostPoint(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const elapsedMs = Math.max(0, Math.round(finiteNumber(value.elapsedMs, Number.NaN)));
  const distanceMeters = Math.max(0, finiteNumber(value.distanceMeters, Number.NaN));
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(distanceMeters)) {
    return null;
  }

  const actualBranches = value.actualBranches && typeof value.actualBranches === 'object'
    ? Object.fromEntries(Object.entries(value.actualBranches).filter(([, branch]) => branch === 'a' || branch === 'b'))
    : {};

  return {
    elapsedMs,
    distanceMeters: Number(distanceMeters.toFixed(2)),
    velocityMps: Number(Math.max(0, finiteNumber(value.velocityMps, 0)).toFixed(2)),
    phase: value.phase === 'airborne' || value.phase === 'landing' ? value.phase : 'pedaling',
    pitch: Number(finiteNumber(value.pitch, 0).toFixed(3)),
    rank: Math.max(1, Math.min(64, Math.round(finiteNumber(value.rank, 1)))),
    actualBranches,
  };
}

function sanitizeGhostLapPayload(value, profileKey) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const trackId = sanitizeText(value.trackId, '', 140);
  const ownerKey = sanitizeGuestKey(value.ownerKey ?? profileKey, profileKey);
  const riderName = sanitizeText(value.riderName, '', 80);
  const finishTimeMs = Math.round(finiteNumber(value.finishTimeMs, Number.NaN));
  const points = Array.isArray(value.points)
    ? value.points.slice(0, 900).map(sanitizeGhostPoint).filter(Boolean).sort((left, right) => left.elapsedMs - right.elapsedMs)
    : [];

  if (!trackId || !ownerKey || !riderName || !Number.isFinite(finishTimeMs) || finishTimeMs <= 0 || points.length < 2) {
    return null;
  }

  return {
    version: 1,
    id: sanitizeText(value.id, `ghost-${randomUUID()}`, 180).replace(/[^a-zA-Z0-9:._-]/g, '-'),
    trackId,
    trackName: sanitizeText(value.trackName, 'Unknown track', 140),
    ...(value.routeVariantId === 'amateur' || value.routeVariantId === 'pro' ? { routeVariantId: value.routeVariantId } : {}),
    riderName,
    ownerKey,
    ownerName: sanitizeText(value.ownerName, 'TrackLab rider', 80),
    colorName: ['lime', 'red', 'blue', 'yellow'].includes(value.colorName) ? value.colorName : 'lime',
    accent: sanitizeText(value.accent, '#7ade36', 32),
    source: 'personal',
    finishTimeMs,
    thirtyFootTimeMs: value.thirtyFootTimeMs == null ? null : Math.max(0, Math.round(finiteNumber(value.thirtyFootTimeMs, 0))),
    savedAt: Math.max(0, Math.round(finiteNumber(value.savedAt, Date.now()))),
    summary: value.summary && typeof value.summary === 'object' ? value.summary : {},
    points,
  };
}

function readJsonBody(request, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let totalBytes = 0;
    const chunks = [];

    request.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        reject(new Error('Request body is too large.'));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });

    request.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Request body must be valid JSON.'));
      }
    });

    request.on('error', reject);
  });
}

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function latencyQualityForMs(value) {
  const latencyMs = Number(value);
  if (!Number.isFinite(latencyMs) || latencyMs <= 0) {
    return 'unknown';
  }

  if (latencyMs <= latencyGoodMs) {
    return 'good';
  }

  if (latencyMs <= latencyOkMs) {
    return 'ok';
  }

  return 'poor';
}

function nullableFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function sanitizeRaceSummaryEntry(value, index) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const playerId = Math.max(1, Math.min(maxRaceBikeCount, Math.round(finiteNumber(value.playerId, index + 1))));
  const nullableMetric = (metric, max) => {
    const number = nullableFiniteNumber(metric);
    return number == null ? null : Math.max(0, Math.min(max, number));
  };

  return {
    playerId,
    riderName: sanitizeText(value.riderName, `Rider ${playerId}`, 64),
    colorName: ['lime', 'red', 'blue', 'yellow'].includes(value.colorName) ? value.colorName : 'lime',
    accent: sanitizeText(value.accent, '#7ade36', 24),
    deviceLabel: sanitizeText(value.deviceLabel, 'Wattbike', 120),
    rank: Math.max(1, Math.min(maxRaceBikeCount, Math.round(finiteNumber(value.rank, playerId)))),
    finishTimeMs: nullableMetric(value.finishTimeMs, 24 * 60 * 60 * 1000),
    thirtyFootTimeMs: nullableMetric(value.thirtyFootTimeMs, 60 * 1000),
    distanceMeters: Math.max(0, Math.min(100_000, finiteNumber(value.distanceMeters, 0))),
    sampleCount: Math.max(0, Math.min(1_000_000, Math.round(finiteNumber(value.sampleCount, 0)))),
    topSpeedKph: nullableMetric(value.topSpeedKph, 160),
    averageSpeedKph: nullableMetric(value.averageSpeedKph, 160),
    topCadence: nullableMetric(value.topCadence, 300),
    averageCadence: nullableMetric(value.averageCadence, 300),
    topWatts: nullableMetric(value.topWatts, 5000),
    averageWatts: nullableMetric(value.averageWatts, 5000),
  };
}

function sanitizeRaceState(value, client, room) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const allowedRiderCount = roomRacerSeatCountForMember(room, client.id);
  const riders = Array.isArray(value.riders)
    ? value.riders.slice(0, allowedRiderCount).map((rider, index) => {
      const colorName = ['lime', 'red', 'blue', 'yellow'].includes(rider?.colorName)
        ? rider.colorName
        : ['lime', 'red', 'blue', 'yellow'][index % 4];

      return {
        id: sanitizeText(rider?.id, `${client.id}:${index + 1}`, 120),
        playerId: Math.max(1, Math.min(maxRaceBikeCount, Math.round(finiteNumber(rider?.playerId, index + 1)))),
        name: sanitizeText(rider?.name, `${client.name} ${index + 1}`, 64),
        colorName,
        accent: sanitizeText(rider?.accent, '#7ade36', 24),
        distance: Math.max(0, finiteNumber(rider?.distance, 0)),
        velocity: Math.max(0, finiteNumber(rider?.velocity, 0)),
        boost: Math.max(0, Math.min(1, finiteNumber(rider?.boost, 0))),
        air: Math.max(0, finiteNumber(rider?.air, 0)),
        pitch: Math.max(-45, Math.min(45, finiteNumber(rider?.pitch, 0))),
        phase: ['pedaling', 'airborne', 'landing'].includes(rider?.phase) ? rider.phase : 'pedaling',
        rank: Math.max(1, Math.min(64, Math.round(finiteNumber(rider?.rank, index + 1)))),
        finishedAt: nullableFiniteNumber(rider?.finishedAt),
        watts: Math.max(0, Math.round(finiteNumber(rider?.watts, 0))),
        cadence: nullableFiniteNumber(rider?.cadence),
        speedKph: nullableFiniteNumber(rider?.speedKph),
        signal: Math.max(0, Math.min(1, finiteNumber(rider?.signal, 0))),
        sampleAt: nullableFiniteNumber(rider?.sampleAt),
      };
    })
    : [];

  return {
    sessionId: sanitizeText(value.sessionId, `${room.id}:${client.guestKey}:${value.trackId ?? room.track.id}`, 160),
    clientId: client.id,
    riderName: client.name,
    roomId: room.id,
    trackId: sanitizeText(value.trackId, room.track.id, 120),
    raceState: ['ready', 'racing', 'finished'].includes(value.raceState) ? value.raceState : 'ready',
    at: Date.now(),
    riders,
    summary: Array.isArray(value.summary)
      ? value.summary
        .slice(0, allowedRiderCount)
        .map(sanitizeRaceSummaryEntry)
        .filter(Boolean)
      : [],
  };
}

function sanitizeVoiceSignal(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const type = sanitizeText(value.type, '', 24);
  if (type === 'ready' || type === 'leave') {
    return { type };
  }

  if ((type === 'offer' || type === 'answer') && value.description && typeof value.description === 'object') {
    return {
      type,
      description: {
        type,
        sdp: sanitizeText(value.description.sdp, '', 120_000),
      },
    };
  }

  if (type === 'candidate' && value.candidate && typeof value.candidate === 'object') {
    return {
      type,
      candidate: {
        candidate: sanitizeText(value.candidate.candidate, '', 16_000),
        sdpMid: typeof value.candidate.sdpMid === 'string' ? sanitizeText(value.candidate.sdpMid, '', 120) : null,
        sdpMLineIndex: Number.isFinite(Number(value.candidate.sdpMLineIndex))
          ? Math.max(0, Math.min(32, Math.round(Number(value.candidate.sdpMLineIndex))))
          : null,
        usernameFragment: typeof value.candidate.usernameFragment === 'string'
          ? sanitizeText(value.candidate.usernameFragment, '', 240)
          : undefined,
      },
    };
  }

  return null;
}

function sanitizeClientIdList(value, limit = maxRaceBikeCount - 1) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map((item) => sanitizeText(item, '', 80)).filter(Boolean))].slice(0, limit);
}

function sanitizeSeatCount(value, fallback = 1) {
  const numeric = Math.round(Number(value));
  const seatCount = Number.isFinite(numeric) ? numeric : fallback;
  return Math.max(1, Math.min(maxRaceBikeCount, seatCount));
}

function sanitizeGroupName(value) {
  return sanitizeText(value, 'TrackLab Team', 48);
}

function roomRacerSeatCountForMember(room, clientId) {
  if (!room?.racers?.has(clientId)) {
    return 0;
  }

  const assignedCount = Number(room.racerSeatCounts?.get(clientId));
  return Number.isFinite(assignedCount)
    ? Math.max(1, Math.min(maxRaceBikeCount, Math.round(assignedCount)))
    : 1;
}

function roomRacerSeatCount(room) {
  if (!room?.racers) {
    return 0;
  }

  return [...room.racers].reduce((total, clientId) => total + roomRacerSeatCountForMember(room, clientId), 0);
}

function roomLatencySummary(room) {
  const racerIds = room?.racers?.size ? [...room.racers] : [...(room?.members ?? [])];
  const latencyValues = racerIds
    .map((clientId) => clients.get(clientId)?.latencyMs)
    .filter((value) => Number.isFinite(Number(value)) && Number(value) > 0)
    .map((value) => Math.round(Number(value)));

  if (latencyValues.length === 0) {
    return { maxLatencyMs: null, latencyQuality: 'unknown' };
  }

  const maxLatencyMs = Math.max(...latencyValues);
  return {
    maxLatencyMs,
    latencyQuality: latencyQualityForMs(maxLatencyMs),
  };
}

function publicRider(client, role = client?.roomRole ?? null, racerSeatCount = client?.racerSeatCount ?? 0) {
  return {
    id: client.id,
    name: client.name,
    available: client.available,
    membershipTier: client.membershipTier,
    bikeCount: client.bikeCount,
    racerSeatCount: role === 'racer' ? Math.max(1, Math.min(maxRaceBikeCount, Math.round(Number(racerSeatCount) || 1))) : 0,
    latencyMs: Number.isFinite(Number(client.latencyMs)) ? Math.round(Number(client.latencyMs)) : null,
    latencyQuality: latencyQualityForMs(client.latencyMs),
    track: client.track,
    roomId: client.roomId,
    roomRole: role,
    lastSeen: client.lastSeen,
  };
}

function clientHasRacerAccess(client) {
  return client?.membershipTier === 'racer';
}

function requireRacerClient(client, message = 'Racer access is required for that action.') {
  if (clientHasRacerAccess(client)) {
    return true;
  }

  send(client, { type: 'room-error', message });
  return false;
}

function publicMatchInvite(invite) {
  return {
    id: invite.id,
    roomId: invite.roomId,
    fromId: invite.fromId,
    fromName: invite.fromName,
    track: invite.track,
    targetIds: invite.targetIds,
    hostSeatCount: invite.hostSeatCount,
    createdAt: invite.createdAt,
  };
}

function hydrateSocialPresence(socialState) {
  const onlineByGuestKey = new Map([...clients.values()].map((client) => [client.guestKey, client]));
  return {
    ...socialState,
    friends: socialState.friends.map((friend) => {
      const onlineClient = onlineByGuestKey.get(friend.guestKey);
      return {
        ...friend,
        online: Boolean(onlineClient),
        riderId: onlineClient?.id ?? null,
        available: Boolean(onlineClient?.available),
      };
    }),
    groups: socialState.groups.map((group) => ({
      ...group,
      members: group.members.map((member) => {
        const onlineClient = onlineByGuestKey.get(member.guestKey);
        return {
          ...member,
          online: Boolean(onlineClient),
          riderId: onlineClient?.id ?? null,
          available: Boolean(onlineClient?.available),
        };
      }),
    })),
  };
}

function publicRoomFlow(room) {
  return {
    ...defaultRoomFlow(),
    ...(room.flow ?? {}),
    candidates: Array.isArray(room.flow?.candidates) ? room.flow.candidates : [],
    votes: room.flow?.votes && typeof room.flow.votes === 'object' ? room.flow.votes : {},
    routeChoices: room.flow?.routeChoices && typeof room.flow.routeChoices === 'object' ? room.flow.routeChoices : {},
  };
}

function publicRoom(room) {
  const latencySummary = roomLatencySummary(room);
  const members = [...room.members]
    .map((clientId) => {
      const client = clients.get(clientId);
      if (!client) {
        return null;
      }
      const role = room.racers?.has(clientId) ? 'racer' : 'spectator';
      return publicRider(client, role, roomRacerSeatCountForMember(room, clientId));
    })
    .filter(Boolean)
    .map((rider) => rider);

  return {
    id: room.id,
    hostId: room.hostId,
    private: room.private,
    track: room.track,
    flow: publicRoomFlow(room),
    createdAt: room.createdAt,
    members,
    memberCount: members.length,
    racerCount: room.racers?.size ?? members.length,
    racerSeatCount: roomRacerSeatCount(room),
    racerSeatCapacity: maxRaceBikeCount,
    maxLatencyMs: latencySummary.maxLatencyMs,
    latencyQuality: latencySummary.latencyQuality,
    spectatorCount: room.spectators?.size ?? 0,
  };
}

function send(client, payload) {
  if (client?.socket?.readyState === client.socket.OPEN) {
    client.socket.send(JSON.stringify(payload));
  }
}

function visibleRoomsForClient(client) {
  return [...rooms.values()]
    .filter((room) => !room.private || room.members.has(client.id))
    .map(publicRoom);
}

function broadcastLobby() {
  const riders = [...clients.values()].map(publicRider);
  clients.forEach((client) => send(client, {
    type: 'lobby-state',
    riders,
    rooms: visibleRoomsForClient(client),
  }));
}

function broadcastRoom(roomId, payload) {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  room.members.forEach((clientId) => send(clients.get(clientId), payload));
}

async function socialStateForClient(client) {
  const socialState = await persistence.loadSocialState(client.guestKey);
  return hydrateSocialPresence(socialState);
}

async function sendSocialState(client) {
  if (!client) {
    return;
  }

  const socialState = await socialStateForClient(client);
  send(client, { type: 'social-state', social: socialState });
}

function refreshSocialForGuestKeys(guestKeys) {
  const targets = new Set(guestKeys.filter(Boolean));
  clients.forEach((client) => {
    if (targets.has(client.guestKey)) {
      void sendSocialState(client);
    }
  });
}

async function refreshClientAndFriendPresence(client) {
  const socialState = await socialStateForClient(client);
  send(client, { type: 'social-state', social: socialState });
  refreshSocialForGuestKeys(socialState.friends.map((friend) => friend.guestKey));
}

function clearRoomTimers(roomId) {
  const voteTimer = voteTimers.get(roomId);
  if (voteTimer) {
    clearTimeout(voteTimer);
    voteTimers.delete(roomId);
  }

  const routeTimer = routeSelectTimers.get(roomId);
  if (routeTimer) {
    clearTimeout(routeTimer);
    routeSelectTimers.delete(roomId);
  }
}

function roomState(room) {
  return {
    type: 'room-state',
    room: publicRoom(room),
    messages: room.messages,
    raceStates: [...room.raceStates.values()],
  };
}

function addRoomSystemMessage(room, text) {
  const message = {
    id: randomId('MSG', 10),
    author: 'TrackLab',
    text,
    at: new Date().toISOString(),
  };
  room.messages = [...room.messages, message].slice(-40);
  void persistence.saveRoomMessage(room.id, null, message);
}

function applyRoomTrack(room, track) {
  room.track = sanitizeTrack(track);
  room.members.forEach((clientId) => {
    const member = clients.get(clientId);
    if (member) {
      member.track = room.track;
    }
  });
  void persistence.updateRoomTrack(room);
}

function beginRoomRace(room, source = 'route selection') {
  clearRoomTimers(room.id);
  const latencySummary = roomLatencySummary(room);
  room.flow = {
    ...publicRoomFlow(room),
    phase: 'race',
    deadlineAt: null,
    raceToken: randomId('RACE', 10),
    raceStartAt: Date.now() + 800,
  };
  addRoomSystemMessage(room, `Race starting from ${source}.`);
  if (latencySummary.latencyQuality === 'poor' && latencySummary.maxLatencyMs != null) {
    addRoomSystemMessage(room, `Latency warning: highest racer ping is ${latencySummary.maxLatencyMs} ms. Results will still save, but the race may feel delayed.`);
  }
  broadcastRoom(room.id, roomState(room));
  broadcastLobby();
}

function scheduleRoomRaceStart(room, delayMs) {
  const existing = routeSelectTimers.get(room.id);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    const activeRoom = rooms.get(room.id);
    if (!activeRoom || activeRoom.flow?.phase !== 'route-select') {
      return;
    }
    beginRoomRace(activeRoom, 'locked route choices');
  }, Math.max(0, delayMs));
  routeSelectTimers.set(room.id, timer);
}

function resolveTrackVote(room) {
  if (!room || room.flow?.phase !== 'voting') {
    return;
  }

  const candidates = sanitizeTrackVoteCandidates(room.flow.candidates);
  if (candidates.length === 0) {
    room.flow = defaultRoomFlow();
    addRoomSystemMessage(room, 'Track vote cancelled because no mapped tracks were available.');
    broadcastRoom(room.id, roomState(room));
    return;
  }

  const counts = new Map(candidates.map((candidate) => [candidate.id, 0]));
  Object.values(room.flow.votes ?? {}).forEach((trackId) => {
    if (counts.has(trackId)) {
      counts.set(trackId, (counts.get(trackId) ?? 0) + 1);
    }
  });

  const highest = Math.max(...counts.values());
  const tied = candidates.filter((candidate) => (counts.get(candidate.id) ?? 0) === highest);
  const winner = tied[Math.floor(Math.random() * tied.length)] ?? candidates[0];
  applyRoomTrack(room, winner);

  if (winner.hasSplits) {
    const deadlineAt = Date.now() + 10_000;
    room.flow = {
      ...publicRoomFlow(room),
      phase: 'route-select',
      selectedTrackId: winner.id,
      deadlineAt,
      routeChoices: {},
      raceToken: null,
      raceStartAt: null,
    };
    addRoomSystemMessage(room, `${winner.name} won the vote. Choose Amateur Line or Pro Set.`);
    scheduleRoomRaceStart(room, deadlineAt - Date.now());
  } else {
    room.flow = {
      ...publicRoomFlow(room),
      selectedTrackId: winner.id,
    };
    beginRoomRace(room, `${winner.name} track vote`);
    return;
  }

  broadcastRoom(room.id, roomState(room));
  broadcastLobby();
}

function scheduleTrackVoteResolution(room, delayMs) {
  const existing = voteTimers.get(room.id);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    const activeRoom = rooms.get(room.id);
    if (!activeRoom || activeRoom.flow?.phase !== 'voting') {
      return;
    }
    resolveTrackVote(activeRoom);
  }, Math.max(0, delayMs));
  voteTimers.set(room.id, timer);
}

function leaveRoom(client, reason = 'left') {
  if (!client.roomId) {
    return;
  }

  const room = rooms.get(client.roomId);
  const oldRoomId = client.roomId;
  client.roomId = null;
  void persistence.saveRoomLeave(oldRoomId, client);

  if (!room) {
    send(client, { type: 'room-left', roomId: oldRoomId, reason });
    return;
  }

  room.members.delete(client.id);
  room.raceStates.delete(client.id);
  room.racers?.delete(client.id);
  room.spectators?.delete(client.id);
  room.racerSeatCounts?.delete(client.id);
  client.roomRole = null;
  client.racerSeatCount = 0;
  if (room.hostId === client.id) {
    room.hostId = [...room.members][0] ?? null;
  }

  send(client, { type: 'room-left', roomId: oldRoomId, reason });

  if (room.members.size === 0) {
    clearRoomTimers(room.id);
    rooms.delete(room.id);
    void persistence.closeRoom(room.id);
    broadcastLobby();
    return;
  }

  broadcastRoom(room.id, roomState(room));
  broadcastLobby();
}

function joinRoom(client, room, preferredRole = 'racer', requestedSeatCount = 1) {
  if (client.roomId && client.roomId !== room.id) {
    leaveRoom(client, 'joined-another-room');
  }

  if (!room.racers) {
    room.racers = new Set();
  }
  if (!room.spectators) {
    room.spectators = new Set();
  }
  if (!room.racerSeatCounts) {
    room.racerSeatCounts = new Map();
  }

  if (!room.hostId && (room.members.size === 0 || room.hostGuestKey === client.guestKey)) {
    room.hostId = client.id;
  }

  if (!clientHasRacerAccess(client)) {
    preferredRole = 'spectator';
  }

  const existingSeatCount = room.racerSeatCounts.get(client.id) ?? 0;
  const availableSeatCount = Math.max(0, maxRaceBikeCount - (roomRacerSeatCount(room) - existingSeatCount));
  if (preferredRole === 'racer' && availableSeatCount <= 0) {
    preferredRole = 'spectator';
  }

  room.members.add(client.id);
  if (preferredRole === 'spectator') {
    room.racers.delete(client.id);
    room.spectators.add(client.id);
    room.racerSeatCounts.delete(client.id);
    client.racerSeatCount = 0;
  } else {
    room.spectators.delete(client.id);
    room.racers.add(client.id);
    const assignedSeatCount = Math.max(1, Math.min(availableSeatCount, sanitizeSeatCount(requestedSeatCount)));
    room.racerSeatCounts.set(client.id, assignedSeatCount);
    client.racerSeatCount = assignedSeatCount;
  }
  client.roomId = room.id;
  client.roomRole = preferredRole;
  client.track = room.track;
  void persistence.saveRoomJoin(room, client, preferredRole, client.racerSeatCount);
  broadcastRoom(room.id, roomState(room));
  broadcastLobby();
}

function createRoom(host, track, privateRoom = true, hostSeatCount = 1) {
  let id = randomId('ROOM', 6);
  while (rooms.has(id)) {
    id = randomId('ROOM', 6);
  }

  const room = {
    id,
    hostId: host.id,
    private: privateRoom,
    track: sanitizeTrack(track ?? host.track),
    flow: defaultRoomFlow(),
    createdAt: Date.now(),
    members: new Set(),
    racers: new Set(),
    spectators: new Set(),
    racerSeatCounts: new Map(),
    raceStates: new Map(),
    messages: [{
      id: randomId('MSG', 10),
      author: 'TrackLab',
      text: privateRoom ? 'Private room opened.' : 'Public lobby opened.',
      at: new Date().toISOString(),
    }],
  };

  rooms.set(id, room);
  void persistence.saveRoom(room, host);
  void persistence.saveRoomMessage(room.id, null, room.messages[0]);
  joinRoom(host, room, 'racer', hostSeatCount);
  return room;
}

function sendChallenge(fromClient, targetClient, track, statusPrefix = 'Challenge sent') {
  const challenge = {
    id: randomId('CHAL', 8),
    fromId: fromClient.id,
    toId: targetClient.id,
    track: sanitizeTrack(track ?? fromClient.track),
    createdAt: Date.now(),
  };

  challenges.set(challenge.id, challenge);
  void persistence.saveChallenge(challenge, fromClient, targetClient);
  send(targetClient, {
    type: 'challenge-incoming',
    challenge,
    from: publicRider(fromClient),
  });
  send(fromClient, { type: 'challenge-status', message: `${statusPrefix} to ${targetClient.name}.` });
}

function sendMatchInvite(fromClient, targetClient, invite) {
  send(targetClient, {
    type: 'match-invite',
    invite: publicMatchInvite(invite),
    from: publicRider(fromClient),
  });
}

function createSelectedMatchRoom(host, targetIds, track, localSeatCount = 1) {
  const hostSeatCount = sanitizeSeatCount(localSeatCount);
  const remainingSeatCount = Math.max(0, maxRaceBikeCount - hostSeatCount);
  const targets = targetIds
    .map((targetId) => clients.get(targetId))
    .filter((target) => target
      && target.id !== host.id
      && clientHasRacerAccess(target)
      && target.socket.readyState === target.socket.OPEN)
    .slice(0, remainingSeatCount);

  if (targets.length === 0) {
    send(host, { type: 'challenge-status', message: remainingSeatCount === 0
      ? 'Choose fewer studio seats to add online racers.'
      : 'Select at least one online racer for the match.' });
    return null;
  }

  const room = createRoom(host, track, true, hostSeatCount);
  addRoomSystemMessage(room, `${host.name} opened a selected match with ${hostSeatCount} studio seat${hostSeatCount === 1 ? '' : 's'}.`);
  const invite = {
    id: randomId('MATCH', 10),
    roomId: room.id,
    fromId: host.id,
    fromName: host.name,
    targetIds: targets.map((target) => target.id),
    hostSeatCount,
    track: sanitizeTrack(track ?? host.track),
    createdAt: Date.now(),
  };
  matchInvites.set(invite.id, invite);
  targets.forEach((target) => sendMatchInvite(host, target, invite));
  send(host, { type: 'challenge-status', message: `Match invite sent to ${targets.length} racer${targets.length === 1 ? '' : 's'}.` });
  broadcastRoom(room.id, roomState(room));
  broadcastLobby();
  return room;
}

async function sendFriendRequest(fromClient, targetClient) {
  const request = {
    id: randomId('FRIEND', 10),
    fromId: fromClient.id,
    toId: targetClient.id,
    createdAt: Date.now(),
  };
  const saved = await persistence.createFriendRequest(request, fromClient, targetClient);
  if (!saved) {
    send(fromClient, { type: 'challenge-status', message: 'Friend request already exists or this rider is already your friend.' });
    return;
  }

  send(fromClient, { type: 'challenge-status', message: `Friend request sent to ${targetClient.name}.` });
  send(targetClient, { type: 'challenge-status', message: `${fromClient.name} sent a friend request.` });
  refreshSocialForGuestKeys([fromClient.guestKey, targetClient.guestKey]);
}

async function respondToFriendRequest(client, requestId, accepted) {
  const response = await persistence.respondToFriendRequest(requestId, client, accepted);
  if (!response) {
    send(client, { type: 'challenge-status', message: 'Friend request is no longer available.' });
    return;
  }

  send(client, { type: 'challenge-status', message: accepted ? 'Friend added.' : 'Friend request declined.' });
  refreshSocialForGuestKeys([response.fromGuestKey, response.toGuestKey]);
}

async function createSocialGroup(client, name) {
  const group = {
    id: randomId('GROUP', 10),
    name: sanitizeGroupName(name),
  };
  await persistence.createGroup(group, client);
  send(client, { type: 'challenge-status', message: `${group.name} created.` });
  refreshSocialForGuestKeys([client.guestKey]);
}

async function inviteGroupMember(fromClient, targetClient, groupId) {
  const invite = {
    id: randomId('GINV', 10),
    groupId: sanitizeText(groupId, '', 40),
  };
  const saved = await persistence.createGroupInvite(invite, fromClient, targetClient);
  if (!saved) {
    send(fromClient, { type: 'challenge-status', message: 'Group invite could not be sent.' });
    return;
  }

  send(fromClient, { type: 'challenge-status', message: `Group invite sent to ${targetClient.name}.` });
  send(targetClient, { type: 'challenge-status', message: `${fromClient.name} sent a group invite.` });
  refreshSocialForGuestKeys([fromClient.guestKey, targetClient.guestKey]);
}

async function respondToGroupInvite(client, inviteId, accepted) {
  const response = await persistence.respondToGroupInvite(inviteId, client, accepted);
  if (!response) {
    send(client, { type: 'challenge-status', message: 'Group invite is no longer available.' });
    return;
  }

  send(client, { type: 'challenge-status', message: accepted ? 'Group joined.' : 'Group invite declined.' });
  refreshSocialForGuestKeys([response.fromGuestKey, response.toGuestKey]);
}

async function findRoom(roomId) {
  const activeRoom = rooms.get(roomId);
  if (activeRoom) {
    return activeRoom;
  }

  const savedRoom = await persistence.loadRoom(roomId);
  if (!savedRoom) {
    return null;
  }

  savedRoom.track = sanitizeTrack(savedRoom.track);
  savedRoom.flow = defaultRoomFlow();
  savedRoom.racers = savedRoom.racers ?? new Set();
  savedRoom.spectators = savedRoom.spectators ?? new Set();
  savedRoom.racerSeatCounts = savedRoom.racerSeatCounts ?? new Map();
  savedRoom.messages = savedRoom.messages.length > 0
    ? savedRoom.messages
    : [{
      id: randomId('MSG', 10),
      author: 'TrackLab',
      text: 'Private room reopened.',
      at: new Date().toISOString(),
    }];
  rooms.set(savedRoom.id, savedRoom);
  return savedRoom;
}

async function handleClientMessage(client, rawMessage) {
  let message = null;
  try {
    message = JSON.parse(rawMessage.toString());
  } catch {
    send(client, { type: 'error', message: 'Invalid multiplayer message.' });
    return;
  }

  if (!message || typeof message !== 'object') {
    return;
  }

  if (message.type === 'ping') {
    send(client, {
      type: 'pong',
      id: sanitizeText(message.id, randomId('PING', 8), 80),
      clientSentAt: finiteNumber(message.clientSentAt, 0),
      serverNow: Date.now(),
    });
    return;
  }

  if (message.type === 'latency') {
    const latencyMs = Math.max(0, Math.min(3000, Math.round(finiteNumber(message.rttMs, 0))));
    const clockOffsetMs = Math.max(-10_000, Math.min(10_000, Math.round(finiteNumber(message.clockOffsetMs, 0))));
    client.latencyMs = latencyMs > 0 ? latencyMs : null;
    client.clockOffsetMs = clockOffsetMs;
    client.lastLatencyAt = Date.now();

    if (client.roomId && rooms.has(client.roomId)) {
      broadcastRoom(client.roomId, roomState(rooms.get(client.roomId)));
    }
    return;
  }

  if (message.type === 'hello' || message.type === 'presence') {
    client.available = Boolean(message.available);
    client.bikeCount = Math.max(0, Math.min(maxRaceBikeCount, Number(message.bikeCount) || 0));
    client.track = sanitizeTrack(message.track ?? client.track);
    client.lastSeen = Date.now();
    void persistence.upsertProfile(client);

    if (message.type === 'hello') {
      send(client, {
        type: 'welcome',
        clientId: client.id,
        persistence: persistence.persistenceEnabled(),
        riders: [...clients.values()].map(publicRider),
        rooms: visibleRoomsForClient(client),
      });
    }

    broadcastLobby();
    void refreshClientAndFriendPresence(client);
    return;
  }

  if (message.type === 'create-room') {
    if (!requireRacerClient(client)) {
      return;
    }
    createRoom(client, message.track, message.private !== false);
    return;
  }

  if (message.type === 'join-room') {
    const roomId = sanitizeText(message.roomId, '', 32).toUpperCase();
    const room = await findRoom(roomId);
    if (!room) {
      send(client, { type: 'room-error', message: `Room ${roomId || 'unknown'} is not available.` });
      return;
    }

    joinRoom(client, room, clientHasRacerAccess(client) ? 'racer' : 'spectator');
    return;
  }

  if (message.type === 'leave-room') {
    leaveRoom(client);
    broadcastLobby();
    return;
  }

  if (message.type === 'room-track') {
    if (!client.roomId) {
      return;
    }

    const room = rooms.get(client.roomId);
    if (!room) {
      return;
    }

    if (room.hostId !== client.id) {
      send(client, { type: 'room-error', message: 'Only the room host can change the track.' });
      return;
    }

    clearRoomTimers(room.id);
    applyRoomTrack(room, message.track);
    room.flow = defaultRoomFlow();
    broadcastRoom(room.id, roomState(room));
    broadcastLobby();
    return;
  }

  if (message.type === 'room-vote-start') {
    if (!client.roomId) {
      return;
    }

    const room = rooms.get(client.roomId);
    if (!room) {
      return;
    }

    if (room.hostId && room.hostId !== client.id) {
      send(client, { type: 'room-error', message: 'Only the room host can start track voting.' });
      return;
    }

    const candidates = sanitizeTrackVoteCandidates(message.candidates);
    if (candidates.length < 3) {
      send(client, { type: 'room-error', message: 'Track voting needs three mapped tracks with pedaling zones.' });
      return;
    }

    clearRoomTimers(room.id);
    room.flow = {
      ...defaultRoomFlow(),
      phase: 'voting',
      candidates,
      votes: {},
      deadlineAt: Date.now() + 20_000,
    };
    addRoomSystemMessage(room, 'Track vote opened. Pick one of the three mapped tracks.');
    scheduleTrackVoteResolution(room, 20_000);
    broadcastRoom(room.id, roomState(room));
    broadcastLobby();
    return;
  }

  if (message.type === 'room-vote') {
    if (!client.roomId) {
      return;
    }

    const room = rooms.get(client.roomId);
    if (!room || room.flow?.phase !== 'voting') {
      return;
    }

    const trackId = sanitizeText(message.trackId, '', 120);
    const candidate = room.flow.candidates.find((item) => item.id === trackId);
    if (!candidate) {
      send(client, { type: 'room-error', message: 'That track is not in this vote.' });
      return;
    }

    room.flow = {
      ...publicRoomFlow(room),
      votes: {
        ...(room.flow.votes ?? {}),
        [client.id]: trackId,
      },
    };
    const votingMemberIds = room.racers?.size ? [...room.racers] : [...room.members];
    const everyoneVoted = votingMemberIds.every((memberId) => Boolean(room.flow.votes?.[memberId]));
    if (everyoneVoted) {
      resolveTrackVote(room);
      return;
    }

    broadcastRoom(room.id, roomState(room));
    return;
  }

  if (message.type === 'room-route-choice') {
    if (!client.roomId) {
      return;
    }

    const room = rooms.get(client.roomId);
    if (!room || room.flow?.phase !== 'route-select') {
      return;
    }

    if (!room.racers?.has(client.id)) {
      return;
    }

    room.flow = {
      ...publicRoomFlow(room),
      routeChoices: {
        ...(room.flow.routeChoices ?? {}),
        [client.id]: sanitizeBranchChoice(message.choice),
      },
    };
    broadcastRoom(room.id, roomState(room));
    return;
  }

  if (message.type === 'room-reset-lobby') {
    if (!client.roomId) {
      return;
    }

    const room = rooms.get(client.roomId);
    if (!room) {
      return;
    }

    if (room.hostId && room.hostId !== client.id) {
      send(client, { type: 'room-error', message: 'Only the room host can reset the lobby.' });
      return;
    }

    clearRoomTimers(room.id);
    room.flow = defaultRoomFlow();
    addRoomSystemMessage(room, 'Lobby reset.');
    broadcastRoom(room.id, roomState(room));
    return;
  }

  if (message.type === 'room-chat') {
    if (!client.roomId) {
      return;
    }

    const room = rooms.get(client.roomId);
    if (!room) {
      return;
    }

    const chatMessage = {
      id: randomId('MSG', 10),
      author: client.name,
      text: sanitizeText(message.text, '', 240),
      at: new Date().toISOString(),
    };

    if (!chatMessage.text) {
      return;
    }

    room.messages = [...room.messages, chatMessage].slice(-40);
    void persistence.saveRoomMessage(room.id, client, chatMessage);
    broadcastRoom(room.id, { type: 'room-chat', message: chatMessage, messages: room.messages });
    return;
  }

  if (message.type === 'race-sync') {
    if (!client.roomId) {
      return;
    }

    const room = rooms.get(client.roomId);
    if (!room) {
      return;
    }

    if (room.racers?.size && !room.racers.has(client.id)) {
      return;
    }

    if (!requireRacerClient(client)) {
      return;
    }

    const raceState = sanitizeRaceState(message.state, client, room);
    if (!raceState) {
      return;
    }

    room.raceStates.set(client.id, raceState);
    if (raceState.raceState === 'finished') {
      const resultKey = `${raceState.sessionId}:${client.guestKey}:${raceState.summary.map((summary) => `${summary.playerId}:${summary.finishTimeMs ?? 'open'}`).join('|')}`;
      if (rememberRaceResultKey(resultKey)) {
        void persistence.saveRaceResults(room, client, raceState);
      }
    }
    broadcastRoom(room.id, { type: 'race-sync', state: raceState });
    return;
  }

  if (message.type === 'voice-signal') {
    if (!client.roomId) {
      return;
    }

    const room = rooms.get(client.roomId);
    if (!room) {
      return;
    }

    const signal = sanitizeVoiceSignal(message.signal);
    if (!signal) {
      return;
    }

    const targetId = sanitizeText(message.targetId, '', 80);
    const payload = {
      type: 'voice-signal',
      signal: {
        id: randomId('VOICE', 12),
        fromId: client.id,
        targetId: targetId || null,
        signal,
        at: Date.now(),
      },
    };

    if (targetId) {
      if (room.members.has(targetId)) {
        send(clients.get(targetId), payload);
      }
      return;
    }

    room.members.forEach((memberId) => {
      if (memberId !== client.id) {
        send(clients.get(memberId), payload);
      }
    });
    return;
  }

  if (message.type === 'create-match') {
    if (!requireRacerClient(client)) {
      return;
    }
    const targetIds = sanitizeClientIdList(message.targetIds);
    createSelectedMatchRoom(client, targetIds, message.track, message.localSeatCount);
    return;
  }

  if (message.type === 'match-response') {
    const invite = matchInvites.get(sanitizeText(message.inviteId, '', 40));
    if (!invite || !invite.targetIds.includes(client.id)) {
      send(client, { type: 'challenge-status', message: 'Match invite is no longer available.' });
      return;
    }

    if (!message.accepted) {
      send(client, { type: 'challenge-status', message: 'Match invite declined.' });
      const host = clients.get(invite.fromId);
      if (host) {
        send(host, { type: 'challenge-status', message: `${client.name} declined the match invite.` });
      }
      return;
    }

    const room = rooms.get(invite.roomId) ?? await findRoom(invite.roomId);
    if (!room) {
      send(client, { type: 'challenge-status', message: 'Match room is no longer open.' });
      return;
    }

    const beforeRole = roomRacerSeatCount(room) >= maxRaceBikeCount ? 'spectator' : 'racer';
    joinRoom(client, room, beforeRole, 1);
    send(client, { type: 'challenge-status', message: beforeRole === 'racer' ? `Joined match ${room.id}.` : `Joined ${room.id} as a spectator.` });
    const host = clients.get(invite.fromId);
    if (host) {
      send(host, { type: 'challenge-status', message: `${client.name} joined the match.` });
    }
    return;
  }

  if (message.type === 'friend-request') {
    const target = clients.get(sanitizeText(message.targetId, '', 80));
    if (!target || target.id === client.id) {
      send(client, { type: 'challenge-status', message: 'That rider is not online.' });
      return;
    }

    await sendFriendRequest(client, target);
    return;
  }

  if (message.type === 'friend-response') {
    await respondToFriendRequest(client, sanitizeText(message.requestId, '', 40), Boolean(message.accepted));
    return;
  }

  if (message.type === 'group-create') {
    await createSocialGroup(client, message.name);
    return;
  }

  if (message.type === 'group-invite') {
    const target = clients.get(sanitizeText(message.targetId, '', 80));
    if (!target || target.id === client.id) {
      send(client, { type: 'challenge-status', message: 'That rider is not online.' });
      return;
    }

    await inviteGroupMember(client, target, message.groupId);
    return;
  }

  if (message.type === 'group-invite-response') {
    await respondToGroupInvite(client, sanitizeText(message.inviteId, '', 40), Boolean(message.accepted));
    return;
  }

  if (message.type === 'challenge') {
    if (!requireRacerClient(client)) {
      return;
    }
    const target = clients.get(sanitizeText(message.targetId, '', 80));
    if (!target || target.id === client.id || !clientHasRacerAccess(target)) {
      send(client, { type: 'challenge-status', message: 'That rider is not online.' });
      return;
    }

    sendChallenge(client, target, message.track);
    return;
  }

  if (message.type === 'quick-match') {
    if (!requireRacerClient(client)) {
      return;
    }
    const candidates = [...clients.values()]
      .filter((candidate) => candidate.id !== client.id)
      .filter((candidate) => candidate.available)
      .filter(clientHasRacerAccess)
      .filter((candidate) => candidate.socket.readyState === candidate.socket.OPEN);

    if (candidates.length === 0) {
      send(client, { type: 'challenge-status', message: 'No available riders are online yet. Stay available and try again.' });
      return;
    }

    const target = candidates[Math.floor(Math.random() * candidates.length)];
    sendChallenge(client, target, message.track, 'Quick match request sent');
    return;
  }

  if (message.type === 'challenge-response') {
    const challenge = challenges.get(sanitizeText(message.challengeId, '', 32));
    if (!challenge || challenge.toId !== client.id) {
      send(client, { type: 'challenge-status', message: 'Challenge is no longer available.' });
      return;
    }

    challenges.delete(challenge.id);
    const challenger = clients.get(challenge.fromId);
    if (!challenger) {
      send(client, { type: 'challenge-status', message: 'The challenger is no longer online.' });
      return;
    }

    if (!message.accepted) {
      send(challenger, { type: 'challenge-status', message: `${client.name} declined the challenge.` });
      send(client, { type: 'challenge-status', message: 'Challenge declined.' });
      void persistence.updateChallenge(challenge.id, 'declined');
      return;
    }

    const room = createRoom(challenger, challenge.track, true);
    joinRoom(client, room);
    void persistence.updateChallenge(challenge.id, 'accepted', room.id);
    send(challenger, { type: 'challenge-status', message: `${client.name} accepted. Room ${room.id} is ready.` });
    send(client, { type: 'challenge-status', message: `Joined ${challenger.name}'s room.` });
  }
}

async function serveStatic(request, response) {
  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host}`);
  if (requestUrl.pathname === '/api/health') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      writeJson(response, 405, { error: 'Method not allowed' });
      return;
    }

    const storage = persistence.persistenceStatus();
    const body = JSON.stringify({
      status: storage.ready ? 'ok' : 'unavailable',
      service: 'tracklab-bmx',
      storage,
      uptimeSeconds: Math.round(process.uptime()),
      version: String(process.env.RENDER_GIT_COMMIT || 'development').slice(0, 12),
    });
    response.writeHead(storage.ready ? 200 : 503, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(body),
    });
    response.end(request.method === 'HEAD' ? undefined : body);
    return;
  }

  if (requestUrl.pathname === '/manifest.webmanifest') {
    const profileKey = requestUrl.searchParams.get('profileKey') || cookieValue(request, 'tracklab_profile_key');
    response.writeHead(200, {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': 'no-cache',
    });
    response.end(JSON.stringify(tracklabManifest(profileKey)));
    return;
  }

  if (requestUrl.pathname === '/api/auth/me') {
    const session = await currentAuthSession(request);
    writeJson(response, 200, { user: publicAuthUser(session?.user ?? null) });
    return;
  }

  if (requestUrl.pathname === '/api/auth/register') {
    if (request.method !== 'POST') {
      writeJson(response, 405, { error: 'Method not allowed' });
      return;
    }

    if (!enforceRateLimit(request, response, authRateLimiter, 5, 'auth-register')) {
      return;
    }

    const payload = await readJsonBody(request, 32_000);
    const account = validateAccountPayload(payload, { requireName: true });
    if (account.error) {
      writeJson(response, 400, { error: account.error });
      return;
    }

    const existing = await persistence.findAuthUserByEmail(account.email);
    if (existing) {
      writeJson(response, 409, { error: 'An account already exists for this email. Sign in instead.' });
      return;
    }

    const isAdmin = isAdminEmail(account.email);
    const passwordHash = await hashPassword(account.password);
    const createdUser = await persistence.createAuthUser({
      id: randomUUID(),
      email: account.email,
      displayName: account.name,
      passwordHash,
      membershipTier: isAdmin ? 'racer' : 'spectator',
      bikeSeats: isAdmin ? maxRaceBikeCount : 1,
      admin: isAdmin,
    });

    if (!createdUser) {
      writeJson(response, 500, { error: 'Could not create the account.' });
      return;
    }

    await createSignedInResponse(request, response, createdUser, 201);
    return;
  }

  if (requestUrl.pathname === '/api/auth/login') {
    if (request.method !== 'POST') {
      writeJson(response, 405, { error: 'Method not allowed' });
      return;
    }

    if (!enforceRateLimit(request, response, authRateLimiter, 10, 'auth-login')) {
      return;
    }

    const payload = await readJsonBody(request, 32_000);
    const account = validateAccountPayload(payload, { requireName: false });
    if (account.error) {
      writeJson(response, 400, { error: account.error });
      return;
    }

    const user = await persistence.findAuthUserByEmail(account.email);
    if (!user) {
      await hashPassword(account.password);
      writeJson(response, 401, { error: 'Email or password is incorrect.' });
      return;
    }

    if (!(await verifyPassword(account.password, user.passwordHash))) {
      writeJson(response, 401, { error: 'Email or password is incorrect.' });
      return;
    }

    const entitledUser = isAdminEmail(user.email)
      ? await persistence.updateAuthUserAdminAccess(user.id, maxRaceBikeCount) ?? user
      : user;
    const loggedInUser = await persistence.touchAuthUserLogin(entitledUser.id) ?? entitledUser;
    await createSignedInResponse(request, response, loggedInUser);
    return;
  }

  if (requestUrl.pathname === '/api/auth/logout') {
    if (request.method !== 'POST') {
      writeJson(response, 405, { error: 'Method not allowed' });
      return;
    }

    const token = cookieValue(request, authCookieName);
    if (token) {
      await persistence.deleteAuthSession(tokenHash(token));
    }
    clearAuthCookie(response, request);
    writeJson(response, 200, { ok: true });
    return;
  }

  if (requestUrl.pathname === '/api/auth/billing-return') {
    if (request.method !== 'POST') {
      writeJson(response, 405, { error: 'Method not allowed' });
      return;
    }

    const session = await requireAuthSession(request, response);
    if (!session) {
      return;
    }

    const payload = await readJsonBody(request, 32_000);
    const state = sanitizeGuestKey(payload.billingState, '');
    if (!state) {
      writeJson(response, 400, { error: 'Square checkout verification is missing.' });
      return;
    }

    const checkout = await persistence.findBillingCheckout(tokenHash(state), session.user.id);
    if (!checkout || Date.parse(checkout.expiresAt) <= Date.now()) {
      writeJson(response, 400, { error: 'This Square checkout could not be verified or has expired.' });
      return;
    }

    if (checkout.claimedAt) {
      writeJson(response, 200, { user: publicAuthUser(session.user) });
      return;
    }

    const verification = await verifyRacerSubscriptionOrder({
      orderId: checkout.orderId,
      expectedAmountCents: checkout.expectedAmountCents,
    });
    if (!verification.valid) {
      writeJson(response, 409, { error: 'Square has not confirmed a completed subscription payment yet.' });
      return;
    }

    const nextUser = isAdminEmail(session.user.email)
      ? session.user
      : await persistence.updateAuthUserMembership(session.user.id, 'racer', checkout.bikeSeats);
    await persistence.markBillingCheckoutClaimed(checkout.stateHash, session.user.id);
    writeJson(response, 200, { user: publicAuthUser(nextUser ?? session.user) });
    return;
  }

  if (requestUrl.pathname === '/api/public-track-mappings') {
    if (request.method === 'GET') {
      const trackMappings = await persistence.loadPublicTrackMappings();
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
      response.end(JSON.stringify({
        trackMappings,
        count: Object.keys(trackMappings).length,
        persistence: persistence.persistenceEnabled(),
      }));
      return;
    }

    if (request.method === 'PATCH' || request.method === 'POST') {
      const session = await requireAuthSession(request, response);
      if (!session) {
        return;
      }

      const allowRacerPublishing = process.env.TRACKLAB_ALLOW_RACER_MAP_PUBLISH === '1';
      const membership = membershipForAccount(session.user);
      if (!isAdminEmail(session.user.email) && !(allowRacerPublishing && membership.tier === 'racer')) {
        writeJson(response, 403, { error: 'Only approved TrackLab publishers can update shared track maps.' });
        return;
      }

      const payload = await readJsonBody(request, 5_000_000);
      const trackMappings = sanitizePublicTrackMappingsPayload(payload);
      const publishedBy = authProfileKey(session.user);
      const savedMappings = await persistence.savePublicTrackMappings(trackMappings, publishedBy);
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
      response.end(JSON.stringify({
        trackMappings: savedMappings,
        count: Object.keys(savedMappings).length,
        savedCount: Object.keys(trackMappings).length,
        persistence: persistence.persistenceEnabled(),
      }));
      return;
    }

    response.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  if (requestUrl.pathname === '/api/user-data') {
    const session = await requireAuthSession(request, response);
    if (!session) {
      return;
    }
    const profileKey = authProfileKey(session.user);

    if (request.method === 'GET') {
      const userData = await persistence.loadUserData(profileKey);
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
      response.end(JSON.stringify(userData));
      return;
    }

    if (request.method === 'PATCH' || request.method === 'POST') {
      const patch = sanitizeUserDataPatch(await readJsonBody(request));
      const userData = await persistence.saveUserData(profileKey, patch);
      if (!userData) {
        writeJson(response, 503, { error: 'Cloud profile storage is temporarily unavailable.' });
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
      response.end(JSON.stringify(userData));
      return;
    }

    response.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  if (requestUrl.pathname === '/api/billing/config') {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    response.end(JSON.stringify(squareCheckoutConfigStatus()));
    return;
  }

  if (requestUrl.pathname === '/api/billing/checkout') {
    if (request.method !== 'POST') {
      response.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    try {
      const session = await requireAuthSession(request, response);
      if (!session) {
        return;
      }

      if (!enforceRateLimit(request, response, billingRateLimiter, 12, 'billing-checkout')) {
        return;
      }

      const payload = await readJsonBody(request, 32_000);
      const bikeSeats = Math.max(1, Math.min(maxRaceBikeCount, Math.round(finiteNumber(payload.bikeSeats, 1))));
      const returnState = createSessionToken();
      const origin = publicRequestOrigin(request);
      if (!origin) {
        writeJson(response, 400, { error: 'Could not determine the TrackLab return address.' });
        return;
      }

      const checkout = await createRacerSubscriptionCheckout({ bikeSeats, origin, returnState });
      const expiresAt = new Date(Date.now() + billingCheckoutMaxAgeMs).toISOString();
      const saved = await persistence.saveBillingCheckout({
        stateHash: tokenHash(returnState),
        userId: session.user.id,
        orderId: checkout.orderId,
        paymentLinkId: checkout.paymentLinkId,
        bikeSeats,
        expectedAmountCents: checkout.monthlyCents,
        expiresAt,
      });
      if (!saved) {
        writeJson(response, 503, { error: 'Could not securely record this Square checkout.' });
        return;
      }

      writeJson(response, 200, {
        checkoutUrl: checkout.checkoutUrl,
        bikeSeats: checkout.bikeSeats,
        monthlyCents: checkout.monthlyCents,
        environment: checkout.environment,
      });
    } catch (error) {
      const statusCode = Number(error?.statusCode) || 500;
      writeJson(response, statusCode, {
        error: error instanceof Error ? error.message : String(error),
        config: statusCode === 503 ? squareCheckoutConfigStatus() : undefined,
      });
    }
    return;
  }

  if (requestUrl.pathname === '/api/ghosts') {
    if (request.method === 'GET') {
      const trackId = sanitizeText(requestUrl.searchParams.get('trackId'), '', 140);
      if (!trackId) {
        writeJson(response, 400, { error: 'trackId is required' });
        return;
      }

      const session = await currentAuthSession(request);
      const profileKey = session?.user ? authProfileKey(session.user) : '';
      const friendKeys = profileKey ? await persistence.loadFriendKeys(profileKey) : [];
      const ghosts = await persistence.loadGhostLaps(trackId, profileKey, friendKeys, 40);
      writeJson(response, 200, {
        trackId,
        persistence: persistence.persistenceEnabled(),
        ghosts,
      });
      return;
    }

    if (request.method === 'POST') {
      const session = await requireAuthSession(request, response);
      if (!session) {
        return;
      }

      if (membershipForAccount(session.user).tier !== 'racer') {
        writeJson(response, 403, { error: 'Racer access is required to save a ghost lap.' });
        return;
      }

      const payload = await readJsonBody(request, 1_000_000);
      const profileKey = authProfileKey(session.user);
      const ghost = sanitizeGhostLapPayload(payload.ghost, profileKey);
      if (!profileKey || !ghost) {
        writeJson(response, 400, { error: 'A valid profileKey and ghost lap are required.' });
        return;
      }

      await persistence.saveGhostLap({ ...ghost, ownerKey: profileKey, ownerName: session.user.displayName });
      writeJson(response, 200, {
        ok: true,
        persistence: persistence.persistenceEnabled(),
      });
      return;
    }

    writeJson(response, 405, { error: 'Method not allowed' });
    return;
  }

  if (requestUrl.pathname === '/api/multiplayer/health') {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({
      ok: true,
      clients: clients.size,
      rooms: rooms.size,
      persistence: persistence.persistenceEnabled(),
      websocketPath,
      billing: {
        configured: squareCheckoutConfigStatus().configured,
        oneBikeMonthlyCents: racerMonthlyCents(1),
        fourBikeMonthlyCents: racerMonthlyCents(maxRaceBikeCount),
      },
    }));
    return;
  }

  if (requestUrl.pathname === '/api/multiplayer/leaderboards') {
    const trackId = sanitizeText(requestUrl.searchParams.get('trackId'), '', 140);
    if (!trackId) {
      response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'trackId is required' }));
      return;
    }

    const leaderboards = await persistence.loadLeaderboards(trackId, 10);
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    response.end(JSON.stringify({ trackId, persistence: persistence.persistenceEnabled(), leaderboards }));
    return;
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(requestUrl.pathname);
  } catch {
    writeJson(response, 400, { error: 'Invalid request path.' });
    return;
  }
  const safePath = decodedPath === '/' ? '/index.html' : decodedPath;
  const filePath = path.resolve(distDirectory, `.${safePath}`);
  const withinDist = pathIsInside(distDirectory, filePath, path);
  const fallbackPath = path.join(distDirectory, 'index.html');
  const targetPath = withinDist ? filePath : fallbackPath;

  try {
    const fileStat = await stat(targetPath);
    if (!fileStat.isFile()) {
      throw new Error('Not a file');
    }

    const extension = path.extname(targetPath);
    response.writeHead(200, {
      'Content-Type': contentTypes.get(extension) ?? 'application/octet-stream',
      'Cache-Control': staticCacheControl(safePath),
    });
    createReadStream(targetPath).pipe(response);
  } catch {
    const acceptsHtml = String(request.headers.accept || '').includes('text/html');
    const looksLikeAsset = path.extname(safePath) !== '';
    if (looksLikeAsset || !acceptsHtml) {
      writeJson(response, 404, { error: 'Not found' }, { 'Cache-Control': 'no-cache' });
      return;
    }

    const indexHtml = await readFile(fallbackPath);
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    });
    response.end(indexHtml);
  }
}

const server = createServer((request, response) => {
  applySecurityHeaders(request, response);
  const isApiMutation = String(request.url || '').startsWith('/api/')
    && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method || 'GET');
  if (isApiMutation && !mutationOriginAllowed(request)) {
    writeJson(response, 403, { error: 'Cross-site request blocked.' });
    return;
  }

  void serveStatic(request, response).catch((error) => {
    const requestId = randomUUID();
    console.error(`[cloud] request ${requestId} failed:`, error instanceof Error ? error.message : error);
    if (!response.headersSent) {
      writeJson(response, 500, { error: 'TrackLab could not complete this request.', requestId });
    } else {
      response.destroy();
    }
  });
});

server.requestTimeout = 30_000;
server.headersTimeout = 35_000;
server.keepAliveTimeout = 5_000;

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 256 * 1024,
});

wss.on('connection', (socket, request) => {
  const authUser = request.tracklabAuthSession?.user;
  if (!authUser) {
    socket.close(1008, 'Authentication required');
    return;
  }

  const client = {
    id: randomId('RIDER', 10),
    guestKey: authProfileKey(authUser),
    socket,
    name: sanitizeText(authUser.displayName, 'TrackLab Rider', 64),
    email: sanitizeEmail(authUser.email),
    membershipTier: membershipForAccount(authUser).tier,
    available: false,
    bikeCount: 0,
    track: sanitizeTrack(null),
    roomId: null,
    roomRole: null,
    latencyMs: null,
    clockOffsetMs: 0,
    lastLatencyAt: null,
    lastSeen: Date.now(),
    messageWindowStartedAt: Date.now(),
    messageCount: 0,
    messageRateViolations: 0,
  };

  clients.set(client.id, client);
  socket.isAlive = true;
  socket.on('pong', () => {
    socket.isAlive = true;
  });
  send(client, {
    type: 'connected',
    clientId: client.id,
    websocketPath,
  });

  socket.on('message', (message) => {
    const now = Date.now();
    if (now - client.messageWindowStartedAt >= 10_000) {
      client.messageWindowStartedAt = now;
      client.messageCount = 0;
    }
    client.messageCount += 1;
    if (client.messageCount > 160) {
      client.messageRateViolations += 1;
      if (client.messageRateViolations >= 3) {
        socket.close(1008, 'Message rate exceeded');
      }
      return;
    }

    void handleClientMessage(client, message).catch((error) => {
      console.warn('[cloud] multiplayer message failed:', error instanceof Error ? error.message : error);
      send(client, { type: 'error', message: 'Multiplayer server could not process that action.' });
    });
  });
  socket.on('close', () => {
    const friendRefresh = socialStateForClient(client)
      .then((social) => social.friends.map((friend) => friend.guestKey))
      .catch(() => []);
    leaveRoom(client, 'disconnected');
    void persistence.setProfileOffline(client);
    clients.delete(client.id);
    broadcastLobby();
    void friendRefresh.then(refreshSocialForGuestKeys);
  });
});

server.on('upgrade', (request, socket, head) => {
  let requestUrl;
  try {
    requestUrl = new URL(request.url ?? '/', `http://${request.headers.host || 'localhost'}`);
  } catch {
    socket.destroy();
    return;
  }

  if (requestUrl.pathname !== websocketPath || !mutationOriginAllowed(request)) {
    socket.destroy();
    return;
  }

  void currentAuthSession(request)
    .then((session) => {
      if (!session?.user) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }

      request.tracklabAuthSession = session;
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    })
    .catch(() => socket.destroy());
});

const websocketHeartbeat = setInterval(() => {
  wss.clients.forEach((socket) => {
    if (socket.isAlive === false) {
      socket.terminate();
      return;
    }

    socket.isAlive = false;
    socket.ping();
  });
}, 30_000);
websocketHeartbeat.unref();

const persistenceMaintenance = setInterval(() => {
  pruneTransientState();
  void persistence.pruneExpiredData();
}, 15 * 60 * 1000);
persistenceMaintenance.unref();

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`[cloud] ${signal} received; closing TrackLab services.`);

  clearInterval(websocketHeartbeat);
  clearInterval(persistenceMaintenance);
  voteTimers.forEach(clearTimeout);
  routeSelectTimers.forEach(clearTimeout);
  voteTimers.clear();
  routeSelectTimers.clear();

  wss.clients.forEach((socket) => socket.close(1001, 'Server shutting down'));
  const forceExit = setTimeout(() => {
    console.error('[cloud] Graceful shutdown timed out.');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  await Promise.allSettled([
    new Promise((resolve) => server.close(resolve)),
    new Promise((resolve) => wss.close(resolve)),
  ]);
  await persistence.closePersistence().catch((error) => {
    console.warn('[cloud] Persistence shutdown failed:', error instanceof Error ? error.message : error);
  });
  clearTimeout(forceExit);
  process.exitCode = 0;
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

server.listen(port, () => {
  console.log(`[cloud] TrackLab BMX web + multiplayer listening on :${port}`);
  void persistence.initPersistence();
});
