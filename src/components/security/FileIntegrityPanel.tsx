import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, FileSearch, Save, RefreshCw, Trash2, FilePlus2, FileMinus2, FileEdit } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { api } from "@/lib/tauri";
import { formatBytes } from "@/lib/format";
import type { FileHashEntry, DirectoryHashResult } from "@/types/security";

function unixToLocale(unixSecs: number) {
  if (!unixSecs) return "—";
  return new Date(unixSecs * 1000).toLocaleString();
}

export function FileIntegrityPanel() {
  const [targetPath, setTargetPath] = useState("");
  const [scan, setScan] = useState<DirectoryHashResult | FileHashEntry | null>(null);
  const [baselineName, setBaselineName] = useState("");
  const [activeBaseline, setActiveBaseline] = useState<string | null>(null);
  const [pendingDeleteName, setPendingDeleteName] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: baselines } = useQuery({
    queryKey: ["security", "baselines"],
    queryFn: api.listBaselines,
  });

  const scanMutation = useMutation({
    mutationFn: async (path: string) => {
      // Try as a directory first (the common case for a baseline); fall
      // back to a single-file hash so this box also works for "verify one
      // installer" without a separate control.
      try {
        return { kind: "dir" as const, result: await api.hashDirectory(path) };
      } catch {
        return { kind: "file" as const, result: await api.hashFile(path) };
      }
    },
    onSuccess: (data) => setScan(data.result),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!scan || !("entries" in scan)) throw new Error("Escanea una carpeta antes de guardar una linea base.");
      if (!baselineName.trim()) throw new Error("Ponle un nombre a la linea base.");
      await api.saveBaseline(baselineName.trim(), targetPath, scan.entries);
    },
    onSuccess: () => {
      setBaselineName("");
      queryClient.invalidateQueries({ queryKey: ["security", "baselines"] });
    },
  });

  const compareMutation = useMutation({
    mutationFn: (name: string) => api.compareBaseline(name),
    onMutate: (name) => setActiveBaseline(name),
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) => api.deleteBaseline(name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["security", "baselines"] }),
  });

  async function pickPath(directory: boolean) {
    const selected = await open({ directory, multiple: false });
    if (typeof selected === "string") setTargetPath(selected);
  }

  const dirScan = scan && "entries" in scan ? scan : null;
  const fileScan = scan && "sha256" in scan ? scan : null;
  const drift = compareMutation.data;

  return (
    <div className="grid h-full grid-cols-1 gap-4 overflow-y-auto p-5 xl:grid-cols-2">
      <Card title="Escanear y crear linea base">
        <div className="space-y-3">
          <p className="text-xs text-text-dim">
            Calcula el hash SHA-256 de un archivo o de todos los archivos dentro de una carpeta. Guarda el resultado
            como linea base para detectar cambios mas adelante.
          </p>
          <div className="flex gap-2">
            <input
              value={targetPath}
              onChange={(e) => setTargetPath(e.target.value)}
              placeholder="Ruta de archivo o carpeta..."
              className="h-8 flex-1 rounded-md border border-border bg-base px-2.5 font-mono text-xs text-text outline-none focus:border-accent/60"
            />
            <button
              onClick={() => pickPath(true)}
              className="flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-text-muted hover:bg-overlay/[0.04]"
            >
              <FolderOpen size={13} /> Carpeta
            </button>
            <button
              onClick={() => pickPath(false)}
              className="flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-text-muted hover:bg-overlay/[0.04]"
            >
              <FileSearch size={13} /> Archivo
            </button>
          </div>
          <button
            onClick={() => targetPath && scanMutation.mutate(targetPath)}
            disabled={!targetPath || scanMutation.isPending}
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-accent text-xs font-medium text-white hover:bg-accent-bright disabled:opacity-40"
          >
            <RefreshCw size={13} className={scanMutation.isPending ? "animate-spin" : ""} />
            {scanMutation.isPending ? "Escaneando..." : "Escanear"}
          </button>

          {scanMutation.isError && (
            <p className="text-xs text-accent-bright">{String((scanMutation.error as Error)?.message ?? scanMutation.error)}</p>
          )}

          {fileScan && (
            <div className="rounded-md border border-border bg-base p-3 font-mono text-[11px]">
              <p className="break-all text-text">{fileScan.path}</p>
              <p className="mt-1 break-all text-text-dim">sha256: {fileScan.sha256}</p>
              <p className="text-text-dim">{formatBytes(fileScan.size_bytes)} · modificado {unixToLocale(fileScan.modified_unix)}</p>
            </div>
          )}

          {dirScan && (
            <div className="space-y-2">
              <p className="text-xs text-text-muted">
                {dirScan.entries.length} archivo(s) escaneados{dirScan.truncated ? " (resultado truncado, hay mas archivos de los mostrados)" : ""}.
              </p>
              <div className="flex gap-2">
                <input
                  value={baselineName}
                  onChange={(e) => setBaselineName(e.target.value)}
                  placeholder="Nombre de la linea base..."
                  className="h-8 flex-1 rounded-md border border-border bg-base px-2.5 text-xs text-text outline-none focus:border-accent/60"
                />
                <button
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                  className="flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-text-muted hover:bg-overlay/[0.04] disabled:opacity-40"
                >
                  <Save size={13} /> Guardar linea base
                </button>
              </div>
              {saveMutation.isError && (
                <p className="text-xs text-accent-bright">{String((saveMutation.error as Error)?.message)}</p>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card title="Lineas base guardadas">
        <div className="space-y-2">
          {(baselines ?? []).length === 0 && <p className="text-xs text-text-dim">Aun no hay lineas base guardadas.</p>}
          {(baselines ?? []).map((b) => (
            <div key={b.name} className="rounded-md border border-border bg-base p-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-text">{b.name}</p>
                  <p className="truncate text-[10px] text-text-dim">{b.root_path}</p>
                  <p className="text-[10px] text-text-dim">
                    {b.file_count} archivos · creada {unixToLocale(b.created_at_unix)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    onClick={() => compareMutation.mutate(b.name)}
                    className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[10px] text-text-muted hover:bg-overlay/[0.04]"
                  >
                    <RefreshCw size={11} className={compareMutation.isPending && activeBaseline === b.name ? "animate-spin" : ""} />
                    Comparar
                  </button>
                  <button
                    onClick={() => setPendingDeleteName(b.name)}
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-dim hover:border-accent/50 hover:text-accent-bright"
                    aria-label={`Eliminar ${b.name}`}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>

              {activeBaseline === b.name && drift && drift.baseline_name === b.name && (
                <div className="mt-2 space-y-1 border-t border-borderMuted pt-2 text-[11px]">
                  <p className="text-text-dim">{drift.unchanged_count} sin cambios</p>
                  {drift.added.length === 0 && drift.removed.length === 0 && drift.modified.length === 0 ? (
                    <p className="text-accent-bright/80">Sin diferencias respecto a la linea base.</p>
                  ) : (
                    <>
                      {drift.added.map((p) => (
                        <p key={p} className="flex items-center gap-1.5 break-all text-ok">
                          <FilePlus2 size={11} /> {p}
                        </p>
                      ))}
                      {drift.modified.map((p) => (
                        <p key={p} className="flex items-center gap-1.5 break-all text-warn">
                          <FileEdit size={11} /> {p}
                        </p>
                      ))}
                      {drift.removed.map((p) => (
                        <p key={p} className="flex items-center gap-1.5 break-all text-accent-bright">
                          <FileMinus2 size={11} /> {p}
                        </p>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      {pendingDeleteName && (
        <ConfirmDialog
          title="Eliminar linea base"
          message={`¿Eliminar la linea base "${pendingDeleteName}"? Esta accion no se puede deshacer.`}
          confirmLabel="Eliminar"
          onCancel={() => setPendingDeleteName(null)}
          onConfirm={() => {
            deleteMutation.mutate(pendingDeleteName);
            setPendingDeleteName(null);
          }}
        />
      )}
    </div>
  );
}
