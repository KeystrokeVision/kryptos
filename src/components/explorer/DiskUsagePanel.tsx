import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Folder, File as FileIcon, ArrowUp, AlertTriangle, HardDrive } from "lucide-react";
import { formatBytes } from "@/lib/format";
import { parentPath } from "@/lib/pathUtils";
import { api } from "@/lib/tauri";
import { cn } from "@/lib/utils";

interface DiskUsagePanelProps {
  initialPath: string;
}

const BAR_COLORS = ["bg-accent", "bg-[#5B9BFF]", "bg-ok", "bg-warn", "bg-[#C77DFF]"];

/**
 * Mapa de uso de disco estilo ncdu: en vez de precalcular el arbol entero
 * (carisimo en una carpeta grande), calcula el tamaño de los hijos directos
 * de la carpeta actual nada mas, y deja hacer click para entrar — la misma
 * logica de navegacion que el resto del Explorador, con una barra
 * proporcional al tamaño en vez de una tabla plana.
 */
export function DiskUsagePanel({ initialPath }: DiskUsagePanelProps) {
  const [path, setPath] = useState(initialPath);

  const sizes = useQuery({
    queryKey: ["explorer", "disk-usage", path],
    queryFn: () => api.getDirectorySizes(path),
  });

  const up = parentPath(path);
  const maxSize = Math.max(1, ...(sizes.data ?? []).map((e) => e.size_bytes));
  const anyTruncated = sizes.data?.some((e) => e.truncated) ?? false;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-borderMuted bg-panelAlt px-2 text-[11px]">
        <button
          onClick={() => up && setPath(up)}
          disabled={!up}
          className="flex h-6 w-6 items-center justify-center rounded text-text-dim hover:bg-white/[0.06] hover:text-text disabled:opacity-30"
          aria-label="Subir un nivel"
        >
          <ArrowUp size={12} />
        </button>
        <HardDrive size={12} className="text-text-dim" />
        <span className="truncate font-mono text-text-muted">{path}</span>
        {sizes.isFetching && <span className="text-text-dim">calculando...</span>}
      </div>

      {anyTruncated && (
        <div className="flex items-center gap-2 border-b border-warn/30 bg-warn/5 px-3 py-1.5 text-[10px] text-warn">
          <AlertTriangle size={11} /> Alguna carpeta es tan grande que el conteo se corto — el tamaño mostrado es un piso, no el total exacto.
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {sizes.isLoading && <p className="text-xs text-text-dim">Calculando tamaños...</p>}
        {sizes.isError && <p className="text-xs text-accent-bright">{String((sizes.error as Error)?.message)}</p>}
        {sizes.data?.length === 0 && <p className="text-xs text-text-dim">Carpeta vacía.</p>}

        <div className="space-y-1.5">
          {sizes.data?.map((entry, i) => (
            <button
              key={entry.path}
              onClick={() => entry.is_dir && setPath(entry.path)}
              disabled={!entry.is_dir}
              className={cn(
                "w-full rounded-md border border-border bg-base p-2 text-left",
                entry.is_dir ? "hover:border-accent/50 hover:bg-white/[0.03]" : "cursor-default opacity-80"
              )}
            >
              <div className="mb-1 flex items-center gap-2 text-[11px]">
                {entry.is_dir ? <Folder size={12} className="shrink-0 text-accent-bright" /> : <FileIcon size={12} className="shrink-0 text-text-dim" />}
                <span className="flex-1 truncate text-text">{entry.name}</span>
                {entry.truncated && <span className="text-[9px] text-warn">incompleto</span>}
                <span className="shrink-0 font-mono text-text-muted">{formatBytes(entry.size_bytes)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                <div
                  className={cn("h-full", BAR_COLORS[i % BAR_COLORS.length])}
                  style={{ width: `${Math.max(1, (entry.size_bytes / maxSize) * 100)}%` }}
                />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
