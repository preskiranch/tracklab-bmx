# TrackLab BMX Production Optimization Review

Review branch: `optimization/gpt-5.6-sol-review`  
Baseline: `14e6793` (`main`)  
Review date: 2026-07-09

## Executive Summary

The existing application has substantial product depth, but its production boundaries had not kept pace with that feature set. The review found critical authorization gaps around profile storage, Square entitlement changes, and multiplayer identity; data-loss risks in concurrent profile persistence; avoidable database and race-loop work; a 2.33 MB uncompressed global track payload; and no deterministic unit/API test gate.

This branch addresses the findings that provide clear, measurable value without rewriting the application or changing its user workflows. It adds authenticated ownership, verified billing claims, server-authoritative multiplayer identity, origin controls, bounded runtime state, atomic persistence, database query/index improvements, catalog precompression, deterministic tests, CI, health checks, and graceful shutdown. The existing five browser race scenarios continue to pass.

The application is materially safer and more reliable after this work. It is not yet ready for unrestricted global scale without additional work on subscription lifecycle webhooks, multi-instance realtime state, TURN-backed voice, observability, database migrations, and incremental decomposition of the largest modules.

## Review Method

- Established a clean baseline build and five Playwright race tests before implementation.
- Audited cloud HTTP and WebSocket trust boundaries, local connector access, billing, profile storage, social data, race persistence, and static serving.
- Reviewed PostgreSQL schema, indexes, query shapes, retention, and concurrent update behavior.
- Inspected client race physics, synchronization effects, catalog delivery, package roles, Render configuration, and module concentration.
- Implemented only changes with a direct security, correctness, performance, reliability, or testability benefit.
- Kept large UI/server decomposition and database normalization as recommendations because attempting them in one review branch would create disproportionate regression risk.

## High-Impact Improvements

| Finding | Why it needed improvement | Implemented change | Benefit | Impact |
| --- | --- | --- | --- | --- |
| Profile data was addressable through a caller-supplied `profileKey` | This was an insecure direct object reference: an unauthenticated caller could read or overwrite another profile | Require an authenticated session and derive the profile key exclusively from that session | Restores account ownership and prevents cross-profile access | High |
| Billing return trusted browser query parameters | A caller could claim Racer entitlement without a verified Square order | Store a hashed one-time checkout state and expected order, then retrieve and verify Square order ID, location, amount, currency, state, expiry, user, and one-time claim | Closes a direct paid-access bypass | High |
| WebSocket clients supplied their own identity and membership | A client could impersonate another rider or claim a paid role | Authenticate the upgrade cookie and derive immutable identity/membership on the server; enforce host/racer action permissions | Makes multiplayer authorization server-authoritative | High |
| Private rooms were included in global room broadcasts | Room metadata could be disclosed to unrelated users | Filter room lists per authenticated client and membership | Restores private-room privacy | High |
| Local connector accepted any web origin | Any website open in the browser could attempt to read/control the loopback connector | Allow the production TrackLab origin, loopback development, and explicit configured origins only | Reduces drive-by local connector access | High |
| Concurrent profile PATCHes used read-modify-write | Parallel bike-name, route, and map saves could overwrite each other | Use atomic PostgreSQL partial upserts; serialize local mutations; write connector data through atomic file replacement | Prevents lost updates and truncated local profile files | High |
| No deterministic test or CI gate | Race physics and security behavior could regress unnoticed | Add 26 unit/API/connector tests, preserve five browser tests, and run audit/build/tests in GitHub Actions | Makes production behavior reviewable and repeatable | High |
| Global catalog transferred as 2,325,231 raw bytes | Initial catalog loading was unnecessarily expensive, especially on mobile | Prebuild Brotli/gzip variants and serve with negotiation and ETag revalidation | Brotli transfer is 135,425 bytes, a 94.2% reduction | High |

## Medium-Impact Improvements

