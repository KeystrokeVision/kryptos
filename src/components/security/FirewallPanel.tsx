import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flame, Plus, Trash2, AlertTriangle, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { RelaunchElevatedButton, looksLikePermissionError } from "@/components/layout/RelaunchElevatedButton";
import { api } from "@/lib/tauri";
import { cn } from "@/lib/utils";

export function FirewallPanel() {
  const [name, setName] = useState("");
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [action, setAction] = useState<"allow" | "block">("block");
  const [protocol, setProtocol] = useState<"TCP" | "UDP" | "Any">("TCP");
  const [port, setPort] = useState("");
  const [pendingAdd, setPendingAdd] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; label: string } | null>(null);
  const queryClient = useQueryClient();

  const { data: rules, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["security", "firewall-rules"],
    queryFn: api.listFirewallRules,
  });

  const addMutation = useMutation({
    mutationFn: () => api.addFirewallRule(name.trim(), direction, action, protocol, port.trim()),
    onSuccess: () => {
      setName("");
      setPort("");
      queryClient.invalidateQueries({ queryKey: ["security", "firewall-rules"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteFirewallRule(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["security", "firewall-rules"] }),
  });

  function submitAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !port.trim()) return;
    setPendingAdd(true);
  }

  function confirmDelete(id: string, label: string) {
    setPendingDelete({ id, label });
  }

  return (
    <div className="grid h-full grid-cols-1 gap-4 overflow-y-auto p-5 xl:grid-cols-[380px_1fr]">
      <Card title="Nueva regla">
        <form onSubmit={submitAdd} className="space-y-3">
          <p className="text-xs text-text-dim">
            Reglas basadas en puerto y protocolo (Firewall de Windows via <span className="font-mono">netsh</span>, o{" "}
            <span className="font-mono">ufw</span> en Linux). Requiere permisos de administrador.
          </p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre de la regla (ej. Bloquear RDP externo)"
            className="h-8 w-full rounded-md border border-border bg-base px-2.5 text-xs text-text outline-none focus:border-accent/60"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value as "in" | "out")}
              className="h-8 rounded-md border border-border bg-base px-2 text-xs text-text outline-none"
            >
              <option value="in">Entrante</option>
              <option value="out">Saliente</option>
            </select>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value as "allow" | "block")}
              className="h-8 rounded-md border border-border bg-base px-2 text-xs text-text outline-none"
            >
              <option value="block">Bloquear</option>
              <option value="allow">Permitir</option>
            </select>
            <select
              value={protocol}
              onChange={(e) => setProtocol(e.target.value as "TCP" | "UDP" | "Any")}
              className="h-8 rounded-md border border-border bg-base px-2 text-xs text-text outline-none"
            >
              <option value="TCP">TCP</option>
              <option value="UDP">UDP</option>
              <option value="Any">Cualquiera</option>
            </select>
            <input
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="Puerto (ej. 3389)"
              className="h-8 rounded-md border border-border bg-base px-2.5 font-mono text-xs text-text outline-none focus:border-accent/60"
            />
          </div>
          <button
            type="submit"
            disabled={!name.trim() || !port.trim() || addMutation.isPending}
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-accent text-xs font-medium text-white hover:bg-accent-bright disabled:opacity-40"
          >
            <Plus size={13} />
            {addMutation.isPending ? "Creando..." : "Crear regla"}
          </button>
          {addMutation.isError && (
            <p className="text-xs text-accent-bright">{String((addMutation.error as Error)?.message)}</p>
          )}
        </form>
      </Card>

      <Card
        title="Reglas activas"
        action={
          <button onClick={() => refetch()} className="text-text-dim hover:text-text">
            <RefreshCw size={13} className={isLoading ? "animate-spin" : ""} />
          </button>
        }
      >
        {isError && (
          <div className="flex items-start gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent-bright">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>{String((error as Error)?.message ?? error)}</span>
            {looksLikePermissionError(String((error as Error)?.message ?? "")) && <RelaunchElevatedButton />}
          </div>
        )}
        <div className="space-y-1.5">
          {(rules ?? []).map((rule) => (
            <div key={rule.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-base px-3 py-2 text-[11px]">
              <div className="flex min-w-0 items-center gap-2">
                <Flame
                  size={12}
                  className={cn(rule.action?.toLowerCase() === "block" ? "text-accent-bright" : "text-ok")}
                />
                <div className="min-w-0">
                  <p className="truncate text-text">{rule.name}</p>
                  <p className="text-[10px] text-text-dim">
                    {rule.direction ?? "—"} · {rule.protocol ?? "—"} · puerto {rule.local_port ?? "—"} ·{" "}
                    {rule.action ?? "—"}
                    {rule.enabled === false && " · deshabilitada"}
                  </p>
                </div>
              </div>
              <button
                onClick={() => confirmDelete(rule.id, rule.name)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-text-dim hover:border-accent/50 hover:text-accent-bright"
                aria-label={`Eliminar ${rule.name}`}
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
          {!isLoading && !isError && (rules ?? []).length === 0 && (
            <p className="text-xs text-text-dim">No se encontraron reglas.</p>
          )}
        </div>
      </Card>

      {pendingAdd && (
        <ConfirmDialog
          title="Crear regla de firewall"
          message={`¿Crear regla para ${action === "allow" ? "permitir" : "bloquear"} trafico ${
            direction === "in" ? "entrante" : "saliente"
          } en el puerto ${port} (${protocol})?`}
          confirmLabel="Crear regla"
          onCancel={() => setPendingAdd(false)}
          onConfirm={() => {
            addMutation.mutate();
            setPendingAdd(false);
          }}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Eliminar regla de firewall"
          message={`¿Eliminar la regla "${pendingDelete.label}"? Esta accion no se puede deshacer.`}
          confirmLabel="Eliminar"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            deleteMutation.mutate(pendingDelete.id);
            setPendingDelete(null);
          }}
        />
      )}
    </div>
  );
}
