# Bank & Payment Systems AI Tracker

An interactive web app that tracks **use cases of AI and Agentic AI across global banks
and payment systems** — collected from news, media, and press releases. A sector toggle
at the top scopes the whole app to **Banks only**, **Payment providers**, or **Both** —
followed by four headline KPI boxes, then the filters. Filter by institution, region,
business area, type of AI, outcome, status and date; explore an interactive dashboard and a
**Measured outcomes** zone (quantified impact per case); and read a feed with links to the
actual announcements.

Payments coverage includes the major networks, processors and fintechs — Visa, Mastercard,
PayPal, American Express, Stripe, Block, Adyen, Fiserv, FIS, Worldline, Global Payments and
Nexi — and the daily ingestion searches for more.

The data is refreshed daily by an AI-assisted ingestion pipeline (Claude + web search).

---

## What's in here

```
index.html                  The app (feed + filters + dashboard) — no build step
assets/styles.css            Styling
assets/app.js                Frontend logic + charts (Chart.js via CDN)
data/usecases.json           The dataset (one record per use case)
data/reports.json            Industry benchmarks & reports (Capgemini, McKinsey, BCG, etc.)
data/schema.json             The record schema (filter dimensions live here)
scripts/ingest.py            Daily AI-assisted ingestion (Claude + web search)
.github/workflows/daily-ingest.yml   Free daily cron that updates the data
requirements.txt             Python dependency for ingestion
```

The app reads `data/usecases.json` in the browser. The ingestion script appends new,
sourced records to that same file. That's the whole architecture — no server, no database.

---

## 1. Run it locally

Because the app fetches a JSON file, open it through a tiny local server (not `file://`):

```bash
cd ai-banking-tracker
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

It ships with a seed dataset of well-known bank AI programmes so the dashboard is
populated immediately. **Seed rows are illustrative and flagged `unverified`** (you'll see
a badge in the feed) — the first real ingestion run replaces guesswork with sourced,
dated entries.

---

## 2. Turn on daily AI-assisted tracking

The ingestion script uses Claude with the web-search tool to find new announcements,
structure them into the schema, dedupe, and append.

### Run it once by hand

```bash
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...      # from console.anthropic.com
python3 scripts/ingest.py --since 2026-01-01     # backfill from start of 2026
```

Useful flags:

- `--since YYYY-MM-DD` — how far back to look (daily mode defaults to the last 3 days).
- `--dry-run` — show what it found without writing.

### Automate it daily (free, no server)

The included GitHub Action runs every morning, commits the updated `data/usecases.json`,
and the site picks it up automatically.

1. Push this folder to a GitHub repo.
2. Repo **Settings → Secrets and variables → Actions → New repository secret**:
   - Name: `ANTHROPIC_API_KEY`, Value: your key.
3. The workflow runs daily at 06:15 UTC. You can also trigger it manually under the
   **Actions** tab → *Daily AI use-case ingestion* → *Run workflow*.

---

## 3. Publish the site (cloud)

Any static host works. Easiest options:

- **GitHub Pages:** Settings → Pages → deploy from branch (root). Done.
- **Netlify / Vercel / Cloudflare Pages:** point at the repo; no build command, output
  directory is the repo root.

Because both the site and the daily job live in the same repo, publishing + the Action
gives you a genuinely live, daily-updated tracker with zero infrastructure to babysit.

---

## Benchmarks & reports

The **Insights** panel surfaces a curated set of industry benchmarks and reports from
[`data/reports.json`](data/reports.json) — consultancy and institutional research on AI
in banking and payments (Capgemini, McKinsey, BCG, Accenture, Deloitte, ECB, IMF and
others). Edit that file to add or change the reference sources shown.

## Notes & tuning

- **Editing data by hand** is fine — it's just JSON. Match the fields in `data/schema.json`.
- **Filters/dashboards** are driven entirely by the dataset; new banks, regions, vendors,
  etc. appear in the filters automatically as they enter the data.
- **Quality:** the model is instructed to include only items with a real source URL it
  found via search, and ingested rows are marked `verified`. Always confirm specifics via
  the source link before relying on them — this is news aggregation, not legal/financial
  advice.
- **Cost:** each daily run is a handful of web searches + one Claude completion — cents,
  not dollars. Tune `--since` and the `max_uses` on the search tool in `scripts/ingest.py`.