| Finding | Implemented change | Benefit | Impact |
| --- | --- | --- | --- |
| Three zone scans and temporary arrays per rider/frame | Resolve active zone, pedal configuration, and first pedal boundary in one allocation-free scan and reuse one frame timestamp | Reduces animation-loop allocations and repeated branch matching | Medium |
| Leaderboards selected the latest result, not the best result | Select each rider's personal best per metric before ranking | Correct leaderboard semantics | Medium |
| Race dedupe included unstable timestamps | Use session/rider identity and bounded in-memory dedupe state | Prevents duplicate result rows while avoiding unbounded memory growth | Medium |
| Shared map publication issued one SQL query per track | Batch all mapping rows into one upsert statement | Reduces database round trips dramatically for catalog publication | Medium |
| Social state loaded all active group members globally | Restrict membership loading to groups joined by the requesting user | Removes an O(platform members) query and unrelated data exposure | Medium |
| Rapid profile changes triggered one cloud and connector request per change | Batch independent partial updates after a short pause and serialize sends | Reduces network requests, disk writes, and race conditions while preserving completion/error behavior | Medium |
| Expired sessions/checkouts and transient invites remained resident | Add periodic pruning and TTL-based cleanup | Bounds memory/table growth | Medium |
| No service readiness or graceful termination | Add database-aware `/api/health`, HTTP/WebSocket/Postgres shutdown, and Render health configuration | Improves deploy reliability and prevents abrupt write termination | Medium |
| Native connector modules were treated as core cloud dependencies | Classify them as optional and prune development/optional packages after the Render build | Keeps the runtime deployment focused while retaining local installs | Medium |

## Low-Impact Improvements

- Correct static cache policy so mutable JSON/manifests are revalidated while fingerprinted assets remain immutable.
- Add ETag, Last-Modified, Content-Length, HEAD, and precompressed static response handling.
- Return explicit 400/413 responses for malformed or oversized cloud/connector JSON instead of generic 500 errors.
- Add request and WebSocket payload limits, HTTP timeouts, WebSocket heartbeat, and client message-rate controls.
- Add security headers, HSTS on HTTPS, same-origin mutation checks, generic login failures, auth/billing rate limits, and password length limits.
- Correct zero-valued race finish-time checks.
- Add supporting race metric, room message, challenge, friendship, billing, and social indexes.
- Declare the supported Node range and update the default Square API version.

## Security Findings

### Resolved

1. **Critical: profile IDOR and unauthenticated writes.** Profile reads/writes now require a valid session and ignore caller-selected identity.
2. **Critical: billing entitlement forgery.** Racer access is no longer granted from redirect parameters; Square order completion is verified server-side.
3. **High: multiplayer identity/role spoofing.** Identity, membership, room actions, track changes, route choices, race summaries, and ghost ownership are validated server-side.
4. **High: private room disclosure.** Private rooms are visible only to authorized participants.
5. **High: loopback connector origin exposure.** Browser access is restricted by origin and payload size.
6. **Medium: brute-force and request abuse.** Auth/billing rate controls, payload limits, message-rate limits, and heartbeat termination are active.
7. **Medium: static path/cache handling.** Resolved paths are constrained to `dist`; missing assets no longer fall through to HTML; mutable data is not cached immutably.
8. **Medium: information leakage.** Login responses are generic, internal errors carry request IDs, and expected client errors no longer become server failures.

### Remaining Security Work

- **Square webhooks: High.** Initial payment is verified, but subscription renewal, cancellation, failed-payment, and refund state are not yet synchronized. Add signed Square webhooks and make database entitlement state authoritative. Follow Square's signature validation guidance: <https://developer.squareup.com/docs/webhooks/step3validate>.
- **Account recovery and verification: Medium.** Add verified email, password reset, optional MFA/passkeys, session/device management, and account deletion/export flows before a broad public launch.
- **Content Security Policy: Medium.** A strict CSP should be introduced after inventorying Google Maps/Earth script, worker, image, and connection origins. Adding an incomplete CSP now would risk breaking the core map.
- **Loopback capability token: Medium.** Origin checks block web drive-by access, but a local native process can still call loopback endpoints. A per-install capability exchanged with the approved site would harden this boundary.
- **Secrets and audit trail: Medium.** Move toward managed secret rotation and append-only admin/billing/map-publication audit events.

