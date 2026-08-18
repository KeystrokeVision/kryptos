import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Search, Globe2, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { api } from "@/lib/tauri";

export function DnsWhoisPanel() {
  const [domain, setDomain] = useState("");

  const dnsMutation = useMutation({ mutationFn: (d: string) => api.lookupDns(d) });
  const whoisMutation = useMutation({ mutationFn: (d: string) => api.lookupWhois(d) });

  function runLookups() {
    const d = domain.trim();
    if (!d) return;
    dnsMutation.mutate(d);
    whoisMutation.mutate(d);
  }

  return (
    <div className="h-full space-y-4 overflow-y-auto p-5">
      <Card title="DNS y WHOIS">
        <div className="space-y-4">
          <p className="text-xs text-text-dim">
            Reconocimiento pasivo est&aacute;ndar: consulta registros DNS p&uacute;blicos y datos de registro del
            dominio (WHOIS) — la misma informaci&oacute;n que cualquier servidor DNS o registrador entrega a quien la
            pida.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              runLookups();
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
              disabled={!domain.trim() || dnsMutation.isPending || whoisMutation.isPending}
              className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-bright disabled:opacity-40"
            >
              <Search size={13} />
              Buscar
            </button>
          </form>
        </div>
      </Card>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-4">
        <Card title="Registros DNS">
          {dnsMutation.isPending && <p className="text-xs text-text-dim">Consultando...</p>}
          {dnsMutation.isError && (
            <div className="flex items-start gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent-bright">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {String((dnsMutation.error as Error)?.message)}
            </div>
          )}
          {dnsMutation.data && (
            <div className="space-y-1">
              {dnsMutation.data.length === 0 && <p className="text-xs text-text-dim">Sin registros encontrados.</p>}
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

        <Card title="WHOIS">
          {whoisMutation.isPending && <p className="text-xs text-text-dim">Consultando...</p>}
          {whoisMutation.isError && (
            <div className="flex items-start gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent-bright">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {String((whoisMutation.error as Error)?.message)}
            </div>
          )}
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
    </div>
  );
}
