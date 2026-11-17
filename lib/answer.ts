import { logQuery, runReadOnly } from "./db";
import { check, type Guardrail, MAX_ROWS } from "./guardrails";
import { type Attempt, generateSql, judgeSql, LLM, RateLimitedError, UnanswerableError } from "./llm";
import { getSchema } from "./schema";

export const MAX_RETRIES = 2;

export type Answer = {
  outcome: "ok" | "blocked" | "failed" | "error" | "rate_limited";
  sql: string | null;
  columns?: string[];
  rows?: unknown[][];
  warnings: string[];
  error?: string;
  guardrail: Guardrail | "postgres" | "empty_result" | "unanswerable" | null; // last guardrail that fired
  attempts: number;
  latencyMs: number;
};

/** Question -> SQL -> guardrails -> read-only execution, with retries on fixable errors. Logs every call. */
export async function answer(question: string): Promise<Answer> {
  const t0 = Date.now();
  const tried: (Attempt & { guardrail: string })[] = [];
  let sql: string | null = null;

  const done = async (a: Omit<Answer, "attempts" | "latencyMs">): Promise<Answer> => {
    const full = { ...a, attempts: Math.max(1, tried.length + (a.outcome === "ok" ? 1 : 0)), latencyMs: Date.now() - t0 };
    await logQuery({
      question, sql: a.sql, guardrail: a.guardrail, outcome: a.outcome, attempts: full.attempts,
      rowCount: a.rows?.length ?? null, latencyMs: full.latencyMs, model: `${LLM.baseURL} ${LLM.model}`, detail: tried,
    });
    return full;
  };

  try {
    const schema = await getSchema();
    for (;;) {
      sql = await generateSql(question, schema.prompt, schema.latestPriceDate, tried);
      const c = check(sql, schema.columns);
      if (!c.ok && !c.retryable) {
        tried.push({ sql, error: c.error, guardrail: c.guardrail });
        return done({ outcome: "blocked", sql, warnings: [], error: `Blocked by guardrail (${c.guardrail}): ${c.error}`, guardrail: c.guardrail });
      }
      let error: string;
      let guardrail: Guardrail | "postgres";
      if (c.ok) {
        try {
          const { columns, rows } = await runReadOnly(c.sql);
          const warnings: string[] = [];
          if (tried.length) warnings.push(`Fixed after ${tried.length} rejected attempt${tried.length > 1 ? "s" : ""}: ${tried.map((t) => t.guardrail).join(", ")}.`);
          if (c.limited && rows.length === MAX_ROWS) warnings.push(`Results were cut off at ${MAX_ROWS} rows.`);
          let fired: Answer["guardrail"] = tried.at(-1)?.guardrail as Answer["guardrail"] ?? null;
          const allNull = rows.length > 0 && rows.every((r) => r.every((v) => v === null));
          if (rows.length === 0 || allNull) {
            fired = "empty_result";
            const what = rows.length === 0 ? "0 rows" : `${rows.length} rows, every value null`;
            const verdict = await judgeSql(question, sql, what, schema.prompt);
            warnings.push(
              verdict.answers === true
                ? `The query returned ${what}. A second check thinks the SQL is right, so the data may simply have no matches: ${verdict.reason}`
                : verdict.answers === false
                  ? `The query returned ${what}, and a second check thinks the SQL doesn't answer the question: ${verdict.reason}`
                  : `The query returned ${what}; a second check was inconclusive: ${verdict.reason}`,
            );
          }
          return done({ outcome: "ok", sql: c.sql, columns, rows, warnings, guardrail: fired });
        } catch (e) {
          error = `Postgres error: ${(e as Error).message}`;
          guardrail = "postgres";
        }
      } else {
        error = c.error;
        guardrail = c.guardrail;
      }
      tried.push({ sql, error, guardrail });
      if (tried.length > MAX_RETRIES) {
        return done({
          outcome: "failed", sql, warnings: [], guardrail,
          error: `Couldn't produce a valid query after ${tried.length} tries (${tried.map((t) => t.guardrail).join(", ")}). Last error: ${error}`,
        });
      }
    }
  } catch (e) {
    if (e instanceof RateLimitedError) return done({ outcome: "rate_limited", sql, warnings: [], error: e.message, guardrail: null });
    if (e instanceof UnanswerableError) return done({ outcome: "failed", sql, warnings: [], error: e.message, guardrail: "unanswerable" });
    console.error(e);
    return done({ outcome: "error", sql, warnings: [], error: (e as Error).message, guardrail: null });
  }
}
