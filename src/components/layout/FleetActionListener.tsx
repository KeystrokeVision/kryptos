import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ShieldAlert } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { api } from "@/lib/tauri";
import { useFleetStore } from "@/store/useFleetStore";
import type { ChatMessage, FleetActionRequestPayload } from "@/types/chat";

/**
 * Definicion de cada accion que Modo Flota puede pedir de forma remota.
 * Deliberadamente empieza con una sola: aislar la red es reversible,
 * autocontenida (no necesita que el que pide sepa nada del equipo destino,
 * a diferencia de matar un proceso puntual) y reusa un comando ya auditado
 * (panic_set_network, el mismo de Modo Panico). Agregar otra accion es
 * agregar otra entrada aca — el resto del flujo (pedir, confirmar, avisar
 * el resultado) ya queda armado.
 */
const FLEET_ACTIONS: Record<string, { label: string; describe: (fromNick: string) => string; run: () => Promise<void> }> = {
  isolate_network: {
    label: "Aislar red",
    describe: (fromNick) =>
      `"${fromNick}" te pide aislar la red de ESTE equipo (desactivar todos los adaptadores de red) — la misma accion que Modo Panico. ` +
      `Necesita que KRYPTOS este corriendo como Administrador aca; si no, va a fallar y "${fromNick}" va a ver el motivo.`,
    run: () => api.panicSetNetwork(false),
  },
};

interface QueuedRequest extends FleetActionRequestPayload {
  fromNick: string;
}

/**
 * Montado una sola vez en la raiz de la app (ver App.tsx). Escucha pedidos
 * de accion remota (fleet_request_action) dirigidos a ESTE equipo — nunca
 * ejecuta nada sin que el usuario lo confirme aca mismo, en su propia
 * pantalla. El que pidio la accion se entera del resultado por
 * fleet_send_action_result, se haya aprobado o no.
 */
export function FleetActionListener() {
  const [queue, setQueue] = useState<QueuedRequest[]>([]);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const unlisten = listen<string>("chat://message", (event) => {
      try {
        const msg = JSON.parse(event.payload) as ChatMessage;
        if (msg.kind !== "action_request") return;
        const payload = JSON.parse(msg.text) as FleetActionRequestPayload;
        const myNick = useFleetStore.getState().myNick;
        if (!myNick || payload.targetNick !== myNick) return; // no es para mi
        if (!FLEET_ACTIONS[payload.action]) return; // accion desconocida (version vieja/nueva) — se ignora
        setQueue((prev) => (prev.some((r) => r.requestId === payload.requestId) ? prev : [...prev, { ...payload, fromNick: msg.nick }]));
      } catch {
        // Un pedido mal formado no deberia romper el chat ni la flota.
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  if (queue.length === 0) return null;
  const current = queue[0];
  const def = FLEET_ACTIONS[current.action];
  if (!def) {
    setQueue((prev) => prev.slice(1));
    return null;
  }

  async function respond(ok: boolean, message: string) {
    try {
      await api.fleetSendActionResult(current.requestId, current.fromNick, ok, message);
    } catch {
      // El que pidio se va a quedar sin respuesta si esto falla — no hay
      // mucho mas que hacer del lado receptor que ya intentarlo.
    }
    setQueue((prev) => prev.slice(1));
    setRunning(false);
  }

  async function onConfirm() {
    setRunning(true);
    try {
      await def.run();
      await respond(true, "Ejecutado correctamente.");
    } catch (e) {
      await respond(false, String((e as Error)?.message ?? e));
    }
  }

  return (
    <ConfirmDialog
      title={`Pedido remoto: ${def.label}`}
      message={def.describe(current.fromNick)}
      confirmLabel={running ? "Ejecutando..." : "Autorizar"}
      cancelLabel="Rechazar"
      danger
      onConfirm={() => {
        if (!running) onConfirm();
      }}
      onCancel={() => respond(false, "Rechazado por el usuario en el equipo remoto.")}
    />
  );
}

// Reexportado por si otro modulo (ej. el selector de acciones en el Centro
// de Operaciones) necesita mostrar las mismas etiquetas sin duplicarlas.
export { FLEET_ACTIONS };
export const FLEET_ACTION_ICON = ShieldAlert;
