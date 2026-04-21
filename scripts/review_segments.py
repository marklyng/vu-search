"""
review_segments.py — Review and quality-score all extracted segment JSONs.

For each segment in data/segments/, sends the dyrfakt and listener_question to
Claude for language review. Corrects typos, transcription artifacts, and grammar
issues, then assigns a certainty score (0–100) reflecting confidence that the
content is accurate, complete, and natural Danish.

Updates segment JSONs in-place with corrected fields + a `certainty` field.
At the end, prints every segment with certainty < 90 for manual review.

Usage:
    python scripts/review_segments.py              # all unreviewed segments
    python scripts/review_segments.py --limit 10   # first N unreviewed
    python scripts/review_segments.py --episode-id <id>
    python scripts/review_segments.py --re-review  # re-review already-scored segments

Requires:
    ANTHROPIC_API_KEY environment variable
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Optional

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import anthropic
from pydantic import BaseModel, ValidationError

_env_file = Path(__file__).parent.parent / ".env"
if _env_file.exists():
    for _line in _env_file.read_text(encoding="utf-8").splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _, _v = _line.partition("=")
            if not os.environ.get(_k.strip()):
                os.environ[_k.strip()] = _v.strip()

DATA_DIR = Path(__file__).parent.parent / "data"
SEGMENTS_DIR = DATA_DIR / "segments"
META_FILE = DATA_DIR / "episodes_meta.json"

MODEL = "claude-sonnet-4-6"

SYSTEM_PROMPT = """\
You are a Danish language editor reviewing extracted segments from the podcast
"Videnskabeligt Udfordret" — a comedy-science podcast hosted by Mark and Flemming.

The segments were extracted from automatic speech recognition (Whisper) transcripts
and may contain residual transcription errors that the extraction model missed:
misspelled words, phonetic substitutions, garbled names, truncated sentences, or
words run together.

Your task for each segment:

1. DYRFAKT — Correct any remaining errors. The dyrfakt should be a single clean
   Danish sentence or two describing an animal fact. Fix typos, wrong word choices,
   garbled proper nouns, and unnatural phrasing. If the text is clearly truncated
   (ends mid-sentence), mark it as low certainty but do not invent content.
   Return null if the input is null.

2. LYTTERSPØRGSMÅL — Correct any remaining errors. This should read as a natural
   Danish question or topic. Fix the same categories of errors.
   Return null if the input is null.

3. CERTAINTY — An integer 0–100 reflecting your confidence that BOTH fields are
   now accurate, complete, and natural Danish. Consider:
   - 95–100: Clearly correct, natural phrasing, no doubts
   - 85–94: Minor uncertainties (unusual proper noun, slightly odd phrasing)
   - 70–84: Notable issues — possible truncation, dubious animal name, awkward Danish
   - Below 70: Significant problems — incoherent content, likely wrong extraction,
     major transcription artifacts remaining

   If both fields are null, return certainty 100 (nothing to be wrong).

4. NOTES — Optional. One short sentence explaining any issue that lowered certainty
   below 95, or any correction you made. Omit if everything was clean.

