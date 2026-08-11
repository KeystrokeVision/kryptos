import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { FlaskConical, Download, Square, ExternalLink, AlertTriangle, Info } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { api } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { PullProgress } from "@/types/docker";

interface LabImage {
  id: string;
  label: string;
  description: string;
  image: string;
  containerPort: number;
  hostPort: number;
}

// Imagenes intencionalmente vulnerables, mantenidas por sus propios
// proyectos para practicar — el "objetivo" corre en tu propio Docker, en
// localhost. No hay ningun sistema de terceros involucrado en ningun punto.
const LAB_IMAGES: LabImage[] = [
  { id: "juice-shop", label: "OWASP Juice Shop", description: "La app deliberadamente vulnerable mas usada para aprender OWASP Top 10.", image: "bkimminich/juice-shop", containerPort: 3000, hostPort: 3000 },
  { id: "dvwa", label: "DVWA", description: "Damn Vulnerable Web Application — clasico de practica de inyeccion SQL, XSS, etc.", image: "vulnerables/web-dvwa", containerPort: 80, hostPort: 8081 },
  { id: "webgoat", label: "OWASP WebGoat", description: "Lecciones guiadas de OWASP sobre vulnerabilidades web comunes.", image: "webgoat/webgoat", containerPort: 8080, hostPort: 8082 },
  { id: "bwapp", label: "bWAPP", description: "Mas de 100 vulnerabilidades distintas para practicar, una app a la vez.", image: "raesene/bwapp", containerPort: 80, hostPort: 8083 },
];

type LabStatus = "idle" | "pulling" | "starting" | "running" | "error";
interface LabState {
  status: LabStatus;
  containerId?: string;
  message?: string;
}

function containerNameFor(item: LabImage) {
  return `kryptos-lab-${item.id}`;
}

/**
 * Laboratorio de practica: descarga y levanta imagenes de Docker
 * intencionalmente vulnerables con un clic — el objetivo sos vos mismo,
 * en tu propio equipo. Reusa el Docker que ya administra el modulo Docker,
 * solo que orientado a practicar en vez de a operar contenedores propios.
 */
export function LabPanel() {
  const available = useQuery({ queryKey: ["docker", "available", "lab"], queryFn: api.isDockerAvailable });
  const existing = useQuery({
    queryKey: ["docker", "containers", "lab"],
    queryFn: () => api.listContainers(true),
    enabled: available.data === true,
  });

  const [states, setStates] = useState<Record<string, LabState>>({});

  // Al cargar, reflejar contenedores de laboratorio que ya existen de una sesion anterior.
  useEffect(() => {
    if (!existing.data) return;
    setStates((prev) => {
      const next = { ...prev };
      for (const item of LAB_IMAGES) {
        const found = existing.data!.find((c) => c.name === containerNameFor(item));
        if (found && !next[item.id]) {
          next[item.id] = { status: found.state.toLowerCase().includes("running") ? "running" : "idle", containerId: found.id };
        }
      }
      return next;
    });
  }, [existing.data]);

  useEffect(() => {
    const unlisten = listen<PullProgress>("docker://pull-progress", (e) => {
      const item = LAB_IMAGES.find((i) => i.image === e.payload.image);
      if (!item) return;
      setStates((prev) => ({ ...prev, [item.id]: { ...prev[item.id], status: "pulling", message: e.payload.status } }));
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  async function launch(item: LabImage) {
    setStates((prev) => ({ ...prev, [item.id]: { status: "pulling", message: "Iniciando descarga..." } }));
    try {
      await api.pullLabImage(item.image);
      setStates((prev) => ({ ...prev, [item.id]: { status: "starting", message: "Creando contenedor..." } }));
      const id = await api.launchLabContainer(containerNameFor(item), item.image, item.hostPort, item.containerPort);
      setStates((prev) => ({ ...prev, [item.id]: { status: "running", containerId: id } }));
    } catch (e) {
      setStates((prev) => ({ ...prev, [item.id]: { status: "error", message: String((e as Error)?.message ?? e) } }));
    }
  }

  async function stop(item: LabImage) {
    const state = states[item.id];
    if (!state?.containerId) return;
    try {
      await api.stopContainer(state.containerId);
      await api.removeContainer(state.containerId, true);
      setStates((prev) => ({ ...prev, [item.id]: { status: "idle" } }));
    } catch (e) {
      setStates((prev) => ({ ...prev, [item.id]: { ...state, status: "error", message: String((e as Error)?.message ?? e) } }));
    }
  }

  if (available.data === false) {
    return (
      <div className="h-full space-y-4 overflow-y-auto p-5">
        <Card title="Laboratorio de practica">
          <div className="flex items-start gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent-bright">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            Docker no esta disponible. Iniciá Docker Desktop (o el daemon) y volvé a esta pestaña.
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-full space-y-4 overflow-y-auto p-5">
      <Card title="Laboratorio de practica">
        <p className="flex items-start gap-2 text-xs text-text-dim">
          <Info size={13} className="mt-0.5 shrink-0" />
          Apps intencionalmente vulnerables, mantenidas por sus propios proyectos para practicar. Corren en tu Docker
          local — el objetivo sos vos mismo, en <code className="text-text-muted">localhost</code>. Nada de esto toca
          una red externa.
        </p>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {LAB_IMAGES.map((item) => {
          const state = states[item.id] ?? { status: "idle" as LabStatus };
          return (
            <Card key={item.id} title={item.label}>
              <div className="space-y-3">
                <p className="text-xs text-text-muted">{item.description}</p>
                <p className="font-mono text-[10px] text-text-dim">{item.image}</p>

                {state.status === "idle" && (
                  <button
                    onClick={() => launch(item)}
                    className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-bright"
                  >
                    <Download size={13} /> Descargar y lanzar
                  </button>
                )}

                {(state.status === "pulling" || state.status === "starting") && (
                  <div className="flex items-center gap-2 text-xs text-text-dim">
                    <FlaskConical size={13} className="animate-pulse text-accent-bright" />
                    {state.message ?? "Trabajando..."}
                  </div>
                )}

                {state.status === "running" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={`http://localhost:${item.hostPort}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex h-8 items-center gap-1.5 rounded-md border border-ok/40 px-3 text-xs font-medium text-ok hover:bg-ok/10"
                    >
                      <ExternalLink size={13} /> Abrir localhost:{item.hostPort}
                    </a>
                    <button
                      onClick={() => stop(item)}
                      className="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-text-muted hover:bg-white/[0.04]"
                    >
                      <Square size={12} /> Detener y eliminar
                    </button>
                  </div>
                )}

                {state.status === "error" && (
                  <div className="space-y-2">
                    <p className={cn("rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-[11px] text-accent-bright")}>{state.message}</p>
                    <button onClick={() => launch(item)} className="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-text-muted hover:bg-white/[0.04]">
                      Reintentar
                    </button>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
