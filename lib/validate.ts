import { Parser } from "node-sql-parser";

const parser = new Parser();
const OPT = { database: "PostgresQL" };

export type Validation = { ok: true; sql: string } | { ok: false; error: string };

/** Phase 2 baseline: must parse as exactly one SELECT. Full guardrails come in Phase 3. */
export function validate(sql: string): Validation {
  let ast;
  try {
    ast = parser.astify(sql, OPT);
  } catch (e) {
    return { ok: false, error: `SQL does not parse: ${(e as Error).message}` };
  }
  const stmts = Array.isArray(ast) ? ast : [ast];
  if (stmts.length !== 1) return { ok: false, error: "Exactly one statement is allowed." };
  if (stmts[0].type !== "select") return { ok: false, error: `Only SELECT is allowed, got ${stmts[0].type.toUpperCase()}.` };
  return { ok: true, sql };
}
