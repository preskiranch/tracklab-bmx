# Community safety and moderation

TrackLab room text and live voice are opt-in social features for authenticated
riders. This runbook is the required operating procedure for reports received
through the in-app **Safety** menu.

## User controls

- Room text is checked on the server before it can be stored or broadcast. A
  rejected sender receives a visible `room-error`; other riders never receive
  the rejected text.
- Friends profiles expose **Block** and **Report** under **Safety**. An active
  multiplayer room also lists every other room member under **Room rider
  controls**, where the signed-in rider can report or block without knowing or
  exposing the other account's identifier. Blocking removes direct social
  interaction, ejects blocked participants from their shared room, and is
  enforced before they can join or exchange more room text.
- Live voice never turns on the microphone merely by entering a room. The race,
  Explore, and direct-friend audio surfaces retain a visible microphone toggle;
  direct-friend audio also retains **End chat**. Leaving a multiplayer room ends
  its audio session.
- Reports are private. Report details are only returned by the administrator
  moderation API and are never included in public profiles or room events.

Text filtering handles common profanity, slurs, threats, self-harm
encouragement, sexual solicitation, and straightforward obfuscation. It is an
initial safety barrier, not a substitute for reports and human review.

## Response target

An administrator must inspect each new report within 24 hours. Urgent threats,
sexual exploitation, or credible danger must be escalated immediately under the
organization's safety policy and, where required, to the appropriate emergency
or child-safety authority. The public escalation contact is
`preskiranch@gmail.com`, matching the in-app Support page. Do not promise a
reporter a specific enforcement outcome.

## Administrator workflow

Only an authenticated account in `TRACKLAB_ADMIN_EMAILS` can use these routes.
All responses use `Cache-Control: no-store`.

1. List the queue with `GET /api/admin/moderation/reports?status=open`. Valid
   filters are `open`, `reviewing`, `resolved`, `dismissed`, and `all`; `limit`
   and `offset` support pagination.
2. Claim review with
   `PATCH /api/admin/moderation/reports/{reportId}` and body
   `{ "status": "reviewing", "action": "investigating", "note": "…" }`.
3. Review the reason, private details, reporter, and reported account. Avoid
   copying sensitive details into unrelated systems.
4. Record the outcome with a second PATCH. Supported action labels are:
   `none`, `investigating`, `protect-reporter`, `warning-issued`,
   `safety-escalated`, and `no-violation`.
   `protect-reporter` enforces a block from the reporter to the reported rider
   and removes their direct social interaction. Other labels are audit records
   and must only be selected after the described operational action occurred.
5. Use `resolved` when action is complete, or `dismissed` when review found no
   violation. Keep the moderation note factual and concise.

If a report indicates an account-wide threat that a reporter-specific block
cannot contain, select `safety-escalated`, stop the live interaction, and use the
organization's account/security escalation procedure before closing the report.

## App Review verification

For each release containing social features:

1. Send an ordinary room message and verify it reaches the room.
2. Send a known blocked test phrase and verify only the sender receives the
   safety error and no room member receives or reloads the text.
3. Report a test rider, verify it appears in the open administrator queue, move
   it through reviewing, and resolve it with `protect-reporter`.
4. Use **Room rider controls** to report and then block a second test rider.
   Verify the blocked riders leave their shared room and cannot exchange more
   room text, while unrelated riders still can.
5. Enter direct-friend and room voice, then verify **Mute**, **End chat** or room
   leave work immediately and no microphone starts without a user action.
