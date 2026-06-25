/* Bank AI Tracker — frontend logic (no build step) */

const FIELDS = ["bank", "region", "business_area", "ai_type", "status", "vendor"];
const FIELD_LABELS = {
  bank: "Bank", region: "Region", business_area: "Business area",
  ai_type: "Type of AI", status: "Status", vendor: "Vendor",
};

const PALETTE = [
  "#5b8cff", "#38d9a9", "#ffb454", "#ff6b6b", "#cdb4ff", "#4dd2ff",
  "#ff9ed8", "#a0e548", "#ffd166", "#8b9dff", "#6be3c9", "#ff8a65",
];

const state = {
  all: [],
  filters: Object.fromEntries(FIELDS.map((f) => [f, new Set()])),
  search: "",
  dateFrom: null,
  dateTo: null,
  sort: "date-desc",
  reports: [],
  sector: "all", // "all" | "Bank" | "Payments"
  feedLimit: 5,  // show 5 newest; "Show more news" reveals the rest
};
const FEED_PAGE = 5;
const charts = {};

// Records within the current sector scope (banks / payments / both)
function scoped() {
  return state.sector === "all" ? state.all : state.all.filter((d) => d.sector === state.sector);
}
const bankParents = {}; // bank name -> parent group (if any)

// "Isybank (Intesa Sanpaolo)" when a parent group is known, else "Isybank"
function bankLabel(bank) {
  const parent = bankParents[bank];
  return parent ? `${bank} (${parent})` : bank;
}

/* ---------------- Data load ---------------- */
async function load() {
  try {
    const res = await fetch("data/usecases.json", { cache: "no-store" });
    state.all = await res.json();
  } catch (e) {
    console.error("Failed to load data", e);
    document.getElementById("feed").innerHTML =
      '<div class="empty">Could not load data/usecases.json. Run via a local server (see README).</div>';
    return;
  }
  try {
    state.reports = await (await fetch("data/reports.json", { cache: "no-store" })).json();
  } catch (e) {
    state.reports = [];
  }
  renderBenchmarks();
  initMeta();
  buildFacets();
  bindEvents();
  render();
}

function initMeta() {
  document.getElementById("meta-total").textContent = scoped().length;
  const latest = state.all.reduce((m, d) => (d.added_at > m ? d.added_at : m), "");
  document.getElementById("meta-updated").textContent = latest
    ? new Date(latest).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
    : "—";
}

/* ---------------- Facets (filter chips) ---------------- */
function buildFacets() {
  state.all.forEach((d) => { if (d.parent_group) bankParents[d.bank] = d.parent_group; });
  const inScope = scoped();
  FIELDS.forEach((field) => {
    const counts = {};
    inScope.forEach((d) => {
      const v = d[field] || "—";
      counts[v] = (counts[v] || 0) + 1;
    });
    const container = document.getElementById("f-" + field);
    container.innerHTML = "";
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .forEach(([val, n]) => {
        const chip = document.createElement("button");
        chip.className = "chip";
        chip.dataset.value = val;
        const label = field === "bank" ? bankLabel(val) : val;
        chip.innerHTML = `${escapeHtml(label)}<span class="n">${n}</span>`;
        chip.addEventListener("click", () => toggleFilter(field, val, chip));
        container.appendChild(chip);
      });
  });
}

function toggleFilter(field, val, chip) {
  const set = state.filters[field];
  if (set.has(val)) { set.delete(val); chip.classList.remove("active"); }
  else { set.add(val); chip.classList.add("active"); }
  render();
}

