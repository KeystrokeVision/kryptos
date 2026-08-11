import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ScrollText, AlertTriangle, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { RelaunchElevatedButton, looksLikePermissionError } from "@/components/layout/RelaunchElevatedButton";
import { api } from "@/lib/tauri";
import { cn } from "@/lib/utils";

const PRESETS = [
  { id: "failed_logins", label: "Intentos de acceso fallidos" },
  { id: "account_changes", label: "Cambios de cuentas/usuarios" },
  { id: "all_security", label: "Todo (mas reciente)" },
];

export function SecurityLogsPanel() {
  const [preset, setPreset] = useState("failed_logins");

  const mutation = useMutation({
    mutationFn: (p: string) => api.readSecurityEvents(p, 100),
  });

  return (
    <div className="h-full overflow-y-auto p-5">
      <Card title="Analisis de logs de seguridad">
        <div className="space-y-4">
          <p className="text-xs text-text-dim">
            Lee el registro de Seguridad de Windows (o el journal en Linux, con filtrado por palabra clave) buscando
            patrones conocidos: accesos fallidos, bloqueos de cuenta, cambios de usuarios. Puede pedir permisos de
            administrador.
          </p>

          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setPreset(p.id);
                  mutation.mutate(p.id);
                }}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-[11px] transition-colors",
                  preset === p.id ? "border-accent/60 bg-accent/10 text-text" : "border-border text-text-muted hover:bg-white/[0.03]"
                )}
              >
                {p.label}
              </button>
            ))}
            <button
              onClick={() => mutation.mutate(preset)}
              className="ml-auto flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[11px] text-text-muted hover:bg-white/[0.04]"
            >
              <RefreshCw size={11} className={mutation.isPending ? "animate-spin" : ""} />
              Actualizar
            </button>
          </div>

          {mutation.isError && (
            <div className="flex items-start gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent-bright">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>{String((mutation.error as Error)?.message ?? mutation.error)}</span>
              {looksLikePermissionError(String((mutation.error as Error)?.message ?? "")) && <RelaunchElevatedButton />}
            </div>
          )}

          {mutation.data && (
            <div className="space-y-2">
              <p className="text-[11px] text-text-dim">
                Fuente: {mutation.data.source} · {mutation.data.entries.length} entrada(s)
              </p>
              {mutation.data.entries.length === 0 && (
                <p className="text-xs text-text-dim">Sin coincidencias para este filtro.</p>
              )}
              <div className="max-h-[55vh] space-y-1.5 overflow-y-auto">
                {mutation.data.entries.map((entry, i) => (
                  <div key={i} className="rounded-md border border-border bg-base p-2.5 text-[11px]">
                    <div className="flex flex-wrap items-center gap-2 text-text-dim">
                      <ScrollText size={11} />
                      {entry.time && <span>{new Date(entry.time).toLocaleString()}</span>}
                      {entry.event_id !== null && (
                        <span className="rounded-full border border-borderMuted px-1.5 py-0.5 font-mono text-[10px]">
                          ID {entry.event_id}
                        </span>
                      )}
                      {entry.level && <span>{entry.level}</span>}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-text-muted">{entry.message}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
