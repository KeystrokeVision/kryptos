import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Minus, Square, X, User, Search, Sparkles } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "@/lib/tauri";
import { HackerDemoOverlay } from "@/components/layout/HackerDemoOverlay";

// data-tauri-drag-region lets the user drag the window from this bar,
// standard behavior for a custom Tauri titlebar with decorations disabled.
export function TopBar() {
  const { data: elevated } = useQuery({ queryKey: ["elevation", "status"], queryFn: api.isElevated });
  const [demoOpen, setDemoOpen] = useState(false);

  const appWindow = (() => {
    try {
      return getCurrentWindow();
    } catch {
      return null;
    }
  })();

  return (
    <header
      data-tauri-drag-region
      className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-base px-3"
    >
      <div data-tauri-drag-region className="flex items-center gap-2 text-xs text-text-muted">
        <div className="h-2 w-2 rounded-full bg-ok shadow-[0_0_8px_1px_rgba(0,210,106,0.6)]" />
        <span className="font-mono">KRYPTOS</span>
        <span className="text-text-dim">v0.1.0</span>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => setDemoOpen(true)}
          title="Efecto visual para mostrar — no ejecuta nada real"
          className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1 text-text-dim hover:bg-overlay/[0.04] hover:text-text"
        >
          <Sparkles size={12} />
          <span className="text-[11px]">Modo demo</span>
        </button>

        <button
          onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))}
          className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1 text-text-dim hover:bg-overlay/[0.04] hover:text-text"
        >
          <Search size={12} />
          <span className="text-[11px]">Buscar</span>
          <kbd className="rounded border border-borderMuted px-1 text-[9px]">Ctrl+K</kbd>
        </button>

        <div className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1">
          <User size={13} className="text-text-dim" />
          <span className="text-xs text-text-muted">{elevated ? "ADMIN" : "USUARIO"}</span>
          <span className={`text-[10px] uppercase tracking-wide ${elevated ? "text-accent-bright" : "text-text-dim"}`}>
            {elevated ? "ALTO" : "ESTANDAR"}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            aria-label="Minimizar"
            onClick={() => appWindow?.minimize()}
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-dim hover:bg-overlay/[0.06] hover:text-text"
          >
            <Minus size={14} />
          </button>
          <button
            aria-label="Maximizar"
            onClick={() => appWindow?.toggleMaximize()}
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-dim hover:bg-overlay/[0.06] hover:text-text"
          >
            <Square size={12} />
          </button>
          <button
            aria-label="Cerrar"
            onClick={() => appWindow?.close()}
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-dim hover:bg-accent hover:text-white"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {demoOpen && <HackerDemoOverlay onClose={() => setDemoOpen(false)} />}
    </header>
  );
}
