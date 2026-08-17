import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import {
  Radar,
  Play,
  Square,
  RefreshCw,
  Check,
  CheckCheck,
  Trash2,
  RotateCcw,
  ShieldAlert,
  Network,
  CalendarClock,
  ShieldCheck,
  Activity,
  Download,
  Clock,
  Cpu,
  Fish,
  Usb,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Gauge } from "@/components/ui/Gauge";
import { TimeMachinePanel } from "@/components/security/TimeMachinePanel";
import { api } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { SentinelSeverity, SentinelSource } from "@/types/sentinel";

const SEVERITY_STYLE: Record<SentinelSeverity, { label: string; dot: string; text: string; border: string }> = {
  critica: { label: "Critica", dot: "bg-accent-bright", text: "text-accent-bright", border: "border-accent-bright/40" },
  alta: { label: "Alta", dot: "bg-warn", text: "text-warn", border: "border-warn/40" },
  media: { label: "Media", dot: "bg-text-muted", text: "text-text-muted", border: "border-border" },
  baja: { label: "Baja", dot: "bg-text-dim", text: "text-text-dim", border: "border-borderMuted" },
};

const SOURCE_META: Record<SentinelSource, { label: string; icon: typeof Network }> = {
  red: { label: "Red", icon: Network },
  persistencia: { label: "Persistencia", icon: CalendarClock },
  "linea-base": { label: "Linea base", icon: ShieldCheck },
  motor: { label: "Motor", icon: Radar },
  procesos: { label: "Procesos", icon: Cpu },
  honeytoken: { label: "Honeytoken", icon: Fish },
  usb: { label: "USB", icon: Usb },
};

const INTERVALS = [
  { secs: 30, label: "30 s" },
  { secs: 60, label: "1 min" },
  { secs: 300, label: "5 min" },
  { secs: 900, label: "15 min" },
];

function formatClock(unix: number) {
  if (!unix) return "nunca";
  return new Date(unix * 1000).toLocaleString();
}

function formatShortClock(unix: number) {
  return new Date(unix * 1000).toLocaleTimeString();
}

/**
 * Sentinel — la vigilancia continua del equipo.
 *
 * A diferencia del resto de herramientas de Seguridad, que responden una
 * pregunta puntual cuando las abres, esta compara el estado del equipo
 * contra la ultima foto que tomo y muestra lo que cambio solo. El backend
 * emite los hallazgos en vivo, asi que el panel no hace polling: escucha.
 */
