# Family profiles and monitoring

Family is available from **My Profile → Family** and **More → Family**. The
parent remains personally authenticated while choosing which athlete to view.
The selector does not alter billing, bike pairing, the recording athlete,
Apple Watch ownership, or the parent's account profile.

## Parent-led onboarding and child phones (schema 49)

An unclaimed Club Connect link now offers **I’m the athlete** and **I’m the
parent or guardian**. Adults keep the direct self-claim. Parents sign in with
their own email, then create or select a managed child. Creating the child and
claiming the exact studio member is transactional: an expired, already-claimed,
or competing invitation creates no extra profile. Existing independent accounts
still approve Family permission links; we never silently move a claimed account.

**Create child-phone setup link** issues a one-use 15-minute fragment token.
The token is stored only as a hash. Redemption creates a separate child auth
identity and session atomically; no parent credential reaches the child's phone.
Its internal `child:<uuid>` equivalent is represented as `child-<uuid>` and maps
to the unchanged `family-child:<uuid>` training key. Internal reserved email
addresses are never displayed or used for sign-in, and the password hash is
intentionally unusable. The child signs in by parent-approved setup link only.
The iOS credential uses the existing native Keychain session boundary.

Managed sessions revalidate the current family record and exact session on every
request, bypassing ordinary auth-cache freshness. Replacing a pending link,
revoking child devices, and archiving a profile invalidate the appropriate
credentials. Restore never resurrects old sign-ins. Parent account deletion uses
the full child-account erasure inside the same family transaction, including
private Watch credentials. Existing studio-owned historical records retain the
normal studio retention rules.

Family on the parent phone remains a monitoring selector. The child's signed-in
phone records home or studio workouts against the same existing child data key.
Records refresh while the Family calendar is open and sync while online. Club
attribution and Wattbike seat authorization retain their existing rules; device
setup is not a beta grant, subscription, or TestFlight enrollment.

Apple’s TestFlight terms exclude testers under 13 or the local equivalent minimum
age. Parent credentials are not a workaround. Supported web features remain
available; native Watch access for younger athletes needs a suitable distribution
path. See https://www.apple.com/legal/internet-services/itunes/testflight/.

Watch Connect supports this same managed profile when the Watch is paired to
the child's own iPhone. Studio sharing still requires the exact claimed roster
membership and explicit live/session consent. Tablet reads use the selected
athlete's profile; switching athletes cannot expose the prior child's readings.
Family does not delegate private health. Apple family-setup Watches paired to a
parent's iPhone are not verified by this workflow.

## Identities and permissions

- A managed child has a distinct `family-child:<uuid>` profile key. Creating it
  requires no child email or password. A distinct device authentication identity is created only when a setup link is redeemed. The
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
The API reports `rangeComplete: false` when any underlying source reaches its
cap, including before club-athlete filtering or deduplication. Adjacent client
windows overlap at their boundary and merge by session ID to preserve legacy
database timestamps with precision finer than one millisecond.

`permissions.health` and `healthAvailable` are false. Family does not include
private Watch summaries, raw heart-rate samples, pairing identifiers, Recovery
identity, live location, Friends messages or account/billing management. Adding
health delegation requires its own explicit consent and minimal-data projection.

The Family selector remains a monitoring interface. Personal recording uses the
child-only signed-in session established by device setup, never the parent view.

## Storage and release

Migration 48 adds `family_children` and `family_link_invites`; migration 49 adds
`family_device_invites` without changing existing athlete data. Family operations
fail closed when required storage is unavailable. Claim, revoke, archive,
restore and account-deletion operations use a consistent lock order. Standard
Club Connect claims share the claim serialization boundary.

Account deletion removes managed profile storage and permissions and clears
the affected claimed club binding; independent linked athletes are retained.
Club-owned historical records continue to follow existing club retention rules.

Before deployment, verify an isolated PostgreSQL restore and the family API,
client, native-link and browser tests. Do not roll schema 49 back to an app that
only supports schema 48 or earlier. Retain a schema-compatible recovery build and evidence
that existing accounts, race results and ghosts are preserved.

## User guides

The public **App Guide** (`/#app-guide`) and **Beta Testing Info**
(`/#beta-testing-info`) share maintained feature sections in `src/lib/appGuide*`.
Both include family monitoring, free/beta/paid access, hardware connection paths,
Explore route building, reciprocal track/shop discovery, syncing and privacy.
Current billing readiness comes from the running service; the guides do not
advertise fixed prices or treat beta access as an Apple purchase.