## Performance Findings

- **Catalog delivery:** 2,325,231 raw bytes became 135,425 Brotli bytes or 198,504 gzip bytes. ETag revalidation returns a zero-body 304 within a deployment.
- **Race loop:** zone resolution changed from three traversals plus filter/map/sort allocations per rider/frame to one traversal with no intermediate collections.
- **Database publication:** shared mappings changed from one network round trip per track to one batched upsert.
- **Profile synchronization:** rapid changes now coalesce into one partial request; connector disk writes are serialized.
- **Social query:** group-member loading is proportional to the current user's groups rather than the whole platform.
- **Current application bundle:** approximately 493 KB JavaScript raw / 147 KB gzip and 70 KB CSS raw / 12.7 KB gzip. This is acceptable for the current dashboard, but should be monitored with a bundle budget.
- **Not implemented:** broad React lazy-loading. Most major panels participate in the primary dashboard and share state from the 6,000-line `App`; superficial splitting would add complexity with little guaranteed initial-load reduction. Extract bounded features first, then measure route-level splitting.

## Database Recommendations

### Implemented

- Atomic partial `JSONB` profile upserts eliminate a read and prevent concurrent patch loss.
- Added composite indexes for personal-best cadence, speed, and watts queries.
- Added indexes for room message history, challenges, friendship reverse lookup, billing cleanup, and social requests.
- Corrected leaderboard selection and bounded leaderboard limits.
- Added expiration cleanup for sessions and billing checkout state.

### Recommended Next

1. **Versioned migrations (High).** Move startup DDL into reviewed, reversible migrations with a schema-version table. Startup `CREATE/ALTER` is convenient but not sufficient for production rollbacks or multi-instance deploys.
2. **Normalize identity (High).** Replace long-lived `guest_key` text relationships with `auth_users.id` foreign keys. Preserve public profile IDs separately.
3. **Entitlement model (High).** Store subscription status, provider event ID, effective period, cancellation state, and event history rather than only membership tier/seats.
4. **Transactions (Medium).** Wrap friend/group invitation acceptance and membership creation in transactions to avoid partial state after a database interruption.
5. **Constraints (Medium).** Add reviewed `CHECK` constraints for role/status/tier, bike seats, metric ranges, and non-self friendship. Apply only after validating existing rows.
6. **Result retention (Medium).** Define retention/partitioning for race samples, room messages, challenges, and large ghost point arrays before volume grows.
7. **Production query analysis (Medium).** Capture `EXPLAIN (ANALYZE, BUFFERS)` against representative data before changing further indexes. Some unique-column indexes created historically are redundant and should be removed through a migration, not ad hoc startup DDL.
8. **Recovery (High).** Document automated backups, point-in-time recovery, restore drills, and export ownership.

## Architecture Recommendations

### Current Strengths

- Clear separation exists for device hooks, race physics, mapping helpers, cloud persistence, and local connector sources.
- The local connector supports BLE/ANT+ behind a unified bridge contract.
- Race calculations are client-local with bounded multiplayer summaries, which keeps current single-room operation responsive.
- Map data, race physics, monitor mode, and multiplayer are represented with strict TypeScript types on the frontend.

### Recommended Evolution

