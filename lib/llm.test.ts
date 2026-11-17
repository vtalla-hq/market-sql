import { describe, expect, it } from "vitest";
import { cleanSql, parseVerdict } from "./llm";

describe("parseVerdict", () => {
  it("reads YES on line one", () => expect(parseVerdict("YES\nIt filters on 2019 news.").answers).toBe(true));
  it("reads NO on line one", () => expect(parseVerdict("NO\nIt ignores the 8-K filter.").answers).toBe(false));
  it("finds a verdict after preamble", () => expect(parseVerdict("The SQL is fine. Verdict: YES.").answers).toBe(true));
  it("does not treat 'not' or 'know' as no", () => expect(parseVerdict("I do not know enough to say.").answers).toBe(null));
  it("prefers an uppercase verdict over a lowercase word", () => expect(parseVerdict("There are no rows, but YES the SQL is right").answers).toBe(true));
});

describe("cleanSql", () => {
  it("passes plain SQL through", () => expect(cleanSql("select 1")).toBe("select 1"));
  it("strips ```sql fences", () => expect(cleanSql("```sql\nselect 1;\n```")).toBe("select 1"));
  it("strips bare ``` fences", () => expect(cleanSql("```\nselect 1\n```")).toBe("select 1"));
  it("ignores prose around a fenced block", () =>
    expect(cleanSql("Here is the query:\n```sql\nselect symbol from tickers\n```\nThis lists symbols.")).toBe("select symbol from tickers"));
  it("drops a trailing semicolon", () => expect(cleanSql("select 1;  ")).toBe("select 1"));
});
