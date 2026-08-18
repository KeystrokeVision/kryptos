import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-shell";
import {
  CheckCircle2,
  XCircle,
  ExternalLink,
  Download,
  Play,
  Terminal as TerminalIcon,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Info,
} from "lucide-react";
import { api } from "@/lib/tauri";
import type { ExternalToolStatus, HacktoolRunResult } from "@/types/hacktools";

type RunOutcome = { result: HacktoolRunResult } | { error: string };
type InstallOutcome = { log: string } | { error: string };

/**
 * El arsenal de Modo Hacker: cada herramienta de la lista del backend
 * (src-tauri/src/commands/hacktools.rs) como su propia tarjeta, agrupadas
 * por categoria. KRYPTOS nunca simula nada de esto — cada tarjeta refleja
 * exactamente lo que `list_hacktool_status` encontro al correr el binario
 * real, "Instalar" dispara una instalacion real (winget o pip, la misma
 * ruta que ya usa la Tienda de Aplicaciones) cuando hay una disponible, y
 * el boton de accion hace exactamente lo que dice "Ver comando", ni mas
 * ni menos. Solo cuando no existe un instalador desatendido para Windows
 * (varias de estas son binarios de Linux, o apps que exigen configuracion
 * propia) se muestra un enlace a la fuente oficial en su lugar.
 */