1. **Incremental bounded-context extraction (High maintainability).** `App.tsx` (~6,100 lines), `cloud/server.mjs` (~2,700), `GoogleMapsTrackLayer.tsx` (~2,250), `cloud/persistence.mjs` (~1,500), and `SessionControlPanel.tsx` (~1,300) concentrate too many reasons to change. Extract race orchestration, mapping editor, profile synchronization, billing/auth routes, social routes, room orchestration, and static serving one feature at a time with tests. Do not rewrite.
2. **Horizontally scalable realtime state (High scalability).** Rooms, clients, invites, timers, and race state are process-local. A second Render instance would split users. Introduce Redis-compatible shared presence/room state and pub/sub, distributed locks for room transitions, and sticky WebSocket routing before scaling beyond one process.
3. **Regional race placement (High for global use).** Place a room in the region that minimizes the racers' measured latency, use server-authoritative start timestamps, and keep persistent profile/social APIs region-independent. Do not attempt active-active room simulation without deterministic ownership.
4. **TURN-backed voice (High reliability).** Public STUN alone will fail behind restrictive NAT/firewalls. Add TURN with short-lived credentials and monitor connection success.
5. **API contracts (Medium).** Split route handlers and introduce versioned request/response schemas (for example, Zod-generated validation/OpenAPI) rather than expanding handwritten sanitizers indefinitely.
6. **Connector packaging (Medium).** Package the local connector as its own signed desktop distribution with self-update, diagnostics, a capability token, and platform-specific native dependencies.
7. **Observability (High).** Add structured logs, request/room/session correlation IDs, error reporting, metrics (connections, race starts/completions, reconnects, DB latency), and alerting tied to SLOs.

## Technical Debt Identified

- Large orchestration and UI modules make behavior difficult to isolate and increase regression risk.
- PostgreSQL schema mutation occurs during application startup rather than a migration phase.
- Profile maps/routes/bikes are stored as whole JSON documents; convenient now, but difficult to query, version, merge, and moderate at scale.
- Multiplayer and social records use denormalized names and text guest keys.
- Race state exists in client, room synchronization, persistence summary, ghost data, and review capture forms without a single versioned event contract.
- Shared track publication has authorization but not review workflow, version history, rollback, ownership, or moderation.
- Track import jobs do not yet have scheduled freshness, provider change detection, or a formal source-licensing/data-quality workflow.
- CSS and dashboard composition remain monolithic; visual refactoring should follow component boundary extraction rather than precede it.
- No service-level telemetry currently proves BLE reconnect rate, race input latency, WebSocket latency, or map load success in production.

## Remaining Opportunities

### Before Public Release

1. Square subscription webhooks and entitlement reconciliation.
2. Email verification, password reset, privacy/terms flows, and account lifecycle.
3. TURN service and multiplayer connection-success instrumentation.
4. Structured error/metric collection and on-call alerts.
5. PostgreSQL backups, migration tooling, and a staging restore test.
6. Load tests for WebSocket rooms, race-sync cadence, social presence, and leaderboards.
7. Real Wattbike hardware acceptance matrix across supported macOS/Windows/browser/monitor firmware combinations.

### Later Optimization

- Profile and catalog cache layers after production hit-rate measurement.
- Route-level code splitting after state extraction and bundle profiling.
- Race/ghost compression or binary encoding only if payload telemetry justifies it.
- Multi-region room placement after single-region concurrency and latency baselines exist.
- Map tile and imagery strategy review against Google licensing, quota, and cache rules.

## Validation Results

- `npm run build`: passed.
- `npm run test:unit`: 26 tests passed across rollout, telemetry, physics, HTTP policy, cloud API, connector API, and write batching.
- `npm run test:e2e`: 5 Chromium scenarios passed, including mapped pedal zones and a two-bike live UCI cadence.
- `npm audit --omit=dev --omit=optional --audit-level=high`: 0 vulnerabilities.
- Manual static validation: Brotli selected correctly; decoded catalog matched 2,325,231 bytes; repeated ETag request returned 304 with no body.
- Production JavaScript: ~493.0 KB raw / ~147.3 KB gzip.

## External API References

- Square Create Payment Link: <https://developer.squareup.com/reference/square/checkout-api/CreatePaymentLink>
- Square Retrieve Order: <https://developer.squareup.com/reference/square/orders-api/RetrieveOrder>
- Square order state: <https://developer.squareup.com/reference/square/objects/OrderState>
- Square subscription checkout: <https://developer.squareup.com/docs/checkout-api/subscription-plan-checkout>
- Square webhook validation: <https://developer.squareup.com/docs/webhooks/step3validate>
