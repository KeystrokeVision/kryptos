import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Star, HardDrive, X } from "lucide-react";
import { api } from "@/lib/tauri";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

interface ExplorerSidebarProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  onDropInto: (destPath: string, sourcePaths: string[], mode: "move" | "copy") => void;
}

export function ExplorerSidebar({ currentPath, onNavigate, onDropInto }: ExplorerSidebarProps) {
  const queryClient = useQueryClient();
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);

  const { data: favorites } = useQuery({ queryKey: ["explorer", "favorites"], queryFn: api.listFavorites });
  const { data: drives } = useQuery({ queryKey: ["explorer", "drives"], queryFn: api.listDrives });

  const removeFavorite = useMutation({
    mutationFn: (id: number) => api.removeFavorite(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["explorer", "favorites"] }),
  });

  // Favoritos y unidades tambien aceptan que se suelte algo encima — la
  // misma logica de mover/copiar (Ctrl) que las carpetas de la lista.
  function dropHandlers(destPath: string) {
    return {
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = e.ctrlKey ? "copy" : "move";
        setDragOverPath(destPath);
      },
      onDragLeave: () => setDragOverPath((p) => (p === destPath ? null : p)),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        setDragOverPath(null);
        const paths = e.dataTransfer.getData("text/plain").split("\n").filter(Boolean);
        if (paths.length > 0) onDropInto(destPath, paths, e.ctrlKey ? "copy" : "move");
      },
    };
  }

  return (
    <div className="flex w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r border-borderMuted bg-panelAlt p-3">
      <div>
        <p className="mb-1.5 px-1 text-[10px] uppercase tracking-widest text-text-dim">Favoritos</p>
        <div className="space-y-0.5">
          {(favorites ?? []).length === 0 && <p className="px-1 text-[11px] text-text-dim">Ninguno todavia.</p>}
          {(favorites ?? []).map((fav) => (
            <div
              key={fav.id}
              className={cn(
                "group flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] cursor-pointer",
                fav.path === currentPath ? "bg-overlay/[0.06] text-text" : "text-text-muted hover:bg-overlay/[0.03]",
                dragOverPath === fav.path && "bg-accent/25 text-text outline outline-1 outline-accent-bright"
              )}
              onClick={() => onNavigate(fav.path)}
              {...dropHandlers(fav.path)}
            >
              <Star size={11} className="shrink-0 text-accent-bright" />
              <span className="flex-1 truncate">{fav.label}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeFavorite.mutate(fav.id);
                }}
                className="shrink-0 text-text-dim opacity-0 hover:text-accent-bright group-hover:opacity-100"
                aria-label={`Quitar ${fav.label} de favoritos`}
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1.5 px-1 text-[10px] uppercase tracking-widest text-text-dim">Unidades</p>
        <div className="space-y-1.5">
          {(drives ?? []).map((drive) => {
            const used = drive.total_bytes > 0 ? 1 - drive.available_bytes / drive.total_bytes : 0;
            return (
              <button
                key={drive.path}
                onClick={() => onNavigate(drive.path)}
                {...dropHandlers(drive.path)}
                className={cn(
                  "w-full rounded-md px-2 py-1.5 text-left text-[11px]",
                  drive.path === currentPath ? "bg-overlay/[0.06] text-text" : "text-text-muted hover:bg-overlay/[0.03]",
                  dragOverPath === drive.path && "bg-accent/25 text-text outline outline-1 outline-accent-bright"
                )}
              >
                <div className="flex items-center gap-2">
                  <HardDrive size={11} className="shrink-0 text-text-dim" />
                  <span className="flex-1 truncate">{drive.label}</span>
                </div>
                {drive.total_bytes > 0 && (
                  <>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-overlay/5">
                      <div className="h-full bg-accent" style={{ width: `${Math.min(100, used * 100)}%` }} />
                    </div>
                    <p className="mt-0.5 text-[9px] text-text-dim">
                      {formatBytes(drive.available_bytes)} libres de {formatBytes(drive.total_bytes)}
                    </p>
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
