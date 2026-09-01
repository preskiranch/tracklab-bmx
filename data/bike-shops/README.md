# Rebuilding the TrackLab global bike-shop catalog

The committed artifact is generated from the pinned Overture Maps Places
release `2026-08-19.0`. The source export must select only the current primary
taxonomy values `bike_store` and `bike_repair_maintenance`, exclude records
marked `closed` or `permanently_closed`, require a nonempty name and point
geometry, and apply a minimum confidence of `0.50`.

Each compact record retains the upstream Overture source lineage exported as
sorted `dataset|license|provider|update_time` strings. TrackLab keeps the
Overture place UUID as the stable canonical identity for claims within this
pinned release. Every catalog rebuild must review any removed or materially
changed claimed UUID before the new release is published.

The committed `.json.gz` file uses schema version 2's line-oriented format:
one metadata JSON record followed by one compact shop tuple per line. The
server streams, validates, and indexes those lines without expanding every
listing into a response object at startup. This keeps the global catalog's
memory bounded while retaining deterministic record and input checksums.

1. Run `scripts/extract-overture-bike-shops.sql` with DuckDB against the pinned
   public S3 release and write newline-delimited JSON.
2. Build the deterministic compact artifact:

   ```sh
   TRACKLAB_OVERTURE_RELEASE=2026-08-19.0 \
   TRACKLAB_OVERTURE_MINIMUM_CONFIDENCE=0.50 \
   node scripts/build-overture-bike-shop-catalog.mjs \
     /path/to/overture-bike-shops.ndjson.gz \
     data/bike-shops/overture-bicycle-shops.json.gz
   ```

3. Run `npm run shops:validate`, then the focused catalog and directory tests.
   The release validator rejects a missing, undersized, wrong-version, or
   corrupt catalog and verifies known Vacaville-area shops and their source
   lineage. It is also part of the production `npm run build` pipeline.

   The artifact embeds its source
   SHA-256, compact-record SHA-256, source/output counts, filter summary,
   source-provenance encoding, license/notice manifest, and release identifier.
   Validate those values in review whenever it is rebuilt.

The exact DuckDB export statement is intentionally kept in the checked-in SQL
file so taxonomy and nested-field changes cannot silently alter a future build.
