import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Radar, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { api } from "@/lib/tauri";
import { cn } from "@/lib/utils";

const SCAN_TYPES = [
  { id: "discovery", label: "Descubrimiento de hosts", hint: "¿Que equipos estan activos en esta red/rango?" },
  { id: "ports", label: "Puertos comunes", hint: "Los 100 puertos mas usados en el objetivo" },
  { id: "version", label: "Servicios y version", hint: "Que servicio y version corre en cada puerto abierto" },
];

export function NetworkScanPanel() {
  const [target, setTarget] = useState("");
  const [scanType, setScanType] = useState("discovery");

  const mutation = useMutation({
    mutationFn: () => api.runAdvancedScan(target.trim(), scanType),
  });

  return (
    <div className="h-full overflow-y-auto p-5">
      <Card title="Escaneo de red avanzado (nmap)">
        <div className="space-y-4">
          <p className="text-xs text-text-dim">
            Usa <span className="font-mono">nmap</span> del sistema (debes tenerlo instalado) para reconocimiento sobre redes
            e infraestructura que administras. Solo incluye descubrimiento, puertos comunes y deteccion de version — sin
            scripts NSE ni tecnicas de evasion.
          </p>

          <div className="flex flex-wrap gap-2">
            {SCAN_TYPES.map((t) => (
              <button
                key={t.id}
                onClick={() => setScanType(t.id)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-left text-[11px] transition-colors",
                  scanType === t.id ? "border-accent/60 bg-accent/10 text-text" : "border-border text-text-muted hover:bg-overlay/[0.03]"
                )}
              >
                <p className="font-medium">{t.label}</p>
                <p className="text-[10px] text-text-dim">{t.hint}</p>
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (target.trim()) mutation.mutate();
            }}
            className="flex gap-2"
          >
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="192.168.1.0/24, 192.168.1.10, midominio.local..."
              className="h-8 flex-1 rounded-md border border-border bg-base px-2.5 font-mono text-xs text-text outline-none focus:border-accent/60"
            />
            <button
              type="submit"
              disabled={!target.trim() || mutation.isPending}
              className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-bright disabled:opacity-40"
            >
              <Radar size={13} className={mutation.isPending ? "animate-spin" : ""} />
              {mutation.isPending ? "Escaneando..." : "Escanear"}
            </button>
          </form>

          {mutation.isError && (
            <div className="flex items-start gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent-bright">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {String((mutation.error as Error)?.message ?? mutation.error)}
            </div>
          )}

          {mutation.data && (
            <pre className="max-h-[50vh] overflow-auto rounded-md border border-border bg-base p-3 font-mono text-[11px] leading-relaxed text-text-muted">
              {mutation.data.output || "(sin salida)"}
            </pre>
          )}
        </div>
      </Card>
    </div>
  );
}
