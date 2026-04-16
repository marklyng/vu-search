"""
rss_fetch.py — Fetch RSS feed and update data/episodes_meta.json.

Fetches https://feeds.acast.com/public/shows/videnskabeligt-udfordret, parses all
episodes, strips HTML and promotional boilerplate from descriptions, and merges new
episodes into data/episodes_meta.json without overwriting existing entries.

Usage:
    python scripts/rss_fetch.py
    python scripts/rss_fetch.py --rss-url https://feeds.acast.com/public/shows/...

Output:
    data/episodes_meta.json  — updated in place
    Exits 0 always; prints summary to stdout.
"""

import argparse
import json
import re
import sys
from pathlib import Path

import feedparser
from bs4 import BeautifulSoup

RSS_URL = "https://feeds.acast.com/public/shows/videnskabeligt-udfordret"
DATA_DIR = Path(__file__).parent.parent / "data"
OUTPUT_FILE = DATA_DIR / "episodes_meta.json"

# Boilerplate phrases that mark the start of the standard promotional block.
# Everything from the first matching phrase onwards is stripped.
BOILERPLATE_MARKERS = [
    # Current era (episodes ~#100+)
    "Hvis du vil være med til at optage",
    "Støt os på",
    "støt os på",
    "Du kan også tjekke vores webshop",
    "Send os vanvittig videnskab",
    "Husk at være dumme",
    # Sources section (all eras)
    "Kilder:",
    "Kilder\xa0:",   # Non-breaking space variant
    "Kilder ",
    # Era ~#001–#050: early Videnskabeligt Udfordret / Buzzsprout
    "Skulle du have lyst til at støtte",
    "Det koster penge, men til gengæld",
    # Season 3 (Spækbrættet era)
    "Støt Spækbrættet på",
    "bit.ly/spæk",
    "Send os water hilarious science",
    # Season 1–2 (oldest era)
    "Musical credit",
    "Giv os fem stjerner på iTunes",
    "Køb vores merch",
    "Køb nogen penge til os",
    # Hosting footers
    "Support the show",
    "Hosted on Acast",
]


def strip_html(html: str) -> str:
    """Remove HTML tags and decode entities."""
    soup = BeautifulSoup(html, "html.parser")
    return soup.get_text(separator=" ", strip=True)


def strip_boilerplate(text: str) -> str:
    """
    Remove boilerplate that appears at the end of descriptions.
    Finds whichever marker appears EARLIEST in the text (not earliest in the list)
    and strips from that position onwards.
    """
    earliest_idx = len(text)
    for marker in BOILERPLATE_MARKERS:
        idx = text.find(marker)
        if idx != -1 and idx < earliest_idx:
            earliest_idx = idx
    if earliest_idx < len(text):
        text = text[:earliest_idx].strip()
    return text


def strip_source_urls(text: str) -> str:
    """Remove bare URLs from the text (standalone http/https links)."""
    # Remove lines that are purely URLs
    lines = text.splitlines()
    cleaned = [l for l in lines if not re.match(r"^\s*https?://\S+\s*$", l)]
    text = "\n".join(cleaned).strip()
    # Also strip space-separated inline URLs (from BeautifulSoup joining <p> tags)
    text = re.sub(r"\s+https?://\S+", "", text)
    return text.strip()


def clean_description(raw_html: str) -> str:
    """Full cleaning pipeline for RSS description field."""
    text = strip_html(raw_html)
    text = strip_boilerplate(text)
    text = strip_source_urls(text)
    # Collapse whitespace
    text = re.sub(r"\s+", " ", text).strip()
    return text


def parse_date(date_str: str) -> str:
    """Convert RSS pubDate to YYYY-MM-DD."""
    import email.utils
    try:
        parsed = email.utils.parsedate_to_datetime(date_str)
        return parsed.strftime("%Y-%m-%d")
    except Exception:
        return date_str[:10] if date_str else ""


def extract_episode_number(title: str) -> int | None:
    """Extract episode number from title like '#259: ...' or 'Episode 12: ...'."""
    m = re.match(r"#(\d+)", title)
    if m:
        return int(m.group(1))
    m = re.match(r"Episode\s+(\d+)", title, re.IGNORECASE)
    if m:
        return int(m.group(1))
    return None


def load_existing(path: Path) -> dict:
    """Load existing episodes_meta.json as a dict keyed by episode ID."""
    if not path.exists():
        return {}
    with open(path, encoding="utf-8") as f:
        episodes = json.load(f)
    return {ep["id"]: ep for ep in episodes}


def save(path: Path, episodes_by_id: dict) -> None:
    """Save episodes sorted by episode_number descending (newest first)."""
    episodes = list(episodes_by_id.values())
    episodes.sort(key=lambda e: e.get("episode_number") or 0, reverse=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(episodes, f, ensure_ascii=False, indent=2)


def fetch_feed(url: str) -> feedparser.FeedParserDict:
    print(f"Fetching {url} ...")
    feed = feedparser.parse(url)
    if feed.bozo and not feed.entries:
        print(f"ERROR: Failed to parse feed: {feed.bozo_exception}", file=sys.stderr)
        sys.exit(1)
    return feed


def main():
    parser = argparse.ArgumentParser(description="Fetch podcast RSS and update episode metadata.")
    parser.add_argument("--rss-url", default=RSS_URL, help="RSS feed URL")
    args = parser.parse_args()

    existing = load_existing(OUTPUT_FILE)
    feed = fetch_feed(args.rss_url)

    new_count = 0
    for entry in feed.entries:
        ep_id = entry.get("id") or entry.get("guid") or entry.get("link")
        if not ep_id:
            continue

        # Episode-level artwork; fall back to feed-level channel art
        image_url = (entry.get("image") or {}).get("href", "")
        if not image_url:
            image_url = (feed.feed.get("image") or {}).get("href", "")

        if ep_id in existing:
            if not existing[ep_id].get("image_url") and image_url:
                existing[ep_id]["image_url"] = image_url  # backfill missing field
            continue  # Already known — skip

        # Audio URL from enclosure
        audio_url = ""
        for enc in entry.get("enclosures", []):
            if enc.get("type", "").startswith("audio/"):
                audio_url = enc.get("href") or enc.get("url") or ""
                break

        # Duration
        duration = entry.get("itunes_duration") or ""

        # Description — prefer itunes:summary, fall back to description
        raw_desc = (
            entry.get("summary") or
            entry.get("description") or
            ""
        )
        description = clean_description(raw_desc)

        title = entry.get("title") or ""
        date = parse_date(entry.get("published") or "")
        episode_url = entry.get("link") or ""
        episode_number = extract_episode_number(title)

        existing[ep_id] = {
            "id": ep_id,
            "title": title,
            "date": date,
            "audio_url": audio_url,
            "episode_url": episode_url,
            "description": description,
            "duration": duration,
            "episode_number": episode_number,
            "image_url": image_url,
        }
        new_count += 1

    save(OUTPUT_FILE, existing)

    total = len(existing)
    print(f"Done. {new_count} new episodes added. {total} total episodes in {OUTPUT_FILE}.")


if __name__ == "__main__":
    main()
