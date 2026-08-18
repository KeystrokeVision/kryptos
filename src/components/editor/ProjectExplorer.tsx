import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ChevronDown, Folder, FolderOpen, File as FileIcon, Loader2 } from "lucide-react";
import { api } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { DirEntryInfo } from "@/types/explorer";

interface TreeNodeProps {
  entry: DirEntryInfo;
  depth: number;
  onOpenFile: (path: string, name: string) => void;
  activePath?: string;
}

function TreeNode({ entry, depth, onOpenFile, activePath }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false);

  const childrenQuery = useQuery({
    queryKey: ["editor", "tree", entry.path],
    queryFn: () => api.listDirectory(entry.path),
    enabled: entry.is_dir && expanded,
  });

  if (!entry.is_dir) {
    const isActive = activePath === entry.path;
    return (
      <button
        onClick={() => onOpenFile(entry.path, entry.name)}
        style={{ paddingLeft: `${depth * 14 + 26}px` }}
        className={cn(
          "flex w-full items-center gap-1.5 py-1 pr-2 text-left text-[11px] hover:bg-overlay/[0.05]",
          isActive ? "bg-accent/10 text-text" : "text-text-muted"
        )}
      >
        <FileIcon size={11} className="shrink-0 text-text-dim" />
        <span className="truncate">{entry.name}</span>
      </button>
    );
  }

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        className="flex w-full items-center gap-1 py-1 pr-2 text-left text-[11px] text-text-muted hover:bg-overlay/[0.05]"
      >
        {expanded ? <ChevronDown size={11} className="shrink-0" /> : <ChevronRight size={11} className="shrink-0" />}
        {expanded ? <FolderOpen size={12} className="shrink-0 text-accent-bright" /> : <Folder size={12} className="shrink-0 text-accent-bright" />}
        <span className="truncate">{entry.name}</span>
        {childrenQuery.isFetching && <Loader2 size={10} className="ml-auto shrink-0 animate-spin text-text-dim" />}
      </button>
      {expanded && (
        <div>
          {(childrenQuery.data ?? [])
            .filter((e) => !e.is_hidden)
            .sort((a, b) => (a.is_dir === b.is_dir ? a.name.localeCompare(b.name) : a.is_dir ? -1 : 1))
            .map((child) => (
              <TreeNode key={child.path} entry={child} depth={depth + 1} onOpenFile={onOpenFile} activePath={activePath} />
            ))}
        </div>
      )}
    </div>
  );
}

interface ProjectExplorerProps {
  rootPath: string;
  onOpenFile: (path: string, name: string) => void;
  activePath?: string;
}

export function ProjectExplorer({ rootPath, onOpenFile, activePath }: ProjectExplorerProps) {
  const rootQuery = useQuery({
    queryKey: ["editor", "tree", rootPath],
    queryFn: () => api.listDirectory(rootPath),
  });

  const rootName = rootPath.split(/[\\/]/).filter(Boolean).pop() ?? rootPath;

  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-r border-borderMuted bg-panelAlt">
      <div className="border-b border-borderMuted px-3 py-2">
        <p className="truncate text-[10px] uppercase tracking-widest text-text-dim" title={rootPath}>
          {rootName}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {rootQuery.isLoading && <p className="px-3 py-2 text-[11px] text-text-dim">Cargando...</p>}
        {rootQuery.isError && <p className="px-3 py-2 text-[11px] text-accent-bright">No se pudo abrir la carpeta.</p>}
        {(rootQuery.data ?? [])
          .filter((e) => !e.is_hidden)
          .sort((a, b) => (a.is_dir === b.is_dir ? a.name.localeCompare(b.name) : a.is_dir ? -1 : 1))
          .map((entry) => (
            <TreeNode key={entry.path} entry={entry} depth={0} onOpenFile={onOpenFile} activePath={activePath} />
          ))}
      </div>
    </div>
  );
}
