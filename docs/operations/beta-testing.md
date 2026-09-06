# Beta tester access

Beta invitations let an administrator give a tester temporary Wattbike access
without a purchase. Athlete account-claim invitations remain separate.

## Invite a tester

1. Sign in with an administrator account and open **More → Beta Testing**.
2. Enter the email the tester will use for their TrackLab account.
3. Choose the number of simultaneous Wattbike connections and access period.
   The defaults are **4 bikes for 90 days**; the screen also offers 1–3 bikes
   and 30 or 60 days.
4. Select **Create invitation**, then **Copy link**. Share the link personally.
   Creating a link does not send email. The raw link is shown only at creation.

Each link expires after seven days, can be accepted once, and is bound to its
email address. The access period begins when the tester accepts. Creating a
replacement invitation invalidates that email's unclaimed invitations.

## Tester steps

1. Open the personal invitation link. Create a free TrackLab account, or sign
   in, using the invited email address.
2. Select **Activate beta access** in the invitation dialog.
3. Connect Wattbikes through the existing supported connection workflow and
   start a solo ride or race against saved ghosts.
4. Open **More → Beta Testing → Send beta feedback** to compose a report.
   The template includes device and app-version information; the tester can
   review the message and attach screenshots before sending it.

The account invitation enables TrackLab access. Installing the iOS beta is a
separate TestFlight step. External testers need an available build in an
external testing group and that group's TestFlight invitation or public link.
An App Store Connect upload alone does not establish tester availability.
See [Apple's external testing instructions](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers).

## Records, ghosts, and multiplayer

Public live multiplayer entry points display **Coming soon**. Solo Wattbike
sessions continue to upload results and eligible ghost recordings through the
existing cloud APIs. Riders can still download and race eligible shared ghosts;
existing sharing and privacy settings apply. Saved records are not deleted when
beta access ends.

The authenticated capacity connection stays online to authorize physical
Wattbikes. Existing managed club sessions retain their separate assigned-session
transport; the public pause is not a shutdown of that capacity service.

## Manage access

The Beta Testing panel lists invitations and activated testers. **Revoke invite**
invalidates an unused link. **Revoke access** ends an activated beta grant.
Authenticated writes recheck access; existing socket capacity is refreshed on
the server's capacity maintenance cycle, at most 15 seconds later.

Beta seats do not stack with subscription seats: the effective allowance is
the greater active allowance, capped at four. Revoking or expiring a beta grant
preserves an active paid subscription. Accepting another invitation replaces
the tester's prior beta grant.

## Operations

Migration 47 adds invitations, grants, and audit tables without altering existing
race or ghost tables. Invitation tokens are stored as hashes and carried in the
URL fragment so they are not included in the initial HTTP URL request. Admin
API access uses the existing administrator allowlist; no global billing bypass
or Apple cutover setting is required.

Before deploying this migration, follow the database backup and restore drill
in the [release runbook](./release-runbook.md). Roll back the application to the
previous compatible release if necessary; do not undo the additive tables or
modify the migration ledger.
