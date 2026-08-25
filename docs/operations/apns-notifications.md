# TrackLab APNs Operations

TrackLab uses Apple Push Notification service only as a private wake hint for
four authenticated social events: a 90-second Talk live invitation, an incoming
friend request, a newly accepted/private-invite friend connection, and an
explicit track share. Payloads are generic and contain only a protocol version,
event kind, random notification ID, and the `friends` route. The app must sign
in and refetch authoritative data before showing or acting on an event.

Recovery alerts, heart rate, presence, friend counts, race status, club data,
and tablet activity are not remote pushes. Recovery alerts remain local so they
work offline and do not create duplicate workout cues.

## Production prerequisites

Before enabling APNs, all of the following must be true:

- Apple Developer has Push Notifications enabled for the exact App ID
  `com.preskilranch.tracklabbmx`.
- The installed iOS build is newly signed with the push entitlement and native
  notification bridge. A cloud-only deployment cannot add this capability to
  an already-installed binary.
- An Apple APNs token-signing key has been downloaded once and stored in the
  team's access-controlled secret manager. Record its Key ID and Team ID.
- Migration 26 has committed successfully in PostgreSQL.
- A database backup and rollback target have been verified.

Development-signed apps receive `sandbox` device tokens. TestFlight and App
Store builds receive `production` tokens. The app reports that environment with
each installation, and the server selects the matching Apple endpoint. Never
copy a sandbox token into production, rewrite its environment, or infer the
environment from an account.

## Render provisioning sequence

Provision secrets before setting `TRACKLAB_APNS_ENABLED=1`. The blueprint
declares every required value without committing a secret.

1. Generate two independent 32-byte secrets, encoded as standard base64:

   ```bash
   openssl rand -base64 32
   openssl rand -base64 32
   ```

2. Store the first as `TRACKLAB_PUSH_TOKEN_ENCRYPTION_KEY` and the second as
   `TRACKLAB_PUSH_TOKEN_FINGERPRINT_KEY`. Set
   `TRACKLAB_PUSH_TOKEN_KEY_VERSION=1`. Leave
   `TRACKLAB_PUSH_TOKEN_PREVIOUS_ENCRYPTION_KEYS` unset for the initial release.
3. Set `TRACKLAB_APNS_TEAM_ID`, `TRACKLAB_APNS_KEY_ID`, and
   `TRACKLAB_APNS_PRIVATE_KEY`. The private key may be the multiline `.p8`
   content or its base64-encoded PKCS#8 content. On a host with a mounted secret
   file, use `TRACKLAB_APNS_PRIVATE_KEY_PATH` instead and leave the value unset.
   Do not configure both.
4. Deploy with `TRACKLAB_APNS_ENABLED=1`. The server accepts only an EC P-256
   provider key. Missing or invalid startup configuration makes `/api/health`
   return 503 so the bad release cannot receive traffic.
5. Require both PostgreSQL and APNs in staging and production smoke checks:

   ```bash
   TRACKLAB_SMOKE_URL=https://tracklab-bmx.onrender.com \
   TRACKLAB_EXPECT_POSTGRES=1 \
   TRACKLAB_EXPECT_APNS=1 \
   npm run smoke:deployment
   ```

6. On physical devices, verify one sandbox development build and one production
   TestFlight build: opt in, background the app, send each eligible alert, tap
   it, and confirm TrackLab refetches Friends without accepting, joining, or
   enabling the microphone automatically.

Never put APNs keys, encryption keys, fingerprint keys, installation
credentials, raw device tokens, ciphertext, or auth cookies in logs, tickets,
screenshots, analytics, or client-visible environment variables. `/api/health`
reports only bounded status reasons.

## Health, degradation, and rollback

Healthy production reports HTTP 200 with `push.enabled=true`,
`push.ready=true`, and `push.degraded=false`.

Invalid required configuration at startup reports HTTP 503. A provider-wide
failure discovered after startup—such as `InvalidProviderToken`, `BadTopic`, or
`TopicDisallowed`—keeps core health HTTP 200 so Render does not restart or evict
the web/API/WebSocket service. Push reports `ready=false`, `degraded=true`, a
bounded reason, and `degradedAt`; alert the incident owner on that state. The
worker stops sending, preserves eligible long-lived deliveries for a bounded
retry, and never invalidates device tokens for provider/account/topic errors.

To recover, correct the Team ID, Key ID, topic entitlement, or private key and
restart the service, then run the APNs-required smoke check and a physical
device alert. To stop remote notifications immediately without taking down the
app, set `TRACKLAB_APNS_ENABLED=0` and redeploy. Disabled health is HTTP 200 with
reason `disabled`; no new push outbox events are created. Local recovery alerts
continue to work. Re-enable only after the provider configuration is verified.

Migration 26 is additive and forward-only. It creates session-bound encrypted
installations, preferences, durable Talk live invites, outbox events, and
per-installation deliveries. Auth-session deletion cascades installations.
Expired notification metadata and durable Talk live invitations are removed
after seven days, with delivery rows cascading from their event. Leave the
additive tables in place when rolling back application code; never rewrite an
applied migration checksum.

## Secret backup and rotation

Keep encrypted, access-audited backups of the current APNs `.p8` key, Team ID,
Key ID, token-encryption key and version, every configured previous encryption
key, and the fingerprint key. Store the backup outside Render and this
repository. Test restoration in staging before production rotation.

For a token-encryption-key rotation:

1. Keep the fingerprint key unchanged.
2. Add the old key to
   `TRACKLAB_PUSH_TOKEN_PREVIOUS_ENCRYPTION_KEYS` as a JSON map from its numeric
   version to its standard-base64 key, for example `{"1":"<old-key>"}`.
3. Set a new 32-byte encryption key and increment
   `TRACKLAB_PUSH_TOKEN_KEY_VERSION` in the same deploy.
4. Confirm health and delivery from both a dormant old installation and a newly
   registered installation. Keep the old key until no installation row uses
   that version and at least the 30-day installation lease has elapsed. At most
   four previous versions are accepted.

Removing a still-used previous encryption key degrades push as
`push-token-key-version-unavailable`; it does not silently invalidate the
installation. Restore the key and restart.

`TRACKLAB_PUSH_TOKEN_FINGERPRINT_KEY` is a stable installation-identity secret,
not a routine rotation target. Changing it makes existing token fingerprints
unverifiable even when old encryption keys remain. If it is compromised, plan
an explicit push outage: disable APNs, back up the database, replace the key,
delete existing `push_installations` in a reviewed transaction, redeploy, and
require devices to reopen and register again before re-enabling APNs. Never
rotate it opportunistically or without communicating forced re-registration.

For an APNs provider-key rotation, create and validate the new Apple key while
the prior key remains available, update the Key ID and private key together,
deploy, run the APNs-required smoke and physical-device test, then revoke the
old Apple key. If validation fails, restore the backed-up old pair and restart.

