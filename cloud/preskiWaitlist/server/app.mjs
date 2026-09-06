import { randomUUID } from "node:crypto";
import { GENERIC_SUCCESS } from "./constants.mjs";
import { buildAppleTestFlightCsv } from "./csv.mjs";
import { HttpError, parseSignupRequest, requestFormat, safeRedirectPath } from "./http.mjs";
import {
  deleteSignup,
  getSummary,
  listSignups,
  listSignupsForExport,
  saveSignup
} from "./repository.mjs";
import { hasValidBearer, isAllowedOrigin } from "./security.mjs";
import {
  ValidationError,
  validateLimit,
  validateProductFilter,
  validateSignupId,
  validateSignup
} from "./validation.mjs";

const JSON_HEADERS = Object.freeze({
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer"
});

function corsHeaders(origin) {
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin"
  };
}

function sendJson(response, status, body, origin, extraHeaders = {}) {
  const encoded = JSON.stringify(body);
  response.writeHead(status, {
    ...JSON_HEADERS,
    ...corsHeaders(origin),
    ...extraHeaders,
    "Content-Length": Buffer.byteLength(encoded)
  });
  response.end(encoded);
}

function sendRedirect(response, success, origin) {
  response.writeHead(303, {
    ...corsHeaders(origin),
    "Cache-Control": "no-store",
    Location: safeRedirectPath(success),
    "Content-Length": "0"
  });
  response.end();
}

function sendSubmissionResult(response, format, success, origin, status = 200, body = GENERIC_SUCCESS) {
  if (format === "form") return sendRedirect(response, success, origin);
  return sendJson(response, status, body, origin);
}

function requireAdmin(request, response, config, origin) {
  if (!config.adminToken || config.adminToken.length < 32) {
    sendJson(response, 503, { ok: false, message: "Admin access is not configured." }, origin);
    return false;
  }
  if (!hasValidBearer(request.headers.authorization, config.adminToken)) {
    sendJson(
      response,
      401,
      { ok: false, message: "Authentication required." },
      origin,
      { "WWW-Authenticate": 'Bearer realm="Preski Labs waitlist"' }
    );
    return false;
  }
  return true;
}

function allowedQuery(url, fields) {
  for (const key of url.searchParams.keys()) {
    if (!fields.has(key)) throw new ValidationError("Unsupported query parameter.", key);
  }
}

export function createApp({ pool, config, rateLimiter }) {
  return async function handleRequest(request, response) {
    const requestId = randomUUID();
    const origin = request.headers.origin;
    let submissionFormat = null;

    try {
      if (!isAllowedOrigin(origin)) {
        return sendJson(response, 403, { ok: false, message: "Origin not allowed." });
      }

      const url = new URL(request.url || "/", "http://waitlist.internal");

      if (request.method === "OPTIONS") {
        response.writeHead(204, {
          ...corsHeaders(origin),
          "Access-Control-Allow-Methods": "DELETE, GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Max-Age": "600",
          "Cache-Control": "no-store"
        });
        return response.end();
      }

      if (request.method === "GET" && url.pathname === "/api/health") {
        await pool.query("SELECT 1");
        return sendJson(response, 200, { ok: true, service: "preski-labs-waitlist" }, origin);
      }

      if (request.method === "POST" && url.pathname === "/api/waitlist") {
        // Detect the native-form response mode before parsing so malformed form submissions
        // still return to the waitlist section instead of rendering an API error document.
        submissionFormat = requestFormat(request);

        const rate = rateLimiter.check(request);
        if (!rate.allowed) {
          return sendSubmissionResult(
            response,
            submissionFormat,
            false,
            origin,
            429,
            { ok: false, message: "Please wait before trying again." }
          );
        }

        const parsed = await parseSignupRequest(request, submissionFormat);
        const signup = validateSignup(parsed.payload, {
          allowMissingStartTime: submissionFormat === "form"
        });
        if (!signup.isLikelyBot) await saveSignup(pool, signup);
        return sendSubmissionResult(response, submissionFormat, true, origin);
      }

      if (request.method === "GET" && url.pathname === "/api/admin/waitlist/summary") {
        if (!requireAdmin(request, response, config, origin)) return;
        allowedQuery(url, new Set());
        return sendJson(response, 200, { ok: true, summary: await getSummary(pool) }, origin);
      }

      if (request.method === "GET" && url.pathname === "/api/admin/waitlist") {
        if (!requireAdmin(request, response, config, origin)) return;
        allowedQuery(url, new Set(["limit", "product"]));
        const product = validateProductFilter(url.searchParams.get("product") || undefined);
        const limit = validateLimit(url.searchParams.get("limit") || undefined);
        const signups = await listSignups(pool, { product, limit });
        return sendJson(response, 200, { ok: true, count: signups.length, signups }, origin);
      }

      if (request.method === "GET" && url.pathname === "/api/admin/waitlist.csv") {
        if (!requireAdmin(request, response, config, origin)) return;
        allowedQuery(url, new Set(["product"]));
        const product = validateProductFilter(url.searchParams.get("product") || undefined);
        const csv = buildAppleTestFlightCsv(await listSignupsForExport(pool, { product }));
        response.writeHead(200, {
          ...corsHeaders(origin),
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="preski-labs-testflight-testers.csv"',
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Length": Buffer.byteLength(csv)
        });
        return response.end(csv);
      }

      const deleteMatch = request.method === "DELETE"
        ? url.pathname.match(/^\/api\/admin\/waitlist\/([^/]+)$/u)
        : null;
      if (deleteMatch) {
        if (!requireAdmin(request, response, config, origin)) return;
        allowedQuery(url, new Set());
        const id = validateSignupId(deleteMatch[1]);
        const deleted = await deleteSignup(pool, id);
        return sendJson(
          response,
          deleted ? 200 : 404,
          deleted
            ? { ok: true, deleted: true }
            : { ok: false, message: "Signup not found." },
          origin
        );
      }

      return sendJson(response, 404, { ok: false, message: "Not found." }, origin);
    } catch (error) {
      if (error instanceof ValidationError || error instanceof HttpError) {
        const status = error instanceof HttpError ? error.status : 400;
        return sendSubmissionResult(
          response,
          submissionFormat,
          false,
          origin,
          status,
          {
            ok: false,
            message: error.message,
            ...(error.field ? { field: error.field } : {})
          }
        );
      }

      // Never include request bodies, SQL parameters, authorization values, or email addresses in logs.
      console.error("Waitlist request failed.", { requestId, method: request.method, path: request.url?.split("?", 1)[0] });
      return sendSubmissionResult(
        response,
        submissionFormat,
        false,
        origin,
        503,
        { ok: false, message: "The waitlist is temporarily unavailable. Please try again." }
      );
    }
  };
}
