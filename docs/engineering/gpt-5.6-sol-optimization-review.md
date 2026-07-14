# TrackLab BMX Production Readiness Review

Review branch: `optimization/production-readiness-10`
Baseline: `0028d45` (`main`)
Review date: 2026-07-14

## Executive Summary

TrackLab BMX is a substantial application with live BLE/ANT+ bike input, deterministic BMX rollout physics, satellite track mapping, pedal-zone analysis, local and online racing, ghosts, social features, authentication, billing, and a 1,305-track global catalog. The product surface is well beyond a prototype, but a production platform also needs repeatable schema changes, bounded device state, telemetry, deployment gates, recovery procedures, and hardware acceptance evidence.

This review implemented the improvements that provide measurable security, reliability, performance, maintainability, or operational value without rewriting the product. The branch adds checksummed database migrations, production indexes, structured redacted telemetry, Prometheus metrics, request correlation, bounded live-bike registries, stale-message rejection, listener cleanup, precompressed assets, bundle budgets, deployment smoke tests, a load probe, required-database enforcement, release and recovery runbooks, and a formal 1-4 Wattbike acceptance matrix. It also adds the persistent studio rider roster requested for assigning students to connected bikes without changing bike identity.

The automated release gate passes in full: 82 unit/API tests, 13 Chromium end-to-end workflows, type checking, catalog validation, production build, dependency audit, and bundle budgets. The production server smoke passes, and a bounded local load probe completed 100/100 requests with 12 ms p95 latency.

The software engineering work on this branch is release-candidate quality. A literal 10/10 production signoff is intentionally conditional on the external acceptance items that code alone cannot prove: the documented physical 1-4 Wattbike matrix, PostgreSQL restore drill, Square lifecycle reconciliation, and representative deployed multiplayer/voice load. Calling the product perfect before those checks would hide operational risk rather than remove it.

## Review Method

- Compared the branch with `main` and reviewed all changed production boundaries.
- Audited authentication, profile ownership, billing claims, realtime identity, local connector access, static serving, and input validation.
- Reviewed PostgreSQL schema setup, indexes, concurrent writes, migrations, and recovery expectations.
- Profiled the catalog and production bundle, then introduced hard budgets and compression checks.
- Reviewed BLE/ANT+ message lifecycle, duplicate connection handling, stale data, cleanup, and sample retention.
- Added deterministic unit/API tests around new infrastructure and preserved browser workflows for live racing.
- Exercised the built production server through health, static asset, auth boundary, catalog, 404, and load probes.
- Deferred broad module decomposition and distributed architecture where regression risk or infrastructure cost exceeds immediate measurable value.

## Implemented Commits

| Commit | Change | Why it matters |
| --- | --- | --- |
| `9444d35` | Persistent studio rider roster | Separates student/rider identity from physical bike identity and persists assignments. |
| `8ce2da3` | Studio roster test coverage | Protects account synchronization and bike assignment behavior. |
| `bd4b0a6` | Versioned database migrations | Replaces startup schema mutation with ordered, checksummed, locked migrations. |
| `8f6ecb3` | Structured production observability | Adds redacted JSON logs, request IDs, metrics, and subsystem instrumentation. |
| `3ecad19` | Live bike connection lifecycle hardening | Rejects stale/malformed data, prevents duplicate reconnect loops, and bounds memory/listeners. |
| `7222dae` | Production release gates | Adds compression, bundle budgets, deployment smoke tests, load probes, CI, and required-database enforcement. |
| `0a82917` | Production operations runbooks | Documents release, rollback, database recovery, observability, and hardware acceptance. |
| `27ef50e` | Compatible dependency refresh | Moves supported patch versions forward with a zero-vulnerability audit and full regression gate. |

## High-Impact Improvements

### 1. Versioned, checksummed database migrations

**Current issue:** Production DDL previously ran as part of application startup. That made migration ordering, drift detection, concurrent deploys, and rollback decisions difficult to reason about.

**Implemented:** `cloud/migrations.mjs` now applies ordered migrations under a PostgreSQL advisory lock. Each migration is checksummed and committed in its own transaction. Startup rejects checksum drift and schemas newer than the running application. Production indexes are part of migration 3 rather than ad hoc startup behavior.

**Benefit:** Deterministic deploys, safe concurrent startup, reviewable schema history, and an explicit recovery path.
**Impact:** High.

