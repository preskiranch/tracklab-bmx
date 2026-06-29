# Track Provider Imports

Put organizer exports here before running the database build script.

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
    "outline": [
      { "lat": 38.25588, "lng": -122.28374 }
    ]
  }
]
```

The importer intentionally expects licensed/approved provider data. Do not paste Google Earth screenshots or scrape imagery into this repo.
