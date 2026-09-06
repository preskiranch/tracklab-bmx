# Public beta enrollment

Set TRACKLAB_PUBLIC_BETA_ENDS_AT to an explicit future ISO8601 date to open enrollment. With it unset, invalid or expired, automatic enrollment is off. During enrollment any signed-in native or web account without an existing grant automatically receives four Wattbike connections ending at the configured deadline, capped at 90 days from enrollment. This is a public beta program, not proof of a TestFlight installation. There is no client header that grants paid access.

Managed child-phone accounts receive their own grants. No guardian identity switching, email invitation or purchase is needed. The existing session still has to be valid, and child archival/revocation checks remain in force.

Existing grants (including expired/revoked grants) are never replaced by automatic enrollment; administrators can issue individual invitations if renewed access is appropriate. Disabling enrollment stops new grants; existing ones retain their stated expiration unless revoked through the beta administrator panel. Subscriptions, account privileges, records and ghost visibility are unchanged. Automatic grants and revocations use the existing durable beta audit and transaction lock; no schema migration is required.

For Apple beta review, provide the dedicated non-admin account and verify /api/auth/me plus /api/beta-access. Explain that compatible Wattbike hardware is required for real bike signals, while directories and Reaction Test can be reviewed without hardware. Do not claim simulator or device tests that were not performed.
