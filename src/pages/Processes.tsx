import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, RefreshCw, Skull, ArrowUpDown, AlertTriangle, Cpu, ScanSearch } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ProcessDossierModal } from "@/components/layout/ProcessDossierModal";
import { api } from "@/lib/tauri";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ProcessInfo } from "@/types/system";

type SortKey = "name" | "pid" | "cpu_usage_percent" | "memory_bytes" | "status";

export default function Processes() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("cpu_usage_percent");
  const [sortDesc, setSortDesc] = useState(true);
  const [pendingKill, setPendingKill] = useState<ProcessInfo | null>(null);
  const [killError, setKillError] = useState<string | null>(null);
  const [investigatingPid, setInvestigatingPid] = useState<number | null>(null);

  const { data: processes, isLoading, isFetching } = useQuery({
    queryKey: ["processes", "full"],
    queryFn: api.listProcesses,
    refetchInterval: 3000,
  });

  const killMutation = useMutation({
    mutationFn: (pid: number) => api.killProcess(pid),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["processes"] }),
    onError: (e: Error) => setKillError(e.message),
  });

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDesc((d) => !d);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = processes ?? [];
    if (q) {
      list = list.filter((p) => p.name.toLowerCase().includes(q) || String(p.pid).includes(q));
    }
    const sorted = [...list].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sortDesc ? -cmp : cmp;
    });
    return sorted;
  }, [processes, query, sortKey, sortDesc]);

  const columns: { key: SortKey; label: string; className?: string }[] = [
    { key: "name", label: "Nombre" },
    { key: "pid", label: "PID", className: "w-20" },
    { key: "cpu_usage_percent", label: "CPU", className: "w-20" },
    { key: "memory_bytes", label: "Memoria", className: "w-24" },
    { key: "status", label: "Estado", className: "w-24" },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-borderMuted bg-panelAlt px-3">
        <Cpu size={13} className="text-accent-bright" />
        <h2 className="text-xs font-medium text-text">Procesos</h2>
        <span className="text-[10px] text-text-dim">({filtered.length})</span>

        <div className="ml-auto flex items-center gap-2">
          <div className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-base px-2">
            <Search size={11} className="text-text-dim" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nombre o PID..."
              className="h-full w-48 bg-transparent text-[11px] text-text outline-none placeholder:text-text-dim"
            />
          </div>
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ["processes"] })}
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-dim hover:bg-overlay/[0.06] hover:text-text"
            aria-label="Actualizar"
          >
            <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {killError && (
        <div className="flex items-start gap-2 border-b border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent-bright">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          {killError}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <p className="p-4 text-xs text-text-dim">Cargando procesos...</p>
        ) : (
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-panel text-[10px] uppercase tracking-widest text-text-dim">
              <tr>
                {columns.map((col) => (
                  <th key={col.key} className={cn("px-3 py-2 font-medium", col.className)}>
                    <button onClick={() => toggleSort(col.key)} className="flex items-center gap-1 hover:text-text">
                      {col.label}
                      <ArrowUpDown size={9} className={sortKey === col.key ? "text-accent-bright" : "opacity-40"} />
                    </button>
                  </th>
                ))}
                <th className="w-16 px-3 py-2 font-medium">Accion</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.pid} className="group border-t border-borderMuted hover:bg-overlay/[0.03]">
                  <td className="max-w-0 truncate px-3 py-1.5 text-text" title={p.name}>
                    {p.name}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-text-dim">{p.pid}</td>
                  <td className={cn("px-3 py-1.5 font-mono", p.cpu_usage_percent > 50 ? "text-warn" : "text-text-dim")}>
                    {p.cpu_usage_percent.toFixed(1)}%
                  </td>
                  <td className="px-3 py-1.5 font-mono text-text-dim">{formatBytes(p.memory_bytes)}</td>
                  <td className="px-3 py-1.5 text-text-dim">{p.status}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                      <button
                        onClick={() => setInvestigatingPid(p.pid)}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-text-dim hover:text-accent-bright"
                        aria-label={`Investigar ${p.name}`}
                        title="Investigar proceso"
                      >
                        <ScanSearch size={12} />
                      </button>
                      <button
                        onClick={() => setPendingKill(p)}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-text-dim hover:text-accent-bright"
                        aria-label={`Finalizar ${p.name}`}
                        title="Finalizar proceso"
                      >
                        <Skull size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-text-dim">
                    Sin resultados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {pendingKill && (
        <ConfirmDialog
          title="Finalizar proceso"
          message={`¿Finalizar "${pendingKill.name}" (PID ${pendingKill.pid})? Los datos no guardados en ese programa se perderan.`}
          confirmLabel="Finalizar"
          onCancel={() => setPendingKill(null)}
          onConfirm={() => {
            setKillError(null);
            killMutation.mutate(pendingKill.pid);
            setPendingKill(null);
          }}
        />
      )}

      {investigatingPid !== null && <ProcessDossierModal pid={investigatingPid} onClose={() => setInvestigatingPid(null)} />}
    </div>
  );
}
