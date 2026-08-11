import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert, ShieldCheck, ExternalLink, Square, PlayCircle, Info, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { api } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { CveResult } from "@/types/security";

// La NVD limita a un puñado de requests sin API key cada 30s — 7s entre
// consultas se queda comodo por debajo de eso, a costa de que escanear
// muchos programas tarde un rato. Es el mismo trade-off que ya asume
// search_cve para uso manual, aca aplicado en secuencia.
const DELAY_MS = 7000;

type AppResult = { name: string; status: "ok" | "vulnerable" | "error"; cves: CveResult[]; error?: string };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SEVERITY_TONE: Record<string, string> = {
  CRITICAL: "text-accent-bright border-accent/50",
  HIGH: "text-accent-bright border-accent/40",
  MEDIUM: "text-warn border-warn/40",
  LOW: "text-ok border-ok/40",
};

/**
 * Cruza tu lista de programas instalados contra la NVD, uno por uno — en
 * vez de que vos busques CVE por CVE a mano en el panel de Seguridad, esto
 * te dice de una "estos 3 programas tienen vulnerabilidades conocidas".
 * Reusa el mismo comando `search_cve` que ya existe, solo que en secuencia
 * y con las pausas necesarias para no pisar el limite de tasa de la NVD.
 */
export function VulnScanPanel() {
  const apps = useQuery({ queryKey: ["hacker", "vulnscan", "apps"], queryFn: api.listInstalledApplications });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null);
  const [results, setResults] = useState<AppResult[]>([]);
  const cancelRef = useRef(false);

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function runScan() {
    const targets = [...selected];
    if (targets.length === 0) return;
    cancelRef.current = false;
    setScanning(true);
    setResults([]);

    for (let i = 0; i < targets.length; i++) {
      if (cancelRef.current) break;
      const name = targets[i];
      setProgress({ done: i, total: targets.length, current: name });
      try {
        const res = await api.searchCve(name);
        setResults((prev) => [...prev, { name, status: res.results.length > 0 ? "vulnerable" : "ok", cves: res.results.slice(0, 3) }]);
      } catch (e) {
        setResults((prev) => [...prev, { name, status: "error", cves: [], error: String((e as Error)?.message ?? e) }]);
      }
      if (i < targets.length - 1 && !cancelRef.current) await sleep(DELAY_MS);
    }
    setProgress(null);
    setScanning(false);
  }

  function cancelScan() {
    cancelRef.current = true;
    setScanning(false);
    setProgress(null);
  }

  const vulnerableCount = results.filter((r) => r.status === "vulnerable").length;

  return (
    <div className="h-full space-y-4 overflow-y-auto p-5">
      <Card title="Escaneo de CVEs sobre software instalado">
        <div className="space-y-3">
          <p className="flex items-start gap-2 text-xs text-text-dim">
            <Info size={13} className="mt-0.5 shrink-0" />
            Elegí qué programas revisar y cruza cada nombre contra la NVD por vos — 7 segundos entre consulta y
            consulta para no pisar su límite de tasa. Es una búsqueda por palabra clave, no por versión exacta: tratalo
            como una primera pasada, no como un veredicto final.
          </p>

          {apps.isLoading && <p className="text-xs text-text-dim">Leyendo programas instalados...</p>}

          {apps.data && (
            <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-md border border-border bg-base p-1.5">
              {apps.data.map((app) => (
                <label key={app.name} className="flex items-center gap-2 rounded px-1.5 py-1 text-[11px] text-text-muted hover:bg-white/[0.03]">
                  <input type="checkbox" checked={selected.has(app.name)} onChange={() => toggle(app.name)} disabled={scanning} />
                  <span className="truncate">{app.name}</span>
                </label>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={runScan}
              disabled={selected.size === 0 || scanning}
              className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-bright disabled:opacity-40"
            >
              <PlayCircle size={13} />
              Escanear {selected.size > 0 ? `(${selected.size})` : ""}
            </button>
            {scanning && (
              <button onClick={cancelScan} className="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-text-muted hover:bg-white/[0.04]">
                <Square size={12} /> Cancelar
              </button>
            )}
            {progress && (
              <span className="flex items-center gap-1.5 text-[11px] text-text-dim">
                <Loader2 size={12} className="animate-spin" />
                {progress.done}/{progress.total} — revisando "{progress.current}"...
              </span>
            )}
          </div>
        </div>
      </Card>

      {results.length > 0 && (
        <Card title={`Resultados — ${vulnerableCount} con CVEs conocidas de ${results.length} revisados`}>
          <div className="space-y-3">
            {results.map((r) => (
              <div key={r.name} className="rounded-md border border-border bg-base p-2.5">
                <div className="flex items-center gap-2">
                  {r.status === "vulnerable" && <ShieldAlert size={13} className="text-accent-bright" />}
                  {r.status === "ok" && <ShieldCheck size={13} className="text-ok" />}
                  {r.status === "error" && <ShieldAlert size={13} className="text-warn" />}
                  <span className="flex-1 truncate text-[11px] text-text">{r.name}</span>
                  <span className={cn("text-[10px]", r.status === "vulnerable" ? "text-accent-bright" : r.status === "ok" ? "text-ok" : "text-warn")}>
                    {r.status === "vulnerable" ? `${r.cves.length}+ CVE(s)` : r.status === "ok" ? "sin coincidencias" : "error"}
                  </span>
                </div>
                {r.status === "error" && <p className="mt-1 text-[10px] text-text-dim">{r.error}</p>}
                {r.cves.length > 0 && (
                  <div className="mt-2 space-y-1.5 border-t border-borderMuted pt-2">
                    {r.cves.map((cve) => (
                      <div key={cve.id} className="flex items-center gap-2 text-[11px]">
                        <a
                          href={`https://nvd.nist.gov/vuln/detail/${cve.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 font-mono text-text hover:text-accent-bright"
                        >
                          {cve.id} <ExternalLink size={10} />
                        </a>
                        {cve.cvss_severity && (
                          <span className={cn("rounded-full border px-1.5 py-0.5 text-[9px]", SEVERITY_TONE[cve.cvss_severity] ?? "text-text-dim border-border")}>
                            {cve.cvss_severity}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
