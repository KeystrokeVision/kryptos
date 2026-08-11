import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ShieldCheck, ShieldAlert, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { api } from "@/lib/tauri";

export function ElevationBadge() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: elevated } = useQuery({
    queryKey: ["elevation", "status"],
    queryFn: api.isElevated,
  });

  const relaunchMutation = useMutation({
    mutationFn: api.relaunchElevated,
    onSuccess: () => setConfirmOpen(false),
    onError: (e: Error) => {
      setError(e.message);
      setConfirmOpen(false);
    },
  });

  if (elevated) {
    return (
      <span className="flex items-center gap-1.5 text-ok">
        <ShieldCheck size={12} />
        Administrador
      </span>
    );
  }

  return (
    <>
      <button onClick={() => setConfirmOpen(true)} className="flex items-center gap-1.5 hover:text-text" title="Reiniciar como Administrador">
        <ShieldAlert size={12} />
        Usuario estandar
      </button>

      {error && (
        <span className="flex items-center gap-1 text-accent-bright">
          {error}
          <button onClick={() => setError(null)} className="hover:text-accent-bright/70">
            <X size={10} />
          </button>
        </span>
      )}

      {confirmOpen && (
        <ConfirmDialog
          title="Reiniciar como Administrador"
          message="KRYPTOS se va a cerrar y volver a abrir con permisos elevados. Va a aparecer una ventana de confirmacion de Windows (UAC) — acepta ahi para continuar."
          confirmLabel={relaunchMutation.isPending ? "Reiniciando..." : "Reiniciar"}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            setError(null);
            relaunchMutation.mutate();
          }}
        />
      )}
    </>
  );
}
