"use client";

import { useState } from "react";
import { Chart } from "./Chart";

const EXAMPLES = [
  "AAPL closing price over the last year",
  "Which sector had the best average return in 2025?",
  "Top 10 stocks by total volume last month",
  "Stocks that fell more than 5% within 3 days after an 8-K filing",
  "Biggest single-day drops for NVDA",
  "Which companies had the most insider (Form 4) filings this year?",
];

type Result = { sql?: string; columns?: string[]; rows?: unknown[][]; warnings?: string[]; error?: string };

export default function Home() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function ask(q: string) {
    if (!q.trim()) return;
    setQuestion(q);
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/query", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q }) });
      setResult(await res.json());
    } catch (e) {
      setResult({ error: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <h1>market-sql</h1>
      <p className="muted">Ask about 50 S&amp;P 500 stocks: 5 years of daily prices, SEC filings, and recent news.</p>
      <form onSubmit={(e) => { e.preventDefault(); ask(question); }}>
        <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Which stock gained the most in 2024?" aria-label="Question" maxLength={500} />
        <button disabled={loading}>{loading ? "Thinking…" : "Ask"}</button>
      </form>
      <div className="chips">
        {EXAMPLES.map((q) => (
          <button key={q} type="button" className="chip" disabled={loading} onClick={() => ask(q)}>{q}</button>
        ))}
      </div>

      {result?.sql && (
        <details>
          <summary>Generated SQL</summary>
          <pre>{result.sql}</pre>
        </details>
      )}
      {result?.error && <div className="note err" role="alert">{result.error}</div>}
      {result?.warnings?.map((w) => <div key={w} className="note warn">{w}</div>)}
      {result?.columns && result.rows && (
        <>
          <Chart columns={result.columns} rows={result.rows} />
          <p className="muted">{result.rows.length} row{result.rows.length === 1 ? "" : "s"}</p>
          <div className="table-wrap">
            <table>
              <thead><tr>{result.columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
              <tbody>
                {result.rows.map((r, i) => (
                  <tr key={i}>{r.map((v, j) => <td key={j} className={typeof v === "number" ? "num" : undefined}>{v === null ? "" : String(v)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