/* ---------------- Filtering ---------------- */
function applyFilters() {
  const q = state.search.trim().toLowerCase();
  return scoped().filter((d) => {
    for (const f of FIELDS) {
      const set = state.filters[f];
      if (set.size && !set.has(d[f] || "—")) return false;
    }
    if (state.dateFrom && d.event_date < state.dateFrom) return false;
    if (state.dateTo && d.event_date > state.dateTo) return false;
    if (q) {
      const hay = [d.bank, d.parent_group, d.title, d.description, d.vendor, d.outcome, d.business_area, (d.tags || []).join(" ")]
        .join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/* ---------------- Render ---------------- */
function render() {
  state.feedLimit = FEED_PAGE; // any filter/scope change collapses the feed back to 5
  const data = applyFilters();
  renderKpis(data);
  renderActiveFilters();
  renderInsights(data);
  renderOutcomes(data);
  renderCharts(data);
  renderFeed(data);
}

function renderKpis(data) {
  const banks = new Set(data.map((d) => d.bank)).size;
  const deployed = data.filter((d) => d.status === "Deployed").length;
  const agentic = data.filter((d) => d.ai_type === "Agentic AI").length;
  const kpiNoun = state.sector === "Payments" ? "Payment providers" : state.sector === "Bank" ? "Banks" : "Institutions";
  const kpis = [
    { v: data.length, l: "Use cases", cls: "accent" },
    { v: banks, l: kpiNoun, cls: "" },
    { v: deployed, l: "In production", cls: "green" },
    { v: agentic, l: "Agentic AI", cls: "" },
  ];
  document.getElementById("kpis").innerHTML = kpis
    .map((k) => `<div class="kpi"><div class="v ${k.cls}">${k.v}</div><div class="l">${k.l}</div></div>`)
    .join("");
}

function renderActiveFilters() {
  const wrap = document.getElementById("active-filters");
  const parts = [];
  FIELDS.forEach((f) => {
    state.filters[f].forEach((v) => {
      parts.push(`<button class="afilter" data-field="${f}" data-value="${escapeAttr(v)}">${FIELD_LABELS[f]}: ${escapeHtml(v)}</button>`);
    });
  });
  if (state.dateFrom) parts.push(`<button class="afilter" data-clear="from">From ${state.dateFrom}</button>`);
  if (state.dateTo) parts.push(`<button class="afilter" data-clear="to">To ${state.dateTo}</button>`);
  wrap.innerHTML = parts.join("");
  wrap.querySelectorAll(".afilter").forEach((el) => {
    el.addEventListener("click", () => {
      if (el.dataset.clear === "from") { state.dateFrom = null; document.getElementById("date-from").value = ""; }
      else if (el.dataset.clear === "to") { state.dateTo = null; document.getElementById("date-to").value = ""; }
      else {
        const { field, value } = el.dataset;
        state.filters[field].delete(value);
        const chip = document.querySelector(`#f-${field} .chip[data-value="${cssEscape(value)}"]`);
        if (chip) chip.classList.remove("active");
      }
      render();
    });
  });
}

/* ---------------- Insights (dynamic text summary) ---------------- */
function fmtList(arr) {
  if (arr.length === 0) return "";
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return `${arr[0]} and ${arr[1]}`;
  return `${arr.slice(0, -1).join(", ")} and ${arr[arr.length - 1]}`;
}
function fmtMonth(ym) {
  const [y, m] = ym.split("-");
  return new Date(+y, +m - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
}
function pct(n, total) { return total ? Math.round((n / total) * 100) : 0; }

function renderInsights(data) {
  const periodEl = document.getElementById("insights-period");
  const body = document.getElementById("insights-body");

  if (!data.length) {
    periodEl.textContent = "";
    body.innerHTML = '<p class="ins-empty">No use cases match the current filters — widen the selection to see a summary.</p>';
    return;
  }

  const dates = data.map((d) => d.event_date).filter(Boolean).sort();
  const lo = state.dateFrom || dates[0];
  const hi = state.dateTo || dates[dates.length - 1];
  periodEl.textContent = `· ${fmtMonth(lo.slice(0, 7))} – ${fmtMonth(hi.slice(0, 7))}`;

  const banks = new Set(data.map((d) => d.bank));
  const groups = new Set(data.map((d) => d.parent_group).filter(Boolean));
  const regions = groupCount(data, "region");
  const areas = groupCount(data, "business_area");
  const types = groupCount(data, "ai_type");
  const vendors = groupCount(data, "vendor").filter((v) => v[0] && v[0] !== "—" && !/^in-house/i.test(v[0]));
  const deployed = data.filter((d) => d.status === "Deployed").length;
  const piloting = data.filter((d) => d.status === "Piloting").length;
  const announced = data.filter((d) => d.status === "Announced").length;
  const agentic = data.filter((d) => d.ai_type === "Agentic AI").length;
  const genai = data.filter((d) => d.ai_type === "Generative AI").length;

  // Momentum: compare the two halves of the period by event date.
  const mid = dates[Math.floor(dates.length / 2)];
  const firstHalf = data.filter((d) => d.event_date < mid).length;
  const secondHalf = data.length - firstHalf;
  let momentum = "steady activity";
  if (secondHalf > firstHalf * 1.3) momentum = "accelerating activity";
  else if (firstHalf > secondHalf * 1.3) momentum = "cooling activity";

  const paras = [];

  // 1. Headline
  const noun = state.sector === "Payments" ? "payment provider" : state.sector === "Bank" ? "bank" : "institution";
  paras.push(
    `Across the selected period, <b>${data.length}</b> AI use case${data.length === 1 ? "" : "s"} ` +
    `${data.length === 1 ? "was" : "were"} captured at <b>${banks.size}</b> ${noun}${banks.size === 1 ? "" : "s"}` +
    (groups.size ? ` (spanning ${groups.size} banking group${groups.size === 1 ? "" : "s"})` : "") +
    ` across <b>${regions.length}</b> region${regions.length === 1 ? "" : "s"}, with ${momentum} over the window.`
  );

  // 2. Maturity
  const maturityBits = [];
  if (deployed) maturityBits.push(`${deployed} in production (${pct(deployed, data.length)}%)`);
  if (piloting) maturityBits.push(`${piloting} piloting`);
  if (announced) maturityBits.push(`${announced} announced`);
  paras.push(`By maturity: ${fmtList(maturityBits)}.`);

  // 3. What kind of AI
  const topType = types[0];
  let typeSentence = `<b>${topType[0]}</b> leads the mix (${pct(topType[1], data.length)}% of cases)`;
  if (genai && agentic) {
    typeSentence += `, and <b>Agentic AI</b> accounts for ${pct(agentic, data.length)}% — the clearest signal of where deployments are heading next`;
  } else if (agentic) {
    typeSentence += `, including ${agentic} agentic deployment${agentic === 1 ? "" : "s"}`;
  }
  paras.push(typeSentence + ".");

  // 4. Where it lands in the bank
  paras.push(
    `Most activity sits in <b>${areas[0][0]}</b>` +
    (areas[1] ? ` and ${areas[1][0]}` : "") +
    `, concentrated in <b>${regions[0][0]}</b>` +
    (regions[1] ? ` and ${regions[1][0]}` : "") +
    `.` +
    (vendors.length ? ` Named technology partners include ${fmtList(vendors.slice(0, 3).map((v) => v[0]))}.` : "")
  );

  body.innerHTML = paras.map((p) => `<p>${p}</p>`).join("");
}

/* ---------------- Measured outcomes ---------------- */
// A quantified signal: %, ×/x-multiplier, currency, big-number words, or time/units.
const QUANT_RE = /(\d[\d.,]*\s*(%|x\b|×|bn|m\b|k\b|billion|million|thousand|hours?|minutes?|days?|weeks?|seconds?|points?|pp\b))|[€£$]\s*\d|→|->|\bNPS\b/i;

// Prefer the explicit `metric`; otherwise extract the first quantified clause of `outcome`.
function metricOf(d) {
  if (d.metric) return d.metric;
  if (!d.outcome) return "";
  const clause = d.outcome.split(/[;.]/).map((s) => s.trim()).find((s) => QUANT_RE.test(s));
  return clause || "";
}

function renderOutcomes(data) {
  const grid = document.getElementById("outcomes-grid");
  const countEl = document.getElementById("outcomes-count");
  if (!grid) return;
  const items = data
    .map((d) => ({ d, m: metricOf(d), q: QUANT_RE.test(metricOf(d)) }))
    .filter((x) => x.m)
    .sort((a, b) => (b.q - a.q) || b.d.event_date.localeCompare(a.d.event_date));
  const quant = items.filter((x) => x.q).length;
  countEl.textContent = `${items.length} cases · ${quant} quantified`;
  if (!items.length) {
    grid.innerHTML = '<p class="ins-empty">No outcomes in the current selection.</p>';
    return;
  }
  const CAP = 24;
  const shown = items.slice(0, CAP);
  grid.innerHTML = shown.map(({ d, m, q }) => `
    <a class="outcome ${q ? "" : "outcome--qual"}" href="${escapeAttr(d.source_url)}" target="_blank" rel="noopener" title="${escapeAttr(d.title)}">
      <div class="outcome-metric">${escapeHtml(m)}</div>
      <div class="outcome-bank">${escapeHtml(bankLabel(d.bank))}</div>
      <div class="outcome-area">${escapeHtml(d.business_area)} · ${escapeHtml(d.ai_type)}</div>
    </a>`).join("") +
    (items.length > CAP ? `<div class="outcome-more">+${items.length - CAP} more in the feed →</div>` : "");
}

/* ---------------- Industry benchmarks & reports ---------------- */
function renderBenchmarks() {
  const el = document.getElementById("insights-benchmarks");
  if (!el || !state.reports.length) return;
  const cards = state.reports.map((r) => `
    <a class="bench" href="${escapeAttr(r.url)}" target="_blank" rel="noopener">
      <div class="bench-top">
        <span class="bench-src">${escapeHtml(r.source)}</span>
        <span class="bench-cat">${escapeHtml(r.category)}</span>
      </div>
      <div class="bench-title">${escapeHtml(r.title)} ↗</div>
      <div class="bench-summary">${escapeHtml(r.summary)}</div>
      ${(r.stats || []).length ? `<ul class="bench-stats">${r.stats.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>` : ""}
    </a>`).join("");
  el.innerHTML = `
    <p class="ins-label">Industry benchmarks &amp; reports</p>
    <div class="bench-grid">${cards}</div>`;
}

/* ---------------- Charts ---------------- */
function groupCount(data, field) {
  const m = {};
  data.forEach((d) => { const v = d[field] || "—"; m[v] = (m[v] || 0) + 1; });
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}

function makeOrUpdate(id, config) {
  if (charts[id]) { charts[id].destroy(); }
  charts[id] = new Chart(document.getElementById(id), config);
}

const gridColor = "rgba(255,255,255,.06)";
const tickColor = "#97a3bd";

function baseOpts(extra = {}) {
  return Object.assign({
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: tickColor, font: { size: 11 }, boxWidth: 12 } } },
  }, extra);
}

function renderCharts(data) {
  // Timeline (cumulative by month)
  const byMonth = {};
  data.forEach((d) => { const m = (d.event_date || "").slice(0, 7); if (m) byMonth[m] = (byMonth[m] || 0) + 1; });
  const months = Object.keys(byMonth).sort();
  let run = 0;
  const cumulative = months.map((m) => (run += byMonth[m]));
  makeOrUpdate("chart-timeline", {
    type: "line",
    data: { labels: months, datasets: [{
      label: "Cumulative use cases", data: cumulative,
      borderColor: "#5b8cff", backgroundColor: "rgba(91,140,255,.15)",
      fill: true, tension: .3, pointRadius: 3, pointBackgroundColor: "#5b8cff",
    }] },
    options: baseOpts({
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: tickColor }, grid: { color: gridColor } },
        y: { beginAtZero: true, ticks: { color: tickColor, precision: 0 }, grid: { color: gridColor } },
      },
    }),
  });

  barChart("chart-region", groupCount(data, "region"));
  doughnutChart("chart-aitype", groupCount(data, "ai_type"));
  hBarChart("chart-business", groupCount(data, "business_area"));
  hBarChart("chart-banks", groupCount(data, "bank").slice(0, 10).map((e) => [bankLabel(e[0]), e[1]]));
  doughnutChart("chart-status", groupCount(data, "status"));
}

