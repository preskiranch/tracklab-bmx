# Global Bike Shop Directory

TrackLab's Global Bike Shop Directory is a free public feature. Visitors can
search without creating an account by entering a place or deliberately sharing
their current location, then choosing a radius from 5 to 50 miles in five-mile
increments.

## Data and links

- Nearby shop records come from OpenStreetMap's Overpass service and retain
  visible OpenStreetMap/ODbL attribution.
- Shop websites are displayed only when they use an allowlisted `http` or
  `https` URL.
- Google Maps, Directions, and Street View are outbound links. TrackLab does
  not offer an Apple Maps or Google Earth shop view.
- Selecting a shop also calculates BMX tracks within 50 miles from TrackLab's
  global track catalog. Each track link opens that exact record in TrackLab's
  own public BMX directory.

## Privacy and reliability

Nearby searches use `POST` so precise coordinates are not written into URL
query strings. Searches are rate-limited, time-bounded, response-size-bounded,
deduplicated while in flight, and cached briefly in memory. Location is
requested only after a visitor presses the current-location button; manual
place search remains available.

The public Overpass service can be temporarily unavailable. The directory must
show a retryable error without blocking the rest of TrackLab or hiding source
attribution.

## Free business claims

A shop owner, manager, or authorized representative may sign in with a free
personal TrackLab account and submit a claim request. A request stores only the
listing snapshot and bounded verification contact or documentation note needed
for review.

Claims are never auto-approved. They enter a private moderation queue and do
not expose claimant details publicly. Only an approved claim reserves the OSM
listing; a pending request cannot be used to squat a business. Requesters can
view their own claim status and withdraw a pending request.

Before approving a claim, TrackLab reloads the exact OpenStreetMap element so a
request cannot substitute a different name, location, or business identity. A
reviewer then independently verifies control through the selected method and
records a claimant-visible review note. Each decision remains an immutable
history row; a corrected request after rejection or withdrawal creates a new
row instead of overwriting the earlier decision. Approval adds only a public
claimed-and-verified badge; claimant, reviewer, contact, evidence, and
review-note fields remain private.
