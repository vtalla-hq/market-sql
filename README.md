# market-sql

Ask questions about stock market data in plain English; an LLM writes Postgres SQL, guardrails validate it, and it runs read-only.

Work in progress. Phase 1 (schema + ingest) is done.

## Ingest (local)

```bash
python -m venv .venv && .venv/Scripts/pip install -r ingest/requirements.txt   # bin/ on macOS/Linux
cp .env.example .env   # fill in DATABASE_URL and EDGAR_USER_AGENT
psql "$DATABASE_URL" -f db/schema.sql
cd ingest && python tickers.py && python prices.py && python news.py && python filings.py
```

The `ingest` GitHub Action runs the same scripts daily; it needs `DATABASE_URL` and `EDGAR_USER_AGENT` repo secrets.
