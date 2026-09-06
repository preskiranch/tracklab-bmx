function positiveInteger(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/u.test(value) || Number(value) <= 0) throw new Error(`${name} must be a positive integer.`);
  return Number(value);
}

export function loadConfig(environment = process.env) {
  const databaseUrl = environment.WAITLIST_DATABASE_URL || environment.DATABASE_URL;
  if (!databaseUrl) throw new Error("WAITLIST_DATABASE_URL or DATABASE_URL is required.");
  const adminToken = environment.WAITLIST_ADMIN_TOKEN || "";
  if (environment.NODE_ENV === "production" && adminToken.length < 32) {
    throw new Error("WAITLIST_ADMIN_TOKEN must contain at least 32 characters in production.");
  }

  return {
    databaseUrl,
    port: positiveInteger(environment.PORT, 10_000, "PORT"),
    adminToken,
    trustProxy: environment.TRUST_PROXY === "1" || environment.TRUST_PROXY === "true",
    databasePoolSize: positiveInteger(environment.WAITLIST_DB_POOL_SIZE, 5, "WAITLIST_DB_POOL_SIZE"),
    rateLimitMax: positiveInteger(environment.WAITLIST_RATE_LIMIT_MAX, 8, "WAITLIST_RATE_LIMIT_MAX"),
    rateLimitWindowMs: positiveInteger(
      environment.WAITLIST_RATE_LIMIT_WINDOW_MS,
      10 * 60_000,
      "WAITLIST_RATE_LIMIT_WINDOW_MS"
    )
  };
}
