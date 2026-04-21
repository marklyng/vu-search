"use strict";

// ── Utilities ────────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let _tooltip = null;

function getTooltip() {
  if (!_tooltip) {
    _tooltip = document.createElement("div");
    _tooltip.className = "viz-tooltip";
    _tooltip.hidden = true;
    document.body.appendChild(_tooltip);
  }
  return _tooltip;
}

function showTooltip(html, x, y) {
  const t = getTooltip();
  t.innerHTML = html;
  t.hidden = false;
  const pad = 12;
  const tw = t.offsetWidth, th = t.offsetHeight;
  const vw = window.innerWidth, vh = window.innerHeight;
  let left = x + pad;
  let top = y - th / 2;
  if (left + tw > vw - pad) left = x - tw - pad;
  if (top < pad) top = pad;
  if (top + th > vh - pad) top = vh - th - pad;
  t.style.left = left + "px";
  t.style.top = top + "px";
}

function hideTooltip() {
  getTooltip().hidden = true;
}

function lerpColor(hex1, hex2, t) {
  const p = (h) => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
  const c1 = p(hex1), c2 = p(hex2);
  const r = Math.round(c1[0] + (c2[0] - c1[0]) * t);
  const g = Math.round(c1[1] + (c2[1] - c1[1]) * t);
  const b = Math.round(c1[2] + (c2[2] - c1[2]) * t);
  return `rgb(${r},${g},${b})`;
}

const FILTH_COLORS = {
  orgasme:   "#c2410c",
  sex:       "#9333ea",
  lort:      "#92400e",
  penis:     "#dc2626",
  sæd:       "#15803d",
  pik:       "#1d4ed8",
  tissemand: "#0891b2",
  vagina:    "#be185d",
  tissekone: "#0e7490",
  afføring:  "#78716c",
  udflåd:    "#a16207",
  none:      "#c8c0b8",
};

const CAT_COLORS = {
  pattedyr: "#5ebfc6",
  fugl:     "#ff3d5a",
  insekt:   "#2a9d8f",
  reptil:   "#f4a261",
  fisk:     "#e9c46a",
  andet:    "#9ca3af",
};

const CAT_LABELS = {
  pattedyr: "Pattedyr",
  fugl:     "Fugle",
  insekt:   "Insekter",
  reptil:   "Krybdyr",
  fisk:     "Fisk",
  andet:    "Andet",
};

function svgEl(tag, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  return el;
}

// ── Bestiary ──────────────────────────────────────────────────────────────────

