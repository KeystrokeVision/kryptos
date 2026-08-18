import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { api } from "@/lib/tauri";

/**
 * Renders an installed plugin's entry HTML inside a sandboxed iframe.
 *
 * `sandbox="allow-scripts"` — scripts run, but nothing else: no
 * same-origin (so the plugin can't reach `document.cookie`/localStorage
 * of the app or call `parent.postMessage` into a page it could inspect),
 * no top navigation, no forms, no popups, no pointer lock. Because the
 * content comes from `srcDoc` (a string) rather than a `file://` or
 * `asset://` URL, the frame's origin is `null` — it never gets a real
 * filesystem-backed origin at all. Nothing is injected into it (no
 * `window.__TAURI__` bridge), so a plugin has no path to any Tauri
 * command, the filesystem, or anything else in the app.
 */
export function PluginFrame({ id }: { id: string }) {
  const { data: html, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["plugins", "html", id],
    queryFn: () => api.getPluginHtml(id),
  });

  if (isLoading) {
    return <div className="flex h-full items-center justify-center text-xs text-text-dim">Cargando plugin...</div>;
  }

  if (isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <AlertTriangle size={22} className="text-accent-bright" />
        <p className="max-w-sm text-xs text-text-dim">{String((error as Error)?.message ?? error)}</p>
        <button
          onClick={() => refetch()}
          className="flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-[11px] text-text-muted hover:bg-overlay/[0.04]"
        >
          <RefreshCw size={12} /> Reintentar
        </button>
      </div>
    );
  }

  return (
    <iframe
      key={id}
      title={`plugin-${id}`}
      srcDoc={html}
      sandbox="allow-scripts"
      className="h-full w-full border-0 bg-white"
    />
  );
}
