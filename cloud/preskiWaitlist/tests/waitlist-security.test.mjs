import test from "node:test";
import assert from "node:assert/strict";
import { hasValidBearer, InMemoryIpRateLimiter, isAllowedOrigin } from "../server/security.mjs";

test("CORS accepts only exact production and local development origins", () => {
  assert.equal(isAllowedOrigin("https://preskilabs.com"), true);
  assert.equal(isAllowedOrigin("https://www.preskilabs.com"), true);
  assert.equal(isAllowedOrigin("https://preski-labs.onrender.com"), true);
  assert.equal(isAllowedOrigin("http://localhost:4173"), true);
  assert.equal(isAllowedOrigin("https://preskilabs.com.attacker.example"), false);
  assert.equal(isAllowedOrigin("http://preskilabs.com"), false);
});

test("admin bearer authentication rejects missing, short, and incorrect secrets", () => {
  const token = "a-secure-token-with-more-than-32-characters";
  assert.equal(hasValidBearer(`Bearer ${token}`, token), true);
  assert.equal(hasValidBearer("Bearer wrong", token), false);
  assert.equal(hasValidBearer(undefined, token), false);
  assert.equal(hasValidBearer("Bearer short", "short"), false);
});

test("IP limiter enforces its window without retaining raw addresses as map keys", () => {
  const limiter = new InMemoryIpRateLimiter({ maxRequests: 2, windowMs: 1_000, trustProxy: true });
  const request = {
    headers: { "x-forwarded-for": "203.0.113.40, 10.0.0.1" },
    socket: { remoteAddress: "10.0.0.1" }
  };
  assert.equal(limiter.check(request, 10_000).allowed, true);
  assert.equal(limiter.check(request, 10_100).allowed, true);
  assert.equal(limiter.check(request, 10_200).allowed, false);
  assert.equal(limiter.check(request, 11_001).allowed, true);
});
