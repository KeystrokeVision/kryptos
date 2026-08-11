import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Copy, Trash2, AlertTriangle, Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { api } from "@/lib/tauri";
import { formatBytes } from "@/lib/format";

interface DuplicateFinderModalProps {
  path: string;
  onClose: () => void;
  onDeleted: () => void;
}

/**
 * Busca duplicados exactos (mismo hash SHA-256) bajo la carpeta actual.
 * Preselecciona todas las copias menos la primera de cada grupo para
 * borrar — el criterio "quedate con una" mas comun — pero cada casilla es
 * editable antes de confirmar.
 */
export function DuplicateFinderModal({ path, onClose, onDeleted }: DuplicateFinderModalProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const scan = useMutation({
    mutationFn: () => api.findDuplicateFiles(path),
    onSuccess: (result) => {
      const preselected = new Set<string>();
      for (const group of result.groups) {
        group.paths.slice(1).forEach((p) => preselected.add(p));
      }
      setSelected(preselected);
    },
  });

  useEffect(() => {
    scan.mutate();
    // Solo al montar — el usuario puede cerrar y reabrir el modal para re-escanear.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(p: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  async function deleteSelected() {
    setDeleteError(null);
    try {
      for (const p of selected) {
        await api.deletePath(p);
      }
      onDeleted();
      onClose();
    } catch (e) {
      setDeleteError(String((e as Error)?.message ?? e));
    }
  }

  const totalReclaimable = (scan.data?.groups ?? []).reduce((sum, g) => sum + g.size_bytes * (g.paths.length - 1), 0);

  return (
    <Modal title="Buscador de duplicados" onClose={onClose} widthClassName="w-[640px]">
      <div className="space-y-3">
        {scan.isPending && (
          <p className="flex items-center gap-2 text-xs text-text-dim">
            <Loader2 size={13} className="animate-spin" /> Escaneando "{path}"...
          </p>
        )}
        {scan.isError && <p className="text-xs text-accent-bright">{String((scan.error as Error)?.message)}</p>}

        {scan.data && (
          <>
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-text-dim">
              <span>{scan.data.files_scanned.toLocaleString()} archivos revisados</span>
              <span>·</span>
              <span>{scan.data.groups.length} grupo(s) de duplicados</span>
              <span>·</span>
              <span className="text-ok">{formatBytes(totalReclaimable)} recuperables</span>
            </div>
            {scan.data.truncated && (
              <div className="flex items-center gap-2 rounded-md border border-warn/30 bg-warn/5 px-2.5 py-1.5 text-[11px] text-warn">
                <AlertTriangle size={12} /> Habia demasiados archivos — el escaneo se corto antes de terminar.
              </div>
            )}

            {scan.data.groups.length === 0 && <p className="text-xs text-text-dim">No se encontraron duplicados exactos.</p>}

            <div className="max-h-96 space-y-3 overflow-y-auto">
              {scan.data.groups.map((group) => (
                <div key={group.sha256} className="rounded-md border border-border bg-base p-2.5">
                  <div className="mb-1.5 flex items-center gap-2 text-[10px] text-text-dim">
                    <Copy size={11} /> {formatBytes(group.size_bytes)} cada uno · {group.paths.length} copias
                  </div>
                  <div className="space-y-1">
                    {group.paths.map((p) => (
                      <label key={p} className="flex items-center gap-2 rounded px-1 py-0.5 text-[11px] text-text-muted hover:bg-white/[0.03]">
                        <input type="checkbox" checked={selected.has(p)} onChange={() => toggle(p)} />
                        <span className="truncate font-mono">{p}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {deleteError && <p className="text-xs text-accent-bright">{deleteError}</p>}

            {scan.data.groups.length > 0 && (
              <button
                onClick={() => setPendingDelete(true)}
                disabled={selected.size === 0}
                className="flex h-8 items-center gap-1.5 rounded-md border border-accent/50 px-3 text-xs text-accent-bright hover:bg-accent/10 disabled:opacity-40"
              >
                <Trash2 size={13} /> Eliminar {selected.size} seleccionado(s)
              </button>
            )}
          </>
        )}
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title="Eliminar duplicados"
          message={`¿Eliminar los ${selected.size} archivos seleccionados permanentemente? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          onCancel={() => setPendingDelete(false)}
          onConfirm={() => {
            setPendingDelete(false);
            deleteSelected();
          }}
        />
      )}
    </Modal>
  );
}
