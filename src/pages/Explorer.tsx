import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  FolderPlus,
  FilePlus,
  RefreshCw,
  Search,
  Star,
  ClipboardPaste,
  X,
  AlertTriangle,
  FolderTree,
  Trash2,
  Copy,
  Scissors,
  HardDrive,
} from "lucide-react";
import { ExplorerSidebar } from "@/components/explorer/ExplorerSidebar";
import { FileList } from "@/components/explorer/FileList";
import { NamePromptModal } from "@/components/explorer/NamePromptModal";
import { DiskUsagePanel } from "@/components/explorer/DiskUsagePanel";
import { DuplicateFinderModal } from "@/components/explorer/DuplicateFinderModal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { api } from "@/lib/tauri";
import { buildBreadcrumbs, parentPath, isPathInside, samePath } from "@/lib/pathUtils";
import { cn } from "@/lib/utils";
import type { DirEntryInfo } from "@/types/explorer";

type ModalState = { mode: "newFolder" | "newFile" } | { mode: "rename"; entry: DirEntryInfo } | null;
type Clipboard = { paths: string[]; mode: "copy" | "cut" } | null;

export default function Explorer() {
  const queryClient = useQueryClient();
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [pendingDelete, setPendingDelete] = useState<DirEntryInfo[] | null>(null);
  const [clipboard, setClipboard] = useState<Clipboard>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<DirEntryInfo[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null);
  const [crumbDragOver, setCrumbDragOver] = useState<string | null>(null);
  const [showDiskUsage, setShowDiskUsage] = useState(false);
  const [showDuplicateFinder, setShowDuplicateFinder] = useState(false);

  // Los mismos manejadores sirven para el boton "subir un nivel" y cada
  // miga de pan — ambos son, en el fondo, "soltar esto en esta carpeta".
  function crumbDropHandlers(destPath: string) {
    return {
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = e.ctrlKey ? "copy" : "move";
        setCrumbDragOver(destPath);
      },
      onDragLeave: () => setCrumbDragOver((p) => (p === destPath ? null : p)),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        setCrumbDragOver(null);
        const paths = e.dataTransfer.getData("text/plain").split("\n").filter(Boolean);
        if (paths.length > 0) handleDropInto(destPath, paths, e.ctrlKey ? "copy" : "move");
      },
    };
  }

  useEffect(() => {
    api.getHomeDirectory().then(setCurrentPath);
  }, []);

  const listQuery = useQuery({
    queryKey: ["explorer", "list", currentPath],
    queryFn: () => api.listDirectory(currentPath as string),
    enabled: !!currentPath,
  });

  function refreshListing() {
    queryClient.invalidateQueries({ queryKey: ["explorer", "list", currentPath] });
  }

  function navigate(path: string) {
    setSearchResults(null);
    setSearchOpen(false);
    setSelected(new Set());
    setAnchorIndex(null);
    setCurrentPath(path);
  }

  function openEntry(entry: DirEntryInfo) {
    if (entry.is_dir) navigate(entry.path);
  }

  const showingEntries = searchResults ?? listQuery.data ?? [];

  function handleSelect(entry: DirEntryInfo, index: number, event: React.MouseEvent) {
    if (event.shiftKey && anchorIndex !== null) {
      const [start, end] = [Math.min(anchorIndex, index), Math.max(anchorIndex, index)];
      setSelected(new Set(showingEntries.slice(start, end + 1).map((e) => e.path)));
    } else if (event.ctrlKey || event.metaKey) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(entry.path)) next.delete(entry.path);
        else next.add(entry.path);
        return next;
      });
      setAnchorIndex(index);
    } else {
      setSelected(new Set([entry.path]));
      setAnchorIndex(index);
    }
  }

  const createDirMutation = useMutation({
    mutationFn: (name: string) => api.createDirectory(currentPath as string, name),
    onSuccess: () => {
      refreshListing();
      setModal(null);
    },
  });

  const createFileMutation = useMutation({
    mutationFn: (name: string) => api.createEmptyFile(currentPath as string, name),
    onSuccess: () => {
      refreshListing();
      setModal(null);
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ path, newName }: { path: string; newName: string }) => api.renamePath(path, newName),
    onSuccess: () => {
      refreshListing();
      setModal(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (paths: string[]) => {
      for (const p of paths) {
        await api.deletePath(p);
      }
    },
    onSuccess: () => {
      refreshListing();
      setSelected(new Set());
    },
    onError: (e: Error) => setActionError(e.message),
  });

  const pasteMutation = useMutation({
    mutationFn: async () => {
      if (!clipboard || !currentPath) throw new Error("Nada para pegar.");
      for (const src of clipboard.paths) {
        if (clipboard.mode === "copy") {
          await api.copyPath(src, currentPath);
        } else {
          await api.movePath(src, currentPath);
        }
      }
    },
    onSuccess: () => {
      refreshListing();
      setClipboard(null);
    },
    onError: (e: Error) => setActionError(e.message),
  });

  const dropMutation = useMutation({
    mutationFn: async ({ destPath, sourcePaths, mode }: { destPath: string; sourcePaths: string[]; mode: "move" | "copy" }) => {
      for (const src of sourcePaths) {
        if (mode === "copy") await api.copyPath(src, destPath);
        else await api.movePath(src, destPath);
      }
    },
    onSuccess: () => {
      refreshListing();
      setSelected(new Set());
    },
    onError: (e: Error) => setActionError(e.message),
  });

  // Compartido por el drop sobre una fila de carpeta, sobre una miga de pan,
  // y sobre el boton "subir un nivel" — todos terminan en el mismo lugar:
  // mover o copiar (Ctrl) el origen hacia destPath.
  function handleDropInto(destPath: string, sourcePaths: string[], mode: "move" | "copy") {
    const filtered = sourcePaths.filter(
      (src) => !samePath(src, destPath) && !isPathInside(destPath, src) && !samePath(parentPath(src) ?? "", destPath)
    );
    if (filtered.length === 0) return;
    dropMutation.mutate({ destPath, sourcePaths: filtered, mode });
  }

  const addFavoriteMutation = useMutation({
    mutationFn: () => api.addFavorite(currentPath as string, (buildBreadcrumbs(currentPath as string).pop()?.label as string) ?? currentPath!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["explorer", "favorites"] }),
  });

  async function runSearch() {
    if (!currentPath || !searchTerm.trim()) return;
    setSearching(true);
    setActionError(null);
    try {
      const results = await api.searchDirectory(currentPath, searchTerm.trim());
      setSearchResults(results);
    } catch (e) {
      setActionError(String((e as Error)?.message ?? e));
    } finally {
      setSearching(false);
    }
  }

  const breadcrumbs = currentPath ? buildBreadcrumbs(currentPath) : [];
  const up = currentPath ? parentPath(currentPath) : null;
  const selectedEntries = showingEntries.filter((e) => selected.has(e.path));

  return (
    <div className="flex h-full">
      <ExplorerSidebar currentPath={currentPath ?? ""} onNavigate={navigate} onDropInto={handleDropInto} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Toolbar */}
        <div className="flex h-10 shrink-0 items-center gap-1 border-b border-borderMuted bg-panelAlt px-2">
          <button
            onClick={() => up && navigate(up)}
            disabled={!up}
            {...(up ? crumbDropHandlers(up) : {})}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md text-text-dim hover:bg-white/[0.06] hover:text-text disabled:opacity-30",
              crumbDragOver === up && "bg-accent/25 text-text outline outline-1 outline-accent-bright"
            )}
            aria-label="Subir un nivel"
          >
            <ArrowUp size={13} />
          </button>
          <button
            onClick={refreshListing}
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-dim hover:bg-white/[0.06] hover:text-text"
            aria-label="Actualizar"
          >
            <RefreshCw size={13} className={listQuery.isFetching ? "animate-spin" : ""} />
          </button>

          <div className="mx-1 h-4 w-px bg-border" />

          {selected.size > 0 ? (
            <div className="flex flex-1 items-center gap-2 text-[11px]">
              <span className="text-text">{selected.size} seleccionado(s)</span>
              <button
                onClick={() => setClipboard({ paths: [...selected], mode: "copy" })}
                className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-text-muted hover:bg-white/[0.04]"
              >
                <Copy size={11} /> Copiar
              </button>
              <button
                onClick={() => setClipboard({ paths: [...selected], mode: "cut" })}
                className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-text-muted hover:bg-white/[0.04]"
              >
                <Scissors size={11} /> Cortar
              </button>
              <button
                onClick={() => setPendingDelete(selectedEntries)}
                className="flex h-7 items-center gap-1 rounded-md border border-accent/50 px-2 text-accent-bright hover:bg-accent/10"
              >
                <Trash2 size={11} /> Eliminar
              </button>
              <button onClick={() => setSelected(new Set())} className="text-text-dim hover:text-text">
                <X size={12} />
              </button>
            </div>
          ) : (
            <div className="flex flex-1 items-center gap-1 overflow-x-auto text-[11px]">
              {breadcrumbs.map((crumb, i) => (
                <div key={crumb.path} className="flex items-center gap-1">
                  {i > 0 && <span className="text-text-dim">/</span>}
                  <button
                    onClick={() => navigate(crumb.path)}
                    {...crumbDropHandlers(crumb.path)}
                    className={cn(
                      "rounded px-1.5 py-0.5 hover:bg-white/[0.06]",
                      i === breadcrumbs.length - 1 ? "text-text" : "text-text-muted",
                      crumbDragOver === crumb.path && "bg-accent/25 text-text outline outline-1 outline-accent-bright"
                    )}
                  >
                    {crumb.label}
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => setModal({ mode: "newFolder" })}
            className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-text-dim hover:bg-white/[0.06] hover:text-text"
          >
            <FolderPlus size={13} /> Carpeta
          </button>
          <button
            onClick={() => setModal({ mode: "newFile" })}
            className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-text-dim hover:bg-white/[0.06] hover:text-text"
          >
            <FilePlus size={13} /> Archivo
          </button>
          {clipboard && (
            <button
              onClick={() => pasteMutation.mutate()}
              disabled={pasteMutation.isPending}
              className="flex h-7 items-center gap-1 rounded-md bg-accent px-2 text-[11px] font-medium text-white hover:bg-accent-bright disabled:opacity-40"
            >
              <ClipboardPaste size={13} />
              {pasteMutation.isPending ? "Pegando..." : `Pegar ${clipboard.paths.length} (${clipboard.mode === "cut" ? "mover" : "copiar"})`}
            </button>
          )}
          <button
            onClick={() => addFavoriteMutation.mutate()}
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-dim hover:bg-white/[0.06] hover:text-accent-bright"
            aria-label="Agregar a favoritos"
          >
            <Star size={13} />
          </button>
          <button
            onClick={() => setSearchOpen((v) => !v)}
            className={cn("flex h-7 w-7 items-center justify-center rounded-md hover:bg-white/[0.06]", searchOpen ? "text-accent-bright" : "text-text-dim hover:text-text")}
            aria-label="Buscar"
          >
            <Search size={13} />
          </button>
          <div className="mx-1 h-4 w-px bg-border" />
          <button
            onClick={() => setShowDiskUsage((v) => !v)}
            className={cn("flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] hover:bg-white/[0.06]", showDiskUsage ? "text-accent-bright" : "text-text-dim hover:text-text")}
            aria-label="Ver uso de disco"
          >
            <HardDrive size={13} /> Tamaños
          </button>
          <button
            onClick={() => setShowDuplicateFinder(true)}
            disabled={!currentPath}
            className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] text-text-dim hover:bg-white/[0.06] hover:text-text disabled:opacity-40"
            aria-label="Buscar duplicados"
          >
            <Copy size={13} /> Duplicados
          </button>
        </div>

        {searchOpen && (
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-borderMuted bg-panelAlt px-2">
            <Search size={12} className="text-text-dim" />
            <input
              autoFocus
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
              placeholder="Buscar en esta carpeta y subcarpetas..."
              className="h-6 flex-1 bg-transparent text-[11px] text-text outline-none placeholder:text-text-dim"
            />
            {searching && <RefreshCw size={11} className="animate-spin text-text-dim" />}
            <button
              onClick={() => {
                setSearchOpen(false);
                setSearchResults(null);
                setSearchTerm("");
              }}
              className="text-text-dim hover:text-text"
            >
              <X size={12} />
            </button>
          </div>
        )}

        {actionError && (
          <div className="flex items-start gap-2 border-b border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent-bright">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            {actionError}
            <button onClick={() => setActionError(null)} className="ml-auto text-accent-bright/70 hover:text-accent-bright">
              <X size={12} />
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {showDiskUsage && currentPath ? (
            <DiskUsagePanel initialPath={currentPath} />
          ) : !currentPath || listQuery.isLoading ? (
            <div className="flex h-full items-center justify-center text-xs text-text-dim">
              <FolderTree size={16} className="mr-2 animate-pulse" /> Cargando...
            </div>
          ) : listQuery.isError ? (
            <p className="p-4 text-xs text-accent-bright">{String((listQuery.error as Error)?.message)}</p>
          ) : (
            <FileList
              entries={showingEntries}
              selected={selected}
              onSelect={handleSelect}
              clipboardPaths={clipboard ? new Set(clipboard.paths) : undefined}
              onOpen={openEntry}
              onRename={(entry) => setModal({ mode: "rename", entry })}
              onDelete={(entry) => setPendingDelete([entry])}
              onCopy={(entry) => setClipboard({ paths: [entry.path], mode: "copy" })}
              onCut={(entry) => setClipboard({ paths: [entry.path], mode: "cut" })}
              onDropInto={handleDropInto}
            />
          )}
        </div>
      </div>

      {modal?.mode === "newFolder" && (
        <NamePromptModal
          title="Nueva carpeta"
          confirmLabel="Crear"
          placeholder="Nombre de la carpeta"
          submitting={createDirMutation.isPending}
          errorMessage={createDirMutation.isError ? String((createDirMutation.error as Error)?.message) : undefined}
          onCancel={() => setModal(null)}
          onSubmit={(name) => createDirMutation.mutate(name)}
        />
      )}

      {modal?.mode === "newFile" && (
        <NamePromptModal
          title="Nuevo archivo"
          confirmLabel="Crear"
          placeholder="Nombre del archivo"
          submitting={createFileMutation.isPending}
          errorMessage={createFileMutation.isError ? String((createFileMutation.error as Error)?.message) : undefined}
          onCancel={() => setModal(null)}
          onSubmit={(name) => createFileMutation.mutate(name)}
        />
      )}

      {modal?.mode === "rename" && (
        <NamePromptModal
          title="Renombrar"
          confirmLabel="Renombrar"
          initialValue={modal.entry.name}
          submitting={renameMutation.isPending}
          errorMessage={renameMutation.isError ? String((renameMutation.error as Error)?.message) : undefined}
          onCancel={() => setModal(null)}
          onSubmit={(newName) => renameMutation.mutate({ path: modal.entry.path, newName })}
        />
      )}

      {pendingDelete && pendingDelete.length > 0 && (
        <ConfirmDialog
          title={pendingDelete.length > 1 ? `Eliminar ${pendingDelete.length} elementos` : pendingDelete[0].is_dir ? "Eliminar carpeta" : "Eliminar archivo"}
          message={
            pendingDelete.length > 1
              ? `¿Eliminar los ${pendingDelete.length} elementos seleccionados permanentemente? Esta accion no se puede deshacer.`
              : `¿Eliminar "${pendingDelete[0].name}" permanentemente? Esta accion no se puede deshacer${pendingDelete[0].is_dir ? " y borrara todo su contenido" : ""}.`
          }
          confirmLabel="Eliminar"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            deleteMutation.mutate(pendingDelete.map((e) => e.path));
            setPendingDelete(null);
          }}
        />
      )}

      {showDuplicateFinder && currentPath && (
        <DuplicateFinderModal
          path={currentPath}
          onClose={() => setShowDuplicateFinder(false)}
          onDeleted={refreshListing}
        />
      )}
    </div>
  );
}
