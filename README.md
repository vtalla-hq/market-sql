# market-sql

Ask questions about stock market data in plain English; an LLM writes Postgres SQL, guardrails validate it, and it runs read-only.

Work in progress: Phase 1 (schema + ingest) and Phase 2 (query loop) are done.

## LLM providers

Every provider goes through one OpenAI-compatible client (the `openai` npm package with a custom `baseURL`), picked by three env vars. No provider SDKs.

| Preset | `LLM_BASE_URL` | `LLM_API_KEY` | `LLM_MODEL` | Use |
|---|---|---|---|---|
| Ollama | `http://localhost:11434/v1` | `ollama` | `qwen2.5-coder:7b` | local dev + eval, free |
| Groq | `https://api.groq.com/openai/v1` | from console.groq.com/keys | `openai/gpt-oss-120b` | deployed demo, free tier |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/openai/` | from aistudio.google.com/apikey | `gemini-3.8-flash` | fallback, free tier |

Model IDs checked against each provider's docs on 2026-11-17. Groq shut down `llama-3.3-70b-versatile` for free/dev tiers on 2026-08-16, and Gemini deprecated `gemini-2.5-flash`, so the presets use their recommended successors.

Requests use temperature 0. On a provider 429 the server waits for `retry-after` once, then returns a "rate limited, try again" error. `/api/query` also allows 10 questions per minute per IP so the public demo can't burn the free quota.

## Run locally

```bash
ollama pull qwen2.5-coder:7b
cp .env.example .env   # fill in DATABASE_URL and EDGAR_USER_AGENT
npm install
npm run dev            # http://localhost:3000
```

## Ingest (local)

```bash
python -m venv .venv && .venv/Scripts/pip install -r ingest/requirements.txt   # bin/ on macOS/Linux
psql "$DATABASE_URL" -f db/schema.sql
cd ingest && python tickers.py && python prices.py && python news.py && python filings.py
```

The `ingest` GitHub Action runs the same scripts daily; it needs `DATABASE_URL` and `EDGAR_USER_AGENT` repo secrets.
