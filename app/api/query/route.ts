import { answer } from "@/lib/answer";

export const runtime = "nodejs";
export const maxDuration = 60;

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

const STATUS = { ok: 200, blocked: 422, failed: 422, rate_limited: 429, error: 500 } as const;

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
  const a = await answer(question);
  return Response.json(
    { sql: a.sql, columns: a.columns, rows: a.rows, warnings: a.warnings, error: a.error, guardrail: a.guardrail, attempts: a.attempts },
    { status: STATUS[a.outcome] },
  );
}
