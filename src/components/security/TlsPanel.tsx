import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Lock, ShieldAlert, ShieldCheck, Search } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { api } from "@/lib/tauri";
import { cn } from "@/lib/utils";

export function TlsPanel() {
  const [host, setHost] = useState("");
  const [port, setPort] = useState("443");

  const mutation = useMutation({
    mutationFn: () => api.checkTlsCertificate(host.trim(), port ? Number(port) : undefined),
  });

  const info = mutation.data;
  const expiryTone =
    info && (info.is_expired ? "text-accent-bright" : info.days_until_expiry <= 14 ? "text-warn" : "text-ok");

  return (
    <div className="h-full overflow-y-auto p-5">
      <Card title="Verificador de certificado TLS">
        <div className="space-y-4">
          <p className="text-xs text-text-dim">
            Conecta por TLS a un host y muestra lo que dice su certificado: vencimiento, emisor y dominios cubiertos.
            Util para revisar tus propios servidores antes de que el certificado caduque.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (host.trim()) mutation.mutate();
            }}
            className="flex gap-2"
          >
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="dominio.com"
              className="h-8 flex-1 rounded-md border border-border bg-base px-2.5 font-mono text-xs text-text outline-none focus:border-accent/60"
            />
            <input
              value={port}
              onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
              placeholder="443"
              className="h-8 w-16 rounded-md border border-border bg-base px-2.5 text-center font-mono text-xs text-text outline-none focus:border-accent/60"
            />
            <button
              type="submit"
              disabled={!host.trim() || mutation.isPending}
              className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-bright disabled:opacity-40"
            >
              <Search size={13} />
              {mutation.isPending ? "Conectando..." : "Verificar"}
            </button>
          </form>

          {mutation.isError && (
            <p className="text-xs text-accent-bright">{String((mutation.error as Error)?.message ?? mutation.error)}</p>
          )}

          {info && (
            <div className="rounded-md border border-border bg-base p-4 text-xs">
              <div className="flex items-center gap-2">
                {info.is_expired ? (
                  <ShieldAlert size={16} className="text-accent-bright" />
                ) : (
                  <ShieldCheck size={16} className="text-ok" />
                )}
                <span className="font-mono text-sm text-text">
                  {info.host}:{info.port}
                </span>
                {info.is_self_signed && (
                  <span className="rounded-full border border-warn/40 px-2 py-0.5 text-[10px] text-warn">
                    autofirmado
                  </span>
                )}
              </div>

              <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-x-6 gap-y-2">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-text-dim">Sujeto</p>
                  <p className="break-all font-mono text-text-muted">{info.subject}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-text-dim">Emisor</p>
                  <p className="break-all font-mono text-text-muted">{info.issuer}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-text-dim">Valido desde</p>
                  <p className="font-mono text-text-muted">{info.not_before}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-text-dim">Valido hasta</p>
                  <p className={cn("font-mono", expiryTone)}>{info.not_after}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-text-dim">Vencimiento</p>
                  <p className={cn("font-mono", expiryTone)}>
                    {info.is_expired ? "Expirado" : `${info.days_until_expiry} dia(s) restantes`}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-text-dim">Numero de serie</p>
                  <p className="break-all font-mono text-text-muted">{info.serial_number}</p>
                </div>
              </div>

              {info.subject_alt_names.length > 0 && (
                <div className="mt-3">
                  <p className="text-[10px] uppercase tracking-widest text-text-dim">Nombres alternativos (SAN)</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {info.subject_alt_names.map((san) => (
                      <span key={san} className="rounded-full border border-borderMuted px-2 py-0.5 font-mono text-[10px] text-text-muted">
                        <Lock size={9} className="mr-1 inline" />
                        {san}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