function renderBestiary(data) {
  const grid = document.getElementById("bestiary-grid");
  const detailBox = document.getElementById("bestiary-detail");
  if (!grid || !detailBox) return;
  grid.innerHTML = "";
  detailBox.innerHTML = "";
  detailBox.hidden = true;

  const animals = data.bestiary;
  if (!animals.length) { grid.textContent = "Ingen data."; return; }

  // Category filter legend
  const legend = document.createElement("div");
  legend.className = "bestiary-legend";
  legend.setAttribute("role", "group");
  const cats = [...new Set(animals.map((a) => a.category))];
  const activeFilters = new Set(cats);

  const INITIAL_VISIBLE = 15;
  let expanded = false;

  function applyVisibility() {
    Array.from(grid.querySelectorAll(".bestiary-card")).forEach((card, i) => {
      const catOk = activeFilters.has(card.dataset.category);
      const showOk = expanded || i < INITIAL_VISIBLE;
      card.hidden = !(catOk && showOk);
    });
    legend.querySelectorAll(".legend-chip").forEach((chip) => {
      chip.classList.toggle("legend-chip--inactive", !activeFilters.has(chip.dataset.category));
    });
  }

  for (const cat of Object.keys(CAT_LABELS)) {
    if (!cats.includes(cat)) continue;
    const chip = document.createElement("button");
    chip.className = "legend-chip";
    chip.dataset.category = cat;
    chip.textContent = CAT_LABELS[cat];
    chip.setAttribute("aria-pressed", "true");
    chip.addEventListener("click", () => {
      if (activeFilters.has(cat)) {
        activeFilters.delete(cat);
        chip.setAttribute("aria-pressed", "false");
      } else {
        activeFilters.add(cat);
        chip.setAttribute("aria-pressed", "true");
      }
      applyVisibility();
    });
    legend.appendChild(chip);
  }
  grid.parentElement.insertBefore(legend, grid);

  let activeCard = null;

  function openDetail(animal) {
    detailBox.hidden = false;
    detailBox.innerHTML = `
      <div class="bestiary-detail-header">
        <span class="bestiary-detail-title">${escHtml(animal.animal)}</span>
        <button class="bestiary-detail-close" aria-label="Luk" id="bestiary-close">&times;</button>
      </div>
      <ul class="bestiary-fact-list">
        ${animal.facts.map((f) => `
          <li class="bestiary-fact-item">
            ${escHtml(f.fact)}
            <div class="bestiary-fact-ep">${escHtml(f.title)}</div>
          </li>`).join("")}
      </ul>
    `;
    document.getElementById("bestiary-close").addEventListener("click", closeDetail);
    detailBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function closeDetail() {
    detailBox.hidden = true;
    if (activeCard) {
      activeCard.classList.remove("bestiary-card--active");
      activeCard = null;
    }
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !detailBox.hidden) closeDetail();
  });

  for (const animal of animals) {
    const card = document.createElement("div");
    card.className = "bestiary-card";
    card.dataset.category = animal.category;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `${animal.animal}, ${animal.count} fakta`);
    const excerpt = animal.facts[0]?.fact || "";
    card.innerHTML = `
      <div class="bestiary-animal">${escHtml(animal.animal)}</div>
      <div class="bestiary-count">${animal.count} fakta</div>
      <div class="bestiary-excerpt">${escHtml(excerpt.slice(0, 100))}</div>
    `;

    function toggle(card, animal) {
      return function () {
        if (activeCard === card) {
          closeDetail();
        } else {
          if (activeCard) activeCard.classList.remove("bestiary-card--active");
          activeCard = card;
          card.classList.add("bestiary-card--active");
          openDetail(animal);
        }
      };
    }

    const handler = toggle(card, animal);
    card.addEventListener("click", handler);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handler(); }
    });

    grid.appendChild(card);
  }

  // Progressive disclosure: show top 15 by default
  applyVisibility();

  if (animals.length > INITIAL_VISIBLE) {
    const btn = document.createElement("button");
    btn.className = "bestiary-show-more";
    btn.textContent = `Vis alle (${animals.length} dyr) ▾`;
    btn.addEventListener("click", () => {
      expanded = !expanded;
      applyVisibility();
      btn.textContent = expanded
        ? "Vis færre ▴"
        : `Vis alle (${animals.length} dyr) ▾`;
    });
    grid.after(btn);
  }
}

// ── Scatter ───────────────────────────────────────────────────────────────────

