import { pool } from "./db";

export const TABLES = ["tickers", "prices", "news", "filings"] as const;

export type Schema = {
  /** table -> column names, pulled from information_schema */
  columns: Record<string, string[]>;
  /** schema description fed to the LLM */
  prompt: string;
  /** most recent trading day in prices, so "last week" etc. can be anchored */
  latestPriceDate: string;
};

async function load(): Promise<Schema> {
  const { rows } = await pool.query<{ t: string; c: string; type: string; ccomment: string | null; tcomment: string | null }>(
    `select c.table_name t, c.column_name c, c.data_type type,
            col_description(format('public.%I', c.table_name)::regclass, c.ordinal_position) ccomment,
            obj_description(format('public.%I', c.table_name)::regclass) tcomment
       from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = any($1)
      order by c.table_name, c.ordinal_position`,
    [TABLES],
  );
  const columns: Record<string, string[]> = {};
  const parts: string[] = [];
  for (const t of TABLES) {
    const cols = rows.filter((r) => r.t === t);
    columns[t] = cols.map((r) => r.c);
    // t comes from the TABLES constant, never user input
    const sample = await pool.query({ text: `select * from ${t} limit 3`, rowMode: "array" });
    parts.push(
      [
        `TABLE ${t} -- ${cols[0]?.tcomment ?? ""}`,
        ...cols.map((r) => `  ${r.c} ${r.type} -- ${r.ccomment ?? ""}`),
        `  example rows (${columns[t].join(", ")}):`,
        ...sample.rows.map((r) => "    " + JSON.stringify(r)),
      ].join("\n"),
    );
  }
  const latest = await pool.query<{ d: string }>("select max(date) d from prices");
  return { columns, prompt: parts.join("\n\n"), latestPriceDate: latest.rows[0].d };
}

let cached: Promise<Schema> | null = null;

/** Loaded once per server process. */
export function getSchema(): Promise<Schema> {
  cached ??= load().catch((e) => {
    cached = null; // don't cache a failed load
    throw e;
  });
  return cached;
}
