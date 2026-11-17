import { Pool, types } from "pg";

// JSON-friendly values: numerics as numbers, dates/timestamps as the raw strings Postgres sends.
types.setTypeParser(types.builtins.NUMERIC, parseFloat);
types.setTypeParser(types.builtins.INT8, Number); // shortcut: loses precision past 2^53, fine for counts/volume
types.setTypeParser(types.builtins.DATE, (v) => v);
types.setTypeParser(types.builtins.TIMESTAMPTZ, (v) => v);
types.setTypeParser(types.builtins.TIMESTAMP, (v) => v);

// The app connects as market_sql_app (db/roles.sql): SELECT on the 4 data tables only, 5s statement_timeout.
export const pool = new Pool({ connectionString: process.env.APP_DATABASE_URL, max: 3 });

export type Result = { columns: string[]; rows: unknown[][] };

/** Runs one query inside a READ ONLY transaction with a 5s timeout, then rolls back. */
export async function runReadOnly(sql: string): Promise<Result> {
  const client = await pool.connect();
  try {
    await client.query("begin read only");
    await client.query("set local statement_timeout = 5000");
    const r = await client.query({ text: sql, rowMode: "array" });
    return { columns: r.fields.map((f) => f.name), rows: r.rows };
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
  }
}

export type LogEntry = {
  question: string;
  sql: string | null;
  guardrail: string | null;
  outcome: "ok" | "blocked" | "failed" | "error" | "rate_limited";
  attempts: number;
  rowCount: number | null;
  latencyMs: number;
  model: string;
  detail: unknown;
};

/** Appends to private.query_log through a SECURITY DEFINER function; the app role can't read the log. */
export async function logQuery(e: LogEntry): Promise<void> {
  await pool
    .query("select private.log_query($1, $2, $3, $4, $5, $6, $7, $8, $9)", [
      e.question, e.sql, e.guardrail, e.outcome, e.attempts, e.rowCount, e.latencyMs, e.model, JSON.stringify(e.detail),
    ])
    .catch((err) => console.error("query_log write failed", err)); // logging must never break a request
}
