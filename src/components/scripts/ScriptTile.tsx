import { useQuery } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-shell";
import { FileCode, FolderOpen, ExternalLink, Pencil, Trash2 } from "lucide-react";
import { api } from "@/lib/tauri";
import type { ScriptEntry } from "@/types/scripts";

interface ScriptTileProps {
  script: ScriptEntry;
  onEdit: () => void;
  onDelete: () => void;
}

export function ScriptTile({ script, onEdit, onDelete }: ScriptTileProps) {
  const { data: iconDataUrl } = useQuery({
    queryKey: ["scripts", "icon", script.icon_file],
    queryFn: () => api.getScriptIconDataUrl(script.icon_file as string),
    enabled: !!script.icon_file,
    staleTime: Infinity,
  });

  const ext = script.script_path.split(".").pop()?.toLowerCase() ?? "";

  return (
    <div className="group relative flex flex-col items-center rounded-lg border border-border bg-panel p-4 transition-colors hover:border-accent/40">
      <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={onEdit}
          aria-label={`Editar ${script.name}`}
          className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-base text-text-dim hover:text-text"
        >
          <Pencil size={11} />
        </button>
        <button
          onClick={onDelete}
          aria-label={`Eliminar ${script.name}`}
          className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-base text-text-dim hover:border-accent/50 hover:text-accent-bright"
        >
          <Trash2 size={11} />
        </button>
      </div>

      <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl border border-borderMuted bg-base">
        {iconDataUrl ? (
          <img src={iconDataUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <FileCode size={26} className="text-text-dim" />
        )}
      </div>

      <p className="mt-2.5 line-clamp-2 max-w-full break-words text-center text-xs text-text">{script.name}</p>
      {ext && <p className="font-mono text-[10px] text-text-dim">.{ext}</p>}

      <div className="mt-3 flex w-full gap-1.5">
        <button
          onClick={() => api.openScriptFolder(script.id)}
          className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md border border-border text-[11px] text-text-muted hover:bg-overlay/[0.04]"
        >
          <FolderOpen size={11} />
          Ver
        </button>
        {script.repo_url && (
          <button
            onClick={() => open(script.repo_url as string)}
            aria-label={`Abrir repositorio de ${script.name}`}
            title={script.repo_url}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-text-muted hover:bg-overlay/[0.04] hover:text-accent-bright"
          >
            <ExternalLink size={11} />
          </button>
        )}
      </div>
    </div>
  );
}
