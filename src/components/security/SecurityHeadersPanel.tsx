import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Search, ShieldCheck, ShieldX, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { api } from "@/lib/tauri";
import { cn } from "@/lib/utils";

export function SecurityHeadersPanel() {
  const [url, setUrl] = useState("");
  const mutation = useMutation({ mutationFn: (u: string) => api.checkSecurityHeaders(u) });

  return (
    <div className="h-full overflow-y-auto p-5">
      <Card title="Cabeceras de seguridad HTTP">
        <div className="space-y-4">
          <p className="text-xs text-text-dim">
            Revisa que cabeceras de seguridad envia un sitio (las mismas que verifica cualquier auditor web) —
            HSTS, CSP, X-Frame-Options y similares. Solo lee lo que el servidor ya publica a cualquier visitante.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (url.trim()) mutation.mutate(url.trim());
            }}
            className="flex gap-2"
          >
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="midominio.com"
              className="h-8 flex-1 rounded-md border border-border bg-base px-2.5 font-mono text-xs text-text outline-none focus:border-accent/60"
            />
            <button
              type="submit"
              disabled={!url.trim() || mutation.isPending}
              className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-bright disabled:opacity-40"
            >
              <Search size={13} />
              {mutation.isPending ? "Consultando..." : "Verificar"}
            </button>
          </form>

          {mutation.isError && (
            <div className="flex items-start gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent-bright">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {String((mutation.error as Error)?.message)}
            </div>
          )}

          {mutation.data && (
            <div className="space-y-2">
              <p className="text-[11px] text-text-dim">
                {mutation.data.url} · HTTP {mutation.data.status_code}
              </p>
              {mutation.data.checks.map((c) => (
                <div key={c.name} className="rounded-md border border-border bg-base p-2.5 text-[11px]">
                  <div className="flex items-center gap-2">
                    {c.present ? <ShieldCheck size={13} className="text-ok" /> : <ShieldX size={13} className="text-accent-bright" />}
                    <span className="font-mono text-text">{c.name}</span>
                    <span className={cn("ml-auto text-[10px]", c.present ? "text-ok" : "text-accent-bright")}>
                      {c.present ? "presente" : "ausente"}
                    </span>
                  </div>
                  {c.value && <p className="mt-1 truncate font-mono text-[10px] text-text-dim">{c.value}</p>}
                  <p className="mt-1 text-text-dim">{c.recommendation}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
