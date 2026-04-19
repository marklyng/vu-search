"""
build_site.py — Build docs/data/ from data/episodes_meta.json + data/transcripts/.

For each episode:
- Reads metadata from episodes_meta.json
- Optionally reads data/transcripts/{id}.json for full transcript text
- Tokenises title (weight 3) + description (weight 2) + transcript (weight 1)
- Builds an inverted index: { token -> [ep_id, ...] }
- Writes:
    docs/data/search_index.json  — inverted index + per-episode meta/snippet
    docs/data/index.json         — slim episode registry (for display, no index)
    docs/data/episodes/{id}.json — full episode data (fetched on demand)

Usage:
    python scripts/build_site.py

Exits 0. Prints a summary with index size.
"""

import gzip
import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"
TRANSCRIPTS_DIR = DATA_DIR / "transcripts"
SEGMENTS_DIR = DATA_DIR / "segments"
DOCS_DATA_DIR = Path(__file__).parent.parent / "docs" / "data"
EPISODES_DIR = DOCS_DATA_DIR / "episodes"

META_FILE = DATA_DIR / "episodes_meta.json"
INDEX_FILE = DOCS_DATA_DIR / "index.json"
SEARCH_INDEX_FILE = DOCS_DATA_DIR / "search_index.json"
EPISODE_META_FILE = DOCS_DATA_DIR / "meta.json"

SNIPPET_LENGTH = 200  # characters for snippet in search results

# Danish stopwords — common words that add noise without search value
DANISH_STOPWORDS = {
    "af", "og", "i", "er", "til", "det", "en", "at", "de", "den",
    "med", "for", "på", "som", "et", "vi", "han", "hun", "men",
    "ikke", "der", "fra", "om", "var", "kan", "har", "sig", "så",
    "vil", "denne", "dette", "disse", "eller", "også", "ud", "ind",
    "over", "under", "efter", "da", "nu", "her", "sin", "sit",
    "hvad", "når", "hvis", "dem", "os", "jeg", "du", "man", "mere",
    "meget", "jo", "bare", "godt", "alt", "alle", "ingen", "anden",
    "andre", "vores", "deres", "hvert", "meget", "se", "lad", "få",
    "kom", "gå", "sige", "blive", "være", "have", "gøre", "tage",
}


def tokenise(text: str) -> list[str]:
    """
    Lowercase, keep only letters (including Danish æøå), split on non-letter chars.
    Returns a list of tokens, stopwords filtered out.
    """
    text = text.lower()
    tokens = re.findall(r"[a-zæøåA-ZÆØÅ]{2,}", text)
    return [t for t in tokens if t not in DANISH_STOPWORDS]


def make_snippet(description: str, transcript: str | None, length: int = SNIPPET_LENGTH) -> str:
    """Pick the best snippet: prefer description if substantial, else start of transcript."""
    if description and len(description) > 40:
        return description[:length].rstrip()
    if transcript:
        return transcript[:length].rstrip()
    return ""


def short_id(full_id: str) -> str:
    """Use first 16 chars of the Acast GUID as the short key in the index."""
    return full_id[:16]


def load_transcript(ep_id: str) -> str | None:
    """Load transcript text for an episode, or return None if not available."""
    gz_path = TRANSCRIPTS_DIR / f"{ep_id}.json.gz"
    json_path = TRANSCRIPTS_DIR / f"{ep_id}.json"
    try:
        if gz_path.exists():
            data = json.loads(gzip.decompress(gz_path.read_bytes()).decode("utf-8"))
        elif json_path.exists():
            data = json.loads(json_path.read_text(encoding="utf-8"))
        else:
            return None
        return data.get("text") or None
    except (json.JSONDecodeError, OSError) as e:
        print(f"  WARNING: Could not read transcript for {ep_id}: {e}", file=sys.stderr)
        return None


def load_segments(ep_id: str) -> dict | None:
    """Load extracted segments (dyrfakt, listener_question) for an episode."""
    path = SEGMENTS_DIR / f"{ep_id}.json"
    if not path.exists():
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        print(f"  WARNING: Could not read segments for {ep_id}: {e}", file=sys.stderr)
        return None


