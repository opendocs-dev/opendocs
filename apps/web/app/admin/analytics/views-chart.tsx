type Point = {
  day: string;
  views: number;
};

type Props = {
  data: Point[];
};

function calculateStep(rawMax: number): number {
  if (rawMax <= 0) return 10;
  const target = rawMax / 3;
  if (target <= 1) return 1;
  const exp = Math.floor(Math.log10(target));
  const power = Math.pow(10, exp);
  const fraction = target / power;
  const eps = 1e-9;
  if (fraction <= 1 + eps) return 1 * power;
  if (fraction <= 2 + eps) return 2 * power;
  if (fraction <= 5 + eps) return 5 * power;
  return 10 * power;
}

export function ViewsChart({ data }: Props) {
  if (data.length === 0) {
    return <p className="muted" style={{ padding: '24px 0', textAlign: 'center' }}>No data for this period</p>;
  }

  const W = 640;
  const H = 210;
  const L = 38;
  const R = 12;
  const T = 14;
  const B = 26;

  const pts = data.map((d) => d.views);
  const rawMax = Math.max(...pts, 0);

  // 4 ticks on a 1/2/5 step (UI-A19 Finding 4)
  const step = calculateStep(rawMax);
  const max = step * 3;

  const count = data.length;
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(count - 1, 1);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);

  const lineD = pts
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`)
    .join(' ');
  const areaD = `${lineD} L${x(count - 1).toFixed(1)} ${y(0).toFixed(1)} L${x(0).toFixed(1)} ${y(0).toFixed(1)} Z`;

  // Grid ticks (0, step, 2*step, max)
  const ticks = [0, step, step * 2, max];

  // Pick X-axis label indices (at most 5 labels)
  const labelIndices: number[] = [];
  if (count <= 7) {
    labelIndices.push(0, Math.floor(count / 2), count - 1);
  } else if (count <= 30) {
    const step = Math.floor((count - 1) / 4);
    for (let i = 0; i < count - 1; i += step) {
      labelIndices.push(i);
    }
    if (!labelIndices.includes(count - 1)) labelIndices.push(count - 1);
  } else {
    const step = Math.floor((count - 1) / 3);
    for (let i = 0; i < count - 1; i += step) {
      labelIndices.push(i);
    }
    if (!labelIndices.includes(count - 1)) labelIndices.push(count - 1);
  }

  // Drop penultimate label when it is closer than 3 points to the last (UI-A19 Finding 3)
  if (labelIndices.length > 2) {
    const last = labelIndices[labelIndices.length - 1]!;
    const penultimate = labelIndices[labelIndices.length - 2]!;
    if (last - penultimate < 3) {
      labelIndices.splice(labelIndices.length - 2, 1);
    }
  }

  const formatShortDate = (iso: string) => {
    // e.g. "2026-09-30" -> "Sep 30"
    const parts = iso.split('-');
    if (parts.length < 3) return iso;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[parseInt(parts[1] ?? '1', 10) - 1] ?? '';
    const day = parseInt(parts[2] ?? '1', 10);
    return `${month} ${day}`;
  };

  const lastIndex = count - 1;
  const lastPoint = pts[lastIndex] ?? 0;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Views per day chart, currently at ${lastPoint} views`}
      style={{ width: '100%', height: 'auto', maxHeight: '260px', display: 'block' }}
    >
      {/* Gridlines and y labels */}
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={L}
            x2={W - R}
            y1={y(t)}
            y2={y(t)}
            stroke="var(--a-line, #e2e8f0)"
            strokeWidth={1}
          />
          <text
            x={L - 6}
            y={y(t) + 4}
            textAnchor="end"
            fontSize="11"
            fill="var(--a-muted, #64748b)"
          >
            {t}
          </text>
        </g>
      ))}

      {/* Area & Line */}
      <path d={areaD} fill="var(--a-brand, #059669)" fillOpacity={0.14} />
      <path
        d={lineD}
        fill="none"
        stroke="var(--a-brand, #059669)"
        strokeWidth={2.5}
        strokeLinejoin="round"
      />

      {/* Marker on last point */}
      <circle
        cx={x(lastIndex)}
        cy={y(lastPoint)}
        r={4.5}
        fill="var(--a-brand, #059669)"
      />

      {/* X axis labels */}
      {labelIndices.map((idx) => {
        const item = data[idx];
        if (!item) return null;
        const anchor = idx === 0 ? 'start' : idx === lastIndex ? 'end' : 'middle';
        return (
          <text
            key={item.day}
            x={x(idx)}
            y={H - 6}
            textAnchor={anchor}
            fontSize="11"
            fill="var(--a-muted, #64748b)"
          >
            {formatShortDate(item.day)}
          </text>
        );
      })}
    </svg>
  );
}
