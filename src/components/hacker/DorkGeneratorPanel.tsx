import { useMemo, useState } from "react";
import { Search, Copy, Check, Info } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

interface Recipe {
  id: string;
  label: string;
  fragment: string;
  note: string;
}

// "Recetas" de dorks tipicas de auditoria OSINT sobre infraestructura propia:
// que tiene indexado un buscador de tu propio dominio. Son solo strings de
// busqueda — armar la query no toca ningun servidor, la ejecuta el buscador.
const RECIPES: Recipe[] = [
  { id: "login", label: "Paneles de login expuestos", fragment: 'intitle:"login" OR intitle:"iniciar sesion" OR intitle:"sign in"', note: "Detecta si un panel de acceso quedo indexado publicamente." },
  { id: "docs", label: "Documentos expuestos", fragment: "filetype:pdf OR filetype:docx OR filetype:xlsx OR filetype:pptx", note: "Documentos que un buscador ya indexo del sitio." },
  { id: "dirlist", label: "Directorios listables", fragment: 'intitle:"index of"', note: "Carpetas del servidor sin index.html, listando su contenido." },
  { id: "config", label: "Archivos de config expuestos", fragment: "filetype:env OR filetype:yml OR filetype:ini OR filetype:conf", note: "Archivos que nunca deberian ser publicos ni indexables." },
  { id: "admin", label: "Rutas de administracion", fragment: "inurl:admin OR inurl:wp-admin OR inurl:phpmyadmin", note: "Paneles administrativos accesibles desde afuera." },
  { id: "backup", label: "Backups expuestos", fragment: "filetype:sql OR filetype:bak OR filetype:zip OR filetype:tar.gz", note: "Copias de seguridad que terminaron publicas por error." },
];

const inputClass = "h-8 flex-1 rounded-md border border-border bg-base px-2.5 font-mono text-xs text-text outline-none focus:border-accent/60";

/**
 * Genera la sintaxis de "Google dorking" a partir de campos sueltos —
 * pensado para auditar que tiene indexado un buscador de tu propio dominio,
 * no para buscar contra terceros. No ejecuta ninguna busqueda: solo arma el
 * texto, vos decidis si lo pegas en un buscador y donde.
 */
export function DorkGeneratorPanel() {
  const [site, setSite] = useState("");
  const [extra, setExtra] = useState("");
  const [activeRecipes, setActiveRecipes] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  function toggleRecipe(id: string) {
    setActiveRecipes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const query = useMemo(() => {
    const parts: string[] = [];
    if (site.trim()) parts.push(`site:${site.trim()}`);
    RECIPES.filter((r) => activeRecipes.has(r.id)).forEach((r) => parts.push(`(${r.fragment})`));
    if (extra.trim()) parts.push(extra.trim());
    return parts.join(" ");
  }, [site, extra, activeRecipes]);

  return (
    <div className="h-full space-y-4 overflow-y-auto p-5">
      <Card title="Reconocimiento por buscador (dorking)">
        <div className="space-y-4">
          <p className="flex items-start gap-2 text-xs text-text-dim">
            <Info size={13} className="mt-0.5 shrink-0" />
            Pensado para auditar tu propio dominio: que quedo indexado publicamente sin que te dieras cuenta. Solo
            arma el texto de busqueda — no consulta nada, no se conecta a ningun buscador.
          </p>

          <div className="flex items-center gap-2">
            <Search size={13} className="shrink-0 text-text-dim" />
            <input value={site} onChange={(e) => setSite(e.target.value)} placeholder="tudominio.com (opcional, recomendado)" className={inputClass} />
          </div>

          <div>
            <p className="mb-2 text-[10px] uppercase tracking-widest text-text-dim">Recetas</p>
            <div className="flex flex-wrap gap-1.5">
              {RECIPES.map((r) => (
                <button
                  key={r.id}
                  title={r.note}
                  onClick={() => toggleRecipe(r.id)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[11px]",
                    activeRecipes.has(r.id) ? "bg-accent text-white" : "border border-border text-text-muted hover:bg-overlay/[0.04]"
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1 text-[10px] uppercase tracking-widest text-text-dim">Texto adicional</p>
            <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder='ej: intext:"contrasena"' className={inputClass + " w-full"} />
          </div>

          <div className="flex items-center gap-2 border-t border-borderMuted pt-3">
            <span className="min-h-[2.25rem] flex-1 break-all rounded-md border border-border bg-base px-2.5 py-1.5 font-mono text-[11px] text-text">
              {query || "La consulta armada aparece aqui..."}
            </span>
            <button
              onClick={() => {
                if (!query) return;
                navigator.clipboard.writeText(query).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                });
              }}
              disabled={!query}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-text-dim hover:text-text disabled:opacity-30"
              aria-label="Copiar consulta"
            >
              {copied ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}
