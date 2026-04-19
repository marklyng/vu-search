# Videnskabeligt Udfordret — Podcast Search

Static, fully automated search site for [Videnskabeligt Udfordret](https://videnskabeligtudfordret.dk).

**Live site**: [soeg.videnskabeligtudfordret.dk](https://soeg.videnskabeligtudfordret.dk)  
**Updates**: bi-weekly via GitHub Actions (every other Tuesday at 01:00 UTC)

---

## How it works

```
RSS feed ──► rss_fetch.py ──► data/episodes_meta.json
                                       │
              data/transcripts/ ───────┤
              data/segments/    ───────┤
                                       ▼
                            build_site.py ──► docs/data/
                                                  ├── search_index.json  (token → episode map)
                                                  ├── meta.json          (per-episode metadata)
                                                  ├── index.json         (slim episode list)
                                                  └── episodes/{id}.json (full episode data)
```

The site searches across:
- **Episode title** (weight 3×)
- **Episode description** from RSS (weight 2×)
- **Dyrefact** — animal fact segment (weight 4×)
- **Lytterspørgsmål** — listener question segment (weight 3×)
- **Full transcript** (weight 1×, when available)

Search is entirely client-side. The inverted index is split into two files loaded in parallel:
`search_index.json` (~945 KB gzipped) holds the token map; `meta.json` (~64 KB gzipped) holds
episode metadata and renders immediately on load.

---

## Setup

### 1. Install Python dependencies

```bash
pip install -r requirements.txt
```

### 2. Fetch all episodes from RSS

```bash
python scripts/rss_fetch.py
```

Writes `data/episodes_meta.json` with all 400+ episodes.

### 3. Transcribe episodes (optional but recommended)

Requires a [Lemonfox.ai](https://lemonfox.ai) API key in `.env` as `LEMONFOX_APIKEY`.

```bash
# Full backlog (newest-first, ~9 hours wall-clock at 5 concurrent)
python scripts/transcribe.py --no-speaker-labels

# Test a single episode first
python scripts/transcribe.py --episode-id <id> --no-speaker-labels

# Limit to N new episodes (used by CI)
python scripts/transcribe.py --limit 5 --no-speaker-labels
```

Transcripts are stored as gzip-compressed JSON in `data/transcripts/{id}.json.gz`.
The script is resume-safe — already-transcribed episodes are skipped.

After transcribing a large batch, compress any remaining uncompressed files:

```bash
python scripts/compress_transcripts.py
```

### 4. Extract Dyrefact and Lytterspørgsmål segments

Requires an Anthropic API key in `.env` as `ANTHROPIC_API_KEY`.

```bash
python scripts/extract_segments.py          # all pending episodes
python scripts/extract_segments.py --limit 5
python scripts/extract_segments.py --episode-id <id>
```

Uses `claude-haiku-4-5` with prompt caching. Rate-limited to 40 req/min (1.5 s delay between calls).
Results are written to `data/segments/{id}.json`.

### 5. Build the site

```bash
python scripts/build_site.py
```

Generates everything under `docs/data/`. The site is now functional.

### 6. Open locally

```bash
cd docs && python -m http.server 8000
```

Then open `http://localhost:8000`. (`file://` won't work due to browser `fetch()` restrictions.)

---

## Automated updates (GitHub Actions)

The workflow in `.github/workflows/update.yml` runs bi-weekly (every other Tuesday at 01:00 UTC) and:

1. Fetches the RSS feed for new episodes
2. Transcribes up to 5 new episodes (requires `LEMONFOX_APIKEY` secret)
3. Extracts segments from up to 5 new transcripts (requires `ANTHROPIC_API_KEY` secret)
4. Rebuilds `docs/data/`
5. Commits and pushes any changes

**Manual trigger**: Actions → "Update podcast index" → "Run workflow".

**Transcript push trigger**: pushing any file to `data/transcripts/**` also fires the workflow,
which re-extracts segments and rebuilds the site.

### Required GitHub secrets

| Secret | Purpose |
|---|---|
| `LEMONFOX_APIKEY` | Transcription via Lemonfox.ai EU endpoint |
| `ANTHROPIC_API_KEY` | Segment extraction via Claude Haiku |

---

## File structure

```
/vu_search
  /.github/workflows/
    update.yml                  # Bi-weekly CI pipeline
  /scripts/
    rss_fetch.py                # Fetch RSS → data/episodes_meta.json
    transcribe.py               # Transcribe audio → data/transcripts/{id}.json.gz
    compress_transcripts.py     # Migrate .json → .json.gz (one-off)
    extract_segments.py         # Extract dyrefact/lytterspørgsmål → data/segments/{id}.json
    build_site.py               # Build docs/data/ from all sources
    validate.py                 # Coverage report and sanity checks
  /data/
    episodes_meta.json          # RSS-derived episode list (committed)
    /transcripts/               # {id}.json.gz compressed transcript files
    /segments/                  # {id}.json extracted segment files
  /docs/                        # GitHub Pages root
    index.html
    app.js
    style.css
    /data/
      search_index.json         # Token → episode inverted index
      meta.json                 # Per-episode metadata (title, snippet, dyrefact, etc.)
      index.json                # Slim episode list for browse view
      /episodes/                # Full episode JSON (fetched on demand)
  requirements.txt
  .gitignore
  README.md
```

---

## Validation

```bash
python scripts/validate.py
```

Reports transcript and segment coverage, checks for missing or corrupted files.
