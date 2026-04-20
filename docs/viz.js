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
  const t = getTooltip();
  t.hidden = true;
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
  pattedyr: "#2563c8",
  fugl:     "#0891b2",
  insekt:   "#16a34a",
  reptil:   "#ca8a04",
  fisk:     "#7c3aed",
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

// ── Seismograph ───────────────────────────────────────────────────────────────

function renderSeismograph(data) {
  const container = document.getElementById("seismograph-container");
  if (!container) return;
  container.innerHTML = "";

  const eps = data.seismograph;
  if (!eps.length) { container.textContent = "Ingen data."; return; }

  const BAR_W = 4, BAR_GAP = 2, STEP = BAR_W + BAR_GAP;
  const H = 220, LABEL_H = 18, AXIS_H = 16;
  const CHART_H = H - LABEL_H - AXIS_H;
  const W = Math.max(600, eps.length * STEP + 40);

  const maxFilth = Math.max(...eps.map((e) => e.total_filth), 1);

  const svg = svgEl("svg", {
    width: W, height: H,
    "aria-label": "Filth score per afsnit",
    role: "img",
  });

  // baseline
  svg.appendChild(svgEl("line", {
    x1: 20, y1: LABEL_H + CHART_H,
    x2: W - 20, y2: LABEL_H + CHART_H,
    stroke: "#e2ddd8", "stroke-width": 1,
  }));

  // year ticks
  const years = {};
  eps.forEach((ep, i) => {
    const y = (ep.date || "").slice(0, 4);
    if (y && !years[y]) years[y] = i;
  });
  for (const [yr, idx] of Object.entries(years)) {
    const x = 20 + idx * STEP;
    svg.appendChild(svgEl("line", {
      x1: x, y1: LABEL_H + CHART_H,
      x2: x, y2: LABEL_H + CHART_H + AXIS_H - 2,
      stroke: "#c8c0b8", "stroke-width": 1,
    }));
    const t = svgEl("text", {
      x: x + 2, y: H - 2,
      fill: "#9ca3af",
      "font-size": 10,
      "font-family": "inherit",
    });
    t.textContent = yr;
    svg.appendChild(t);
  }

  // top 5 labeled spikes
  const top5 = [...eps]
    .sort((a, b) => b.total_filth - a.total_filth)
    .slice(0, 5)
    .map((e) => e.sid);

  eps.forEach((ep, i) => {
    const x = 20 + i * STEP + BAR_W / 2;
    const barH = Math.max(2, (ep.total_filth / maxFilth) * CHART_H * 0.9);
    const y1 = LABEL_H + CHART_H - barH;
    const y2 = LABEL_H + CHART_H;
    const col = FILTH_COLORS[ep.dominant] || FILTH_COLORS.none;

    const line = svgEl("line", {
      x1: x, y1, x2: x, y2,
      stroke: col, "stroke-width": BAR_W,
      "stroke-linecap": "round",
      style: "cursor:pointer",
    });

    line.addEventListener("mousemove", (ev) => {
      const rows = Object.entries(ep.filth)
        .filter(([, v]) => v > 0)
        .sort(([, a], [, b]) => b - a)
        .map(([w, c]) => `<span style="color:${FILTH_COLORS[w] || '#fff'}">${escHtml(w)}</span>: ${c}`)
        .join("<br>");
      showTooltip(
        `<strong>${escHtml(ep.title)}</strong>${rows ? "<br>" + rows : "<br>ingen hits"}`,
        ev.clientX, ev.clientY
      );
    });
    line.addEventListener("mouseleave", hideTooltip);
    svg.appendChild(line);

    if (top5.includes(ep.sid)) {
      const label = svgEl("text", {
        x: x + 3, y: y1 - 3,
        fill: col, "font-size": 9, "font-family": "inherit",
        transform: `rotate(-45, ${x + 3}, ${y1 - 3})`,
        style: "pointer-events:none",
      });
      label.textContent = ep.ep != null ? `#${ep.ep}` : "";
      svg.appendChild(label);
    }
  });

  container.appendChild(svg);
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

  // legend
  const legend = document.createElement("div");
  legend.className = "bestiary-legend";
  legend.setAttribute("role", "group");
  const cats = [...new Set(animals.map((a) => a.category))];
  const activeFilters = new Set(cats);

  function applyFilter() {
    grid.querySelectorAll(".bestiary-card").forEach((card) => {
      card.hidden = !activeFilters.has(card.dataset.category);
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
      applyFilter();
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

    function toggle() {
      if (activeCard === card) {
        closeDetail();
      } else {
        if (activeCard) activeCard.classList.remove("bestiary-card--active");
        activeCard = card;
        card.classList.add("bestiary-card--active");
        openDetail(animal);
      }
    }

    card.addEventListener("click", toggle);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });

    grid.appendChild(card);
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

  const maxSci = Math.max(...pts.map((p) => p.science_score), 1);
  const maxFil = Math.max(...pts.map((p) => p.scatological_score), 1);

  const medSci = [...pts].sort((a, b) => a.science_score - b.science_score)[Math.floor(pts.length / 2)].science_score;
  const medFil = [...pts].sort((a, b) => a.scatological_score - b.scatological_score)[Math.floor(pts.length / 2)].scatological_score;

  function px(v) { return (v / maxSci) * CW; }
  function py(v) { return CH - (v / maxFil) * CH; }

  const svg = svgEl("svg", {
    viewBox: `0 0 ${VW} ${VH}`,
    width: "100%",
    preserveAspectRatio: "xMidYMid meet",
    "aria-label": "Spredningsplot: lort vs. videnskab",
    role: "img",
  });

  const g = svgEl("g", { transform: `translate(${MARGIN.left},${MARGIN.top})` });
  svg.appendChild(g);

  // quadrant dividers
  const qx = px(medSci), qy = py(medFil);
  g.appendChild(svgEl("line", { x1: qx, y1: 0, x2: qx, y2: CH, stroke: "#d4cec8", "stroke-width": 1, "stroke-dasharray": "4,3" }));
  g.appendChild(svgEl("line", { x1: 0, y1: qy, x2: CW, y2: qy, stroke: "#d4cec8", "stroke-width": 1, "stroke-dasharray": "4,3" }));

  // quadrant labels
  const QL = [
    [CW * 0.75, 14, "Beskidt videnskab"],
    [CW * 0.75, CH - 8, "Rent lort"],
    [CW * 0.25, 14, "Ren videnskab"],
    [CW * 0.25, CH - 8, "Videnskabeligt Udfordret"],
  ];
  for (const [x, y, txt] of QL) {
    const t = svgEl("text", { x, y, fill: "#b8b0a8", "font-size": 10, "font-family": "inherit", "text-anchor": "middle" });
    t.textContent = txt;
    g.appendChild(t);
  }

  // axes
  g.appendChild(svgEl("line", { x1: 0, y1: CH, x2: CW, y2: CH, stroke: "#c8c0b8", "stroke-width": 1 }));
  g.appendChild(svgEl("line", { x1: 0, y1: 0, x2: 0, y2: CH, stroke: "#c8c0b8", "stroke-width": 1 }));
  const axisStyle = { fill: "#9ca3af", "font-size": 11, "font-family": "inherit" };
  const xLabel = svgEl("text", { ...axisStyle, x: CW / 2, y: CH + 32, "text-anchor": "middle" });
  xLabel.textContent = "Videnskabelig intensitet →";
  g.appendChild(xLabel);
  const yLabel = svgEl("text", { ...axisStyle, x: -CH / 2, y: -36, "text-anchor": "middle", transform: "rotate(-90)" });
  yLabel.textContent = "Skatalogisk intensitet →";
  g.appendChild(yLabel);

  // top 8 outliers by combined score
  const top8 = [...pts]
    .sort((a, b) => (b.science_score + b.scatological_score) - (a.science_score + a.scatological_score))
    .slice(0, 8)
    .map((p) => p.sid);

  for (const pt of pts) {
    const cx = px(pt.science_score);
    const cy = py(pt.scatological_score);
    const r = Math.max(4, Math.min(14, Math.sqrt(pt.duration_min) * 1.0));

    const circle = svgEl("circle", {
      cx, cy, r,
      fill: "#2563c8",
      "fill-opacity": 0.55,
      stroke: "#2563c8",
      "stroke-width": 0.5,
      style: "cursor:pointer",
    });
    circle.addEventListener("mousemove", (ev) => {
      showTooltip(
        `<strong>${escHtml(pt.title)}</strong><br>Videnskab: ${pt.science_score}<br>Lort: ${pt.scatological_score}<br>${pt.duration_min} min`,
        ev.clientX, ev.clientY
      );
    });
    circle.addEventListener("mouseleave", hideTooltip);
    g.appendChild(circle);

    if (top8.includes(pt.sid) && pt.ep != null) {
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

// ── Body map ──────────────────────────────────────────────────────────────────

const BODY_ANCHOR = {
  hjerne:  [200,  52], øje:    [200,  82], næse:  [200, 104], mund:  [200, 120],
  øre:     [200,  90],
  bryst:   [200, 178], hjerte: [200, 170], lunge: [200, 195],
  arm:     [200, 228], hånd:   [200, 308], ryg:   [200, 248],
  mave:    [200, 262], lever:  [200, 244], nyre:  [200, 270], tarm:  [200, 290],
  blod:    [200, 215],
  hud:     [200, 345],
  ben:     [200, 385], fod:    [200, 448],
  knogle:  [200, 340],
};

const BODY_SIDE = {
  hjerne: "center", øje: "left", næse: "center", mund: "center",
  øre: "right",
  bryst: "left", hjerte: "right", lunge: "right",
  arm: "left", hånd: "left", ryg: "right",
  mave: "center", lever: "left", nyre: "right", tarm: "center",
  blod: "right",
  hud: "right",
  ben: "left", fod: "center",
  knogle: "left",
};

function renderBodyMap(data) {
  const container = document.getElementById("bodymap-container");
  if (!container) return;
  container.innerHTML = "";
  container.className = "viz-container bodymap-container";

  const counts = data.body_map;
  const vals = Object.values(counts).filter((v) => v > 0);
  if (!vals.length) { container.textContent = "Ingen data."; return; }
  const minV = Math.min(...vals), maxV = Math.max(...vals);

  const VW = 400, VH = 520;
  const svg = svgEl("svg", {
    viewBox: `0 0 ${VW} ${VH}`,
    width: "100%",
    preserveAspectRatio: "xMidYMid meet",
    "aria-label": "Kroppens landkort",
    role: "img",
  });

  // Abstract human silhouette
  const SILO_PATH =
    "M200,20 C210,20 224,28 226,44 C228,60 220,74 200,80 C180,74 172,60 174,44 C176,28 190,20 200,20Z " +
    "M194,80 C180,82 168,90 164,105 L155,165 L175,165 L178,130 L178,300 L155,460 L175,465 L194,340 L206,340 L225,465 L245,460 L222,300 L222,130 L225,165 L245,165 L236,105 C232,90 220,82 206,80Z " +
    "M178,130 L145,220 L162,226 L178,165Z " +
    "M222,130 L255,220 L238,226 L222,165Z";

  const silo = svgEl("path", {
    d: SILO_PATH,
    fill: "#e8e3de",
    stroke: "#d4cec8",
    "stroke-width": 1,
  });
  svg.appendChild(silo);

  // Labels
  for (const [part, count] of Object.entries(counts)) {
    if (count === 0) continue;
    const anchor = BODY_ANCHOR[part];
    if (!anchor) continue;

    const t = Math.max(0, Math.min(1, (count - minV) / (maxV - minV)));
    const col = lerpColor("#888077", "#b91c1c", t);
    const fs = Math.round(9 + Math.log(1 + (count / minV)) * 3);
    const clampedFs = Math.max(9, Math.min(20, fs));

    const side = BODY_SIDE[part] || "center";
    const LX = side === "left" ? anchor[0] - 62 : side === "right" ? anchor[0] + 62 : anchor[0];
    const LY = anchor[1];

    // connector line
    if (side !== "center") {
      svg.appendChild(svgEl("line", {
        x1: anchor[0], y1: anchor[1],
        x2: LX + (side === "left" ? 40 : -40), y2: LY,
        stroke: col, "stroke-width": 0.75, "stroke-dasharray": "2,2", opacity: 0.5,
      }));
    }

    const lbl = svgEl("text", {
      x: LX, y: LY + 4,
      fill: col,
      "font-size": clampedFs,
      "font-family": "inherit",
      "font-weight": t > 0.6 ? 700 : 500,
      "text-anchor": side === "left" ? "end" : side === "right" ? "start" : "middle",
      style: "cursor:default",
    });
    lbl.textContent = part;

    lbl.addEventListener("mousemove", (ev) => {
      showTooltip(`<strong>${escHtml(part)}</strong><br>${count.toLocaleString("da")} forekomster`, ev.clientX, ev.clientY);
    });
    lbl.addEventListener("mouseleave", hideTooltip);
    svg.appendChild(lbl);
  }

  container.appendChild(svg);
}

// ── Flemming vs. Mark ─────────────────────────────────────────────────────────

function renderHosts(data) {
  const container = document.getElementById("hosts-container");
  if (!container) return;
  container.innerHTML = "";

  const { hosts, totals } = data;
  if (!hosts.length) { container.textContent = "Ingen data."; return; }

  const totalF = totals.flemming, totalM = totals.mark, totalSum = totalF + totalM;

  // summary bar
  const summary = document.createElement("div");
  summary.className = "hosts-summary";
  const pctF = totalSum ? Math.round((totalF / totalSum) * 100) : 50;
  summary.innerHTML = `
    <span class="hosts-label-f">Flemming (${totalF.toLocaleString("da")})</span>
    <div class="tug-bar-outer" role="img" aria-label="Flemming ${pctF}%, Mark ${100 - pctF}%">
      <div class="tug-bar-flemming" style="width:${pctF}%"></div>
      <div class="tug-bar-mark" style="width:${100 - pctF}%"></div>
    </div>
    <span class="hosts-label-m">Mark (${totalM.toLocaleString("da")})</span>
  `;
  container.appendChild(summary);

  const timeline = document.createElement("div");
  timeline.className = "hosts-timeline";

  const maxCount = Math.max(...hosts.map((h) => Math.max(h.flemming, h.mark)), 1);

  for (const h of hosts) {
    const row = document.createElement("div");
    row.className = "hosts-row";
    const winnerF = h.flemming >= h.mark;

    const label = document.createElement("div");
    label.className = "hosts-row-label";
    label.title = h.title;
    label.textContent = h.ep != null ? `#${h.ep}` : "";

    const bars = document.createElement("div");
    bars.className = "hosts-bars";

    const barF = document.createElement("div");
    barF.className = "hosts-bar-f";
    barF.style.width = `${(h.flemming / maxCount) * 48}%`;
    barF.style.opacity = winnerF ? "1" : "0.4";

    const barM = document.createElement("div");
    barM.className = "hosts-bar-m";
    barM.style.width = `${(h.mark / maxCount) * 48}%`;
    barM.style.opacity = !winnerF ? "1" : "0.4";

    bars.appendChild(barF);
    bars.appendChild(barM);
    row.appendChild(label);
    row.appendChild(bars);

    row.addEventListener("mousemove", (ev) => {
      showTooltip(
        `<strong>${escHtml(h.title)}</strong><br><span style="color:#2563c8">Flemming: ${h.flemming}</span><br><span style="color:#c2410c">Mark: ${h.mark}</span>`,
        ev.clientX, ev.clientY
      );
    });
    row.addEventListener("mouseleave", hideTooltip);

    timeline.appendChild(row);
  }
  container.appendChild(timeline);
}

// ── Nav toggle ────────────────────────────────────────────────────────────────

let vizLoaded = false;

function loadViz() {
  if (vizLoaded) return;
  vizLoaded = true;

  const containers = [
    "seismograph-container", "bestiary-grid", "scatter-container",
    "bodymap-container", "hosts-container",
  ];
  for (const id of containers) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<p class="viz-loading">Indlæser…</p>';
  }

  fetch("data/viz.json")
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((d) => {
      renderSeismograph(d);
      renderBestiary(d);
      renderScatter(d);
      renderBodyMap(d);
      renderHosts(d);
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
  });

  btnViz.addEventListener("click", () => {
    viewViz.hidden = false;
    viewSearch.hidden = true;
    btnViz.classList.add("nav-btn--active");
    btnViz.setAttribute("aria-pressed", "true");
    btnSearch.classList.remove("nav-btn--active");
    btnSearch.setAttribute("aria-pressed", "false");
    loadViz();
  });
});
