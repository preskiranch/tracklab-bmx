# Apple in-app purchases

TrackLab is free to download. Live Wattbike connectivity is sold only through
Apple auto-renewable subscriptions in the signed iPhone and iPad app. Browser
users can use an entitlement already attached to their TrackLab account, but
the web app does not offer a separate checkout or direct users to one.

## App Store Connect products

Create one subscription group named **Wattbike Connections** with these monthly
products. Put the four-connection product at the highest upgrade level and the
one-connection product at the lowest level.

| Product ID | Display name | Connection limit |
| --- | --- | ---: |
| `com.preskilranch.tracklabbmx.wattbike.1.monthly` | 1 Wattbike Connection | 1 |
| `com.preskilranch.tracklabbmx.wattbike.2.monthly` | 2 Wattbike Connections | 2 |
| `com.preskilranch.tracklabbmx.wattbike.3.monthly` | 3 Wattbike Connections | 3 |
| `com.preskilranch.tracklabbmx.wattbike.4.monthly` | 4 Wattbike Connections | 4 |

Use a one-month duration, Family Sharing off, and the cycling/fitness service
tax category appropriate to the storefront. Configure prices in App Store
Connect; do not copy price strings into source code. StoreKit supplies the
localized price and currency to the purchase screen.

Each product description should explain the ongoing value: live Wattbike
telemetry, cloud training records, club monitoring, multiplayer sessions, and
continued product updates for the selected simultaneous connection capacity.

## Account and device behavior

The native app passes the signed-in TrackLab user's UUID as StoreKit's
`appAccountToken`. The server verifies that token, bundle identifier, product,
environment, expiry, and revocation state before granting access. It also binds
an original Apple transaction to one TrackLab account, preventing a transaction
from being replayed onto another account.

The subscription belongs to the signed-in billing account, not to a physical
tablet and not to a temporary athlete selected on a Club Tablet. **Restore
Purchases** uses `AppStore.sync()` only after the user taps it. After server
verification, every club tablet signed into that TrackLab account receives the
same one-to-four connection limit.

Connection grants are short-lived PostgreSQL leases, not process-local flags.
For Club Tablets, the same durable allocation records the enrolled device and,
after selection, the active athlete and Wattbike. PostgreSQL advisory locks
serialize picker-to-session handoff across rolling or multi-instance backend
deployments. A late picker poll, concurrent start, duplicate athlete, or
duplicate bike fails closed without replacing the winning holder.

A claimed athlete using a club-funded Wattbike from a personal phone or tablet
also receives one short-lived `club-personal` lease under the club billing
owner. It shares the exact same purchased pool as owner WebSockets and Club
Tablets; a process-local Club Live selection can never create extra capacity.

## Account deletion with an Apple subscription

Account deletion must remain available in **My Profile** even when the customer
has an active Apple subscription. TrackLab does not require cancellation before
deletion and must not represent account deletion as cancellation: Apple controls
the subscription and may continue billing until the customer cancels it through
**Manage Apple Subscription**.

The confirmation screen therefore recommends opening Apple's subscription
management before deletion and clearly discloses these consequences:

1. deleting the TrackLab account does not cancel or refund Apple billing; and
2. deletion removes the TrackLab UUID, email, name, profile, training, health,
   social, club, and location data; and
3. TrackLab retains only the Apple original transaction ID, environment, and a
   lineage-scoped SHA-256 value of StoreKit's former `appAccountToken`. This
   pseudonymous tombstone cannot recreate the deleted account but lets a newly
   created account deliberately reattach the same active subscription through
   **Restore Purchases**.

The customer may still proceed immediately after password reauthentication,
typing the exact confirmation, and acknowledging those consequences. Restore
calls `AppStore.sync()` and submits a newly obtained Apple-signed transaction;
the server verifies its signature and current active status, then atomically
matches its token hash to an unbound tombstone. Background reconciliation,
unsigned identifiers, copied profile details, and a transaction still bound to
another TrackLab account cannot consume a deletion tombstone.

## Server configuration

Create an App Store Connect API key with In-App Purchase access and configure
the Render service with:

```text
TRACKLAB_APPLE_IAP_ENABLED=1
TRACKLAB_APPLE_ONLY_CUTOVER=0
TRACKLAB_APPLE_RECONCILE_INTERVAL_MS=900000
TRACKLAB_APPLE_RECONCILE_BATCH_SIZE=100
TRACKLAB_APPLE_BUNDLE_ID=com.preskilranch.tracklabbmx
TRACKLAB_APPLE_APP_ID=<numeric App Store Connect Apple ID>
TRACKLAB_APPLE_SUBSCRIPTION_GROUP_ID=<numeric Wattbike Connections group ID>
TRACKLAB_APPLE_ISSUER_ID=<issuer UUID>
TRACKLAB_APPLE_KEY_ID=<key ID>
TRACKLAB_APPLE_PRIVATE_KEY=<server-only p8 PEM or base64 PEM>
TRACKLAB_APPLE_SANDBOX_ACCOUNT_TOKENS=<comma-separated TrackLab tester UUIDs>
```

Only the explicitly listed tester UUIDs may use Sandbox or TestFlight
transactions. Production customer capacity is granted only by production
transactions, preventing a sandbox purchase from becoming a live customer
entitlement. Remove obsolete tester UUIDs after App Review.

Configure App Store Server Notifications V2 for both Production and Sandbox:

```text
https://tracklab-bmx.onrender.com/api/apple/notifications/v2
```

Keep Apple keys out of Git, frontend environment variables, screenshots, and
support messages. Rotate a compromised key in App Store Connect and Render.

## Test and submission checklist

1. Accept the Paid Apps Agreement and finish tax and banking details.
2. Add English (U.S.) subscription localization, availability, prices, review
   screenshots, and review notes for all four products.
3. Add the In-App Purchase capability to the app identifier and signed target.
4. Configure Production and Sandbox Server Notifications V2 URLs.
5. Test purchase, cancel, pending/Ask to Buy, restore, upgrade, downgrade,
   renewal, billing grace, expiry, refund, and revoke with StoreKit testing and
   a Sandbox Apple Account.
6. Test one Apple subscription across all four club tablets while confirming
   the server enforces the purchased simultaneous connection count.
7. Submit the first subscription group and products with the new app version.
8. Verify account deletion with an active sandbox subscription: the app warns
   about continued Apple billing, offers Manage Subscription, deletes all
   personal data, and still allows deletion without requiring cancellation.
9. Create a clean replacement account and verify that only an explicit Restore
   Purchases action using the same active sandbox subscription consumes the
   pseudonymous lineage tombstone. Confirm an automatic refresh, an expired
   entitlement, a mismatched signed transaction, and a transaction still bound
   to another account all fail closed.

The first version must show the subscription title, one-month duration,
localized price, exact Wattbike capacity, automatic-renewal disclosure,
Privacy Policy, Apple standard EULA, Restore Purchases, and Manage Subscription.

## Square cutover

The application no longer creates or claims Square checkouts. Historical
Square database records remain read-only for support and audit. Removing the
checkout code does not cancel a customer's Square subscription. Before public
cutover, cancel every live Square recurring charge and handle any contractual
refund or already-paid service obligation directly with the affected customer.
Apple cannot convert an existing Square subscription into an App Store
subscription; the customer must start a new Apple subscription in the iOS app.

Cutover is deliberately two-stage so a routine deployment cannot revoke access
while Apple purchasing is unavailable:

1. Deploy the verified StoreKit/server code with Apple configured and
   `TRACKLAB_APPLE_ONLY_CUTOVER=0`. Apple purchases work, while existing stored
   racer access is temporarily honored.
2. Verify production purchase, restore, renewal, notification, refund, and
   revocation; cancel Square renewals; and satisfy already-paid access periods.
3. Export the Square reconciliation evidence needed for support and accounting,
   confirm the TrackLab Square credential is not shared by another service,
   remove all `SQUARE_*` values from Render/CI, and revoke the TrackLab access
   token in the Square Developer Dashboard. Keep historical database rows.
4. Set `TRACKLAB_APPLE_ONLY_CUTOVER=1`. From that point, ordinary accounts get
   Wattbike capacity only from an unexpired verified Apple entitlement. The
   database is not destructively rewritten, so support history remains intact.
   Apple-managed accounts also keep the pre-IAP membership columns
   fail-closed; after the first reconciliation, roll back only to a commit that
   understands the Apple entitlement tables.
5. Run `scripts/smoke-deployment.mjs` against production with
   `TRACKLAB_EXPECT_APPLE_IAP=1` and
   `TRACKLAB_EXPECT_APPLE_ONLY_CUTOVER=1`; record the passing health evidence.

The configured Preski Ranch operator account has an internal four-bike override
for administration, App Review demonstrations, and hardware support. It is not a
customer plan, is never advertised or sold, and does not create a non-Apple
checkout path.
