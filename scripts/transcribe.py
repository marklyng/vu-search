"""
transcribe.py — Transcribe podcast episodes using the Lemonfox.ai API.

Reads data/episodes_meta.json for episode list and audio URLs.
Skips episodes that already have a transcript file on disk.
Writes full verbose_json response to data/transcripts/{id}.json.gz.

Usage:
    python scripts/transcribe.py                         # full backlog
    python scripts/transcribe.py --limit 3               # first N episodes
    python scripts/transcribe.py --episode-id <id>       # single episode
    python scripts/transcribe.py --oldest-first          # oldest episodes first
    python scripts/transcribe.py --concurrency 3         # reduce parallelism

Requires:
    LEMONFOX_API_KEY environment variable
    pip install aiohttp
"""

import argparse
import asyncio
import gzip
import json
import os
import sys
import time
from pathlib import Path

import aiohttp

# Auto-load .env from project root if present (no external dependency)
_env_file = Path(__file__).parent.parent / ".env"
if _env_file.exists():
    for _line in _env_file.read_text(encoding="utf-8").splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _, _v = _line.partition("=")
            if not os.environ.get(_k.strip()):
                os.environ[_k.strip()] = _v.strip()

DATA_DIR = Path(__file__).parent.parent / "data"
TRANSCRIPTS_DIR = DATA_DIR / "transcripts"
META_FILE = DATA_DIR / "episodes_meta.json"

EU_ENDPOINT = "https://eu-api.lemonfox.ai/v1/audio/transcriptions"
NON_EU_ENDPOINT = "https://api.lemonfox.ai/v1/audio/transcriptions"

PROMPT = "Videnskabeligt Udfordret er en dansk videnskabskomik podcast medværterne Mark og Flemming."

# Cost per hour of audio at each endpoint
COST_PER_HOUR_EU = 0.60 / 3
COST_PER_HOUR_NON_EU = 0.50 / 3


def parse_duration_seconds(duration_str: str) -> float:
    """Parse 'H:MM:SS' or 'M:SS' duration string to seconds."""
    if not duration_str:
        return 0.0
    parts = duration_str.strip().split(":")
    try:
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
        if len(parts) == 2:
            return int(parts[0]) * 60 + int(parts[1])
        return float(parts[0])
    except (ValueError, IndexError):
        return 0.0


async def transcribe_episode(
    session: aiohttp.ClientSession,
    episode: dict,
    api_key: str,
    endpoint: str,
    semaphore: asyncio.Semaphore,
    speaker_labels: bool = True,
) -> tuple[bool, float]:
    """
    Submit one episode for transcription and write the result to disk.

    Returns (success, duration_minutes).
    """
    ep_id = episode["id"]
    title = episode.get("title", ep_id)
    audio_url = episode.get("audio_url", "")
    duration_str = episode.get("duration", "")
    duration_seconds = parse_duration_seconds(duration_str)
    duration_minutes = duration_seconds / 60

    out_path = TRANSCRIPTS_DIR / f"{ep_id}.json.gz"

    if out_path.exists() or (TRANSCRIPTS_DIR / f"{ep_id}.json").exists():
        print(f"  SKIP  {title[:60]} (already transcribed)")
        return True, 0.0

    if not audio_url:
        print(f"  ERROR {title[:60]} — no audio_url", file=sys.stderr)
        return False, 0.0

    payload = aiohttp.FormData()
    payload.add_field("file", audio_url)
    payload.add_field("language", "danish")
    payload.add_field("response_format", "verbose_json")
    if speaker_labels:
        payload.add_field("speaker_labels", "true")
    payload.add_field("prompt", PROMPT)

    headers = {"Authorization": f"Bearer {api_key}"}

    max_retries = 5
    delay = 10.0

    async with semaphore:
        for attempt in range(max_retries):
            try:
                print(f"  START {title[:60]} ({duration_str})")
                t0 = time.monotonic()
                async with session.post(endpoint, data=payload, headers=headers) as resp:
                    if resp.status == 429:
                        wait = delay * (2 ** attempt)
                        print(f"  429   {title[:60]} — rate limited, retrying in {wait:.0f}s")
                        await asyncio.sleep(wait)
                        continue

                    if resp.status != 200:
                        body = await resp.text()
                        print(
                            f"  ERROR {title[:60]} — HTTP {resp.status}: {body[:120]}",
                            file=sys.stderr,
                        )
                        return False, 0.0

                    data = await resp.json()

                elapsed = time.monotonic() - t0
                result = {
                    "episode_id": ep_id,
                    "episode_title": title,
                    "pub_date": episode.get("date", ""),
                    "text": data.get("text", ""),
                    "segments": data.get("segments", []),
                }
                TRANSCRIPTS_DIR.mkdir(parents=True, exist_ok=True)
                out_path.write_bytes(
                    gzip.compress(
                        json.dumps(result, ensure_ascii=False, indent=2).encode("utf-8")
                    )
                )
                print(f"  DONE  {title[:60]} ({elapsed:.0f}s)")
                return True, duration_minutes

            except aiohttp.ClientError as e:
                wait = delay * (2 ** attempt)
                print(f"  NET   {title[:60]} — {e}, retrying in {wait:.0f}s", file=sys.stderr)
                await asyncio.sleep(wait)

        print(f"  FAIL  {title[:60]} — exhausted retries", file=sys.stderr)
        return False, 0.0


