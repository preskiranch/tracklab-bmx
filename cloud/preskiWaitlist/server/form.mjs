import { ValidationError } from "./validation.mjs";

const BOOLEAN_FIELDS = new Set([
  "adultOrGuardian",
  "betaConsent",
  "marketingConsent"
]);

const TRUE_VALUES = new Set(["1", "true", "on", "yes"]);
const FALSE_VALUES = new Set(["0", "false", "off", "no", ""]);

function formBoolean(value, field) {
  if (value === undefined) return false;
  const normalized = value.toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  throw new ValidationError("Choose a valid option.", field);
}

export function formEntriesToSignup(entries) {
  const payload = {};

  for (const [field, value] of entries) {
    if (Object.hasOwn(payload, field)) {
      throw new ValidationError("The form contains a duplicate field.", field);
    }
    payload[field] = value;
  }

  for (const field of BOOLEAN_FIELDS) payload[field] = formBoolean(payload[field], field);

  if (typeof payload.formStartedAt === "string" && /^\d+$/u.test(payload.formStartedAt)) {
    payload.formStartedAt = Number(payload.formStartedAt);
  }

  return payload;
}
