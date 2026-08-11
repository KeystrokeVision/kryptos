import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ScrollText, RefreshCw, AlertTriangle, Download } from "lucide-react";
import { RelaunchElevatedButton, looksLikePermissionError } from "@/components/layout/RelaunchElevatedButton";
import { api } from "@/lib/tauri";
import { cn } from "@/lib/utils";

const LOG_SOURCES = [
  { id: "Application", label: "Aplicacion" },
  { id: "System", label: "Sistema" },
];

const LEVELS = [
  { id: "", label: "Todos" },
  { id: "Error", label: "Error" },
  { id: "Warning", label: "Advertencia" },
  { id: "Information", label: "Informacion" },
];

function levelTone(level: string | null) {
  const l = (level ?? "").toLowerCase();
  if (l.includes("error") || l.includes("critical")) return "text-accent-bright";
  if (l.includes("warn")) return "text-warn";
  return "text-text-dim";
}

export default function Logs() {
  const [source, setSource] = useState("Application");
  const [level, setLevel] = useState("");
  const [query, setQuery] = useState("");

  const mutation = useMutation({
    mutationFn: (vars: { source: string; level: string }) => api.readSystemLogs(vars.source, vars.level || undefined, 200),
  });

  function run(nextSource: string, nextLevel: string) {
    setSource(nextSource);
    setLevel(nextLevel);
    mutation.mutate({ source: nextSource, level: nextLevel });
  }

  const filtered = (mutation.data ?? []).filter(
    (e) => !query.trim() || e.message.toLowerCase().includes(query.trim().toLowerCase())
  );

  function exportCsv() {
    const rows = [
      ["time", "level", "source", "message"],
      ...filtered.map((e) => [e.time ?? "", e.level ?? "", e.source ?? "", e.message.replace(/\n/g, " ")]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kryptos-logs-${source}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 flex-wrap items-center gap-2 border-b border-borderMuted bg-panelAlt px-3">
        <ScrollText size={13} className="text-accent-bright" />
        <h2 className="text-xs font-medium text-text">Logs</h2>

        <div className="ml-2 flex gap-1">
          {LOG_SOURCES.map((s) => (
            <button
              key={s.id}
              onClick={() => run(s.id, level)}
              className={cn(
                "rounded-md border px-2 py-1 text-[11px]",
                source === s.id ? "border-accent/60 bg-accent/10 text-text" : "border-border text-text-muted hover:bg-white/[0.03]"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        <select value={level} onChange={(e) => run(source, e.target.value)} className="h-7 rounded-md border border-border bg-base px-2 text-[11px] text-text outline-none">
          {LEVELS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filtrar por texto..."
          className="h-7 w-40 rounded-md border border-border bg-base px-2 text-[11px] text-text outline-none placeholder:text-text-dim"
        />

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-text-muted hover:bg-white/[0.04] disabled:opacity-40"
          >
            <Download size={11} /> Exportar CSV
          </button>
          <button onClick={() => run(source, level)} className="flex h-7 w-7 items-center justify-center rounded-md text-text-dim hover:bg-white/[0.06] hover:text-text" aria-label="Actualizar">
            <RefreshCw size={13} className={mutation.isPending ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {mutation.isError && (
        <div className="flex items-start gap-2 border-b border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent-bright">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>{String((mutation.error as Error)?.message)}</span>
          {looksLikePermissionError(String((mutation.error as Error)?.message ?? "")) && <RelaunchElevatedButton />}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {mutation.isPending && <p className="p-4 text-xs text-text-dim">Cargando...</p>}
        {!mutation.isPending && !mutation.data && <p className="p-4 text-xs text-text-dim">Selecciona una fuente para cargar los logs.</p>}
        <div className="space-y-1">
          {filtered.map((e, i) => (
            <div key={i} className="rounded-md border border-border bg-base p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2 text-text-dim">
                {e.time && <span>{new Date(e.time).toLocaleString()}</span>}
                {e.level && <span className={cn("font-mono", levelTone(e.level))}>{e.level}</span>}
                {e.source && <span className="font-mono">{e.source}</span>}
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-text-muted">{e.message}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
