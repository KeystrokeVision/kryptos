import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Search, Download, CheckCircle2, AlertTriangle, Store, ExternalLink } from "lucide-react";
import { api } from "@/lib/tauri";
import type { WingetPackage } from "@/types/winget";

export function WingetStore() {
  const [query, setQuery] = useState("");
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
  const [installError, setInstallError] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);

  const availableQuery = useQuery({ queryKey: ["winget", "available"], queryFn: api.isWingetAvailable });

  const searchMutation = useMutation({
    mutationFn: (q: string) => api.searchWingetPackages(q),
  });

  async function handleInstall(pkg: WingetPackage) {
    setInstallError(null);
    setInstallingId(pkg.id);
    try {
      await api.installWingetPackage(pkg.id);
      setInstalledIds((prev) => new Set(prev).add(pkg.id));
    } catch (e) {
      setInstallError(String((e as Error)?.message ?? e));
    } finally {
      setInstallingId(null);
    }
  }

  if (availableQuery.data === false) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-text-dim">
        <Store size={28} />
        <p className="max-w-sm text-xs">
          No se encontro <span className="font-mono">winget</span> (Windows Package Manager) en este equipo. Viene
          preinstalado en Windows 10/11 actualizados; si falta, se instala como "App Installer" desde la Microsoft
          Store.
        </p>
        <a
          href="https://apps.microsoft.com/detail/9nblggh4nns1"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-xs text-accent-bright hover:underline"
        >
          Abrir en la Microsoft Store <ExternalLink size={11} />
        </a>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-borderMuted bg-panelAlt p-4">
        <p className="mb-3 text-xs text-text-dim">
          Busca e instala software real desde el repositorio oficial de Microsoft — el mismo que usa "Instalar
          aplicaciones" en la Configuracion de Windows. KRYPTOS no aloja ni verifica nada aqui, solo es una ventana a
          winget.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (query.trim()) searchMutation.mutate(query.trim());
          }}
          className="flex gap-2"
        >
          <div className="flex h-9 flex-1 items-center gap-2 rounded-md border border-border bg-base px-3">
            <Search size={13} className="text-text-dim" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar software (ej. 'vscode', 'chrome', '7zip')..."
              className="h-full flex-1 bg-transparent text-xs text-text outline-none placeholder:text-text-dim"
            />
          </div>
          <button
            type="submit"
            disabled={!query.trim() || searchMutation.isPending}
            className="flex h-9 items-center gap-1.5 rounded-md bg-accent px-4 text-xs font-medium text-white hover:bg-accent-bright disabled:opacity-40"
          >
            {searchMutation.isPending ? "Buscando..." : "Buscar"}
          </button>
        </form>
      </div>

      {installError && (
        <div className="flex items-start gap-2 border-b border-accent/30 bg-accent/10 px-4 py-2 text-xs text-accent-bright">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <pre className="whitespace-pre-wrap font-sans">{installError}</pre>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {searchMutation.isError && <p className="text-xs text-accent-bright">{String((searchMutation.error as Error)?.message)}</p>}

        {!searchMutation.data && !searchMutation.isPending && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-text-dim">
            <Store size={24} />
            <p className="text-xs">Busca algo para empezar.</p>
          </div>
        )}

        <div className="space-y-1.5">
          {(searchMutation.data ?? []).map((pkg) => {
            const installed = installedIds.has(pkg.id);
            const installing = installingId === pkg.id;
            return (
              <div key={pkg.id} className="flex items-center gap-3 rounded-md border border-border bg-base px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-text">{pkg.name}</p>
                  <p className="truncate font-mono text-[10px] text-text-dim">
                    {pkg.id} · v{pkg.version}
                  </p>
                </div>
                {installed ? (
                  <span className="flex shrink-0 items-center gap-1 text-[11px] text-ok">
                    <CheckCircle2 size={13} /> Instalado
                  </span>
                ) : (
                  <button
                    onClick={() => handleInstall(pkg)}
                    disabled={installing}
                    className="flex shrink-0 items-center gap-1.5 rounded-md border border-accent/50 px-2.5 py-1 text-[11px] text-accent-bright hover:bg-accent/10 disabled:opacity-50"
                  >
                    <Download size={11} />
                    {installing ? "Instalando..." : "Instalar"}
                  </button>
                )}
              </div>
            );
          })}
          {searchMutation.data?.length === 0 && <p className="text-xs text-text-dim">Sin resultados para "{query}".</p>}
        </div>
      </div>
    </div>
  );
}
