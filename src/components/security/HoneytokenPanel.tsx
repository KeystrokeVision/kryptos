import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { Fish, FolderOpen, Trash2, ShieldAlert, CheckCircle2, XCircle } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { api } from "@/lib/tauri";
import type { HoneytokenInfo } from "@/types/honeytoken";

const PRESETS = [
  { label: "Contraseñas del banco", fileName: "contraseñas_banco.txt" },
  { label: "Copia de llaves SSH", fileName: "backup_llaves_ssh.txt" },
  { label: "Cuentas y accesos", fileName: "cuentas_accesos.txt" },
  { label: "Cartera cripto", fileName: "cartera_cripto_wallet.txt" },
];

/**
 * Honeytokens: archivos senuelo que Sentinel vigila. A diferencia de las
 * reglas basadas en diffs (puertos, persistencia), esto no tiene falsos
 * positivos posibles — ningun programa legitimo instalado tiene razon
 * para tocar un archivo que no existia hasta que KRYPTOS lo creo.
 */
export function HoneytokenPanel() {
  const queryClient = useQueryClient();
  const [directory, setDirectory] = useState("");
  const [preset, setPreset] = useState(PRESETS[0]);
  const [customName, setCustomName] = useState("");
  const [deployError, setDeployError] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<HoneytokenInfo | null>(null);

  const { data: tokens, isLoading } = useQuery({ queryKey: ["honeytokens"], queryFn: api.honeytokenList });

  // Los vigilantes viven en memoria del backend y no sobreviven un
  // reinicio de la app — se rearman al abrir este panel para que un
  // honeytoken creado ayer siga protegiendo hoy.
  useEffect(() => {
    api.honeytokenRearmAll().then(() => queryClient.invalidateQueries({ queryKey: ["honeytokens"] }));
  }, []);

  const deployMutation = useMutation({
    mutationFn: () => {
      const fileName = customName.trim() || preset.fileName;
      return api.honeytokenDeploy(preset.label, directory.trim(), fileName);
    },
    onSuccess: () => {
      setDeployError(null);
      setCustomName("");
      queryClient.invalidateQueries({ queryKey: ["honeytokens"] });
    },
    onError: (e: Error) => setDeployError(e.message),
  });

  const removeMutation = useMutation({
    mutationFn: (id: number) => api.honeytokenRemove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["honeytokens"] }),
  });

  async function pickFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") setDirectory(selected);
  }

  return (
    <div className="h-full overflow-y-auto p-5">
      <Card title="Honeytokens — archivos señuelo">
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-text-dim">
            Crea un archivo con nombre tentador en una carpeta donde alguien explorando el equipo lo encontraria.
            Ningun programa instalado tiene razon para abrirlo, editarlo o moverlo jamas — si algo lo toca, Sentinel
            genera una alerta critica al instante, con confianza casi total de que no es un falso positivo.
          </p>

          <div className="space-y-2 rounded-md border border-border bg-base p-3">
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.fileName}
                  onClick={() => setPreset(p)}
                  className={`rounded px-2 py-1 text-[11px] transition-colors ${
                    preset.fileName === p.fileName ? "bg-accent text-white" : "border border-border text-text-muted hover:bg-white/[0.04]"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <input
                value={directory}
                onChange={(e) => setDirectory(e.target.value)}
                placeholder="Carpeta donde desplegarlo (ej. Escritorio)..."
                className="h-8 flex-1 rounded-md border border-border bg-panel px-2.5 font-mono text-xs text-text outline-none focus:border-accent/60"
              />
              <button
                onClick={pickFolder}
                className="flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-text-muted hover:bg-white/[0.04]"
              >
                <FolderOpen size={13} />
              </button>
            </div>

            <input
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder={`Nombre del archivo (por defecto: ${preset.fileName})`}
              className="h-8 w-full rounded-md border border-border bg-panel px-2.5 font-mono text-xs text-text outline-none focus:border-accent/60"
            />

            <button
              onClick={() => deployMutation.mutate()}
              disabled={!directory.trim() || deployMutation.isPending}
              className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-accent text-xs font-medium text-white hover:bg-accent-bright disabled:opacity-40"
            >
              <Fish size={13} /> Desplegar honeytoken
            </button>
          </div>

          {deployError && <p className="text-xs text-accent-bright">{deployError}</p>}

          <div className="space-y-1.5">
            <p className="text-[10px] uppercase tracking-widest text-text-dim">Honeytokens activos ({tokens?.length ?? 0})</p>
            {!isLoading && (tokens ?? []).length === 0 && (
              <div className="flex flex-col items-center py-8 text-center text-text-dim">
                <Fish size={24} className="mb-2" />
                <p className="text-xs">Ningun honeytoken desplegado todavia.</p>
              </div>
            )}
            {(tokens ?? []).map((t) => (
              <div key={t.id} className="flex items-center gap-2.5 rounded-md border border-border bg-base p-2.5 text-[11px]">
                {t.armed ? (
                  <CheckCircle2 size={13} className="shrink-0 text-ok" aria-label="Vigilando" />
                ) : (
                  <XCircle size={13} className="shrink-0 text-warn" aria-label="No armado" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-text">{t.label}</p>
                  <p className="truncate font-mono text-[10px] text-text-dim">{t.path}</p>
                </div>
                <button onClick={() => setPendingRemove(t)} className="shrink-0 text-text-dim hover:text-accent-bright">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>

          <p className="flex items-start gap-2 rounded-md border border-borderMuted bg-base px-2.5 py-2 text-[10px] text-text-dim">
            <ShieldAlert size={12} className="mt-0.5 shrink-0" />
            Las alertas de honeytokens aparecen en la linea de tiempo de Sentinel, no aqui — este panel solo
            administra donde estan desplegados.
          </p>
        </div>
      </Card>

      {pendingRemove && (
        <ConfirmDialog
          title="Quitar honeytoken"
          message={`Se detiene la vigilancia y se borra el archivo "${pendingRemove.path}". Esta accion no se puede deshacer.`}
          confirmLabel="Quitar"
          onCancel={() => setPendingRemove(null)}
          onConfirm={() => {
            removeMutation.mutate(pendingRemove.id);
            setPendingRemove(null);
          }}
        />
      )}
    </div>
  );
}
