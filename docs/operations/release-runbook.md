# TrackLab Production Release Runbook

This runbook is the release contract for the TrackLab cloud service. A release
is eligible for production only after every required gate below passes and the
operator records the evidence with the release commit.

For releases that include Friends, room chat, or live audio, complete the
[`community safety and moderation`](./community-safety.md) verification before
submission and confirm an administrator is assigned to the 24-hour report
queue.

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
| `TRACKLAB_OFFICIAL_ACCOUNT_BOOTSTRAP_TOKEN` | A server-only random value of at least 32 characters. It is used only to provision a missing reserved Club or Founder account, then must be rotated or removed. Existing official accounts are bound automatically by the Friends migration. |
| `TRACKLAB_METRICS_TOKEN` | Long, random secret used only by the metrics collector. |
| `TRACKLAB_APNS_ENABLED` | Must be `1` for the signed iOS push release. Invalid required startup configuration fails health closed. |
| `TRACKLAB_APNS_TEAM_ID` / `TRACKLAB_APNS_KEY_ID` | Apple Developer Team ID and APNs token-signing Key ID. |
| `TRACKLAB_APNS_PRIVATE_KEY` | Server-only P-256 APNs `.p8` key (multiline or base64 PKCS#8). A mounted `TRACKLAB_APNS_PRIVATE_KEY_PATH` may be used instead. |
| `TRACKLAB_PUSH_TOKEN_ENCRYPTION_KEY` | Exactly 32 random bytes in standard base64; encrypts stored APNs device tokens. |
| `TRACKLAB_PUSH_TOKEN_FINGERPRINT_KEY` | Separate backed-up installation-identity secret. It must remain stable; see the [APNs runbook](./apns-notifications.md). |
| `TRACKLAB_PUSH_TOKEN_KEY_VERSION` | Current positive encryption-key version. Start at `1`. |
| `TRACKLAB_PUSH_TOKEN_PREVIOUS_ENCRYPTION_KEYS` | Optional JSON map of at most four prior versions to 32-byte standard-base64 keys during staged rotation. |
| `VITE_GOOGLE_MAPS_API_KEY` | Browser-restricted Google Maps JavaScript API key. |
| `TRACKLAB_GOOGLE_MAPS_JS_API_KEY` | Client Google Maps JavaScript key delivered at runtime only to the exact bundled Capacitor request contract. Falls back to `VITE_GOOGLE_MAPS_API_KEY` when omitted. |
| `OPENAI_API_KEY` | Optional server-only key for source-backed track research, pre-race reports, natural race wording, and speech. Without it, TrackLab uses verified catalog facts and the browser voice fallback. |
| `TRACKLAB_APPLE_IAP_ENABLED` | Set to `1` only after all Apple products, server credentials, and notification URLs are configured. Startup fails closed if an enabled configuration is incomplete. |
| `TRACKLAB_APPLE_ONLY_CUTOVER` | Keep `0` through staging and migration. Set to `1` only after production StoreKit lifecycle tests pass and legacy Square renewals/paid obligations are resolved. |
| `TRACKLAB_APPLE_BUNDLE_ID` / `TRACKLAB_APPLE_APP_ID` | `com.preskilranch.tracklabbmx` and its numeric App Store Connect Apple ID. |
| `TRACKLAB_APPLE_SUBSCRIPTION_GROUP_ID` | Numeric identifier of the single Wattbike Connections subscription group. All four plans must be in this group. |
| `TRACKLAB_APPLE_ISSUER_ID` / `TRACKLAB_APPLE_KEY_ID` | App Store Connect In-App Purchase API key identifiers. |
| `TRACKLAB_APPLE_PRIVATE_KEY` | Server-only App Store Connect `.p8` private key as PEM, escaped-newline PEM, or base64 PEM. Never use a `VITE_` prefix. |
| `TRACKLAB_APPLE_SANDBOX_ACCOUNT_TOKENS` | Comma-separated TrackLab UUIDs for designated TestFlight/App Review accounts only; never authorize arbitrary production users with sandbox purchases. |

`GET /api/health` reports Apple billing under `billing`. A configured pre-cutover
deployment must report `provider: "apple-app-store"`, `enabled: true`,
`configured: true`, and `ready: true`. After the final switch it must additionally
report `billing.appleOnlyCutover: true` and
`requirements.appleOnlyCutover: true`.

Before submission, App Store Connect App Privacy must disclose linked,
non-tracking Purchase History and User ID data used to verify Wattbike
subscriptions. Those answers must match `ios/App/App/PrivacyInfo.xcprivacy`.

Keep `TRACKLAB_LOG_HTTP=0` during normal operation. Enable it only for a short
diagnostic window. Restrict the Google Maps client key to the production and
approved development origins plus TrackLab's exact bundled origin,
`capacitor://localhost/*`. Confirm a signed iPhone and iPad can load both 2D
satellite and 3D Maps views after every client-key restriction change.

The Friends migration binds the already-provisioned `preskiranch@gmail.com`
and `rasheen25@gmail.com` rows to immutable Official identities. If either row
does not exist yet, ordinary public registration for that reserved address is
rejected. Provision it once through `POST /api/auth/register` with the
`x-tracklab-official-bootstrap-token` header, confirm the Official badge and
default connection fan-out, and then rotate or remove the bootstrap token.

Complete the signed-build, secret provisioning, sandbox/production device,
rotation, health, and rollback procedure in
[`apns-notifications.md`](./apns-notifications.md) before enabling remote alerts.

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
TRACKLAB_EXPECT_APNS=1 \
TRACKLAB_EXPECT_APPLE_IAP=1 \
npm run smoke:deployment

TRACKLAB_SMOKE_URL=https://staging.example.com \
TRACKLAB_LOAD_REQUESTS=100 \
TRACKLAB_LOAD_CONCURRENCY=10 \
TRACKLAB_LOAD_P95_MS=1500 \
npm run probe:load
```

5. Complete one spectator login, one administrator login, one saved-map read,
   one demo race, one private-room join, and one StoreKit sandbox purchase and
   restore on a signed iOS build.
6. For bike or race-engine changes, complete the relevant rows in
   [`hardware-acceptance.md`](./hardware-acceptance.md).
7. Deploy the same commit to production.
8. Repeat the production smoke test with `TRACKLAB_EXPECT_POSTGRES=1`,
   `TRACKLAB_EXPECT_APNS=1`, and `TRACKLAB_EXPECT_APPLE_IAP=1`.
9. Watch error ratio, p95 latency, persistence failures, WebSocket clients, and
   process restarts for at least 15 minutes.

After completing the documented Square customer transition and setting
`TRACKLAB_APPLE_ONLY_CUTOVER=1`, rerun the production smoke with both
`TRACKLAB_EXPECT_APPLE_IAP=1` and
`TRACKLAB_EXPECT_APPLE_ONLY_CUTOVER=1`. The cutover is not complete until that
gate passes. Use the matching opt-in inputs when running the manual GitHub
Actions workflow.

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
- Apple billing health matches the release phase (configured before cutover,
  Apple-only after the final switch);
- the current hardware acceptance scope has passed;
- the incident owner has a tested rollback target and database recovery path.

Pause or roll back when any health, authentication, persistence, live-race,
billing, or data-integrity check fails. Do not waive a failed data-integrity
gate to meet a release date.

## Application Rollback

Use the previous healthy Render deploy when the database schema remains
backward compatible:

After the first Apple subscription is reconciled, the rollback target must be
an Apple-IAP-capable commit that reads verified entitlements. Apple-managed
accounts keep the legacy `membership_tier` and `bike_seats` columns
fail-closed, so a pre-IAP build cannot grant perpetual access but would remove
paid Wattbike access. Record the minimum safe rollback commit before enabling
Apple purchases.

1. Stop new billing or race starts if the incident can corrupt data.
2. Record the failing commit, request IDs, timestamps, and migration version.
3. Roll back the Render service to the previous healthy commit.
4. Confirm `/api/health`, then run `npm run smoke:deployment` against production.
5. Verify login, one saved map, and one read-only race result before reopening.

Migrations are forward-only. Do not delete rows from
`tracklab.schema_migrations`, modify migration checksums, or manually undo DDL
on the live database. If the new schema or application writes damaged data,
restore to an isolated database first and follow the recovery procedure.

## Square Credential Retirement

Removing TrackLab's Square checkout code does not cancel subscriptions or
disable a leaked credential. Before the final Apple-only cutover:

1. Export the customer/subscription reconciliation evidence required for
   support, accounting, refunds, and already-paid service obligations.
2. Cancel every TrackLab Square renewal and confirm no customer remains in a
   recurring billing state.
3. Confirm the Square application credential is not shared with another
   service or business workflow.
4. Remove `SQUARE_ENVIRONMENT`, `SQUARE_VERSION`, `SQUARE_ACCESS_TOKEN`,
   `SQUARE_LOCATION_ID`, and every `SQUARE_RACER_PLAN_VARIATION_*` value from
   Render and any CI secret stores.
5. Revoke the TrackLab Square access token in the Square Developer Dashboard.
   Record the revocation time and operator in the release evidence.
6. Redeploy, run the Apple-only deployment smoke gate, and verify historical
   billing records remain available only through the intended support/audit
   paths.

Do not delete historical Square database records as part of credential
retirement. Follow [`apple-iap.md`](../mobile/apple-iap.md#square-cutover) for
the customer-access sequence.

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
