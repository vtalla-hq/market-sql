import { Pool, types } from "pg";

// JSON-friendly values: numerics as numbers, dates/timestamps as the raw strings Postgres sends.
types.setTypeParser(types.builtins.NUMERIC, parseFloat);
types.setTypeParser(types.builtins.INT8, Number); // shortcut: loses precision past 2^53, fine for counts/volume
types.setTypeParser(types.builtins.DATE, (v) => v);
types.setTypeParser(types.builtins.TIMESTAMPTZ, (v) => v);
types.setTypeParser(types.builtins.TIMESTAMP, (v) => v);

export const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });

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
