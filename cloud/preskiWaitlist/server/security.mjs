import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ALLOWED_ORIGINS } from "./constants.mjs";

export function isAllowedOrigin(origin) {
  return origin === undefined || ALLOWED_ORIGINS.includes(origin);
}

function digestToken(value) {
  return createHash("sha256").update(value, "utf8").digest();
}

export function hasValidBearer(authorization, expectedToken) {
  if (typeof expectedToken !== "string" || expectedToken.length < 32) return false;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return false;

  const suppliedToken = authorization.slice(7);
  if (!suppliedToken) return false;
  return timingSafeEqual(digestToken(suppliedToken), digestToken(expectedToken));
}

function requestAddress(request, trustProxy) {
  if (trustProxy) {
    const forwarded = request.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded) return forwarded.split(",", 1)[0].trim();
  }
  return request.socket?.remoteAddress || "unknown";
}

export class InMemoryIpRateLimiter {
  #buckets = new Map();
  #hmacKey = randomBytes(32);

  constructor({ maxRequests = 8, windowMs = 10 * 60_000, trustProxy = false } = {}) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.trustProxy = trustProxy;
  }

  check(request, now = Date.now()) {
    const rawAddress = requestAddress(request, this.trustProxy);
    const key = createHmac("sha256", this.#hmacKey).update(rawAddress).digest("base64url");
    let bucket = this.#buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.#buckets.set(key, bucket);
    }

    bucket.count += 1;
    if (this.#buckets.size > 5_000) this.#prune(now);

    return {
      allowed: bucket.count <= this.maxRequests,
      remaining: Math.max(0, this.maxRequests - bucket.count),
      resetAt: bucket.resetAt
    };
  }

  #prune(now) {
    for (const [key, bucket] of this.#buckets) {
      if (now >= bucket.resetAt) this.#buckets.delete(key);
    }

    // Keep a distributed-address flood from turning the limiter itself into a memory risk.
    while (this.#buckets.size > 10_000) {
      const oldestKey = this.#buckets.keys().next().value;
      this.#buckets.delete(oldestKey);
    }
  }
}
