# Preski Labs waitlist

Hosts the PreskiLabs.com waitlist without a new paid service/database. Imported
from preski-labs-site server at 9865ab6; the production module lives here.

Enable with `PRESKI_WAITLIST_ENABLED=1` and secret `WAITLIST_ADMIN_TOKEN` (32+
random characters). Uses existing `DATABASE_URL`, separate `preski_labs` schema,
independent checksummed migration ledger and a two-connection pool. Queries
have bounded timeouts. No TrackLab tables or migration ledger are modified.

`/api/preski-labs/*` translates to the standalone `/api/*` API. The marketing
site rewrites `/api/*` to that namespace. Exact-origin checks and owner bearer
authorization apply inside this module; TrackLab security policies are unchanged.
Disabled or failed initialization returns 503 only for this namespace. TrackLab
health and live races are unaffected. Verify `/api/preski-labs/health` separately.

Signups never create app accounts, beta grants, Apple testers, or emails. The
owner can privately list/export/delete signups. Invite selected people later,
only at the owner's request. Never commit tokens, signups, or CSV exports.

Run `node --test cloud/preskiWaitlist/tests/*.test.mjs`, then the normal TrackLab
release gates. Deployment order: backend, successful private signup/read/delete
smoke using example.com, static route/headers, marketing site. Roll back to the
prior healthy TrackLab commit if needed; the additive separate schema can remain.
Never drop production signup data during rollback.
