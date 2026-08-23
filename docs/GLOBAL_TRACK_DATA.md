# Global BMX Racing Track Data

TrackLab keeps locator data and rider-created race mappings separate. A locator record identifies a BMX Racing facility; it does not create a start gate, centerline, split, pedal zone, or finish line automatically.

## Source hierarchy

1. `official-track-directory`: an official track locator published by a sanctioning body or national federation.
2. `federation-directory`: an official federation club directory with an address and coordinates.
3. `reference-only`: a governing-body page that confirms a venue or discipline but is not a complete locator.
4. `supplemental`: an address-checked OpenStreetMap BMX Racing candidate used where no exportable federation directory is available.
5. `unverified`: legacy or manual data that still needs source review.

Higher-confidence provenance always wins record conflicts. A rider-created route mapping still wins geometry conflicts so verified start, route, split, zone, and finish data are preserved.

## Active official imports

| Provider | Coverage | Import command |
| --- | --- | --- |
| USA BMX / BMX Canada | United States, Canada, and affiliated territories | `npm run tracks:import:usabmx` |
| Fédération Française de Cyclisme | France | `npm run tracks:import:ffc` |
| BMX New Zealand | New Zealand | `npm run tracks:import:bmxnz` |
| AusCycling | Australia | `npm run tracks:import:auscycling` |

Run all supported official imports with `npm run tracks:import:official`.

## Supplemental country coverage

`npm run tracks:import:osm` queries BMX Racing candidates by ISO country boundary. It rejects unnamed geometry fragments, shops, pump tracks, skate parks, freestyle areas, dirt-jump facilities, mountain-bike parks, and other non-racing features. Accepted records are reverse-geocoded, country-checked, deduplicated, marked `supplemental`, and left `locator-only` until a rider verifies the race route.

Set `OSM_REVERSE_GEOCODE=1` for a full address refresh:

```sh
OSM_REVERSE_GEOCODE=1 npm run tracks:import:osm
```

OpenStreetMap-derived records are subject to the Open Database License. Source URLs and source object IDs remain attached to every record.

## Federation limitations

- UCI is the global BMX Racing authority but does not publish a complete public global track-locator export.
- British Cycling exposes a BMX Racing club filter, but automated access is protected by Cloudflare. Import requires an approved federation export or API agreement.
- Cycling Ireland exposes BMX-affiliated club names and counties, but not exact track addresses and coordinates. Those entries are not promoted into the production track catalog without a matching location source.
- National federations without a public track-level export remain source-research items. Their records must not be fabricated from a city name or a generic web search result.

## Production validation

`npm run tracks:build` rebuilds compressed catalog assets and fails when it finds duplicate IDs, invalid coordinates, invalid source URLs, unknown providers, or an official/federation record without an address and source provenance.

Optional track contact fields are `facebookUrl`, `instagramUrl`, `tiktokUrl`,
`youtubeUrl`, and `phoneNumber`. Facebook and Instagram continue to come from
normalized source metadata. TikTok and YouTube are fail-closed: normal builds
remove unreviewed imported values, then overlay only the exact track/account
pairs in `data/track-social-links.json`. Account-content URLs, lookalike hosts,
ambiguous facilities, generic federation/media channels, and unreviewed
duplicates are rejected.
Phone numbers retain safe source formatting for display, while the UI derives a
digits-only `tel:` target with at most one leading `+`. Missing or ambiguous
contacts are omitted. The USA BMX refresh verifies a track microsite's embedded
track ID and name before accepting its primary contact phone; the normal catalog
build never performs that live lookup. AusCycling phones come from its official
Club Finder API, and supplemental OpenStreetMap phone tags remain attributed to
their original OSM record.

`npm run tracks:social:audit` is the explicit network-enabled enrichment step.
It evaluates all 1,305 catalog records, follows only retained exact source pages
and exact USA BMX microsites, records exclusions and network errors, and writes
the reviewed registry plus `data/audits/track-social-audit.json`. The ordinary
`tracks:build` path remains deterministic and offline, and validation requires
the full and locator databases to match the reviewed registry exactly.

The generated database includes coverage totals by country and verification status. Public mappings saved by users continue to be synchronized independently through the TrackLab cloud mapping API.
