/**
 * app.js — Videnskabeligt Udfordret episode search
 *
 * Loads docs/data/search_index.json once on startup, then searches entirely
 * in-memory. No external libraries required.
 *
 * Search index format (search_index.json):
 *   { token: [short_id, ...] }
 * Episode meta format (meta.json):
 *   { short_id: { id, title, date, snippet, has_transcript, dyrfakt, listener_question, image_url } }
 *
 * Episode detail format (fetched on demand):
 *   { id, title, date, audio_url, episode_url, description, duration, transcript }
 */

"use strict";

// ─── State ────────────────────────────────────────────────────────────────────

let searchIndex = null;   // token → [sid, ...] (search_index.json)
let episodeMeta = null;   // sid → { id, title, ... } (meta.json)
let registry = null;      // array from index.json (slim list for browse)
let debounceTimer = null;

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const searchInput    = document.getElementById("search-input");
const searchStatus   = document.getElementById("search-status");
const resultsSection = document.getElementById("results-section");
const resultsCount   = document.getElementById("results-count");
const resultsList    = document.getElementById("results-list");
const browseSection  = document.getElementById("browse-section");
const browseLabel    = document.getElementById("browse-label");
const browseList     = document.getElementById("browse-list");
const episodePanel   = document.getElementById("episode-panel");
const panelContent   = document.getElementById("panel-content");
const panelClose     = document.getElementById("panel-close");
const panelOverlay   = document.getElementById("panel-overlay");
const transcriptNote = document.getElementById("transcript-note");

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  searchStatus.textContent = "Indlæser afsnit…";

  try {
    const [idxResp, metaResp, regResp] = await Promise.all([
      fetch("data/search_index.json"),
      fetch("data/meta.json"),
      fetch("data/index.json"),
    ]);

    if (!idxResp.ok) throw new Error(`search_index.json: ${idxResp.status}`);
    if (!metaResp.ok) throw new Error(`meta.json: ${metaResp.status}`);
    if (!regResp.ok) throw new Error(`index.json: ${regResp.status}`);

    [searchIndex, episodeMeta, registry] = await Promise.all([idxResp.json(), metaResp.json(), regResp.json()]);

    const total = registry.length;
    const withTranscript = registry.filter(e => e.has_transcript).length;

    searchInput.placeholder = `Søg i ${total} afsnit…`;
    searchStatus.textContent = "";

    if (withTranscript > 0) {
      transcriptNote.textContent =
        ` + transkriberede for ${withTranscript} af ${total} afsnit`;
    }

    renderBrowse(registry.slice(0, 20));
    browseLabel.textContent = `Seneste ${Math.min(20, total)} afsnit`;

  } catch (err) {
    searchStatus.textContent = "Kunne ikke indlæse afsnit. Prøv at genindlæse siden.";
    console.error("Init failed:", err);
  }
}

// ─── Search ───────────────────────────────────────────────────────────────────

function tokenise(text) {
  return text
    .toLowerCase()
    .match(/[a-zæøå]{2,}/g) || [];
}

/**
 * Levenshtein edit distance between strings a and b.
 * Space-optimised two-row DP — O(min(|a|,|b|)) space.
 */
