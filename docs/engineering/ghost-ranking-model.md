# Ghost and Ranking Model

## Course records

Course-record categories are keyed by:

- Track
- Route variant, including Amateur Track, Pro Track, Amateur Line, or Pro Set
- Lap count

One-lap and multi-lap performances never share a leaderboard. Each rider and
studio bike keeps its fastest valid ghost in each category. TrackLab assigns
gold, silver, and bronze medals to the first three distinct finish times in the
category. Tied finish times receive the same medal rank.

Every valid finished race can create a replay ghost. The replay and finish time
are available for competition, while cadence, speed, power, and pedal-zone
analytics remain private unless the owner enables sharing for that ghost.

If a published track layout changes materially, a future schema revision should
add a course-layout version to the category key so records from different route
geometry cannot be compared.

## Multiplayer ranking

Online skill should remain separate from course-record time. A future Glicko-2
rating should use head-to-head placement, opponent strength, and rating
uncertainty. New racers should remain provisional until they complete enough
races for reliable matchmaking.

The product may display both values together, but must not combine them into one
score:

- Course record: objective speed on one exact course category.
- Multiplayer rating: competitive performance against other racers.

This separation keeps matchmaking fair while preserving clear, auditable track
records.
