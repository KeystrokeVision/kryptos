import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { save } from "@tauri-apps/plugin-dialog";
import { History, RefreshCw, Trash2, CheckCircle2, XCircle, Download, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { api } from "@/lib/tauri";

export function AuditLogPanel() {
  const queryClient = useQueryClient();
  const [pendingClear, setPendingClear] = useState(false);
  const [lastExportHash, setLastExportHash] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const { data: entries, isLoading, refetch } = useQuery({
    queryKey: ["audit", "log"],
    queryFn: () => api.listAuditLog(300),
  });

  const clearMutation = useMutation({
    mutationFn: api.clearAuditLog,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["audit", "log"] }),
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      const result = await api.exportAuditLog();
      const destination = await save({ defaultPath: `kryptos-auditoria-${Date.now()}.json` });
      if (!destination) return null;
      await api.writeFileText(destination, result.json);
      await api.writeFileText(`${destination}.sha256`, `${result.sha256}  ${destination.split(/[\\/]/).pop()}\n`);
      return result.sha256;
    },
    onSuccess: (hash) => {
      if (hash) setLastExportHash(hash);
      setExportError(null);
    },
    onError: (e: Error) => setExportError(e.message),
  });

  return (
    <div className="h-full overflow-y-auto p-5">
      <Card
        title="Historial de auditoria"
        action={
          <div className="flex items-center gap-1">
            <button onClick={() => exportMutation.mutate()} className="text-text-dim hover:text-text" aria-label="Exportar con hash SHA-256">
              <Download size={13} className={exportMutation.isPending ? "animate-pulse" : ""} />
            </button>
            <button onClick={() => refetch()} className="text-text-dim hover:text-text">
              <RefreshCw size={13} className={isLoading ? "animate-spin" : ""} />
            </button>
            <button onClick={() => setPendingClear(true)} className="text-text-dim hover:text-accent-bright">
              <Trash2 size={13} />
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-text-dim">
            Registro local (guardado en SQLite) de operaciones criticas: procesos finalizados, lineas base eliminadas,
            reglas de firewall creadas o borradas, aplicaciones quitadas. Solo vive en este equipo — no se envia a
            ningun lado.
          </p>

          {exportError && <p className="text-xs text-accent-bright">{exportError}</p>}
          {lastExportHash && (
            <div className="flex items-start gap-2 rounded-md border border-ok/30 bg-ok/5 px-3 py-2 text-[11px]">
              <ShieldCheck size={13} className="mt-0.5 shrink-0 text-ok" />
              <div className="min-w-0">
                <p className="text-text-muted">
                  Exportado con hash SHA-256 (guardado en un archivo <span className="font-mono">.sha256</span> junto al
                  export). Cualquier cambio posterior al archivo hara que el hash ya no coincida.
                </p>
                <p className="mt-1 truncate font-mono text-[10px] text-text-dim">{lastExportHash}</p>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            {(entries ?? []).map((entry) => (
              <div key={entry.id} className="flex items-start gap-2.5 rounded-md border border-border bg-base px-3 py-2 text-[11px]">
                {entry.result === "ok" ? (
                  <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-ok" />
                ) : (
                  <XCircle size={13} className="mt-0.5 shrink-0 text-accent-bright" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-text">{entry.action}</span>
                    <span className="text-text-dim">{new Date(entry.timestamp_unix * 1000).toLocaleString()}</span>
                  </div>
                  <p className="mt-0.5 break-all text-text-muted">{entry.target}</p>
                  {entry.details && <p className="mt-0.5 break-all text-text-dim">{entry.details}</p>}
                </div>
              </div>
            ))}
            {!isLoading && (entries ?? []).length === 0 && (
              <div className="flex flex-col items-center py-10 text-center">
                <History size={22} className="mb-2 text-text-dim" />
                <p className="text-xs text-text-dim">Aun no hay eventos registrados.</p>
              </div>
            )}
          </div>
        </div>
      </Card>

      {pendingClear && (
        <ConfirmDialog
          title="Limpiar historial"
          message="¿Borrar todo el historial de auditoria? Esta accion no se puede deshacer."
          confirmLabel="Borrar todo"
          onCancel={() => setPendingClear(false)}
          onConfirm={() => {
            clearMutation.mutate();
            setPendingClear(false);
          }}
        />
      )}
    </div>
  );
}
