# TrackLab interface style

The approved interface direction is a restrained SaaS design, using Tool Track Solution as the reference for navigation, surfaces, controls, borders, and typography.

- Use black, gray, and white for interface surfaces, text, buttons, selected rows, and dialogs. Do not reintroduce lime, green, or blue decorative accents.
- Use light work surfaces, dark navigation, subtle gray borders, and compact 8–12px corners.
- Keep headings and controls clear and readable. Preserve larger Reaction Test light labels, PR text, mobile navigation, touch targets, and safe-area handling.
- The Reaction Test leaderboard uses a white dialog, charcoal text, a gray current-rider row, and a black primary action.
- Actual red/yellow/green race signal lights retain their colors. Track imagery and functional route/rider identifiers remain meaningful data rather than theme colors.
- Preserve existing race, account, leaderboard, and native behavior when restyling.

Validation for the neutral website update: production build, TypeScript and existing bundle budgets passed. The full unit run passed 1,666 of 1,667 tests; the one mobile navigation weight assertion was fixed by preserving the original 850 mobile weight, and its four-test file then passed. No new iOS package was produced as part of this website styling update.
