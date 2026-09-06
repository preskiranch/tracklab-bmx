import pg from "pg";

const { Pool } = pg;

export function createDatabasePool(config) {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: config.databasePoolSize,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 5000,
    query_timeout: 7000,
    allowExitOnIdle: false
  });

  pool.on("error", () => {
    // Deliberately omit SQL, parameters, and error messages so signup data cannot reach logs.
    console.error("Unexpected waitlist database pool error.");
  });

  return pool;
}