async def run(episodes: list[dict], api_key: str, endpoint: str, concurrency: int, speaker_labels: bool) -> None:
    semaphore = asyncio.Semaphore(concurrency)
    connector = aiohttp.TCPConnector(limit=concurrency)
    # Long timeout: large audio files can take 10+ minutes to process
    timeout = aiohttp.ClientTimeout(total=1800)

    total_minutes = 0.0
    successes = 0
    failures = 0

    async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
        tasks = [
            transcribe_episode(session, ep, api_key, endpoint, semaphore, speaker_labels)
            for ep in episodes
        ]
        results = await asyncio.gather(*tasks)

    for ok, mins in results:
        if ok and mins > 0:
            successes += 1
            total_minutes += mins
        elif not ok:
            failures += 1

    cost_per_hour = COST_PER_HOUR_EU if "eu-api" in endpoint else COST_PER_HOUR_NON_EU
    cost = (total_minutes / 60) * cost_per_hour

    print(f"\nSummary")
    print(f"  Submitted:  {successes} episodes")
    print(f"  Failed:     {failures} episodes")
    print(f"  Audio time: {total_minutes / 60:.1f} hours ({total_minutes:.0f} min)")
    print(f"  Est. cost:  ${cost:.2f} (at ${cost_per_hour:.4f}/hour)")


def main() -> None:
    parser = argparse.ArgumentParser(description="Transcribe podcast episodes via Lemonfox.ai")
    parser.add_argument("--limit", type=int, default=None, help="Process at most N episodes")
    parser.add_argument("--episode-id", help="Process a single episode by ID")
    parser.add_argument("--concurrency", type=int, default=5, help="Max concurrent requests")
    parser.add_argument("--oldest-first", action="store_true", help="Process oldest episodes first")
    parser.add_argument("--non-eu", action="store_true", help="Use non-EU endpoint (cheaper, non-GDPR)")
    parser.add_argument("--no-speaker-labels", action="store_true", help="Disable diarization (lower cost, no speaker separation)")
    args = parser.parse_args()

    api_key = os.environ.get("LEMONFOX_APIKEY")
    if not api_key:
        print("ERROR: LEMONFOX_APIKEY environment variable is not set.", file=sys.stderr)
        sys.exit(1)

    if not META_FILE.exists():
        print(f"ERROR: {META_FILE} not found. Run scripts/rss_fetch.py first.", file=sys.stderr)
        sys.exit(1)

    with open(META_FILE, encoding="utf-8") as f:
        episodes = json.load(f)

    if args.episode_id:
        episodes = [ep for ep in episodes if ep["id"] == args.episode_id]
        if not episodes:
            print(f"ERROR: Episode ID '{args.episode_id}' not found in episodes_meta.json.", file=sys.stderr)
            sys.exit(1)
    else:
        if args.oldest_first:
            episodes = list(reversed(episodes))
        if args.limit:
            pending = [
                ep for ep in episodes
                if not (TRANSCRIPTS_DIR / f"{ep['id']}.json.gz").exists()
                and not (TRANSCRIPTS_DIR / f"{ep['id']}.json").exists()
            ]
            episodes = pending[: args.limit]

    endpoint = NON_EU_ENDPOINT if args.non_eu else EU_ENDPOINT
    region = "non-EU" if args.non_eu else "EU"
    speaker_labels = not args.no_speaker_labels

    n_already_done = sum(
        1 for ep in episodes
        if (TRANSCRIPTS_DIR / f"{ep['id']}.json.gz").exists()
        or (TRANSCRIPTS_DIR / f"{ep['id']}.json").exists()
    )
    n_pending = len(episodes) - n_already_done

    print(f"Transcription run")
    print(f"  Endpoint:      {endpoint} ({region})")
    print(f"  Speaker labels: {'yes' if speaker_labels else 'no'}")
    print(f"  Concurrency:   {args.concurrency}")
    print(f"  Episodes:      {len(episodes)} total ({n_pending} pending, {n_already_done} already done)")
    print()

    asyncio.run(run(episodes, api_key, endpoint, args.concurrency, speaker_labels))


if __name__ == "__main__":
    main()