function levenshtein(a, b) {
  if (a.length < b.length) { const tmp = a; a = b; b = tmp; }
  const lb = b.length;
  let prev = Array.from({ length: lb + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[lb];
}

/**
 * Get a scored posting list for a query token.
 *
 * Always combines two sources:
 *
 * 1. Exact match — the pre-built posting list, ordered by field weight
 *    (title > description > transcript). Score = 1.0 for exact token.
 *
 * 2. Substring match — handles Danish compound words. "kræft" finds
 *    "tarmkræft", "tyktarmskræft" etc. Score = 1 / (extra_chars + 1),
 *    so shorter compounds (closer match) rank higher.
 *
 * Both sources are merged, keeping the best score per episode.
 * Returns an array of short_ids ordered best-first.
 */
function getPostingList(token, index) {
  const sidScores = {};

  // Exact match (score 1.0 for rank 0, decaying for later ranks)
  const exact = index[token];
  if (exact) {
    exact.forEach((sid, rank) => {
      const s = 1 / (rank + 1);
      if (!sidScores[sid] || s > sidScores[sid]) sidScores[sid] = s;
    });
  }

  // Substring match — only for tokens >= 4 chars to avoid noise
  if (token.length >= 4) {
    for (const key of Object.keys(index)) {
      if (key.length > token.length && key.includes(token)) {
        const keyScore = 1 / (key.length - token.length + 1);
        for (const sid of index[key]) {
          if (!sidScores[sid] || keyScore > sidScores[sid]) {
            sidScores[sid] = keyScore;
          }
        }
      }
    }
  }

  // Edit-distance match — catches morphological variants (vira/virus) and typos.
  // Only for tokens >= 4 chars; max edit distance 2.
  // Pre-filter: skip keys where length difference alone exceeds 2.
  // Skip keys already covered by exact or substring matching.
  // Score: 1/(dist*3+1) — clearly below substring scores to preserve ranking order.
  if (token.length >= 4) {
    for (const key of Object.keys(index)) {
      if (Math.abs(key.length - token.length) > 2) continue;
      if (key === token) continue;
      if (key.length > token.length && key.includes(token)) continue;
      const dist = levenshtein(token, key);
      if (dist > 2) continue;
      const keyScore = 1 / (dist * 3 + 1);
      for (const sid of index[key]) {
        if (!sidScores[sid] || keyScore > sidScores[sid]) {
          sidScores[sid] = keyScore;
        }
      }
    }
  }

  return Object.keys(sidScores).sort((a, b) => sidScores[b] - sidScores[a]);
}

/**
 * Search the inverted index.
 *
 * Ranking (in order of importance):
 * 1. Title match — any query token found in the episode title gets a strong
 *    multiplier. This is the primary ranking signal.
 * 2. All-token match — episodes matching every query word get a 2× boost
 *    over partial matches.
 * 3. Posting list position — episodes where the token appears in the title
 *    (vs. description vs. transcript) naturally appear earlier in posting lists
 *    due to build-time field weighting (title 3×, description 2×, transcript 1×).
 *
 * Returns array of { sid, score, meta } sorted by score desc.
 */
function search(query) {
  if (!searchIndex || !episodeMeta) return [];

  const tokens = tokenise(query);
  if (tokens.length === 0) return [];

  const index = searchIndex;
  const meta = episodeMeta;

  // Accumulate scores across all tokens (OR semantics with scoring)
  const scores = {};
  const matchCount = {};

  for (const token of tokens) {
    const list = getPostingList(token, index);
    list.forEach((sid, rank) => {
      scores[sid] = (scores[sid] || 0) + 1 / (rank + 1);
      matchCount[sid] = (matchCount[sid] || 0) + 1;
    });
  }

  if (Object.keys(scores).length === 0) return [];

  // Boost episodes matching ALL query tokens (rewards specificity)
  for (const sid of Object.keys(scores)) {
    if (matchCount[sid] === tokens.length) {
      scores[sid] *= 2;
    }
  }

  // Title-match tier: the primary relevance signal.
  // If any query token appears in the episode title (including as a substring
  // of a compound word, e.g. "kræft" matches "tarmkræft"), the episode enters
  // a separate tier by receiving a large additive bonus.
  //
  // Additive (not multiplicative) ensures ANY title match outranks ANY
  // description-only match, regardless of posting list rank. Within the title
  // tier, relative ordering from posting list scores is preserved.
  //
  // Non-title scores max at ~10 (many tokens, all rank 0, with all-token boost),
  // so a bonus of 100 cleanly separates the two tiers.
  for (const sid of Object.keys(scores)) {
    const m = meta[sid];
    if (!m) continue;
    const titleLower = m.title.toLowerCase();
    for (const token of tokens) {
      if (titleLower.includes(token)) {
        scores[sid] += 100;
        break; // one title-match is enough
      }
    }
  }

  return Object.keys(scores)
    .sort((a, b) => scores[b] - scores[a])
    .map(sid => ({ sid, score: scores[sid], meta: meta[sid] }))
    .filter(r => r.meta); // guard against stale index
}

// ─── Render results ───────────────────────────────────────────────────────────

function highlight(text, query) {
  const tokens = tokenise(query);
  if (!tokens.length) return escHtml(text);
  const pattern = new RegExp(`(${tokens.map(escRegex).join("|")})`, "gi");
  return escHtml(text).replace(pattern, "<mark>$1</mark>");
}

function escHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("da-DK", { year: "numeric", month: "long", day: "numeric" });
}

function renderResults(results, query) {
  resultsList.innerHTML = "";

  if (results.length === 0) {
    resultsCount.textContent = `Ingen resultater for "${escHtml(query)}"`;
    resultsList.innerHTML = `<li class="no-results">Prøv et andet søgeord eller en kortere sætning.</li>`;
    return;
  }

  const shown = results.slice(0, 15);
  resultsCount.textContent =
    results.length === 1
      ? "1 afsnit fundet"
      : `${results.length} afsnit fundet`;

  for (const { sid, meta } of shown) {
    const li = document.createElement("li");
    li.className = "result-card";
    li.dataset.id = meta.id;
    li.dataset.sid = sid;

    const snippetHtml = meta.snippet
      ? highlight(meta.snippet, query)
      : "<em>Ingen sammenfatning tilgængelig</em>";

    li.innerHTML = `
      ${meta.image_url ? `<img class="card-thumb" src="${escHtml(meta.image_url)}" alt="" loading="lazy">` : ""}
      <div class="card-body">
        <div class="card-header">
          <span class="card-title">${highlight(meta.title, query)}</span>
          ${meta.has_transcript ? '<span class="badge badge-transcript" title="Transkriberet tilgængelig">Transkriberet</span>' : ""}
        </div>
        <div class="card-date">${formatDate(meta.date)}</div>
        <div class="card-snippet">${snippetHtml}</div>
        ${meta.dyrfakt || meta.listener_question ? `
        <div class="card-segments">
          ${meta.dyrfakt ? `<div class="card-segment"><span class="segment-label">Dyrefact</span>${highlight(meta.dyrfakt, query)}</div>` : ""}
          ${meta.listener_question ? `<div class="card-segment"><span class="segment-label">Lytterspørgsmål</span>${highlight(meta.listener_question, query)}</div>` : ""}
        </div>` : ""}
      </div>
    `;
    li.addEventListener("click", () => openEpisode(meta.id, meta.title));
    li.setAttribute("role", "button");
    li.setAttribute("tabindex", "0");
    li.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") openEpisode(meta.id, meta.title);
    });

    resultsList.appendChild(li);
  }
}