Return JSON only, no explanation."""


class SegmentReview(BaseModel):
    dyrfakt: Optional[str]
    listener_question: Optional[str]
    certainty: int
    notes: Optional[str]


def review_segment(client: anthropic.Anthropic, seg: dict) -> SegmentReview | None:
    dy = seg.get("dyrfakt")
    lq = seg.get("listener_question")

    user_parts = []
    if dy is not None:
        user_parts.append(f"DYRFAKT:\n{dy}")
    else:
        user_parts.append("DYRFAKT: null")
    if lq is not None:
        user_parts.append(f"LYTTERSPØRGSMÅL:\n{lq}")
    else:
        user_parts.append("LYTTERSPØRGSMÅL: null")

    user_message = "\n\n".join(user_parts)

    try:
        response = client.messages.parse(
            model=MODEL,
            max_tokens=1024,
            system=[{
                "type": "text",
                "text": SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }],
            messages=[{"role": "user", "content": user_message}],
            output_format=SegmentReview,
        )
        return response.parsed_output
    except (anthropic.APIError, ValidationError) as e:
        print(f"  ERROR: {type(e).__name__}: {e}", file=sys.stderr)
        return None


def main() -> None:
    parser = argparse.ArgumentParser(description="Review and quality-score segment JSONs")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--episode-id", help="Review a single episode by ID")
    parser.add_argument("--re-review", action="store_true",
                        help="Re-review segments that already have a certainty score")
    args = parser.parse_args()

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("ERROR: ANTHROPIC_API_KEY not set.", file=sys.stderr)
        sys.exit(1)

    seg_files = sorted(SEGMENTS_DIR.glob("*.json"))

    if args.episode_id:
        seg_files = [SEGMENTS_DIR / f"{args.episode_id}.json"]
        if not seg_files[0].exists():
            print(f"ERROR: {seg_files[0]} not found.", file=sys.stderr)
            sys.exit(1)
    elif not args.re_review:
        seg_files = [f for f in seg_files if "certainty" not in
                     json.loads(f.read_text(encoding="utf-8"))]

    if args.limit:
        seg_files = seg_files[: args.limit]

    print(f"Segment review")
    print(f"  Model:    {MODEL}")
    print(f"  Segments: {len(seg_files)} to review")
    print()

    if not seg_files:
        print("Nothing to do.")
        _print_flagged()
        return

    client = anthropic.Anthropic(api_key=api_key)
    done = errors = 0

    for seg_path in seg_files:
        seg = json.loads(seg_path.read_text(encoding="utf-8"))
        title = seg.get("episode_title", seg_path.stem)[:55]
        print(f"  {title}")

        result = review_segment(client, seg)
        if result is None:
            errors += 1
            time.sleep(1.5)
            continue

        # Update fields — only overwrite if Claude returned a non-null value
        # (preserves existing nulls when both inputs were null)
        if result.dyrfakt is not None or seg.get("dyrfakt") is not None:
            seg["dyrfakt"] = result.dyrfakt
        if result.listener_question is not None or seg.get("listener_question") is not None:
            seg["listener_question"] = result.listener_question
        seg["certainty"] = result.certainty
        if result.notes:
            seg["review_notes"] = result.notes
        elif "review_notes" in seg:
            del seg["review_notes"]

        seg_path.write_text(json.dumps(seg, ensure_ascii=False, indent=2), encoding="utf-8")
        flag = f" *** CERTAINTY {result.certainty}" if result.certainty < 90 else ""
        print(f"    certainty={result.certainty}{flag}"
              + (f" — {result.notes}" if result.notes else ""))
        done += 1
        time.sleep(1.5)

    print(f"\nDone: {done} reviewed, {errors} errors")
    _print_flagged()


def _print_flagged() -> None:
    flagged = []
    for seg_path in sorted(SEGMENTS_DIR.glob("*.json")):
        seg = json.loads(seg_path.read_text(encoding="utf-8"))
        c = seg.get("certainty")
        if c is not None and c < 90:
            flagged.append(seg)

    if not flagged:
        print("\nNo segments flagged (all certainty >= 90).")
        return

    print(f"\n{'='*70}")
    print(f"FLAGGED SEGMENTS — certainty < 90 ({len(flagged)} total)")
    print(f"{'='*70}\n")

    for seg in sorted(flagged, key=lambda s: s.get("certainty", 0)):
        c = seg.get("certainty", "?")
        title = seg.get("episode_title", seg.get("episode_id", "?"))
        print(f"[{c:3}] {title}")
        if seg.get("dyrfakt"):
            print(f"      DYRFAKT:  {seg['dyrfakt']}")
        if seg.get("listener_question"):
            print(f"      LYTTER:   {seg['listener_question']}")
        if seg.get("review_notes"):
            print(f"      NOTE:     {seg['review_notes']}")
        print()


if __name__ == "__main__":
    main()
