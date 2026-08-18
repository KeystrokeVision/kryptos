import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { FileSearch, AlertTriangle, Package, ChevronDown, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { api } from "@/lib/tauri";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ImportGroup } from "@/types/binary";

function entropyTone(entropy: number): string {
  if (entropy >= 7.5) return "text-accent-bright";
  if (entropy >= 6.5) return "text-warn";
  return "text-ok";
}

function ImportRow({ group }: { group: ImportGroup }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-border bg-base">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] text-text hover:bg-overlay/[0.03]">
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Package size={12} className="text-text-dim" />
        <span className="flex-1 truncate font-mono">{group.library}</span>
        <span className="text-[10px] text-text-dim">{group.functions.length}{group.truncated ? "+" : ""}</span>
      </button>
      {open && (
        <div className="max-h-40 overflow-y-auto border-t border-borderMuted px-3 py-2">
          {group.functions.map((f, i) => (
            <p key={i} className="truncate font-mono text-[10px] text-text-muted">{f}</p>
          ))}
          {group.truncated && <p className="mt-1 text-[10px] text-text-dim">(lista recortada)</p>}
        </div>
      )}
    </div>
  );
}

/**
 * Analizador estatico de binarios PE/ELF — el punto de partida clasico de
 * ingenieria inversa: arquitectura, secciones con su entropia individual
 * (para detectar packers), y que librerias/funciones importa. Nunca
 * ejecuta el archivo, solo lee sus bytes.
 */
export function BinaryAnalyzerPanel() {
  const [path, setPath] = useState<string | null>(null);
  const mutation = useMutation({ mutationFn: (p: string) => api.analyzeBinary(p) });

  async function pickFile() {
    const selected = await open({ multiple: false });
    if (typeof selected !== "string") return;
    setPath(selected);
    mutation.mutate(selected);
  }

  return (
    <div className="h-full space-y-4 overflow-y-auto p-5">
      <Card title="Analizador de binarios (PE / ELF)">
        <div className="space-y-3">
          <p className="text-xs text-text-dim">
            Elegí un .exe, .dll o binario ELF de Linux — se lee de forma estática, nunca se ejecuta.
          </p>
          <button
            onClick={pickFile}
            disabled={mutation.isPending}
            className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-bright disabled:opacity-40"
          >
            <FileSearch size={13} />
            {mutation.isPending ? "Analizando..." : "Elegir archivo"}
          </button>
          {path && <p className="truncate font-mono text-[10px] text-text-dim">{path}</p>}
          {mutation.isError && (
            <div className="flex items-start gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent-bright">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {String((mutation.error as Error)?.message)}
            </div>
          )}
        </div>
      </Card>

      {mutation.data && (
        <>
          <Card title="Resumen">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-x-4 gap-y-2 text-[11px]">
              <div><p className="text-text-dim">Formato</p><p className="text-text">{mutation.data.format}</p></div>
              <div><p className="text-text-dim">Arquitectura</p><p className="text-text">{mutation.data.architecture} · {mutation.data.is_64_bit ? "64 bits" : "32 bits"}</p></div>
              <div><p className="text-text-dim">Tipo</p><p className="text-text">{mutation.data.is_library ? "Biblioteca (DLL/.so)" : "Ejecutable"}</p></div>
              <div><p className="text-text-dim">Punto de entrada</p><p className="font-mono text-text">{mutation.data.entry_point ?? "—"}</p></div>
              <div><p className="text-text-dim">Compilado</p><p className="text-text">{mutation.data.timestamp_unix ? new Date(mutation.data.timestamp_unix * 1000).toLocaleString() : "—"}</p></div>
              <div><p className="text-text-dim">Entropía del archivo</p><p className={cn("font-mono", entropyTone(mutation.data.file_entropy))}>{mutation.data.file_entropy.toFixed(2)} / 8</p></div>
            </div>
            {mutation.data.warnings.length > 0 && (
              <div className="mt-3 space-y-1.5 border-t border-borderMuted pt-3">
                {mutation.data.warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn/5 px-2.5 py-1.5 text-[11px] text-warn">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {w}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title={`Secciones (${mutation.data.sections.length})`}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <thead className="text-[10px] uppercase tracking-widest text-text-dim">
                  <tr>
                    <th className="py-1 pr-3">Nombre</th>
                    <th className="py-1 pr-3">Tamaño (disco)</th>
                    <th className="py-1 pr-3">Tamaño (memoria)</th>
                    <th className="py-1 pr-3">Entropía</th>
                    <th className="py-1">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {mutation.data.sections.map((s, i) => (
                    <tr key={i} className="border-t border-borderMuted">
                      <td className="py-1.5 pr-3 font-mono text-text">{s.name || "—"}</td>
                      <td className="py-1.5 pr-3 text-text-muted">{formatBytes(s.raw_size)}</td>
                      <td className="py-1.5 pr-3 text-text-muted">{formatBytes(s.virtual_size)}</td>
                      <td className={cn("py-1.5 pr-3 font-mono", entropyTone(s.entropy))}>{s.entropy.toFixed(2)}</td>
                      <td className="py-1.5 font-mono text-text-dim">{s.flags.join(" ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title={`Importaciones (${mutation.data.imports.length} biblioteca${mutation.data.imports.length === 1 ? "" : "s"})`}>
            <div className="space-y-1.5">
              {mutation.data.imports.length === 0 && <p className="text-xs text-text-dim">Sin tabla de importaciones legible.</p>}
              {mutation.data.imports.map((g, i) => (
                <ImportRow key={i} group={g} />
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
