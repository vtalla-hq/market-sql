"use client";

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { columnKind, format, formatTick, humanize, isSigned, type Kind } from "@/lib/format";

type Col = { i: number; name: string; kind: Kind };
type Props = { columns: string[]; rows: unknown[][] };
type Tip = { x: number; y: number; body: ReactNode } | null;

const SERIES = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`);
const toTime = (v: unknown) => Date.parse(String(v).slice(0, 10));
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const isNumKind = (k: Kind) => k === "percent" || k === "pctUnits" || k === "currency" || k === "count" || k === "number";
/** Level-like series (prices, counts) have a meaningful start-to-end change; returns don't. */
const isLevel = (k: Kind) => k === "currency" || k === "number" || k === "count";

/** Picks the visual from the result's shape. The table below it always shows every value. */
export function Chart({ columns, rows }: Props) {
  if (!rows.length) return null;
  const cols: Col[] = columns.map((name, i) => ({ i, name, kind: columnKind(name, rows.map((r) => r[i])) }));
  const dates = cols.filter((c) => c.kind === "date");
  const nums = cols.filter((c) => isNumKind(c.kind));
  const labels = cols.filter((c) => c.kind === "label");

  if (rows.length === 1) return <StatTiles cols={cols} row={rows[0]} />;

  const date = dates[0];
  if (date && nums.length) {
    const groupOf = (r: unknown[]) => (labels[0] ? String(r[labels[0].i]) : "");
    const groups = new Set(rows.map(groupOf)).size;
    // Dates must run in order within each series (long format is often ordered by symbol, then date).
    const byGroup = new Map<string, number[]>();
    for (const r of rows) byGroup.set(groupOf(r), [...(byGroup.get(groupOf(r)) ?? []), toTime(r[date.i])]);
    const sorted = [...byGroup.values()].every((t) => t.every((x, k) => k === 0 || x >= t[k - 1]) || t.every((x, k) => k === 0 || x <= t[k - 1]));
    // A time series reads left to right; dates ranked by value (e.g. "worst days") are categories.
    if (sorted && rows.length / groups >= 3) return <Lines rows={rows} date={date} nums={nums} group={groups > 1 ? labels[0] : undefined} />;
    return <Bars rows={rows} labelOf={(r) => [labels[0] && String(r[labels[0].i]), format(r[date.i], "date")].filter(Boolean).join(" · ")} nums={nums} cols={cols} />;
  }
  if (labels.length && nums.length) {
    // Tickers are label enough; the company name moves to the tooltip.
    const short = rows.every((r) => String(r[labels[0].i]).length <= 6);
    const shown = short ? labels.slice(0, 1) : labels.slice(0, 2);
    return <Bars rows={rows} labelOf={(r) => shown.map((c) => String(r[c.i])).join(" · ")} nums={nums} cols={cols} />;
  }
  if (date && labels.length) return <Timeline rows={rows} date={date} label={labels[0]} cols={cols} />;
  if (nums.length >= 2) return <Scatter rows={rows} x={nums[0]} y={nums[1]} cols={cols} />;
  // A bare list of numbers with nothing to label them only charts when short; past that the table reads better.
  if (nums.length === 1 && rows.length <= 25) return <Bars rows={rows} labelOf={(_, k) => `#${k + 1}`} nums={nums} cols={cols} />;
  return null;
}

// ---------------------------------------------------------------------------- figures

