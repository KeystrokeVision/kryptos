import { useQuery } from "@tanstack/react-query";
import { Package, Play, Pencil, Trash2 } from "lucide-react";
import { api } from "@/lib/tauri";
import type { AppEntry } from "@/types/apps";

interface AppTileProps {
  app: AppEntry;
  onLaunch: () => void;
  onEdit: () => void;
  onDelete: () => void;
  launching: boolean;
}

export function AppTile({ app, onLaunch, onEdit, onDelete, launching }: AppTileProps) {
  const { data: iconDataUrl } = useQuery({
    queryKey: ["apps", "icon", app.icon_file],
    queryFn: () => api.getAppIconDataUrl(app.icon_file as string),
    enabled: !!app.icon_file,
    staleTime: Infinity,
  });

  return (
    <div className="group relative flex flex-col items-center rounded-lg border border-border bg-panel p-4 transition-colors hover:border-accent/40">
      <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={onEdit}
          aria-label={`Editar ${app.name}`}
          className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-base text-text-dim hover:text-text"
        >
          <Pencil size={11} />
        </button>
        <button
          onClick={onDelete}
          aria-label={`Eliminar ${app.name}`}
          className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-base text-text-dim hover:border-accent/50 hover:text-accent-bright"
        >
          <Trash2 size={11} />
        </button>
      </div>

      <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl border border-borderMuted bg-base">
        {iconDataUrl ? (
          <img src={iconDataUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <Package size={26} className="text-text-dim" />
        )}
      </div>

      <p className="mt-2.5 line-clamp-2 max-w-full break-words text-center text-xs text-text">{app.name}</p>

      <button
        onClick={onLaunch}
        disabled={launching}
        className="mt-3 flex h-7 w-full items-center justify-center gap-1.5 rounded-md bg-accent text-[11px] font-medium text-white hover:bg-accent-bright disabled:opacity-40"
      >
        <Play size={11} />
        {launching ? "Abriendo..." : "Abrir"}
      </button>
    </div>
  );
}
