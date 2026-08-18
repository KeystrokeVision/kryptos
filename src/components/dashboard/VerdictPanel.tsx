import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldQuestion, ShieldAlert, ShieldCheck, ShieldX, Loader2, ChevronDown, ChevronUp, ArrowRight } from "lucide-react";
import { api } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useTabStore } from "@/store/useTabStore";
import type { SentinelAlert } from "@/types/sentinel";

type Tier = "fresh" | "critical" | "warning" | "clean";

interface EvidenceItem {
  label: string;
  detail: string;
  severity: "critica" | "alta" | "media" | "info";
}

interface Verdict {
  tier: Tier;
  headline: string;
  sub: string;
  evidence: EvidenceItem[];
  checkedAtUnix: number;
}

const TIER_STYLE: Record<Tier, { icon: typeof ShieldCheck; ring: string; bg: string; text: string; label: string }> = {
  fresh: { icon: ShieldQuestion, ring: "border-border", bg: "bg-panelAlt", text: "text-text-dim", label: "Referencia recién establecida" },
  clean: { icon: ShieldCheck, ring: "border-ok/50", bg: "bg-ok/10", text: "text-ok", label: "Todo en orden" },
  warning: { icon: ShieldAlert, ring: "border-warn/50", bg: "bg-warn/10", text: "text-warn", label: "Hay algo para revisar" },
  critical: { icon: ShieldX, ring: "border-accent-bright/60", bg: "bg-accent/10", text: "text-accent-bright", label: "Señales fuertes de compromiso" },
};

const SEVERITY_RANK: Record<EvidenceItem["severity"], number> = { critica: 0, alta: 1, media: 2, info: 3 };

/**
 * "¿Estoy comprometido ahora?" — un único botón que corre, de una,
 * Sentinel (comparación contra la última foto del equipo), la línea base
 * de seguridad del sistema operativo (firewall/AV/BitLocker/UAC) y el
 * estado de los honeytokens, y sintetiza todo en UN veredicto con la
 * evidencia mínima necesaria — no un log de 500 líneas repartido en cuatro
 * pestañas distintas. No agrega detección nueva: la mayoría de las
 * herramientas de seguridad ya recolectan estos mismos datos, lo que falta
 * casi siempre es alguien que los junte y responda la pregunta real.
 */