function renderScatter(data) {
  const container = document.getElementById("scatter-container");
  if (!container) return;
  container.innerHTML = "";
  container.className = "viz-container scatter-container";

  const pts = data.scatter.filter((e) => e.duration_min > 0);
  if (!pts.length) { container.textContent = "Ingen data."; return; }

  const VW = 600, VH = 440;
  const MARGIN = { top: 30, right: 20, bottom: 40, left: 48 };
  const CW = VW - MARGIN.left - MARGIN.right;
  const CH = VH - MARGIN.top - MARGIN.bottom;

  // Use 95th percentile to prevent two outliers from compressing the bulk of the data
  function pct(arr, p) {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(Math.floor(s.length * p), s.length - 1)] || 1;
  }
  const maxSci = Math.max(pct(pts.map((p) => p.science_score), 0.95), 1);
  const maxFil = Math.max(pct(pts.map((p) => p.scatological_score), 0.95), 1);

  // Clip outliers to chart edge so they remain visible
  function px(v) { return Math.min(CW, Math.max(0, (v / maxSci) * CW)); }
  function py(v) { return Math.max(0, Math.min(CH, CH - (v / maxFil) * CH)); }

  const svg = svgEl("svg", {
    viewBox: `0 0 ${VW} ${VH}`,
    width: "100%",
    preserveAspectRatio: "xMidYMid meet",
    "aria-label": "Spredningsplot: smut vs. videnskab",
    role: "img",
  });

  const g = svgEl("g", { transform: `translate(${MARGIN.left},${MARGIN.top})` });
  svg.appendChild(g);

  // Equal-sized quadrants at midpoint of axis range
  const qx = CW / 2, qy = CH / 2;
  const QBG = [
    [qx,  0,   CW - qx, qy,       "#f7c696", 0.14],  // top-right:    Beskidt videnskab (warm peach)
    [qx,  qy,  CW - qx, CH - qy,  "#5ebfc6", 0.07],  // bottom-right: Ren videnskab (teal)
    [0,   0,   qx,      qy,       "#ff3d5a", 0.07],  // top-left:     Rent lort (coral)
  ];
  for (const [x, y, w, h, fill, opacity] of QBG) {
    g.appendChild(svgEl("rect", { x, y, width: w, height: h, fill, "fill-opacity": opacity }));
  }
  g.appendChild(svgEl("line", { x1: qx, y1: 0, x2: qx, y2: CH, stroke: "#c8c0b8", "stroke-width": 1, "stroke-dasharray": "4,3" }));
  g.appendChild(svgEl("line", { x1: 0, y1: qy, x2: CW, y2: qy, stroke: "#c8c0b8", "stroke-width": 1, "stroke-dasharray": "4,3" }));

  // Quadrant labels (corrected positions)
  const QL = [
    [CW * 0.75, 14,       "Beskidt videnskab"],   // top-right:    high sci, high smut ✓
    [CW * 0.75, CH - 8,   "Ren videnskab"],        // bottom-right: high sci, low smut ✓
    [CW * 0.25, 14,       "Rent lort"],             // top-left:     low sci, high smut ✓
    [CW * 0.25, CH - 8,   "Videnskabeligt Udfordret"], // bottom-left: low sci, low smut ✓
  ];
  for (const [x, y, txt] of QL) {
    const t = svgEl("text", { x, y, fill: "#b8b0a8", "font-size": 10, "font-family": "inherit", "text-anchor": "middle" });
    t.textContent = txt;
    g.appendChild(t);
  }

  // Axes
  g.appendChild(svgEl("line", { x1: 0, y1: CH, x2: CW, y2: CH, stroke: "#c8c0b8", "stroke-width": 1 }));
  g.appendChild(svgEl("line", { x1: 0, y1: 0, x2: 0, y2: CH, stroke: "#c8c0b8", "stroke-width": 1 }));
  const axisStyle = { fill: "#9ca3af", "font-size": 11, "font-family": "inherit" };
  const xLabel = svgEl("text", { ...axisStyle, x: CW / 2, y: CH + 32, "text-anchor": "middle" });
  xLabel.textContent = "Videnskabelig intensitet →";
  g.appendChild(xLabel);
  const yLabel = svgEl("text", { ...axisStyle, x: -CH / 2, y: -36, "text-anchor": "middle", transform: "rotate(-90)" });
  yLabel.textContent = "Frække ord →";
  g.appendChild(yLabel);

  // Top 12 outliers by combined score — labeled with episode number
  const top12 = [...pts]
    .sort((a, b) => (b.science_score + b.scatological_score) - (a.science_score + a.scatological_score))
    .slice(0, 12)
    .map((p) => p.sid);

  for (const pt of pts) {
    const cx = px(pt.science_score);
    const cy = py(pt.scatological_score);
    const r = Math.max(3, Math.min(8, Math.sqrt(pt.duration_min) * 0.7));
    const filthRatio = pt.scatological_score / (pt.science_score + pt.scatological_score + 1);
    const dotColor = lerpColor("#5ebfc6", "#ff3d5a", filthRatio);

    const circle = svgEl("circle", {
      cx, cy, r,
      fill: dotColor,
      "fill-opacity": 0.65,
      stroke: dotColor,
      "stroke-width": 0.8,
      style: pt.episode_id ? "cursor:pointer" : "cursor:crosshair",
    });
    circle.addEventListener("mousemove", (ev) => {
      showTooltip(
        `<strong>${escHtml(pt.title)}</strong><br>Videnskabelige ord: ${pt.science_score}<br>Frække ord: ${pt.scatological_score}<br>${pt.duration_min} min`,
        ev.clientX, ev.clientY
      );
    });
    circle.addEventListener("mouseleave", hideTooltip);
    if (pt.episode_id) {
      circle.addEventListener("click", () => {
        hideTooltip();
        openEpisode(pt.episode_id, pt.title);
      });
    }
    g.appendChild(circle);

    if (top12.includes(pt.sid) && pt.ep != null) {
      const lbl = svgEl("text", {
        x: cx + r + 2, y: cy + 4,
        fill: "#6b6560", "font-size": 9, "font-family": "inherit",
        style: "pointer-events:none",
      });
      lbl.textContent = `#${pt.ep}`;
      g.appendChild(lbl);
    }
  }

  container.appendChild(svg);
}

// ── Flemming vs. Mark ─────────────────────────────────────────────────────────
// Tug-of-war rope (knot position = cumulative balance) + cumulative line chart.

