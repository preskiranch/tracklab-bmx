import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../server/config.mjs";
import { saveSignup } from "../server/repository.mjs";

test("production configuration requires an owner admin token", () => {
  const base = { NODE_ENV: "production", WAITLIST_DATABASE_URL: "postgresql://example.invalid/db" };
  assert.throws(() => loadConfig(base), /WAITLIST_ADMIN_TOKEN/u);
  assert.throws(() => loadConfig({ ...base, WAITLIST_ADMIN_TOKEN: "too-short" }), /32 characters/i);
  assert.equal(
    loadConfig({ ...base, WAITLIST_ADMIN_TOKEN: "a".repeat(32) }).adminToken,
    "a".repeat(32)
  );
});

test("duplicate public signup cannot mutate an existing record", async () => {
  const calls = [];
  const pool = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rowCount: 0, rows: [] };
    }
  };
  await saveSignup(pool, {
    firstName: "Jamie",
    lastName: "Tester",
    email: "jamie@example.com",
    product: "tracklab-bmx",
    device: "ipad",
    wattbikeAccess: "yes",
    adultOrGuardian: true,
    betaConsent: true,
    marketingConsent: false
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /ON CONFLICT \(email_normalized\) DO NOTHING/u);
  assert.doesNotMatch(calls[0].sql, /DO UPDATE/u);
});
