import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, PlaySquare } from "lucide-react";
import { ScriptTile } from "@/components/scripts/ScriptTile";
import { ScriptForm } from "@/components/scripts/ScriptForm";
import { ScriptImportModal } from "@/components/scripts/ScriptImportModal";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { api } from "@/lib/tauri";
import type { ScriptEntry } from "@/types/scripts";

export default function Scripts() {
  const queryClient = useQueryClient();
  const [modal, setModal] = useState<{ mode: "add" } | { mode: "edit"; script: ScriptEntry } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ScriptEntry | null>(null);

  const { data: scripts, isLoading } = useQuery({
    queryKey: ["scripts", "list"],
    queryFn: api.listScripts,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["scripts", "list"] });

  const updateMutation = useMutation({
    mutationFn: (v: { id: string; name: string; repoUrl?: string; iconSourcePath?: string }) =>
      api.updateScript(v.id, v.name, v.repoUrl, v.iconSourcePath),
    onSuccess: () => {
      invalidate();
      setModal(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteScript(id),
    onSuccess: invalidate,
  });

  const activeModal = modal;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-borderMuted bg-panelAlt px-5 py-3">
        <div className="flex items-center gap-2">
          <PlaySquare size={16} className="text-accent-bright" />
          <h2 className="text-sm font-medium text-text">Scripts</h2>
        </div>
        <button
          onClick={() => setModal({ mode: "add" })}
          className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-bright"
        >
          <Plus size={13} />
          Agregar script
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <p className="mb-4 text-xs text-text-dim">
          Guarda tus scripts propios (.ps1, .sh, .py, .bat, .js) dentro de KRYPTOS como vitrina — quedan guardados
          aqui aunque borres el archivo original, para que quien abra la app pueda ver el codigo o ir a su
          repositorio. KRYPTOS no los ejecuta.
        </p>

        {isLoading && <p className="text-xs text-text-dim">Cargando...</p>}

        {!isLoading && (scripts ?? []).length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
            <PlaySquare size={28} className="mb-3 text-text-dim" />
            <p className="text-sm text-text-muted">Aun no agregas ningun script.</p>
            <button
              onClick={() => setModal({ mode: "add" })}
              className="mt-3 flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-bright"
            >
              <Plus size={13} />
              Agregar el primero
            </button>
          </div>
        )}

        <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-3">
          {(scripts ?? []).map((script) => (
            <ScriptTile
              key={script.id}
              script={script}
              onEdit={() => setModal({ mode: "edit", script })}
              onDelete={() => setPendingDelete(script)}
            />
          ))}
        </div>
      </div>

      {activeModal?.mode === "add" && (
        <ScriptImportModal onClose={() => setModal(null)} onImported={invalidate} />
      )}

      {activeModal?.mode === "edit" && (
        <Modal title="Editar script" onClose={() => setModal(null)}>
          <ScriptForm
            initial={activeModal.script}
            submitting={updateMutation.isPending}
            errorMessage={updateMutation.isError ? String((updateMutation.error as Error)?.message) : undefined}
            onSubmit={(values) => updateMutation.mutate({ id: activeModal.script.id, ...values })}
          />
        </Modal>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Quitar script"
          message={`¿Quitar "${pendingDelete.name}"? Esto borra tambien la copia guardada dentro de KRYPTOS.`}
          confirmLabel="Quitar"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            deleteMutation.mutate(pendingDelete.id);
            setPendingDelete(null);
          }}
        />
      )}
    </div>
  );
}
