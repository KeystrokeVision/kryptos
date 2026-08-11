import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { isPermissionGranted, sendNotification } from "@tauri-apps/plugin-notification";
import { Usb, ShieldAlert, Info } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { api } from "@/lib/tauri";

const POLL_MS = 4000;

interface UsbEvent {
  id: string;
  name: string;
  time: number;
}

/**
 * Defensa basica contra insercion de USB no reconocido (BadUSB, rubber
 * duckies): sondea la lista de dispositivos USB presentes cada pocos
 * segundos mientras esta pestana esta abierta y avisa con una notificacion
 * nativa apenas aparece un ID que no estaba en el sondeo anterior. No
 * reemplaza a un EDR — es una señal temprana simple, del mismo espiritu
 * que el resto de Modo Hacker.
 */
export function UsbMonitorPanel() {
  const [events, setEvents] = useState<UsbEvent[]>([]);
  const knownIds = useRef<Set<string> | null>(null);

  const devices = useQuery({
    queryKey: ["hacker", "usb-monitor"],
    queryFn: api.listUsbDevices,
    refetchInterval: POLL_MS,
  });

  useEffect(() => {
    if (!devices.data) return;
    const currentIds = new Set(devices.data.map((d) => d.instance_id));

    if (knownIds.current === null) {
      // Primer sondeo: establece la linea de base, no dispara alertas por
      // dispositivos que ya estaban conectados antes de abrir el panel.
      knownIds.current = currentIds;
      return;
    }

    const newDevices = devices.data.filter((d) => !knownIds.current!.has(d.instance_id));
    if (newDevices.length > 0) {
      setEvents((prev) => [...newDevices.map((d) => ({ id: d.instance_id, name: d.name, time: Date.now() })), ...prev].slice(0, 50));
      isPermissionGranted().then((granted) => {
        if (!granted) return;
        newDevices.forEach((d) => sendNotification({ title: "KRYPTOS — nuevo dispositivo USB", body: d.name }));
      });
    }
    knownIds.current = currentIds;
  }, [devices.data]);

  return (
    <div className="h-full space-y-4 overflow-y-auto p-5">
      <Card title="Monitor de USB">
        <p className="flex items-start gap-2 text-xs text-text-dim">
          <Info size={13} className="mt-0.5 shrink-0" />
          Revisa cada {POLL_MS / 1000}s si aparecio un dispositivo USB nuevo mientras esta pestana esta abierta. Los
          dispositivos ya conectados al abrir el panel no generan alerta — solo las inserciones nuevas.
        </p>
      </Card>

      <Card title="Dispositivos presentes ahora">
        <div className="space-y-1.5">
          {devices.data?.map((d) => (
            <div key={d.instance_id} className="flex items-center gap-3 rounded-md border border-border bg-base px-2.5 py-1.5 text-[11px]">
              <Usb size={13} className="text-text-dim" />
              <span className="flex-1 truncate text-text">{d.name}</span>
              <span className="text-text-dim">{d.status}</span>
            </div>
          ))}
          {!devices.data && <p className="text-xs text-text-dim">Leyendo dispositivos...</p>}
        </div>
      </Card>

      <Card title="Inserciones detectadas en esta sesion">
        <div className="space-y-1.5">
          {events.length === 0 && <p className="text-xs text-text-dim">Ninguna todavia.</p>}
          {events.map((e, i) => (
            <div key={`${e.id}-${i}`} className="flex items-center gap-2 rounded-md border border-warn/30 bg-warn/5 px-2.5 py-1.5 text-[11px]">
              <ShieldAlert size={12} className="text-warn" />
              <span className="flex-1 truncate text-text">{e.name}</span>
              <span className="text-text-dim">{new Date(e.time).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
