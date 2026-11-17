const COLORS = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#65a30d", "#475569", "#ea580c"];
const W = 900, H = 300, PAD = { l: 60, r: 12, t: 12, b: 28 };

const isDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v);
const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);

type Series = { name: string; points: [number, number][] };

/** Picks a chart from the result shape: date + numbers -> lines, label + number -> bars, else nothing. */
export function Chart({ columns, rows }: { columns: string[]; rows: unknown[][] }) {
  if (rows.length < 2) return null;
  const every = (i: number, f: (v: unknown) => boolean) => rows.every((r) => r[i] === null || f(r[i]));
  const dateCol = columns.findIndex((_, i) => every(i, isDate) && rows.some((r) => r[i] !== null));
  const numCols = columns.map((_, i) => i).filter((i) => i !== dateCol && every(i, isNum) && rows.some((r) => r[i] !== null));
  if (numCols.length === 0) return null;
  const labelCol = columns.findIndex((_, i) => i !== dateCol && !numCols.includes(i) && every(i, (v) => typeof v === "string"));

  if (dateCol >= 0) {
    const t = (r: unknown[]) => Date.parse(String(r[dateCol]));
    let series: Series[];
    const groups = labelCol >= 0 ? [...new Set(rows.map((r) => String(r[labelCol])))] : [];
    if (groups.length > 1 && groups.length <= 10) {
      // long format (symbol, date, value): one line per label
      series = groups.map((g) => ({
        name: g,
        points: rows.filter((r) => String(r[labelCol]) === g && r[numCols[0]] !== null).map((r) => [t(r), r[numCols[0]] as number]),
      }));
    } else {
      series = numCols.slice(0, 4).map((c) => ({
        name: columns[c],
        points: rows.filter((r) => r[c] !== null).map((r) => [t(r), r[c] as number]),
      }));
    }
    series.forEach((s) => s.points.sort((a, b) => a[0] - b[0]));
    return <Lines series={series} />;
  }
  if (labelCol >= 0 && rows.length <= 40) {
    return <Bars labels={rows.map((r) => String(r[labelCol]))} values={rows.map((r) => (r[numCols[0]] as number) ?? 0)} name={columns[numCols[0]]} />;
  }
  return null;
}

function scale(lo: number, hi: number, a: number, b: number) {
  const span = hi - lo || 1;
  return (v: number) => a + ((v - lo) / span) * (b - a);
}

const fmt = (v: number) => (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + "M" : Math.abs(v) >= 100 ? v.toFixed(0) : v.toPrecision(3));

function Lines({ series }: { series: Series[] }) {
  const pts = series.flatMap((s) => s.points);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const sx = scale(x0, x1, PAD.l, W - PAD.r), sy = scale(y0, y1, H - PAD.b, PAD.t);
  return (
    <figure style={{ margin: "12px 0" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Line chart of ${series.map((s) => s.name).join(", ")}`}>
        <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="currentColor" opacity={0.2} />
        {[y0, (y0 + y1) / 2, y1].map((v) => (
          <text key={v} x={PAD.l - 6} y={sy(v) + 4} textAnchor="end">{fmt(v)}</text>
        ))}
        <text x={PAD.l} y={H - 8}>{new Date(x0).toISOString().slice(0, 10)}</text>
        <text x={W - PAD.r} y={H - 8} textAnchor="end">{new Date(x1).toISOString().slice(0, 10)}</text>
        {series.map((s, i) => (
          <polyline key={s.name} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth={1.5}
            points={s.points.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(" ")} />
        ))}
      </svg>
      <Legend names={series.map((s) => s.name)} />
    </figure>
  );
}

function Bars({ labels, values, name }: { labels: string[]; values: number[]; name: string }) {
  const lo = Math.min(0, ...values), hi = Math.max(0, ...values);
  const sy = scale(lo, hi, H - PAD.b, PAD.t);
  const bw = (W - PAD.l - PAD.r) / labels.length;
  return (
    <figure style={{ margin: "12px 0" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Bar chart of ${name}`}>
        <line x1={PAD.l} x2={W - PAD.r} y1={sy(0)} y2={sy(0)} stroke="currentColor" opacity={0.3} />
        {[lo, hi].map((v) => (
          <text key={v} x={PAD.l - 6} y={sy(v) + 4} textAnchor="end">{fmt(v)}</text>
        ))}
        {values.map((v, i) => (
          <g key={i}>
            <rect x={PAD.l + i * bw + bw * 0.1} width={bw * 0.8} y={Math.min(sy(v), sy(0))} height={Math.abs(sy(v) - sy(0))} fill={v < 0 ? COLORS[1] : COLORS[0]}>
              <title>{`${labels[i]}: ${v}`}</title>
            </rect>
            {labels.length <= 20 && <text x={PAD.l + i * bw + bw / 2} y={H - 8} textAnchor="middle">{labels[i].slice(0, 8)}</text>}
          </g>
        ))}
      </svg>
      <Legend names={[name]} />
    </figure>
  );
}

function Legend({ names }: { names: string[] }) {
  return (
    <figcaption style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 12 }}>
      {names.map((n, i) => (
        <span key={n}><span style={{ color: COLORS[i % COLORS.length] }}>■</span> {n}</span>
      ))}
    </figcaption>
  );
}
