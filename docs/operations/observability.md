# TrackLab Observability

TrackLab emits structured JSON logs and Prometheus-compatible metrics from the
cloud service and local Bike Connector. The instrumentation intentionally
records operational metadata, not race samples or credentials.

## Cloud metrics

Configure a long, random `TRACKLAB_METRICS_TOKEN` in Render. Scrape:

```text
GET https://tracklab-bmx.onrender.com/api/metrics
Authorization: Bearer <TRACKLAB_METRICS_TOKEN>
```

An authenticated administrator session can also access the endpoint. Do not
put the metrics token in a `VITE_` variable or client-side code.

Useful metric families include:

- `tracklab_http_requests_total` and `tracklab_http_request_duration_ms_*`
- `tracklab_http_active_requests`
- `tracklab_websocket_clients` and `tracklab_websocket_messages_total`
- `tracklab_multiplayer_rooms`
- `tracklab_persistence_query_duration_ms_*`
- `tracklab_track_mapping_saves_total`
- `tracklab_races_total`
- `tracklab_process_uptime_seconds`

Recommended initial alerts:

| Signal | Initial threshold |
| --- | --- |
| HTTP 5xx ratio | More than 2% for 5 minutes |
| HTTP p95 duration | More than 1,500 ms for 10 minutes |
| Database query failures | Any sustained increase for 5 minutes |
| WebSocket rate limits | More than 20 per minute |
| Process uptime reset | Unexpected restart outside deployment windows |

Tune these thresholds after collecting at least one week of normal traffic.

## Bike Connector metrics

The local connector exposes `GET /api/bridge/metrics`. The existing origin
allowlist protects this endpoint; it should remain bound to loopback and must
not be exposed directly to the public internet.

Connector metrics cover connected bikes, source health, device discovery,
sample counts, WebSocket clients, and HTTP health. They do not include rider
names, bike names, monitor payloads, or raw workout samples.

## Logs and request IDs

Every API response includes `X-Request-Id`. TrackLab accepts an incoming ID
only when it uses a restricted printable format; otherwise it creates a UUID.
Use this ID to correlate browser failures with server logs.

Logs are one JSON object per line and include timestamp, level, service, event,
and safe context. Keys associated with credentials, sessions, cookies, email,
or API keys are automatically redacted. Avoid adding raw bike samples or chat
messages to log context.

By default, TrackLab logs server failures, rate limits, aborted requests, and
requests slower than `TRACKLAB_SLOW_REQUEST_MS` (default 1,000 ms). Other 4xx
responses remain visible in metrics without creating routine warning noise.
Set `TRACKLAB_LOG_HTTP=1` only for short diagnostic windows because it
increases log volume.

## Incident checklist

1. Record the affected user's request ID, time, browser, track, and connection method.
2. Check `/api/health` and process restart history.
3. Inspect HTTP error ratio, latency, WebSocket clients, and database failures.
4. For bike issues, inspect the local connector health and connected-bike gauge.
5. Confirm no deployment, database migration, or credential rotation overlapped the incident.
6. Preserve relevant redacted logs and document the resolution.

## Deployment verification

Run the production smoke test after every deploy:

```bash
TRACKLAB_SMOKE_URL=https://tracklab-bmx.onrender.com \
TRACKLAB_EXPECT_POSTGRES=1 \
npm run smoke:deployment
```

The smoke test verifies health and storage readiness, security headers, the
compressed immutable application bundle, the track catalog, authentication
boundaries, and missing-route behavior. Use the bounded read-only load probe
after infrastructure, caching, database, or networking changes:

```bash
TRACKLAB_SMOKE_URL=https://tracklab-bmx.onrender.com \
TRACKLAB_LOAD_REQUESTS=100 \
TRACKLAB_LOAD_CONCURRENCY=10 \
TRACKLAB_LOAD_P95_MS=1500 \
npm run probe:load
```

Do not use this probe as an unbounded stress test against production. For the
release sequence, rollback policy, and evidence requirements, follow
[`release-runbook.md`](./release-runbook.md). Database restoration is defined
in [`database-recovery.md`](./database-recovery.md), and physical bike
verification is defined in [`hardware-acceptance.md`](./hardware-acceptance.md).
