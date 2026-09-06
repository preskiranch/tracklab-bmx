# Public website style

The public website uses the user's Apple.com reference: generous spacing, large black headings with muted continuations, a near-white canvas, rounded white cards and restrained shadows. TrackLab branding, original photography and functional entry points remain its own.

The palette is scoped to `.membership-hub-page` in `MembershipLanding.css` and `.public-info-page` in `PublicInfoPage.css`. It does not change the global training/racing palette. Public track and bike-shop directories consume the scoped panel, text and border variables; their map, photo and modal overlays retain their explicit contrast treatment.

The desktop navigation is a compact horizontal bar. On phones the brand/action row sits above a horizontally reachable navigation strip. Feature cards form a three-column desktop row and a swipeable, scroll-snapping row on phones. The original reaction photo uses its native aspect ratio without asset edits.

Existing tab state, deep links, back navigation, account handling, watch connection mounting and billing controls remain in place. Unavailable subscription state is still disclosed in the purchase controls; the plan card keeps the stable “Racer membership” title until an actual product name is loaded.

The user approved the desktop and mobile design on September 6, 2026. It is included in website and iOS build 75. Design-preview evidence is outside the repository at `output/tracklab-apple-style` in the shared Playground directory; release evidence is in `output/tracklab-release75`.
