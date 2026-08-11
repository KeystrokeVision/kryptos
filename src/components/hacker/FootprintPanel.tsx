import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Search, ShieldCheck, ShieldX, Globe2, AlertTriangle, Fingerprint } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { api } from "@/lib/tauri";
import { cn } from "@/lib/utils";

/**
 * "Huella propia": corre DNS, WHOIS y cabeceras de seguridad en un solo
 * disparo y las junta en un reporte — la misma informacion que ya exponen
 * DnsWhoisPanel y SecurityHeadersPanel por separado, pero pensada para
 * responder una sola pregunta: que esta exponiendo mi propio dominio ahora
 * mismo. Reconocimiento pasivo puro: todo lo que se consulta ya es publico.
 */
export function FootprintPanel() {
  const [domain, setDomain] = useState("");

  const dnsMutation = useMutation({ mutationFn: (d: string) => api.lookupDns(d) });
  const whoisMutation = useMutation({ mutationFn: (d: string) => api.lookupWhois(d) });
  const headersMutation = useMutation({ mutationFn: (d: string) => api.checkSecurityHeaders(d) });

  function runAll() {
    const d = domain.trim();
    if (!d) return;
    dnsMutation.mutate(d);
    whoisMutation.mutate(d);
    headersMutation.mutate(d);
  }

  const isPending = dnsMutation.isPending || whoisMutation.isPending || headersMutation.isPending;
  const hasResults = dnsMutation.data || whoisMutation.data || headersMutation.data;
  const missingHeaders = headersMutation.data?.checks.filter((c) => !c.present).length ?? null;

  return (
    <div className="h-full space-y-4 overflow-y-auto p-5">
      <Card title="Reporte de huella propia">
        <div className="space-y-4">
          <p className="flex items-start gap-2 text-xs text-text-dim">
            <Fingerprint size={13} className="mt-0.5 shrink-0" />
            Junta DNS, WHOIS y cabeceras de seguridad de un dominio en un solo reporte — pensado para revisar
            periodicamente que expone tu propia infraestructura al mundo, no la de terceros.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              runAll();
            }}
            className="flex gap-2"
          >
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="midominio.com"
              className="h-8 flex-1 rounded-md border border-border bg-base px-2.5 font-mono text-xs text-text outline-none focus:border-accent/60"
            />
            <button
              type="submit"
              disabled={!domain.trim() || isPending}
              className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-bright disabled:opacity-40"
            >
              <Search size={13} />
              {isPending ? "Consultando..." : "Generar reporte"}
            </button>
          </form>

          {hasResults && (
            <div className="flex flex-wrap gap-4 border-t border-borderMuted pt-3 text-[11px] text-text-muted">
              <span>{dnsMutation.data?.length ?? "—"} registros DNS</span>
              <span>·</span>
              <span>{missingHeaders !== null ? `${missingHeaders} cabecera(s) de seguridad faltante(s)` : "cabeceras: sin datos"}</span>
              <span>·</span>
              <span>{whoisMutation.data ? "WHOIS obtenido" : "WHOIS: sin datos"}</span>
            </div>
          )}
        </div>
      </Card>

      {hasResults && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="Registros DNS">
            {dnsMutation.isError && <ErrorBox err={dnsMutation.error} />}
            {dnsMutation.data && (
              <div className="space-y-1">
                {dnsMutation.data.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-md border border-border bg-base px-2.5 py-1.5 text-[11px]">
                    <span className="w-12 shrink-0 rounded-full border border-borderMuted px-1.5 py-0.5 text-center font-mono text-[10px] text-accent-bright">
                      {r.record_type}
                    </span>
                    <span className="truncate font-mono text-text-muted">{r.value}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Cabeceras de seguridad">
            {headersMutation.isError && <ErrorBox err={headersMutation.error} />}
            {headersMutation.data && (
              <div className="space-y-1.5">
                <p className="text-[10px] text-text-dim">HTTP {headersMutation.data.status_code}</p>
                {headersMutation.data.checks.map((c) => (
                  <div key={c.name} className="flex items-center gap-2 rounded-md border border-border bg-base px-2.5 py-1.5 text-[11px]">
                    {c.present ? <ShieldCheck size={12} className="text-ok" /> : <ShieldX size={12} className="text-accent-bright" />}
                    <span className="font-mono text-text">{c.name}</span>
                    <span className={cn("ml-auto text-[10px]", c.present ? "text-ok" : "text-accent-bright")}>{c.present ? "ok" : "falta"}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="WHOIS" className="lg:col-span-2">
            {whoisMutation.isError && <ErrorBox err={whoisMutation.error} />}
            {whoisMutation.data && (
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-base p-3 font-mono text-[10px] leading-relaxed text-text-muted">
                {whoisMutation.data}
              </pre>
            )}
            {!whoisMutation.data && !whoisMutation.isPending && !whoisMutation.isError && (
              <p className="flex items-center gap-2 text-xs text-text-dim">
                <Globe2 size={12} /> Los resultados apareceran aqui.
              </p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function ErrorBox({ err }: { err: unknown }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent-bright">
      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
      {String((err as Error)?.message ?? err)}
    </div>
  );
}
