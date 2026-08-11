import { useQuery } from "@tanstack/react-query";
import { Wifi } from "lucide-react";
import { api } from "@/lib/tauri";
import { formatBytes } from "@/lib/format";
import { useTabStore } from "@/store/useTabStore";

/**
 * Always-visible right rail, mirroring the reference design: system gauges,
 * network summary, and a live top-processes list. This stays mounted across
 * every tab/module, not just the Dashboard.
 */
export function MonitorPanel() {
  const openTab = useTabStore((s) => s.openTab);
  const { data: snapshot } = useQuery({
    queryKey: ["system-snapshot", "monitor-panel"],
    queryFn: api.getSystemSnapshot,
    refetchInterval: 2000,
  });

  const { data: network } = useQuery({
    queryKey: ["network-info", "monitor-panel"],
    queryFn: api.getNetworkInfo,
    refetchInterval: 5000,
  });

  const { data: processes } = useQuery({
    queryKey: ["processes", "monitor-panel"],
    queryFn: api.listProcesses,
    refetchInterval: 3000,
  });

  const ramPercent = snapshot ? (snapshot.ram_used_bytes / snapshot.ram_total_bytes) * 100 : 0;
  const diskPercent = snapshot ? (snapshot.disk_used_bytes / snapshot.disk_total_bytes) * 100 : 0;
  const topProcesses = [...(processes ?? [])]
    .sort((a, b) => b.cpu_usage_percent - a.cpu_usage_percent)
    .slice(0, 5);
  const primaryInterface = network?.interfaces.find((i) => i.ipv4.length > 0);

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col gap-3 overflow-y-auto border-l border-border bg-panel p-3">
      <Section title="Monitor del sistema">
        <div className="grid grid-cols-2 gap-3">
          <MiniGauge value={snapshot?.cpu_usage_percent ?? 0} label="CPU" />
          <MiniGauge value={ramPercent} label="RAM" sublabel={snapshot ? formatBytes(snapshot.ram_used_bytes) : undefined} />
          <MiniGauge value={diskPercent} label="Disco" sublabel={snapshot ? formatBytes(snapshot.disk_used_bytes) : undefined} />
          <MiniGauge value={snapshot ? Math.min(100, (snapshot.process_count / 400) * 100) : 0} label="Carga" sublabel={snapshot ? `${snapshot.process_count} proc.` : undefined} />
        </div>
      </Section>

      <Section title="Redes">
        <div className="flex flex-col gap-1.5 text-[11px]">
          <NetRow label="HOSTNAME" value={network?.hostname ?? "—"} />
          <NetRow label="IPV4" value={primaryInterface?.ipv4[0] ?? "—"} />
          <NetRow label="INTERFAZ" value={primaryInterface?.name ?? "—"} />
          <NetRow label="MAC" value={primaryInterface?.mac ?? "—"} />
        </div>
        {primaryInterface && (
          <div className="mt-3 flex items-center justify-between border-t border-borderMuted pt-2 text-[11px] text-text-dim">
            <span className="flex items-center gap-1"><Wifi size={11} /> Recibido</span>
            <span className="font-mono text-ok">{formatBytes(primaryInterface.received_bytes)}</span>
          </div>
        )}
      </Section>

      <Section
        title="Procesos activos"
        action={
          <button onClick={() => openTab("processes", "Procesos")} className="text-[10px] text-accent-bright hover:underline">
            VER TODOS
          </button>
        }
      >
        <table className="w-full text-left text-[11px]">
          <thead>
            <tr className="text-text-dim">
              <th className="pb-1.5 font-normal">PID</th>
              <th className="pb-1.5 font-normal">NOMBRE</th>
              <th className="pb-1.5 font-normal text-right">CPU</th>
            </tr>
          </thead>
          <tbody className="font-mono text-text-muted">
            {topProcesses.map((p) => (
              <tr key={p.pid} className="border-t border-borderMuted">
                <td className="py-1">{p.pid}</td>
                <td className="max-w-[110px] truncate py-1 text-text">{p.name}</td>
                <td className="py-1 text-right">{p.cpu_usage_percent.toFixed(1)}%</td>
              </tr>
            ))}
            {!topProcesses.length && (
              <tr>
                <td colSpan={3} className="py-3 text-center text-text-dim">Cargando...</td>
              </tr>
            )}
          </tbody>
        </table>
      </Section>
    </aside>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="panel p-3">
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="text-[10px] font-medium uppercase tracking-widest text-text-muted">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function NetRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-text-dim">{label}</span>
      <span className="font-mono text-text">{value}</span>
    </div>
  );
}

function MiniGauge({ value, label, sublabel }: { value: number; label: string; sublabel?: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  const size = 46;
  const radius = (size - 6) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);
  const colorClass = clamped > 85 ? "stroke-accent-bright" : clamped > 60 ? "stroke-warn" : "stroke-ok";

  return (
    <div className="flex items-center gap-2">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#1A1A1A" strokeWidth={3.5} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={3.5}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className={`transition-[stroke-dashoffset] duration-500 ${colorClass}`}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center font-mono text-[10px] text-text">
          {Math.round(clamped)}%
        </div>
      </div>
      <div className="leading-tight">
        <p className="text-[11px] text-text">{label}</p>
        {sublabel && <p className="text-[10px] text-text-dim">{sublabel}</p>}
      </div>
    </div>
  );
}
