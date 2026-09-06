import { MAX_REQUEST_BYTES } from "./constants.mjs";
import { formEntriesToSignup } from "./form.mjs";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function requestFormat(request) {
  const rawType = request.headers["content-type"] || "";
  const contentType = rawType.split(";", 1)[0].trim().toLowerCase();
  if (contentType === "application/json") return "json";
  if (contentType === "application/x-www-form-urlencoded") return "form";
  throw new HttpError(415, "Submit the form using a supported format.");
}

async function readLimitedBody(request, maxBytes = MAX_REQUEST_BYTES) {
  const declaredLength = request.headers["content-length"];
  if (declaredLength && Number(declaredLength) > maxBytes) {
    throw new HttpError(413, "The submitted form is too large.");
  }

  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new HttpError(413, "The submitted form is too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function parseSignupRequest(request, format = requestFormat(request)) {
  const body = await readLimitedBody(request);

  if (format === "json") {
    try {
      return { format, payload: JSON.parse(body) };
    } catch {
      throw new HttpError(400, "Submit valid JSON.");
    }
  }

  return {
    format,
    payload: formEntriesToSignup(new URLSearchParams(body).entries())
  };
}

export function safeRedirectPath(success) {
  return success ? "/waitlist-success.html" : "/waitlist-error.html";
}
