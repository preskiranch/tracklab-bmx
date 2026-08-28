# App Store public pages

> **LEGAL REVIEW REQUIRED:** The pages described here are a technical and
> product-behavior draft. The operator and qualified counsel must review and
> approve the final privacy notice, youth/guardian terms, retention language,
> regional rights, provider disclosures, legal-entity identity, and contact
> information before an App Store production submission.

TrackLab includes two public, mobile-friendly pages that can be opened without
signing in:

- Privacy Policy URL: `https://tracklab-bmx.onrender.com/privacy`
- Support URL: `https://tracklab-bmx.onrender.com/support`
- Privacy alias: `https://tracklab-bmx.onrender.com/privacy-policy`

The server already returns the web app entry point for these paths. The React
bootstrap resolves the pathname before loading the account dashboard, so these
pages remain public even when the visitor does not have a TrackLab session.

## Current technical scope

The privacy draft describes behavior implemented in the repository, including:

- TrackLab account, rider-profile, club, and profile-photo data;
- Wattbike identifiers, telemetry, mapped-track data, training results, ghosts,
  Explore routes, multiplayer rooms, and optional microphone audio;
- Google mapping services, optional OpenAI commentary, Apple in-app purchases, and
  hosted application/database infrastructure;
- current user controls, in-app account deletion, session exports, local storage,
  authentication, and the documented retention behavior.

The in-app deletion flow also distinguishes deleting a TrackLab account from
canceling an Apple subscription. It recommends **Manage Apple Subscription**
first and explains that Apple billing can continue after deletion. The old
profile ID, email, and name are removed; only a one-way pseudonymous Apple
transaction-lineage proof remains. A user can deliberately reattach that same
active subscription to a clean replacement account through **Restore
Purchases**, after fresh Apple signature and status verification. Cancellation
is not a prerequisite for deletion.

The support page covers Wattbike pairing, iPhone and iPad limitations, map and
route troubleshooting, race audio, account sync, and Club Connect. Its service
status link uses the existing `/api/health` endpoint.

## Before entering these URLs in App Store Connect

1. Review the rendered pages on a phone, tablet, and desktop browser while
   signed out.
2. Replace or supplement the operational support address if the final public
   support address will differ from `preskiranch@gmail.com`.
3. Have the operator and counsel confirm the legal entity/controller identity,
   geographic scope, youth and guardian requirements, retention schedule,
   account-deletion process, and applicable privacy rights.
4. Confirm the provider list and data flows against the production deployment,
   App Privacy answers, and any future analytics, crash reporting, payments, or
   native SDK additions.
5. Re-check the displayed “Last updated” date after the final legal text is
   approved.

These pages intentionally avoid claiming certifications, statutory compliance,
fixed response times, or guarantees that are not implemented and verified.
