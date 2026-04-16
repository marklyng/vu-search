"""
validate.py — Sanity checks on the generated site data.

Checks:
- Every episode in episodes_meta.json has a corresponding docs/data/episodes/{id}.json
- Every episode file is valid JSON with required fields
- Reports transcript coverage
- Flags any corrupted transcript files in data/transcripts/

Usage:
    python scripts/validate.py

Exits 0 if no errors, 1 if any errors found.
"""

import json
import sys
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"
TRANSCRIPTS_DIR = DATA_DIR / "transcripts"
DOCS_DATA_DIR = Path(__file__).parent.parent / "docs" / "data"
EPISODES_DIR = DOCS_DATA_DIR / "episodes"
META_FILE = DATA_DIR / "episodes_meta.json"

REQUIRED_EPISODE_FIELDS = {"id", "title", "date"}


def main():
    errors: list[str] = []
    warnings: list[str] = []

    # Load episodes_meta.json
    if not META_FILE.exists():
        print(f"ERROR: {META_FILE} not found. Run rss_fetch.py first.")
        sys.exit(1)

    with open(META_FILE, encoding="utf-8") as f:
        try:
            episodes = json.load(f)
        except json.JSONDecodeError as e:
            print(f"ERROR: {META_FILE} is invalid JSON: {e}")
            sys.exit(1)

    print(f"Validating {len(episodes)} episodes...")

    # Check each episode has a generated file
    for ep in episodes:
        ep_id = ep.get("id")
        if not ep_id:
            errors.append(f"  Episode missing 'id' field: {ep}")
            continue

        ep_file = EPISODES_DIR / f"{ep_id}.json"
        if not ep_file.exists():
            errors.append(f"  Missing generated file: docs/data/episodes/{ep_id}.json")
            continue

        # Validate the generated episode file
        try:
            with open(ep_file, encoding="utf-8") as f:
                data = json.load(f)
            missing = REQUIRED_EPISODE_FIELDS - set(data.keys())
            if missing:
                errors.append(f"  {ep_id}: missing fields {missing} in generated file")
        except json.JSONDecodeError as e:
            errors.append(f"  {ep_id}: generated file is invalid JSON: {e}")

    # Check transcript files for corruption
    if TRANSCRIPTS_DIR.exists():
        for tf in TRANSCRIPTS_DIR.glob("*.json"):
            try:
                with open(tf, encoding="utf-8") as f:
                    data = json.load(f)
                if "text" not in data:
                    warnings.append(f"  Transcript {tf.name} missing 'text' field")
                elif not data["text"] or len(data["text"]) < 10:
                    warnings.append(f"  Transcript {tf.name} has suspiciously short text")
            except json.JSONDecodeError as e:
                errors.append(f"  Transcript {tf.name} is invalid JSON: {e}")

    # Check search_index.json exists
    search_index_file = DOCS_DATA_DIR / "search_index.json"
    if not search_index_file.exists():
        errors.append("  Missing docs/data/search_index.json. Run build_site.py.")
    else:
        try:
            with open(search_index_file, encoding="utf-8") as f:
                si = json.load(f)
            if "index" not in si or "meta" not in si:
                errors.append("  search_index.json missing 'index' or 'meta' key")
        except json.JSONDecodeError as e:
            errors.append(f"  search_index.json is invalid JSON: {e}")

    # Summary
    n_with_transcript = sum(
        1 for ep in episodes
        if (TRANSCRIPTS_DIR / f"{ep['id']}.json").exists()
    ) if TRANSCRIPTS_DIR.exists() else 0

    coverage_pct = (n_with_transcript / len(episodes) * 100) if episodes else 0

    print(f"\nTranscript coverage: {n_with_transcript}/{len(episodes)} episodes ({coverage_pct:.0f}%)")

    if warnings:
        print(f"\n{len(warnings)} warning(s):")
        for w in warnings:
            print(w)

    if errors:
        print(f"\n{len(errors)} error(s):")
        for e in errors:
            print(e)
        sys.exit(1)
    else:
        print("\nAll checks passed.")
        sys.exit(0)


if __name__ == "__main__":
    main()