function barChart(id, entries) {
  makeOrUpdate(id, {
    type: "bar",
    data: { labels: entries.map((e) => e[0]), datasets: [{ data: entries.map((e) => e[1]), backgroundColor: PALETTE, borderRadius: 6 }] },
    options: baseOpts({
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: tickColor, font: { size: 10 } }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { color: tickColor, precision: 0 }, grid: { color: gridColor } },
      },
    }),
  });
}

function hBarChart(id, entries) {
  makeOrUpdate(id, {
    type: "bar",
    data: { labels: entries.map((e) => e[0]), datasets: [{ data: entries.map((e) => e[1]), backgroundColor: PALETTE, borderRadius: 6 }] },
    options: baseOpts({
      indexAxis: "y",
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, ticks: { color: tickColor, precision: 0 }, grid: { color: gridColor } },
        y: { ticks: { color: tickColor, font: { size: 11 } }, grid: { display: false } },
      },
    }),
  });
}

function doughnutChart(id, entries) {
  makeOrUpdate(id, {
    type: "doughnut",
    data: { labels: entries.map((e) => e[0]), datasets: [{ data: entries.map((e) => e[1]), backgroundColor: PALETTE, borderWidth: 0 }] },
    options: baseOpts({ cutout: "62%", plugins: { legend: { position: "right", labels: { color: tickColor, font: { size: 11 }, boxWidth: 12 } } } }),
  });
}

