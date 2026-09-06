import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createApp } from "../server/app.mjs";

const adminToken = "test-admin-token-that-is-at-least-32-characters";

async function withTestServer(run, { query } = {}) {
  const calls = [];
  const pool = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (query) return query(sql, values);
      return { rowCount: 1, rows: [] };
    }
  };
  const rateLimiter = { check: () => ({ allowed: true, remaining: 7, resetAt: Date.now() + 1_000 }) };
  const server = createServer(createApp({ pool, rateLimiter, config: { adminToken } }));

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`, calls);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

function signup(overrides = {}) {
  return {
    firstName: "Rinzell",
    lastName: "Hicks",
    email: " Rider+Test@Example.com ",
    product: "tracklab-bmx",
    device: "ipad",
    wattbikeAccess: "yes",
    adultOrGuardian: true,
    betaConsent: true,
    marketingConsent: false,
    website: "",
    formStartedAt: Date.now() - 5_000,
    ...overrides
  };
}

test("JSON signup receives a generic success and stores normalized input", async () => {
  await withTestServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/waitlist`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://www.preskilabs.com"
      },
      body: JSON.stringify(signup())
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      message: "Thanks. You're on the Preski Labs beta waitlist."
    });
    assert.equal(response.headers.get("access-control-allow-origin"), "https://www.preskilabs.com");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].values[2], "rider+test@example.com");
  });
});

test("native form fallback redirects and works without a client timestamp", async () => {
  await withTestServer(async (baseUrl, calls) => {
    const payload = signup();
    delete payload.formStartedAt;
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(payload)) form.set(key, String(value));

    const response = await fetch(`${baseUrl}/api/waitlist`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://preskilabs.com"
      },
      body: form
    });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/waitlist-success.html");
    assert.equal(calls.length, 1);
  });
});

test("authenticated owner can permanently delete a signup", async () => {
  await withTestServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/admin/waitlist/42`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        Origin: "https://www.preskilabs.com"
      }
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, deleted: true });
    assert.match(calls[0].sql, /^DELETE FROM/u);
    assert.deepEqual(calls[0].values, ["42"]);
  }, { query: () => ({ rowCount: 1, rows: [{ id: "42" }] }) });
});

test("signup deletion requires owner authentication", async () => {
  await withTestServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/admin/waitlist/42`, { method: "DELETE" });
    assert.equal(response.status, 401);
    assert.equal(calls.length, 0);
  });
});

test("bad origin and bad admin bearer are rejected before database access", async () => {
  await withTestServer(async (baseUrl, calls) => {
    const blocked = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: "https://preskilabs.com.attacker.example" }
    });
    assert.equal(blocked.status, 403);

    const unauthorized = await fetch(`${baseUrl}/api/admin/waitlist`, {
      headers: { Authorization: "Bearer incorrect" }
    });
    assert.equal(unauthorized.status, 401);
    assert.equal(calls.length, 0);
  });
});

test("oversized JSON body is rejected without database access", async () => {
  await withTestServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/waitlist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...signup(), firstName: "x".repeat(9_000) })
    });
    assert.equal(response.status, 413);
    assert.equal(calls.length, 0);
  });
});
