import { useMemo, useState } from "react";
import { Search, Copy, Check } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import { CHEATSHEET, CHEATSHEET_CATEGORIES, type CheatsheetEntry } from "@/lib/cheatsheetData";

function CopyRow({ entry }: { entry: CheatsheetEntry }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-2 border-b border-borderMuted px-3 py-2.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <code className="block truncate font-mono text-[11px] text-accent-bright">{entry.command}</code>
        <p className="mt-0.5 text-[11px] text-text-muted">{entry.description}</p>
      </div>
      <button
        onClick={() => {
          navigator.clipboard.writeText(entry.command).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1100);
          });
        }}
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-dim hover:bg-overlay/[0.06] hover:text-text"
        aria-label="Copiar comando"
      >
        {copied ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
      </button>
    </div>
  );
}

const CATEGORY_IDS = Object.keys(CHEATSHEET_CATEGORIES) as CheatsheetEntry["category"][];

/**
 * Cheatsheet de comandos Linux/CLI embebido — tipo cheat.sh, pero local y
 * sin red. Referencia de sintaxis real de herramientas reales; no ejecuta
 * nada por si mismo, solo copia al portapapeles.
 */
export function CheatsheetPanel() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CheatsheetEntry["category"] | "todas">("todas");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CHEATSHEET.filter((e) => {
      if (category !== "todas" && e.category !== category) return false;
      if (!q) return true;
      return e.command.toLowerCase().includes(q) || e.description.toLowerCase().includes(q);
    });
  }, [query, category]);

  return (
    <div className="h-full space-y-4 overflow-y-auto p-5">
      <Card title="Cheatsheet de comandos">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Search size={13} className="shrink-0 text-text-dim" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por comando o descripcion..."
              className="h-8 flex-1 rounded-md border border-border bg-base px-2.5 font-mono text-xs text-text outline-none focus:border-accent/60"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setCategory("todas")}
              className={cn("rounded-full px-2.5 py-1 text-[11px]", category === "todas" ? "bg-accent text-white" : "border border-border text-text-muted hover:bg-overlay/[0.04]")}
            >
              Todas
            </button>
            {CATEGORY_IDS.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={cn("rounded-full px-2.5 py-1 text-[11px]", category === c ? "bg-accent text-white" : "border border-border text-text-muted hover:bg-overlay/[0.04]")}
              >
                {CHEATSHEET_CATEGORIES[c]}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card title={`${filtered.length} comando${filtered.length === 1 ? "" : "s"}`}>
        <div className="-m-4">
          {filtered.length === 0 && <p className="p-4 text-xs text-text-dim">Sin resultados.</p>}
          {filtered.map((e) => (
            <CopyRow key={e.id} entry={e} />
          ))}
        </div>
      </Card>
    </div>
  );
}