function StatTiles({ cols, row }: { cols: Col[]; row: unknown[] }) {
  const shown = cols.filter((c) => c.kind !== "text" || String(row[c.i]).length < 120);
  const numeric = shown.filter((c) => isNumKind(c.kind));
  const hero = numeric.length === 1 && shown.length <= 3;
  if (hero) {
    const v = numeric[0];
    const context = shown.filter((c) => c !== v).map((c) => format(row[c.i], c.kind)).join(" · ");
    const n = Number(row[v.i]);
    const signed = isSigned(v.kind, v.name);
    return (
      <div className="stat" style={{ marginBottom: 16 }}>
        <span className="stat-value" style={{ fontSize: "clamp(40px, 7vw, 60px)" }}>
          {signed && n !== 0 && <span className={`delta ${n > 0 ? "up" : "down"}`} style={{ fontSize: "0.55em", marginRight: 6 }}>{n > 0 ? "↗" : "↘"}</span>}
          {format(row[v.i], v.kind, { signed })}
        </span>
        <small>{humanize(v.name)}{context && ` · ${context}`}</small>
      </div>
    );
  }
  return (
    <div className="tiles">
      {shown.map((c) => (
        <div key={c.i} className="tile">
          <div className="tile-label">{humanize(c.name)}</div>
          <div className="tile-value">{format(row[c.i], c.kind, { signed: isSigned(c.kind, c.name) })}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------- shared bits

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function Frame({ head, legend, children, tip, controls }: { head: ReactNode; legend?: { name: string; color: string }[]; children: (w: number) => ReactNode; tip: Tip; controls?: ReactNode }) {
  const [ref, w] = useWidth();
  return (
    <figure className="chart">
      <figcaption className="chart-head">
        {head}
        {controls}
      </figcaption>
      <div ref={ref} className="chart-body">
        {w > 0 && children(w)}
        {tip && (
          <div className="tip" style={{ left: Math.max(0, Math.min(tip.x + 14, w - 220)), top: tip.y + 14 }} role="status">
            {tip.body}
          </div>
        )}
      </div>
      {legend && legend.length > 1 && (
        <div className="legend">
          {legend.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}
        </div>
      )}
    </figure>
  );
}

const Title = ({ children }: { children: ReactNode }) => <span className="chart-title">{children}</span>;

function MetricPicker({ nums, value, onChange }: { nums: Col[]; value: number; onChange: (i: number) => void }) {
  if (nums.length < 2) return null;
  return (
    <span className="seg" role="group" aria-label="Metric">
      {nums.map((c, k) => (
        <button key={c.i} type="button" aria-pressed={k === value} onClick={() => onChange(k)}>{humanize(c.name)}</button>
      ))}
    </span>
  );
}

/** ~5 round tick values spanning [lo, hi]. */
function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (lo === hi) [lo, hi] = [lo - Math.abs(lo || 1) * 0.1, hi + Math.abs(hi || 1) * 0.1];
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  if (out[out.length - 1] < hi) out.push(out[out.length - 1] + step);
  return out;
}

const scale = (d0: number, d1: number, r0: number, r1: number) => (v: number) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);

function dateTicks(t0: number, t1: number, n: number): { t: number; label: string }[] {
  const long = (t1 - t0) / 864e5 > 300;
  return Array.from({ length: n }, (_, k) => {
    const t = t0 + ((t1 - t0) * k) / (n - 1);
    return { t, label: new Date(t).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", ...(long ? { year: "numeric" } : { day: "numeric" }) }) };
  });
}

function Gradient({ id, color, strength = 0.22 }: { id: string; color: string; strength?: number }) {
  return (
    <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity={strength} />
      <stop offset="100%" stopColor={color} stopOpacity={0} />
    </linearGradient>
  );
}

// ---------------------------------------------------------------------------- line

function Lines({ rows, date, nums, group }: { rows: unknown[][]; date: Col; nums: Col[]; group?: Col }) {
  const [metric, setMetric] = useState(0);
  const [tip, setTip] = useState<Tip>(null);
  const [hoverT, setHoverT] = useState<number | null>(null);
  const gid = "g" + useId().replace(/:/g, "");

  // One axis: in wide format, plot numeric columns together only if they share a unit and scale.
  const sameScale = !group && nums.length > 1 && nums.length <= 4 && nums.every((c) => c.kind === nums[0].kind) && (() => {
    const maxes = nums.map((c) => Math.max(...rows.map((r) => Math.abs(Number(r[c.i]) || 0))));
    return Math.max(...maxes) / Math.max(Math.min(...maxes), 1e-9) <= 10;
  })();
  const ys = sameScale ? nums : [nums[metric] ?? nums[0]];
  const kind = ys[0].kind;
  const signed = isSigned(kind, ys[0].name);

  let series: { name: string; pts: [number, number][] }[];
  if (group) {
    const names = [...new Set(rows.map((r) => String(r[group.i])))];
    series = names.slice(0, 8).map((g) => ({ // a 9th series folds away rather than inventing a hue
      name: g,
      pts: rows.filter((r) => String(r[group.i]) === g && r[ys[0].i] !== null).map((r) => [toTime(r[date.i]), Number(r[ys[0].i])] as [number, number]),
    }));
  } else {
    series = ys.map((c) => ({ name: humanize(c.name), pts: rows.filter((r) => r[c.i] !== null).map((r) => [toTime(r[date.i]), Number(r[c.i])] as [number, number]) }));
  }
  series.forEach((s) => s.pts.sort((a, b) => a[0] - b[0]));
  const all = series.flatMap((s) => s.pts);
  const [t0, t1] = [Math.min(...all.map((p) => p[0])), Math.max(...all.map((p) => p[0]))];
  const vals = all.map((p) => p[1]);
  const ticks = niceTicks(Math.min(...vals), Math.max(...vals));
  const times = [...new Set(all.map((p) => p[0]))].sort((a, b) => a - b);
  const single = series.length === 1;
  const title = group ? `${humanize(ys[0].name)} by ${humanize(group.name).toLowerCase()}` : series.map((s) => s.name).join(", ");
  const endLabels = series.length > 1 && series.length <= 4;

  // Single level series: headline the latest value and the change over the period, colored by direction.
  const pts0 = series[0].pts;
  const first = pts0[0]?.[1], last = pts0[pts0.length - 1]?.[1];
  const showChange = single && isLevel(kind) && pts0.length > 1 && first !== 0;
  const up = !showChange || last >= first;
  const color = showChange ? (up ? "var(--up)" : "var(--down)") : SERIES[0];
  const colorOf = (k: number) => (single ? color : SERIES[k]);
  const hovered = hoverT !== null ? pts0.find((p) => p[0] === hoverT) : undefined;

  const head = single ? (
    <div className="stat">
      <span className="stat-value">{format(hovered?.[1] ?? last, kind, { signed })}</span>
      {showChange && (
        <span className={`delta ${up ? "up" : "down"}`}>
          {up ? "↗" : "↘"} {format(last - first, kind, { signed: true })} ({format((last - first) / Math.abs(first), "percent", { signed: true })})
        </span>
      )}
      <small>{title} · {hovered ? iso(hovered[0]) : `${iso(t0)} to ${iso(t1)}`}</small>
    </div>
  ) : <Title>{title}</Title>;

  return (
    <Frame head={head} tip={single ? null : tip} legend={series.map((s, k) => ({ name: s.name, color: SERIES[k] }))}
      controls={!sameScale && !group ? <MetricPicker nums={nums} value={metric} onChange={setMetric} /> : undefined}>
      {(w) => {
        const H = w < 520 ? 240 : 320, left = 4, right = 56 + (endLabels ? 56 : 0), top = 10, bottom = 26;
        const sx = scale(t0, t1, left, w - right);
        const sy = scale(ticks[0], ticks[ticks.length - 1], H - bottom, top);
        const path = (pts: [number, number][]) => pts.map(([x, y], k) => `${k ? "L" : "M"}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(" ");
        const onMove = (e: React.PointerEvent<SVGRectElement>) => {
          const box = e.currentTarget.getBoundingClientRect();
          const t = t0 + ((e.clientX - box.left) / box.width) * (t1 - t0);
          const near = times.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a), times[0]);
          setHoverT(near);
          setTip({
            x: sx(near), y: e.clientY - box.top,
            body: (
              <>
                <div className="tip-head">{iso(near)}</div>
                {series.map((s, k) => {
                  const p = s.pts.find((q) => q[0] === near);
                  return p ? <div key={s.name} className="tip-row"><i style={{ background: SERIES[k] }} /><b>{format(p[1], kind, { signed })}</b> {s.name}</div> : null;
                })}
              </>
            ),
          });
        };
        return (
          <svg width={w} height={H} role="img" aria-label={`Line chart: ${title}`}>
            <defs><Gradient id={gid} color={color} /></defs>
            {ticks.map((v) => (
              <g key={v}>
                <line x1={left} x2={w - right} y1={sy(v)} y2={sy(v)} className={v === 0 && !isLevel(kind) ? "zero" : "grid"} />
                <text x={w - right + 8} y={sy(v) + 4}>{formatTick(v, kind)}</text>
              </g>
            ))}
            {dateTicks(t0, t1, w < 520 ? 3 : 5).map((d, k, arr) => (
              <text key={k} x={sx(d.t)} y={H - 6} textAnchor={k === 0 ? "start" : k === arr.length - 1 ? "end" : "middle"}>{d.label}</text>
            ))}
            {showChange && <line x1={left} x2={w - right} y1={sy(first)} y2={sy(first)} className="ref" />}
            {single && pts0.length > 1 && (
              <path d={`${path(pts0)} L${sx(pts0[pts0.length - 1][0])},${H - bottom} L${sx(pts0[0][0])},${H - bottom} Z`} fill={`url(#${gid})`} />
            )}
            {series.map((s, k) => (
              <path key={s.name} d={path(s.pts)} fill="none" stroke={colorOf(k)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {single && pts0.length <= 40 && pts0.map(([x, y]) => <circle key={x} cx={sx(x)} cy={sy(y)} r={3.5} fill={color} className="dot" />)}
            {endLabels && series.map((s, k) => {
              const p = s.pts[s.pts.length - 1];
              return p ? <text key={s.name} x={w - 4} y={sy(p[1]) + 4} textAnchor="end" className="end-label" style={{ fill: SERIES[k] }}>{s.name}</text> : null;
            })}
            {hoverT !== null && (
              <g>
                <line x1={sx(hoverT)} x2={sx(hoverT)} y1={top} y2={H - bottom} className="crosshair" />
                {series.map((s, k) => {
                  const p = s.pts.find((q) => q[0] === hoverT);
                  return p ? <circle key={s.name} cx={sx(p[0])} cy={sy(p[1])} r={5} fill={colorOf(k)} className="dot" /> : null;
                })}
              </g>
            )}
            <rect x={left} y={top} width={Math.max(0, w - right - left)} height={H - top - bottom} fill="transparent"
              onPointerMove={onMove} onPointerLeave={() => { setTip(null); setHoverT(null); }} />
          </svg>
        );
      }}
    </Frame>
  );
}

/** Tiny area chart for the home page's ticker cards. */
export function Sparkline({ values, up }: { values: number[]; up: boolean }) {
  const gid = "s" + useId().replace(/:/g, "");
  if (values.length < 2) return null;
  const W = 200, H = 56;
  const sx = scale(0, values.length - 1, 0, W), sy = scale(Math.min(...values), Math.max(...values), H - 4, 4);
  const d = values.map((v, k) => `${k ? "L" : "M"}${sx(k).toFixed(1)},${sy(v).toFixed(1)}`).join(" ");
  const color = up ? "var(--up)" : "var(--down)";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" aria-hidden="true">
      <defs><Gradient id={gid} color={color} strength={0.28} /></defs>
      <line x1={0} x2={W} y1={sy(values[0])} y2={sy(values[0])} stroke="var(--muted)" strokeDasharray="2 3" opacity={0.6} vectorEffect="non-scaling-stroke" />
      <path d={`${d} L${W},${H} L0,${H} Z`} fill={`url(#${gid})`} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.75} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------- bars

function Bars({ rows, labelOf, nums, cols }: { rows: unknown[][]; labelOf: (r: unknown[], k: number) => string; nums: Col[]; cols: Col[] }) {
  const [metric, setMetric] = useState(0);
  const [tip, setTip] = useState<Tip>(null);
  const c = nums[metric] ?? nums[0];
  let data = rows.map((r, k) => ({ label: labelOf(r, k), v: r[c.i] === null ? null : Number(r[c.i]), row: r }));
  // Rank largest first unless the query already ordered by this value (e.g. "worst days", top-N).
  const vs = data.map((d) => d.v ?? -Infinity);
  const ordered = vs.every((x, k) => k === 0 || x <= vs[k - 1]) || vs.every((x, k) => k === 0 || x >= vs[k - 1]);
  if (!ordered) data = [...data].sort((a, b) => (b.v ?? -Infinity) - (a.v ?? -Infinity));
  data = data.slice(0, 60);
  const vals = data.map((d) => d.v ?? 0);
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals), 4);
  const signed = isSigned(c.kind, c.name);
  const ROW = 30, BAR = 18;
  const labelW = Math.min(180, Math.max(44, ...data.map((d) => Math.min(d.label.length, 28) * 6.8)));
  const title = `${humanize(c.name)}${rows.length > 60 ? ` · first 60 of ${rows.length}` : ""}`;

  return (
    <Frame head={<Title>{title}</Title>} tip={tip} controls={<MetricPicker nums={nums} value={metric} onChange={setMetric} />}>
      {(w) => {
        const valueW = 70, x0 = labelW + 10, x1 = w - valueW;
        const sx = scale(ticks[0], ticks[ticks.length - 1], x0, x1);
        const H = data.length * ROW + 22;
        return (
          <svg width={w} height={H} role="img" aria-label={`Bar chart: ${title}`}>
            {ticks.map((v) => (
              <g key={v}>
                <line x1={sx(v)} x2={sx(v)} y1={0} y2={H - 20} className={v === 0 ? "zero" : "grid"} />
                <text x={sx(v)} y={H - 4} textAnchor="middle">{formatTick(v, c.kind)}</text>
              </g>
            ))}
            {data.map((d, k) => {
              const y = k * ROW + (ROW - BAR) / 2;
              const v = d.v ?? 0, neg = v < 0;
              const a = sx(0), b = sx(v), r = Math.min(4, Math.abs(b - a));
              // rounded data-end, square at the baseline
              const path = neg
                ? `M${a},${y} H${b + r} Q${b},${y} ${b},${y + r} V${y + BAR - r} Q${b},${y + BAR} ${b + r},${y + BAR} H${a} Z`
                : `M${a},${y} H${b - r} Q${b},${y} ${b},${y + r} V${y + BAR - r} Q${b},${y + BAR} ${b - r},${y + BAR} H${a} Z`;
              const fill = signed ? (neg ? "var(--down)" : "var(--up)") : neg ? "var(--neg)" : "var(--pos)";
              const show = (e: React.PointerEvent | React.FocusEvent) => {
                const box = (e.currentTarget as Element).closest("svg")!.getBoundingClientRect();
                setTip({
                  x: "clientX" in e ? e.clientX - box.left : b, y: y + BAR,
                  body: (
                    <>
                      <div className="tip-head">{cols.filter((cc) => cc.kind === "label" || cc.kind === "date").map((cc) => format(d.row[cc.i], cc.kind)).join(" · ") || d.label}</div>
                      {cols.filter((cc) => isNumKind(cc.kind)).map((cc) => (
                        <div key={cc.i} className="tip-row"><b>{format(d.row[cc.i], cc.kind, { signed: isSigned(cc.kind, cc.name) })}</b> {humanize(cc.name)}</div>
                      ))}
                    </>
                  ),
                });
              };
              return (
                <g key={k} tabIndex={0} onPointerMove={show} onFocus={show} onPointerLeave={() => setTip(null)} onBlur={() => setTip(null)} className="bar-row">
                  <rect x={0} y={k * ROW} width={w} height={ROW} fill="transparent" />
                  <text x={labelW} y={y + BAR / 2 + 4} textAnchor="end" className="bar-label">{d.label.length > 28 ? d.label.slice(0, 27) + "…" : d.label}</text>
                  {d.v !== null && <path d={path} fill={fill} />}
                  <text x={neg ? Math.min(a, b) - 6 : Math.max(a, b) + 6} y={y + BAR / 2 + 4} textAnchor={neg ? "end" : "start"} className="bar-value">
                    {format(d.v, c.kind, { signed })}
                  </text>
                </g>
              );
            })}
          </svg>
        );
      }}
    </Frame>
  );
}

// ---------------------------------------------------------------------------- timeline (labels + dates, no numbers)

function Timeline({ rows, date, label, cols }: { rows: unknown[][]; date: Col; label: Col; cols: Col[] }) {
  const [tip, setTip] = useState<Tip>(null);
  const names = [...new Set(rows.map((r) => String(r[label.i])))];
  const shown = names.slice(0, 25);
  const t = rows.map((r) => toTime(r[date.i]));
  const [t0, t1] = [Math.min(...t), Math.max(...t)];
  const ROW = 26;
  const title = `${humanize(date.name)} by ${humanize(label.name).toLowerCase()}${names.length > 25 ? ` · 25 of ${names.length}` : ""}`;
  return (
    <Frame head={<Title>{title}</Title>} tip={tip}>
      {(w) => {
        const sx = scale(t0, t1, 80, w - 12);
        const H = shown.length * ROW + 26;
        return (
          <svg width={w} height={H} role="img" aria-label={`Timeline: ${title}`}>
            {dateTicks(t0, t1, w < 520 ? 3 : 5).map((d, k, arr) => (
              <g key={k}>
                <line x1={sx(d.t)} x2={sx(d.t)} y1={0} y2={H - 22} className="grid" />
                <text x={sx(d.t)} y={H - 6} textAnchor={k === 0 ? "start" : k === arr.length - 1 ? "end" : "middle"}>{d.label}</text>
              </g>
            ))}
            {shown.map((n, k) => (
              <g key={n}>
                <line x1={80} x2={w - 12} y1={k * ROW + ROW / 2} y2={k * ROW + ROW / 2} className="grid" />
                <text x={70} y={k * ROW + ROW / 2 + 4} textAnchor="end" className="bar-label">{n}</text>
              </g>
            ))}
            {rows.map((r, k) => {
              const row = shown.indexOf(String(r[label.i]));
              if (row < 0) return null;
              const cx = sx(toTime(r[date.i])), cy = row * ROW + ROW / 2;
              return (
                <circle key={k} cx={cx} cy={cy} r={5} fill="var(--pos)" className="dot" tabIndex={0}
                  onPointerEnter={() => setTip({ x: cx, y: cy, body: <>{cols.map((c) => <div key={c.i} className="tip-row"><b>{format(r[c.i], c.kind)}</b> {humanize(c.name)}</div>)}</> })}
                  onPointerLeave={() => setTip(null)} />
              );
            })}
          </svg>
        );
      }}
    </Frame>
  );
}

// ---------------------------------------------------------------------------- scatter

function Scatter({ rows, x, y, cols }: { rows: unknown[][]; x: Col; y: Col; cols: Col[] }) {
  const [tip, setTip] = useState<Tip>(null);
  const pts = rows.filter((r) => r[x.i] !== null && r[y.i] !== null);
  const xt = niceTicks(Math.min(...pts.map((r) => Number(r[x.i]))), Math.max(...pts.map((r) => Number(r[x.i]))));
  const yt = niceTicks(Math.min(...pts.map((r) => Number(r[y.i]))), Math.max(...pts.map((r) => Number(r[y.i]))));
  const lab = cols.find((c) => c.kind === "label");
  const title = `${humanize(y.name)} vs ${humanize(x.name).toLowerCase()}`;
  return (
    <Frame head={<Title>{title}</Title>} tip={tip}>
      {(w) => {
        const H = 300, left = 4, right = 56, top = 10, bottom = 26;
        const sx = scale(xt[0], xt[xt.length - 1], left, w - right);
        const sy = scale(yt[0], yt[yt.length - 1], H - bottom, top);
        return (
          <svg width={w} height={H} role="img" aria-label={`Scatter plot: ${title}`}>
            {yt.map((v) => (
              <g key={v}><line x1={left} x2={w - right} y1={sy(v)} y2={sy(v)} className={v === 0 ? "zero" : "grid"} />
                <text x={w - right + 8} y={sy(v) + 4}>{formatTick(v, y.kind)}</text></g>
            ))}
            {xt.map((v) => <text key={v} x={sx(v)} y={H - 6} textAnchor="middle">{formatTick(v, x.kind)}</text>)}
            {pts.map((r, k) => {
              const cx = sx(Number(r[x.i])), cy = sy(Number(r[y.i]));
              return (
                <circle key={k} cx={cx} cy={cy} r={5} fill="var(--pos)" className="dot" tabIndex={0}
                  onPointerEnter={() => setTip({ x: cx, y: cy, body: <>{lab && <div className="tip-head">{String(r[lab.i])}</div>}<div className="tip-row"><b>{format(r[y.i], y.kind)}</b> {humanize(y.name)}</div><div className="tip-row"><b>{format(r[x.i], x.kind)}</b> {humanize(x.name)}</div></> })}
                  onPointerLeave={() => setTip(null)} />
              );
            })}
          </svg>
        );
      }}
    </Frame>
  );
}
