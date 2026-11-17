"use client";

import { useEffect, useState } from "react";
import { columnKind, format, humanize, isSigned } from "@/lib/format";
import { Chart, Sparkline } from "./Chart";

const SUGGESTIONS = [
  { topic: "Prices", color: "var(--series-1)", q: "AAPL closing price over the last year" },
  { topic: "Prices", color: "var(--series-1)", q: "Compare NVDA, AMD and INTC closing prices in 2025" },
  { topic: "Returns", color: "var(--series-3)", q: "Year-to-date return for every stock" },
  { topic: "Returns", color: "var(--series-3)", q: "Biggest single-day drops for NVDA" },
  { topic: "Sectors", color: "var(--series-7)", q: "Which sector had the best average return in 2025?" },
  { topic: "Sectors", color: "var(--series-7)", q: "Total trading volume per sector in 2025" },
  { topic: "Filings", color: "var(--series-2)", q: "Stocks that fell more than 5% within 3 days after an 8-K filing" },
  { topic: "Insiders", color: "var(--series-2)", q: "Which companies had the most insider (Form 4) filings this year?" },
  { topic: "Volume", color: "var(--series-4)", q: "Top 10 stocks by total volume last month" },
];

type Result = { sql?: string; columns?: string[]; rows?: unknown[][]; warnings?: string[]; error?: string; guardrail?: string | null; attempts?: number };
type Ticker = { symbol: string; name: string; closes: number[]; dates: string[] };

const SearchIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
);

function Search({ value, onChange, onSubmit, loading, big }: { value: string; onChange: (v: string) => void; onSubmit: () => void; loading: boolean; big?: boolean }) {
  return (
    <form className={`search${big ? " big" : ""}`} onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      <SearchIcon />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Ask about prices, returns, sectors, SEC filings…" aria-label="Question" maxLength={500} autoFocus={big} />
      <button disabled={loading || !value.trim()}>{loading ? "Thinking…" : "Ask"}</button>
    </form>
  );
}

export default function Home() {
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [tickers, setTickers] = useState<Ticker[] | null>(null);

  useEffect(() => {
    fetch("/api/snapshot").then((r) => r.json()).then((d) => setTickers(d.tickers ?? [])).catch(() => setTickers([]));
  }, []);

  async function ask(q: string) {
    if (!q.trim() || loading) return;
    setQuestion(q);
    setAsked(q);
    setLoading(true);
    setResult(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
    try {
      const res = await fetch("/api/query", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q }) });
      setResult(await res.json());
    } catch (e) {
      setResult({ error: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }

  const home = asked === null;

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <button className="brand" onClick={() => { setAsked(null); setResult(null); setQuestion(""); }} aria-label="market-sql home">
            <span className="brand-mark">M</span>market-sql
          </button>
          {!home && <Search value={question} onChange={setQuestion} onSubmit={() => ask(question)} loading={loading} />}
          {home && <span style={{ flex: 1 }} />}
          <a className="gh" href="https://github.com/vtalla-hq/market-sql" target="_blank" rel="noreferrer">GitHub ↗</a>
        </div>
      </header>

      <main>
        {home ? (
          <>
            <section className="hero">
              <span className="pill"><i />50 S&amp;P 500 stocks · 5 years of prices · SEC filings · news</span>
              <h1>Ask the market <span>anything</span>.</h1>
              <p>Plain English in, PostgreSQL out. Every query is checked by six guardrails and runs read-only.</p>
              <Search value={question} onChange={setQuestion} onSubmit={() => ask(question)} loading={loading} big />
            </section>

            <div className="section-title"><span>Last 3 months</span><span>Tap a card to ask about it</span></div>
            <div className="strip">
              {tickers === null
                ? Array.from({ length: 4 }, (_, k) => <div key={k} className="skeleton" />)
                : tickers.map((t) => {
                    const first = t.closes[0], last = t.closes[t.closes.length - 1];
                    const chg = (last - first) / first, up = chg >= 0;
                    return (
                      <button key={t.symbol} className="ticker" onClick={() => ask(`${t.symbol} closing price over the last 3 months`)}>
                        <div className="ticker-top">
                          <span className="ticker-sym">{t.symbol}</span>
                          <span className={`delta ${up ? "up" : "down"}`}>{up ? "↗" : "↘"} {format(chg, "percent", { signed: true })}</span>
                        </div>
                        <div className="ticker-name">{t.name}</div>
                        <div className="ticker-price num">{format(last, "currency")}</div>
                        <Sparkline values={t.closes} up={up} />
                      </button>
                    );
                  })}
            </div>

            <div className="section-title"><span>Try asking</span></div>
            <div className="suggest">
              {SUGGESTIONS.map((s) => (
                <button key={s.q} className="card-q" onClick={() => ask(s.q)}>
                  <small><i style={{ background: s.color }} />{s.topic}</small>
                  {s.q}
                </button>
              ))}
            </div>

            <div className="section-title"><span>How it stays safe</span></div>
            <div className="guard">
              <div><b>Read-only role</b>SELECT on four tables only, 5s timeout, rolled-back transaction.</div>
              <div><b>Parsed & grounded</b>One SELECT, no other schemas or server functions, every column checked against the real schema.</div>
              <div><b>Measured</b>Eval of 40 gold questions and 15 attacks: 15/15 blocked with guardrails on.</div>
            </div>
          </>
        ) : (
          <article className="answer" aria-busy={loading}>
            <div className="answer-head">
              <h2 className="answer-q">{asked}</h2>
              {result && !loading && <Meta result={result} />}
            </div>
            {loading ? (
              <div className="loading" aria-label="Loading"><div style={{ width: "40%" }} /><div style={{ height: 220 }} /><div style={{ width: "70%" }} /></div>
            ) : (
              result && <AnswerBody result={result} />
            )}
          </article>
        )}
        <footer>Data: Yahoo Finance, SEC EDGAR, CNBC / MarketWatch / PR Newswire RSS. Not investment advice.</footer>
      </main>
    </>
  );
}