function renderHosts(data) {
  const container = document.getElementById("hosts-container");
  if (!container) return;
  container.innerHTML = "";

  const { hosts, totals } = data;
  if (!hosts.length) { container.textContent = "Ingen data."; return; }

  const totalF = totals.flemming, totalM = totals.mark;
  const totalSum = totalF + totalM || 1;

  // ── Section A: Tug-of-war rope SVG ──────────────────────────────────────────
  const TW = 600, TH = 110, KY = 52;
  const kx = Math.round(60 + (totalF / totalSum) * 480);

  const tugSvg = svgEl("svg", {
    viewBox: `0 0 ${TW} ${TH}`,
    width: "100%",
    class: "hosts-tug",
    "aria-label": `Tug-of-war: Flemming ${totalF.toLocaleString("da")} vs Mark ${totalM.toLocaleString("da")}`,
    role: "img",
  });

  // Left rope (Flemming — blue)
  tugSvg.appendChild(svgEl("path", {
    d: `M 60,${KY} Q ${(60 + kx) / 2},${KY + 12} ${kx},${KY}`,
    fill: "none", stroke: "#2563c8", "stroke-width": 5, "stroke-linecap": "round",
  }));
  // Right rope (Mark — red)
  tugSvg.appendChild(svgEl("path", {
    d: `M ${kx},${KY} Q ${(kx + 540) / 2},${KY + 12} 540,${KY}`,
    fill: "none", stroke: "#c2410c", "stroke-width": 5, "stroke-linecap": "round",
  }));
  // Knot
  tugSvg.appendChild(svgEl("circle", {
    cx: kx, cy: KY, r: 9,
    fill: "#f5f0eb", stroke: "#4a4440", "stroke-width": 2.5,
  }));

  // Name labels
  function tugText(x, anchor, name, count, color) {
    const nm = svgEl("text", { x, y: 28, fill: color, "font-size": 14, "font-weight": 700, "font-family": "inherit", "text-anchor": anchor });
    nm.textContent = name;
    tugSvg.appendChild(nm);
    const ct = svgEl("text", { x, y: 80, fill: color, "font-size": 10, "font-family": "inherit", "text-anchor": anchor });
    ct.textContent = count.toLocaleString("da") + " nævnelser";
    tugSvg.appendChild(ct);
  }
  tugText(30, "start", "Flemming", totalF, "#2563c8");
  tugText(570, "end", "Mark", totalM, "#c2410c");

  // Winner annotation
  const diff = totalF - totalM;
  if (diff !== 0) {
    const winner = diff > 0 ? "Flemming" : "Mark";
    const winPct = Math.round(100 * Math.max(totalF, totalM) / totalSum);
    const ann = svgEl("text", { x: 300, y: TH - 6, fill: "#9ca3af", "font-size": 10, "font-family": "inherit", "text-anchor": "middle" });
    ann.textContent = `${winner} vinder med ${winPct}%`;
    tugSvg.appendChild(ann);
  }

  container.appendChild(tugSvg);

  // ── Section B: Cumulative line chart ─────────────────────────────────────────
  const subtitle = document.createElement("p");
  subtitle.className = "viz-subtitle";
  subtitle.style.marginTop = "1.5rem";
  subtitle.textContent = "Kumulativ forskel i antal nævnelser per afsnit";
  container.appendChild(subtitle);

  const CVW = 600, CVH = 200;
  const M = { top: 20, right: 20, bottom: 28, left: 50 };
  const CW = CVW - M.left - M.right;
  const CH = CVH - M.top - M.bottom;
  const BASE_Y = CH / 2;

  // Sort chronologically (oldest first) for the cumulative chart
  const hostsChron = [...hosts].sort((a, b) => (a.ep || 0) - (b.ep || 0));

  // Build cumulative diff
  const cumDiffs = [];
  let running = 0;
  for (const h of hostsChron) {
    running += h.flemming - h.mark;
    cumDiffs.push(running);
  }
  const maxAbs = Math.max(
    Math.abs(Math.min(...cumDiffs)),
    Math.abs(Math.max(...cumDiffs)),
    1
  );
  const xStep = CW / Math.max(hostsChron.length - 1, 1);

  const cumSvg = svgEl("svg", {
    viewBox: `0 0 ${CVW} ${CVH}`,
    width: "100%",
    "aria-label": "Kumulativ Flemming vs Mark per afsnit",
    role: "img",
    style: "cursor:crosshair",
  });
  const g = svgEl("g", { transform: `translate(${M.left},${M.top})` });
  cumSvg.appendChild(g);

  // Zero baseline
  g.appendChild(svgEl("line", {
    x1: 0, y1: BASE_Y, x2: CW, y2: BASE_Y,
    stroke: "#c8c0b8", "stroke-width": 1, "stroke-dasharray": "3,3",
  }));

  // Year tick marks
  const seenYrs = new Set();
  hostsChron.forEach((h, i) => {
    const yr = (h.date || "").slice(0, 4);
    if (!yr || seenYrs.has(yr)) return;
    seenYrs.add(yr);
    const x = i * xStep;
    g.appendChild(svgEl("line", {
      x1: x, y1: BASE_Y - 4, x2: x, y2: BASE_Y + 4,
      stroke: "#9ca3af", "stroke-width": 1,
    }));
    const t = svgEl("text", {
      x, y: CH + M.bottom - 2,
      fill: "#9ca3af", "font-size": 10, "font-family": "inherit", "text-anchor": "middle",
    });
    t.textContent = yr;
    g.appendChild(t);
  });

  // Axis labels
  const yLbl = svgEl("text", {
    x: -BASE_Y, y: -38,
    fill: "#9ca3af", "font-size": 10, "font-family": "inherit",
    "text-anchor": "middle", transform: "rotate(-90)",
  });
  yLbl.textContent = "← Mark foran · Flemming foran →";
  g.appendChild(yLbl);

  // Point coordinates
  const pts = cumDiffs.map((d, i) => ({
    x: i * xStep,
    y: BASE_Y - (d / maxAbs) * (BASE_Y * 0.9),
  }));

  const lineD = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaD = `${lineD} L${pts[pts.length - 1].x.toFixed(1)},${BASE_Y} L0,${BASE_Y} Z`;

  // Clip paths for two-color fill
  const defs = svgEl("defs", {});
  const clipTop = svgEl("clipPath", { id: "cumulClipTop" });
  clipTop.appendChild(svgEl("rect", { x: 0, y: 0, width: CW, height: BASE_Y }));
  const clipBot = svgEl("clipPath", { id: "cumulClipBot" });
  clipBot.appendChild(svgEl("rect", { x: 0, y: BASE_Y, width: CW, height: CH }));
  defs.appendChild(clipTop);
  defs.appendChild(clipBot);
  g.appendChild(defs);

  // Flemming area (above baseline = positive diff)
  g.appendChild(svgEl("path", {
    d: areaD, fill: "#2563c8", "fill-opacity": 0.22, "clip-path": "url(#cumulClipTop)",
  }));
  // Mark area (below baseline = negative diff)
  g.appendChild(svgEl("path", {
    d: areaD, fill: "#c2410c", "fill-opacity": 0.22, "clip-path": "url(#cumulClipBot)",
  }));
  // Line stroke
  g.appendChild(svgEl("path", {
    d: lineD, fill: "none", stroke: "#3c3830", "stroke-width": 1.5, "stroke-linejoin": "round",
  }));

  // Hover: find nearest episode
  cumSvg.addEventListener("mousemove", (ev) => {
    const rect = cumSvg.getBoundingClientRect();
    const scaleX = CVW / rect.width;
    const mx = (ev.clientX - rect.left) * scaleX - M.left;
    const idx = Math.max(0, Math.min(hostsChron.length - 1, Math.round(mx / xStep)));
    const h = hostsChron[idx];
    const d = cumDiffs[idx];
    const leader = d > 0 ? "Flemming foran" : d < 0 ? "Mark foran" : "Uafgjort";
    showTooltip(
      `<strong>${escHtml(h.title)}</strong><br>` +
      `<span style="color:#2563c8">Flemming: ${h.flemming}</span><br>` +
      `<span style="color:#c2410c">Mark: ${h.mark}</span><br>` +
      `${leader} (${Math.abs(d).toLocaleString("da")})`,
      ev.clientX, ev.clientY
    );
  });
  cumSvg.addEventListener("mouseleave", hideTooltip);

  container.appendChild(cumSvg);
}

