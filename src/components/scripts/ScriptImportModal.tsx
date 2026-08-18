import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FileSearch, FolderInput, FileArchive, AlertTriangle, Package, Image as ImageIcon, Link2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/tauri";
import type { ScriptImportResult } from "@/types/scripts";

const SCRIPT_EXTENSIONS = ["ps1", "sh", "bash", "py", "bat", "cmd", "js", "mjs"];

interface ScriptImportModalProps {
  onClose: () => void;
  onImported: () => void;
}

/**
 * Two-step "import a script" flow, mirroring PortableImportModal. This is a
 * showcase, not a runner — the point is that whoever opens KRYPTOS can read
 * the code or follow the repo link, not that KRYPTOS executes it for them.
 *  1. The user points at a single script file, a folder, or a .zip. We
 *     copy/extract it into KRYPTOS's own scratch storage right away
 *     (import_script_source) and get back every recognized script found
 *     inside — a bundle can have more than one (a script + a helper file).
 *  2. The user confirms which file is the main one, names it, optionally
 *     links to where it's really maintained, and optionally sets an icon
 *     (finalize_script_import), which moves the whole bundle into
 *     permanent storage and records it in the library.
 * Closing before step 2 finishes discards the copy via cancel_script_import
 * so nothing orphaned is left behind.
 */
