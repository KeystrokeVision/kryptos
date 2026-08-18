import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { Radar, ShieldAlert, Network as NetworkIcon, CalendarClock, Fish, Activity, Server, Info, WifiOff, Loader2, Check, X, Clock } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Gauge } from "@/components/ui/Gauge";
import { NetworkGraph } from "@/components/network/NetworkGraph";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { api } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useFleetStore } from "@/store/useFleetStore";
import { FLEET_ACTIONS } from "@/components/layout/FleetActionListener";
import type { SentinelEvent, SentinelAlert } from "@/types/sentinel";
import type { ChatMessage, FleetActionResultPayload } from "@/types/chat";

const SEVERITY_TONE: Record<string, string> = { critica: "text-accent-bright", alta: "text-warn", media: "text-text-muted", baja: "text-text-dim" };

const REQUEST_TIMEOUT_MS = 25_000;

type OutgoingStatus = "pending" | "ok" | "denied" | "error" | "timeout";

interface OutgoingRequest {
  requestId: string;
  targetNick: string;
  action: string;
  status: OutgoingStatus;
  message?: string;
}

/**
 * Centro de Operaciones — todo lo que Sentinel sabe del equipo, en una
 * sola pantalla pensada para dejar proyectada o mirar de reojo mientras
 * trabajas en otra cosa: el puntaje de seguridad, el mapa de red en vivo,
 * y un pulso continuo de lo ultimo que paso. No agrega deteccion nueva —
 * es otra forma de leer los mismos datos que ya vive en Sentinel.
 */
