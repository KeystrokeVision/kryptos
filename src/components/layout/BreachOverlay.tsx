import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Siren, Check, X, ShieldAlert } from "lucide-react";
import { api } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { SentinelAlert } from "@/types/sentinel";

/**
 * Montado una sola vez en la raiz de la app (ver App.tsx). Cuando Sentinel
 * dispara una alerta de severidad "critica" — la unica categoria por debajo
 * de la cual algo realmente grave paso (persistencia nueva, puerto
 * inesperado, honeytoken tocado) — esto toma toda la pantalla en vez de
 * quedar como una notificacion mas entre las demas. Las de severidad "alta"
 * siguen yendo solo por notificacion nativa (ver SentinelWatcher); esto es
 * deliberadamente mas dramatico y deliberadamente reservado para lo que de
 * verdad lo amerita.
 *
 * Si llegan varias criticas seguidas se encolan — nunca se apilan dialogos,
 * se resuelven una por una. "Descartar" solo cierra esta pantalla (la alerta
 * sigue sin confirmar en Sentinel); "Reconocer" la marca como revisada.
 */
export function BreachOverlay() {
  const [queue, setQueue] = useState<SentinelAlert[]>([]);
  const [shake, setShake] = useState(false);

  useEffect(() => {
    const unlisten = listen<SentinelAlert>("sentinel://alert", (event) => {
      const alert = event.payload;
      if (alert.severity !== "critica") return;
      setQueue((prev) => (prev.some((a) => a.id === alert.id) ? prev : [...prev, alert]));
      setShake(true);
      setTimeout(() => setShake(false), 420);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (queue.length === 0) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setQueue((prev) => prev.slice(1));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [queue.length]);

  if (queue.length === 0) return null;
  const current = queue[0];
  const remaining = queue.length - 1;

  async function acknowledge() {
    try {
      await api.sentinelAcknowledgeAlert(current.id);
    } catch {
      // Si el backend no responde igual sacamos esta de la cola local — el
      // usuario ya la vio, no tiene sentido volver a mostrarsela ahora.
    }
    setQueue((prev) => prev.slice(1));
  }

  function dismiss() {
    setQueue((prev) => prev.slice(1));
  }

  return (
    <div
      className={cn(
        "fixed inset-0 z-[500] flex items-center justify-center bg-[radial-gradient(ellipse_at_center,rgba(176,0,32,0.22),rgba(0,0,0,0.88)_75%)] backdrop-blur-[1px]",
        "motion-safe:animate-fadeIn"
      )}
      role="alertdialog"
      aria-modal="true"
    >
      <div className="pointer-events-none absolute inset-0 border-4 border-accent-bright/70 motion-safe:animate-pulseGlow" />
      <div
        className={cn(
          "relative w-full max-w-md rounded-lg border border-accent-bright/50 bg-panel p-5 shadow-[0_0_60px_-10px_rgba(255,59,59,0.55)]",
          shake && "motion-safe:animate-[breachShake_0.4s_ease-in-out]"
        )}
      >
        <div className="mb-3 flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent-bright motion-safe:animate-pulseGlow">
            <Siren size={18} />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.2em] text-accent-bright">Alerta critica de seguridad</p>
            <p className="truncate text-sm font-semibold text-text">{current.title}</p>
          </div>
        </div>

        <p className="mb-3 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-text-muted">{current.detail}</p>

        <div className="mb-4 flex flex-wrap items-center gap-2 text-[10px] text-text-dim">
          <span className="rounded border border-borderMuted px-1.5 py-0.5 font-mono">{current.rule_id}</span>
          {current.mitre_id && <span className="rounded border border-borderMuted px-1.5 py-0.5 font-mono text-warn">{current.mitre_id}</span>}
          <span>{new Date(current.timestamp_unix * 1000).toLocaleString()}</span>
          {remaining > 0 && <span className="ml-auto flex items-center gap-1 text-accent-bright"><ShieldAlert size={11} />+{remaining} mas en cola</span>}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={acknowledge}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent-bright"
          >
            <Check size={13} /> Reconocer
          </button>
          <button
            onClick={dismiss}
            className="flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs text-text-dim hover:bg-white/[0.04] hover:text-text"
          >
            <X size={13} /> Descartar
          </button>
        </div>
        <p className="mt-2 text-center text-[9px] text-text-dim">Esc para descartar</p>
      </div>
    </div>
  );
}