function renderBrowse(episodes) {
  browseList.innerHTML = "";
  for (const ep of episodes) {
    const li = document.createElement("li");
    li.className = "browse-card";
    li.dataset.id = ep.id;
    li.innerHTML = `
      ${ep.image_url ? `<img class="card-thumb" src="${escHtml(ep.image_url)}" alt="" loading="lazy">` : ""}
      <div class="card-body">
        <div class="card-header">
          <span class="card-title">${escHtml(ep.title)}</span>
          ${ep.has_transcript ? '<span class="badge badge-transcript">Transkriberet</span>' : ""}
        </div>
        <div class="card-date">${formatDate(ep.date)}${ep.duration ? " &middot; " + escHtml(ep.duration) : ""}</div>
      </div>
    `;
    li.addEventListener("click", () => openEpisode(ep.id, ep.title));
    li.setAttribute("role", "button");
    li.setAttribute("tabindex", "0");
    li.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") openEpisode(ep.id, ep.title);
    });
    browseList.appendChild(li);
  }
}

// ─── Episode detail panel ────────────────────────────────────────────────────

async function openEpisode(fullId, title) {
  panelContent.innerHTML = `<p class="panel-loading">Indlæser…</p>`;
  showPanel();

  try {
    const resp = await fetch(`data/episodes/${fullId}.json`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const ep = await resp.json();
    renderPanel(ep);
  } catch (err) {
    panelContent.innerHTML = `<p class="panel-error">Kunne ikke hente afsnitsdata. Prøv igen.</p>`;
    console.error("openEpisode failed:", err);
  }
}

function renderPanel(ep) {
  const listenLink = ep.audio_url
    ? `<a class="btn-listen" href="${escHtml(ep.audio_url)}" target="_blank" rel="noopener">Lyt her &rarr;</a>`
    : ep.episode_url
    ? `<a class="btn-listen" href="${escHtml(ep.episode_url)}" target="_blank" rel="noopener">Vis afsnit &rarr;</a>`
    : "";

  const descHtml = ep.description
    ? `<section class="panel-section">
        <h3>Beskrivelse</h3>
        <p>${escHtml(ep.description)}</p>
       </section>`
    : "";

  const segmentsHtml = (ep.dyrfakt || ep.listener_question)
    ? `<section class="panel-section">
        ${ep.dyrfakt ? `<div class="panel-segment"><span class="segment-label">Dyrefact</span>${escHtml(ep.dyrfakt)}</div>` : ""}
        ${ep.listener_question ? `<div class="panel-segment"><span class="segment-label">Lytterspørgsmål</span>${escHtml(ep.listener_question)}</div>` : ""}
       </section>`
    : "";

  const transcriptHtml = ep.transcript
    ? `<section class="panel-section"><span class="badge badge-transcript">Transkriberet</span></section>`
    : "";

  panelContent.innerHTML = `
    ${ep.image_url ? `<img class="panel-artwork" src="${escHtml(ep.image_url)}" alt="">` : ""}
    <h2 class="panel-title">${escHtml(ep.title)}</h2>
    <div class="panel-meta">
      <span>${formatDate(ep.date)}</span>
      ${ep.duration ? `<span>&middot; ${escHtml(ep.duration)}</span>` : ""}
    </div>
    <div class="panel-actions">${listenLink}</div>
    ${descHtml}
    ${segmentsHtml}
    ${transcriptHtml}
  `;
}

function showPanel() {
  episodePanel.hidden = false;
  panelOverlay.hidden = false;
  document.body.classList.add("panel-open");
  panelClose.focus();
}

function closePanel() {
  episodePanel.hidden = true;
  panelOverlay.hidden = true;
  document.body.classList.remove("panel-open");
  searchInput.focus();
}

panelClose.addEventListener("click", closePanel);
panelOverlay.addEventListener("click", closePanel);
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !episodePanel.hidden) closePanel();
});

// ─── Search input handler ────────────────────────────────────────────────────

searchInput.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  const query = searchInput.value.trim();

  if (query.length === 0) {
    resultsSection.hidden = true;
    browseSection.hidden = false;
    return;
  }

  debounceTimer = setTimeout(() => {
    const results = search(query);
    resultsSection.hidden = false;
    browseSection.hidden = true;
    renderResults(results, query);
  }, 250);
});

// ─── Start ────────────────────────────────────────────────────────────────────

init();
