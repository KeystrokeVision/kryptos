import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Blocks, Plus, Trash2, FolderOpen, PlugZap, Plug } from "lucide-react";
import { PluginImportModal } from "@/components/plugins/PluginImportModal";
import { PluginFrame } from "@/components/plugins/PluginFrame";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { api } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { PluginEntry } from "@/types/plugins";

/**
 * Plugins: mini-tools installed as a single self-contained `.html` file
 * (+ `plugin.json` manifest), sandboxed in an iframe — see PluginFrame
 * for exactly what that sandbox does and doesn't allow. Layout mirrors
 * Modo Hacker / Base de datos: a list on the left, the active thing on
 * the right.
 */
export default function Plugins() {
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PluginEntry | null>(null);

  const { data: plugins, isLoading } = useQuery({ queryKey: ["plugins", "list"], queryFn: api.listPlugins });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["plugins", "list"] });

  const toggleMutation = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) => api.setPluginEnabled(v.id, v.enabled),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deletePlugin(id),
    onSuccess: () => {
      invalidate();
      setActiveId((cur) => (cur === pendingDelete?.id ? null : cur));
    },
  });

  const list = plugins ?? [];
  const active = list.find((p) => p.id === activeId) ?? null;

  return (
    <div className="flex h-full">
      <div className="flex w-64 shrink-0 flex-col border-r border-borderMuted bg-panelAlt">
        <div className="flex items-center justify-between border-b border-borderMuted px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Blocks size={14} className="text-accent-bright" />
            <h2 className="text-xs font-medium text-text">Plugins</h2>
          </div>
          <button
            onClick={() => setImportOpen(true)}
            className="flex h-6 items-center gap-1 rounded-md bg-accent px-2 text-[10px] font-medium text-white hover:bg-accent-bright"
          >
            <Plus size={11} /> Instalar
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
          {isLoading && <p className="px-3 py-4 text-xs text-text-dim">Cargando...</p>}

          {!isLoading && list.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <Blocks size={22} className="text-text-dim" />
              <p className="text-xs text-text-dim">Todavia no instalaste ningun plugin.</p>
            </div>
          )}

          {list.map((plugin) => {
            const isActive = plugin.id === activeId;
            return (
              <div
                key={plugin.id}
                onClick={() => setActiveId(plugin.id)}
                className={cn(
                  "group flex cursor-pointer items-center gap-2 px-3 py-2 text-left",
                  isActive ? "border-r-2 border-accent-bright bg-overlay/[0.04]" : "hover:bg-overlay/[0.03]"
                )}
              >
                <span className={cn("text-base leading-none", !plugin.enabled && "opacity-40")}>{plugin.icon || "🧩"}</span>
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate text-xs", isActive ? "text-text" : "text-text-muted", !plugin.enabled && "opacity-50")}>
                    {plugin.name}
                  </p>
                  <p className="truncate font-mono text-[9px] text-text-dim">v{plugin.version}</p>
                </div>
                <button
                  title={plugin.enabled ? "Desactivar" : "Activar"}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleMutation.mutate({ id: plugin.id, enabled: !plugin.enabled });
                  }}
                  className={cn(
                    "shrink-0 rounded p-1 opacity-0 group-hover:opacity-100",
                    plugin.enabled ? "text-ok hover:bg-ok/10" : "text-text-dim hover:bg-overlay/[0.06]"
                  )}
                >
                  {plugin.enabled ? <PlugZap size={12} /> : <Plug size={12} />}
                </button>
                <button
                  title="Desinstalar"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPendingDelete(plugin);
                  }}
                  className="shrink-0 rounded p-1 text-text-dim opacity-0 hover:bg-accent/10 hover:text-accent-bright group-hover:opacity-100"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })}
        </div>

        <p className="border-t border-borderMuted px-3 py-2.5 text-[10px] leading-relaxed text-text-dim">
          Un plugin es un solo <code>.html</code> autocontenido + <code>plugin.json</code>, aislado en un iframe sin
          acceso a Tauri, al sistema de archivos ni a la red mas alla de lo que el propio navegador permite.
        </p>
      </div>

      <div className="min-h-0 flex-1">
        {!active && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Blocks size={28} className="text-text-dim" />
            <p className="text-sm text-text-muted">
              {list.length === 0 ? "Instala tu primer plugin para empezar." : "Elegi un plugin de la lista."}
            </p>
          </div>
        )}

        {active && !active.enabled && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Plug size={28} className="text-text-dim" />
            <p className="text-sm text-text-muted">"{active.name}" esta desactivado.</p>
            <button
              onClick={() => toggleMutation.mutate({ id: active.id, enabled: true })}
              className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-bright"
            >
              <PlugZap size={13} /> Activar
            </button>
          </div>
        )}

        {active && active.enabled && (
          <div className="flex h-full flex-col">
            <div className="flex shrink-0 items-center gap-2 border-b border-borderMuted bg-panelAlt px-4 py-2">
              <span className="text-sm leading-none">{active.icon || "🧩"}</span>
              <p className="text-xs font-medium text-text">{active.name}</p>
              <span className="rounded bg-overlay/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-text-dim">v{active.version}</span>
              {active.author && <span className="text-[10px] text-text-dim">por {active.author}</span>}
              <button
                onClick={() => api.openPluginFolder(active.id)}
                title="Abrir carpeta"
                className="ml-auto flex h-6 items-center gap-1 rounded-md border border-border px-2 text-[10px] text-text-muted hover:bg-overlay/[0.04]"
              >
                <FolderOpen size={11} /> Abrir carpeta
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <PluginFrame id={active.id} />
            </div>
          </div>
        )}
      </div>

      {importOpen && <PluginImportModal onClose={() => setImportOpen(false)} onImported={invalidate} />}

      {pendingDelete && (
        <ConfirmDialog
          title="Desinstalar plugin"
          message={`¿Desinstalar "${pendingDelete.name}"? Esto borra su copia guardada dentro de KRYPTOS.`}
          confirmLabel="Desinstalar"
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
