import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Search, AlertTriangle, Clock, CalendarClock } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { RelaunchElevatedButton, looksLikePermissionError } from "@/components/layout/RelaunchElevatedButton";
import { api } from "@/lib/tauri";

export function PersistencePanel() {
  const [query, setQuery] = useState("");

  const { data: tasks, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ["security", "scheduled-tasks"],
    queryFn: api.listScheduledTasks,
  });

  const filtered = (tasks ?? []).filter((t) => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return t.name.toLowerCase().includes(q) || t.command.toLowerCase().includes(q) || t.source.toLowerCase().includes(q);
  });

  return (
    <div className="h-full overflow-y-auto p-5">
      <Card
        title="Tareas programadas y persistencia"
        action={
          <button onClick={() => refetch()} className="text-text-dim hover:text-text">
            <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
          </button>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-text-dim">
            Todo lo que esta configurado para ejecutarse solo, automaticamente — Tareas Programadas en Windows, cron
            en Linux. Es la misma categoria de revision que hace Autoruns: asi es como el malware sobrevive un
            reinicio, asi que una entrada que no reconoces vale la pena investigarla.
          </p>

          <div className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-base px-2">
            <Search size={12} className="text-text-dim" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nombre, comando o fuente..."
              className="h-full flex-1 bg-transparent text-xs text-text outline-none placeholder:text-text-dim"
            />
          </div>

          {isError && (
            <div className="flex items-start gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent-bright">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>{String((error as Error)?.message)}</span>
              {looksLikePermissionError(String((error as Error)?.message ?? "")) && <RelaunchElevatedButton />}
            </div>
          )}

          {isLoading ? (
            <p className="text-xs text-text-dim">Cargando...</p>
          ) : (
            <div className="space-y-1.5">
              {filtered.map((t, i) => (
                <div key={i} className="rounded-md border border-border bg-base p-2.5 text-[11px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <CalendarClock size={12} className="shrink-0 text-accent-bright" />
                    <span className="text-text">{t.name}</span>
                    {t.enabled === false && (
                      <span className="rounded-full border border-borderMuted px-1.5 py-0.5 text-[9px] text-text-dim">deshabilitada</span>
                    )}
                  </div>
                  {t.schedule && (
                    <p className="mt-1 flex items-center gap-1 font-mono text-[10px] text-text-dim">
                      <Clock size={9} /> {t.schedule}
                    </p>
                  )}
                  <p className="mt-1 break-all font-mono text-[10px] text-text-muted">{t.command}</p>
                  <p className="mt-1 truncate text-[9px] text-text-dim">{t.source}</p>
                </div>
              ))}
              {filtered.length === 0 && <p className="text-xs text-text-dim">Sin resultados.</p>}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
