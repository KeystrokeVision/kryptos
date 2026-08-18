import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { isPermissionGranted, sendNotification } from "@tauri-apps/plugin-notification";
import { api } from "@/lib/tauri";
import type { SentinelAlert } from "@/types/sentinel";

const AUTOSTART_SETTING_KEY = "sentinel.autostart_with_app";

/**
 * Montado una sola vez en la raiz de la app (ver App.tsx), no dentro del
 * panel de Seguridad — asi una alerta critica de Sentinel te alcanza con
 * una notificacion nativa mientras estas en la Terminal, en el Editor o en
 * cualquier otro modulo, no solo cuando la pestana de Seguridad esta
 * abierta y a la vista.
 *
 * Tambien arranca la vigilancia sola al iniciar KRYPTOS, pero solo si el
 * usuario prendio el interruptor correspondiente en Configuracion — nada
 * se activa sin permiso, la misma regla que rige el resto de la app.
 *
 * Los honeytokens que ya existian se rearman aca tambien (no solo al abrir
 * su panel): sus vigilantes viven en memoria del backend y no sobreviven
 * un reinicio del proceso, asi que sin esto un honeytoken desplegado ayer
 * dejaria de proteger silenciosamente hasta que alguien abra el panel.
 *
 * Tambien es quien decide cuando el icono de la bandeja del sistema pasa a
 * su estado de alerta (ver src-tauri/src/tray.rs): al instante al recibir
 * una alerta critica/alta, y cada 20s en base al conteo real de alertas sin
 * confirmar de Sentinel — asi el icono se pone al dia solo si las
 * confirmas desde el Centro de Operaciones sin que nadie tenga que volver
 * a abrir la ventana.
 */
const TRAY_ALERT_POLL_MS = 20000;

export function SentinelWatcher() {
  useEffect(() => {
    api.honeytokenRearmAll().catch(() => {});
    api
      .getSetting(AUTOSTART_SETTING_KEY)
      .then((value) => {
        if (value !== "true") return;
        return api.sentinelStatus().then((status) => {
          if (!status.running) return api.sentinelStart();
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const unlisten = listen<SentinelAlert>("sentinel://alert", (event) => {
      const alert = event.payload;
      if (alert.severity !== "critica" && alert.severity !== "alta") return;

      api.setTrayAlertState(true).catch(() => {});

      isPermissionGranted().then((granted) => {
        if (!granted) return;
        sendNotification({
          title: `KRYPTOS Sentinel — ${alert.severity === "critica" ? "Alerta critica" : "Alerta alta"}`,
          body: alert.title,
        });
      });
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    function syncTrayState() {
      api
        .sentinelStatus()
        .then((status) => {
          if (!cancelled) return api.setTrayAlertState(status.running && status.unacknowledged_count > 0);
        })
        .catch(() => {});
    }
    syncTrayState();
    const interval = setInterval(syncTrayState, TRAY_ALERT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return null;
}
