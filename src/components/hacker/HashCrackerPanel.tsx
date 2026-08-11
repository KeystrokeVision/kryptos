import { useRef, useState } from "react";
import { KeyRound, PlayCircle, Square, CheckCircle2, XCircle, Info, Copy, Check } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { computeHash, type HashAlgorithm } from "@/lib/hackerCrypto";
import { generateCandidates, estimateCandidateCount } from "@/lib/wordlistData";

const HASH_ALGOS: HashAlgorithm[] = ["MD5", "SHA-1", "SHA-256", "SHA-384", "SHA-512"];
const BATCH_SIZE = 200;

type CrackState = { status: "idle" } | { status: "running"; tried: number; total: number } | { status: "found"; candidate: string; tried: number } | { status: "not_found"; tried: number };

/**
 * Cracker de diccionario contra un hash que VOS proveés — un CTF, o tu
 * propia contraseña olvidada exportada como hash. Nunca apunta contra un
 * sistema en vivo ni credenciales ajenas: es puramente local, contra un
 * string que ya tenés pegado en pantalla. Wordlist curada + reglas de
 * mutación tipo hashcat (mayúscula, sufijos, años) en vez de un archivo
 * gigante de contraseñas filtradas de terceros.
 */
export function HashCrackerPanel() {
  const [targetHash, setTargetHash] = useState("");
  const [algorithm, setAlgorithm] = useState<HashAlgorithm>("MD5");
  const [extraWords, setExtraWords] = useState("");
  const [state, setState] = useState<CrackState>({ status: "idle" });
  const [copied, setCopied] = useState(false);
  const cancelRef = useRef(false);

  const extraList = extraWords.split("\n").map((w) => w.trim()).filter(Boolean);
  const estimatedTotal = estimateCandidateCount(extraList.length);

  async function startCrack() {
    const target = targetHash.trim().toLowerCase();
    if (!target) return;
    cancelRef.current = false;
    setState({ status: "running", tried: 0, total: estimatedTotal });

    let tried = 0;
    let batch: string[] = [];

    async function processBatch(): Promise<string | null> {
      const hashes = await Promise.all(batch.map((candidate) => computeHash(candidate, algorithm)));
      for (let i = 0; i < batch.length; i++) {
        if (hashes[i].toLowerCase() === target) return batch[i];
      }
      return null;
    }

    for (const candidate of generateCandidates(extraList)) {
      if (cancelRef.current) return;
      batch.push(candidate);
      if (batch.length >= BATCH_SIZE) {
        const found = await processBatch();
        tried += batch.length;
        if (found !== null) {
          setState({ status: "found", candidate: found, tried });
          return;
        }
        setState({ status: "running", tried, total: estimatedTotal });
        batch = [];
        // Le cede el control al event loop cada tanda para que la barra de
        // progreso y el boton de cancelar sigan respondiendo.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    if (batch.length > 0 && !cancelRef.current) {
      const found = await processBatch();
      tried += batch.length;
      if (found !== null) {
        setState({ status: "found", candidate: found, tried });
        return;
      }
    }
    if (!cancelRef.current) setState({ status: "not_found", tried });
  }

  function cancel() {
    cancelRef.current = true;
    setState({ status: "idle" });
  }

  const inputClass = "h-8 flex-1 rounded-md border border-border bg-base px-2.5 font-mono text-xs text-text outline-none focus:border-accent/60";

  return (
    <div className="h-full space-y-4 overflow-y-auto p-5">
      <Card title="Cracker de hashes (wordlist local)">
        <div className="space-y-3">
          <p className="flex items-start gap-2 text-xs text-text-dim">
            <Info size={13} className="mt-0.5 shrink-0" />
            Para hashes de un CTF o una contraseña propia que olvidaste — nunca para credenciales ajenas ni sistemas
            en vivo. Todo corre local, contra ~{estimatedTotal.toLocaleString()} variantes generadas de una wordlist
            curada de contraseñas comunes.
          </p>

          <div className="flex gap-2">
            <KeyRound size={13} className="mt-2 shrink-0 text-text-dim" />
            <input
              value={targetHash}
              onChange={(e) => setTargetHash(e.target.value)}
              placeholder="5f4dcc3b5aa765d61d8327deb882cf99"
              disabled={state.status === "running"}
              className={inputClass}
            />
            <select
              value={algorithm}
              onChange={(e) => setAlgorithm(e.target.value as HashAlgorithm)}
              disabled={state.status === "running"}
              className="h-8 shrink-0 rounded-md border border-border bg-base px-2 text-xs text-text outline-none"
            >
              {HASH_ALGOS.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>

          <details className="text-xs">
            <summary className="cursor-pointer text-text-muted hover:text-text">Palabras extra a probar (una por línea, opcional)</summary>
            <textarea
              value={extraWords}
              onChange={(e) => setExtraWords(e.target.value)}
              disabled={state.status === "running"}
              placeholder="ej: nombre de la mascota, pista del reto..."
              rows={3}
              className="mt-2 w-full resize-none rounded-md border border-border bg-base px-2.5 py-1.5 font-mono text-[11px] text-text outline-none focus:border-accent/60"
            />
          </details>

          <div className="flex items-center gap-2">
            {state.status !== "running" ? (
              <button
                onClick={startCrack}
                disabled={!targetHash.trim()}
                className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-bright disabled:opacity-40"
              >
                <PlayCircle size={13} /> Iniciar
              </button>
            ) : (
              <button onClick={cancel} className="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-text-muted hover:bg-white/[0.04]">
                <Square size={12} /> Cancelar
              </button>
            )}
            {state.status === "running" && (
              <span className="text-[11px] text-text-dim">
                {state.tried.toLocaleString()} / {state.total.toLocaleString()} probados...
              </span>
            )}
          </div>

          {state.status === "running" && (
            <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
              <div className="h-full bg-accent transition-all" style={{ width: `${Math.min(100, (state.tried / state.total) * 100)}%` }} />
            </div>
          )}

          {state.status === "found" && (
            <div className="flex items-center gap-2 rounded-md border border-ok/40 bg-ok/10 px-3 py-2 text-xs text-ok">
              <CheckCircle2 size={14} className="shrink-0" />
              <span className="flex-1">
                Encontrado tras {state.tried.toLocaleString()} intentos: <code className="font-mono text-text">{state.candidate}</code>
              </span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(state.candidate).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1200);
                  });
                }}
                className="shrink-0 text-ok hover:text-text"
                aria-label="Copiar"
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </button>
            </div>
          )}

          {state.status === "not_found" && (
            <div className="flex items-center gap-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
              <XCircle size={14} className="shrink-0" />
              No se encontró en los {state.tried.toLocaleString()} candidatos probados — probá otro algoritmo o agregá
              palabras propias del contexto.
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
