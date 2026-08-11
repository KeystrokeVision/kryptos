import { Wifi } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/tauri";
import { formatUptime } from "@/lib/format";
import { ElevationBadge } from "@/components/layout/ElevationBadge";

export function StatusBar() {
  const { data } = useQuery({
    queryKey: ["system-snapshot", "statusbar"],
    queryFn: api.getSystemSnapshot,
    refetchInterval: 5000,
  });

  const { data: netInfo } = useQuery({
    queryKey: ["network-info", "statusbar"],
    queryFn: api.getNetworkInfo,
    refetchInterval: 5000,
  });

  const hasConnection = (netInfo?.interfaces ?? []).some(
    (i) => i.ipv4.some((ip) => !ip.startsWith("127.")) && (i.received_bytes > 0 || i.transmitted_bytes > 0)
  );

  return (
    <footer className="flex h-7 shrink-0 items-center justify-between border-t border-border bg-base px-3 text-[11px] text-text-dim">
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-ok" />
          Operativo
        </span>
        <span>Uptime: {data ? formatUptime(data.uptime_secs) : "--:--:--"}</span>
        <span>{data?.hostname ?? "—"}</span>
      </div>
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1.5">
          <Wifi size={12} className={hasConnection ? "text-ok" : "text-text-dim"} />
          {netInfo ? (hasConnection ? "Conexion activa" : "Sin trafico de red") : "Verificando..."}
        </span>
        <ElevationBadge />
      </div>
    </footer>
  );
}