def build(episodes: list[dict]) -> tuple[dict, list[dict]]:
    """
    Build inverted index and slim registry.

    Returns:
        search_index: { "index": {token: [sid, ...]}, "meta": {sid: {...}} }
        registry: list of slim episode dicts for index.json
    """
    # posting_lists[token] = list of (sid, score) tuples
    scores: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    meta: dict[str, dict] = {}
    registry: list[dict] = []

    for ep in episodes:
        ep_id = ep["id"]
        sid = short_id(ep_id)
        title = ep.get("title") or ""
        description = ep.get("description") or ""
        transcript = load_transcript(ep_id)
        has_transcript = transcript is not None
        segments = load_segments(ep_id)

        # Tokenise each field with its weight
        for token in tokenise(title):
            scores[token][sid] += 3.0
        for token in tokenise(description):
            scores[token][sid] += 2.0
        if transcript:
            for token in tokenise(transcript):
                scores[token][sid] += 1.0
        if segments:
            for token in tokenise(segments.get("dyrfakt") or ""):
                scores[token][sid] += 4.0
            for token in tokenise(segments.get("listener_question") or ""):
                scores[token][sid] += 3.0

        snippet = make_snippet(description, transcript)

        meta[sid] = {
            "id": ep_id,
            "title": title,
            "date": ep.get("date") or "",
            "snippet": snippet,
            "has_transcript": has_transcript,
            "dyrfakt": segments.get("dyrfakt") if segments else None,
            "listener_question": segments.get("listener_question") if segments else None,
            "image_url": ep.get("image_url") or "",
        }

        registry.append({
            "id": ep_id,
            "title": title,
            "date": ep.get("date") or "",
            "duration": ep.get("duration") or "",
            "episode_number": ep.get("episode_number"),
            "has_transcript": has_transcript,
            "image_url": ep.get("image_url") or "",
        })

    # Convert scores to sorted posting lists (highest score first within each token)
    index: dict[str, list[str]] = {}
    for token, sid_scores in scores.items():
        sorted_sids = sorted(sid_scores, key=lambda s: sid_scores[s], reverse=True)
        index[token] = sorted_sids

    search_index = {"index": index, "meta": meta}
    return search_index, meta, registry


def write_episode_files(episodes: list[dict]) -> None:
    """Write one docs/data/episodes/{id}.json per episode."""
    EPISODES_DIR.mkdir(parents=True, exist_ok=True)
    for ep in episodes:
        ep_id = ep["id"]
        transcript = load_transcript(ep_id)
        segments = load_segments(ep_id)
        out = {
            "id": ep_id,
            "title": ep.get("title") or "",
            "date": ep.get("date") or "",
            "audio_url": ep.get("audio_url") or "",
            "episode_url": ep.get("episode_url") or "",
            "description": ep.get("description") or "",
            "duration": ep.get("duration") or "",
            "episode_number": ep.get("episode_number"),
            "image_url": ep.get("image_url") or "",
            "transcript": transcript,
            "dyrfakt": segments.get("dyrfakt") if segments else None,
            "listener_question": segments.get("listener_question") if segments else None,
        }
        path = EPISODES_DIR / f"{ep_id}.json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, separators=(",", ":"))


def main():
    if not META_FILE.exists():
        print(f"ERROR: {META_FILE} not found. Run scripts/rss_fetch.py first.", file=sys.stderr)
        sys.exit(1)

    with open(META_FILE, encoding="utf-8") as f:
        episodes = json.load(f)

    if not episodes:
        print("ERROR: No episodes found in episodes_meta.json.", file=sys.stderr)
        sys.exit(1)

    print(f"Building site data for {len(episodes)} episodes...")

    DOCS_DATA_DIR.mkdir(parents=True, exist_ok=True)

    print("  Writing episode files...")
    write_episode_files(episodes)

    print("  Building search index...")
    search_index, episode_meta, registry = build(episodes)

    print("  Writing search_index.json...")
    with open(SEARCH_INDEX_FILE, "w", encoding="utf-8") as f:
        json.dump(search_index["index"], f, ensure_ascii=False, separators=(",", ":"))

    print("  Writing meta.json...")
    with open(EPISODE_META_FILE, "w", encoding="utf-8") as f:
        json.dump(episode_meta, f, ensure_ascii=False, separators=(",", ":"))

    print("  Writing index.json...")
    with open(INDEX_FILE, "w", encoding="utf-8") as f:
        json.dump(registry, f, ensure_ascii=False, separators=(",", ":"))

    # Report
    n_with_transcript = sum(1 for ep in episodes if load_transcript(ep["id"]) is not None)
    n_with_segments = sum(1 for ep in episodes if load_segments(ep["id"]) is not None)
    index_size_kb = SEARCH_INDEX_FILE.stat().st_size / 1024
    meta_size_kb = EPISODE_META_FILE.stat().st_size / 1024
    ep_dir_size_kb = sum(
        f.stat().st_size for f in EPISODES_DIR.iterdir() if f.is_file()
    ) / 1024

    print(f"\nDone.")
    print(f"  {len(episodes)} episodes total")
    print(f"  {n_with_transcript} with transcripts ({len(episodes) - n_with_transcript} description-only)")
    print(f"  {n_with_segments} with segments (dyrfakt/lytterspørgsmål extracted)")
    print(f"  search_index.json: {index_size_kb:.1f} KB")
    print(f"  meta.json:         {meta_size_kb:.1f} KB")
    print(f"  episodes/ dir:     {ep_dir_size_kb:.1f} KB total")
    print(f"  Unique tokens in index: {len(search_index['index'])}")


if __name__ == "__main__":
    main()
