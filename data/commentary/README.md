# USA BMX commentary research

TrackLab uses this research as a compact BMX-language guide for original live
commentary. It is not a voice clone, a copy of an announcer, or a claim that the
base OpenAI model has been retrained.

The checked-in report inventories official USA BMX National-series-related
streams for 2024–2026 published through July 23, 2026. It retains video
metadata, aggregate terminology counts, race-phase pattern counts, and coverage
status. It does not retain video, audio, or full transcripts.

The current pass indexed 285 official streams, including 119 from 2024, and
analyzed 642,428 caption words containing 18,208 BMX race-call segments. YouTube
throttled caption retrieval after 14 caption tracks, so the remaining tracks
are explicitly marked pending rather than treated as analyzed. Nine short
broadcast sections have also been sampled for aggregate delivery traits such as
dynamic range, tension build, and finish resolution; those temporary source
audio files are not retained.

The USA BMX organization was formed under that name in 2011, and its official
live-video archive does not provide a 2004 National season. The expanded
inventory therefore begins with the requested and available 2024 season.

To resume the research later:

```bash
python3 -m venv .venv-commentary
source .venv-commentary/bin/activate
python3 -m pip install yt-dlp youtube-transcript-api
npm run commentary:research:usabmx
```

The updater resumes already analyzed video IDs, waits between caption requests,
and stops further caption requests when YouTube reports throttling.
