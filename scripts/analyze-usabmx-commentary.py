#!/usr/bin/env python3
"""Build aggregate TrackLab commentary research without retaining transcripts."""

import argparse
import collections
import datetime
import json
import os
import re
import subprocess
import sys
import time

try:
    from youtube_transcript_api import YouTubeTranscriptApi
except ImportError as error:
    raise SystemExit(
        "Install the research tools first: "
        "python3 -m pip install yt-dlp youtube-transcript-api"
    ) from error


DEFAULT_CHANNEL = "https://www.youtube.com/@usabmxvideos/streams"
OFFICIAL_SCHEDULE = (
    "https://www.usabmx.com/news-and-media/6/2025-08-26/"
    "2026-USA-BMX-National-Schedule?id=2057"
)
CHANNEL_ID = "UCxBRuUjSf2j2H3eVr20jypA"

KNOWN_EVENTS = [
    "Las Vegas Nationals",
    "Sunshine State Nationals",
    "Blue Ridge Nationals",
    "Show Me State Nationals",
    "So-Cal Nationals",
    "Lone Star Nationals",
    "Cajun Nationals",
    "Carolina Nationals",
    "Great Northwest Nationals",
    "Land O' Lakes Nationals",
    "Dixieland Nationals",
    "Legacy Nationals",
    "Golden State Nationals",
    "Music City Nationals",
    "Spring Nationals",
    "Palmetto Nationals",
    "Midwest Nationals",
    "Lumberjack Nationals",
    "Stars N' Stripes Nationals",
    "Red River Nationals",
    "Vegas Nationals",
    "Quaker State Nationals",
    "Badger State Nationals",
    "Mile High Nationals",
    "Mt. Rushmore Nationals",
    "Gem State Nationals",
    "Battlefield Nationals",
    "Derby City Nationals",
    "Gator Nationals",
    "Fall Nationals",
    "Race of Champions",
    "Grand Nationals",
    "Grands",
    "Pro Championship Finals",
]

EVENT_ALIASES = {
    "stars and stripes national": "Stars N' Stripes Nationals",
    "stars & stripes national": "Stars N' Stripes Nationals",
    "stars n' stripes national": "Stars N' Stripes Nationals",
    "las vegas national": "Las Vegas Nationals",
    "vegas national": "Vegas Nationals",
    "so-cal national": "So-Cal Nationals",
    "so cal national": "So-Cal Nationals",
    "land o lakes national": "Land O' Lakes Nationals",
    "land o' lakes national": "Land O' Lakes Nationals",
    "grand national": "Grand Nationals",
}

RACE_PHRASES = {
    "gate_and_launch": [
        "out of the gate",
        "gate drops",
        "gate drop",
        "gets the jump",
        "opening drive",
        "first straight",
        "into turn one",
        "into the first turn",
        "holeshot",
    ],
    "race_order": [
        "out front",
        "takes the lead",
        "takes over",
        "moves into",
        "in the two spot",
        "in the three spot",
        "sitting in second",
        "sitting in third",
        "holds the lead",
    ],
    "battle_and_pass": [
        "side by side",
        "bar to bar",
        "inside line",
        "outside line",
        "around the outside",
        "dives inside",
        "looking for a way",
        "coming back",
        "charging hard",
    ],
    "track_features": [
        "second straight",
        "third straight",
        "last straight",
        "final straight",
        "rhythm section",
        "pro set",
        "inside line",
        "outside line",
    ],
    "finish": [
        "to the stripe",
        "at the line",
        "takes the win",
        "gets the win",
        "photo finish",
        "down the last straight",
        "down the final straight",
    ],
}

RACE_TERMS = [
    "gate",
    "holeshot",
    "lead",
    "leader",
    "pedal",
    "pedaling",
    "cadence",
    "straight",
    "rhythm",
    "berm",
    "turn",
    "inside",
    "outside",
    "line",
    "pro set",
    "roller",
    "double",
    "tabletop",
    "manual",
    "pump",
    "stripe",
    "moto",
    "main event",
    "transfer",
    "qualifier",
    "podium",
    "finish",
]


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--channel", default=DEFAULT_CHANNEL)
    parser.add_argument("--years", nargs="+", type=int, default=[2025, 2026])
    parser.add_argument("--output", default="data/commentary/usabmx-national-analysis.json")
    parser.add_argument("--playlist-end", type=int, default=400)
    parser.add_argument("--delay-seconds", type=float, default=2.0)
    parser.add_argument("--max-caption-videos", type=int)
    parser.add_argument("--coverage-cutoff", default=datetime.date.today().isoformat())
    return parser.parse_args()