export function VerdictPanel() {
  const [loading, setLoading] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openTab = useTabStore((s) => s.openTab);

  async function runVerdict() {
    setLoading(true);
    setError(null);
    try {
      const [scan, status, alerts, baseline, honeytokens] = await Promise.all([
        api.sentinelScanNow(),
        api.sentinelStatus(),
        api.sentinelListAlerts(8, true),
        api.runSecurityBaseline(),
        api.honeytokenList().catch(() => []),
      ]);

      const evidence: EvidenceItem[] = [];
      for (const a of alerts as SentinelAlert[]) {
        if (a.severity === "critica" || a.severity === "alta" || a.severity === "media") {
          evidence.push({ label: a.title, detail: a.detail, severity: a.severity });
        }
      }
      for (const c of baseline.checks) {
        if (c.status === "warning") evidence.push({ label: c.name, detail: c.detail, severity: "media" });
      }
      evidence.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

      let tier: Tier;
      if (scan.baseline_established) {
        tier = "fresh";
      } else if (alerts.some((a) => a.severity === "critica")) {
        tier = "critical";
      } else if (alerts.some((a) => a.severity === "alta") || baseline.checks.some((c) => c.status === "warning")) {
        tier = "warning";
      } else {
        tier = "clean";
      }

      const armedTokens = honeytokens.filter((h) => h.armed).length;
      const subParts: string[] = [];
      if (tier === "fresh") {
        subParts.push("Esta es la primera revisión en este equipo — no hay historial todavía contra el cual comparar.");
        subParts.push("Volvé a presionar en unos minutos para un veredicto real basado en cambios.");
      } else {
        subParts.push(`Postura general: ${status.posture_score}/100.`);
        subParts.push(status.unacknowledged_count > 0 ? `${status.unacknowledged_count} alerta(s) de Sentinel sin revisar.` : "Sin alertas de Sentinel pendientes.");
        subParts.push(armedTokens > 0 ? `${armedTokens} honeytoken(s) desplegados y vigilando.` : "Sin honeytokens desplegados — considerá poner uno.");
      }

      const headline =
        tier === "fresh"
          ? "Referencia establecida — todavía no hay nada que comparar"
          : tier === "critical"
            ? "Hay señales fuertes de que algo cambió y no fue esperado"
            : tier === "warning"
              ? "No hay señales de intrusión, pero hay puntos débiles"
              : "Sin señales de compromiso ni puntos débiles detectados";

      setVerdict({ tier, headline, sub: subParts.join(" "), evidence: evidence.slice(0, 6), checkedAtUnix: Math.floor(Date.now() / 1000) });
      setExpanded(false);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  const style = verdict ? TIER_STYLE[verdict.tier] : null;
  const Icon = style?.icon ?? ShieldQuestion;

  return (
    <div className={cn("mb-4 overflow-hidden rounded-lg border transition-colors", style ? style.ring : "border-accent/40", style ? style.bg : "bg-[radial-gradient(ellipse_at_top_left,rgba(255,59,59,0.08),transparent_65%)]")}>
      <div className="flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", style ? style.bg : "bg-accent/10")}>
            {loading ? <Loader2 size={18} className="animate-spin text-accent-bright" /> : <Icon size={19} className={style?.text ?? "text-accent-bright"} />}
          </span>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.18em] text-text-dim">¿Estoy comprometido ahora mismo?</p>
            <p className={cn("truncate text-sm font-semibold", verdict ? style?.text : "text-text")}>
              {loading ? "Analizando Sentinel, línea base y honeytokens..." : verdict ? verdict.headline : "Un botón, cinco fuentes, una respuesta clara."}
            </p>
          </div>
        </div>
        <button
          onClick={runVerdict}
          disabled={loading}
          className="flex h-9 shrink-0 items-center gap-2 rounded-md bg-accent px-4 text-xs font-medium text-white hover:bg-accent-bright disabled:opacity-50"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <ShieldQuestion size={13} />}
          {verdict ? "Verificar de nuevo" : "Verificar todo ahora"}
        </button>
      </div>

      {error && <p className="border-t border-accent/30 bg-accent/10 px-4 py-2 text-[11px] text-accent-bright">{error}</p>}

      <AnimatePresence initial={false}>
        {verdict && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="border-t border-borderMuted/60 px-4 py-3">
              <p className="text-xs text-text-muted">{verdict.sub}</p>

              {verdict.evidence.length > 0 && (
                <div className="mt-2.5">
                  <button onClick={() => setExpanded((v) => !v)} className="flex items-center gap-1 text-[10px] text-text-dim hover:text-text">
                    {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                    {expanded ? "Ocultar evidencia" : `Ver evidencia (${verdict.evidence.length})`}
                  </button>
                  {expanded && (
                    <div className="mt-2 space-y-1.5">
                      {verdict.evidence.map((e, i) => (
                        <div key={i} className="flex items-start gap-2 rounded-md border border-borderMuted bg-base px-2.5 py-1.5 text-[11px]">
                          <span
                            className={cn(
                              "mt-0.5 shrink-0 rounded px-1 py-0.5 font-mono text-[9px] uppercase",
                              e.severity === "critica" ? "bg-accent/20 text-accent-bright" : e.severity === "alta" ? "bg-warn/20 text-warn" : "bg-overlay/[0.06] text-text-dim"
                            )}
                          >
                            {e.severity}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-text">{e.label}</p>
                            <p className="truncate text-text-dim">{e.detail}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <button onClick={() => openTab("opscenter", "Centro de Operaciones")} className="mt-2.5 flex items-center gap-1 text-[10px] text-text-dim hover:text-text">
                Ver todo en el Centro de Operaciones <ArrowRight size={10} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
