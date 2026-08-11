interface TrafficSparklineProps {
  data: number[];
  color: string;
  height?: number;
}

/**
 * Minimal inline sparkline. KRYPTOS doesn't pull in a charting library
 * (recharts, chart.js, etc.) for a single live-traffic line — this SVG
 * polyline does the job with zero added dependencies.
 */
export function TrafficSparkline({ data, color, height = 36 }: TrafficSparklineProps) {
  const width = 200;
  const max = Math.max(...data, 1);
  const points = data
    .map((v, i) => {
      const x = data.length > 1 ? (i / (data.length - 1)) * width : 0;
      const y = height - (v / max) * (height - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-9 w-full" preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
