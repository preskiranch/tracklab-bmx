# Global Bike Shop Directory

TrackLab's Global Bike Shop Directory is a free public feature. Visitors can
browse the Google road map without creating an account. After the visitor pans
or zooms to a useful city or regional view, TrackLab loads the bike shops in the
visible area and places them on the map. Entering a place or deliberately
sharing current location is an optional shortcut for moving the map; it is not
required to discover shops.

The earlier 5-to-50-mile nearby search remains available as a focused fallback.
The primary experience is the synchronized map, shop list, and shop details.
Selecting either a marker or a list item selects the same directory record.
Dense groups of markers are clustered so that the map remains readable.
The preloaded directory can also be browsed explicitly as Country →
State/Province → City, with clear fallback labels when a source listing does
not include one of those address fields. A visitor can use that hierarchy or
the map without already knowing a shop name.

## Data and links

- TrackLab ships a compact, pinned Overture Maps Places catalog as its durable
  worldwide baseline. The release uses the current `bike_store` and
  `bike_repair_maintenance` taxonomy, a documented confidence floor, stable
  place UUIDs, and retained upstream source lineage.
- OpenStreetMap/Overpass provides live open-data enrichment. Exact-name shops
  within 50 meters are deduplicated without blending fields across licenses;
  the durable Overture record remains canonical and retains the OSM listing as
  a source/claim alias.
- Overture, upstream-provider, and OpenStreetMap attributions remain visible.
  The in-app data-license page serves the bundled CDLA-Permissive-2.0,
  Apache-2.0, and Foursquare notice text and identifies the pinned release and
  source change date.
- Shop websites are displayed only when they use an allowlisted `http` or
  `https` URL.
- Google Maps, Directions, and Street View are outbound links. TrackLab does
  not offer an Apple Maps or Google Earth shop view.
- Selecting a shop also calculates BMX tracks within 50 miles from TrackLab's
  global track catalog. Each track link opens that exact record in TrackLab's
  own public BMX directory.

## Privacy and reliability

Viewport and nearby searches use `POST` so map bounds and precise coordinates
are not written into URL query strings. Requests are rate-limited,
time-bounded, response-size-bounded, deduplicated while in flight, and cached
briefly in memory. The map does not query the entire planet at once: it asks the
visitor to zoom closer, then loads only the current visible bounds after map
movement settles. Location is requested only after a visitor presses the
current-location button; manual place search remains available.

The public Overpass service can be temporarily unavailable. In that case the
directory returns the preloaded catalog promptly, labels the result as a
degraded live refresh, and retains all source attribution. Healthy mirrors are
tried with bounded timeouts; failed mirrors cool down instead of delaying every
subsequent map pan. A live service outage therefore cannot make the directory
empty or block the rest of TrackLab.

## Free business claims

A shop owner, manager, or authorized representative may sign in with a free
personal TrackLab account and submit a claim request. A request stores only the
listing snapshot and bounded verification contact or documentation note needed
for review.

Claims are never auto-approved. They enter a private moderation queue and do
not expose claimant details publicly. Only an approved claim reserves the
canonical listing and all known cross-catalog identity aliases; a pending
request cannot be used to squat a business. Requesters can view their own claim
status and withdraw a pending request.

Before accepting a claim request, TrackLab resolves the exact canonical record:
an Overture identity must still exist in the pinned validated artifact, and an
OpenStreetMap identity must still describe a bike shop or repair business in
the live source. When the two sources identify the same shop, the claim stores
both identity keys. This keeps one approval and one public badge stable whether
a later directory response contains the Overture record, its OSM alias, or
both. A reviewer then independently verifies control through the selected
method and records a claimant-visible review note. Each decision remains an
immutable history row; a corrected request after rejection or withdrawal
creates a new row instead of overwriting the earlier decision. Approval adds
only a public claimed-and-verified badge; claimant, reviewer, contact,
evidence, and review-note fields remain private.
