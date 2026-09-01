-- Reproducible source export for the TrackLab global bike-shop catalog.
-- Run with DuckDB from the repository root. The output is uncompressed NDJSON;
-- gzip it before passing it to build-overture-bike-shop-catalog.mjs if desired.
INSTALL httpfs;
LOAD httpfs;
SET s3_region = 'us-west-2';
SET preserve_insertion_order = false;

COPY (
  SELECT
    id,
    names.primary AS name,
    bbox.ymin AS latitude,
    bbox.xmin AS longitude,
    taxonomy.primary AS category,
    confidence,
    operating_status,
    addresses[1].freeform AS address,
    addresses[1].locality AS locality,
    addresses[1].region AS region,
    addresses[1].postcode AS postal_code,
    upper(addresses[1].country) AS country_code,
    websites[1] AS website,
    phones[1] AS phone,
    list_sort(list_distinct(list_transform(
      sources,
      source_item -> concat_ws(
        '|',
        coalesce(source_item.dataset, ''),
        coalesce(source_item.license, ''),
        coalesce(source_item.provider, ''),
        coalesce(source_item.update_time, '')
      )
    ))) AS source_provenance
  FROM read_parquet(
    's3://overturemaps-us-west-2/release/2026-08-19.0/theme=places/type=place/*',
    hive_partitioning = 1
  )
  WHERE taxonomy.primary IN ('bike_store', 'bike_repair_maintenance')
    AND confidence >= 0.50
    AND coalesce(operating_status, '') NOT IN ('permanently_closed', 'closed')
    AND bbox.xmin BETWEEN -180 AND 180
    AND bbox.ymin BETWEEN -90 AND 90
    AND coalesce(names.primary, '') <> ''
) TO '/tmp/tracklab-overture-bike-shops-2026-08-19.ndjson'
  (FORMAT JSON, ARRAY false);
