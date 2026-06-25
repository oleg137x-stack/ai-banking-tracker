#!/usr/bin/env python3
"""
Daily ingestion for the Bank AI Tracker.

Uses Claude (Opus 4.8) with the web_search server tool to find newly announced
or deployed AI / Agentic AI use cases at banks, extract them into the dataset
schema, dedupe against what we already have, and append to data/usecases.json.

Run:
    export ANTHROPIC_API_KEY=sk-ant-...
    python3 scripts/ingest.py                 # look back 3 days (daily mode)
    python3 scripts/ingest.py --since 2026-01-01   # backfill from a date
    python3 scripts/ingest.py --dry-run       # print, don't write

Schedule it daily with GitHub Actions (see .github/workflows/daily-ingest.yml)
or locally with cron.
"""

import argparse
import datetime as dt
import json
import os
import re
import sys
from pathlib import Path

try:
    import anthropic
except ImportError:
    sys.exit("Missing dependency. Run:  pip install anthropic")

MODEL = "claude-opus-4-8"
ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = ROOT / "data" / "usecases.json"

REGIONS = ["North America", "Europe", "UK & Ireland", "Asia-Pacific",
           "MENA", "Latin America"]
BUSINESS_AREAS = ["Retail Banking", "Wealth & Asset Management",
                  "Corporate & Investment Banking", "Markets & Trading",
                  "Risk & Compliance", "Fraud & AML", "Customer Service",
                  "Operations & Back Office", "Software Engineering", "Legal",
                  "HR", "Marketing & Sales", "Data & Research",
                  "Payments & Authorization", "Cross-functional"]
SECTORS = ["Bank", "Payments"]
AI_TYPES = ["Generative AI", "Agentic AI", "Predictive ML", "NLP",
            "Computer Vision", "Conversational AI", "Other"]
STATUSES = ["Announced", "Piloting", "Deployed"]


def slugify(*parts: str) -> str:
    text = "-".join(p for p in parts if p).lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text[:80]


def load_existing() -> list[dict]:
    if DATA_FILE.exists():
        return json.loads(DATA_FILE.read_text())
    return []


def build_prompt(since: str, today: str) -> str:
    return f"""You are a research analyst building a database of real, verifiable use cases \
of AI and Agentic AI deployed or announced at banks AND payments providers worldwide.

Search the web for news articles, press releases, and official announcements published \
between {since} and {today} about specific banks OR payments companies using AI or \
Agentic AI. Payments companies include card networks, processors and fintech payment \
firms such as Visa, Mastercard, PayPal, American Express, Stripe, Block (Square/Cash App), \
Adyen, Fiserv, FIS, Worldline, Global Payments and Nexi — but search for others too. \
Cover all geographies (US, Europe, UK, Asia-Pacific, MENA = Middle East & Africa incl. \
Gulf and African banks, Latin America) and all business areas (retail, wealth, \
investment banking, markets, risk, fraud/AML, customer service, operations, engineering, \
payments & authorization, agentic commerce, etc.). Prioritise concrete, named deployments \
over vague "exploring AI" stories.

INCLUSION RULES (so relevant news is never dropped):
- DO include a bank/payment-firm deployment even when it is announced by a TECHNOLOGY \
VENDOR or PARTNER (e.g. a Microsoft, Google, OpenAI, Anthropic, AWS, NVIDIA, Salesforce, \
FIS, Fiserv or Oracle press release that names a specific bank or payment client). Create \
the record for the BANK / PAYMENT FIRM, and put the vendor in "vendor".
- DO include card networks, processors, acquirers, BNPL and payment fintechs (Payments sector).
- Do a fresh sweep of the most recent days first (breaking news), then broaden.
- DO NOT create a feed record for a pure technology vendor, consultancy, credit bureau or \
data provider that is not itself a bank or payment system (e.g. Experian, ServiceNow, a \
McKinsey report). Those belong in a separate reports list, not here. When unsure whether \
the actor is a bank/payment system, prefer to include the bank named as the client.

Run several distinct web searches with different queries to get good coverage. For each \
genuine use case you find with a working source link, produce one JSON object with EXACTLY \
these fields:

- "sector": "Bank" for banks, "Payments" for payments networks/processors/fintechs
- "bank": the specific institution/brand name (e.g. "Isybank", "buddybank", "Stripe")
- "parent_group": the parent group if the entity is a subsidiary or brand of a \
larger group (e.g. "Intesa Sanpaolo" for Isybank, "UniCredit" for buddybank). Use "" if \
the bank is itself the top-level group (e.g. HSBC, JPMorgan Chase).
- "country": HQ country
- "region": one of {REGIONS} — classify by the institution's HQ country (do not use "Global")
- "business_area": one of {BUSINESS_AREAS}
- "ai_type": one of {AI_TYPES}
- "title": short headline (<= 90 chars)
- "description": 1-2 sentence summary
- "vendor": tech partner / model provider if mentioned, else ""
- "outcome": reported result/impact (quantified if stated), else ""
- "metric": a SHORT scannable version of the outcome for an impact dashboard (e.g. \
"+22% quality", "weeks->1 day", "EUR 200m saved", "30,000 chats/mo"). If no number is \
reported, give a short QUALITATIVE expected improvement instead (e.g. "Faster onboarding", \
"Fewer false positives") — do not leave it empty.
- "status": one of {STATUSES}
- "event_date": announcement/deployment date in YYYY-MM-DD (use the article date if the \
exact event date is unclear)
- "source_name": publication or "Press release"
- "source_url": the exact article/press-release URL you found

Rules:
- Only include items with a real source_url you actually found via search. Do NOT invent URLs.
- Skip anything that is not specifically about a bank (or clearly bank-like fintech).
- Skip duplicates of the same event.
- Aim for 8-20 high-quality items if available.

Return ONLY a JSON array of these objects, wrapped in a ```json code block. No prose \
before or after."""


