import { useMutation } from "@tanstack/react-query";
import { ShieldCheck, CheckCircle2, AlertTriangle, HelpCircle, RefreshCw, Info } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { api } from "@/lib/tauri";
import { cn } from "@/lib/utils";

const STATUS_ICON = { ok: CheckCircle2, warning: AlertTriangle, unknown: HelpCircle };
const STATUS_TONE = { ok: "text-ok", warning: "text-warn", unknown: "text-text-dim" };

function scoreTone(score: number) {
  if (score >= 80) return "text-ok";
  if (score >= 50) return "text-warn";
  return "text-accent-bright";
}

export function BaselinePanel() {
  const mutation = useMutation({ mutationFn: api.runSecurityBaseline });

  return (
    <div className="h-full overflow-y-auto p-5">
      <Card
        title="Linea base de seguridad"
        action={
          <button onClick={() => mutation.mutate()} className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1 text-[11px] font-medium text-white hover:bg-accent-bright">
            <RefreshCw size={11} className={mutation.isPending ? "animate-spin" : ""} />
            {mutation.data ? "Repetir escaneo" : "Escanear"}
          </button>
        }
      >
        <div className="space-y-4">
          <p className="text-xs text-text-dim">
            Un chequeo rapido del estado general de defensa del equipo — firewall, antivirus, cifrado de disco,
            control de cuentas de usuario. Solo lee el estado actual, no cambia ninguna configuracion.
          </p>

          {!mutation.data && !mutation.isPending && (
            <div className="flex flex-col items-center py-10 text-center text-text-dim">
              <ShieldCheck size={28} className="mb-2" />
              <p className="text-xs">Presiona "Escanear" para revisar el estado de este equipo.</p>
            </div>
          )}

          {mutation.data && (
            <>
              <div className="flex items-center gap-4 rounded-md border border-border bg-base p-4">
                <div className={cn("text-3xl font-bold", scoreTone(mutation.data.score_percent))}>{mutation.data.score_percent}%</div>
                <div className="text-xs text-text-dim">
                  <p>Puntaje basado en los chequeos que se pudieron verificar.</p>
                  {!mutation.data.ran_elevated && (
                    <p className="mt-1 flex items-center gap-1 text-warn">
                      <Info size={11} /> Corriendo sin privilegios de administrador — algunos chequeos pueden salir como
                      "no verificado".
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                {mutation.data.checks.map((c, i) => {
                  const Icon = STATUS_ICON[c.status];
                  return (
                    <div key={i} className="rounded-md border border-border bg-base p-2.5 text-[11px]">
                      <div className="flex items-center gap-2">
                        <Icon size={13} className={cn("shrink-0", STATUS_TONE[c.status])} />
                        <span className="text-text">{c.name}</span>
                      </div>
                      <p className="mt-1 text-text-dim">{c.detail}</p>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
