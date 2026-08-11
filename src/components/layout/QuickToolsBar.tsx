import { useState } from "react";
import { Radar, Route, ListTree, Network, KeySquare, ScanLine, Loader2 } from "lucide-react";
import { api, type PortCheckResult } from "@/lib/tauri";
import { useTabStore } from "@/store/useTabStore";
import { cn } from "@/lib/utils";

type ToolId = "ping" | "traceroute" | "netstat" | "ipconfig" | "portcheck";

const HOST_TOOLS: ToolId[] = ["ping", "traceroute", "portcheck"];

const TOOLS: { id: ToolId; label: string; icon: typeof Radar }[] = [
  { id: "ping", label: "PING", icon: Radar },
  { id: "traceroute", label: "TRACEROUTE", icon: Route },
  { id: "netstat", label: "NETSTAT", icon: ListTree },
  { id: "ipconfig", label: "IPCONFIG", icon: Network },
  { id: "portcheck", label: "PUERTOS COMUNES", icon: ScanLine },
];

/**
 * Persistent bottom bar with real, legitimate network diagnostics — the
 * same tools a sysadmin already has (ping, traceroute, netstat, ipconfig)
 * plus a fixed common-port reachability check for infrastructure you
 * administer. No offensive/exploitation tooling lives here.
 */
export function QuickToolsBar() {
  const [activeTool, setActiveTool] = useState<ToolId | null>(null);
  const [host, setHost] = useState("");
  const [loading, setLoading] = useState(false);
  const [textOutput, setTextOutput] = useState<string | null>(null);
  const [portResults, setPortResults] = useState<PortCheckResult[] | null>(null);
  const openTab = useTabStore((s) => s.openTab);

  const needsHost = activeTool !== null && HOST_TOOLS.includes(activeTool);

  async function runTool(id: ToolId) {
    setLoading(true);
    setTextOutput(null);
    setPortResults(null);
    try {
      switch (id) {
        case "ping": {
          const r = await api.runPing(host);
          setTextOutput(r.output);
          break;
        }
        case "traceroute": {
          const r = await api.runTraceroute(host);
          setTextOutput(r.output);
          break;
        }
        case "netstat": {
          const r = await api.runNetstat();
          setTextOutput(r.output);
          break;
        }
        case "ipconfig": {
          const r = await api.runIpconfig();
          setTextOutput(r.output);
          break;
        }
        case "portcheck": {
          const r = await api.runPortCheck(host);
          setPortResults(r);
          break;
        }
      }
    } catch (err) {
      setTextOutput(String(err));
    } finally {
      setLoading(false);
    }
  }

  function selectTool(id: ToolId) {
    setActiveTool((current) => (current === id ? null : id));
    setTextOutput(null);
    setPortResults(null);
    if (!HOST_TOOLS.includes(id)) {
      runTool(id);
    }
  }

  return (
    <div className="flex shrink-0 flex-col border-t border-border bg-base">
      <div className="flex items-center gap-1 px-2 py-1.5">
        <span className="mr-1 shrink-0 text-[10px] uppercase tracking-widest text-text-dim">
          Herramientas rapidas
        </span>
        {TOOLS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => selectTool(t.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] transition-colors",
                activeTool === t.id
                  ? "border-accent/50 bg-accent/10 text-accent-bright"
                  : "border-border text-text-muted hover:bg-white/[0.03] hover:text-text"
              )}
            >
              <Icon size={12} />
              {t.label}
            </button>
          );
        })}
        <button
          onClick={() => openTab("ssh", "SSH")}
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] text-text-muted transition-colors hover:bg-white/[0.03] hover:text-text"
        >
          <KeySquare size={12} />
          SSH
        </button>
      </div>

      {activeTool && (
        <div className="border-t border-borderMuted px-3 py-2">
          {needsHost && (
            <div className="mb-2 flex items-center gap-2">
              <input
                autoFocus
                value={host}
                onChange={(e) => setHost(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && activeTool && runTool(activeTool)}
                placeholder="host o IP, ej. 192.168.1.1"
                className="w-64 rounded-md border border-border bg-panel px-2.5 py-1.5 font-mono text-xs text-text placeholder:text-text-dim focus:border-accent/50"
              />
              <button
                onClick={() => activeTool && runTool(activeTool)}
                disabled={loading || !host.trim()}
                className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs text-white transition-colors hover:bg-accent-bright disabled:opacity-40"
              >
                {loading && <Loader2 size={12} className="animate-spin" />}
                Ejecutar
              </button>
            </div>
          )}

          {loading && !needsHost && (
            <p className="flex items-center gap-2 text-xs text-text-dim">
              <Loader2 size={12} className="animate-spin" /> Ejecutando...
            </p>
          )}

          {textOutput !== null && (
            <pre className="max-h-40 overflow-y-auto rounded-md border border-borderMuted bg-panelAlt p-2.5 font-mono text-[11px] leading-relaxed text-text-muted">
              {textOutput || "Sin salida."}
            </pre>
          )}

          {portResults && (
            <div className="grid max-h-40 grid-cols-3 gap-x-4 gap-y-1 overflow-y-auto rounded-md border border-borderMuted bg-panelAlt p-2.5 font-mono text-[11px] sm:grid-cols-5">
              {portResults.map((p) => (
                <span key={p.port} className={cn("flex items-center gap-1.5", p.open ? "text-ok" : "text-text-dim")}>
                  <span className={cn("h-1.5 w-1.5 rounded-full", p.open ? "bg-ok" : "bg-text-dim/40")} />
                  {p.port} {p.service}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
