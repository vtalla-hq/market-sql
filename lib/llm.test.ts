import { describe, expect, it } from "vitest";
import { cleanSql } from "./llm";

describe("cleanSql", () => {
  it("passes plain SQL through", () => expect(cleanSql("select 1")).toBe("select 1"));
  it("strips ```sql fences", () => expect(cleanSql("```sql\nselect 1;\n```")).toBe("select 1"));
  it("strips bare ``` fences", () => expect(cleanSql("```\nselect 1\n```")).toBe("select 1"));
  it("ignores prose around a fenced block", () =>
    expect(cleanSql("Here is the query:\n```sql\nselect symbol from tickers\n```\nThis lists symbols.")).toBe("select symbol from tickers"));
  it("drops a trailing semicolon", () => expect(cleanSql("select 1;  ")).toBe("select 1"));
});
