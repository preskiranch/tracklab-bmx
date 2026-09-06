export const PRODUCTS = Object.freeze(["tracklab-bmx", "tooltrack", "both"]);

export const DEVICES = Object.freeze([
  "ipad",
  "iphone",
  "android",
  "android-tablet",
  "android-phone",
  "mac",
  "windows",
  "other"
]);

export const WATTBIKE_ACCESS_VALUES = Object.freeze(["yes", "no", "unsure"]);

export const CONSENT_VERSION = "2026-09-06";
export const MAX_REQUEST_BYTES = 8 * 1024;
export const MAX_ADMIN_PAGE_SIZE = 500;

export const ALLOWED_ORIGINS = Object.freeze([
  "https://preskilabs.com",
  "https://www.preskilabs.com",
  "https://preski-labs.onrender.com",
  "http://localhost:3000",
  "http://localhost:4173",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:4173",
  "http://127.0.0.1:5173"
]);

export const GENERIC_SUCCESS = Object.freeze({
  ok: true,
  message: "Thanks. You're on the Preski Labs beta waitlist."
});
