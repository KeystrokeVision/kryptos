import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, Network, CalendarClock, ShieldCheck, History, GitCompare, Plus, Minus, ArrowRightLeft } from "lucide-react";
import { api } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { ReconstructedState } from "@/types/sentinel";

/**
 * Maquina del tiempo: reconstruye el estado del equipo en cualquier
 * momento pasado reproduciendo la propia linea de tiempo de Sentinel
 * desde el principio. No hay snapshots guardados por separado — la lista
 * de eventos que ya existia es toda la memoria que hace falta.
 */
export function TimeMachinePanel() {
  const bounds = useQuery({ queryKey: ["sentinel", "time-bounds"], queryFn: api.sentinelTimeBounds });
  const [asOf, setAsOf] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [displayAsOf, setDisplayAsOf] = useState<number | null>(null);
  const [compareMode, setCompareMode] = useState(false);

  useEffect(() => {
    if (bounds.data?.latest_unix != null && asOf === null) {
      setAsOf(bounds.data.latest_unix);
      setDisplayAsOf(bounds.data.latest_unix);
    }
  }, [bounds.data, asOf]);

  const state = useQuery({
    queryKey: ["sentinel", "state-at", displayAsOf],
    queryFn: () => api.sentinelStateAt(displayAsOf as number),
    enabled: displayAsOf !== null && !compareMode,
  });

  function handleSlide(value: number) {
    setAsOf(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDisplayAsOf(value), 150);
  }

  const earliest = bounds.data?.earliest_unix;
  const latest = bounds.data?.latest_unix;
  const hasRange = earliest != null && latest != null && earliest !== latest;

  const label = useMemo(() => (asOf ? new Date(asOf * 1000).toLocaleString() : "—"), [asOf]);

  if (bounds.data && earliest == null) {
    return (
      <div className="flex flex-col items-center py-10 text-center text-text-dim">
        <Clock size={26} className="mb-2" />
        <p className="max-w-xs text-xs">
          Todavia no hay historial suficiente para reconstruir un momento pasado. Deja a Sentinel corriendo un rato —
          en cuanto registre su primer cambio, esta vista se activa.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs leading-relaxed text-text-dim">
          {compareMode
            ? "Elegi dos momentos y mira exactamente que cambio entre uno y otro — puertos que se abrieron o cerraron, arranques automaticos nuevos, defensas que cambiaron de estado."
            : "Mueve el control para ver el equipo como estaba en ese momento: que puertos estaban abiertos, que arranques automaticos existian, y el estado de las defensas — reconstruido reproduciendo la propia linea de tiempo, sin snapshots guardados aparte."}
        </p>
        <button
          onClick={() => setCompareMode((v) => !v)}
          disabled={!hasRange}
          className={cn(
            "flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[11px] disabled:opacity-40",
            compareMode ? "border-accent bg-accent/10 text-accent-bright" : "border-border text-text-muted hover:bg-overlay/[0.04]"
          )}
        >
          <GitCompare size={12} /> Comparar
        </button>
      </div>

      {!compareMode && (
        <>
          <div className="rounded-md border border-border bg-base p-3">
            <div className="mb-2 flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1.5 text-text">
                <Clock size={12} className="text-accent-bright" /> {label}
              </span>
              {state.data && <span className="text-text-dim">{state.data.events_replayed} eventos reproducidos</span>}
            </div>
            <input
              type="range"
              min={earliest ?? 0}
              max={latest ?? 0}
              value={asOf ?? latest ?? 0}
              disabled={!hasRange}
              onChange={(e) => handleSlide(Number(e.target.value))}
              className="w-full accent-accent-bright disabled:opacity-40"
            />
            <div className="mt-1 flex justify-between text-[9px] text-text-dim">
              <span>{earliest ? new Date(earliest * 1000).toLocaleString() : "—"}</span>
              <span>{latest ? new Date(latest * 1000).toLocaleString() : "—"}</span>
            </div>
          </div>

          {state.data && (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
              <ReconstructedList icon={Network} title="Puertos en escucha" items={state.data.ports} empty="Ninguno en este momento." />
              <ReconstructedList icon={CalendarClock} title="Arranque automatico" items={state.data.persistence} empty="Ninguno registrado aun." />
              <ReconstructedList icon={ShieldCheck} title="Estado de defensas" items={state.data.baseline} empty="Sin cambios registrados." />
            </div>
          )}

          {state.data && (
            <div className="flex items-center gap-2 rounded-md border border-borderMuted bg-base px-2.5 py-2 text-[10px] text-text-dim">
              <History size={12} className="shrink-0" />
              Nivel de seguridad (linea base) en ese momento: {state.data.baseline_score != null ? `${state.data.baseline_score}%` : "sin registro todavia"}
            </div>
          )}
        </>
      )}

      {compareMode && earliest != null && latest != null && <CompareView earliest={earliest} latest={latest} />}
    </div>
  );
}

function CompareView({ earliest, latest }: { earliest: number; latest: number }) {
  const [a, setA] = useState(earliest);
  const [b, setB] = useState(latest);

  const stateA = useQuery({ queryKey: ["sentinel", "state-at", a], queryFn: () => api.sentinelStateAt(a) });
  const stateB = useQuery({ queryKey: ["sentinel", "state-at", b], queryFn: () => api.sentinelStateAt(b) });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
        <TimeSlider label="Instante A" value={a} min={earliest} max={latest} onChange={setA} />
        <TimeSlider label="Instante B" value={b} min={earliest} max={latest} onChange={setB} />
      </div>

      {stateA.data && stateB.data && (
        <>
          <div className="flex items-center gap-2 rounded-md border border-borderMuted bg-base px-2.5 py-2 text-[11px]">
            <History size={12} className="shrink-0 text-text-dim" />
            <span className="text-text-dim">Linea base:</span>
            <span className="text-text">{stateA.data.baseline_score ?? "—"}%</span>
            <ArrowRightLeft size={11} className="text-text-dim" />
            <span className="text-text">{stateB.data.baseline_score ?? "—"}%</span>
            {stateA.data.baseline_score != null && stateB.data.baseline_score != null && stateA.data.baseline_score !== stateB.data.baseline_score && (
              <span className={stateB.data.baseline_score > stateA.data.baseline_score ? "text-ok" : "text-accent-bright"}>
                ({stateB.data.baseline_score > stateA.data.baseline_score ? "+" : ""}
                {stateB.data.baseline_score - stateA.data.baseline_score})
              </span>
            )}
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
            <DiffList icon={Network} title="Puertos" itemsA={stateA.data.ports} itemsB={stateB.data.ports} />
            <DiffList icon={CalendarClock} title="Arranque automatico" itemsA={stateA.data.persistence} itemsB={stateB.data.persistence} />
            <DiffList icon={ShieldCheck} title="Defensas" itemsA={stateA.data.baseline} itemsB={stateB.data.baseline} />
          </div>
        </>
      )}
    </div>
  );
}

