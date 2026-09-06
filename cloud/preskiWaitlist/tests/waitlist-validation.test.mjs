import test from "node:test";
import assert from "node:assert/strict";
import { formEntriesToSignup } from "../server/form.mjs";
import {
  normalizeEmail,
  validateLimit,
  validateProductFilter,
  validateSignupId,
  validateSignup
} from "../server/validation.mjs";

const now = 2_000_000_000_000;

function validPayload(overrides = {}) {
  return {
    firstName: "  Rinzell  ",
    lastName: "Hicks",
    email: " Rider.Name+Beta@Example.COM ",
    product: "tracklab-bmx",
    device: "ipad",
    wattbikeAccess: "yes",
    adultOrGuardian: true,
    betaConsent: true,
    marketingConsent: false,
    website: "",
    formStartedAt: now - 5_000,
    ...overrides
  };
}

test("email normalization only trims and lowercases", () => {
  assert.equal(normalizeEmail(" Rider.Name+Beta@Example.COM "), "rider.name+beta@example.com");
});

test("valid signup is normalized without changing address semantics", () => {
  assert.deepEqual(validateSignup(validPayload(), { now }), {
    firstName: "Rinzell",
    lastName: "Hicks",
    email: "rider.name+beta@example.com",
    product: "tracklab-bmx",
    device: "ipad",
    wattbikeAccess: "yes",
    adultOrGuardian: true,
    betaConsent: true,
    marketingConsent: false,
    isLikelyBot: false
  });
});

test("honeypot submissions are ignored without dropping legitimate autofill", () => {
  assert.equal(validateSignup(validPayload({ website: "spam" }), { now }).isLikelyBot, true);
  assert.equal(validateSignup(validPayload({ formStartedAt: now - 50 }), { now }).isLikelyBot, false);
  assert.equal(
    validateSignup(validPayload({ website: "spam", email: "invalid", betaConsent: false }), { now }).isLikelyBot,
    true
  );
});

test("signup requires adult/guardian and beta contact consent", () => {
  assert.throws(() => validateSignup(validPayload({ adultOrGuardian: false }), { now }), /adult/i);
  assert.throws(() => validateSignup(validPayload({ betaConsent: false }), { now }), /permission/i);
});

test("signup requires the adult submitter's first and last name", () => {
  assert.throws(() => validateSignup(validPayload({ firstName: "" }), { now }), /name/i);
  assert.throws(() => validateSignup(validPayload({ lastName: undefined }), { now }), /name/i);
});

test("signup rejects unknown fields, products, devices, and malformed email", () => {
  assert.throws(() => validateSignup(validPayload({ surprise: "x" }), { now }), /unsupported/i);
  assert.throws(() => validateSignup(validPayload({ product: "anything" }), { now }), /program/i);
  assert.throws(() => validateSignup(validPayload({ device: "tablet" }), { now }), /device/i);
  assert.throws(() => validateSignup(validPayload({ email: "not-an-email" }), { now }), /email/i);
});

test("native form values are safely coerced", () => {
  const payload = formEntriesToSignup(new URLSearchParams({
    email: "a@example.com",
    product: "tracklab-bmx",
    device: "ipad",
    wattbikeAccess: "unsure",
    adultOrGuardian: "on",
    betaConsent: "true",
    formStartedAt: String(now - 5_000)
  }).entries());
  assert.equal(payload.adultOrGuardian, true);
  assert.equal(payload.betaConsent, true);
  assert.equal(payload.marketingConsent, false);
  assert.equal(payload.wattbikeAccess, "unsure");
  assert.equal(payload.formStartedAt, now - 5_000);
});

test("native no-JavaScript fallback may omit its start timestamp", () => {
  const payload = validPayload({ formStartedAt: undefined });
  assert.equal(validateSignup(payload, { now, allowMissingStartTime: true }).isLikelyBot, false);
  assert.throws(() => validateSignup(payload, { now }), /reload/i);
});

test("admin filters and limits are bounded", () => {
  assert.equal(validateProductFilter("both"), "both");
  assert.equal(validateProductFilter(undefined), null);
  assert.equal(validateLimit(undefined), 100);
  assert.equal(validateLimit("500"), 500);
  assert.throws(() => validateLimit("501"), /between/i);
  assert.equal(validateSignupId("42"), "42");
  assert.throws(() => validateSignupId("0"), /valid signup/i);
  assert.throws(() => validateSignupId("1 OR 1=1"), /valid signup/i);
});