// ── Discipline atlas ──────────────────────────────────────────────────────────

const DISCIPLINE_EMOJI = {
  "Biologi":                       "🔬",
  "Medicin / Sundhed":             "💊",
  "Evolution / Palæontologi":      "🦕",
  "Astronomi / Rumfysik":          "🌌",
  "Psykologi / Adfærd":            "🧠",
  "Kemi":                          "⚗️",
  "Fysik":                         "⚛️",
  "Økologi / Klima":               "🌿",
  "Teknologi / Ingeniørvidenskab": "🤖",
  "Geologi / Geografi":            "🌋",
};

function renderDisciplines(data) {
  const container = document.getElementById("disciplines-container");
  if (!container) return;
  container.innerHTML = "";

  const disciplines = data.disciplines;
  if (!disciplines || !disciplines.length) {
    container.textContent = "Ingen data.";
    return;
  }

  const grid = document.createElement("div");
  grid.className = "discipline-grid";

  for (const disc of disciplines) {
    const card = document.createElement("div");
    card.className = "discipline-card";
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    card.setAttribute("aria-label", `${disc.discipline}: ${disc.title}`);

    const fillColor = lerpColor("#f7c696", "#5ebfc6", disc.fit_score / 100);

    card.innerHTML = `
      <div class="discipline-emoji">${DISCIPLINE_EMOJI[disc.discipline] || "🔬"}</div>
      <div class="discipline-name">${escHtml(disc.discipline)}</div>
      <div class="discipline-ep">${escHtml(disc.title)}</div>
      <div class="discipline-bar-track">
        <div class="discipline-bar-fill" style="width:${disc.fit_score}%;background:${escHtml(fillColor)}"></div>
      </div>
      <div class="discipline-score">Balance: ${disc.fit_score}/100</div>
      <div class="discipline-reason">"${escHtml(disc.reason)}"</div>
    `;

    if (disc.episode_id) {
      const handler = () => openEpisode(disc.episode_id, disc.title);
      card.addEventListener("click", handler);
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handler(); }
      });
    }

    grid.appendChild(card);
  }

  container.appendChild(grid);
}

