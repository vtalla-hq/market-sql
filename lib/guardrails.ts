import { Parser } from "node-sql-parser";

const parser = new Parser();
const OPT = { database: "PostgresQL" };
export const MAX_ROWS = 1000;

/** blocked: refuse outright. hallucination / parse: send the error back to the LLM for a retry. */
export type Guardrail = "comment" | "parse" | "multi_statement" | "not_select" | "forbidden_schema" | "forbidden_function" | "unknown_table" | "unknown_column";
export type Check = { ok: true; sql: string; limited: boolean } | { ok: false; guardrail: Guardrail; retryable: boolean; error: string };

/** table -> its columns, as loaded from information_schema */
export type SchemaColumns = Record<string, string[]>;

const WRITE_TYPES = new Set(["insert", "update", "delete", "replace", "create", "drop", "alter", "truncate", "rename", "grant", "revoke", "merge", "copy", "call", "set", "lock", "transaction", "use", "load_data", "exec"]);
// Functions that touch the server, sessions or other data rather than computing over rows.
const FORBIDDEN_FN = /^(pg_|lo_|dblink|set_config|current_setting|query_to_|table_to_|cursor_to_|schema_to_|database_to_|txid_|version$|inet_)/i;

const fail = (guardrail: Guardrail, error: string, retryable = false): Check => ({ ok: false, guardrail, retryable, error });

