import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Cpu, MemoryStick, HardDrive, Server, History, CheckCircle2, XCircle, ShieldCheck, ArrowRight, Radar } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Gauge } from "@/components/ui/Gauge";
import { api } from "@/lib/tauri";
import { formatBytes, formatUptime } from "@/lib/format";
import { useTabStore } from "@/store/useTabStore";

const cardMotion = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.2 },
};

export default function Dashboard() {
  const { data: snapshot, isLoading, isError } = useQuery({
    queryKey: ["system-snapshot", "dashboard"],
    queryFn: api.getSystemSnapshot,
    refetchInterval: 2000,
  });

  const { data: processes } = useQuery({
    queryKey: ["processes", "dashboard-top"],
    queryFn: api.listProcesses,
    refetchInterval: 3000,
  });

  const { data: recentAudit } = useQuery({
    queryKey: ["audit", "dashboard-recent"],
    queryFn: () => api.listAuditLog(5),
    refetchInterval: 5000,
  });

  const { data: sentinel } = useQuery({
    queryKey: ["sentinel", "dashboard-status"],
    queryFn: api.sentinelStatus,
    refetchInterval: 5000,
  });

  const openTab = useTabStore((s) => s.openTab);

  const topProcesses = [...(processes ?? [])]
    .sort((a, b) => b.cpu_usage_percent - a.cpu_usage_percent)
    .slice(0, 5);

  const ramPercent = snapshot ? (snapshot.ram_used_bytes / snapshot.ram_total_bytes) * 100 : 0;
  const diskPercent = snapshot ? (snapshot.disk_used_bytes / snapshot.disk_total_bytes) * 100 : 0;

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mb-5">
        <h1 className="font-mono text-lg font-semibold text-text">Dashboard</h1>
        <p className="text-xs text-text-dim">
          {snapshot ? `${snapshot.os_name} ${snapshot.os_version} · ${snapshot.hostname}` : "Cargando informacion del sistema..."}
        </p>
      </div>

      {isError && (
        <div className="mb-4 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent-bright">
          No se pudo leer el estado del sistema. Verifica el backend de KRYPTOS.
        </div>
      )}

      {/* Solo aparece cuando Sentinel encontro algo. Un banner permanente
          que casi siempre dice "todo bien" se vuelve invisible al tercer dia. */}
      {!!sentinel?.unacknowledged_count && (
        <button
          onClick={() => openTab("security", "Seguridad")}
          className="mb-4 flex w-full items-center gap-3 rounded-md border border-accent-bright/40 bg-accent-dim/20 px-3 py-2.5 text-left transition-colors hover:bg-accent-dim/30"
        >
          <Radar size={15} className="shrink-0 animate-pulseGlow text-accent-bright" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-accent-bright">
              Sentinel detecto {sentinel.unacknowledged_count}{" "}
              {sentinel.unacknowledged_count === 1 ? "cambio sin revisar" : "cambios sin revisar"} en este equipo
            </p>
            <p className="text-[11px] text-text-dim">Abrir Seguridad para ver que cambio y decidir si es esperado.</p>
          </div>
          <ArrowRight size={13} className="shrink-0 text-accent-bright" />
        </button>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <motion.div {...cardMotion}>
          <Card title="CPU">
            <Gauge
              value={snapshot?.cpu_usage_percent ?? 0}
              label={snapshot?.cpu_name ?? (isLoading ? "Leyendo..." : "—")}
              sublabel={snapshot ? `${snapshot.cpu_cores} nucleos` : undefined}
            />
          </Card>
        </motion.div>

        <motion.div {...cardMotion} transition={{ ...cardMotion.transition, delay: 0.03 }}>
          <Card title="RAM">
            <Gauge
              value={ramPercent}
              label="Memoria"
              sublabel={
                snapshot
                  ? `${formatBytes(snapshot.ram_used_bytes)} / ${formatBytes(snapshot.ram_total_bytes)}`
                  : undefined
              }
            />
          </Card>
        </motion.div>

        <motion.div {...cardMotion} transition={{ ...cardMotion.transition, delay: 0.06 }}>
          <Card title="Disco">
            <Gauge
              value={diskPercent}
              label="Almacenamiento"
              sublabel={
                snapshot
                  ? `${formatBytes(snapshot.disk_used_bytes)} / ${formatBytes(snapshot.disk_total_bytes)}`
                  : undefined
              }
            />
          </Card>
        </motion.div>

        <motion.div {...cardMotion} transition={{ ...cardMotion.transition, delay: 0.09 }}>
          <Card title="Estado general">
            <div className="flex flex-col gap-2.5 text-xs">
              <Row icon={Server} label="Uptime" value={snapshot ? formatUptime(snapshot.uptime_secs) : "—"} />
              <Row icon={Cpu} label="Procesos" value={snapshot ? String(snapshot.process_count) : "—"} />
              <Row icon={MemoryStick} label="RAM libre" value={snapshot ? formatBytes(snapshot.ram_total_bytes - snapshot.ram_used_bytes) : "—"} />
              <Row icon={HardDrive} label="Disco libre" value={snapshot ? formatBytes(snapshot.disk_total_bytes - snapshot.disk_used_bytes) : "—"} />
            </div>
          </Card>
        </motion.div>

        <motion.div {...cardMotion} transition={{ ...cardMotion.transition, delay: 0.12 }}>
          <Card
            title="Seguridad"
            action={
              <button onClick={() => openTab("security", "Seguridad")} className="text-text-dim hover:text-text">
                <ArrowRight size={11} />
              </button>
            }
          >
            {sentinel?.has_baseline ? (
              <Gauge
                value={sentinel.posture_score}
                label={sentinel.running ? "Vigilando" : "Vigilancia detenida"}
                sublabel={sentinel.unacknowledged_count > 0 ? `${sentinel.unacknowledged_count} sin revisar` : "Sin alertas pendientes"}
              />
            ) : (
              <div className="flex items-center gap-2 text-xs text-text-dim">
                <Radar size={14} />
                <span>Sentinel aun no tiene una referencia del equipo.</span>
              </div>
            )}
          </Card>
        </motion.div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <motion.div className="xl:col-span-2" {...cardMotion} transition={{ ...cardMotion.transition, delay: 0.12 }}>
          <Card title="Procesos con mayor consumo de CPU">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-text-dim">
                  <th className="pb-2 font-normal">PID</th>
                  <th className="pb-2 font-normal">Nombre</th>
                  <th className="pb-2 font-normal">CPU</th>
                  <th className="pb-2 font-normal">Memoria</th>
                </tr>
              </thead>
              <tbody className="font-mono text-text-muted">
                {topProcesses.map((p) => (
                  <tr key={p.pid} className="border-t border-borderMuted">
                    <td className="py-1.5">{p.pid}</td>
                    <td className="py-1.5 text-text">{p.name}</td>
                    <td className="py-1.5">{p.cpu_usage_percent.toFixed(1)}%</td>
                    <td className="py-1.5">{formatBytes(p.memory_bytes)}</td>
                  </tr>
                ))}
                {!topProcesses.length && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-text-dim">
                      {isLoading ? "Cargando procesos..." : "Sin datos de procesos"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </motion.div>

        <motion.div {...cardMotion} transition={{ ...cardMotion.transition, delay: 0.15 }}>
          <Card
            title="Actividad reciente"
            action={
              <button
                onClick={() => openTab("security", "Seguridad")}
                className="flex items-center gap-1 text-[10px] text-text-dim hover:text-text"
              >
                <ShieldCheck size={11} /> Seguridad <ArrowRight size={10} />
              </button>
            }
          >
            <div className="space-y-1.5 text-xs">
              {(recentAudit ?? []).length === 0 && (
                <div className="flex items-center gap-2 py-3 text-text-dim">
                  <History size={13} />
                  <span>Sin eventos criticos todavia.</span>
                </div>
              )}
              {(recentAudit ?? []).map((entry) => (
                <div key={entry.id} className="flex items-start gap-2 text-[11px]">
                  {entry.result === "ok" ? (
                    <CheckCircle2 size={11} className="mt-0.5 shrink-0 text-ok" />
                  ) : (
                    <XCircle size={11} className="mt-0.5 shrink-0 text-accent-bright" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-text">{entry.action}</p>
                    <p className="truncate text-text-dim">{entry.target}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}

function Row({ icon: Icon, label, value }: { icon: typeof Cpu; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2 text-text-dim">
        <Icon size={13} />
        {label}
      </span>
      <span className="font-mono text-text">{value}</span>
    </div>
  );
}
