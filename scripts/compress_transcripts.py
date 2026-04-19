"""
compress_transcripts.py — Compress existing .json transcripts to .json.gz.

Run once after migrating to gzip storage. Compresses all .json files in
data/transcripts/ and deletes the originals.

Usage:
    python scripts/compress_transcripts.py
    python scripts/compress_transcripts.py --dry-run
"""

import argparse
import gzip
from pathlib import Path

TRANSCRIPTS_DIR = Path(__file__).parent.parent / "data" / "transcripts"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Show what would be done without doing it")
    args = parser.parse_args()

    files = sorted(TRANSCRIPTS_DIR.glob("*.json"))
    if not files:
        print("No .json files found.")
        return

    total_before = total_after = 0
    for path in files:
        gz_path = path.with_suffix(".json.gz")
        raw = path.read_bytes()
        compressed = gzip.compress(raw, compresslevel=9)
        ratio = 100 * len(compressed) / len(raw)
        print(f"  {path.name}: {len(raw)//1024}KB -> {len(compressed)//1024}KB ({ratio:.0f}%)")
        total_before += len(raw)
        total_after += len(compressed)
        if not args.dry_run:
            gz_path.write_bytes(compressed)
            # Verify the written file round-trips before deleting the original
            import json
            verified = json.loads(gzip.decompress(gz_path.read_bytes()).decode("utf-8"))
            assert verified.get("text"), f"Verification failed for {path.name} — original kept"
            path.unlink()

    print(f"\nTotal: {total_before//1024//1024}MB -> {total_after//1024//1024}MB "
          f"({100*total_after/total_before:.0f}% of original)")
    if args.dry_run:
        print("Dry run — no files changed.")


if __name__ == "__main__":
    main()
