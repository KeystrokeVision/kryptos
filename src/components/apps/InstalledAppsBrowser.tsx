import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Plus, AppWindow, AlertTriangle } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/tauri";
import type { DiscoveredApp } from "@/types/apps";

interface InstalledAppsBrowserProps {
  onClose: () => void;
  onPick: (app: DiscoveredApp) => void;
}

export function InstalledAppsBrowser({ onClose, onPick }: InstalledAppsBrowserProps) {
  const [query, setQuery] = useState("");
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["apps", "installed"],
    queryFn: api.listInstalledApplications,
  });

  const filtered = (data ?? []).filter((a) => a.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <Modal title="Aplicaciones instaladas en este equipo" onClose={onClose} widthClassName="w-[480px]">
      <div className="space-y-3">
        <p className="text-xs text-text-dim">
          Elige una para agregarla al lanzador — sin buscar el .exe a mano. Se lee de la misma lista que usa
          "Aplicaciones y caracteristicas" de Windows.
        </p>

        <div className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-base px-2">
          <Search size={12} className="text-text-dim" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar..."
            className="h-full flex-1 bg-transparent text-xs text-text outline-none placeholder:text-text-dim"
          />
        </div>

        {isError && (
          <div className="flex items-start gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent-bright">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            {String((error as Error)?.message)}
          </div>
        )}

        <div className="max-h-72 space-y-1 overflow-y-auto">
          {isLoading && <p className="py-6 text-center text-xs text-text-dim">Buscando aplicaciones instaladas...</p>}
          {!isLoading &&
            filtered.map((app) => (
              <button
                key={app.exec_path}
                onClick={() => onPick(app)}
                className="flex w-full items-center gap-2.5 rounded-md border border-border bg-base px-3 py-2 text-left text-xs hover:border-accent/50 hover:bg-white/[0.03]"
              >
                <AppWindow size={14} className="shrink-0 text-accent-bright" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-text">{app.name}</p>
                  <p className="truncate font-mono text-[10px] text-text-dim">{app.exec_path}</p>
                </div>
                <Plus size={13} className="shrink-0 text-text-dim" />
              </button>
            ))}
          {!isLoading && filtered.length === 0 && !isError && <p className="py-6 text-center text-xs text-text-dim">Sin resultados.</p>}
        </div>
      </div>
    </Modal>
  );
}
