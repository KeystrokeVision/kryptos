import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Search, ExternalLink, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { api } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { CveResult } from "@/types/security";

const SEVERITY_TONE: Record<string, string> = {
  CRITICAL: "text-accent-bright border-accent/50",
  HIGH: "text-accent-bright border-accent/40",
  MEDIUM: "text-warn border-warn/40",
  LOW: "text-ok border-ok/40",
};

function CveCard({ cve }: { cve: CveResult }) {
  const tone = cve.cvss_severity ? SEVERITY_TONE[cve.cvss_severity] ?? "text-text-muted border-border" : "text-text-muted border-border";
  return (
    <div className="rounded-md border border-border bg-base p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <a
          href={`https://nvd.nist.gov/vuln/detail/${cve.id}`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 font-mono text-sm text-text hover:text-accent-bright"
        >
          {cve.id}
          <ExternalLink size={11} />
        </a>
        {cve.cvss_severity && (
          <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium", tone)}>
            {cve.cvss_severity}
            {cve.cvss_score !== null && ` · ${cve.cvss_score.toFixed(1)}`}
          </span>
        )}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-text-muted">{cve.description}</p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-text-dim">
        {cve.published && <span>Publicado: {new Date(cve.published).toLocaleDateString()}</span>}
        {cve.vuln_status && <span>Estado: {cve.vuln_status}</span>}
        {cve.cvss_vector && <span className="font-mono">{cve.cvss_vector}</span>}
      </div>
    </div>
  );
}

export function CvePanel() {
  const [query, setQuery] = useState("");

  const mutation = useMutation({
    mutationFn: (q: string) => api.searchCve(q),
  });

  return (
    <div className="h-full overflow-y-auto p-5">
      <Card title="Consulta de vulnerabilidades (CVE)">
        <div className="space-y-4">
          <p className="text-xs text-text-dim">
            Busca en la base publica de la NVD (NIST) por ID de CVE (ej. <span className="font-mono">CVE-2021-44228</span>) o por
            palabra clave de producto (ej. <span className="font-mono">apache log4j</span>). Es solo informativo — te dice que
            existe y que tan grave es, no como explotarlo.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (query.trim()) mutation.mutate(query.trim());
            }}
            className="flex gap-2"
          >
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="CVE-2021-44228 o 'apache log4j'..."
              className="h-8 flex-1 rounded-md border border-border bg-base px-2.5 font-mono text-xs text-text outline-none focus:border-accent/60"
            />
            <button
              type="submit"
              disabled={!query.trim() || mutation.isPending}
              className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-bright disabled:opacity-40"
            >
              <Search size={13} />
              {mutation.isPending ? "Buscando..." : "Buscar"}
            </button>
          </form>

          {mutation.isError && (
            <div className="flex items-start gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent-bright">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {String((mutation.error as Error)?.message ?? mutation.error)}
            </div>
          )}

          {mutation.data && (
            <div className="space-y-2">
              <p className="text-[11px] text-text-dim">
                {mutation.data.total_results} resultado(s) en total — mostrando {mutation.data.results.length}.
              </p>
              {mutation.data.results.length === 0 && (
                <p className="text-xs text-text-dim">No se encontraron coincidencias.</p>
              )}
              {mutation.data.results.map((cve) => (
                <CveCard key={cve.id} cve={cve} />
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