### 2. Production observability and correlation

**Current issue:** Failures across HTTP, WebSocket rooms, races, persistence, and the local connector were difficult to correlate, and unstructured logs were unsuitable for alerting.

**Implemented:** Shared telemetry emits structured, redacted JSON logs with request/session correlation. Prometheus-compatible counters, gauges, and histograms cover HTTP traffic, WebSocket connections, database latency, room/race events, and connector behavior. Health responses expose storage readiness without leaking secrets.

**Benefit:** Faster incident diagnosis, measurable service-level indicators, and safer production logs.
**Impact:** High.

### 3. Bounded live-device lifecycle

**Current issue:** Browser reconnects, duplicated sources, future/stale timestamps, malformed messages, and unbounded samples could produce phantom bikes, stale telemetry, listener leaks, or growing memory.

**Implemented:** The live-bike registry normalizes source identity, rejects malformed/future/stale messages, deduplicates connections, bounds retained samples, and expires inactive devices. Keyed cleanup registries guarantee timers/listeners are replaced and released. BLE and bridge hooks use the shared lifecycle contract.

**Benefit:** More reliable automatic reconnection, accurate connected-bike state, and bounded long-running studio sessions.
**Impact:** High.

### 4. Enforced release gates

**Current issue:** A passing build did not prove catalog integrity, compressed delivery, bundle size, server health, auth boundaries, or browser race behavior.

**Implemented:** `verify:release:full` now gates audit, unit/API tests, track generation and validation, TypeScript, production build, compression, bundle budgets, and Chromium end-to-end tests. Deployment smoke verifies health, request IDs, security headers, storage readiness, app shell, compressed immutable assets, catalog size, anonymous auth behavior, and 404 handling. A read-only load probe enforces an explicit p95 budget.

**Benefit:** Releases are repeatable, measurable, and fail before deployment when critical contracts regress.
**Impact:** High.

### 5. Production database requirement

**Current issue:** A production service could silently fall back to in-memory persistence and appear healthy, losing account or race data on restart.

**Implemented:** `TRACKLAB_REQUIRE_DATABASE=1` is set in Render configuration. Health returns unavailable when persistent storage is required but not ready.

**Benefit:** Prevents a deceptively healthy deployment with non-durable storage.
**Impact:** High.

## Medium-Impact Improvements

### Static delivery and bundle governance

- Production assets are generated with Brotli and gzip variants.
- Hashed assets are immutable; mutable data remains revalidated.
- JavaScript and CSS have raw and Brotli budgets, including a total initial-transfer budget.
- Current initial JavaScript plus CSS is 143,612 Brotli bytes against a 195,000-byte limit.

**Benefit:** Faster mobile/tablet startup and an objective guard against bundle growth.
**Impact:** Medium.

### Operational recovery

- Release runbook defines preflight, deployment, smoke, rollback, and incident evidence.
- Database runbook defines backup, forward-only migration recovery, restore validation, and checksum-drift response.
- Hardware runbook defines a 1-4 Wattbike matrix, latency targets, reconnect checks, race behavior, and acceptance evidence.

**Benefit:** Operators can recover predictably instead of improvising during an outage.
**Impact:** Medium.

### Studio rider assignment

- Account-scoped rider profiles can be assigned to connected bikes for a session.
- Physical bike identity remains keyed by monitor/source ID, while results use the assigned rider identity.
- Tests cover roster persistence and assignment behavior.

**Benefit:** A studio can track students rather than attributing every result only to a bike.
**Impact:** Medium.

## Low-Impact Improvements

- Updated compatible patch releases for Vite, `ws`, `concurrently`, and Node type definitions.
- Added explicit Node engine and production build expectations.
- Added documentation links from the primary README and observability guide.
- Increased the Vite chunk warning to match the stricter custom bundle budget, avoiding contradictory build output.
- Added focused unit coverage for migrations, telemetry, bridge messages, cleanup registries, production health, and studio riders.

## Security Findings

### Resolved before or during this review

