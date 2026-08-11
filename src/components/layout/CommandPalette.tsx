import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, CornerDownLeft } from "lucide-react";
import { MODULES } from "@/lib/modules";
import { useTabStore } from "@/store/useTabStore";
import { cn } from "@/lib/utils";

/** Simple, dependency-free fuzzy match: every char of the query must appear in order in the target. */
function fuzzyMatch(query: string, target: string): boolean {
  if (!query) return true;
  let qi = 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const openTab = useTabStore((s) => s.openTab);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const results = useMemo(() => {
    return MODULES.filter((m) => fuzzyMatch(query, m.label) || fuzzyMatch(query, m.description)).slice(0, 8);
  }, [query]);

  useEffect(() => setSelected(0), [query]);

  function choose(index: number) {
    const mod = results[index];
    if (!mod) return;
    openTab(mod.id, mod.label);
    setOpen(false);
  }

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[15vh] backdrop-blur-[2px]" onClick={() => setOpen(false)}>
      <div onClick={(e) => e.stopPropagation()} className="w-[520px] max-w-[90vw] overflow-hidden rounded-lg border border-border bg-panel shadow-panel">
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
          <Search size={15} className="shrink-0 text-text-dim" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelected((s) => Math.min(s + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelected((s) => Math.max(s - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(selected);
              }
            }}
            placeholder="Buscar un modulo... (ej. 'ssh', 'firewall', 'docker')"
            className="h-full flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-dim"
          />
          <kbd className="shrink-0 rounded border border-borderMuted px-1.5 py-0.5 text-[10px] text-text-dim">esc</kbd>
        </div>

        <div className="max-h-80 overflow-y-auto p-1.5">
          {results.map((mod, i) => {
            const Icon = mod.icon;
            return (
              <button
                key={mod.id}
                onClick={() => choose(i)}
                onMouseEnter={() => setSelected(i)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left",
                  i === selected ? "bg-accent/10 text-text" : "text-text-muted"
                )}
              >
                <Icon size={15} className={i === selected ? "text-accent-bright" : "text-text-dim"} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs">{mod.label}</p>
                  <p className="truncate text-[10px] text-text-dim">{mod.description}</p>
                </div>
                {i === selected && <CornerDownLeft size={12} className="shrink-0 text-text-dim" />}
              </button>
            );
          })}
          {results.length === 0 && <p className="px-3 py-6 text-center text-xs text-text-dim">Sin resultados.</p>}
        </div>
      </div>
    </div>,
    document.body
  );
}
