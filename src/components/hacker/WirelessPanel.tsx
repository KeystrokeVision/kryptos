import { useMutation } from "@tanstack/react-query";
import { Wifi, Bluetooth, RefreshCw, AlertTriangle, SignalHigh, SignalMedium, SignalLow } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { api } from "@/lib/tauri";

function SignalIcon({ percent }: { percent: number | null }) {
  if (percent === null) return <SignalLow size={13} className="text-text-dim" />;
  if (percent >= 66) return <SignalHigh size={13} className="text-ok" />;
  if (percent >= 33) return <SignalMedium size={13} className="text-warn" />;
  return <SignalLow size={13} className="text-accent-bright" />;
}

/**
 * Wi-Fi y Bluetooth, ambos de solo lectura: Wi-Fi lee lo que el adaptador ya
 * detecto (netsh wlan show networks), Bluetooth lee lo que Windows ya tiene
 * enumerado via Plug and Play. Ninguno de los dos se conecta ni empareja
 * nada — mismo limite pasivo que el resto de Modo Hacker.
 */
export function WirelessPanel() {
  const wifi = useMutation({ mutationFn: api.listWifiNetworks });
  const bluetooth = useMutation({ mutationFn: api.listBluetoothDevices });

  return (
    <div className="h-full space-y-4 overflow-y-auto p-5">
      <Card
        title="Redes Wi-Fi visibles"
        action={
          <button
            onClick={() => wifi.mutate()}
            disabled={wifi.isPending}
            className="flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-[11px] text-text-muted hover:bg-white/[0.04] disabled:opacity-40"
          >
            <RefreshCw size={12} className={wifi.isPending ? "animate-spin" : ""} /> Escanear
          </button>
        }
      >
        <div className="space-y-2">
          {!wifi.data && !wifi.isPending && !wifi.isError && (
            <p className="flex items-center gap-2 text-xs text-text-dim">
              <Wifi size={13} /> Presiona "Escanear" para ver las redes que tu adaptador detecta ahora mismo.
            </p>
          )}
          {wifi.isError && (
            <div className="flex items-start gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent-bright">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {String((wifi.error as Error)?.message)}
            </div>
          )}
          {wifi.data?.length === 0 && <p className="text-xs text-text-dim">No se detecto ninguna red.</p>}
          {wifi.data?.map((n, i) => (
            <div key={i} className="flex items-center gap-3 rounded-md border border-border bg-base px-2.5 py-1.5 text-[11px]">
              <SignalIcon percent={n.signal_percent} />
              <span className="flex-1 truncate font-mono text-text">{n.ssid || "(SSID oculto)"}</span>
              {n.channel !== null && <span className="text-text-dim">canal {n.channel}</span>}
              {n.authentication && <span className="rounded-full border border-borderMuted px-1.5 py-0.5 text-[10px] text-text-muted">{n.authentication}</span>}
              {n.signal_percent !== null && <span className="w-9 text-right text-text-dim">{n.signal_percent}%</span>}
            </div>
          ))}
        </div>
      </Card>

      <Card
        title="Dispositivos Bluetooth conocidos"
        action={
          <button
            onClick={() => bluetooth.mutate()}
            disabled={bluetooth.isPending}
            className="flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-[11px] text-text-muted hover:bg-white/[0.04] disabled:opacity-40"
          >
            <RefreshCw size={12} className={bluetooth.isPending ? "animate-spin" : ""} /> Actualizar
          </button>
        }
      >
        <div className="space-y-2">
          <p className="text-[10px] text-text-dim">
            Emparejados o presentes ahora mismo segun Windows — no es un escaneo activo de descubrimiento.
          </p>
          {bluetooth.isError && (
            <div className="flex items-start gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent-bright">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {String((bluetooth.error as Error)?.message)}
            </div>
          )}
          {bluetooth.data?.length === 0 && <p className="text-xs text-text-dim">No hay dispositivos Bluetooth presentes.</p>}
          {bluetooth.data?.map((d) => (
            <div key={d.instance_id} className="flex items-center gap-3 rounded-md border border-border bg-base px-2.5 py-1.5 text-[11px]">
              <Bluetooth size={13} className="text-text-dim" />
              <span className="flex-1 truncate text-text">{d.name}</span>
              <span className="text-text-dim">{d.status}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