1. Authenticated profile ownership is derived server-side rather than accepted from a caller-selected profile key.
2. Square return claims are verified against server-held checkout state and provider order data.
3. Multiplayer identity and membership are server-authoritative.
4. Private room visibility is filtered per authenticated participant.
5. The local connector restricts web origins and payload sizes.
6. Auth/billing endpoints, HTTP bodies, and WebSocket messages have abuse controls.
7. Static paths are constrained, missing assets return 404, and cache behavior matches mutability.
8. Structured logs redact credentials, cookies, tokens, authorization fields, and sensitive query values.
9. Request IDs and generic client errors reduce information leakage while retaining traceability.
10. Production can no longer report ready while silently using memory persistence.

### Remaining security work

- **Square lifecycle webhooks (High):** Validate signed renewal, cancellation, refund, and failed-payment events and make entitlement reconciliation authoritative.
- **Account lifecycle (Medium):** Add verified email, password reset, optional MFA/passkeys, session/device management, account export, and deletion.
- **Content Security Policy (Medium):** Introduce a tested policy after inventorying Google Maps/Earth script, worker, image, and connection origins.
- **Connector capability token (Medium):** Add a per-install secret in addition to origin checks to protect loopback APIs from other local processes.
- **Administrative audit history (Medium):** Persist append-only billing, map-publication, entitlement, and moderation events.

## Performance Findings

### Measured

- 1,305 tracks validated across 49 countries.
- Generated global catalog: 5,930,857 raw bytes, 362,526 Brotli bytes, 560,775 gzip bytes.
- Public locator catalog: 453,305 raw bytes, 76,116 Brotli bytes, 102,232 gzip bytes.
- Application JavaScript: 526,678 raw bytes, 130,620 Brotli bytes.
- Application CSS: 84,248 raw bytes, 12,992 Brotli bytes.
- Initial JS + CSS: 143,612 Brotli bytes, 26.4% below budget.
- Server smoke checks completed between 1 ms and 31 ms locally.
- Read-only load probe: 100/100 responses, concurrency 8, p50 4 ms, p95 12 ms, p99 19 ms, 1,371 requests/second locally.

### Interpretation

The local load result validates implementation overhead and regression budgets; it is not a capacity promise for Render, PostgreSQL, Google APIs, or cross-region WebSockets. Production capacity must be measured from the deployed region with representative database size and concurrent rooms.

### Deferred performance work

- Split the main bundle only after bounded feature state is extracted from `App.tsx`; superficial lazy loading would move complexity without proving user benefit.
- Add Redis/pub-sub only when multi-instance deployment is required; current in-process room ownership is simpler and faster for one instance.
- Compress ghost/race payloads only after production telemetry shows network or storage pressure.

## Database Findings and Recommendations

### Implemented

- Ordered schema versions with checksums and advisory locking.
- Per-migration transactions and explicit failure reporting.
- Atomic partial profile writes and supporting indexes from prior review work.
- Production indexes for result lookup, social state, messages, billing cleanup, and active room workflows.
- A database-required production health contract.

### Recommended next

1. Run the documented backup and restore drill against staging and record restore time and row-count checks.
2. Normalize long-lived text guest/profile relationships to `auth_users.id` foreign keys through reviewed migrations.
3. Persist full subscription lifecycle and provider event history, not only current membership tier/seats.
4. Define retention and partitioning before race samples, room messages, and ghost points reach sustained volume.
5. Capture `EXPLAIN (ANALYZE, BUFFERS)` on production-sized data before removing or adding more indexes.
6. Add reviewed constraints for enum-like statuses, seat limits, metric ranges, and non-self relationships after validating existing data.

## Architecture Findings and Recommendations

### Current strengths

- BLE and ANT+ sources converge on a shared live-bike contract.
- Physics and BMX rollout calculations are isolated enough to test deterministically.
- Mapping, local connector, cloud persistence, and multiplayer have recognizable boundaries.
- Frontend contracts are TypeScript-based, and cloud/bridge boundaries have runtime sanitization.
- Release, schema, observability, and device-lifecycle behavior now have dedicated modules and tests.

### Concentrated modules

- `src/App.tsx`: 6,452 lines.
- `cloud/server.mjs`: 3,038 lines.
- `src/components/GoogleMapsTrackLayer.tsx`: 2,265 lines.
- `cloud/persistence.mjs`: 1,484 lines.
- `src/components/SessionControlPanel.tsx`: 1,383 lines.
- `src/styles.css`: 6,143 lines.

These modules are the largest maintainability risk. They should be decomposed one bounded feature at a time, with tests moved alongside each extraction. A broad rewrite was not justified because it would create a large regression surface without changing user behavior or measured performance.

