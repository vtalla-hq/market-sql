import { runReadOnly } from "@/lib/db";

export const runtime = "nodejs";
export const revalidate = 3600; // data changes once a day

// Fixed query for the home page's market strip; no LLM involved.
const SQL = `
select p.symbol, t.name, p.date, p.close
from prices p join tickers t on t.symbol = p.symbol
where p.symbol in ('NVDA', 'AAPL', 'MSFT', 'TSLA')
  and p.date > (select max(date) from prices) - interval '3 months'
order by p.symbol, p.date`;

export async function GET() {
  try {
    const { rows } = await runReadOnly(SQL);
    const by = new Map<string, { symbol: string; name: string; closes: number[]; dates: string[] }>();
    for (const [symbol, name, date, close] of rows as [string, string, string, number][]) {
      const s = by.get(symbol) ?? { symbol, name, closes: [], dates: [] };
      s.closes.push(close);
      s.dates.push(date);
      by.set(symbol, s);
    }
    return Response.json({ tickers: ["NVDA", "AAPL", "MSFT", "TSLA"].map((s) => by.get(s)).filter(Boolean) });
  } catch (e) {
    console.error(e);
    return Response.json({ tickers: [] }, { status: 500 });
  }
}
