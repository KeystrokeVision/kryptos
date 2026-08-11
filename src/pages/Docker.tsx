import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Container,
  RefreshCw,
  Play,
  Square,
  RotateCw,
  Trash2,
  ScrollText,
  AlertTriangle,
  Layers,
  Box,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/tauri";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ContainerInfo, ImageInfo } from "@/types/docker";

function stateTone(state: string) {
  const s = state.toLowerCase();
  if (s.includes("running")) return "text-ok";
  if (s.includes("paused")) return "text-warn";
  return "text-text-dim";
}

export default function Docker() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"containers" | "images">("containers");
  const [showAll, setShowAll] = useState(true);
  const [logsFor, setLogsFor] = useState<ContainerInfo | null>(null);
  const [pendingRemoveContainer, setPendingRemoveContainer] = useState<ContainerInfo | null>(null);
  const [pendingRemoveImage, setPendingRemoveImage] = useState<ImageInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const available = useQuery({ queryKey: ["docker", "available"], queryFn: api.isDockerAvailable });

  const containers = useQuery({
    queryKey: ["docker", "containers", showAll],
    queryFn: () => api.listContainers(showAll),
    enabled: available.data === true && tab === "containers",
  });

  const images = useQuery({
    queryKey: ["docker", "images"],
    queryFn: api.listImages,
    enabled: available.data === true && tab === "images",
  });

  const logs = useQuery({
    queryKey: ["docker", "logs", logsFor?.id],
    queryFn: () => api.getContainerLogs(logsFor!.id, 300),
    enabled: !!logsFor,
  });

  function invalidateContainers() {
    queryClient.invalidateQueries({ queryKey: ["docker", "containers"] });
  }
  function invalidateImages() {
    queryClient.invalidateQueries({ queryKey: ["docker", "images"] });
  }

  const startMutation = useMutation({ mutationFn: (id: string) => api.startContainer(id), onSuccess: invalidateContainers, onError: (e: Error) => setError(e.message) });
  const stopMutation = useMutation({ mutationFn: (id: string) => api.stopContainer(id), onSuccess: invalidateContainers, onError: (e: Error) => setError(e.message) });
  const restartMutation = useMutation({ mutationFn: (id: string) => api.restartContainer(id), onSuccess: invalidateContainers, onError: (e: Error) => setError(e.message) });
  const removeContainerMutation = useMutation({
    mutationFn: (c: ContainerInfo) => api.removeContainer(c.id, true),
    onSuccess: invalidateContainers,
    onError: (e: Error) => setError(e.message),
  });
  const removeImageMutation = useMutation({
    mutationFn: (i: ImageInfo) => api.removeImage(i.id, false),
    onSuccess: invalidateImages,
    onError: (e: Error) => setError(e.message),
  });

  if (available.data === false) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-text-dim">
        <Container size={28} />
        <p className="text-xs">No se pudo conectar a Docker. ¿Esta Docker Desktop o el daemon corriendo?</p>
        <button
          onClick={() => available.refetch()}
          className="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-text-muted hover:bg-white/[0.04]"
        >
          <RefreshCw size={13} className={available.isFetching ? "animate-spin" : ""} /> Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-borderMuted bg-panelAlt px-3">
        <Container size={13} className="text-accent-bright" />
        <div className="flex gap-1">
          <button onClick={() => setTab("containers")} className={cn("flex h-7 items-center gap-1 rounded-md px-2 text-[11px]", tab === "containers" ? "bg-white/[0.06] text-text" : "text-text-dim hover:bg-white/[0.03]")}>
            <Box size={12} /> Contenedores
          </button>
          <button onClick={() => setTab("images")} className={cn("flex h-7 items-center gap-1 rounded-md px-2 text-[11px]", tab === "images" ? "bg-white/[0.06] text-text" : "text-text-dim hover:bg-white/[0.03]")}>
            <Layers size={12} /> Imagenes
          </button>
        </div>

        {tab === "containers" && (
          <label className="ml-2 flex items-center gap-1.5 text-[11px] text-text-muted">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            Mostrar detenidos
          </label>
        )}

        <button
          onClick={() => (tab === "containers" ? containers.refetch() : images.refetch())}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-text-dim hover:bg-white/[0.06] hover:text-text"
          aria-label="Actualizar"
        >
          <RefreshCw size={13} className={(tab === "containers" ? containers.isFetching : images.isFetching) ? "animate-spin" : ""} />
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 border-b border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent-bright">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "containers" ? (
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-panel text-[10px] uppercase tracking-widest text-text-dim">
              <tr>
                <th className="px-3 py-2 font-medium">Nombre</th>
                <th className="px-3 py-2 font-medium">Imagen</th>
                <th className="px-3 py-2 font-medium">Estado</th>
                <th className="px-3 py-2 font-medium">Puertos</th>
                <th className="w-40 px-3 py-2 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {(containers.data ?? []).map((c) => (
                <tr key={c.id} className="group border-t border-borderMuted hover:bg-white/[0.03]">
                  <td className="px-3 py-1.5 text-text">{c.name}</td>
                  <td className="px-3 py-1.5 truncate font-mono text-text-dim">{c.image}</td>
                  <td className={cn("px-3 py-1.5 font-mono", stateTone(c.state))}>{c.status}</td>
                  <td className="px-3 py-1.5 font-mono text-text-dim">{c.ports.join(", ") || "—"}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex gap-1.5">
                      <button onClick={() => startMutation.mutate(c.id)} className="text-text-dim hover:text-ok" aria-label="Iniciar">
                        <Play size={12} />
                      </button>
                      <button onClick={() => stopMutation.mutate(c.id)} className="text-text-dim hover:text-accent-bright" aria-label="Detener">
                        <Square size={12} />
                      </button>
                      <button onClick={() => restartMutation.mutate(c.id)} className="text-text-dim hover:text-warn" aria-label="Reiniciar">
                        <RotateCw size={12} />
                      </button>
                      <button onClick={() => setLogsFor(c)} className="text-text-dim hover:text-text" aria-label="Ver logs">
                        <ScrollText size={12} />
                      </button>
                      <button onClick={() => setPendingRemoveContainer(c)} className="text-text-dim hover:text-accent-bright" aria-label="Eliminar">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {(containers.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-text-dim">
                    Sin contenedores.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-panel text-[10px] uppercase tracking-widest text-text-dim">
              <tr>
                <th className="px-3 py-2 font-medium">Repositorio:Tag</th>
                <th className="px-3 py-2 font-medium">ID</th>
                <th className="px-3 py-2 font-medium">Tamano</th>
                <th className="w-20 px-3 py-2 font-medium">Accion</th>
              </tr>
            </thead>
            <tbody>
              {(images.data ?? []).map((img) => (
                <tr key={img.id} className="group border-t border-borderMuted hover:bg-white/[0.03]">
                  <td className="px-3 py-1.5 text-text">{img.repo_tags.length > 0 ? img.repo_tags.join(", ") : <span className="text-text-dim">&lt;sin etiqueta&gt;</span>}</td>
                  <td className="px-3 py-1.5 font-mono text-text-dim">{img.id}</td>
                  <td className="px-3 py-1.5 font-mono text-text-dim">{formatBytes(img.size_bytes)}</td>
                  <td className="px-3 py-1.5">
                    <button onClick={() => setPendingRemoveImage(img)} className="text-text-dim hover:text-accent-bright" aria-label="Eliminar imagen">
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
              {(images.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-text-dim">
                    Sin imagenes.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {logsFor && (
        <Modal title={`Logs — ${logsFor.name}`} onClose={() => setLogsFor(null)} widthClassName="w-[720px]">
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-base p-3 font-mono text-[10px] leading-relaxed text-text-muted">
            {logs.isLoading ? "Cargando..." : logs.data || "(sin salida)"}
          </pre>
        </Modal>
      )}

      {pendingRemoveContainer && (
        <ConfirmDialog
          title="Eliminar contenedor"
          message={`¿Eliminar el contenedor "${pendingRemoveContainer.name}"? Si esta corriendo, se detendra primero. Esta accion no se puede deshacer.`}
          confirmLabel="Eliminar"
          onCancel={() => setPendingRemoveContainer(null)}
          onConfirm={() => {
            removeContainerMutation.mutate(pendingRemoveContainer);
            setPendingRemoveContainer(null);
          }}
        />
      )}

      {pendingRemoveImage && (
        <ConfirmDialog
          title="Eliminar imagen"
          message={`¿Eliminar la imagen "${pendingRemoveImage.repo_tags[0] ?? pendingRemoveImage.id}"? Esta accion no se puede deshacer.`}
          confirmLabel="Eliminar"
          onCancel={() => setPendingRemoveImage(null)}
          onConfirm={() => {
            removeImageMutation.mutate(pendingRemoveImage);
            setPendingRemoveImage(null);
          }}
        />
      )}
    </div>
  );
}
