import {
  DEVICES,
  MAX_ADMIN_PAGE_SIZE,
  PRODUCTS,
  WATTBIKE_ACCESS_VALUES
} from "./constants.mjs";

const SIGNUP_FIELDS = new Set([
  "firstName",
  "lastName",
  "email",
  "product",
  "device",
  "wattbikeAccess",
  "adultOrGuardian",
  "betaConsent",
  "marketingConsent",
  "website",
  "formStartedAt"
]);

export class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = "ValidationError";
    this.field = field;
  }
}

function requirePlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("Submit a valid waitlist form.");
  }

  for (const field of Object.keys(value)) {
    if (!SIGNUP_FIELDS.has(field)) {
      throw new ValidationError("The form contains an unsupported field.", field);
    }
  }
}

function requiredName(value, field) {
  if (typeof value !== "string") throw new ValidationError("Enter a valid name.", field);

  const name = value.trim().replace(/\s+/gu, " ");
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/u.test(name)) {
    throw new ValidationError("Enter a valid name with 80 characters or fewer.", field);
  }

  return name;
}

export function normalizeEmail(value) {
  if (typeof value !== "string") {
    throw new ValidationError("Enter a valid email address.", "email");
  }

  // Intentionally do not strip Gmail dots, plus tags, or otherwise rewrite an address.
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254 || /[\s\u0000-\u001f\u007f]/u.test(email)) {
    throw new ValidationError("Enter a valid email address.", "email");
  }

  const at = email.lastIndexOf("@");
  if (at < 1 || at !== email.indexOf("@")) {
    throw new ValidationError("Enter a valid email address.", "email");
  }

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (
    local.length > 64 ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..") ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/iu.test(local)
  ) {
    throw new ValidationError("Enter a valid email address.", "email");
  }

  const labels = domain.split(".");
  if (
    labels.length < 2 ||
    labels.some(
      (label) =>
        !label ||
        label.length > 63 ||
        !/^[a-z0-9-]+$/iu.test(label) ||
        label.startsWith("-") ||
        label.endsWith("-")
    )
  ) {
    throw new ValidationError("Enter a valid email address.", "email");
  }

  return email;
}

function requiredBoolean(value, field, message) {
  if (value !== true) throw new ValidationError(message, field);
  return true;
}

function optionalBoolean(value, field) {
  if (value === undefined) return false;
  if (typeof value !== "boolean") {
    throw new ValidationError("Choose a valid option.", field);
  }
  return value;
}

function validateStartTime(value, now, allowMissingStartTime) {
  if (allowMissingStartTime && (value === undefined || value === null || value === "")) return;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ValidationError("Please reload the page and try again.", "formStartedAt");
  }

  if (value > now + 5_000) {
    throw new ValidationError("Please reload the page and try again.", "formStartedAt");
  }
}

export function validateSignup(payload, { now = Date.now(), allowMissingStartTime = false } = {}) {
  requirePlainObject(payload);

  if (payload.website !== undefined && typeof payload.website !== "string") {
    throw new ValidationError("Submit a valid waitlist form.", "website");
  }

  const honeypotTriggered = Boolean(payload.website?.trim());
  validateStartTime(payload.formStartedAt, now, allowMissingStartTime);

  // Give obvious automated submissions the same success response without touching the database.
  // Avoid validating the remaining fields because field-level errors would reveal the trap.
  if (honeypotTriggered) return { isLikelyBot: true };

  if (typeof payload.product !== "string" || !PRODUCTS.includes(payload.product)) {
    throw new ValidationError("Choose a valid beta program.", "product");
  }

  if (typeof payload.device !== "string" || !DEVICES.includes(payload.device)) {
    throw new ValidationError("Choose a valid primary device.", "device");
  }

  if (
    typeof payload.wattbikeAccess !== "string" ||
    !WATTBIKE_ACCESS_VALUES.includes(payload.wattbikeAccess)
  ) {
    throw new ValidationError("Choose a valid Wattbike access option.", "wattbikeAccess");
  }

  return {
    firstName: requiredName(payload.firstName, "firstName"),
    lastName: requiredName(payload.lastName, "lastName"),
    email: normalizeEmail(payload.email),
    product: payload.product,
    device: payload.device,
    wattbikeAccess: payload.wattbikeAccess,
    adultOrGuardian: requiredBoolean(
      payload.adultOrGuardian,
      "adultOrGuardian",
      "An adult or parent/guardian must join the beta waitlist."
    ),
    betaConsent: requiredBoolean(
      payload.betaConsent,
      "betaConsent",
      "Permission to contact you about beta testing is required."
    ),
    marketingConsent: optionalBoolean(payload.marketingConsent, "marketingConsent"),
    isLikelyBot: false
  };
}

export function validateProductFilter(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !PRODUCTS.includes(value)) {
    throw new ValidationError("Choose a valid product filter.", "product");
  }
  return value;
}

export function validateLimit(value) {
  if (value === undefined || value === null || value === "") return 100;
  if (typeof value !== "string" || !/^[1-9]\d*$/u.test(value)) {
    throw new ValidationError("Choose a valid result limit.", "limit");
  }

  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit > MAX_ADMIN_PAGE_SIZE) {
    throw new ValidationError(`Limit must be between 1 and ${MAX_ADMIN_PAGE_SIZE}.`, "limit");
  }
  return limit;
}

export function validateSignupId(value) {
  if (typeof value !== "string" || !/^[1-9]\d{0,18}$/u.test(value)) {
    throw new ValidationError("Choose a valid signup.", "id");
  }
  return value;
}