/** Runs every parser-level guardrail; returns SQL safe to execute (LIMIT enforced) or the first failure. */
export function check(sql: string, schema: SchemaColumns): Check {
  if (hasComment(sql)) return fail("comment", "SQL comments are not allowed.");

  let ast: any;
  try {
    ast = parser.astify(sql, OPT);
  } catch (e) {
    return fail("parse", `SQL does not parse as PostgreSQL: ${(e as Error).message.split("\n")[0]}`, true);
  }
  const stmts = Array.isArray(ast) ? ast : [ast];
  if (stmts.length !== 1) return fail("multi_statement", "Exactly one statement is allowed.");
  const root = stmts[0];
  if (root?.type !== "select") return fail("not_select", `Only SELECT is allowed, got ${String(root?.type).toUpperCase()}.`);

  // Walk the whole tree once, collecting what the grounding checks need.
  const tables: { db: string | null; table: string; as: string | null }[] = [];
  const derived = new Set<string>(); // CTE names, subquery aliases, select-list aliases
  const columns: { table: string | null; column: string }[] = [];
  const functions: string[][] = [];
  let writes = null as string | null; // assigned inside the walk callback, so keep TS from narrowing to null
  let selectInto = false as boolean;

  walk(root, (n) => {
    if (typeof n.type === "string" && WRITE_TYPES.has(n.type.toLowerCase())) writes ??= n.type;
    if (n.type === "select" && n.into?.expr) selectInto = true;
    if (Array.isArray(n.with)) for (const w of n.with) derived.add(lc(w.name?.value ?? w.name));
    if (Array.isArray(n.from)) {
      for (const f of n.from) {
        if (typeof f.table === "string") tables.push({ db: f.db ?? null, table: lc(f.table), as: f.as ? lc(f.as) : null });
        else if (f.as) derived.add(lc(f.as));
      }
    }
    if (n.type === "expr" && typeof n.as === "string") derived.add(lc(n.as));
    if (n.type === "column_ref") {
      const col = typeof n.column === "string" ? n.column : n.column?.expr?.value;
      if (typeof col === "string") columns.push({ table: n.table ? lc(n.table) : null, column: lc(col) });
    }
    if (n.type === "function" && Array.isArray(n.name?.name)) {
      const schemaPart = n.name.schema?.value ? [lc(n.name.schema.value)] : [];
      functions.push([...schemaPart, ...n.name.name.map((p: any) => lc(p.value))]);
    }
    if ((n.type === "window_func" || n.type === "aggr_func") && typeof n.name === "string") functions.push([lc(n.name)]);
  });

  if (writes) return fail("not_select", `Statement contains a ${writes.toUpperCase()}.`);
  if (selectInto) return fail("not_select", "SELECT INTO creates a table and is not allowed.");

  for (const f of functions) {
    if (f.length > 1) return fail("forbidden_function", `Schema-qualified function ${f.join(".")} is not allowed.`);
    if (FORBIDDEN_FN.test(f[0])) return fail("forbidden_function", `Function ${f[0]}() is not allowed.`);
  }

  // Table grounding
  const aliasToTable = new Map<string, string>();
  for (const t of tables) {
    if (t.db && lc(t.db) !== "public") return fail("forbidden_schema", `Only the public tables ${Object.keys(schema).join(", ")} may be queried, not ${t.db}.${t.table}.`);
    // Unqualified pg_* names resolve to pg_catalog through the search path (pg_authid, pg_user, pg_stat_activity...).
    if (t.table.startsWith("pg_") && !schema[t.table]) return fail("forbidden_schema", `System catalog ${t.table} may not be queried.`);
    if (!schema[t.table] && !derived.has(t.table)) {
      return fail("unknown_table", `Table "${t.table}" does not exist. Available tables: ${Object.keys(schema).join(", ")}.`, true);
    }
    if (schema[t.table]) {
      aliasToTable.set(t.table, t.table);
      if (t.as) aliasToTable.set(t.as, t.table);
    } else if (t.as) {
      derived.add(t.as);
    }
  }

  // Column grounding: qualified refs to a real table must exist in it; anything else must exist
  // in some referenced table or be an alias defined in the query.
  const used = new Set(tables.map((t) => t.table).filter((t) => schema[t]));
  const known = new Set([...derived, ...[...used].flatMap((t) => schema[t])]);
  for (const { table, column } of columns) {
    if (column === "*") continue;
    if (table && aliasToTable.has(table)) {
      const real = aliasToTable.get(table)!;
      if (!schema[real].includes(column)) {
        return fail("unknown_column", `Column ${table}.${column} does not exist. ${real} has: ${schema[real].join(", ")}.`, true);
      }
    } else if (table && !derived.has(table)) {
      return fail("unknown_table", `"${table}" in ${table}.${column} is not a table or alias in this query.`, true);
    } else if (!table && !known.has(column)) {
      return fail("unknown_column", `Column "${column}" does not exist in the tables this query uses (${[...used].join(", ") || "none"}).`, true);
    }
  }

  // LIMIT: keep a literal limit <= MAX_ROWS, otherwise wrap. Wrapping is dialect-safe (no re-printing of the AST).
  const lim = root.limit?.value?.[0];
  if (root.limit?.seperator !== "," && lim?.type === "number" && lim.value <= MAX_ROWS) return { ok: true, sql, limited: false };
  // shortcut: Postgres keeps a subquery's ORDER BY through a plain outer SELECT in practice, though the spec doesn't promise it.
  return { ok: true, sql: `select * from (\n${sql}\n) as limited limit ${MAX_ROWS}`, limited: true };
}

const lc = (s: unknown) => String(s).toLowerCase();

function walk(node: any, visit: (n: any) => void, seen = new Set<any>()) {
  if (!node || typeof node !== "object" || seen.has(node)) return;
  seen.add(node);
  if (!Array.isArray(node)) visit(node);
  for (const v of Object.values(node)) walk(v, visit, seen);
}

/** True if `--` or `/*` appears outside a quoted string or identifier. */
export function hasComment(sql: string): boolean {
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (quote) {
      if (c === quote) {
        if (sql[i + 1] === quote) i++; // '' or "" escape
        else quote = null;
      }
    } else if (c === "'" || c === '"') {
      quote = c;
    } else if ((c === "-" && sql[i + 1] === "-") || (c === "/" && sql[i + 1] === "*")) {
      return true;
    } else if (c === "$" && /^\$\w*\$/.test(sql.slice(i))) {
      return true; // dollar quoting can hide anything; models never need it for SELECTs
    }
  }
  return false;
}