export function ScriptImportModal({ onClose, onImported }: ScriptImportModalProps) {
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);
  const [imported, setImported] = useState<ScriptImportResult | null>(null);
  const [name, setName] = useState("");
  const [chosenScript, setChosenScript] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [iconSourcePath, setIconSourcePath] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const importMutation = useMutation({
    mutationFn: (sourcePath: string) => api.importScriptSource(sourcePath),
    onSuccess: (result, sourcePath) => {
      setImported(result);
      setChosenScript(result.guessed_script ?? result.candidates[0] ?? "");
      const base = sourcePath.split(/[\\/]/).pop() ?? sourcePath;
      setName(base.replace(/\.[^.]+$/, ""));
      setError(null);
    },
    onError: (err) => setError(String((err as Error)?.message ?? err)),
  });

  const finalizeMutation = useMutation({
    mutationFn: () => {
      if (!imported) throw new Error("Nada que guardar.");
      return api.finalizeScriptImport(imported.import_id, name.trim(), chosenScript, repoUrl.trim() || undefined, iconSourcePath);
    },
    onSuccess: () => {
      onImported();
      onClose();
    },
    onError: (err) => setError(String((err as Error)?.message ?? err)),
  });

  async function handleClose() {
    if (imported && !finalizeMutation.isSuccess) {
      await api.cancelScriptImport(imported.import_id).catch(() => {});
    }
    onClose();
  }

  async function pickFile() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Scripts", extensions: SCRIPT_EXTENSIONS }, { name: "Todos los archivos", extensions: ["*"] }],
    });
    if (typeof selected === "string") {
      setSourceLabel(selected);
      setError(null);
      importMutation.mutate(selected);
    }
  }

  async function pickFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      setSourceLabel(selected);
      setError(null);
      importMutation.mutate(selected);
    }
  }

  async function pickZip() {
    const selected = await open({ multiple: false, filters: [{ name: "Archivo ZIP", extensions: ["zip"] }] });
    if (typeof selected === "string") {
      setSourceLabel(selected);
      setError(null);
      importMutation.mutate(selected);
    }
  }

  async function pickIcon() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Imagenes", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "ico"] }],
    });
    if (typeof selected === "string") setIconSourcePath(selected);
  }

  return (
    <Modal title="Agregar script" onClose={handleClose} widthClassName="w-[460px]">
      <div className="space-y-3">
        {!imported && (
          <>
            <p className="text-xs text-text-dim">
              Copia el script (o toda su carpeta / .zip) dentro de KRYPTOS, para que quede guardado ahi mismo y siga
              funcionando aunque muevas o borres el original.
            </p>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={pickFile}
                disabled={importMutation.isPending}
                className="flex h-20 flex-col items-center justify-center gap-1.5 rounded-md border border-border text-xs text-text-muted hover:border-accent/50 hover:bg-overlay/[0.03] disabled:opacity-40"
              >
                <FileSearch size={18} className="text-accent-bright" />
                Un archivo
              </button>
              <button
                type="button"
                onClick={pickFolder}
                disabled={importMutation.isPending}
                className="flex h-20 flex-col items-center justify-center gap-1.5 rounded-md border border-border text-xs text-text-muted hover:border-accent/50 hover:bg-overlay/[0.03] disabled:opacity-40"
              >
                <FolderInput size={18} className="text-accent-bright" />
                Una carpeta
              </button>
              <button
                type="button"
                onClick={pickZip}
                disabled={importMutation.isPending}
                className="flex h-20 flex-col items-center justify-center gap-1.5 rounded-md border border-border text-xs text-text-muted hover:border-accent/50 hover:bg-overlay/[0.03] disabled:opacity-40"
              >
                <FileArchive size={18} className="text-accent-bright" />
                Un .zip
              </button>
            </div>
            {sourceLabel && <p className="truncate font-mono text-[10px] text-text-dim">{sourceLabel}</p>}
            {importMutation.isPending && <p className="text-xs text-text-dim">Copiando archivos...</p>}
          </>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent-bright">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {imported && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim() || !chosenScript) return;
              finalizeMutation.mutate();
            }}
            className="space-y-3"
          >
            <div className="flex items-center gap-2 rounded-md border border-ok/40 bg-ok/10 px-3 py-2 text-xs text-ok">
              <Package size={13} className="shrink-0" />
              Copiado dentro de KRYPTOS. Elige cual archivo es el principal.
            </div>

            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-widest text-text-dim">Nombre</label>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-8 w-full rounded-md border border-border bg-base px-2.5 text-xs text-text outline-none focus:border-accent/60"
              />
            </div>

            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-widest text-text-dim">
                Archivo principal ({imported.candidates.length})
              </label>
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border bg-base p-1.5">
                {imported.candidates.map((c) => (
                  <label
                    key={c}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[11px] hover:bg-overlay/[0.04]"
                  >
                    <input
                      type="radio"
                      name="chosen-script"
                      checked={chosenScript === c}
                      onChange={() => setChosenScript(c)}
                      className="shrink-0 accent-accent"
                    />
                    <span className="truncate font-mono text-text-muted">{c}</span>
                    {imported.guessed_script === c && (
                      <span className="ml-auto shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-accent-bright">
                        Sugerido
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-widest text-text-dim">
                Link del repositorio (opcional)
              </label>
              <div className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-base px-2.5">
                <Link2 size={12} className="shrink-0 text-text-dim" />
                <input
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/usuario/repo"
                  className="h-full flex-1 bg-transparent text-xs text-text outline-none placeholder:text-text-dim"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-widest text-text-dim">Foto (opcional)</label>
              <button
                type="button"
                onClick={pickIcon}
                className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-text-muted hover:bg-overlay/[0.04]"
              >
                <ImageIcon size={13} />
                {iconSourcePath ? iconSourcePath.split(/[\\/]/).pop() : "Elegir imagen..."}
              </button>
            </div>

            {finalizeMutation.isError && (
              <p className="text-xs text-accent-bright">
                {String((finalizeMutation.error as Error)?.message ?? finalizeMutation.error)}
              </p>
            )}

            <button
              type="submit"
              disabled={!name.trim() || !chosenScript || finalizeMutation.isPending}
              className="flex h-8 w-full items-center justify-center rounded-md bg-accent text-xs font-medium text-white hover:bg-accent-bright disabled:opacity-40"
            >
              {finalizeMutation.isPending ? "Guardando..." : "Agregar a Scripts"}
            </button>
          </form>
        )}
      </div>
    </Modal>
  );
}
