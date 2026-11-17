import { describe, expect, it } from "vitest";
import { check, hasComment, MAX_ROWS, type SchemaColumns } from "./guardrails";

const SCHEMA: SchemaColumns = {
  tickers: ["symbol", "name", "sector", "industry"],
  prices: ["symbol", "date", "open", "high", "low", "close", "volume"],
  news: ["id", "symbol", "published_at", "headline", "source", "url"],
  filings: ["id", "symbol", "filed_at", "form_type", "url"],
};

const ok = (sql: string) => {
  const r = check(sql, SCHEMA);
  if (!r.ok) throw new Error(`expected ok, got ${r.guardrail}: ${r.error}`);
  return r;
};
const blocked = (sql: string, guardrail: string, retryable = false) => {
  const r = check(sql, SCHEMA);
  expect(r.ok, `expected ${guardrail} to fire`).toBe(false);
  if (!r.ok) {
    expect(r.guardrail).toBe(guardrail);
    expect(r.retryable).toBe(retryable);
  }
};

describe("valid queries pass", () => {
  it.each([
    ["simple", "select symbol, close from prices where symbol = 'AAPL' order by date desc limit 10"],
    ["join with aliases", "select t.sector, avg(p.close) as avg_close from prices p join tickers t on p.symbol = t.symbol group by t.sector order by avg_close desc limit 5"],
    ["cte + window", "with r as (select p.symbol, p.date, p.close / lag(p.close) over (partition by p.symbol order by p.date) - 1 as pct_change from prices p) select r.date, r.pct_change from r where r.pct_change is not null order by r.pct_change limit 10"],
    ["lateral joins", "with f as (select f.symbol, f.filed_at from filings f where f.form_type = '10-K') select f.symbol, b.close from f join lateral (select p.close from prices p where p.symbol = f.symbol and p.date < f.filed_at order by p.date desc limit 1) b on true limit 100"],
    ["subquery alias", "select x.c from (select close as c from prices) x limit 5"],
    ["order by select alias", "select symbol, sum(volume) as total from prices group by symbol order by total desc limit 10"],
    ["group by ordinal", "select sector, count(*) from tickers group by 1 limit 20"],
    ["dates and casts", "select date_trunc('month', p.date) as m, extract(year from p.date)::int as y, max(p.close) from prices p where p.date > date '2024-01-01' - interval '30 days' group by 1, 2 limit 100"],
    ["exists subquery", "select t.symbol from tickers t where exists (select 1 from filings f where f.symbol = t.symbol and f.form_type = '8-K') limit 50"],
    ["dashes inside a string literal", "select headline from news where headline like '%--%' limit 5"],
    ["news timestamps", "select n.symbol, n.published_at::date as d, count(*) from news n group by 1, 2 limit 100"],
  ])("%s", (_, sql) => {
    ok(sql);
  });
});

describe("LIMIT is enforced", () => {
  it("keeps a small literal limit untouched", () => {
    const sql = "select * from tickers limit 10";
    expect(ok(sql)).toEqual({ ok: true, sql, limited: false });
  });
  it("caps a missing limit", () => {
    const r = ok("select * from prices");
    expect(r.limited).toBe(true);
    expect(r.sql).toMatch(new RegExp(`limit ${MAX_ROWS}$`));
  });
  it("caps a limit above the max", () => {
    expect(ok("select * from prices order by date desc limit 5000").limited).toBe(true);
  });
});

describe("writes and non-SELECT statements are blocked", () => {
  it.each([
    ["DROP", "drop table prices"],
    ["DELETE", "delete from news"],
    ["UPDATE", "update prices set close = 0"],
    ["INSERT", "insert into tickers values ('X', 'x', 'x', 'x')"],
    ["TRUNCATE", "truncate filings"],
    ["GRANT", "grant select on prices to public"],
    ["ALTER", "alter table prices add column x int"],
    ["CREATE", "create table x as select * from prices"],
    ["SELECT INTO", "select * into stolen from prices"],
  ])("%s", (_, sql) => {
    expect(check(sql, SCHEMA).ok).toBe(false);
  });
  it("data-modifying CTE does not get through", () => {
    expect(check("with d as (delete from prices returning *) select * from d", SCHEMA).ok).toBe(false);
  });
  it("SELECT INTO is classed as a write", () => blocked("select * into stolen from prices", "not_select"));
});

describe("stacked statements and comments are blocked", () => {
  it("stacked DROP", () => blocked("select 1; drop table prices", "multi_statement"));
  it("two selects", () => blocked("select 1; select 2", "multi_statement"));
  it("line comment", () => blocked("select * from prices -- ignore the limit", "comment"));
  it("block comment hiding text", () => blocked("select /* hi */ symbol from tickers", "comment"));
  it("dollar quoting", () => blocked("select $$x$$", "comment"));
  it("comment scanner ignores quoted text", () => {
    expect(hasComment(`select '--not a comment', "a/*b" from t`)).toBe(false);
    expect(hasComment("select 'it''s' -- real comment")).toBe(true);
  });
});

describe("other schemas and server functions are blocked", () => {
  it("information_schema", () => blocked("select * from information_schema.tables", "forbidden_schema"));
  it("pg_catalog", () => blocked("select usename from pg_catalog.pg_user", "forbidden_schema"));
  it("unqualified catalog table", () => blocked("select rolname, rolpassword from pg_authid", "forbidden_schema"));
  it("query_log", () => blocked("select * from private.query_log", "forbidden_schema"));
  it("pg_sleep", () => blocked("select pg_sleep(30)", "forbidden_function"));
  it("pg_read_file", () => blocked("select pg_read_file('/etc/passwd')", "forbidden_function"));
  it("set_config", () => blocked("select set_config('statement_timeout', '0', false)", "forbidden_function"));
  it("current_setting", () => blocked("select current_setting('server_version')", "forbidden_function"));
  it("schema-qualified function", () => blocked("select private.log_query('x', null, null, 'ok', 1, 0, 1, 'm', null)", "forbidden_function"));
  it("pg_catalog-qualified function", () => blocked("select pg_catalog.now()", "forbidden_function"));
  it("pg_sleep hidden in a where clause", () => blocked("select symbol from tickers where pg_sleep(10) is not null", "forbidden_function"));
});

describe("hallucinated identifiers are caught and retryable", () => {
  it("unknown table", () => blocked("select * from earnings limit 5", "unknown_table", true));
  it("unknown qualified column", () => blocked("select p.adj_close from prices p limit 5", "unknown_column", true));
  it("unknown unqualified column", () => blocked("select symbol, market_cap from tickers limit 5", "unknown_column", true));
  it("column from a table not in the query", () => blocked("select sector from prices limit 5", "unknown_column", true));
  it("unknown alias", () => blocked("select z.close from prices p limit 5", "unknown_table", true));
  it("unparseable SQL is retryable", () => blocked("selec symbol frm tickers", "parse", true));
  it("error names the real columns", () => {
    const r = check("select p.adj_close from prices p", SCHEMA);
    expect(!r.ok && r.error).toContain("open, high, low, close");
  });
});
