# Family profiles and monitoring

Family is available from **My Profile → Family** and **More → Family**. The
parent remains personally authenticated while choosing which athlete to view.
The selector does not alter billing, bike pairing, the recording athlete,
Apple Watch ownership, or the parent's account profile.

## Identities and permissions

- A managed child has a distinct `family-child:<uuid>` profile key. Creating it
  requires no child email, password, or synthetic authentication account. The
  parent-facing form asks for guardian authorization; this is an acknowledgment,
  not independent verification of age or guardianship.
- A linked athlete keeps their existing `user:<id>` identity. The parent
  creates a seven-day permission link. The athlete personally signs in and
  explicitly approves sharing profile and non-health training activity,
  including cycling power. A name or email lookup never grants access.
- Tokens contain 32 random bytes, travel in the invitation URL fragment, and
  are stored only as hashes. Claims are single-use. Either side can revoke a
  linked relationship. Re-linking requires fresh athlete approval.
- Managed profiles can be archived and restored by their own parent. Their
  club binding and records survive archival. Independent linked accounts and
  their records survive unlinking or deletion of the parent's account.

The profile and history routes authorize each child on every request and
recheck access after asynchronous record retrieval. The client keys displayed
data by account and child, aborts superseded requests, clears unavailable
records, and verifies access again before exporting.

## Training history

A managed child can attach an **unclaimed** Club Connect invitation using
**Connect studio record**. This consumes the exact invitation and binds the
specific club/roster athlete, without renaming the parent. Completed supported
club-tablet activities then follow that athlete's recording profile.

Existing accounts expose their personal activity and exact claimed club-athlete
history. Family delegation never inherits club-owner roster visibility and
does not use name-only matches to find another rider's records. Activity views
cover BMX Race, Straight Sprint, Explore, Get Pulled and monitor sprints, with
available metrics. Reaction Test is represented by its personal best, not a
calendar row for every attempt. A route that did not record a metric cannot
produce that metric retrospectively.

Busy monthly histories are loaded in smaller date windows when a response
reaches its record limit. The client merges the complete results for the
calendar and exports; an incomplete or revoked window fails the whole load
instead of silently showing a partial month.

`permissions.health` and `healthAvailable` are false. Family does not include
private Watch summaries, raw heart-rate samples, pairing identifiers, Recovery
identity, live location, Friends messages or account/billing management. Adding
health delegation requires its own explicit consent and minimal-data projection.

The Family selector is a monitoring interface. It does not implement a personal
home “train as managed child” context. Creating one later requires authorization
at recording time and stable identity across asynchronous result writes.

## Storage and release

Migration 48 adds `family_children` and `family_link_invites`. Family operations
fail closed when required storage is unavailable. Claim, revoke, archive,
restore and account-deletion operations use a consistent lock order. Standard
Club Connect claims share the claim serialization boundary.

Account deletion removes managed profile storage and permissions and clears
the affected claimed club binding; independent linked athletes are retained.
Club-owned historical records continue to follow existing club retention rules.

Before deployment, verify an isolated PostgreSQL restore and the family API,
client, native-link and browser tests. Do not roll schema 48 back to an app that
only supports schema 47. Retain a schema-compatible recovery build and evidence
that existing accounts, race results and ghosts are preserved.

## User guides

The public **App Guide** (`/#app-guide`) and **Beta Testing Info**
(`/#beta-testing-info`) share maintained feature sections in `src/lib/appGuide*`.
Both include family monitoring, free/beta/paid access, hardware connection paths,
Explore route building, reciprocal track/shop discovery, syncing and privacy.
Current billing readiness comes from the running service; the guides do not
advertise fixed prices or treat beta access as an Apple purchase.