export default function OperationsCenter() {
  const [feed, setFeed] = useState<Array<{ id: string; time: number; text: string; tone: string }>>([]);
  const [outgoing, setOutgoing] = useState<Record<string, OutgoingRequest>>({}); // por nick destino
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null); // nick al que se le va a pedir aislar red
  const myNick = useFleetStore((s) => s.myNick);

  const status = useQuery({ queryKey: ["sentinel", "status", "opscenter"], queryFn: api.sentinelStatus, refetchInterval: 4000 });
  const connections = useQuery({ queryKey: ["network", "connections", "opscenter"], queryFn: api.listActiveConnections, refetchInterval: 4000 });
  const processes = useQuery({ queryKey: ["processes", "opscenter"], queryFn: api.listProcesses, refetchInterval: 4000 });
  const honeytokens = useQuery({ queryKey: ["honeytokens", "opscenter"], queryFn: api.honeytokenList, refetchInterval: 10000 });

  useEffect(() => {
    const unlistenEvent = listen<SentinelEvent>("sentinel://event", (e) => {
      setFeed((prev) => [{ id: `e${e.payload.id}-${Date.now()}`, time: Date.now(), text: `${e.payload.kind}: ${e.payload.subject}`, tone: "text-text-muted" }, ...prev].slice(0, 60));
    });
    const unlistenAlert = listen<SentinelAlert>("sentinel://alert", (e) => {
      setFeed((prev) => [{ id: `a${e.payload.id}-${Date.now()}`, time: Date.now(), text: e.payload.title, tone: SEVERITY_TONE[e.payload.severity] ?? "text-text" }, ...prev].slice(0, 60));
    });
    return () => {
      unlistenEvent.then((f) => f());
      unlistenAlert.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<string>("chat://message", (event) => {
      try {
        const msg = JSON.parse(event.payload) as ChatMessage;
        if (msg.kind !== "action_result") return;
        const payload = JSON.parse(msg.text) as FleetActionResultPayload;
        setOutgoing((prev) => {
          const entry = Object.values(prev).find((r) => r.requestId === payload.requestId);
          if (!entry) return prev; // resultado de un pedido que no es nuestro, o que ya expiro
          return { ...prev, [entry.targetNick]: { ...entry, status: payload.ok ? "ok" : "denied", message: payload.message } };
        });
      } catch {
        // Un resultado mal formado no deberia romper el resto del Centro de Operaciones.
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  function requestIsolateNetwork(targetNick: string) {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setOutgoing((prev) => ({ ...prev, [targetNick]: { requestId, targetNick, action: "isolate_network", status: "pending" } }));
    api
      .fleetRequestAction(targetNick, "isolate_network", requestId)
      .catch((e) => setOutgoing((prev) => ({ ...prev, [targetNick]: { requestId, targetNick, action: "isolate_network", status: "error", message: String((e as Error)?.message ?? e) } })));
    setTimeout(() => {
      setOutgoing((prev) => (prev[targetNick]?.requestId === requestId && prev[targetNick]?.status === "pending" ? { ...prev, [targetNick]: { ...prev[targetNick], status: "timeout" } } : prev));
    }, REQUEST_TIMEOUT_MS);
  }

  const armedHoneytokens = (honeytokens.data ?? []).filter((t) => t.armed).length;
  const fleetMembers = Object.values(useFleetStore((s) => s.members)).filter((m) => m.nick !== myNick);

  return (
    <div className="h-full overflow-y-auto bg-[radial-gradient(ellipse_at_top,rgba(255,59,59,0.06),transparent_60%)] p-5">
      <div className="mb-4 flex items-center gap-2">
        <Radar size={16} className={cn("text-accent-bright", status.data?.running && "animate-pulseGlow")} />
        <h1 className="font-mono text-lg font-semibold text-text">Centro de Operaciones</h1>
        <span className={cn("ml-1 text-[10px] uppercase tracking-widest", status.data?.running ? "text-ok" : "text-text-dim")}>
          {status.data?.running ? "Sentinel activo" : "Sentinel detenido"}
        </span>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
        <Card title="Nivel de seguridad">
          {status.data?.has_baseline ? (
            <Gauge value={status.data.posture_score} label="Postura general" sublabel={`${status.data.unacknowledged_count} alertas sin revisar`} size={72} />
          ) : (
            <p className="text-xs text-text-dim">Sentinel aun no tiene una referencia del equipo.</p>
          )}
        </Card>
        <StatCard icon={ShieldAlert} label="Alertas sin revisar" value={status.data?.unacknowledged_count ?? 0} tone={status.data?.unacknowledged_count ? "text-accent-bright" : "text-ok"} />
        <StatCard icon={NetworkIcon} label="Puertos vigilados" value={status.data?.watched_ports ?? 0} tone="text-text" />
        <div className="grid grid-cols-2 gap-4">
          <StatCard icon={CalendarClock} label="Arranques" value={status.data?.watched_persistence ?? 0} tone="text-text" compact />
          <StatCard icon={Fish} label="Honeytokens" value={armedHoneytokens} tone="text-text" compact />
        </div>
      </div>

      <div className="mt-4">
        <Card
          title="Flota"
          action={<span className="text-[10px] text-text-dim">{fleetMembers.length} equipo(s) conectado(s)</span>}
        >
          {fleetMembers.length === 0 ? (
            <p className="flex items-start gap-2 text-xs text-text-dim">
              <Info size={13} className="mt-0.5 shrink-0" />
              Sin otras instancias de KRYPTOS conectadas todavia. Abri el modulo Chat y organiza o unite a una sesion
              en tu red local — mientras esa pestana siga abierta, el estado de Sentinel de cada equipo se comparte
              solo, sin tener que hacer nada mas.
            </p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
              {fleetMembers.map((m) => (
                <div key={m.nick} className="rounded-md border border-border bg-base p-2.5">
                  <div className="mb-1.5 flex items-center gap-1.5 text-[11px]">
                    <Server size={12} className={m.running ? "text-ok" : "text-text-dim"} />
                    <span className="truncate text-text">{m.hostname}</span>
                  </div>
                  <p className="text-[9px] text-text-dim">como "{m.nick}"</p>
                  <div className="mt-1.5 flex items-center justify-between text-[10px]">
                    <span className="text-text-dim">Postura</span>
                    <span className="font-mono text-text">{m.postureScore != null ? `${m.postureScore}%` : "—"}</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-text-dim">Alertas sin revisar</span>
                    <span className={cn("font-mono", m.unacknowledgedCount > 0 ? "text-accent-bright" : "text-ok")}>{m.unacknowledgedCount}</span>
                  </div>
                  <p className="mt-1.5 text-[9px] text-text-dim">Visto {new Date(m.receivedAtUnix * 1000).toLocaleTimeString()}</p>

                  <div className="mt-2 border-t border-borderMuted pt-2">
                    <FleetActionButton nick={m.nick} outgoing={outgoing[m.nick]} onRequest={() => setConfirmTarget(m.nick)} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
        <Card title="Mapa de red en vivo" className="lg:col-span-2">
          <NetworkGraph connections={connections.data ?? []} processes={processes.data ?? []} height={420} />
        </Card>

        <Card title="Pulso en vivo">
          <div className="flex items-center gap-1.5 pb-2 text-[10px] text-text-dim">
            <Activity size={11} className="animate-pulse" /> Actualiza en tiempo real
          </div>
          <div className="max-h-[420px] space-y-1.5 overflow-y-auto">
            {feed.length === 0 && <p className="text-xs text-text-dim">Sin actividad todavia en esta sesion.</p>}
            {feed.map((item) => (
              <div key={item.id} className="animate-fadeIn rounded-md border border-borderMuted bg-base px-2.5 py-1.5 text-[11px]">
                <span className="font-mono text-[9px] text-text-dim">{new Date(item.time).toLocaleTimeString()}</span>
                <p className={cn("truncate", item.tone)}>{item.text}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {confirmTarget && (
        <ConfirmDialog
          title="Pedir aislar red remota"
          message={`Le vas a pedir a "${confirmTarget}" que aisle la red de SU equipo. No se ejecuta solo: del otro lado le va a aparecer una confirmacion explicita, y puede rechazarla.`}
          confirmLabel="Enviar pedido"
          onCancel={() => setConfirmTarget(null)}
          onConfirm={() => {
            requestIsolateNetwork(confirmTarget);
            setConfirmTarget(null);
          }}
        />
      )}
    </div>
  );
}

function FleetActionButton({ nick, outgoing, onRequest }: { nick: string; outgoing?: OutgoingRequest; onRequest: () => void }) {
  const status = outgoing?.status;

  if (status === "pending") {
    return (
      <p className="flex items-center gap-1.5 text-[10px] text-text-dim">
        <Loader2 size={11} className="animate-spin" /> Esperando que {nick} confirme...
      </p>
    );
  }
  if (status === "ok") {
    return (
      <p className="flex items-center gap-1.5 text-[10px] text-ok">
        <Check size={11} /> Aprobado — red aislada en {nick}
      </p>
    );
  }
  if (status === "denied") {
    return (
      <div className="space-y-1">
        <p className="flex items-center gap-1.5 text-[10px] text-accent-bright">
          <X size={11} /> Rechazado por {nick}
        </p>
        <button onClick={onRequest} className="text-[10px] text-text-dim underline hover:text-text">
          Volver a pedir
        </button>
      </div>
    );
  }
  if (status === "timeout") {
    return (
      <div className="space-y-1">
        <p className="flex items-center gap-1.5 text-[10px] text-warn">
          <Clock size={11} /> Sin respuesta de {nick}
        </p>
        <button onClick={onRequest} className="text-[10px] text-text-dim underline hover:text-text">
          Volver a pedir
        </button>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="space-y-1">
        <p className="truncate text-[10px] text-accent-bright" title={outgoing?.message}>
          Error: {outgoing?.message}
        </p>
        <button onClick={onRequest} className="text-[10px] text-text-dim underline hover:text-text">
          Volver a pedir
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={onRequest}
      className="flex w-full items-center justify-center gap-1.5 rounded-md border border-accent/40 py-1 text-[10px] text-accent-bright hover:bg-accent/10"
    >
      <WifiOff size={11} /> {FLEET_ACTIONS.isolate_network.label} remota
    </button>
  );
}

function StatCard({ icon: Icon, label, value, tone, compact }: { icon: typeof Radar; label: string; value: number; tone: string; compact?: boolean }) {
  return (
    <Card title={compact ? undefined : label}>
      <div className="flex items-center gap-2.5">
        <Icon size={compact ? 14 : 18} className="shrink-0 text-text-dim" />
        <div>
          {compact && <p className="text-[10px] uppercase tracking-wide text-text-dim">{label}</p>}
          <p className={cn("font-mono text-xl font-semibold", tone)}>{value}</p>
        </div>
      </div>
    </Card>
  );
}
