# TrackLab Production Release Runbook

This runbook is the release contract for the TrackLab cloud service. A release
is eligible for production only after every required gate below passes and the
operator records the evidence with the release commit.

## Release Owners

Assign one person to each role before the release:

- Release operator: runs the gates and deploys the selected commit.
- Database operator: confirms the backup and can perform a restore.
- Acceptance operator: validates the browser, multiplayer, and Wattbike paths.
- Incident owner: decides whether to continue, pause, or roll back.

One person may hold multiple roles during beta, but every role must have a
named owner.

## Required Production Configuration

Render must use Node.js 22 or newer and contain these server-side values:

| Variable | Requirement |
| --- | --- |
| `DATABASE_URL` | Required PostgreSQL connection URL. |
| `TRACKLAB_REQUIRE_DATABASE` | Must be `1`; prevents temporary in-memory production storage. |
| `TRACKLAB_ADMIN_EMAILS` | Comma-separated administrator email allowlist. |
| `TRACKLAB_METRICS_TOKEN` | Long, random secret used only by the metrics collector. |
| `VITE_GOOGLE_MAPS_API_KEY` | Browser-restricted Google Maps JavaScript API key. |
| `OPENAI_API_KEY` | Optional server-only key for natural AI race wording and speech. Without it, TrackLab uses the browser voice fallback. |
| `SQUARE_ENVIRONMENT` | `sandbox` during billing acceptance; `production` only after approval. |
| `SQUARE_ACCESS_TOKEN` | Server-only Square credential. Never use a `VITE_` prefix. |
| `SQUARE_LOCATION_ID` | Square location that owns the subscriptions. |
| `SQUARE_RACER_PLAN_VARIATION_*` | One valid plan variation for each supported bike count. |

Keep `TRACKLAB_LOG_HTTP=0` during normal operation. Enable it only for a short
diagnostic window. Restrict Google Maps HTTP referrers to the production and
approved development origins.

## Pre-Release Gates

Run from a clean checkout of the exact commit to be deployed:

```bash
npm ci --include=dev
npm run verify:release:full
git status --short
```

The release fails if:

- a production dependency has a high or critical advisory;
- unit, API, type, build, bundle-budget, or browser tests fail;
- the generated track database does not validate;
- the worktree contains unexplained generated or source changes;
- the database backup and restore drill is overdue;
- the required hardware acceptance matrix has not passed for a hardware change.

Record the unit-test count, browser-test count, compressed bundle size, commit
SHA, and test timestamp in the release ticket.

## Database Backup

Complete the backup verification in
[`database-recovery.md`](./database-recovery.md) before deploying a migration.
Never edit an already-applied migration. The migration runner validates names
and checksums, serializes startup with a PostgreSQL advisory lock, and runs each
new migration in a transaction.

The application starts accepting traffic before persistence initialization is
complete, but `/api/health` remains non-ready while required PostgreSQL storage
is unavailable. Render must not route the instance as healthy until this check
returns `200` with `"storage":"postgres"`.

## Deployment Procedure

1. Confirm the release commit and backup artifact.
2. Deploy the selected commit to the staging service.
3. Wait for `/api/health` to report `200` and PostgreSQL storage.
4. Run the deployment smoke and bounded read-only load probe:

```bash
TRACKLAB_SMOKE_URL=https://staging.example.com \
TRACKLAB_EXPECT_POSTGRES=1 \
npm run smoke:deployment

TRACKLAB_SMOKE_URL=https://staging.example.com \
TRACKLAB_LOAD_REQUESTS=100 \
TRACKLAB_LOAD_CONCURRENCY=10 \
TRACKLAB_LOAD_P95_MS=1500 \
npm run probe:load
```

5. Complete one spectator login, one administrator login, one saved-map read,
   one demo race, one private-room join, and one Square sandbox checkout.
6. For bike or race-engine changes, complete the relevant rows in
   [`hardware-acceptance.md`](./hardware-acceptance.md).
7. Deploy the same commit to production.
8. Repeat the production smoke test with `TRACKLAB_EXPECT_POSTGRES=1`.
9. Watch error ratio, p95 latency, persistence failures, WebSocket clients, and
   process restarts for at least 15 minutes.

The manual GitHub Actions workflow `Deployment smoke` can execute the smoke
and optional load probe against staging or production. It supplements, but does
not replace, hardware acceptance.

## Go Or No-Go Criteria

Proceed only when all of these are true:

- health reports PostgreSQL and the expected release version;
- deployment smoke has no failed assertion;
- bounded load p95 is at or below the release budget with zero failed requests;
- migration logs show no checksum, lock, or query failure;
- authentication boundaries and administrator access behave as expected;
- the current hardware acceptance scope has passed;
- the incident owner has a tested rollback target and database recovery path.

Pause or roll back when any health, authentication, persistence, live-race,
billing, or data-integrity check fails. Do not waive a failed data-integrity
gate to meet a release date.

## Application Rollback

Use the previous healthy Render deploy when the database schema remains
backward compatible:

1. Stop new billing or race starts if the incident can corrupt data.
2. Record the failing commit, request IDs, timestamps, and migration version.
3. Roll back the Render service to the previous healthy commit.
4. Confirm `/api/health`, then run `npm run smoke:deployment` against production.
5. Verify login, one saved map, and one read-only race result before reopening.

Migrations are forward-only. Do not delete rows from
`tracklab.schema_migrations`, modify migration checksums, or manually undo DDL
on the live database. If the new schema or application writes damaged data,
restore to an isolated database first and follow the recovery procedure.

## Failed Migration Recovery

A failed migration transaction is rolled back automatically. If startup is
unhealthy:

1. Keep the failing release out of service.
2. Inspect structured migration and persistence logs.
3. Query `tracklab.schema_migrations` and compare it with `cloud/migrations.mjs`.
4. Correct the unapplied migration in a new commit. Never rewrite an applied one.
5. Validate against a restored production backup before redeploying.

If an applied migration produced incorrect data, create a new forward repair
migration or restore the database. Choose using the recovery point and data
loss analysis, not by editing migration history.

## Post-Release Evidence

Attach the following to the release record:

- commit SHA and Render deploy ID;
- `verify:release:full` result;
- staging and production smoke output;
- load-probe request count, concurrency, p50, p95, p99, and error count;
- database backup checksum and restore-drill date;
- applicable hardware acceptance sheet;
- known limitations and any temporary alert suppression.