def canonical_event(title):
    lower = title.lower().replace("sate", "state").replace(
        "lumberjacknational", "lumberjack national"
    )
    for source, canonical in EVENT_ALIASES.items():
        if source in lower:
            return canonical

    comparable_title = (
        lower.replace("nationals", "national")
        .replace("&", "and")
        .replace("n'", "and")
    )
    for event in KNOWN_EVENTS:
        comparable_event = (
            event.lower()
            .replace("nationals", "national")
            .replace("&", "and")
            .replace("n'", "and")
        )
        if comparable_event in comparable_title:
            return event

    cleaned = re.sub(
        r"^20(?:25|26)\s+(?:usa\s+bmx\s+)?", "", title, flags=re.IGNORECASE
    )
    cleaned = re.split(
        r"\s+(?:day\s+\d|timing|audio|pre[- ]?race|pre[- ]?show|replay|mains?)\b",
        cleaned,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]
    return cleaned.strip(" -")


def video_kind(title):
    lower = title.lower()
    if any(value in lower for value in ("pre-race", "pre race", "pre-show", "pre show")):
        return "pre-show"
    if "timing" in lower or "audio" in lower:
        return "timing-audio"
    if "replay" in lower:
        return "race-replay"
    return "race-broadcast"


def included_title(title, years):
    if len(title) < 4 or not title[:4].isdigit() or int(title[:4]) not in years:
        return False
    lower = title.lower()
    if "hall of fame" in lower or "gold cup" in lower:
        return False
    return any(
        token in lower
        for token in ("national", "grands", "race of champions", "pro championship finals")
    )


def channel_inventory(args):
    command = [
        sys.executable,
        "-m",
        "yt_dlp",
        "--ignore-errors",
        "--flat-playlist",
        "--playlist-end",
        str(args.playlist_end),
        "--print",
        "%(id)s\t%(title)s",
        args.channel,
    ]
    process = subprocess.run(command, capture_output=True, text=True, check=True)
    videos = []
    seen = set()
    years = set(args.years)
    for line in process.stdout.splitlines():
        if "\t" not in line:
            continue
        video_id, title = line.split("\t", 1)
        if video_id in seen or not included_title(title, years):
            continue
        seen.add(video_id)
        videos.append(
            {
                "id": video_id,
                "title": title,
                "year": int(title[:4]),
                "event": canonical_event(title),
                "kind": video_kind(title),
                "url": "https://www.youtube.com/watch?v=" + video_id,
            }
        )
    return sorted(videos, key=lambda item: (-item["year"], item["event"], item["title"]))


def load_previous(output_path):
    try:
        with open(output_path, encoding="utf-8") as source:
            previous = json.load(source)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}, collections.Counter(), collections.Counter(), collections.Counter()

    videos = {video["id"]: video for video in previous.get("videos", [])}
    terms = collections.Counter(previous.get("terminology", {}))
    phrases = collections.Counter(previous.get("racePatterns", {}).get("phrases", {}))
    categories = collections.Counter(previous.get("racePatterns", {}).get("categories", {}))
    return videos, terms, phrases, categories


def analyze_transcript(transcript, term_counts, phrase_counts, category_counts):
    word_count = 0
    race_call_segments = 0
    for segment in transcript:
        text = re.sub(r"\s+", " ", str(segment.get("text", "")).lower()).strip()
        if not text or text.startswith("["):
            continue
        word_count += len(re.findall(r"[a-z]+(?:'[a-z]+)?", text))
        segment_hit = False
        for category, phrases in RACE_PHRASES.items():
            category_hit = False
            for phrase in phrases:
                hits = text.count(phrase)
                if hits:
                    phrase_counts[phrase] += hits
                    category_hit = True
                    segment_hit = True
            if category_hit:
                category_counts[category] += 1
        for term in RACE_TERMS:
            hits = len(re.findall(r"(?<![a-z])" + re.escape(term) + r"(?![a-z])", text))
            if hits:
                term_counts[term] += hits
                segment_hit = True
        if segment_hit:
            race_call_segments += 1
    return {
        "captionStatus": "analyzed",
        "captionSegments": len(transcript),
        "captionWords": word_count,
        "raceCallSegments": race_call_segments,
    }