### Scale evolution

1. **Realtime horizontal scaling:** Introduce shared room/presence state, pub/sub, distributed room ownership, and sticky WebSocket routing before running more than one application instance.
2. **Regional multiplayer:** Assign rooms to a region from measured participant latency and use server-authoritative start timestamps.
3. **Voice reliability:** Add TURN with short-lived credentials and measure successful peer connection rate.
4. **API contracts:** Move handlers into versioned route modules with shared runtime schemas and generated API documentation.
5. **Connector distribution:** Ship signed macOS/Windows packages with self-update, diagnostics, and a per-install capability token.

## Technical Debt Identified

- Large UI and server orchestrators still have too many reasons to change.
- Profile maps, routes, bikes, and preferences remain partly document-shaped, which is convenient but limits querying, merge semantics, and moderation.
- Race state is represented in client, room, persistence summary, ghost, and review-capture forms without one versioned event schema.
- Shared track publication needs moderation, ownership, version history, and rollback.
- Track imports need scheduled freshness checks, provider-diff reporting, and a formal source licensing/data quality register.
- CSS remains monolithic and should be split with component extraction, not as a standalone cosmetic rewrite.
- Current multiplayer room state is process-local and therefore intentionally single-instance.

## Validation Evidence

| Gate | Result |
| --- | --- |
| Production dependency audit | 0 known vulnerabilities at the configured high-severity gate |
| Unit/API suite | 23 files, 82 tests passed |
| Chromium E2E | 13/13 workflows passed in 1.6 minutes |
| TypeScript | Passed |
| Track catalog | 1,305 tracks, 49 countries, 9 providers validated |
| Production build | Passed with Vite 8.1.4 |
| Compression | 612,335 eligible raw bytes to 144,024 Brotli bytes, 76.5% smaller |
| Bundle budgets | All five raw/Brotli budgets passed |
| Deployment smoke | Health, headers, storage, shell, compressed asset, catalog, auth boundary, and 404 passed |
| Local load probe | 100/100, concurrency 8, p95 12 ms under 2,000 ms budget |

The E2E suite explicitly covers the public track locator, first-run account flow, Bluetooth pairing state, dashboard layout, shared map publication, advanced connector launch, fullscreen race entry, loop laps, ghost privacy, populated 20-second post-race review, live mapped-zone cadence, two-bike live cadence, persistent bike names, and studio rider assignment.

## Production Signoff Criteria

The branch is ready for review and staging. Award a 10/10 production signoff only after all of the following evidence is attached to a release candidate:

1. The 1-, 2-, 3-, and 4-bike physical matrix passes on supported macOS/Windows connectors and representative Model B firmware.
2. Bike connect, disconnect, reconnect, monitor IDs, remembered names, live movement, pedal-zone gating, coasting, race cancellation, and post-race metrics meet the hardware runbook targets.
3. PostgreSQL backup and restore is executed in staging, with migration versions and row counts verified.
4. The candidate is deployed with PostgreSQL required and passes `smoke:deployment` with `TRACKLAB_EXPECT_POSTGRES=1`.
5. Representative deployed WebSocket room and race load meets agreed p95 latency and error-rate targets.
6. Square subscription lifecycle events are reconciled through validated webhooks before paid public enrollment.
7. Voice, if enabled for public multiplayer, passes TURN-backed connection testing across restrictive networks.

## Remaining Opportunities

### Before unrestricted public release

- Complete the production signoff criteria above.
- Add email verification/recovery and legal/privacy/account-lifecycle flows.
- Configure alerting for health, error rate, database latency, reconnect rate, race completion, and WebSocket counts.
- Run accessibility checks with keyboard, screen reader, contrast, and reduced-motion coverage.

### After measured growth

- Decompose the largest modules by bounded feature.
- Add shared realtime infrastructure when a second instance is justified.
- Add regional room placement when cross-region latency data justifies the cost.
- Add application/database caching only after hit-rate and invalidation requirements are known.

## Conclusion

This branch materially raises TrackLab from a feature-rich application to an operationally reviewable release candidate. The remaining gap to a defensible 10/10 is not another unbounded code-generation pass; it is external acceptance evidence for physical bikes, durable recovery, provider lifecycle events, and deployed realtime behavior. Those gates are documented so completion can be measured rather than assumed.