export function ArsenalPanel() {
  const queryClient = useQueryClient();
  const { data: tools, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["hacktools", "status"],
    queryFn: api.listHacktoolStatus,
  });

  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [launchErrors, setLaunchErrors] = useState<Record<string, string>>({});
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, RunOutcome>>({});
  const [expandedCmd, setExpandedCmd] = useState<Record<string, boolean>>({});
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [installOutcomes, setInstallOutcomes] = useState<Record<string, InstallOutcome>>({});

  const grouped = useMemo(() => {
    const map = new Map<string, ExternalToolStatus[]>();
    for (const t of tools ?? []) {
      if (t.action === "dedicated") continue; // nmap ya tiene su propia pestana
      if (!map.has(t.category)) map.set(t.category, []);
      map.get(t.category)!.push(t);
    }
    return Array.from(map.entries());
  }, [tools]);

  async function handleLaunch(tool: ExternalToolStatus) {
    setLaunchingId(tool.id);
    setLaunchErrors((prev) => ({ ...prev, [tool.id]: "" }));
    try {
      await api.launchHacktool(tool.id);
    } catch (e) {
      setLaunchErrors((prev) => ({ ...prev, [tool.id]: String((e as Error)?.message ?? e) }));
    } finally {
      setLaunchingId(null);
    }
  }

  async function handleInstall(tool: ExternalToolStatus) {
    setInstallingId(tool.id);
    setInstallOutcomes((prev) => {
      const next = { ...prev };
      delete next[tool.id];
      return next;
    });
    try {
      const log = tool.winget_id ? await api.installWingetPackage(tool.winget_id) : await api.installHacktoolPip(tool.id);
      setInstallOutcomes((prev) => ({ ...prev, [tool.id]: { log } }));
      await queryClient.invalidateQueries({ queryKey: ["hacktools", "status"] });
    } catch (e) {
      setInstallOutcomes((prev) => ({ ...prev, [tool.id]: { error: String((e as Error)?.message ?? e) } }));
    } finally {
      setInstallingId(null);
    }
  }

  async function handleRun(tool: ExternalToolStatus) {
    setRunning((prev) => ({ ...prev, [tool.id]: true }));
    try {
      const result = await api.runHacktoolScan(tool.id, targets[tool.id]);
      setResults((prev) => ({ ...prev, [tool.id]: { result } }));
    } catch (e) {
      setResults((prev) => ({ ...prev, [tool.id]: { error: String((e as Error)?.message ?? e) } }));
    } finally {
      setRunning((prev) => ({ ...prev, [tool.id]: false }));
    }
  }

  if (isLoading) {
    return <p className="p-5 text-xs text-text-dim">Comprobando herramientas instaladas...</p>;
  }

  return (
    <div className="h-full space-y-6 overflow-y-auto p-5">
      <div className="flex items-start justify-between gap-3 rounded-md border border-accent/30 bg-accent/[0.06] px-3 py-2.5">
        <div className="flex items-start gap-2 text-xs text-text-muted">
          <Info size={13} className="mt-0.5 shrink-0 text-accent-bright" />
          <span>
            "Instalar" dispara una instalacion real con winget o pip (lo mismo que usa la Tienda de Aplicaciones) —
            nunca una copia empaquetada por KRYPTOS. Cuando no hay un instalador desatendido para Windows, el boton
            lleva a la fuente oficial en su lugar. Usalas unicamente sobre sistemas y redes que te pertenecen o donde
            tengas autorizacion explicita.
          </span>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isRefetching}
          className="shrink-0 whitespace-nowrap rounded-md border border-border px-2.5 py-1 text-[11px] text-text-muted hover:bg-overlay/[0.04] disabled:opacity-40"
        >
          {isRefetching ? "Comprobando..." : "Volver a comprobar"}
        </button>
      </div>

      {grouped.map(([category, categoryTools]) => (
        <section key={category}>
          <h3 className="mb-2.5 text-[11px] font-medium uppercase tracking-widest text-text-dim">{category}</h3>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-3">
            {categoryTools.map((tool) => {
              const outcome = results[tool.id];
              const showTargetInput = tool.action === "run_target";
              const showRunButton = tool.action === "run_target" || tool.action === "run_local";
              const showLaunchButton = tool.action === "launch_bare" || tool.action === "launch_gui" || tool.action === "open_url";
              const launchLabel = tool.action === "open_url" ? "Abrir panel" : tool.action === "launch_gui" ? "Abrir" : "Lanzar";

              return (
                <div key={tool.id} className="flex flex-col rounded-lg border border-border bg-panel p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-medium text-text">{tool.name}</p>
                    {tool.installed ? (
                      <span className="flex shrink-0 items-center gap-1 rounded-full border border-ok/40 bg-ok/10 px-2 py-0.5 text-[9px] uppercase tracking-wide text-ok">
                        <CheckCircle2 size={10} /> Detectada
                      </span>
                    ) : (
                      <span className="flex shrink-0 items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[9px] uppercase tracking-wide text-accent-bright">
                        <XCircle size={10} /> No instalada
                      </span>
                    )}
                  </div>

                  <p className="mt-1.5 text-[11px] leading-relaxed text-text-dim">{tool.description}</p>
                  {tool.detail && <p className="mt-1 truncate font-mono text-[10px] text-text-muted" title={tool.detail}>{tool.detail}</p>}

                  <button
                    onClick={() => setExpandedCmd((prev) => ({ ...prev, [tool.id]: !prev[tool.id] }))}
                    className="mt-2 flex items-center gap-1 text-[10px] text-text-dim hover:text-text-muted"
                  >
                    {expandedCmd[tool.id] ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                    Ver comando
                  </button>
                  {expandedCmd[tool.id] && (
                    <pre className="mt-1 overflow-x-auto rounded border border-borderMuted bg-base px-2 py-1 font-mono text-[10px] text-text-muted">
                      {tool.command_preview}
                    </pre>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {tool.installed && showLaunchButton && (
                      <button
                        onClick={() => handleLaunch(tool)}
                        disabled={launchingId === tool.id}
                        className="flex h-7 items-center gap-1.5 rounded-md bg-accent px-2.5 text-[11px] font-medium text-white hover:bg-accent-bright disabled:opacity-40"
                      >
                        <Play size={11} />
                        {launchingId === tool.id ? "Abriendo..." : launchLabel}
                      </button>
                    )}
                    {!tool.installed && (tool.winget_id || tool.pip_installable) && (
                      <button
                        onClick={() => handleInstall(tool)}
                        disabled={installingId === tool.id}
                        className="flex h-7 items-center gap-1.5 rounded-md bg-accent px-2.5 text-[11px] font-medium text-white hover:bg-accent-bright disabled:opacity-40"
                      >
                        <Download size={11} className={installingId === tool.id ? "animate-pulse" : ""} />
                        {installingId === tool.id ? "Instalando..." : `Instalar (${tool.winget_id ? "winget" : "pip"})`}
                      </button>
                    )}
                    {!tool.installed && !tool.winget_id && !tool.pip_installable && (
                      <button
                        onClick={() => open(tool.docs_url)}
                        className="flex h-7 items-center gap-1.5 rounded-md bg-accent px-2.5 text-[11px] font-medium text-white hover:bg-accent-bright"
                      >
                        <ExternalLink size={11} /> Descargar (sin instalador automatico)
                      </button>
                    )}
                    {tool.installed && (
                      <button
                        onClick={() => open(tool.docs_url)}
                        className="flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-[11px] text-text-muted hover:bg-overlay/[0.04]"
                      >
                        <TerminalIcon size={11} /> Documentacion
                      </button>
                    )}
                  </div>

                  {showTargetInput && tool.installed && (
                    <div className="mt-2 flex gap-1.5">
                      <input
                        value={targets[tool.id] ?? ""}
                        onChange={(e) => setTargets((prev) => ({ ...prev, [tool.id]: e.target.value }))}
                        placeholder="objetivo (dominio, URL, host o carpeta)"
                        className="h-7 flex-1 rounded-md border border-border bg-base px-2 font-mono text-[10px] text-text outline-none focus:border-accent/60"
                      />
                    </div>
                  )}

                  {showRunButton && tool.installed && (
                    <button
                      onClick={() => handleRun(tool)}
                      disabled={running[tool.id] || (showTargetInput && !(targets[tool.id] ?? "").trim())}
                      className="mt-1.5 flex h-7 items-center justify-center gap-1.5 rounded-md border border-accent/50 px-2.5 text-[11px] font-medium text-accent-bright hover:bg-accent/10 disabled:opacity-40"
                    >
                      <Play size={11} className={running[tool.id] ? "animate-spin" : ""} />
                      {running[tool.id] ? "Ejecutando..." : "Ejecutar"}
                    </button>
                  )}

                  {installOutcomes[tool.id] && "error" in installOutcomes[tool.id] && (
                    <div className="mt-2 flex items-start gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-2 py-1.5 text-[10px] text-accent-bright">
                      <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                      {(installOutcomes[tool.id] as { error: string }).error}
                    </div>
                  )}
                  {installOutcomes[tool.id] && "log" in installOutcomes[tool.id] && (
                    <>
                      <div className="mt-2 flex items-center gap-1.5 rounded-md border border-ok/40 bg-ok/10 px-2 py-1.5 text-[10px] text-ok">
                        <CheckCircle2 size={11} className="shrink-0" />
                        Instalacion completada.
                      </div>
                      <pre className="mt-1 max-h-40 overflow-auto rounded-md border border-border bg-base p-2 font-mono text-[10px] leading-relaxed text-text-muted">
                        {(installOutcomes[tool.id] as { log: string }).log.trim() || "(sin salida)"}
                      </pre>
                    </>
                  )}

                  {launchErrors[tool.id] && (
                    <div className="mt-2 flex items-start gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-2 py-1.5 text-[10px] text-accent-bright">
                      <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                      {launchErrors[tool.id]}
                    </div>
                  )}

                  {outcome && "error" in outcome && (
                    <div className="mt-2 flex items-start gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-2 py-1.5 text-[10px] text-accent-bright">
                      <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                      {outcome.error}
                    </div>
                  )}

                  {outcome && "result" in outcome && (
                    <pre className="mt-2 max-h-56 overflow-auto rounded-md border border-border bg-base p-2 font-mono text-[10px] leading-relaxed text-text-muted">
                      {outcome.result.output.trim() || "(sin salida)"}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
