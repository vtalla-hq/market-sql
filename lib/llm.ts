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

const HEADER = `You translate questions about US stock market data into PostgreSQL.

Rules:
- Output only the SQL: no prose, no markdown fences, no SQL comments.
`;

// Prompt-level guardrails. Part of "guardrails ON"; the eval's OFF baseline leaves them out.
const SAFETY = `- Output exactly one read-only SELECT statement (CTEs allowed).
- Use only the tables and columns listed below. Do not reference any other table, schema or function that reads data outside them.
- Return at most 1000 rows.
- If the question cannot be answered from these tables (missing data, or a request to modify data or read anything else), reply with exactly CANNOT_ANSWER: followed by a one-sentence reason, instead of SQL. Never substitute a query that answers a different question.
`;

// Accuracy tips, used in both modes so the eval compares guardrails, not prompt quality.
const TIPS = `- When joining, give every table an alias and prefix every column with it (p.symbol, t.sector), including in GROUP BY and ORDER BY.
- Window functions always need OVER: lag(p.close) OVER (PARTITION BY p.symbol ORDER BY p.date). Compute them in a CTE, then filter or aggregate in the outer query (you cannot nest a window function inside an aggregate).
- Prefer clear column aliases (e.g. pct_change, avg_close) and order results meaningfully.
- Return the columns a reader needs to understand each row: always include the date for anything over time, and the symbol (or sector) for anything per stock (or per sector).
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

const prompt = (hardened: boolean) => HEADER + (hardened ? SAFETY : "") + TIPS;

export type Attempt = { sql: string; error: string };

/** Asks the model for SQL. `previous` holds failed attempts so the model can fix them. */
export async function generateSql(question: string, schemaPrompt: string, latestPriceDate: string, previous: Attempt[] = [], hardened = true): Promise<string> {
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: prompt(hardened) + schemaPrompt },
    { role: "user", content: `Latest trading date in prices: ${latestPriceDate}\n\nQuestion: ${question}` },
  ];
  for (const a of previous) {
    messages.push({ role: "assistant", content: a.sql });
    messages.push({ role: "user", content: `That query was rejected: ${a.error}\nReturn a corrected query.` });
  }
  const res = await withRateLimitRetry(() => client.chat.completions.create({ model: LLM.model, temperature: 0, messages }));
  const text = res.choices[0]?.message?.content ?? "";
  if (!text.trim()) throw new Error("The model returned an empty response.");
  const cannot = text.match(/CANNOT_ANSWER:?\s*(.*)/i);
  if (cannot) throw new UnanswerableError(cannot[1].trim().slice(0, 300) || "the data doesn't cover it");
  return cleanSql(text);
}

export class UnanswerableError extends Error {
  constructor(reason: string) {
    super(`This question can't be answered from the available data: ${reason}`);
  }
}

/** Second pass for empty or all-null results: does this SQL actually answer the question? */
export async function judgeSql(question: string, sql: string, outcome: string, schemaPrompt: string): Promise<{ answers: boolean | null; reason: string }> {
  const res = await withRateLimitRetry(() =>
    client.chat.completions.create({
      model: LLM.model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You review SQL written for this stock market database.\n\n" + schemaPrompt + "\n\n" +
            "The query below returned an empty or all-null result. Judge only the SQL's logic: would it return the right rows " +
            "if matching data existed? Reply YES if the logic is right (the data may just have no matches, e.g. outside the " +
            "date range a table covers), or NO if the logic is wrong (wrong filter, join, column, date math or sort). " +
            "First line: YES or NO. Second line: one short sentence why.",
        },
        { role: "user", content: `Question: ${question}\n\nSQL:\n${sql}\n\nResult: ${outcome}` },
      ],
    }),
  );
  return parseVerdict(res.choices[0]?.message?.content ?? "");
}

/** First standalone YES/NO wins; small models don't always put it on line one. null = no verdict. */
export function parseVerdict(text: string): { answers: boolean | null; reason: string } {
  const m = text.match(/\b(YES|NO)\b/) ?? text.match(/\b(yes|no)\b/i);
  const reason = text.replace(/\b(YES|NO)\b[.:,]?/, "").replace(/\s+/g, " ").trim().slice(0, 300);
  return { answers: m ? m[1].toLowerCase() === "yes" : null, reason };
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
