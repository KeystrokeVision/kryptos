import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Lock, WifiOff, Wifi, AlertTriangle, Siren } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { RelaunchElevatedButton, looksLikePermissionError } from "@/components/layout/RelaunchElevatedButton";
import { api } from "@/lib/tauri";

export function PanicPanel() {
  const [error, setError] = useState<string | null>(null);
  const [confirmIsolate, setConfirmIsolate] = useState(false);
  const [networkIsolated, setNetworkIsolated] = useState(false);

  const lockMutation = useMutation({
    mutationFn: api.panicLockSession,
    onError: (e: Error) => setError(e.message),
  });

  const networkMutation = useMutation({
    mutationFn: (enable: boolean) => api.panicSetNetwork(enable),
    onSuccess: (_data, enable) => {
      setNetworkIsolated(!enable);
      setError(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="h-full overflow-y-auto p-5">
      <Card title="Modo panico">
        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-xs text-text-muted">
            <Siren size={14} className="mt-0.5 shrink-0 text-accent-bright" />
            <p>
              Acciones de respuesta rapida ante un incidente — solo actuan sobre <strong>este equipo</strong>, nunca
              sobre otra maquina o red. Son las mismas dos primeras cosas que hace cualquier equipo de respuesta:
              aislar y bloquear.
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent-bright">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>{error}</span>
              {looksLikePermissionError(error) && <RelaunchElevatedButton />}
            </div>
          )}

          <div className="rounded-md border border-border bg-base p-3">
            <div className="flex items-center gap-2">
              <Lock size={14} className="text-accent-bright" />
              <p className="text-xs text-text">Bloquear sesion</p>
            </div>
            <p className="mt-1 text-[11px] text-text-dim">
              Bloquea el equipo de inmediato, como Win+L. Seguro y reversible con tu contrasena.
            </p>
            <button
              onClick={() => lockMutation.mutate()}
              disabled={lockMutation.isPending}
              className="mt-2 flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-bright disabled:opacity-40"
            >
              <Lock size={13} /> Bloquear ahora
            </button>
          </div>

          <div className="rounded-md border border-border bg-base p-3">
            <div className="flex items-center gap-2">
              {networkIsolated ? <WifiOff size={14} className="text-accent-bright" /> : <Wifi size={14} className="text-text-dim" />}
              <p className="text-xs text-text">Aislar red</p>
            </div>
            <p className="mt-1 text-[11px] text-text-dim">
              Desactiva todos los adaptadores de red de este equipo. Corta internet, red local, y cualquier sesion
              remota (SSH/RDP) hacia este equipo — incluida la tuya si estas conectado remotamente. Requiere
              administrador.
            </p>
            {networkIsolated ? (
              <button
                onClick={() => networkMutation.mutate(true)}
                disabled={networkMutation.isPending}
                className="mt-2 flex h-8 items-center gap-1.5 rounded-md border border-ok/50 px-3 text-xs font-medium text-ok hover:bg-ok/10 disabled:opacity-40"
              >
                <Wifi size={13} /> Reactivar red
              </button>
            ) : (
              <button
                onClick={() => setConfirmIsolate(true)}
                disabled={networkMutation.isPending}
                className="mt-2 flex h-8 items-center gap-1.5 rounded-md border border-accent/50 px-3 text-xs font-medium text-accent-bright hover:bg-accent/10 disabled:opacity-40"
              >
                <WifiOff size={13} /> Aislar red ahora
              </button>
            )}
          </div>
        </div>
      </Card>

      {confirmIsolate && (
        <ConfirmDialog
          title="Aislar red de este equipo"
          message="¿Desactivar todos los adaptadores de red? Si estas conectado remotamente (SSH/RDP), vas a perder la conexion de inmediato y solo vas a poder reactivarla desde este equipo fisicamente."
          confirmLabel="Aislar red"
          onCancel={() => setConfirmIsolate(false)}
          onConfirm={() => {
            networkMutation.mutate(false);
            setConfirmIsolate(false);
          }}
        />
      )}
    </div>
  );
}
