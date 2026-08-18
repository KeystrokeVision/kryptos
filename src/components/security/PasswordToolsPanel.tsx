import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Copy, RefreshCw, KeyRound, Check, ShieldAlert, ShieldCheck, Wifi } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { api } from "@/lib/tauri";
import { cn } from "@/lib/utils";

const SCORE_COLORS = ["bg-accent-bright", "bg-accent-bright", "bg-warn", "bg-ok", "bg-ok"];

async function sha1Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-1", bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

export function PasswordToolsPanel() {
  const [length, setLength] = useState(20);
  const [useUpper, setUseUpper] = useState(true);
  const [useDigits, setUseDigits] = useState(true);
  const [useSymbols, setUseSymbols] = useState(true);
  const [generated, setGenerated] = useState("");
  const [copied, setCopied] = useState(false);
  const [testPassword, setTestPassword] = useState("");

  const genMutation = useMutation({
    mutationFn: () => api.generatePassword(length, useUpper, useDigits, useSymbols),
    onSuccess: setGenerated,
  });

  const strengthMutation = useMutation({
    mutationFn: (pw: string) => api.checkPasswordStrength(pw),
  });

  const pwnedMutation = useMutation({
    mutationFn: async (pw: string) => {
      const hash = await sha1Hex(pw);
      const prefix = hash.slice(0, 5);
      const suffix = hash.slice(5);
      const range = await api.checkPwnedRange(prefix);
      const line = range.split("\n").find((l) => l.trim().toUpperCase().startsWith(suffix));
      return line ? parseInt(line.split(":")[1]?.trim() ?? "0", 10) : 0;
    },
  });

  function onTestChange(value: string) {
    setTestPassword(value);
    if (value) strengthMutation.mutate(value);
  }

  function copyGenerated() {
    if (!generated) return;
    navigator.clipboard.writeText(generated).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }

  return (
    <div className="h-full space-y-4 overflow-y-auto p-5">
      <Card title="Generador de contrasenas">
        <div className="space-y-3">
          <p className="text-xs text-text-dim">
            Generado localmente con el generador de numeros aleatorios criptografico del sistema operativo. Nunca
            sale de este equipo.
          </p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={generated}
              placeholder="Presiona generar..."
              className="h-9 flex-1 rounded-md border border-border bg-base px-2.5 font-mono text-sm text-text outline-none"
            />
            <button
              onClick={copyGenerated}
              disabled={!generated}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-text-dim hover:text-text disabled:opacity-40"
              aria-label="Copiar"
            >
              {copied ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs text-text-muted">
            <label className="flex items-center gap-1.5">
              Longitud
              <input
                type="number"
                min={4}
                max={128}
                value={length}
                onChange={(e) => setLength(Number(e.target.value))}
                className="h-7 w-16 rounded-md border border-border bg-base px-2 text-center text-xs text-text outline-none"
              />
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={useUpper} onChange={(e) => setUseUpper(e.target.checked)} /> Mayusculas
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={useDigits} onChange={(e) => setUseDigits(e.target.checked)} /> Numeros
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={useSymbols} onChange={(e) => setUseSymbols(e.target.checked)} /> Simbolos
            </label>
          </div>

          <button
            onClick={() => genMutation.mutate()}
            className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-bright"
          >
            <RefreshCw size={13} className={genMutation.isPending ? "animate-spin" : ""} />
            Generar
          </button>
        </div>
      </Card>

      <Card title="Verificador de fortaleza">
        <div className="space-y-3">
          <p className="text-xs text-text-dim">
            Analisis offline (entropia + lista de contrasenas comunes) — no consulta ningun servicio externo. Nada de
            lo que escribas aqui se envia a ningun lado a menos que vos mismo presiones "Verificar filtraciones"
            abajo.
          </p>
          <div className="flex items-center gap-2">
            <KeyRound size={13} className="text-text-dim" />
            <input
              type="text"
              value={testPassword}
              onChange={(e) => onTestChange(e.target.value)}
              placeholder="Escribe una contrasena para evaluarla..."
              className="h-8 flex-1 rounded-md border border-border bg-base px-2.5 font-mono text-xs text-text outline-none focus:border-accent/60"
            />
          </div>

          {strengthMutation.data && (
            <div className="space-y-1.5">
              <div className="flex gap-1">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className={cn("h-1.5 flex-1 rounded-full", i <= strengthMutation.data!.score ? SCORE_COLORS[strengthMutation.data!.score] : "bg-overlay/10")}
                  />
                ))}
              </div>
              <p className="text-xs text-text">
                {strengthMutation.data.label} · {strengthMutation.data.entropy_bits.toFixed(0)} bits de entropia
              </p>
              <ul className="space-y-0.5 text-[11px] text-text-dim">
                {strengthMutation.data.feedback.map((f, i) => (
                  <li key={i}>• {f}</li>
                ))}
              </ul>

              <div className="border-t border-borderMuted pt-2.5">
                <button
                  onClick={() => pwnedMutation.mutate(testPassword)}
                  disabled={!testPassword || pwnedMutation.isPending}
                  className="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-text-muted hover:bg-overlay/[0.04] disabled:opacity-40"
                >
                  <Wifi size={13} className={pwnedMutation.isPending ? "animate-pulse" : ""} />
                  {pwnedMutation.isPending ? "Consultando Have I Been Pwned..." : "Verificar filtraciones (opcional, contacta un servicio externo)"}
                </button>
                <p className="mt-1 text-[10px] text-text-dim">
                  Usa k-anonimato: solo se envian los primeros 5 caracteres del hash SHA-1, nunca la contrasena
                  completa ni el hash entero.
                </p>
                {pwnedMutation.isError && (
                  <p className="mt-2 text-xs text-accent-bright">{String((pwnedMutation.error as Error)?.message)}</p>
                )}
                {pwnedMutation.data !== undefined && (
                  <div
                    className={cn(
                      "mt-2 flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs",
                      pwnedMutation.data > 0 ? "border-accent/40 bg-accent/10 text-accent-bright" : "border-ok/40 bg-ok/10 text-ok"
                    )}
                  >
                    {pwnedMutation.data > 0 ? <ShieldAlert size={13} /> : <ShieldCheck size={13} />}
                    {pwnedMutation.data > 0
                      ? `Aparecio en ${pwnedMutation.data.toLocaleString()} filtracion(es) conocidas — cambiala.`
                      : "No aparecio en las filtraciones conocidas de Have I Been Pwned."}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
