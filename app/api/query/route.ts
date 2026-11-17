import { runReadOnly } from "@/lib/db";
import { type Attempt, generateSql, RateLimitedError } from "@/lib/llm";
import { getSchema } from "@/lib/schema";
import { validate } from "@/lib/validate";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_RETRIES = 2;
const LIMIT = 10;
const WINDOW_MS = 60_000;
// shortcut: in-memory, so each serverless instance counts separately and a cold start resets it;
// move to Upstash/Vercel KV if the public demo gets abused.
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 10_000) hits.clear(); // crude bound on memory
  return recent.length > LIMIT;
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  if (rateLimited(ip)) {
    return Response.json({ error: `Too many questions: limit is ${LIMIT} per minute. Try again shortly.` }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question || question.length > 500) {
    return Response.json({ error: "Ask a question (max 500 characters)." }, { status: 400 });
  }

  let sql = "";
  const attempts: Attempt[] = [];
  try {
    const schema = await getSchema();
    // Up to 1 + MAX_RETRIES generations; parse and Postgres errors go back to the model to fix.
    for (;;) {
      sql = await generateSql(question, schema.prompt, schema.latestPriceDate, attempts);
      const v = validate(sql);
      let error: string;
      if (v.ok) {
        try {
          const { columns, rows } = await runReadOnly(v.sql);
          const warnings: string[] = [];
          if (attempts.length) warnings.push(`Fixed after ${attempts.length} failed attempt${attempts.length > 1 ? "s" : ""}.`);
          if (rows.length === 0) warnings.push("The query returned no rows.");
          return Response.json({ sql, columns, rows, warnings });
        } catch (e) {
          error = `Postgres error: ${(e as Error).message}`;
        }
      } else {
        error = v.error;
      }
      attempts.push({ sql, error });
      if (attempts.length > MAX_RETRIES) {
        return Response.json({ error: `Couldn't produce a working query after ${attempts.length} tries. Last error: ${error}`, sql }, { status: 422 });
      }
    }
  } catch (e) {
    if (e instanceof RateLimitedError) return Response.json({ error: e.message }, { status: 429 });
    console.error(e);
    return Response.json({ error: (e as Error).message, sql: sql || undefined }, { status: 500 });
  }
}
