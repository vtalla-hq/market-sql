import { describe, expect, it } from "vitest";
import { columnKind, format, humanize } from "./format";

describe("columnKind", () => {
  it("dates", () => expect(columnKind("date", ["2025-01-02", "2025-01-03"])).toBe("date"));
  it("fractional returns are percent", () => expect(columnKind("pct_change", [-0.17, 0.05])).toBe("percent"));
  it("returns already x100 are percent units", () => expect(columnKind("pct_change", [-16.9, 5.2])).toBe("pctUnits"));
  it("big total returns stay fractions", () => expect(columnKind("total_return", [1.79, 0.2])).toBe("percent"));
  it("prices are currency", () => expect(columnKind("close", [352.78])).toBe("currency"));
  it("volume is a count", () => expect(columnKind("total_volume", [4508296100.5])).toBe("count"));
  it("integers are counts", () => expect(columnKind("n", [7, 6])).toBe("count"));
  it("years are labels", () => expect(columnKind("year", [2024, 2025])).toBe("label"));
  it("symbols are labels", () => expect(columnKind("symbol", ["AAPL", "MSFT"])).toBe("label"));
  it("booleans are labels", () => expect(columnKind("has_8k", [true, false])).toBe("label"));
  it("headlines are text", () => expect(columnKind("headline", ["x".repeat(80)])).toBe("text"));
});

describe("format", () => {
  it("percent: 1 decimal at 10%+", () => expect(format(-0.1697, "percent")).toBe("-17.0%"));
  it("percent: 2 decimals under 10%", () => expect(format(0.01234, "percent")).toBe("1.23%"));
  it("signed percent", () => expect(format(0.302, "percent", { signed: true })).toBe("+30.2%"));
  it("currency", () => expect(format(352.78, "currency")).toBe("$352.78"));
  it("compact count", () => expect(format(4508296100, "count")).toBe("4.5B"));
  it("small count", () => expect(format(1234, "count")).toBe("1,234"));
  it("null", () => expect(format(null, "number")).toBe("—"));
});

describe("humanize", () => {
  it("snake case", () => expect(humanize("pct_change")).toBe("Pct change"));
  it("acronyms", () => expect(humanize("ytd")).toBe("YTD"));
});
