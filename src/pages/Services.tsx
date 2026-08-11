import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cog, Search, RefreshCw, Play, Square, RotateCw, AlertTriangle } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { RelaunchElevatedButton, looksLikePermissionError } from "@/components/layout/RelaunchElevatedButton";
import { api } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { ServiceInfo } from "@/types/services";

type PendingAction = { service: ServiceInfo; verb: "stop" | "restart" } | null;

function statusTone(status: string) {
  const s = status.toLowerCase();
  if (s.includes("running") || s.includes("active")) return "text-ok";
  if (s.includes("stopped") || s.includes("inactive") || s.includes("dead")) return "text-text-dim";
  return "text-warn";
}

export default function Services() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: services, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ["services", "list"],
    queryFn: api.listServices,
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["services", "list"] });
  }

  const startMutation = useMutation({
    mutationFn: (name: string) => api.startService(name),
    onSuccess: invalidate,
    onError: (e: Error) => setActionError(e.message),
  });
  const stopMutation = useMutation({
    mutationFn: (name: string) => api.stopService(name),
    onSuccess: invalidate,
    onError: (e: Error) => setActionError(e.message),
  });
  const restartMutation = useMutation({
    mutationFn: (name: string) => api.restartService(name),
    onSuccess: invalidate,
    onError: (e: Error) => setActionError(e.message),
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = services ?? [];
    if (!q) return list;
    return list.filter((s) => s.name.toLowerCase().includes(q) || s.display_name.toLowerCase().includes(q));
  }, [services, query]);

  function runAction(verb: "start" | "stop" | "restart", name: string) {
    setActionError(null);
    if (verb === "start") startMutation.mutate(name);
    if (verb === "stop") stopMutation.mutate(name);
    if (verb === "restart") restartMutation.mutate(name);
  }

  const anyErrorMessage = String((error as Error)?.message ?? actionError ?? "");

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-borderMuted bg-panelAlt px-3">
        <Cog size={13} className="text-accent-bright" />
        <h2 className="text-xs font-medium text-text">Servicios</h2>
        <span className="text-[10px] text-text-dim">({filtered.length})</span>

        <div className="ml-auto flex items-center gap-2">
          <div className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-base px-2">
            <Search size={11} className="text-text-dim" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar servicio..."
              className="h-full w-48 bg-transparent text-[11px] text-text outline-none placeholder:text-text-dim"
            />
          </div>
          <button
            onClick={() => refetch()}
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-dim hover:bg-white/[0.06] hover:text-text"
            aria-label="Actualizar"
          >
            <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {(isError || actionError) && (
        <div className="flex items-start gap-2 border-b border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent-bright">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>{anyErrorMessage}</span>
          {looksLikePermissionError(anyErrorMessage) && <RelaunchElevatedButton />}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <p className="p-4 text-xs text-text-dim">Cargando servicios...</p>
        ) : (
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-panel text-[10px] uppercase tracking-widest text-text-dim">
              <tr>
                <th className="px-3 py-2 font-medium">Nombre</th>
                <th className="px-3 py-2 font-medium">Estado</th>
                <th className="w-28 px-3 py-2 font-medium">Inicio</th>
                <th className="w-32 px-3 py-2 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.name} className="group border-t border-borderMuted hover:bg-white/[0.03]">
                  <td className="max-w-0 px-3 py-1.5">
                    <p className="truncate text-text" title={s.display_name}>
                      {s.display_name}
                    </p>
                    <p className="truncate font-mono text-[10px] text-text-dim">{s.name}</p>
                  </td>
                  <td className={cn("px-3 py-1.5 font-mono", statusTone(s.status))}>{s.status}</td>
                  <td className="px-3 py-1.5 text-text-dim">{s.start_type ?? "—"}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => runAction("start", s.name)}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-text-dim hover:text-ok"
                        aria-label={`Iniciar ${s.display_name}`}
                      >
                        <Play size={11} />
                      </button>
                      <button
                        onClick={() => setPendingAction({ service: s, verb: "stop" })}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-text-dim hover:text-accent-bright"
                        aria-label={`Detener ${s.display_name}`}
                      >
                        <Square size={11} />
                      </button>
                      <button
                        onClick={() => setPendingAction({ service: s, verb: "restart" })}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-text-dim hover:text-warn"
                        aria-label={`Reiniciar ${s.display_name}`}
                      >
                        <RotateCw size={11} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-text-dim">
                    Sin resultados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {pendingAction && (
        <ConfirmDialog
          title={pendingAction.verb === "stop" ? "Detener servicio" : "Reiniciar servicio"}
          message={`¿${pendingAction.verb === "stop" ? "Detener" : "Reiniciar"} "${pendingAction.service.display_name}"? Esto puede afectar a otros programas que dependen de este servicio.`}
          confirmLabel={pendingAction.verb === "stop" ? "Detener" : "Reiniciar"}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => {
            runAction(pendingAction.verb, pendingAction.service.name);
            setPendingAction(null);
          }}
        />
      )}
    </div>
  );
}
