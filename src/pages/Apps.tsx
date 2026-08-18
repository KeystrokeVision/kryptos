import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, LayoutGrid, AlertTriangle, Search, Store, HardDrive } from "lucide-react";
import { AppTile } from "@/components/apps/AppTile";
import { AppForm } from "@/components/apps/AppForm";
import { InstalledAppsBrowser } from "@/components/apps/InstalledAppsBrowser";
import { PortableImportModal } from "@/components/apps/PortableImportModal";
import { WingetStore } from "@/components/apps/WingetStore";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { api } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { AppEntry, DiscoveredApp } from "@/types/apps";

export default function Apps() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<"launcher" | "store">("launcher");
  const [modal, setModal] = useState<
    { mode: "add" } | { mode: "edit"; app: AppEntry } | { mode: "browse" } | { mode: "import-portable" } | null
  >(null);
  const [prefill, setPrefill] = useState<{ name: string; exePath: string } | undefined>(undefined);
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AppEntry | null>(null);
  const [query, setQuery] = useState("");

  const { data: apps, isLoading } = useQuery({
    queryKey: ["apps", "list"],
    queryFn: api.listApplications,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["apps", "list"] });

  const addMutation = useMutation({
    mutationFn: (v: { name: string; exePath: string; iconSourcePath?: string }) =>
      api.addApplication(v.name, v.exePath, v.iconSourcePath),
    onSuccess: () => {
      invalidate();
      setModal(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (v: { id: string; name: string; exePath: string; iconSourcePath?: string }) =>
      api.updateApplication(v.id, v.name, v.exePath, v.iconSourcePath),
    onSuccess: () => {
      invalidate();
      setModal(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteApplication(id),
    onSuccess: invalidate,
  });

  async function handleLaunch(app: AppEntry) {
    setLaunchError(null);
    setLaunchingId(app.id);
    try {
      await api.launchApplication(app.id);
    } catch (err) {
      setLaunchError(`${app.name}: ${String((err as Error)?.message ?? err)}`);
    } finally {
      setLaunchingId(null);
    }
  }

  function handleDelete(app: AppEntry) {
    setPendingDelete(app);
  }

  function handlePickInstalled(discovered: DiscoveredApp) {
    setPrefill({ name: discovered.name, exePath: discovered.exec_path });
    setModal({ mode: "add" });
  }

  const activeModal = modal;

  const filteredApps = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = apps ?? [];
    return q ? list.filter((a) => a.name.toLowerCase().includes(q)) : list;
  }, [apps, query]);
  const portableApps = filteredApps.filter((a) => a.is_portable);
  const regularApps = filteredApps.filter((a) => !a.is_portable);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-borderMuted bg-panelAlt px-5 py-3">
        <div className="flex items-center gap-2">
          <LayoutGrid size={16} className="text-accent-bright" />
          <h2 className="text-sm font-medium text-text">Aplicaciones</h2>
          <div className="ml-3 flex gap-1">
            <button
              onClick={() => setView("launcher")}
              className={cn("flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px]", view === "launcher" ? "bg-overlay/[0.06] text-text" : "text-text-dim hover:bg-overlay/[0.03]")}
            >
              <LayoutGrid size={12} /> Lanzador
            </button>
            <button
              onClick={() => setView("store")}
              className={cn("flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px]", view === "store" ? "bg-overlay/[0.06] text-text" : "text-text-dim hover:bg-overlay/[0.03]")}
            >
              <Store size={12} /> Tienda
            </button>
          </div>
        </div>
        {view === "launcher" && (
          <div className="flex items-center gap-2">
            <div className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-base px-2.5">
              <Search size={12} className="text-text-dim" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filtrar..."
                className="h-full w-28 bg-transparent text-xs text-text outline-none placeholder:text-text-dim"
              />
            </div>
            <button
              onClick={() => setModal({ mode: "browse" })}
              className="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-text-muted hover:bg-overlay/[0.04]"
            >
              <Search size={13} />
              Explorar instaladas
            </button>
            <button
              onClick={() => setModal({ mode: "import-portable" })}
              className="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-text-muted hover:bg-overlay/[0.04]"
            >
              <HardDrive size={13} />
              Importar portable
            </button>
            <button
              onClick={() => {
                setPrefill(undefined);
                setModal({ mode: "add" });
              }}
              className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-bright"
            >
              <Plus size={13} />
              Agregar
            </button>
          </div>
        )}
      </div>

      {view === "store" ? (
        <div className="min-h-0 flex-1">
          <WingetStore />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {launchError && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent-bright">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {launchError}
            </div>
          )}

          {isLoading && <p className="text-xs text-text-dim">Cargando...</p>}

          {!isLoading && (apps ?? []).length === 0 && (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
              <LayoutGrid size={28} className="mb-3 text-text-dim" />
              <p className="text-sm text-text-muted">Aun no agregas ninguna aplicacion.</p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => {
                    setPrefill(undefined);
                    setModal({ mode: "add" });
                  }}
                  className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-bright"
                >
                  <Plus size={13} />
                  Agregar la primera
                </button>
                <button
                  onClick={() => setModal({ mode: "import-portable" })}
                  className="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-text-muted hover:bg-overlay/[0.04]"
                >
                  <HardDrive size={13} />
                  Importar portable
                </button>
              </div>
            </div>
          )}

          {!isLoading && (apps ?? []).length > 0 && filteredApps.length === 0 && (
            <p className="py-10 text-center text-xs text-text-dim">Sin resultados para "{query}".</p>
          )}

          {portableApps.length > 0 && (
            <section className="mb-6">
              <div className="mb-2.5 flex items-center gap-2">
                <HardDrive size={13} className="text-accent-bright" />
                <h3 className="text-[11px] font-medium uppercase tracking-widest text-text-dim">
                  Programas portables ({portableApps.length})
                </h3>
                <span className="text-[10px] text-text-dim">— guardados dentro de KRYPTOS</span>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-3">
                {portableApps.map((app) => (
                  <AppTile
                    key={app.id}
                    app={app}
                    launching={launchingId === app.id}
                    onLaunch={() => handleLaunch(app)}
                    onEdit={() => setModal({ mode: "edit", app })}
                    onDelete={() => handleDelete(app)}
                  />
                ))}
              </div>
            </section>
          )}

          {regularApps.length > 0 && (
            <section>
              {portableApps.length > 0 && (
                <div className="mb-2.5 flex items-center gap-2">
                  <LayoutGrid size={13} className="text-accent-bright" />
                  <h3 className="text-[11px] font-medium uppercase tracking-widest text-text-dim">
                    Aplicaciones ({regularApps.length})
                  </h3>
                </div>
              )}
              <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-3">
                {regularApps.map((app) => (
                  <AppTile
                    key={app.id}
                    app={app}
                    launching={launchingId === app.id}
                    onLaunch={() => handleLaunch(app)}
                    onEdit={() => setModal({ mode: "edit", app })}
                    onDelete={() => handleDelete(app)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {activeModal?.mode === "add" && (
        <Modal title="Agregar aplicacion" onClose={() => setModal(null)}>
          <AppForm
            prefill={prefill}
            submitting={addMutation.isPending}
            errorMessage={addMutation.isError ? String((addMutation.error as Error)?.message) : undefined}
            onSubmit={(values) => addMutation.mutate(values)}
          />
        </Modal>
      )}

      {activeModal?.mode === "browse" && (
        <InstalledAppsBrowser onClose={() => setModal(null)} onPick={handlePickInstalled} />
      )}

      {activeModal?.mode === "import-portable" && (
        <PortableImportModal onClose={() => setModal(null)} onImported={invalidate} />
      )}

      {activeModal?.mode === "edit" && (
        <Modal title="Editar aplicacion" onClose={() => setModal(null)}>
          <AppForm
            initial={activeModal.app}
            submitting={updateMutation.isPending}
            errorMessage={updateMutation.isError ? String((updateMutation.error as Error)?.message) : undefined}
            onSubmit={(values) => updateMutation.mutate({ id: activeModal.app.id, ...values })}
          />
        </Modal>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Quitar aplicacion"
          message={
            pendingDelete.is_portable
              ? `¿Quitar "${pendingDelete.name}"? Es un programa portable guardado dentro de KRYPTOS — esto borra tambien esa copia, no solo el acceso.`
              : `¿Quitar "${pendingDelete.name}" de Aplicaciones? Esto no borra el programa, solo el acceso directo.`
          }
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
