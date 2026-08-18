import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Network as NetworkIcon, Search, RefreshCw, Router, Globe, Skull, AlertTriangle, ScanLine, Activity, TableProperties, Waypoints } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { TrafficSparkline } from "@/components/network/TrafficSparkline";
import { NetworkGraph } from "@/components/network/NetworkGraph";
import { api } from "@/lib/tauri";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ConnectionInfo } from "@/types/network";

const HISTORY_LENGTH = 30;
const POLL_MS = 2000;

function formatRate(bytesPerSec: number) {
  return `${formatBytes(bytesPerSec)}/s`;
}

export default function NetworkModule() {
  const queryClient = useQueryClient();
  const [diagnosticHost, setDiagnosticHost] = useState("");

  const arpQuery = useQuery({
    queryKey: ["network", "arp"],
    queryFn: api.listArpTable,
  });

  const pingDiagnostic = useMutation({
    mutationFn: (host: string) => api.runPingDiagnostic(host),
  });
  const [rxHistory, setRxHistory] = useState<number[]>(Array(HISTORY_LENGTH).fill(0));
  const [txHistory, setTxHistory] = useState<number[]>(Array(HISTORY_LENGTH).fill(0));
  const prevTotals = useRef<{ rx: number; tx: number; at: number } | null>(null);
  const [connFilter, setConnFilter] = useState("");
  const [pendingKillPid, setPendingKillPid] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [connView, setConnView] = useState<"tabla" | "mapa">("tabla");

  const processesQuery = useQuery({
    queryKey: ["processes", "for-network-graph"],
    queryFn: api.listProcesses,
    refetchInterval: connView === "mapa" ? 3000 : false,
    enabled: connView === "mapa",
  });

  const { data: netInfo } = useQuery({
    queryKey: ["network", "info"],
    queryFn: api.getNetworkInfo,
    refetchInterval: POLL_MS,
  });

  const { data: netConfig, isFetching: configFetching, refetch: refetchConfig } = useQuery({
    queryKey: ["network", "config"],
    queryFn: api.getNetworkConfig,
  });

  const {
    data: connections,
    isLoading: connLoading,
    isFetching: connFetching,
    isError: connError,
    error: connErrorObj,
    refetch: refetchConnections,
  } = useQuery({
    queryKey: ["network", "connections"],
    queryFn: api.listActiveConnections,
    refetchInterval: 5000,
  });

  const killMutation = useMutation({
    mutationFn: (pid: number) => api.killProcess(pid),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["network", "connections"] }),
    onError: (e: Error) => setActionError(e.message),
  });

  useEffect(() => {
    if (!netInfo) return;
    const totals = netInfo.interfaces.reduce(
      (acc, i) => ({ rx: acc.rx + i.received_bytes, tx: acc.tx + i.transmitted_bytes }),
      { rx: 0, tx: 0 }
    );
    const now = Date.now();
    if (prevTotals.current) {
      const seconds = (now - prevTotals.current.at) / 1000;
      const rxRate = seconds > 0 ? Math.max(0, (totals.rx - prevTotals.current.rx) / seconds) : 0;
      const txRate = seconds > 0 ? Math.max(0, (totals.tx - prevTotals.current.tx) / seconds) : 0;
      setRxHistory((h) => [...h.slice(1), rxRate]);
      setTxHistory((h) => [...h.slice(1), txRate]);
    }
    prevTotals.current = { rx: totals.rx, tx: totals.tx, at: now };
  }, [netInfo]);

  const filteredConnections = (connections ?? []).filter((c) => {
    if (!connFilter.trim()) return true;
    const q = connFilter.toLowerCase();
    return (
      c.local_addr.toLowerCase().includes(q) ||
      c.remote_addr.toLowerCase().includes(q) ||
      c.protocol.toLowerCase().includes(q) ||
      (c.state ?? "").toLowerCase().includes(q) ||
      String(c.pid ?? "").includes(q)
    );
  });

  const currentRx = rxHistory[rxHistory.length - 1] ?? 0;
  const currentTx = txHistory[txHistory.length - 1] ?? 0;

  return (
    <div className="h-full space-y-4 overflow-y-auto p-5">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
        <Card title="Trafico en tiempo real" className="lg:col-span-2">
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-text-dim">↓ Descarga</span>
                <span className="font-mono text-text">{formatRate(currentRx)}</span>
              </div>
              <TrafficSparkline data={rxHistory} color="#5B9BFF" />
            </div>
            <div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-text-dim">↑ Subida</span>
                <span className="font-mono text-text">{formatRate(currentTx)}</span>
              </div>
              <TrafficSparkline data={txHistory} color="#FF3B3B" />
            </div>
          </div>
        </Card>

        <Card
          title="Gateway / DNS"
          action={
            <button onClick={() => refetchConfig()} className="text-text-dim hover:text-text">
              <RefreshCw size={12} className={configFetching ? "animate-spin" : ""} />
            </button>
          }
        >
          <div className="space-y-2 text-[11px]">
            <div className="flex items-center gap-2">
              <Router size={12} className="text-text-dim" />
              <span className="text-text-dim">Gateway:</span>
              <span className="font-mono text-text">{netConfig?.gateway ?? "—"}</span>
            </div>
            <div className="flex items-start gap-2">
              <Globe size={12} className="mt-0.5 text-text-dim" />
              <span className="text-text-dim">DNS:</span>
              <div className="flex flex-1 flex-wrap gap-1">
                {(netConfig?.dns_servers ?? []).length === 0 && <span className="text-text-dim">—</span>}
                {(netConfig?.dns_servers ?? []).map((d) => (
                  <span key={d} className="rounded-full border border-borderMuted px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
                    {d}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Card>
      </div>

      <Card title="Interfaces">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
          {(netInfo?.interfaces ?? []).map((iface) => (
            <div key={iface.name} className="rounded-md border border-border bg-base p-3 text-[11px]">
              <div className="flex items-center gap-1.5">
                <NetworkIcon size={12} className="text-accent-bright" />
                <p className="truncate font-medium text-text">{iface.name}</p>
              </div>
              <p className="mt-1 truncate font-mono text-[10px] text-text-dim">{iface.mac}</p>
              {iface.ipv4.map((ip) => (
                <p key={ip} className="truncate font-mono text-text-muted">
                  {ip}
                </p>
              ))}
              {iface.ipv6.slice(0, 1).map((ip) => (
                <p key={ip} className="truncate font-mono text-[10px] text-text-dim">
                  {ip}
                </p>
              ))}
              <p className="mt-1.5 text-[10px] text-text-dim">
                ↓ {formatBytes(iface.received_bytes)} · ↑ {formatBytes(iface.transmitted_bytes)}
              </p>
            </div>
          ))}
          {(netInfo?.interfaces ?? []).length === 0 && <p className="text-text-dim">Sin interfaces detectadas.</p>}
        </div>
      </Card>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-4">
        <Card
          title="Tabla ARP"
          action={
            <button onClick={() => arpQuery.refetch()} className="text-text-dim hover:text-text">
              <RefreshCw size={12} className={arpQuery.isFetching ? "animate-spin" : ""} />
            </button>
          }
        >
          <p className="mb-2 text-[10px] text-text-dim">
            Dispositivos con los que este equipo ya intercambio trafico en la red local. Solo lee la cache ARP del
            sistema — no envia sondas.
          </p>
          <div className="max-h-52 space-y-1 overflow-y-auto">
            {(arpQuery.data ?? []).map((entry, i) => (
              <div key={i} className="flex items-center gap-2 rounded-md border border-border bg-base px-2.5 py-1.5 text-[11px]">
                <ScanLine size={11} className="shrink-0 text-accent-bright" />
                <span className="w-32 shrink-0 font-mono text-text">{entry.ip}</span>
                <span className="flex-1 truncate font-mono text-text-dim">{entry.mac}</span>
                {entry.interface && <span className="shrink-0 text-[10px] text-text-dim">{entry.interface}</span>}
              </div>
            ))}
            {(arpQuery.data ?? []).length === 0 && <p className="text-text-dim">Sin entradas ARP todavia.</p>}
          </div>
        </Card>

        <Card title="Diagnostico de conexion">
          <p className="mb-2 text-[10px] text-text-dim">
            10 pings resumidos en estadisticas reales — que tan confiable es el enlace, no solo si responde.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (diagnosticHost.trim()) pingDiagnostic.mutate(diagnosticHost.trim());
            }}
            className="flex gap-2"
          >
            <input
              value={diagnosticHost}
              onChange={(e) => setDiagnosticHost(e.target.value)}
              placeholder="host o IP..."
              className="h-7 flex-1 rounded-md border border-border bg-base px-2 font-mono text-[11px] text-text outline-none focus:border-accent/60"
            />
            <button
              type="submit"
              disabled={!diagnosticHost.trim() || pingDiagnostic.isPending}
              className="flex h-7 items-center gap-1 rounded-md bg-accent px-2.5 text-[11px] font-medium text-white hover:bg-accent-bright disabled:opacity-40"
            >
              <Activity size={11} />
              {pingDiagnostic.isPending ? "..." : "Medir"}
            </button>
          </form>

          {pingDiagnostic.isError && <p className="mt-2 text-[11px] text-accent-bright">{String((pingDiagnostic.error as Error)?.message)}</p>}

          {pingDiagnostic.data && (
            <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[11px]">
              <div className="rounded-md border border-border bg-base p-2">
                <p className={cn("font-mono text-base", pingDiagnostic.data.loss_percent > 0 ? "text-warn" : "text-ok")}>{pingDiagnostic.data.loss_percent}%</p>
                <p className="text-[9px] text-text-dim">Perdida</p>
              </div>
              <div className="rounded-md border border-border bg-base p-2">
                <p className="font-mono text-base text-text">{pingDiagnostic.data.avg_ms?.toFixed(1) ?? "—"}</p>
                <p className="text-[9px] text-text-dim">Promedio ms</p>
              </div>
              <div className="rounded-md border border-border bg-base p-2">
                <p className="font-mono text-base text-text-dim">
                  {pingDiagnostic.data.min_ms?.toFixed(0) ?? "—"}/{pingDiagnostic.data.max_ms?.toFixed(0) ?? "—"}
                </p>
                <p className="text-[9px] text-text-dim">Min/Max ms</p>
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card
        title="Conexiones activas"
        action={
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border border-border p-0.5">
              <button
                onClick={() => setConnView("tabla")}
                className={cn("flex items-center gap-1 rounded px-2 py-0.5 text-[10px]", connView === "tabla" ? "bg-accent text-white" : "text-text-muted hover:bg-overlay/[0.04]")}
              >
                <TableProperties size={10} /> Tabla
              </button>
              <button
                onClick={() => setConnView("mapa")}
                className={cn("flex items-center gap-1 rounded px-2 py-0.5 text-[10px]", connView === "mapa" ? "bg-accent text-white" : "text-text-muted hover:bg-overlay/[0.04]")}
              >
                <Waypoints size={10} /> Mapa
              </button>
            </div>
            {connView === "tabla" && (
              <div className="flex h-6 items-center gap-1.5 rounded-md border border-border bg-base px-2">
                <Search size={10} className="text-text-dim" />
                <input
                  value={connFilter}
                  onChange={(e) => setConnFilter(e.target.value)}
                  placeholder="Filtrar..."
                  className="h-full w-36 bg-transparent text-[10px] text-text outline-none placeholder:text-text-dim"
                />
              </div>
            )}
            <button onClick={() => refetchConnections()} className="text-text-dim hover:text-text">
              <RefreshCw size={12} className={connFetching ? "animate-spin" : ""} />
            </button>
          </div>
        }
      >
        {(connError || actionError) && (
          <div className="mb-2 flex items-start gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent-bright">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            {String((connErrorObj as Error)?.message ?? actionError)}
          </div>
        )}
        {connView === "mapa" ? (
          <NetworkGraph connections={connections ?? []} processes={processesQuery.data ?? []} />
        ) : connLoading ? (
          <p className="text-xs text-text-dim">Cargando conexiones...</p>
        ) : (
          <table className="w-full text-left text-[11px]">
            <thead className="text-[10px] uppercase tracking-widest text-text-dim">
              <tr>
                <th className="px-2 py-1.5 font-medium">Proto</th>
                <th className="px-2 py-1.5 font-medium">Local</th>
                <th className="px-2 py-1.5 font-medium">Remoto</th>
                <th className="px-2 py-1.5 font-medium">Estado</th>
                <th className="px-2 py-1.5 font-medium">PID</th>
                <th className="w-10 px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {filteredConnections.slice(0, 200).map((c: ConnectionInfo, i: number) => (
                <tr key={`${c.protocol}-${c.local_addr}-${c.remote_addr}-${i}`} className="group border-t border-borderMuted hover:bg-overlay/[0.03]">
                  <td className="px-2 py-1 font-mono text-text-dim">{c.protocol}</td>
                  <td className="px-2 py-1 font-mono text-text">{c.local_addr}</td>
                  <td className="px-2 py-1 font-mono text-text-muted">{c.remote_addr}</td>
                  <td className={cn("px-2 py-1 font-mono", c.state === "ESTABLISHED" ? "text-ok" : "text-text-dim")}>{c.state ?? "—"}</td>
                  <td className="px-2 py-1 font-mono text-text-dim">{c.pid ?? "—"}</td>
                  <td className="px-2 py-1">
                    {!!c.pid && (
                      <button
                        onClick={() => setPendingKillPid(c.pid)}
                        className="text-text-dim opacity-0 hover:text-accent-bright group-hover:opacity-100"
                        aria-label={`Finalizar proceso ${c.pid}`}
                      >
                        <Skull size={11} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {filteredConnections.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-2 py-6 text-center text-text-dim">
                    Sin conexiones que coincidan.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </Card>

      {pendingKillPid !== null && (
        <ConfirmDialog
          title="Finalizar proceso"
          message={`¿Finalizar el proceso con PID ${pendingKillPid}? Esto cerrara la conexion y cualquier trabajo no guardado en ese programa se perdera.`}
          confirmLabel="Finalizar"
          onCancel={() => setPendingKillPid(null)}
          onConfirm={() => {
            setActionError(null);
            killMutation.mutate(pendingKillPid);
            setPendingKillPid(null);
          }}
        />
      )}
    </div>
  );
}
