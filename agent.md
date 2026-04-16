# agent.md — Videnskabeligt Udfordret Episode Search

## Status

**MVP complete and working locally** (as of 2026-04-15).
Search is functional across all 400 episodes. Two remaining steps before public launch:
1. **CSS update** — match the visual style of https://videnskabeligtudfordret.dk/
2. **GitHub Pages deployment** — push to GitHub, enable Pages, verify the live site

---

## What is built

A fully static, zero-backend podcast search site for *Videnskabeligt Udfordret* (~400 episodes).

**Key design decisions made during implementation:**

| Decision | Chosen approach | Why |
|---|---|---|
| Search library | Custom inverted index (Python build, JS runtime) | Zero JS dependencies; predictable, auditable format; easily field-weighted |
| Deployment target | GitHub Pages (`docs/` folder on `main`) | No separate branch or Actions secrets needed |
| Search semantics | OR with scoring + tiered ranking | Better recall than strict AND; Danish compound words need fuzzy handling |
| Boilerplate stripping | Marker-based, earliest-in-text wins | Podcast has 4+ distinct promotional copy eras since ~2018 |

---

## Architecture

```
GitHub Actions (every Monday 08:00 UTC, or on push to data/transcripts/**)
  scripts/rss_fetch.py  →  data/episodes_meta.json  (committed)
  scripts/build_site.py →  docs/data/               (committed)
  git commit + push     →  GitHub Pages auto-serves docs/
```

User workflow for transcripts:
1. Generate transcript (any tool) → `{ "text": "..." }`
2. Save as `data/transcripts/{episode_id}.json`
3. `git push` → Actions rebuilds automatically

---

## File structure

```
/vu_search
  /.github/workflows/update.yml   # Scheduled automation
  /scripts/
    rss_fetch.py                  # RSS → data/episodes_meta.json
    build_site.py                 # Merge RSS + transcripts → docs/data/
    validate.py                   # Coverage report
  /data/
    episodes_meta.json            # 400 episodes, RSS-derived, committed
    /transcripts/                 # {id}.json — user adds these
  /docs/                          # GitHub Pages root
    index.html
    app.js
    style.css
    /data/
      index.json                  # Slim registry (id, title, date, has_transcript)
      search_index.json           # Inverted index: { token: [ep_ids] }
      /episodes/                  # {id}.json — fetched on demand
  requirements.txt
  agent.md
```

---

## Search implementation

Three-tier matching in `docs/app.js → getPostingList()`:

1. **Exact match** — direct `index[token]` lookup; score = `1/(rank+1)`
2. **Substring match** — find index keys containing the query token (handles Danish compound words like "kræft" → "tarmkræft"); score = `1/(extra_chars+1)`. Only for tokens ≥ 4 chars.
3. **Edit-distance match** — Levenshtein distance ≤ 2 (handles morphological variants like "vira"/"virus", typos, and query-longer-than-key); score = `1/(dist*3+1)`. Only for tokens ≥ 4 chars.

**Ranking:** OR semantics with scoring → 2× boost if all query tokens match → additive +100 if any token appears in episode title (creates a hard tier: title matches always beat description-only matches).

**Index build-time field weights:** title 3.0 × description 2.0 × transcript 1.0

---

## Search index size

| Source | Size |
|---|---|
| RSS only (400 episodes, current) | ~538 KB |
| With full transcripts (400 × ~70 min) | ~4–8 MB projected |

---

## Transcript format (contract for external transcription tools)

```json
{ "text": "Full plain text of the episode..." }
```

Filename: `data/transcripts/{episode_id}.json`
Episode IDs are the Acast GUIDs from `data/episodes_meta.json`.

---

## Python environment

```
C:/Users/markl/AppData/Local/Programs/Python/Python313/python.exe
pip install -r requirements.txt   # feedparser==6.0.11, beautifulsoup4==4.12.3
```

Local dev server (port 8742, defined in `.claude/launch.json`):
```
python -m http.server 8742 --directory docs
```

---

## Next steps

### 1. CSS — match https://videnskabeligtudfordret.dk/

Update `docs/style.css` to adopt the visual identity of the main site:
- Colours, typography, header/card style
- Keep the semantic structure of `docs/index.html` unchanged; only restyle

### 2. GitHub Pages deployment

1. Create a GitHub repo (e.g. `videnskabeligtudfordret/episode-search`)
2. Push the project: `git init && git add . && git commit && git remote add origin ... && git push`
3. In repo Settings → Pages: Source = Deploy from branch, branch = `main`, folder = `/docs`
4. Verify the live URL loads and search works
5. Add `permissions: contents: write` to `.github/workflows/update.yml` (already present) and confirm the scheduled run succeeds on GitHub

### 3. Transcription (future)

When ready to transcribe:
- Use faster-whisper with `language=da`
- Target format: `{ "text": "..." }` (segments not required by the search pipeline)
- Drop files in `data/transcripts/` and push — site rebuilds automatically

---

## Known limitations / risks

- **RSS description quality is mixed** — some episodes have 1-sentence descriptions or joke descriptions that don't reflect the content. Search quality depends heavily on transcripts for those episodes.
- **Boilerplate stripping** — covers 4+ promotional copy eras. If the podcast introduces new boilerplate patterns, add new markers to `BOILERPLATE_MARKERS` in `scripts/rss_fetch.py`.
- **Danish compound words** — the substring tier handles most cases. Edit-distance handles morphological variants. True stemming (Snowball Danish) was considered but rejected because it fails on Latin-origin loanwords common in science content (virus/vira, gen/gener, etc.).
- **Index size** — currently ~538 KB RSS-only. With full transcripts this grows to potentially 4–8 MB. Still within browser budget; monitor if transcripts are added in bulk.