export function SentinelPanel() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"alertas" | "linea-tiempo" | "maquina-tiempo">("alertas");
  const [sourceFilter, setSourceFilter] = useState<SentinelSource | "todas">("todas");
  const [onlyPending, setOnlyPending] = useState(true);
  const [interval, setIntervalSecs] = useState(60);
  const [confirming, setConfirming] = useState<"limpiar" | "reiniciar" | null>(null);
  const [exportHash, setExportHash] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const status = useQuery({ queryKey: ["sentinel", "status"], queryFn: api.sentinelStatus, refetchInterval: 5000 });
  const alerts = useQuery({
    queryKey: ["sentinel", "alerts", onlyPending],
    queryFn: () => api.sentinelListAlerts(300, onlyPending),
  });
  const events = useQuery({
    queryKey: ["sentinel", "events", sourceFilter],
    queryFn: () => api.sentinelListEvents(300, sourceFilter === "todas" ? undefined : sourceFilter),
  });

  const refreshAll = () => queryClient.invalidateQueries({ queryKey: ["sentinel"] });

  // El backend empuja cada hallazgo apenas lo detecta. Escuchar en vez de
  // consultar en bucle es lo que hace que una alerta critica aparezca en el
  // momento y no hasta el siguiente refresco.
  useEffect(() => {
    const unlisten = Promise.all([
      listen("sentinel://alert", refreshAll),
      listen("sentinel://event", refreshAll),
      listen("sentinel://tick", refreshAll),
    ]);
    return () => {
      unlisten.then((fns) => fns.forEach((fn) => fn()));
    };
  }, []);

  const start = useMutation({ mutationFn: () => api.sentinelStart(interval), onSuccess: refreshAll });
  const stop = useMutation({ mutationFn: api.sentinelStop, onSuccess: refreshAll });
  const scanNow = useMutation({ mutationFn: api.sentinelScanNow, onSuccess: refreshAll });
  const ackOne = useMutation({ mutationFn: api.sentinelAcknowledgeAlert, onSuccess: refreshAll });
  const ackAll = useMutation({ mutationFn: api.sentinelAcknowledgeAll, onSuccess: refreshAll });
  const clearHistory = useMutation({ mutationFn: api.sentinelClearHistory, onSuccess: refreshAll });
  const resetReference = useMutation({ mutationFn: api.sentinelResetReference, onSuccess: refreshAll });
  const exportHistory = useMutation({
    mutationFn: async () => {
      const result = await api.sentinelExport();
      const destination = await save({ defaultPath: `kryptos-sentinel-${Date.now()}.json` });
      if (!destination) return null;
      await api.writeFileText(destination, result.json);
      await api.writeFileText(`${destination}.sha256`, `${result.sha256}  ${destination.split(/[\\/]/).pop()}\n`);
      return result.sha256;
    },
    onSuccess: (hash) => {
      if (hash) setExportHash(hash);
      setExportError(null);
    },
    onError: (e: Error) => setExportError(e.message),
  });

  const running = status.data?.running ?? false;
  const pending = status.data?.unacknowledged_count ?? 0;
  const actionError = start.error ?? scanNow.error ?? stop.error;

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="space-y-4">
        <Card
          title="Sentinel — vigilancia continua"
          action={
            <div className="flex items-center gap-2">
              <button
                onClick={() => scanNow.mutate()}
                disabled={scanNow.isPending}
                className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] text-text-muted hover:bg-overlay/[0.04] disabled:opacity-50"
              >
                <RefreshCw size={11} className={scanNow.isPending ? "animate-spin" : ""} />
                Revisar ahora
              </button>
              {running ? (
                <button
                  onClick={() => stop.mutate()}
                  className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] text-text-muted hover:bg-overlay/[0.04]"
                >
                  <Square size={11} /> Detener
                </button>
              ) : (
                <button
                  onClick={() => start.mutate()}
                  className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1 text-[11px] font-medium text-white hover:bg-accent-bright"
                >
                  <Play size={11} /> Iniciar
                </button>
              )}
            </div>
          }
        >
          <div className="space-y-4">
            <p className="text-xs leading-relaxed text-text-dim">
              Toma una foto del equipo cada cierto tiempo y la compara con la anterior: puertos que se abren,
              programas que se agregan al arranque automatico, defensas que se apagan. Solo reporta lo que{" "}
              <span className="text-text-muted">cambio</span>, nunca modifica nada.
            </p>

            {status.data?.has_baseline && (
              <div className="flex items-center gap-4 rounded-md border border-border bg-base p-3">
                <Gauge value={status.data.posture_score} label="Nivel de seguridad" sublabel="Linea base + alertas pendientes" size={64} />
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat
                label="Estado"
                value={running ? "Vigilando" : "Detenido"}
                tone={running ? "text-ok" : "text-text-dim"}
                pulse={running}
              />
              <Stat
                label="Alertas sin revisar"
                value={String(pending)}
                tone={pending > 0 ? "text-accent-bright" : "text-ok"}
              />
              <Stat label="Puertos vigilados" value={String(status.data?.watched_ports ?? 0)} tone="text-text" />
              <Stat label="Arranques vigilados" value={String(status.data?.watched_persistence ?? 0)} tone="text-text" />
            </div>

            <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-base p-3">
              <span className="text-[11px] text-text-dim">Intervalo</span>
              <div className="flex gap-1">
                {INTERVALS.map((opt) => (
                  <button
                    key={opt.secs}
                    onClick={() => setIntervalSecs(opt.secs)}
                    disabled={running}
                    className={cn(
                      "rounded px-2 py-1 text-[11px] transition-colors",
                      interval === opt.secs ? "bg-accent text-white" : "border border-border text-text-muted hover:bg-overlay/[0.04]",
                      running && "cursor-not-allowed opacity-50"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <span className="ml-auto text-[11px] text-text-dim">
                Ultima revision: {formatClock(status.data?.last_run_unix ?? 0)}
              </span>
            </div>

            {status.data && !status.data.has_baseline && (
              <p className="rounded-md border border-warn/30 bg-warn/[0.06] p-2.5 text-[11px] text-warn">
                Todavia no hay una foto de referencia. La primera revision toma el estado actual como punto de
                partida y no genera alertas — a partir de la segunda ya reporta cambios.
              </p>
            )}

            {actionError && (
              <p className="rounded-md border border-accent-bright/30 bg-accent-dim/20 p-2.5 text-[11px] text-accent-bright">
                {String(actionError)}
              </p>
            )}
          </div>
        </Card>

        <Card
          title={tab === "alertas" ? "Alertas" : "Linea de tiempo"}
          action={
            <div className="flex items-center gap-2">
              <div className="flex rounded-md border border-border p-0.5">
                <TabButton active={tab === "alertas"} onClick={() => setTab("alertas")}>
                  Alertas{pending > 0 ? ` (${pending})` : ""}
                </TabButton>
                <TabButton active={tab === "linea-tiempo"} onClick={() => setTab("linea-tiempo")}>
                  Linea de tiempo
                </TabButton>
                <TabButton active={tab === "maquina-tiempo"} onClick={() => setTab("maquina-tiempo")}>
                  <Clock size={10} className="mr-1 inline" /> Maquina del tiempo
                </TabButton>
              </div>
              <button
                onClick={() => exportHistory.mutate()}
                title="Exportar con hash SHA-256 de verificacion"
                className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-overlay/[0.04]"
              >
                <Download size={11} className={exportHistory.isPending ? "animate-pulse" : ""} /> Exportar
              </button>
              <button
                onClick={() => setConfirming("reiniciar")}
                title="Volver a tomar el estado actual como referencia"
                className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-overlay/[0.04]"
              >
                <RotateCcw size={11} /> Referencia
              </button>
              <button
                onClick={() => setConfirming("limpiar")}
                className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-overlay/[0.04]"
              >
                <Trash2 size={11} /> Limpiar
              </button>
            </div>
          }
        >
          {exportError && <p className="mb-3 text-xs text-accent-bright">{exportError}</p>}
          {exportHash && (
            <div className="mb-3 flex items-start gap-2 rounded-md border border-ok/30 bg-ok/5 px-3 py-2 text-[11px]">
              <ShieldCheck size={13} className="mt-0.5 shrink-0 text-ok" />
              <div className="min-w-0">
                <p className="text-text-muted">
                  Exportado con hash SHA-256 (guardado en un archivo <span className="font-mono">.sha256</span> junto al
                  export).
                </p>
                <p className="mt-1 truncate font-mono text-[10px] text-text-dim">{exportHash}</p>
              </div>
            </div>
          )}

          {tab === "alertas" ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setOnlyPending(!onlyPending)}
                  className={cn(
                    "rounded px-2 py-1 text-[11px] transition-colors",
                    onlyPending ? "bg-accent text-white" : "border border-border text-text-muted hover:bg-overlay/[0.04]"
                  )}
                >
                  Solo sin revisar
                </button>
                {pending > 0 && (
                  <button
                    onClick={() => ackAll.mutate()}
                    className="ml-auto flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-overlay/[0.04]"
                  >
                    <CheckCheck size={11} /> Marcar todas como revisadas
                  </button>
                )}
              </div>

              {alerts.data?.length === 0 && (
                <Empty
                  icon={ShieldAlert}
                  message={
                    onlyPending
                      ? "Ninguna alerta pendiente. El equipo no ha cambiado desde la ultima revision."
                      : "Todavia no hay alertas registradas."
                  }
                />
              )}

              <div className="space-y-1.5">
                {alerts.data?.map((alert) => {
                  const style = SEVERITY_STYLE[alert.severity];
                  return (
                    <div
                      key={alert.id}
                      className={cn(
                        "rounded-md border bg-base p-3 text-[11px]",
                        style.border,
                        alert.acknowledged && "opacity-50"
                      )}
                    >
                      <div className="flex items-start gap-2.5">
                        <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", style.dot)} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <span className="text-text">{alert.title}</span>
                            <span className={cn("text-[9px] uppercase tracking-wide", style.text)}>{style.label}</span>
                          </div>
                          <p className="mt-1 leading-relaxed text-text-dim">{alert.detail}</p>
                          <p className="mt-1.5 text-[10px] text-text-dim">
                            {formatClock(alert.timestamp_unix)} · regla {alert.rule_id}
                          </p>
                          {alert.mitre_id && (
                            <span className="mt-1.5 inline-block rounded border border-borderMuted bg-overlay/[0.03] px-1.5 py-0.5 font-mono text-[9px] text-text-dim">
                              MITRE ATT&CK: {alert.mitre_id}
                            </span>
                          )}
                        </div>
                        {!alert.acknowledged && (
                          <button
                            onClick={() => ackOne.mutate(alert.id)}
                            title="Marcar como revisada"
                            className="shrink-0 rounded border border-border p-1 text-text-muted hover:bg-overlay/[0.04]"
                          >
                            <Check size={11} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : tab === "linea-tiempo" ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1">
                {(["todas", "red", "persistencia", "linea-base", "motor", "procesos", "honeytoken", "usb"] as const).map((src) => (
                  <button
                    key={src}
                    onClick={() => setSourceFilter(src)}
                    className={cn(
                      "rounded px-2 py-1 text-[11px] transition-colors",
                      sourceFilter === src ? "bg-accent text-white" : "border border-border text-text-muted hover:bg-overlay/[0.04]"
                    )}
                  >
                    {src === "todas" ? "Todas" : SOURCE_META[src].label}
                  </button>
                ))}
              </div>

              {events.data?.length === 0 && <Empty icon={Activity} message="Todavia no hay eventos registrados." />}

              <div className="space-y-1">
                {events.data?.map((event) => {
                  const meta = SOURCE_META[event.source] ?? SOURCE_META.motor;
                  const Icon = meta.icon;
                  return (
                    <div key={event.id} className="flex items-start gap-2.5 rounded-md border border-borderMuted bg-base p-2.5 text-[11px]">
                      <Icon size={12} className="mt-0.5 shrink-0 text-text-dim" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono text-[10px] text-text-dim">{formatShortClock(event.timestamp_unix)}</span>
                          <span className="text-text-muted">{event.kind}</span>
                        </div>
                        <p className="mt-0.5 break-all text-text">{event.subject}</p>
                        {event.detail && <p className="mt-0.5 break-all text-text-dim">{event.detail}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <TimeMachinePanel />
          )}
        </Card>
      </div>

      {confirming === "limpiar" && (
        <ConfirmDialog
          title="Limpiar historial de vigilancia"
          message="Se borran todos los eventos y alertas registrados por Sentinel. La foto de referencia se mantiene, asi que la vigilancia sigue funcionando igual. Esta accion no se puede deshacer."
          confirmLabel="Limpiar"
          onConfirm={() => {
            clearHistory.mutate();
            setConfirming(null);
          }}
          onCancel={() => setConfirming(null)}
        />
      )}

      {confirming === "reiniciar" && (
        <ConfirmDialog
          title="Reiniciar la referencia"
          message="La proxima revision volvera a tomar el estado actual del equipo como punto de partida. Usalo despues de instalar software a proposito, para que Sentinel deje de reportarlo como un cambio. Los eventos y alertas ya registrados se conservan."
          confirmLabel="Reiniciar referencia"
          danger={false}
          onConfirm={() => {
            resetReference.mutate();
            setConfirming(null);
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
    </div>
  );
}

function Stat({ label, value, tone, pulse }: { label: string; value: string; tone: string; pulse?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-base p-2.5">
      <p className="text-[10px] uppercase tracking-wide text-text-dim">{label}</p>
      <p className={cn("mt-0.5 text-sm font-medium", tone, pulse && "animate-pulseGlow")}>{value}</p>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded px-2 py-0.5 text-[11px] transition-colors",
        active ? "bg-accent text-white" : "text-text-muted hover:bg-overlay/[0.04]"
      )}
    >
      {children}
    </button>
  );
}

function Empty({ icon: Icon, message }: { icon: typeof Radar; message: string }) {
  return (
    <div className="flex flex-col items-center py-10 text-center text-text-dim">
      <Icon size={26} className="mb-2" />
      <p className="max-w-xs text-xs">{message}</p>
    </div>
  );
}
