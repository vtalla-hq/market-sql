/** Infers what a result column holds from its name and values, and formats values for people. */

export type Kind = "percent" | "pctUnits" | "currency" | "count" | "number" | "date" | "label" | "text";

const isDateStr = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function columnKind(name: string, values: unknown[]): Kind {
  const n = name.toLowerCase();
  const vals = values.filter((v) => v !== null && v !== undefined);
  if (!vals.length) return "text";
  if (vals.every(isDateStr)) return "date";
  if (vals.every((v) => typeof v === "boolean")) return "label";
  if (vals.every(isNum)) {
    const ints = vals.every((v) => Number.isInteger(v));
    // Ordinal integers (years, months) and ids read as categories, not magnitudes.
    if (ints && /(^|_)(id|year|month|day|dow|quarter|week|yr)$/.test(n)) return "label";
    const maxAbs = Math.max(...vals.map((v) => Math.abs(v as number)));
    if (/(pct|percent)/.test(n)) return maxAbs >= 2 ? "pctUnits" : "percent";
    if (/(return|change|ytd|drawdown|volatility|vol_|stddev|range|growth|(^|_)r$|ratio)/.test(n) && maxAbs < 50) return "percent";
    if (/(close|open|high|low|price|(^|_)ma$|moving|sma|avg_close|peak)/.test(n) && !/volume/.test(n)) return "currency";
    if (ints || /(volume|count|num|total|filings|headlines|(^|_)n$)/.test(n)) return "count";
    return "number";
  }
  // Short strings label things (symbols, sectors); long ones (headlines, URLs) are just text.
  return vals.every((v) => String(v).length <= 60) ? "label" : "text";
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function format(v: unknown, kind: Kind, opts: { signed?: boolean } = {}): string {
  if (v === null || v === undefined) return "—";
  if (kind === "date") return String(v).slice(0, 10);
  if (!isNum(v)) return String(v);
  const sign = opts.signed && v > 0 ? "+" : "";
  switch (kind) {
    case "percent": {
      const p = v * 100;
      return `${sign}${p.toFixed(Math.abs(p) < 10 ? 2 : 1)}%`;
    }
    case "pctUnits":
      return `${sign}${v.toFixed(Math.abs(v) < 10 ? 2 : 1)}%`;
    case "currency":
      return Math.abs(v) >= 1e6 ? `$${compact.format(v)}` : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case "count":
      return Math.abs(v) >= 1e5 ? compact.format(v) : whole.format(v);
    default:
      return Math.abs(v) >= 1e5 ? compact.format(v) : Number(v.toPrecision(4)).toLocaleString("en-US");
  }
}

/** Short axis-tick version: no cents, compact numbers. */
export function formatTick(v: number, kind: Kind): string {
  if (kind === "percent") return `${(v * 100).toFixed(Math.abs(v) < 0.1 && v !== 0 ? 1 : 0)}%`;
  if (kind === "pctUnits") return `${v.toFixed(Math.abs(v) < 10 && v !== 0 ? 1 : 0)}%`;
  if (kind === "currency") return `$${compact.format(v)}`;
  return compact.format(v);
}

/** pct_change -> "Pct change", ytd -> "YTD". */
export function humanize(col: string): string {
  const words = col.replace(/[_\s]+/g, " ").trim().split(" ");
  const out = words.map((w) => (/^(ytd|ma|sma|pe|eps|id|cik)$/i.test(w) ? w.toUpperCase() : w.toLowerCase()));
  const s = out.join(" ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Changes and returns read better with an explicit + sign. */
export const isSigned = (kind: Kind, col: string) => (kind === "percent" || kind === "pctUnits") && !/(range|volatility|stddev)/i.test(col);
