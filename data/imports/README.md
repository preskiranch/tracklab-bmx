# Track Provider Imports

Put organizer exports here before running the database build script.

USA BMX / BMX Canada locator records can be refreshed with:

```sh
npm run tracks:import:usabmx
```

All active official importers can be refreshed with:

```sh
npm run tracks:import:official
```

Current active official importers:

- USA BMX / BMX Canada: official locator endpoint with provider coordinates.
- Fédération Française de Cyclisme: official BMX Racing Google My Maps KML
  embedded on the FFC équipements sportifs page, enriched with French city,
  department, and region from the Base Adresse Nationale reverse geocoding API.
- BMX New Zealand: official BMXNZ club finder page. BMXNZ lists addresses but
  not GPS coordinates, so imported GPS values are cached geocodes and are marked
  `coordinateAccuracy` accordingly.

Supplemental global locator import:

- OpenStreetMap Overpass: use `npm run tracks:import:osm` to import
  locator-only BMX Racing track candidates in countries where the federation
  directory is blocked, missing, or does not expose a public export. The importer
  filters for BMX/track-like OSM records and reverse-geocodes them through
  Nominatim for country, state/province, city, and address grouping. These
  records are supplemental, not source-of-truth replacements for USA BMX/BMX
  Canada, FFC, BMXNZ, or any future official federation export.

That command reads the public USA BMX track finder backend used by
`https://www.usabmx.com/tracks/find-tracks` and writes
`data/imports/usa-bmx-official.json`.

The imported USA BMX records include official name, address, state/province,
postal code, country, and latitude/longitude. They are marked
`routeStatus: "locator-only"` because the endpoint does not provide the actual
start hill, rideable centerline, jump/turn geometry, or finish line. Those
fields must be verified per track before the race model can claim to follow the
true lane.

The same route-status rule applies to global locator imports. A track record can
be used to find the venue on the map immediately, but it should not be treated as
a rideable race route until a user or verified source maps the start gate,
centerline, sprint zones, and finish line.

Expected input shape:

```json
[
  {
    "id": "north-bay-bmx-napa-valley",
    "name": "North Bay BMX - Napa Valley",
    "country": "United States",
    "countryCode": "US",
    "state": "California",
    "region": "North America",
    "source": "USA BMX",
    "sourceUrl": "https://www.usabmx.com/tracks/ca-north-bay%20bmx",
    "lengthMeters": 335,
    "elevationMeters": 3,
    "surface": "Outdoor clay race track",
    "centerline": [
      { "lat": 38.25588, "lng": -122.28374 }
    ],
    "startGate": { "lat": 38.25588, "lng": -122.28374 },
    "finishLine": { "lat": 38.2563, "lng": -122.28439 },
    "routeStatus": "estimated",
    "outline": [
      { "lat": 38.25588, "lng": -122.28374 }
    ]
  }
]
```

The importer intentionally expects official provider data or approved exports. Do not paste Google Earth screenshots or scrape imagery into this repo.