// ── TOC active highlighting ───────────────────────────────────────────────────

function initVizToc() {
  const links = Array.from(document.querySelectorAll(".viz-toc-link"));
  if (!links.length) return () => {};

  const sections = links
    .map((l) => document.getElementById(l.getAttribute("href").slice(1)))
    .filter(Boolean);

  function updateActive() {
    if (!document.body.classList.contains("viz-open")) return;
    // 120px: section counts as "active" once its top has scrolled past this offset
    let activeId = sections[0] ? sections[0].id : null;
    for (const s of sections) {
      if (s.getBoundingClientRect().top <= 120) activeId = s.id;
    }
    for (const l of links) {
      l.classList.toggle("viz-toc-link--active", l.getAttribute("href").slice(1) === activeId);
    }
  }

  window.addEventListener("scroll", updateActive, { passive: true });
  return updateActive;
}

// ── Nav toggle + lazy load ────────────────────────────────────────────────────

let vizLoaded = false;

function loadViz() {
  if (vizLoaded) return;
  vizLoaded = true;

  const updateTocActive = initVizToc();

  const containers = [
    "bestiary-grid", "scatter-container", "hosts-container", "disciplines-container",
  ];
  for (const id of containers) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<p class="viz-loading">Indlæser\u2026</p>';
  }

  fetch("data/viz.json")
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((d) => {
      renderBestiary(d);
      renderScatter(d);
      renderHosts(d);
      renderDisciplines(d);
      updateTocActive();
    })
    .catch((err) => {
      console.error("viz.json load failed:", err);
      for (const id of containers) {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '<p class="viz-loading">Kunne ikke indlæse data.</p>';
      }
    });
}

document.addEventListener("DOMContentLoaded", () => {
  const btnSearch = document.getElementById("nav-search");
  const btnViz = document.getElementById("nav-viz");
  const viewSearch = document.getElementById("view-search");
  const viewViz = document.getElementById("view-viz");

  if (!btnSearch || !btnViz || !viewSearch || !viewViz) return;

  btnSearch.addEventListener("click", () => {
    viewSearch.hidden = false;
    viewViz.hidden = true;
    btnSearch.classList.add("nav-btn--active");
    btnSearch.setAttribute("aria-pressed", "true");
    btnViz.classList.remove("nav-btn--active");
    btnViz.setAttribute("aria-pressed", "false");
    document.body.classList.remove("viz-open");
  });

  btnViz.addEventListener("click", () => {
    viewViz.hidden = false;
    viewSearch.hidden = true;
    btnViz.classList.add("nav-btn--active");
    btnViz.setAttribute("aria-pressed", "true");
    btnSearch.classList.remove("nav-btn--active");
    btnSearch.setAttribute("aria-pressed", "false");
    document.body.classList.add("viz-open");
    loadViz();
  });
});
