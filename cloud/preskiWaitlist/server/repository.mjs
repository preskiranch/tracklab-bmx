import { CONSENT_VERSION } from "./constants.mjs";

function productCondition(product, parameterNumber = 1) {
  if (!product) return { sql: "", values: [] };
  if (product === "both") {
    return { sql: `product = $${parameterNumber}`, values: [product] };
  }
  return {
    sql: `(product = $${parameterNumber} OR product = 'both')`,
    values: [product]
  };
}

function mapRow(row) {
  return {
    id: String(row.id),
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    product: row.product,
    device: row.device,
    wattbikeAccess: row.wattbike_access,
    marketingConsent: row.marketing_consent,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    invitedAt: row.invited_at
  };
}

export async function saveSignup(pool, signup) {
  await pool.query(
    `
      INSERT INTO preski_labs.beta_waitlist_signups (
        first_name,
        last_name,
        email,
        email_normalized,
        product,
        device,
        wattbike_access,
        adult_or_guardian,
        beta_consent,
        beta_consent_at,
        marketing_consent,
        marketing_consent_at,
        consent_version
      ) VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8, now(), $9, CASE WHEN $9 THEN now() ELSE NULL END, $10)
      ON CONFLICT (email_normalized) DO NOTHING
    `,
    [
      signup.firstName,
      signup.lastName,
      signup.email,
      signup.product,
      signup.device,
      signup.wattbikeAccess,
      signup.adultOrGuardian,
      signup.betaConsent,
      signup.marketingConsent,
      CONSENT_VERSION
    ]
  );
}

export async function deleteSignup(pool, id) {
  const result = await pool.query(
    "DELETE FROM preski_labs.beta_waitlist_signups WHERE id = $1 RETURNING id",
    [id]
  );
  return result.rowCount === 1;
}

export async function getSummary(pool) {
  const result = await pool.query(`
    SELECT
      count(*)::bigint AS total,
      count(*) FILTER (WHERE product IN ('tracklab-bmx', 'both'))::bigint AS tracklab_bmx,
      count(*) FILTER (WHERE product IN ('tooltrack', 'both'))::bigint AS tooltrack,
      count(*) FILTER (WHERE product = 'both')::bigint AS both,
      count(*) FILTER (WHERE wattbike_access = 'yes')::bigint AS wattbike_access,
      count(*) FILTER (WHERE marketing_consent)::bigint AS marketing_consent,
      count(*) FILTER (WHERE status = 'waitlisted')::bigint AS waitlisted,
      count(*) FILTER (WHERE status = 'invited')::bigint AS invited,
      max(created_at) AS last_signup_at
    FROM preski_labs.beta_waitlist_signups
    WHERE status <> 'removed'
  `);
  const row = result.rows[0];

  return {
    total: Number(row.total),
    byProduct: {
      tracklabBmx: Number(row.tracklab_bmx),
      tooltrack: Number(row.tooltrack),
      both: Number(row.both)
    },
    wattbikeAccess: Number(row.wattbike_access),
    marketingConsent: Number(row.marketing_consent),
    byStatus: {
      waitlisted: Number(row.waitlisted),
      invited: Number(row.invited)
    },
    lastSignupAt: row.last_signup_at
  };
}

export async function listSignups(pool, { limit = 100, product = null } = {}) {
  const condition = productCondition(product);
  const where = ["status <> 'removed'", condition.sql].filter(Boolean).join(" AND ");
  const values = [...condition.values, limit];
  const limitParameter = `$${values.length}`;

  const result = await pool.query(
    `
      SELECT
        id,
        first_name,
        last_name,
        email,
        product,
        device,
        wattbike_access,
        marketing_consent,
        status,
        created_at,
        updated_at,
        invited_at
      FROM preski_labs.beta_waitlist_signups
      WHERE ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT ${limitParameter}
    `,
    values
  );

  return result.rows.map(mapRow);
}

export async function listSignupsForExport(pool, { product = null } = {}) {
  const condition = productCondition(product);
  const where = ["status <> 'removed'", condition.sql].filter(Boolean).join(" AND ");
  const result = await pool.query(
    `
      SELECT first_name, last_name, email
      FROM preski_labs.beta_waitlist_signups
      WHERE ${where}
      ORDER BY created_at ASC, id ASC
    `,
    condition.values
  );

  return result.rows.map((row) => ({
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email
  }));
}
