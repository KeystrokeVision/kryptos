import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import {
  GitBranch,
  FolderOpen,
  RefreshCw,
  Plus,
  Minus,
  FilePlus,
  FileEdit,
  FileMinus,
  History,
  ListChecks,
  AlertTriangle,
  Check,
  DownloadCloud,
  UploadCloud,
  ArrowDownToLine,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { DiffView } from "@/components/git/DiffView";
import { api } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { FileStatus } from "@/types/git";

const KIND_ICON: Record<string, typeof FilePlus> = {
  new: FilePlus,
  modified: FileEdit,
  deleted: FileMinus,
  renamed: FileEdit,
  typechange: FileEdit,
  conflicted: AlertTriangle,
};

function FileRow({ file, onToggle, onSelect, selected }: { file: FileStatus; onToggle: () => void; onSelect: () => void; selected: boolean }) {
  const Icon = KIND_ICON[file.kind] ?? FileEdit;
  return (
    <div
      onClick={onSelect}
      className={cn(
        "group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[11px]",
        selected ? "bg-overlay/[0.06] text-text" : "text-text-muted hover:bg-overlay/[0.03]"
      )}
    >
      <Icon size={11} className={cn(file.kind === "deleted" ? "text-accent-bright" : file.kind === "new" ? "text-ok" : "text-text-dim")} />
      <span className="flex-1 truncate font-mono">{file.path}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className="rounded p-1 text-text-dim opacity-0 hover:bg-overlay/10 hover:text-text group-hover:opacity-100"
        aria-label={file.staged ? "Quitar del stage" : "Agregar al stage"}
      >
        {file.staged ? <Minus size={11} /> : <Plus size={11} />}
      </button>
    </div>
  );
}

export default function Git() {
  const queryClient = useQueryClient();
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [view, setView] = useState<"changes" | "history">("changes");
  const [selectedFile, setSelectedFile] = useState<FileStatus | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [remoteAction, setRemoteAction] = useState<"push" | "fetch" | "pull" | null>(null);

  const repoInfo = useQuery({
    queryKey: ["git", "info", repoPath],
    queryFn: () => api.getRepoInfo(repoPath as string),
    enabled: !!repoPath,
  });

  const status = useQuery({
    queryKey: ["git", "status", repoPath],
    queryFn: () => api.getRepoStatus(repoPath as string),
    enabled: !!repoPath,
  });

  const branches = useQuery({
    queryKey: ["git", "branches", repoPath],
    queryFn: () => api.listBranches(repoPath as string),
    enabled: !!repoPath,
  });

  const log = useQuery({
    queryKey: ["git", "log", repoPath],
    queryFn: () => api.getCommitLog(repoPath as string, 100),
    enabled: !!repoPath && view === "history",
  });

  const diffQuery = useQuery({
    queryKey: ["git", "diff", repoPath, selectedFile?.path, selectedFile?.staged],
    queryFn: () => api.getFileDiff(repoPath as string, selectedFile!.path, selectedFile!.staged),
    enabled: !!repoPath && !!selectedFile,
  });

  function refreshAll() {
    queryClient.invalidateQueries({ queryKey: ["git"] });
  }

  const toggleMutation = useMutation({
    mutationFn: (file: FileStatus) => (file.staged ? api.unstageFile(repoPath as string, file.path) : api.stageFile(repoPath as string, file.path)),
    onSuccess: refreshAll,
    onError: (e: Error) => setError(e.message),
  });

  const commitMutation = useMutation({
    mutationFn: () => api.commitChanges(repoPath as string, commitMessage),
    onSuccess: () => {
      setCommitMessage("");
      refreshAll();
    },
    onError: (e: Error) => setError(e.message),
  });

  const checkoutMutation = useMutation({
    mutationFn: (branch: string) => api.checkoutBranch(repoPath as string, branch),
    onSuccess: refreshAll,
    onError: (e: Error) => setError(e.message),
  });

  const remoteMutation = useMutation({
    mutationFn: async (vars: { action: "push" | "fetch" | "pull"; keyPath?: string; passphrase?: string }) => {
      const branch = repoInfo.data?.current_branch;
      if (!repoPath || !branch) throw new Error("No hay una rama activa.");
      if (vars.action === "push") return api.pushToRemote(repoPath, "origin", branch, vars.keyPath, vars.passphrase);
      if (vars.action === "fetch") return api.fetchFromRemote(repoPath, "origin", branch, vars.keyPath, vars.passphrase);
      return api.pullFromRemote(repoPath, "origin", branch, vars.keyPath, vars.passphrase);
    },
    onSuccess: () => {
      refreshAll();
      setRemoteAction(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  async function pickRepo() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected !== "string") return;
    const isRepo = await api.isGitRepository(selected);
    if (!isRepo) {
      setError(`'${selected}' no es un repositorio Git.`);
      return;
    }
    setError(null);
    setRepoPath(selected);
    setSelectedFile(null);
  }

  const staged = (status.data ?? []).filter((f) => f.staged);
  const unstaged = (status.data ?? []).filter((f) => !f.staged);

  if (!repoPath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-text-dim">
        <GitBranch size={28} />
        <p className="text-xs">Abre una carpeta con un repositorio Git para empezar.</p>
        <button onClick={pickRepo} className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-bright">
          <FolderOpen size={13} /> Abrir repositorio
        </button>
        {error && <p className="text-xs text-accent-bright">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 flex-wrap items-center gap-2 border-b border-borderMuted bg-panelAlt px-3">
        <GitBranch size={13} className="text-accent-bright" />
        <span className="truncate text-xs text-text" title={repoPath}>
          {repoPath.split(/[\\/]/).pop()}
        </span>

        <select
          value={repoInfo.data?.current_branch ?? ""}
          onChange={(e) => checkoutMutation.mutate(e.target.value)}
          className="h-7 rounded-md border border-border bg-base px-2 text-[11px] text-text outline-none"
        >
          {(branches.data ?? []).map((b) => (
            <option key={b.name} value={b.name}>
              {b.name}
            </option>
          ))}
        </select>

        <span className={cn("rounded-full border px-2 py-0.5 text-[10px]", repoInfo.data?.is_clean ? "border-ok/40 text-ok" : "border-warn/40 text-warn")}>
          {repoInfo.data?.is_clean ? "Sin cambios" : "Cambios pendientes"}
        </span>

        <div className="flex gap-1">
          <button
            onClick={() => setRemoteAction("fetch")}
            className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-text-muted hover:bg-overlay/[0.04]"
          >
            <DownloadCloud size={12} /> Fetch
          </button>
          <button
            onClick={() => setRemoteAction("pull")}
            className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-text-muted hover:bg-overlay/[0.04]"
          >
            <ArrowDownToLine size={12} /> Pull
          </button>
          <button
            onClick={() => setRemoteAction("push")}
            className="flex h-7 items-center gap-1 rounded-md border border-accent/50 px-2 text-[11px] text-accent-bright hover:bg-accent/10"
          >
            <UploadCloud size={12} /> Push
          </button>
        </div>

        <div className="ml-auto flex gap-1">
          <button
            onClick={() => setView("changes")}
            className={cn("flex h-7 items-center gap-1 rounded-md px-2 text-[11px]", view === "changes" ? "bg-overlay/[0.06] text-text" : "text-text-dim hover:bg-overlay/[0.03]")}
          >
            <ListChecks size={12} /> Cambios
          </button>
          <button
            onClick={() => setView("history")}
            className={cn("flex h-7 items-center gap-1 rounded-md px-2 text-[11px]", view === "history" ? "bg-overlay/[0.06] text-text" : "text-text-dim hover:bg-overlay/[0.03]")}
          >
            <History size={12} /> Historial
          </button>
          <button onClick={refreshAll} className="flex h-7 w-7 items-center justify-center rounded-md text-text-dim hover:bg-overlay/[0.06] hover:text-text" aria-label="Actualizar">
            <RefreshCw size={13} className={status.isFetching ? "animate-spin" : ""} />
          </button>
          <button onClick={pickRepo} className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-text-muted hover:bg-overlay/[0.04]">
            <FolderOpen size={12} /> Cambiar
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 border-b border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent-bright">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {view === "changes" ? (
        <div className="flex min-h-0 flex-1">
          <div className="flex w-72 shrink-0 flex-col border-r border-borderMuted">
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <p className="px-2 py-1 text-[10px] uppercase tracking-widest text-text-dim">Preparados ({staged.length})</p>
              {staged.map((f) => (
                <FileRow key={`s-${f.path}`} file={f} selected={selectedFile?.path === f.path && selectedFile.staged} onSelect={() => setSelectedFile(f)} onToggle={() => toggleMutation.mutate(f)} />
              ))}
              <p className="mt-3 px-2 py-1 text-[10px] uppercase tracking-widest text-text-dim">Sin preparar ({unstaged.length})</p>
              {unstaged.map((f) => (
                <FileRow key={`u-${f.path}`} file={f} selected={selectedFile?.path === f.path && !selectedFile.staged} onSelect={() => setSelectedFile(f)} onToggle={() => toggleMutation.mutate(f)} />
              ))}
              {(status.data ?? []).length === 0 && <p className="p-2 text-xs text-text-dim">No hay cambios.</p>}
            </div>
            <div className="border-t border-borderMuted p-2">
              <textarea
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder="Mensaje de commit..."
                rows={3}
                className="w-full resize-none rounded-md border border-border bg-base p-2 text-xs text-text outline-none focus:border-accent/60"
              />
              <button
                onClick={() => commitMutation.mutate()}
                disabled={!commitMessage.trim() || staged.length === 0 || commitMutation.isPending}
                className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-accent text-xs font-medium text-white hover:bg-accent-bright disabled:opacity-40"
              >
                <Check size={13} /> {commitMutation.isPending ? "Confirmando..." : `Confirmar (${staged.length})`}
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {selectedFile ? <DiffView diff={diffQuery.data ?? ""} /> : <p className="p-4 text-xs text-text-dim">Selecciona un archivo para ver sus cambios.</p>}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="space-y-1.5">
            {(log.data ?? []).map((c) => (
              <div key={c.hash} className="rounded-md border border-border bg-base p-2.5 text-[11px]">
                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-borderMuted px-1.5 py-0.5 font-mono text-[10px] text-accent-bright">{c.short_hash}</span>
                  <span className="text-text">{c.summary}</span>
                </div>
                <p className="mt-1 text-text-dim">
                  {c.author_name} · {new Date(c.timestamp_unix * 1000).toLocaleString()}
                </p>
              </div>
            ))}
            {(log.data ?? []).length === 0 && <p className="text-xs text-text-dim">Sin commits todavia.</p>}
          </div>
        </div>
      )}

      {remoteAction && <RemoteActionModal action={remoteAction} pending={remoteMutation.isPending} onCancel={() => setRemoteAction(null)} onSubmit={(keyPath, passphrase) => remoteMutation.mutate({ action: remoteAction, keyPath, passphrase })} />}
    </div>
  );
}

function RemoteActionModal({
  action,
  pending,
  onCancel,
  onSubmit,
}: {
  action: "push" | "fetch" | "pull";
  pending: boolean;
  onCancel: () => void;
  onSubmit: (keyPath?: string, passphrase?: string) => void;
}) {
  const [keyPath, setKeyPath] = useState("");
  const [passphrase, setPassphrase] = useState("");

  const titles = { push: "Push a origin", fetch: "Fetch de origin", pull: "Pull de origin" };

  async function pickKey() {
    const selected = await open({ multiple: false });
    if (typeof selected === "string") setKeyPath(selected);
  }

  return (
    <Modal title={titles[action]} onClose={onCancel} widthClassName="w-[380px]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(keyPath.trim() || undefined, passphrase || undefined);
        }}
        className="space-y-3"
      >
        <p className="text-xs text-text-dim">
          Dejalo en blanco para usar ssh-agent o tu llave por defecto (<span className="font-mono">~/.ssh/id_ed25519</span> o{" "}
          <span className="font-mono">id_rsa</span>). Solo hace falta llenarlo si tu llave esta en otro lugar.
        </p>
        <div className="flex gap-2">
          <input
            value={keyPath}
            onChange={(e) => setKeyPath(e.target.value)}
            placeholder="Ruta de la llave privada (opcional)"
            className="h-8 flex-1 rounded-md border border-border bg-base px-2.5 font-mono text-xs text-text outline-none focus:border-accent/60"
          />
          <button type="button" onClick={pickKey} className="flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-text-muted hover:bg-overlay/[0.04]">
            <FolderOpen size={13} />
          </button>
        </div>
        <input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="Frase de contrasena de la llave (si tiene)"
          className="h-8 w-full rounded-md border border-border bg-base px-2.5 text-xs text-text outline-none focus:border-accent/60"
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="h-8 rounded-md border border-border px-3 text-xs text-text-muted hover:bg-overlay/[0.04]">
            Cancelar
          </button>
          <button type="submit" disabled={pending} className="h-8 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-bright disabled:opacity-40">
            {pending ? "Ejecutando..." : titles[action]}
          </button>
        </div>
      </form>
    </Modal>
  );
}
