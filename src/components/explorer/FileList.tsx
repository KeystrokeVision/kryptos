import { useState } from "react";
import { Folder, File as FileIcon, Pencil, Trash2, Copy, Scissors } from "lucide-react";
import { formatBytes } from "@/lib/format";
import { isPathInside } from "@/lib/pathUtils";
import { cn } from "@/lib/utils";
import type { DirEntryInfo } from "@/types/explorer";

interface FileListProps {
  entries: DirEntryInfo[];
  onOpen: (entry: DirEntryInfo) => void;
  onRename: (entry: DirEntryInfo) => void;
  onDelete: (entry: DirEntryInfo) => void;
  onCopy: (entry: DirEntryInfo) => void;
  onCut: (entry: DirEntryInfo) => void;
  onDropInto: (destPath: string, sourcePaths: string[], mode: "move" | "copy") => void;
  clipboardPaths?: Set<string>;
  selected: Set<string>;
  onSelect: (entry: DirEntryInfo, index: number, event: React.MouseEvent) => void;
}

function formatDate(unixSecs: number) {
  if (!unixSecs) return "—";
  return new Date(unixSecs * 1000).toLocaleString();
}

export function FileList({ entries, onOpen, onRename, onDelete, onCopy, onCut, onDropInto, clipboardPaths, selected, onSelect }: FileListProps) {
  // Estado del arrastre vive aca, no en Explorer: es puramente visual/de
  // interaccion de esta lista, y asi Explorer solo se entera cuando algo
  // realmente se solto sobre una carpeta.
  const [draggedPaths, setDraggedPaths] = useState<string[] | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);

  if (entries.length === 0) {
    return <p className="p-6 text-center text-xs text-text-dim">Esta carpeta esta vacia.</p>;
  }

  function handleDragStart(entry: DirEntryInfo, e: React.DragEvent) {
    // Si la fila arrastrada forma parte de una seleccion multiple, se
    // arrastran todas juntas — el mismo comportamiento que cualquier
    // administrador de archivos real.
    const paths = selected.has(entry.path) && selected.size > 1 ? [...selected] : [entry.path];
    setDraggedPaths(paths);
    e.dataTransfer.effectAllowed = "copyMove";
    e.dataTransfer.setData("text/plain", paths.join("\n"));
  }

  function canDropOn(entry: DirEntryInfo): boolean {
    if (!entry.is_dir || !draggedPaths) return false;
    return !draggedPaths.some((p) => isPathInside(entry.path, p));
  }

  function handleDragOver(entry: DirEntryInfo, e: React.DragEvent) {
    if (!canDropOn(entry)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = e.ctrlKey ? "copy" : "move";
    setDragOverPath(entry.path);
  }

  function handleDrop(entry: DirEntryInfo, e: React.DragEvent) {
    e.preventDefault();
    setDragOverPath(null);
    if (draggedPaths && canDropOn(entry)) {
      onDropInto(entry.path, draggedPaths, e.ctrlKey ? "copy" : "move");
    }
    setDraggedPaths(null);
  }

  return (
    <table className="w-full select-none text-left text-[11px]">
      <thead className="sticky top-0 bg-panel text-[10px] uppercase tracking-widest text-text-dim">
        <tr>
          <th className="px-3 py-2 font-medium">Nombre</th>
          <th className="px-3 py-2 font-medium">Tamano</th>
          <th className="px-3 py-2 font-medium">Modificado</th>
          <th className="w-28 px-3 py-2 font-medium">Acciones</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry, i) => {
          const isSelected = selected.has(entry.path);
          const isCut = clipboardPaths?.has(entry.path);
          const isDragging = draggedPaths?.includes(entry.path) ?? false;
          const isDropTarget = dragOverPath === entry.path;
          return (
            <tr
              key={entry.path}
              draggable
              onClick={(e) => onSelect(entry, i, e)}
              onDoubleClick={() => onOpen(entry)}
              onDragStart={(e) => handleDragStart(entry, e)}
              onDragOver={(e) => handleDragOver(entry, e)}
              onDragLeave={() => setDragOverPath((p) => (p === entry.path ? null : p))}
              onDrop={(e) => handleDrop(entry, e)}
              onDragEnd={() => {
                setDraggedPaths(null);
                setDragOverPath(null);
              }}
              className={cn(
                "group cursor-default border-t border-borderMuted",
                isSelected ? "bg-accent/15 hover:bg-accent/20" : "hover:bg-white/[0.03]",
                isCut && !isSelected && "bg-accent/5",
                isDragging && "opacity-40",
                isDropTarget && "bg-accent/25 outline outline-1 outline-accent-bright -outline-offset-1"
              )}
            >
              <td className="max-w-0 px-3 py-1.5">
                <div className="flex items-center gap-2">
                  {entry.is_dir ? (
                    <Folder size={13} className="shrink-0 text-accent-bright" />
                  ) : (
                    <FileIcon size={13} className="shrink-0 text-text-dim" />
                  )}
                  <span className={cn("truncate", entry.is_hidden && "text-text-dim italic")} title={entry.name}>
                    {entry.name}
                  </span>
                </div>
              </td>
              <td className="px-3 py-1.5 text-text-dim">{entry.is_dir ? "—" : formatBytes(entry.size_bytes)}</td>
              <td className="px-3 py-1.5 text-text-dim">{formatDate(entry.modified_unix)}</td>
              <td className="px-3 py-1.5">
                <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                  <button onClick={(e) => { e.stopPropagation(); onCopy(entry); }} aria-label={`Copiar ${entry.name}`} className="text-text-dim hover:text-text">
                    <Copy size={12} />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); onCut(entry); }} aria-label={`Cortar ${entry.name}`} className="text-text-dim hover:text-text">
                    <Scissors size={12} />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); onRename(entry); }} aria-label={`Renombrar ${entry.name}`} className="text-text-dim hover:text-text">
                    <Pencil size={12} />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); onDelete(entry); }} aria-label={`Eliminar ${entry.name}`} className="text-text-dim hover:text-accent-bright">
                    <Trash2 size={12} />
                  </button>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