/* ---------------- Feed ---------------- */
function renderFeed(data) {
  const sorted = [...data].sort((a, b) => {
    if (state.sort === "date-asc") return a.event_date.localeCompare(b.event_date);
    if (state.sort === "bank-asc") return a.bank.localeCompare(b.bank) || b.event_date.localeCompare(a.event_date);
    return b.event_date.localeCompare(a.event_date);
  });
  document.getElementById("feed-count").textContent = sorted.length;
  const feed = document.getElementById("feed");
  if (!sorted.length) { feed.innerHTML = '<div class="empty">No use cases match these filters.</div>'; return; }
  const shown = sorted.slice(0, state.feedLimit);
  const remaining = sorted.length - shown.length;
  feed.innerHTML = shown.map(feedItem).join("") +
    (remaining > 0 ? `<button id="show-more-news" class="show-more-btn">Show more news (${remaining} more)</button>` : "");
}

// 1–2 paragraph summary composed from the structured fields (shown when a card is expanded).
function feedSummary(d) {
  const dt = new Date(d.event_date + "T00:00:00");
  const when = dt.toLocaleString(undefined, { month: "long", year: "numeric" });
  const who = bankLabel(d.bank);
  const p1 = `This case sits in ${d.business_area} for ${who}, applying ${d.ai_type} in the ${d.region} region. ` +
    `It is currently at the ${d.status} stage, recorded ${when}.`;
  const p2 =
    (d.outcome ? `${d.outcome} ` : "") +
    (d.vendor ? `Technology partner: ${d.vendor}. ` : "") +
    `For the original announcement and full detail, see the ${d.source_name || "source"} report linked above.`;
  return `<p>${escapeHtml(p1)}</p><p>${escapeHtml(p2)}</p>`;
}

