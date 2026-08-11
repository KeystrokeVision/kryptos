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
 */
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

  return null;
}