function Meta({ result }: { result: Result }) {
  const fixed = result.warnings?.find((w) => w.startsWith("Fixed after"));
  return (
    <div className="meta">
      {result.rows && <span className="chip ok"><i />{result.rows.length} row{result.rows.length === 1 ? "" : "s"} · passed guardrails</span>}
      {result.error && result.guardrail && <span className="chip">guardrail: {result.guardrail.replace(/_/g, " ")}</span>}
      {fixed && <span className="chip">self-corrected after {result.attempts! - 1} retr{result.attempts! - 1 === 1 ? "y" : "ies"}</span>}
    </div>
  );
}

function AnswerBody({ result }: { result: Result }) {
  const [copied, setCopied] = useState(false);
  const warnings = (result.warnings ?? []).filter((w) => !w.startsWith("Fixed after"));
  return (
    <>
      <div className="answer-body">
        {result.error && <div className="note err" role="alert">{result.error}</div>}
        {warnings.map((w) => <div key={w} className="note warn">{w}</div>)}
        {result.columns && result.rows && (
          <>
            <Chart columns={result.columns} rows={result.rows} />
            {result.rows.length > 0 && !(result.rows.length === 1 && result.columns.length === 1) && <ResultTable columns={result.columns} rows={result.rows} />}
          </>
        )}
      </div>
      {result.sql && (
        <details className="sql">
          <summary>
            <span>Generated SQL</span>
            <button type="button" className="copy" onClick={(e) => { e.preventDefault(); navigator.clipboard?.writeText(result.sql!); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
              {copied ? "Copied" : "Copy"}
            </button>
          </summary>
          <pre>{result.sql}</pre>
        </details>
      )}
    </>
  );
}

function ResultTable({ columns, rows }: { columns: string[]; rows: unknown[][] }) {
  const kinds = columns.map((c, i) => columnKind(c, rows.map((r) => r[i])));
  const numeric = (k: string) => k === "percent" || k === "pctUnits" || k === "currency" || k === "count" || k === "number";
  return (
    <>
      <div className="table-head"><span>{rows.length} row{rows.length === 1 ? "" : "s"}</span></div>
      <div className="table-wrap">
        <table>
          <thead><tr>{columns.map((c, i) => <th key={i} className={numeric(kinds[i]) ? "num" : undefined}>{humanize(c)}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((v, j) => {
                  const k = kinds[j];
                  const signed = isSigned(k, columns[j]);
                  const text = format(v, k, { signed });
                  const isUrl = typeof v === "string" && v.startsWith("https://");
                  return (
                    <td key={j} className={numeric(k) ? "num" : k === "text" ? "wrap" : undefined} title={v === null ? undefined : String(v)}>
                      {isUrl ? <a href={v as string} target="_blank" rel="noreferrer">open ↗</a>
                        : signed && typeof v === "number" && v !== 0 ? <span className={`delta ${v > 0 ? "up" : "down"}`}>{text}</span>
                        : text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