function feedItem(d) {
  const dt = new Date(d.event_date + "T00:00:00");
  const day = dt.getDate();
  const mon = dt.toLocaleString(undefined, { month: "short" });
  const yr = dt.getFullYear();
  const aiClass = d.ai_type === "Agentic AI" ? "agentic" : "ai";
  return `
  <article class="feed-item">
    <div class="fi-date"><span class="d">${day}</span><span class="m">${mon}</span> <span class="y">${yr}</span></div>
    <div class="fi-main">
      <div class="fi-head">
        <div class="badges">
          <span class="badge sector-${escapeAttr(d.sector || "Bank")}">${escapeHtml(d.sector === "Payments" ? "Payments" : "Bank")}</span>
          <span class="badge ${aiClass}">${escapeHtml(d.ai_type)}</span>
          <span class="badge status-${escapeAttr(d.status)}">${escapeHtml(d.status)}</span>
          <span class="badge">${escapeHtml(d.region)}</span>
          <span class="badge">${escapeHtml(d.business_area)}</span>
        </div>
        <h4><span class="fi-bank">${escapeHtml(d.bank)}</span>${d.parent_group ? `<span class="fi-parent"> (${escapeHtml(d.parent_group)})</span>` : ""} — ${escapeHtml(d.title)}</h4>
        ${d.description ? `<p class="fi-desc">${escapeHtml(d.description)}</p>` : ""}
        ${d.outcome ? `<p class="fi-outcome"><b>Outcome:</b> ${escapeHtml(d.outcome)}</p>` : ""}
        <span class="fi-toggle">Read more ▾</span>
      </div>
      <div class="fi-more">${feedSummary(d)}</div>
      <div class="fi-foot">
        ${d.vendor ? `<span class="badge">${escapeHtml(d.vendor)}</span>` : ""}
        <a class="fi-source" href="${escapeAttr(d.source_url)}" target="_blank" rel="noopener">${escapeHtml(d.source_name || "Source")} ↗</a>
        ${d.verified === false ? '<span class="fi-unverified">unverified — check source</span>' : ""}
      </div>
    </div>
  </article>`;
}

