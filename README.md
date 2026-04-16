# Videnskabeligt Udfordret — Podcast Search

Static, fully automated search site for [Videnskabeligt Udfordret](https://videnskabeligtudfordret.dk).

**Live site**: served from `docs/` via GitHub Pages.  
**Updates**: runs automatically every Monday via GitHub Actions.

---

## How it works

```
RSS feed ──► rss_fetch.py ──► data/episodes_meta.json
                                       │
              data/transcripts/ ───────┤
                                       ▼
                            build_site.py ──► docs/data/
                                                  ├── search_index.json
                                                  ├── index.json
                                                  └── episodes/{id}.json
```

The site searches on:
- **Episode title** (strongest signal)
- **Episode description** from RSS (cleaned of boilerplate)
- **Full transcript** (when available — greatly improves recall)

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

This writes `data/episodes_meta.json` with all 400+ episodes.

### 3. Build the site data

```bash
python scripts/build_site.py
```

This generates everything in `docs/data/`. The site is now functional.

### 4. Open locally

Open `docs/index.html` in a browser. No server needed — it works as a local file.

> **Note**: fetching episode detail (`data/episodes/{id}.json`) requires a local
> HTTP server when running locally, due to browser fetch() restrictions on `file://`.
> Use `python -m http.server 8000` from `docs/` or the VS Code Live Server extension.

---

## Adding transcripts

Each transcript is a JSON file placed in `data/transcripts/`:

**Filename**: `data/transcripts/{episode_id}.json`  
**Episode ID**: the Acast GUID from `data/episodes_meta.json` (the `"id"` field)

**Format**:
```json
{
  "text": "Full transcript as plain text. Can be as long as needed."
}
```

After adding transcript files, run `build_site.py` (or push to GitHub to trigger the
automated workflow):

```bash
python scripts/build_site.py
```

---

## Finding episode IDs

```bash
# List all episode IDs and titles
python -c "
import json
episodes = json.load(open('data/episodes_meta.json'))
for ep in episodes:
    print(ep['id'], ep['title'])
"
```

Or open `data/episodes_meta.json` directly — it's sorted newest-first.

---

## Automated updates (GitHub Actions)

The workflow in `.github/workflows/update.yml` runs every Monday at 08:00 UTC and:
1. Fetches the RSS feed for new episodes
2. Rebuilds `docs/data/`
3. Commits and pushes any changes

**Trigger manually**: go to Actions → "Update podcast index" → "Run workflow".

**When you add transcripts**: push the files to GitHub. The workflow is also triggered
by any push to `data/transcripts/**`.

### GitHub Pages setup

1. Push this repo to GitHub
2. Go to Settings → Pages
3. Set source: **Deploy from a branch**, branch: `main`, folder: `/docs`
4. The site will be live at `https://{username}.github.io/{repo-name}/`

---

## Validation

```bash
python scripts/validate.py
```

Reports transcript coverage, checks for missing or corrupted files.

---

## File structure

```
/vu_search
  /.github/workflows/
    update.yml          # Automated weekly update
  /scripts/
    rss_fetch.py        # Fetch RSS → data/episodes_meta.json
    build_site.py       # Build docs/data/ from RSS + transcripts
    validate.py         # Sanity checks and coverage report
  /data/
    episodes_meta.json  # RSS-derived episode list (committed)
    /transcripts/       # {id}.json transcript files (you add these)
  /docs/                # GitHub Pages root
    index.html
    app.js
    style.css
    /data/
      index.json        # Slim episode list
      search_index.json # Inverted search index
      /episodes/        # Full episode data (generated)
  requirements.txt
  .gitignore
  README.md
```
