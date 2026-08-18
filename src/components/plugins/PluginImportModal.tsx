import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderInput, FileArchive, AlertTriangle, Package } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/tauri";
import type { PluginImportResult } from "@/types/plugins";

interface PluginImportModalProps {
  onClose: () => void;
  onImported: () => void;
}

/**
 * Two-step "install a plugin" flow, same shape as ScriptImportModal:
 *  1. The user points at a folder or a .zip containing a `plugin.json` +
 *     a single self-contained `.html` entry file. We copy/extract it into
 *     KRYPTOS's own scratch storage (import_plugin_source) and validate
 *     the manifest right away, showing its declared name/version/author.
 *  2. The user confirms; finalize_plugin_import moves the copy into
 *     permanent storage and installs it, enabled by default. Nothing here
 *     is user-editable — the manifest is the source of truth — so step 2
 *     is just a confirmation, not a form.
 * Closing before confirming discards the copy via cancel_plugin_import.
 */
export function PluginImportModal({ onClose, onImported }: PluginImportModalProps) {
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);
  const [imported, setImported] = useState<PluginImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const importMutation = useMutation({
    mutationFn: (sourcePath: string) => api.importPluginSource(sourcePath),
    onSuccess: (result) => {
      setImported(result);
      setError(null);
    },
    onError: (err) => setError(String((err as Error)?.message ?? err)),
  });

  const finalizeMutation = useMutation({
    mutationFn: () => {
      if (!imported) throw new Error("Nada que instalar.");
      return api.finalizePluginImport(imported.import_id);
    },
    onSuccess: () => {
      onImported();
      onClose();
    },
    onError: (err) => setError(String((err as Error)?.message ?? err)),
  });

  async function handleClose() {
    if (imported && !finalizeMutation.isSuccess) {
      await api.cancelPluginImport(imported.import_id).catch(() => {});
    }
    onClose();
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

  return (
    <Modal title="Instalar plugin" onClose={handleClose} widthClassName="w-[440px]">
      <div className="space-y-3">
        {!imported && (
          <>
            <p className="text-xs text-text-dim">
              Elige una carpeta o un <code className="text-text-muted">.zip</code> que tenga adentro un{" "}
              <code className="text-text-muted">plugin.json</code> y un archivo <code className="text-text-muted">.html</code>{" "}
              autocontenido (CSS/JS inline) — así es como se empaqueta un plugin de KRYPTOS.
            </p>
            <div className="grid grid-cols-2 gap-2">
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
            {importMutation.isPending && <p className="text-xs text-text-dim">Validando plugin.json...</p>}
          </>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent-bright">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {imported && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-md border border-ok/40 bg-ok/10 px-3 py-2 text-xs text-ok">
              <Package size={13} className="shrink-0" />
              Manifiesto valido.
            </div>

            <div className="rounded-md border border-border bg-base p-3">
              <div className="flex items-center gap-2">
                <span className="text-lg leading-none">{imported.manifest.icon || "🧩"}</span>
                <p className="text-sm font-medium text-text">{imported.manifest.name}</p>
                <span className="ml-auto rounded bg-overlay/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-text-dim">
                  v{imported.manifest.version}
                </span>
              </div>
              {imported.manifest.description && (
                <p className="mt-1.5 text-xs text-text-dim">{imported.manifest.description}</p>
              )}
              {imported.manifest.author && <p className="mt-1 text-[10px] text-text-dim">por {imported.manifest.author}</p>}
            </div>

            {finalizeMutation.isError && (
              <p className="text-xs text-accent-bright">
                {String((finalizeMutation.error as Error)?.message ?? finalizeMutation.error)}
              </p>
            )}

            <button
              type="button"
              onClick={() => finalizeMutation.mutate()}
              disabled={finalizeMutation.isPending}
              className="flex h-8 w-full items-center justify-center rounded-md bg-accent text-xs font-medium text-white hover:bg-accent-bright disabled:opacity-40"
            >
              {finalizeMutation.isPending ? "Instalando..." : "Instalar plugin"}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
