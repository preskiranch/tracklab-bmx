import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const migrationsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations"
);
const LOCK_NAME = "preski_labs_waitlist_migrations_v1";

function checksum(contents) {
  return createHash("sha256").update(contents, "utf8").digest("hex");
}

export async function runMigrations(pool) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [LOCK_NAME]);
    await client.query("CREATE SCHEMA IF NOT EXISTS preski_labs");
    await client.query(`
      CREATE TABLE IF NOT EXISTS preski_labs.schema_migrations (
        filename text PRIMARY KEY,
        checksum_sha256 text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const filenames = (await readdir(migrationsDirectory))
      .filter((filename) => /^\d+_[a-z0-9_-]+\.sql$/u.test(filename))
      .sort();

    for (const filename of filenames) {
      const sql = await readFile(path.join(migrationsDirectory, filename), "utf8");
      const expectedChecksum = checksum(sql);
      const applied = await client.query(
        "SELECT checksum_sha256 FROM preski_labs.schema_migrations WHERE filename = $1",
        [filename]
      );

      if (applied.rowCount === 1) {
        if (applied.rows[0].checksum_sha256 !== expectedChecksum) {
          throw new Error(`Applied migration ${filename} has changed.`);
        }
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO preski_labs.schema_migrations (filename, checksum_sha256) VALUES ($1, $2)",
          [filename, expectedChecksum]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [LOCK_NAME]);
    } finally {
      client.release();
    }
  }
}
