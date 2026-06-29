# Track Provider Imports

Put organizer exports here before running the database build script.

USA BMX / BMX Canada locator records can be refreshed with:

```sh
npm run tracks:import:usabmx
```

That command reads the public USA BMX track finder backend used by
`https://www.usabmx.com/tracks/find-tracks` and writes
`data/imports/usa-bmx-official.json`.

The imported USA BMX records include official name, address, state/province,
postal code, country, and latitude/longitude. They are marked
`routeStatus: "locator-only"` because the endpoint does not provide the actual
start hill, rideable centerline, jump/turn geometry, or finish line. Those
fields must be verified per track before the race model can claim to follow the
true lane.

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
