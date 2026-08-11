import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { api } from "@/lib/tauri";

/** True for the kind of error strings the Rust side returns when a command hit a Windows/Linux permission wall. */
export function looksLikePermissionError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("administrador") || m.includes("acceso denegado") || m.includes("permiso denegado") || m.includes("sudo");
}

export function RelaunchElevatedButton() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const relaunchMutation = useMutation({ mutationFn: api.relaunchElevated });

  return (
    <>
      <button
        onClick={() => setConfirmOpen(true)}
        className="ml-2 inline-flex items-center gap-1 rounded-md border border-accent-bright/40 px-2 py-0.5 text-[10px] font-medium text-accent-bright hover:bg-accent-bright/10"
      >
        <ShieldAlert size={10} />
        Reiniciar como Administrador
      </button>

      {confirmOpen && (
        <ConfirmDialog
          title="Reiniciar como Administrador"
          message="KRYPTOS se va a cerrar y volver a abrir con permisos elevados. Va a aparecer una ventana de confirmacion de Windows (UAC) — acepta ahi para continuar."
          confirmLabel={relaunchMutation.isPending ? "Reiniciando..." : "Reiniciar"}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => relaunchMutation.mutate()}
        />
      )}
    </>
  );
}