def analyze_inventory(args, videos):
    previous, term_counts, phrase_counts, category_counts = load_previous(args.output)
    api = YouTubeTranscriptApi()
    caption_attempts = 0
    youtube_throttled = False

    for index, video in enumerate(videos, 1):
        previous_video = previous.get(video["id"], {})
        if previous_video.get("captionStatus") == "analyzed":
            video.update(
                {
                    key: previous_video[key]
                    for key in (
                        "captionStatus",
                        "captionSegments",
                        "captionWords",
                        "raceCallSegments",
                    )
                    if key in previous_video
                }
            )
            continue
        if previous_video.get("captionStatus") == "disabled-by-source":
            video["captionStatus"] = "disabled-by-source"
            continue
        if youtube_throttled or (
            args.max_caption_videos is not None
            and caption_attempts >= args.max_caption_videos
        ):
            video["captionStatus"] = "pending-youtube-throttled"
            continue

        caption_attempts += 1
        try:
            transcript = api.fetch(video["id"], languages=["en"]).to_raw_data()
            video.update(
                analyze_transcript(
                    transcript,
                    term_counts,
                    phrase_counts,
                    category_counts,
                )
            )
        except Exception as error:  # The provider exposes several error types.
            error_name = type(error).__name__
            if error_name == "TranscriptsDisabled":
                video["captionStatus"] = "disabled-by-source"
            else:
                video["captionStatus"] = "pending-youtube-throttled"
                if error_name == "IpBlocked":
                    youtube_throttled = True

        print(
            "Processed {}/{}: {} ({})".format(
                index,
                len(videos),
                video["id"],
                video["captionStatus"],
            ),
            flush=True,
        )
        if not youtube_throttled and args.delay_seconds > 0:
            time.sleep(args.delay_seconds)

    return term_counts, phrase_counts, category_counts


def build_report(args, videos, term_counts, phrase_counts, category_counts):
    by_year = {}
    for year in sorted(set(args.years)):
        year_videos = [video for video in videos if video["year"] == year]
        by_year[str(year)] = {
            "videos": len(year_videos),
            "captionedVideos": sum(
                video.get("captionStatus") == "analyzed" for video in year_videos
            ),
            "captionWords": sum(video.get("captionWords", 0) for video in year_videos),
            "raceCallSegments": sum(
                video.get("raceCallSegments", 0) for video in year_videos
            ),
            "events": sorted(set(video["event"] for video in year_videos)),
        }

    analyzed = [
        video for video in videos if video.get("captionStatus") == "analyzed"
    ]
    return {
        "schemaVersion": 1,
        "knowledgeVersion": "usabmx-national-{}-v1".format(args.coverage_cutoff),
        "generatedAt": datetime.date.today().isoformat(),
        "coverageCutoff": args.coverage_cutoff,
        "source": {
            "organization": "USA BMX",
            "officialChannel": args.channel,
            "officialChannelId": CHANNEL_ID,
            "officialSchedule": OFFICIAL_SCHEDULE,
        },
        "method": {
            "description": (
                "Inventory official National-series-related streams, analyze "
                "available public English caption tracks, and retain only "
                "aggregate terminology, race-pattern counts, and per-video "
                "coverage metadata."
            ),
            "retainsVideo": False,
            "retainsAudio": False,
            "retainsFullTranscripts": False,
            "originalityRule": (
                "Use aggregate BMX vocabulary and race-phase patterns only. "
                "Do not quote, imitate, or clone source announcers."
            ),
        },
        "summary": {
            "indexedVideos": len(videos),
            "indexedEventsByYear": {
                year: len(details["events"]) for year, details in by_year.items()
            },
            "analyzedCaptionTracks": len(analyzed),
            "analyzedCaptionSegments": sum(
                video.get("captionSegments", 0) for video in analyzed
            ),
            "analyzedCaptionWords": sum(
                video.get("captionWords", 0) for video in analyzed
            ),
            "analyzedRaceCallSegments": sum(
                video.get("raceCallSegments", 0) for video in analyzed
            ),
            "pendingCaptionTracks": sum(
                video.get("captionStatus") == "pending-youtube-throttled"
                for video in videos
            ),
            "captionsDisabledBySource": sum(
                video.get("captionStatus") == "disabled-by-source"
                for video in videos
            ),
        },
        "byYear": by_year,
        "terminology": dict(term_counts.most_common()),
        "racePatterns": {
            "categories": dict(category_counts.most_common()),
            "phrases": dict(phrase_counts.most_common()),
        },
        "videos": videos,
    }


def main():
    args = parse_args()
    videos = channel_inventory(args)
    print("Indexed {} qualifying official videos.".format(len(videos)), flush=True)
    term_counts, phrase_counts, category_counts = analyze_inventory(args, videos)
    report = build_report(
        args,
        videos,
        term_counts,
        phrase_counts,
        category_counts,
    )
    output_directory = os.path.dirname(os.path.abspath(args.output))
    os.makedirs(output_directory, exist_ok=True)
    temporary_output = args.output + ".tmp"
    with open(temporary_output, "w", encoding="utf-8") as destination:
        json.dump(report, destination, indent=2, ensure_ascii=False)
        destination.write("\n")
    os.replace(temporary_output, args.output)
    print(
        "Saved {} indexed videos and {} analyzed race-call segments to {}.".format(
            report["summary"]["indexedVideos"],
            report["summary"]["analyzedRaceCallSegments"],
            args.output,
        )
    )


if __name__ == "__main__":
    main()
