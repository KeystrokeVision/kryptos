import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { MODULES } from "@/lib/modules";
import { useTabStore, type ModuleId } from "@/store/useTabStore";

/**
 * Montado una sola vez en la raiz de la app (ver App.tsx). El menu de la
 * bandeja del sistema (src-tauri/src/tray.rs) no sabe nada de pestanas —
 * solo muestra la ventana y emite "tray://open-module" con el id del
 * modulo. Esto es lo que convierte eso en abrir/enfocar la pestana real,
 * el mismo camino que un clic en la barra lateral.
 */
export function TrayBridge() {
  useEffect(() => {
    const unlisten = listen<string>("tray://open-module", (event) => {
      const moduleId = event.payload as ModuleId;
      const mod = MODULES.find((m) => m.id === moduleId);
      if (!mod) return;
      useTabStore.getState().openTab(mod.id, mod.label);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return null;
}
