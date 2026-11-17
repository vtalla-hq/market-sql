import OpenAI from "openai";

// One OpenAI-compatible client for every provider (Ollama, Groq, Gemini...), chosen by env.
export const LLM = {
  baseURL: process.env.LLM_BASE_URL || "http://localhost:11434/v1",
  model: process.env.LLM_MODEL || "qwen2.5-coder:7b",
};
// The SDK's own retries are off so 429s follow our single retry-after rule below.
const client = new OpenAI({ baseURL: LLM.baseURL, apiKey: process.env.LLM_API_KEY || "ollama", maxRetries: 0, timeout: 45_000 });

const MAX_RETRY_AFTER_S = 15; // keep the whole request under the serverless time limit

export class RateLimitedError extends Error {
  constructor() {
    super("The LLM provider is rate limiting us. Wait a minute and try again.");
  }
}

const INSTRUCTIONS = `You translate questions about US stock market data into one PostgreSQL query.

Rules:
- Output exactly one read-only SELECT statement (CTEs allowed) and nothing else: no prose, no markdown fences, no SQL comments.
- Use only the tables and columns listed below. Do not reference any other table, schema or function that reads data outside them.
- When joining, give every table an alias and prefix every column with it (p.symbol, t.sector), including in GROUP BY and ORDER BY.
- Window functions always need OVER: lag(p.close) OVER (PARTITION BY p.symbol ORDER BY p.date). Compute them in a CTE, then filter or aggregate in the outer query (you cannot nest a window function inside an aggregate).
- Prefer clear column aliases (e.g. pct_change, avg_close) and order results meaningfully.
- Return at most 1000 rows.
- For "recent"/"last N days" questions, anchor on the latest trading date given in the question context, not now().

Example - daily returns and the worst days for one stock:
WITH r AS (
  SELECT p.symbol, p.date, p.close / lag(p.close) OVER (PARTITION BY p.symbol ORDER BY p.date) - 1 AS pct_change
  FROM prices p WHERE p.symbol = 'MSFT'
)
SELECT r.date, r.pct_change FROM r WHERE r.pct_change IS NOT NULL ORDER BY r.pct_change ASC LIMIT 10

Example - price move in the 3 trading days after each 10-K:
WITH f AS (SELECT f.symbol, f.filed_at FROM filings f WHERE f.form_type = '10-K')
SELECT f.symbol, f.filed_at, b.close AS close_before, a.close AS close_after, a.close / b.close - 1 AS pct_change
FROM f
JOIN LATERAL (SELECT p.close FROM prices p WHERE p.symbol = f.symbol AND p.date < f.filed_at ORDER BY p.date DESC LIMIT 1) b ON true
JOIN LATERAL (SELECT p.close FROM prices p WHERE p.symbol = f.symbol AND p.date >= f.filed_at ORDER BY p.date OFFSET 2 LIMIT 1) a ON true
ORDER BY pct_change

Schema:
`;

export type Attempt = { sql: string; error: string };

/** Asks the model for SQL. `previous` holds failed attempts so the model can fix them. */
export async function generateSql(question: string, schemaPrompt: string, latestPriceDate: string, previous: Attempt[] = []): Promise<string> {
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: INSTRUCTIONS + schemaPrompt },
    { role: "user", content: `Latest trading date in prices: ${latestPriceDate}\n\nQuestion: ${question}` },
  ];
  for (const a of previous) {
    messages.push({ role: "assistant", content: a.sql });
    messages.push({ role: "user", content: `That query was rejected: ${a.error}\nReturn a corrected query.` });
  }
  const res = await withRateLimitRetry(() => client.chat.completions.create({ model: LLM.model, temperature: 0, messages }));
  const text = res.choices[0]?.message?.content ?? "";
  if (!text.trim()) throw new Error("The model returned an empty response.");
  return cleanSql(text);
}

/** On a 429, waits for retry-after once and retries; a second 429 becomes RateLimitedError. */
async function withRateLimitRetry<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (e) {
      if (!(e instanceof OpenAI.RateLimitError)) throw e;
      if (attempt > 0) throw new RateLimitedError();
      const waitS = Number(e.headers?.get("retry-after"));
      if (Number.isFinite(waitS) && waitS > MAX_RETRY_AFTER_S) throw new RateLimitedError();
      await new Promise((r) => setTimeout(r, (Number.isFinite(waitS) && waitS > 0 ? waitS : 2) * 1000));
    }
  }
}

/** Pulls the SQL out of a response: smaller models wrap it in ```sql fences or add a trailing semicolon. */
export function cleanSql(text: string): string {
  const fenced = text.match(/```(?:sql|postgresql)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim().replace(/;\s*$/, "");
}
