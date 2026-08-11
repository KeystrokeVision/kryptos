import { cn } from "@/lib/utils";

interface GaugeProps {
  value: number; // 0-100
  label: string;
  sublabel?: string;
  size?: number;
}

export function Gauge({ value, label, sublabel, size = 56 }: GaugeProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  const colorClass = clamped > 85 ? "text-accent-bright" : clamped > 60 ? "text-warn" : "text-ok";

  return (
    <div className="flex items-center gap-3">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#1A1A1A"
            strokeWidth={4}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={4}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className={cn("stroke-current transition-[stroke-dashoffset] duration-500", colorClass)}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center font-mono text-[11px] font-medium text-text">
          {Math.round(clamped)}%
        </div>
      </div>
      <div className="leading-tight">
        <p className="text-sm font-medium text-text">{label}</p>
        {sublabel && <p className="text-[11px] text-text-dim">{sublabel}</p>}
      </div>
    </div>
  );
}
