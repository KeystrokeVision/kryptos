import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, ShieldX, ShieldQuestion, Fingerprint, Network, History, GitBranch } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/tauri";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SignatureInfo } from "@/types/dossier";

const SIGNATURE_META: Record<SignatureInfo["status"], { label: string; icon: typeof ShieldCheck; tone: string }> = {
  valida: { label: "Firma digital valida", icon: ShieldCheck, tone: "text-ok" },
  no_firmado: { label: "Sin firmar", icon: ShieldQuestion, tone: "text-warn" },
  invalida: { label: "Firma invalida o no confiable", icon: ShieldX, tone: "text-accent-bright" },
  no_disponible: { label: "No se pudo verificar", icon: ShieldQuestion, tone: "text-text-dim" },
};

/**
 * "Quien es este proceso, de verdad" en un solo panel: hash, firma
 * digital, quien lo lanzo, sus conexiones activas, y cualquier evento de
 * Sentinel que ya lo haya mencionado antes. Abrible desde Procesos y
 * desde cualquier alerta de Sentinel que traiga un PID.
 */
export function ProcessDossierModal({ pid, onClose }: { pid: number; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["process-dossier", pid],
    queryFn: () => api.investigateProcess(pid),
  });

  const sigMeta = data ? SIGNATURE_META[data.signature.status] : null;
  const SigIcon = sigMeta?.icon ?? ShieldQuestion;

  return (
    <Modal title={`Investigar proceso — PID ${pid}`} onClose={onClose} widthClassName="w-[560px]">
      {isLoading && <p className="text-xs text-text-dim">Reuniendo hash, firma, conexiones y eventos relacionados...</p>}
      {error && <p className="text-xs text-accent-bright">{String((error as Error).message ?? error)}</p>}

      {data && (
        <div className="space-y-4 text-xs">
          <div>
            <p className="text-sm font-medium text-text">{data.name}</p>
            <p className="truncate font-mono text-[11px] text-text-dim">{data.exe_path ?? "(ruta no disponible)"}</p>
            {data.cmd.length > 0 && <p className="mt-1 truncate font-mono text-[10px] text-text-dim">{data.cmd.join(" ")}</p>}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Estado" value={data.status} />
            <Field label="CPU" value={`${data.cpu_usage_percent.toFixed(1)}%`} />
            <Field label="Memoria" value={formatBytes(data.memory_bytes)} />
            <Field label="Inicio" value={data.start_time_unix ? new Date(data.start_time_unix * 1000).toLocaleString() : "—"} />
          </div>

          <div className="rounded-md border border-border bg-base p-2.5">
            <p className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-text-dim">
              <GitBranch size={11} /> Linaje completo
            </p>
            {data.ancestors.length === 0 ? (
              <p className="text-text-dim">No se pudo determinar quien lo lanzo (puede ser un proceso raiz del sistema).</p>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5">
                {[...data.ancestors].reverse().map((a, i) => (
                  <span key={a.pid} className="flex items-center gap-1.5">
                    {i > 0 && <span className="text-text-dim">→</span>}
                    <span className="rounded-full border border-borderMuted px-2 py-0.5 font-mono text-[10px] text-text-muted">
                      {a.name} <span className="text-text-dim">#{a.pid}</span>
                    </span>
                  </span>
                ))}
                <span className="text-text-dim">→</span>
                <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 font-mono text-[10px] text-text">
                  {data.name} <span className="text-text-dim">#{data.pid}</span>
                </span>
              </div>
            )}
          </div>

          <div className="rounded-md border border-border bg-base p-2.5">
            <div className="flex items-center gap-2">
              <SigIcon size={13} className={cn("shrink-0", sigMeta?.tone)} />
              <span className={cn(sigMeta?.tone)}>{sigMeta?.label}</span>
            </div>
            {data.signature.subject && <p className="mt-1 truncate pl-5 text-[10px] text-text-dim">{data.signature.subject}</p>}
            <div className="mt-2 flex items-center gap-2 border-t border-borderMuted pt-2">
              <Fingerprint size={13} className="shrink-0 text-text-dim" />
              <span className="truncate font-mono text-[10px] text-text-dim">{data.sha256 ?? "no se pudo calcular el hash"}</span>
            </div>
          </div>

          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-text-dim">
              <Network size={11} /> Conexiones activas ({data.connections.length})
            </p>
            {data.connections.length === 0 && <p className="text-text-dim">Ninguna conexion de red activa.</p>}
            <div className="space-y-1">
              {data.connections.map((c, i) => (
                <div key={i} className="rounded border border-borderMuted bg-base px-2 py-1 font-mono text-[10px] text-text-muted">
                  {c.protocol} {c.local_addr} → {c.remote_addr} {c.state ? `(${c.state})` : ""}
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-text-dim">
              <History size={11} /> Eventos de Sentinel relacionados ({data.related_events.length})
            </p>
            {data.related_events.length === 0 && <p className="text-text-dim">Sin menciones previas en la linea de tiempo.</p>}
            <div className="space-y-1">
              {data.related_events.map((e) => (
                <div key={e.id} className="rounded border border-borderMuted bg-base px-2 py-1.5 text-[10px] text-text-muted">
                  <span className="font-mono text-text-dim">{new Date(e.timestamp_unix * 1000).toLocaleString()}</span> · {e.kind}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-base p-2">
      <p className="text-[9px] uppercase tracking-wide text-text-dim">{label}</p>
      <p className="mt-0.5 font-mono text-text">{value}</p>
    </div>
  );
}
