import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderInput, FileArchive, AlertTriangle, Package, Image as ImageIcon } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/tauri";
import type { PortableImportResult } from "@/types/apps";

interface PortableImportModalProps {
  onClose: () => void;
  onImported: () => void;
}

/**
 * Two-step "import a portable program" flow:
 *  1. The user points at a folder or a .zip. We copy/extract the whole
 *     thing into KRYPTOS's own storage right away (import_portable_source)
 *     and get back every .exe found inside.
 *  2. The user confirms which .exe is the program itself, names it, and
 *     optionally sets an icon (finalize_portable_app), which records it as
 *     a normal launcher entry.
 * Closing before step 2 finishes discards the copy via cancel_portable_import
 * so nothing orphaned is left behind.
 */
export function PortableImportModal({ onClose, onImported }: PortableImportModalProps) {
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);
  const [imported, setImported] = useState<PortableImportResult | null>(null);
  const [name, setName] = useState("");
  const [chosenExe, setChosenExe] = useState("");
  const [iconSourcePath, setIconSourcePath] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const importMutation = useMutation({
    mutationFn: (sourcePath: string) => api.importPortableSource(sourcePath),
    onSuccess: (result, sourcePath) => {
      setImported(result);
      setChosenExe(result.guessed_exe ?? result.candidates[0] ?? "");
      const base = sourcePath.split(/[\\/]/).pop() ?? sourcePath;
      setName(base.replace(/\.zip$/i, ""));
      setError(null);
    },
    onError: (err) => setError(String((err as Error)?.message ?? err)),
  });

  const finalizeMutation = useMutation({
    mutationFn: () => {
      if (!imported) throw new Error("Nada que guardar.");
      return api.finalizePortableApp(imported.import_id, name.trim(), chosenExe, iconSourcePath);
    },
    onSuccess: () => {
      onImported();
      onClose();
    },
    onError: (err) => setError(String((err as Error)?.message ?? err)),
  });

  async function handleClose() {
    if (imported && !finalizeMutation.isSuccess) {
      await api.cancelPortableImport(imported.import_id).catch(() => {});
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

  async function pickIcon() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Imagenes", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "ico"] }],
    });
    if (typeof selected === "string") setIconSourcePath(selected);
  }

  return (
    <Modal title="Importar programa portable" onClose={handleClose} widthClassName="w-[460px]">
      <div className="space-y-3">
        {!imported && (
          <>
            <p className="text-xs text-text-dim">
              Copia la carpeta o el .zip completo del programa dentro de KRYPTOS, para que quede guardado ahi
              mismo y siga funcionando aunque muevas o borres el original.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={pickFolder}
                disabled={importMutation.isPending}
                className="flex h-20 flex-col items-center justify-center gap-1.5 rounded-md border border-border text-xs text-text-muted hover:border-accent/50 hover:bg-overlay/[0.03] disabled:opacity-40"
              >
                <FolderInput size={18} className="text-accent-bright" />
                Elegir carpeta
              </button>
              <button
                type="button"
                onClick={pickZip}
                disabled={importMutation.isPending}
                className="flex h-20 flex-col items-center justify-center gap-1.5 rounded-md border border-border text-xs text-text-muted hover:border-accent/50 hover:bg-overlay/[0.03] disabled:opacity-40"
              >
                <FileArchive size={18} className="text-accent-bright" />
                Elegir archivo .zip
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
              if (!name.trim() || !chosenExe) return;
              finalizeMutation.mutate();
            }}
            className="space-y-3"
          >
            <div className="flex items-center gap-2 rounded-md border border-ok/40 bg-ok/10 px-3 py-2 text-xs text-ok">
              <Package size={13} className="shrink-0" />
              Copiado dentro de KRYPTOS. Elige cual .exe abre el programa.
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
                Ejecutable principal ({imported.candidates.length})
              </label>
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border bg-base p-1.5">
                {imported.candidates.map((c) => (
                  <label
                    key={c}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[11px] hover:bg-overlay/[0.04]"
                  >
                    <input
                      type="radio"
                      name="chosen-exe"
                      checked={chosenExe === c}
                      onChange={() => setChosenExe(c)}
                      className="shrink-0 accent-accent"
                    />
                    <span className="truncate font-mono text-text-muted">{c}</span>
                    {imported.guessed_exe === c && (
                      <span className="ml-auto shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-accent-bright">
                        Sugerido
                      </span>
                    )}
                  </label>
                ))}
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
              disabled={!name.trim() || !chosenExe || finalizeMutation.isPending}
              className="flex h-8 w-full items-center justify-center rounded-md bg-accent text-xs font-medium text-white hover:bg-accent-bright disabled:opacity-40"
            >
              {finalizeMutation.isPending ? "Guardando..." : "Agregar a Aplicaciones"}
            </button>
          </form>
        )}
      </div>
    </Modal>
  );
}