function TimeSlider({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const [display, setDisplay] = useState(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handle(v: number) {
    setDisplay(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onChange(v), 150);
  }

  return (
    <div className="rounded-md border border-border bg-base p-3">
      <div className="mb-2 flex items-center justify-between text-[11px]">
        <span className="text-text-dim">{label}</span>
        <span className="text-text">{new Date(display * 1000).toLocaleString()}</span>
      </div>
      <input type="range" min={min} max={max} value={display} onChange={(e) => handle(Number(e.target.value))} className="w-full accent-accent-bright" />
    </div>
  );
}

type DiffKind = "added" | "removed" | "changed";

function diffItems(itemsA: { key: string; value: string }[], itemsB: { key: string; value: string }[]) {
  const mapA = new Map(itemsA.map((i) => [i.key, i.value]));
  const mapB = new Map(itemsB.map((i) => [i.key, i.value]));
  const keys = new Set([...mapA.keys(), ...mapB.keys()]);
  const diffs: { key: string; kind: DiffKind; from?: string; to?: string }[] = [];
  for (const key of keys) {
    const va = mapA.get(key);
    const vb = mapB.get(key);
    if (va === undefined && vb !== undefined) diffs.push({ key, kind: "added", to: vb });
    else if (va !== undefined && vb === undefined) diffs.push({ key, kind: "removed", from: va });
    else if (va !== vb) diffs.push({ key, kind: "changed", from: va, to: vb });
  }
  return diffs;
}

function DiffList({
  icon: Icon,
  title,
  itemsA,
  itemsB,
}: {
  icon: typeof Network;
  title: string;
  itemsA: { key: string; value: string }[];
  itemsB: { key: string; value: string }[];
}) {
  const diffs = useMemo(() => diffItems(itemsA, itemsB), [itemsA, itemsB]);
  return (
    <div className="rounded-md border border-border bg-base p-2.5">
      <p className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-text-dim">
        <Icon size={11} /> {title} ({diffs.length} cambio{diffs.length === 1 ? "" : "s"})
      </p>
      {diffs.length === 0 && <p className="text-[11px] text-text-dim">Sin cambios entre A y B.</p>}
      <div className="max-h-48 space-y-1 overflow-y-auto">
        {diffs.map((d) => (
          <div key={d.key} className="rounded border border-borderMuted px-1.5 py-1 font-mono text-[10px]">
            <div className="flex items-center gap-1.5">
              {d.kind === "added" && <Plus size={10} className="shrink-0 text-ok" />}
              {d.kind === "removed" && <Minus size={10} className="shrink-0 text-accent-bright" />}
              {d.kind === "changed" && <ArrowRightLeft size={10} className="shrink-0 text-warn" />}
              <span className={cn("truncate", d.kind === "added" ? "text-ok" : d.kind === "removed" ? "text-accent-bright" : "text-warn")}>{d.key}</span>
            </div>
            {d.kind === "changed" && (
              <p className="mt-0.5 truncate pl-4 text-text-dim">
                {d.from} → {d.to}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReconstructedList({ icon: Icon, title, items, empty }: { icon: typeof Network; title: string; items: ReconstructedState["ports"]; empty: string }) {
  return (
    <div className="rounded-md border border-border bg-base p-2.5">
      <p className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-text-dim">
        <Icon size={11} /> {title} ({items.length})
      </p>
      {items.length === 0 && <p className="text-[11px] text-text-dim">{empty}</p>}
      <div className="max-h-40 space-y-1 overflow-y-auto">
        {items.map((item) => (
          <div key={item.key} className="truncate rounded border border-borderMuted px-1.5 py-1 font-mono text-[10px] text-text-muted" title={`${item.key}: ${item.value}`}>
            {item.key}
          </div>
        ))}
      </div>
    </div>
  );
}