def extract_json_array(text: str) -> list[dict]:
    # Prefer a fenced ```json block; fall back to the first [...] span.
    m = re.search(r"```json\s*(\[.*?\])\s*```", text, re.DOTALL)
    if not m:
        m = re.search(r"(\[.*\])", text, re.DOTALL)
    if not m:
        return []
    try:
        return json.loads(m.group(1))
    except json.JSONDecodeError:
        return []


def run_search(prompt: str) -> str:
    client = anthropic.Anthropic()
    messages = [{"role": "user", "content": prompt}]
    tools = [{"type": "web_search_20260209", "name": "web_search", "max_uses": 12}]

    for _ in range(8):  # bound the server-tool continuation loop
        resp = client.messages.create(
            model=MODEL,
            max_tokens=16000,
            tools=tools,
            messages=messages,
        )
        if resp.stop_reason == "pause_turn":
            # Server tool hit its iteration cap mid-turn; resume.
            messages.append({"role": "assistant", "content": resp.content})
            continue
        return "".join(b.text for b in resp.content if b.type == "text")
    return ""


def normalise(rec: dict, today: str) -> dict | None:
    required = ["bank", "title", "source_url"]
    if not all(rec.get(k) for k in required):
        return None
    rec.setdefault("country", "")
    rec.setdefault("parent_group", "")
    rec["sector"] = rec.get("sector") if rec.get("sector") in SECTORS else "Bank"
    rec["region"] = rec.get("region") if rec.get("region") in REGIONS else "North America"
    rec["business_area"] = rec.get("business_area") if rec.get("business_area") in BUSINESS_AREAS else "Cross-functional"
    rec["ai_type"] = rec.get("ai_type") if rec.get("ai_type") in AI_TYPES else "Other"
    rec["status"] = rec.get("status") if rec.get("status") in STATUSES else "Announced"
    rec.setdefault("description", "")
    rec.setdefault("vendor", "")
    rec.setdefault("outcome", "")
    rec.setdefault("metric", "")
    rec.setdefault("source_name", "")
    if not re.match(r"\d{4}-\d{2}-\d{2}", str(rec.get("event_date", ""))):
        rec["event_date"] = today
    rec["id"] = slugify(rec["bank"], rec["event_date"], rec["title"])
    rec["verified"] = True
    rec["added_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
    # keep only known fields
    keep = {"id", "sector", "bank", "parent_group", "country", "region", "business_area",
            "ai_type", "title", "description", "vendor", "outcome", "metric", "status",
            "event_date", "source_name", "source_url", "verified", "added_at"}
    return {k: rec[k] for k in keep if k in rec}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", help="YYYY-MM-DD lower bound (default: 3 days ago)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    today = dt.date.today()
    since = args.since or (today - dt.timedelta(days=3)).isoformat()
    today_s = today.isoformat()

    if not os.getenv("ANTHROPIC_API_KEY"):
        sys.exit("ANTHROPIC_API_KEY is not set.")

    existing = load_existing()
    seen_ids = {r["id"] for r in existing}
    seen_urls = {r.get("source_url", "").rstrip("/") for r in existing}

    print(f"Searching for bank AI use cases from {since} to {today_s} …")
    text = run_search(build_prompt(since, today_s))
    found = extract_json_array(text)
    print(f"Model returned {len(found)} candidate items.")

    added = []
    for raw in found:
        rec = normalise(raw, today_s)
        if not rec:
            continue
        if rec["id"] in seen_ids or rec["source_url"].rstrip("/") in seen_urls:
            continue
        seen_ids.add(rec["id"])
        seen_urls.add(rec["source_url"].rstrip("/"))
        added.append(rec)

    print(f"{len(added)} new unique items after dedup.")
    for r in added:
        print(f"  + [{r['event_date']}] {r['bank']}: {r['title']}")

    if args.dry_run:
        print("\n--dry-run: not writing.")
        return

    if added:
        combined = existing + added
        combined.sort(key=lambda r: r.get("event_date", ""), reverse=True)
        DATA_FILE.write_text(json.dumps(combined, indent=2, ensure_ascii=False) + "\n")
        print(f"\nWrote {len(combined)} total records to {DATA_FILE}")
    else:
        print("\nNothing new to add.")


if __name__ == "__main__":
    main()
