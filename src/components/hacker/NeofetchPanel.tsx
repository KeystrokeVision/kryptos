import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/Card";
import { api } from "@/lib/tauri";
import { formatBytes, formatPercent, formatUptime } from "@/lib/format";

const ASCII_LOGO = [
  "  ██╗  ██╗██████╗ ",
  "  ██║ ██╔╝██╔══██╗",
  "  █████╔╝ ██████╔╝",
  "  ██╔═██╗ ██╔══██╗",
  "  ██║  ██╗██║  ██║",
  "  ╚═╝  ╚═╝╚═╝  ╚═╝",
];

const SWATCHES = ["bg-[#FF3B3B]", "bg-ok", "bg-warn", "bg-[#5B9BFF]", "bg-[#C77DFF]", "bg-[#3BD1D6]", "bg-text-muted", "bg-white"];

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 font-mono text-[12px]">
      <span className="w-20 shrink-0 text-accent-bright">{label}</span>
      <span className="truncate text-text">{value}</span>
    </div>
  );
}

/**
 * neofetch propio: el ritual de cualquier setup de Linux, con datos reales
 * de get_system_snapshot (el mismo comando que ya usa el Dashboard) en vez
 * de un logo de distro que no aplica.
 */
export function NeofetchPanel() {
  const snapshot = useQuery({ queryKey: ["hacker", "neofetch"], queryFn: api.getSystemSnapshot, refetchInterval: 3000 });
  const s = snapshot.data;

  return (
    <div className="h-full space-y-4 overflow-y-auto p-5">
      <Card>
        <div className="flex flex-col gap-6 sm:flex-row">
          <pre className="shrink-0 font-mono text-[10px] leading-tight text-accent-bright">{ASCII_LOGO.join("\n")}</pre>
          <div className="min-w-0 flex-1 space-y-1.5">
            {!s && <p className="text-xs text-text-dim">Leyendo el sistema...</p>}
            {s && (
              <>
                <Row label="usuario@host" value={s.hostname} />
                <div className="h-px w-40 bg-borderMuted" />
                <Row label="SO" value={`${s.os_name} ${s.os_version}`} />
                <Row label="Uptime" value={formatUptime(s.uptime_secs)} />
                <Row label="CPU" value={`${s.cpu_name} (${s.cpu_cores} nucleos, ${formatPercent(s.cpu_usage_percent)})`} />
                <Row label="RAM" value={`${formatBytes(s.ram_used_bytes)} / ${formatBytes(s.ram_total_bytes)}`} />
                <Row label="Disco" value={`${formatBytes(s.disk_used_bytes)} / ${formatBytes(s.disk_total_bytes)}`} />
                <Row label="Procesos" value={String(s.process_count)} />
                <Row label="Shell" value="KRYPTOS Terminal" />
                <div className="mt-2 flex gap-1.5">
                  {SWATCHES.map((c, i) => (
                    <span key={i} className={`h-4 w-4 rounded-sm ${c}`} />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