/* ---------------- Events ---------------- */
function bindEvents() {
  document.getElementById("search").addEventListener("input", debounce((e) => { state.search = e.target.value; render(); }, 180));
  document.getElementById("date-from").addEventListener("change", (e) => { state.dateFrom = e.target.value || null; render(); });
  document.getElementById("date-to").addEventListener("change", (e) => { state.dateTo = e.target.value || null; render(); });
  document.getElementById("sort").addEventListener("change", (e) => { state.sort = e.target.value; render(); });
  document.getElementById("reset-filters").addEventListener("click", resetFilters);
  document.getElementById("export-btn").addEventListener("click", exportCsv);
  // Feed interactions: "Show more news" + expand/collapse a card
  document.getElementById("feed").addEventListener("click", (e) => {
    if (e.target.closest("#show-more-news")) {
      state.feedLimit = Infinity;
      renderFeed(applyFilters());
      return;
    }
    const head = e.target.closest(".fi-head");
    if (head) {
      const item = head.closest(".feed-item");
      const open = item.classList.toggle("expanded");
      const t = item.querySelector(".fi-toggle");
      if (t) t.textContent = open ? "Show less ▴" : "Read more ▾";
    }
  });
  const moreBtn = document.getElementById("more-filters-toggle");
  if (moreBtn) moreBtn.addEventListener("click", () => {
    const box = document.getElementById("more-filters");
    const open = box.classList.toggle("collapsed") === false;
    moreBtn.setAttribute("aria-expanded", String(open));
    moreBtn.textContent = open ? "Show fewer filters" : "Show more filters";
  });
  document.querySelectorAll("#scope-toggle .scope-btn").forEach((btn) => {
    btn.addEventListener("click", () => setSector(btn.dataset.sector, btn));
  });
  updateScopeCount();
}

function setSector(sector, btn) {
  if (sector === state.sector) return;
  state.sector = sector;
  document.querySelectorAll("#scope-toggle .scope-btn").forEach((b) => b.classList.toggle("active", b === btn));
  // Bank/payments lists differ — clear field filters & search, keep dates.
  FIELDS.forEach((f) => state.filters[f].clear());
  state.search = "";
  document.getElementById("search").value = "";
  document.querySelectorAll(".chip.active").forEach((c) => c.classList.remove("active"));
  buildFacets();          // rebuild chips for the new scope
  initMeta();             // refresh header total
  updateScopeCount();
  render();
}

function updateScopeCount() {
  const el = document.getElementById("scope-count");
  if (!el) return;
  const b = state.all.filter((d) => d.sector === "Bank").length;
  const p = state.all.filter((d) => d.sector === "Payments").length;
  el.textContent = state.sector === "Bank" ? `${b} bank use cases`
    : state.sector === "Payments" ? `${p} payment-provider use cases`
    : `${b} bank · ${p} payment providers`;
}

function resetFilters() {
  FIELDS.forEach((f) => state.filters[f].clear());
  state.search = ""; state.dateFrom = null; state.dateTo = null;
  document.getElementById("search").value = "";
  document.getElementById("date-from").value = "";
  document.getElementById("date-to").value = "";
  document.querySelectorAll(".chip.active").forEach((c) => c.classList.remove("active"));
  render();
}

function exportCsv() {
  const rows = applyFilters();
  const cols = ["event_date", "sector", "bank", "parent_group", "country", "region", "business_area", "ai_type", "status", "title", "vendor", "outcome", "metric", "source_url"];
  const csv = [cols.join(",")].concat(
    rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))
  ).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `bank-ai-usecases-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

/* ---------------- Utils ---------------- */
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function escapeHtml(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function escapeAttr(s) { return escapeHtml(s); }
function cssEscape(s) { return String(s).replace(/"/g, '\\"'); }
function csvCell(v) { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }

load();
