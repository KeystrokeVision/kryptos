import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Folder, File as FileIcon, ArrowUp, RefreshCw, Upload, Download, Trash2, FolderPlus, AlertTriangle } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { NamePromptModal } from "@/components/explorer/NamePromptModal";
import { api } from "@/lib/tauri";
import { formatBytes } from "@/lib/format";
import type { SshConnectParams, SftpEntry } from "@/types/ssh";

interface SftpBrowserProps {
  connectParams: SshConnectParams;
}

export function SftpBrowser({ connectParams }: SftpBrowserProps) {
  const queryClient = useQueryClient();
  const [path, setPath] = useState("/");
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SftpEntry | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [transferring, setTransferring] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ["sftp", "list", connectParams.host, connectParams.port, path],
    queryFn: () => api.sftpListDirectory(connectParams, path),
  });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["sftp", "list"] });
  }

  function navigate(entry: SftpEntry) {
    if (!entry.is_dir) return;
    setPath((p) => (p.endsWith("/") ? `${p}${entry.name}` : `${p}/${entry.name}`));
  }

  function goUp() {
    if (path === "/") return;
    const parts = path.split("/").filter(Boolean);
    parts.pop();
    setPath(parts.length === 0 ? "/" : `/${parts.join("/")}`);
  }

  const createFolderMutation = useMutation({
    mutationFn: (name: string) => api.sftpCreateDirectory(connectParams, `${path.endsWith("/") ? path : path + "/"}${name}`),
    onSuccess: () => {
      refresh();
      setNewFolderOpen(false);
    },
    onError: (e: Error) => setError(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (entry: SftpEntry) => api.sftpDeleteFile(connectParams, `${path.endsWith("/") ? path : path + "/"}${entry.name}`),
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  });

  async function uploadFile() {
    const selected = await open({ multiple: false });
    if (typeof selected !== "string") return;
    const name = selected.split(/[\\/]/).pop()!;
    const remotePath = `${path.endsWith("/") ? path : path + "/"}${name}`;
    setTransferring(`Subiendo ${name}...`);
    try {
      await api.sftpUploadFile(connectParams, selected, remotePath);
      refresh();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setTransferring(null);
    }
  }

  async function downloadFile(entry: SftpEntry) {
    const destination = await save({ defaultPath: entry.name });
    if (!destination) return;
    const remotePath = `${path.endsWith("/") ? path : path + "/"}${entry.name}`;
    setTransferring(`Descargando ${entry.name}...`);
    try {
      await api.sftpDownloadFile(connectParams, remotePath, destination);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setTransferring(null);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-borderMuted bg-panelAlt px-2">
        <button onClick={goUp} disabled={path === "/"} className="flex h-7 w-7 items-center justify-center rounded-md text-text-dim hover:bg-white/[0.06] hover:text-text disabled:opacity-30" aria-label="Subir">
          <ArrowUp size={13} />
        </button>
        <span className="flex-1 truncate rounded-md bg-base px-2 py-1 font-mono text-[11px] text-text-muted">{path}</span>
        <button onClick={uploadFile} className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-text-dim hover:bg-white/[0.06] hover:text-text">
          <Upload size={12} /> Subir
        </button>
        <button onClick={() => setNewFolderOpen(true)} className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-text-dim hover:bg-white/[0.06] hover:text-text">
          <FolderPlus size={12} /> Carpeta
        </button>
        <button onClick={refresh} className="flex h-7 w-7 items-center justify-center rounded-md text-text-dim hover:bg-white/[0.06] hover:text-text" aria-label="Actualizar">
          <RefreshCw size={13} className={listQuery.isFetching ? "animate-spin" : ""} />
        </button>
      </div>

      {(error || listQuery.isError) && (
        <div className="flex items-start gap-2 border-b border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent-bright">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          {error ?? String((listQuery.error as Error)?.message)}
        </div>
      )}
      {transferring && <div className="border-b border-borderMuted bg-panelAlt px-3 py-1.5 text-[11px] text-text-dim">{transferring}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full text-left text-[11px]">
          <thead className="sticky top-0 bg-panel text-[10px] uppercase tracking-widest text-text-dim">
            <tr>
              <th className="px-3 py-2 font-medium">Nombre</th>
              <th className="px-3 py-2 font-medium">Tamano</th>
              <th className="w-20 px-3 py-2 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {(listQuery.data ?? []).map((entry) => (
              <tr key={entry.name} onDoubleClick={() => navigate(entry)} className="group border-t border-borderMuted hover:bg-white/[0.03]">
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-2">
                    {entry.is_dir ? <Folder size={13} className="shrink-0 text-accent-bright" /> : <FileIcon size={13} className="shrink-0 text-text-dim" />}
                    <span className="truncate text-text">{entry.name}</span>
                  </div>
                </td>
                <td className="px-3 py-1.5 text-text-dim">{entry.is_dir ? "—" : formatBytes(entry.size_bytes)}</td>
                <td className="px-3 py-1.5">
                  <div className="flex gap-1.5 opacity-0 group-hover:opacity-100">
                    {!entry.is_dir && (
                      <button onClick={() => downloadFile(entry)} className="text-text-dim hover:text-text" aria-label={`Descargar ${entry.name}`}>
                        <Download size={12} />
                      </button>
                    )}
                    <button onClick={() => setPendingDelete(entry)} className="text-text-dim hover:text-accent-bright" aria-label={`Eliminar ${entry.name}`}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {(listQuery.data ?? []).length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-text-dim">
                  Carpeta vacia.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {newFolderOpen && (
        <NamePromptModal
          title="Nueva carpeta"
          confirmLabel="Crear"
          placeholder="Nombre de la carpeta"
          submitting={createFolderMutation.isPending}
          errorMessage={createFolderMutation.isError ? String((createFolderMutation.error as Error)?.message) : undefined}
          onCancel={() => setNewFolderOpen(false)}
          onSubmit={(name) => createFolderMutation.mutate(name)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Eliminar"
          message={`¿Eliminar "${pendingDelete.name}" del servidor remoto? Esta accion no se puede deshacer.`}
          confirmLabel="Eliminar"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            deleteMutation.mutate(pendingDelete);
            setPendingDelete(null);
          }}
        />
      )}
    </div>
  );
}
