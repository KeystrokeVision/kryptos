import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "@/lib/tauri";
import { useFleetStore } from "@/store/useFleetStore";
import type { ChatMessage } from "@/types/chat";

const BROADCAST_INTERVAL_MS = 20_000;
const STALE_AFTER_SECS = 90; // ~4.5 intervalos sin noticias y se considera "desconectado"

interface FleetStatusPayload {
  hostname: string;
  running: boolean;
  postureScore: number | null;
  unacknowledgedCount: number;
  watchedPorts: number;
  watchedPersistence: number;
}

/**
 * Modo Flota: mientras la pestaña de Chat siga abierta (no hace falta que
 * esté a la vista — todas las pestañas quedan montadas), esto difunde el
 * estado de Sentinel de este equipo cada 20s por el mismo canal P2P del
 * chat, y escucha lo que las demás instancias difunden. El Centro de
 * Operaciones lee este store para mostrar la flota completa, no solo esta
 * máquina. No agrega vigilancia nueva — reusa el chat que ya existía y el
 * Sentinel que ya corre.
 */
export function FleetWatcher() {
  useEffect(() => {
    const unlisten = listen<string>("chat://message", (event) => {
      try {
        const msg = JSON.parse(event.payload) as ChatMessage;
        if (msg.kind !== "status") return;
        const payload = JSON.parse(msg.text) as FleetStatusPayload;
        useFleetStore.getState().upsert({
          nick: msg.nick,
          hostname: payload.hostname,
          running: payload.running,
          postureScore: payload.postureScore,
          unacknowledgedCount: payload.unacknowledgedCount,
          watchedPorts: payload.watchedPorts,
          watchedPersistence: payload.watchedPersistence,
          receivedAtUnix: msg.timestampUnix,
        });
      } catch {
        // Un mensaje "status" mal formado no deberia romper el chat ni la flota.
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const tick = setInterval(async () => {
      useFleetStore.getState().prune(Math.floor(Date.now() / 1000) - STALE_AFTER_SECS);
      try {
        const active = await api.chatIsActive();
        if (!active) return;
        const [status, snapshot] = await Promise.all([api.sentinelStatus(), api.getSystemSnapshot()]);
        const payload: FleetStatusPayload = {
          hostname: snapshot.hostname,
          running: status.running,
          postureScore: status.has_baseline ? status.posture_score : null,
          unacknowledgedCount: status.unacknowledged_count,
          watchedPorts: status.watched_ports,
          watchedPersistence: status.watched_persistence,
        };
        await api.chatBroadcastStatus(JSON.stringify(payload));
      } catch {
        // Sin chat activo, o Sentinel/snapshot fallo por un instante — se
        // reintenta solo en el proximo tick, no hace falta hacer ruido.
      }
    }, BROADCAST_INTERVAL_MS);
    return () => clearInterval(tick);
  }, []);

  return null;
}
