import { useMemo, useState } from "react";
import { Copy, Check, Search, Binary, KeyRound, FileJson2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import {
  identifyFormat,
  computeHash,
  type HashAlgorithm,
  encodeBase64,
  decodeBase64,
  encodeUrl,
  decodeUrl,
  bytesToHex,
  hexToBytes,
  utf8ToBytes,
  bytesToUtf8,
  decodeJwt,
  caesarShift,
  caesarBruteForce,
  vigenereTransform,
  xorBytes,
} from "@/lib/hackerCrypto";

const CONFIDENCE_TONE: Record<string, string> = { alta: "text-ok border-ok/40 bg-ok/10", media: "text-warn border-warn/40 bg-warn/10", baja: "text-text-dim border-borderMuted bg-white/[0.02]" };

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        if (!value) return;
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      disabled={!value}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-text-dim hover:text-text disabled:opacity-30"
      aria-label="Copiar"
    >
      {copied ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
    </button>
  );
}

const inputClass = "h-8 flex-1 rounded-md border border-border bg-base px-2.5 font-mono text-xs text-text outline-none focus:border-accent/60";
const outputClass = "min-h-[2.25rem] flex-1 break-all rounded-md border border-border bg-base px-2.5 py-1.5 font-mono text-[11px] text-text-muted";

function IdentifyBlock() {
  const [input, setInput] = useState("");
  const guesses = useMemo(() => identifyFormat(input), [input]);
  return (
    <Card title="Identificador de formato">
      <div className="space-y-3">
        <p className="text-xs text-text-dim">Pega un hash, token o cadena rara — heuristicas locales, nada se envia a ningun lado.</p>
        <div className="flex gap-2">
          <Search size={13} className="mt-2 shrink-0 text-text-dim" />
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="5f4dcc3b5aa765d61d8327deb882cf99..." className={inputClass} />
        </div>
        {input.trim() && (
          <div className="space-y-1.5">
            {guesses.map((g, i) => (
              <div key={i} className={cn("flex items-center justify-between rounded-md border px-2.5 py-1.5 text-[11px]", CONFIDENCE_TONE[g.confidence])}>
                <span className="font-medium">{g.label}</span>
                <span className="text-[10px] opacity-80">{g.note}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

const HASH_ALGOS: HashAlgorithm[] = ["MD5", "SHA-1", "SHA-256", "SHA-384", "SHA-512"];

function HashBlock() {
  const [input, setInput] = useState("");
  const [algo, setAlgo] = useState<HashAlgorithm>("SHA-256");
  const [result, setResult] = useState("");

  async function run(text: string, a: HashAlgorithm) {
    setResult(text ? await computeHash(text, a) : "");
  }

  return (
    <Card title="Calculadora de hash">
      <div className="space-y-3">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              run(e.target.value, algo);
            }}
            placeholder="Texto a hashear..."
            className={inputClass}
          />
          <select
            value={algo}
            onChange={(e) => {
              const a = e.target.value as HashAlgorithm;
              setAlgo(a);
              run(input, a);
            }}
            className="h-8 shrink-0 rounded-md border border-border bg-base px-2 text-xs text-text outline-none"
          >
            {HASH_ALGOS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className={outputClass}>{result || "El hash aparece aqui..."}</span>
          <CopyButton value={result} />
        </div>
      </div>
    </Card>
  );
}

type EncodingMode = "base64" | "hex" | "url";
const ENCODINGS: { id: EncodingMode; label: string }[] = [
  { id: "base64", label: "Base64" },
  { id: "hex", label: "Hexadecimal" },
  { id: "url", label: "URL" },
];

function EncodingBlock() {
  const [mode, setMode] = useState<EncodingMode>("base64");
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  function encode(text: string): string {
    if (mode === "base64") return encodeBase64(text);
    if (mode === "hex") return bytesToHex(utf8ToBytes(text));
    return encodeUrl(text);
  }
  function decode(text: string): string {
    if (mode === "base64") return decodeBase64(text);
    if (mode === "hex") return bytesToUtf8(hexToBytes(text));
    return decodeUrl(text);
  }

  const [encoded, setEncoded] = useState("");
  const [decoded, setDecoded] = useState("");

  function onInputChange(value: string) {
    setInput(value);
    setError(null);
    try {
      setEncoded(encode(value));
    } catch {
      setEncoded("");
    }
    try {
      setDecoded(decode(value));
    } catch (e) {
      setDecoded("");
      setError(String((e as Error)?.message ?? e));
    }
  }

  return (
    <Card title="Codificadores">
      <div className="space-y-3">
        <div className="flex gap-1.5">
          {ENCODINGS.map((e) => (
            <button
              key={e.id}
              onClick={() => {
                setMode(e.id);
                onInputChange(input);
              }}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px]",
                mode === e.id ? "bg-accent text-white" : "border border-border text-text-muted hover:bg-white/[0.04]"
              )}
            >
              {e.label}
            </button>
          ))}
        </div>
        <input value={input} onChange={(ev) => onInputChange(ev.target.value)} placeholder="Escribe texto plano o codificado..." className={inputClass + " w-full"} />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-widest text-text-dim">Codificado</p>
            <div className="flex items-center gap-2">
              <span className={outputClass}>{encoded || "—"}</span>
              <CopyButton value={encoded} />
            </div>
          </div>
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-widest text-text-dim">Decodificado</p>
            <div className="flex items-center gap-2">
              <span className={outputClass}>{error ? "—" : decoded || "—"}</span>
              <CopyButton value={decoded} />
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function JwtBlock() {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [decoded, setDecoded] = useState<{ header: unknown; payload: unknown } | null>(null);

  function onChange(value: string) {
    setToken(value);
    if (!value.trim()) {
      setDecoded(null);
      setError(null);
      return;
    }
    try {
      const d = decodeJwt(value);
      setDecoded({ header: d.header, payload: d.payload });
      setError(null);
    } catch (e) {
      setDecoded(null);
      setError(String((e as Error)?.message ?? e));
    }
  }

  return (
    <Card title="Decodificador de JWT">
      <div className="space-y-3">
        <div className="flex items-start gap-2">
          <FileJson2 size={13} className="mt-2 shrink-0 text-text-dim" />
          <textarea
            value={token}
            onChange={(e) => onChange(e.target.value)}
            placeholder="eyJhbGciOi..."
            rows={2}
            className="h-16 flex-1 resize-none rounded-md border border-border bg-base px-2.5 py-1.5 font-mono text-[11px] text-text outline-none focus:border-accent/60"
          />
        </div>
        <p className="text-[10px] text-text-dim">Solo lee — no verifica la firma. Para inspeccionar tus propios tokens, no para falsificar los de otros.</p>
        {error && <p className="text-xs text-accent-bright">{error}</p>}
        {decoded && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-widest text-text-dim">Header</p>
              <pre className="max-h-40 overflow-auto rounded-md border border-border bg-base p-2 font-mono text-[10px] text-text-muted">{JSON.stringify(decoded.header, null, 2)}</pre>
            </div>
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-widest text-text-dim">Payload</p>
              <pre className="max-h-40 overflow-auto rounded-md border border-border bg-base p-2 font-mono text-[10px] text-text-muted">{JSON.stringify(decoded.payload, null, 2)}</pre>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function ClassicCiphersBlock() {
  const [text, setText] = useState("");
  const [shift, setShift] = useState(3);
  const [showBrute, setShowBrute] = useState(false);
  const [vigenereKey, setVigenereKey] = useState("");
  const [xorKey, setXorKey] = useState("");
  const [xorOutFormat, setXorOutFormat] = useState<"hex" | "texto">("hex");

  const caesarResult = useMemo(() => caesarShift(text, shift), [text, shift]);
  const bruteForce = useMemo(() => (showBrute ? caesarBruteForce(text) : []), [text, showBrute]);
  const vigenereEnc = useMemo(() => vigenereTransform(text, vigenereKey, false), [text, vigenereKey]);
  const vigenereDec = useMemo(() => vigenereTransform(text, vigenereKey, true), [text, vigenereKey]);

  const xorResult = useMemo(() => {
    if (!text || !xorKey) return "";
    const out = xorBytes(utf8ToBytes(text), utf8ToBytes(xorKey));
    return xorOutFormat === "hex" ? bytesToHex(out) : bytesToUtf8(out);
  }, [text, xorKey, xorOutFormat]);

  return (
    <Card title="Cifrados clasicos (estilo CTF)">
      <div className="space-y-5">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Texto a cifrar/descifrar..." className={inputClass + " w-full"} />

        <div className="space-y-2 border-t border-borderMuted pt-3">
          <p className="text-[11px] font-medium text-text">Cesar</p>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-[11px] text-text-dim">
              Corrimiento
              <input type="number" value={shift} onChange={(e) => setShift(Number(e.target.value))} className="h-7 w-16 rounded-md border border-border bg-base px-2 text-center text-xs text-text outline-none" />
            </label>
            <span className={outputClass}>{caesarResult || "—"}</span>
            <CopyButton value={caesarResult} />
          </div>
          <button onClick={() => setShowBrute((v) => !v)} className="text-[11px] text-accent-bright hover:underline">
            {showBrute ? "Ocultar" : "Probar los 25 corrimientos"} — el espacio de claves de Cesar es tan chico que no hace falta ninguna clave
          </button>
          {showBrute && (
            <div className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-border bg-base p-2">
              {bruteForce.map((b) => (
                <div key={b.shift} className="flex gap-2 font-mono text-[10px]">
                  <span className="w-6 text-text-dim">{b.shift}</span>
                  <span className="truncate text-text-muted">{b.result}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2 border-t border-borderMuted pt-3">
          <p className="text-[11px] font-medium text-text">Vigenere</p>
          <div className="flex items-center gap-2">
            <KeyRound size={12} className="text-text-dim" />
            <input value={vigenereKey} onChange={(e) => setVigenereKey(e.target.value)} placeholder="clave" className="h-7 w-32 rounded-md border border-border bg-base px-2 font-mono text-xs text-text outline-none" />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-[10px] uppercase text-text-dim">Cifrar</span>
            <span className={outputClass}>{vigenereEnc || "—"}</span>
            <CopyButton value={vigenereEnc} />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-[10px] uppercase text-text-dim">Descifrar</span>
            <span className={outputClass}>{vigenereDec || "—"}</span>
            <CopyButton value={vigenereDec} />
          </div>
        </div>

        <div className="space-y-2 border-t border-borderMuted pt-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium text-text">XOR repetido</p>
            <div className="flex gap-1">
              {(["hex", "texto"] as const).map((f) => (
                <button key={f} onClick={() => setXorOutFormat(f)} className={cn("rounded-full px-2 py-0.5 text-[10px]", xorOutFormat === f ? "bg-accent text-white" : "border border-border text-text-dim")}>
                  {f}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Binary size={12} className="text-text-dim" />
            <input value={xorKey} onChange={(e) => setXorKey(e.target.value)} placeholder="clave" className="h-7 w-32 rounded-md border border-border bg-base px-2 font-mono text-xs text-text outline-none" />
          </div>
          <div className="flex items-center gap-2">
            <span className={outputClass}>{xorResult || "—"}</span>
            <CopyButton value={xorResult} />
          </div>
          <p className="text-[10px] text-text-dim">XOR es simetrico: aplicalo dos veces con la misma clave y volves al texto original.</p>
        </div>
      </div>
    </Card>
  );
}

/**
 * Caja de herramientas cripto para CTFs y curiosidad tecnica — identificador
 * de formato, hashing, codificadores, JWT y cifrados clasicos. Todo corre en
 * el navegador embebido (Web Crypto + JS puro para MD5), nada sale del
 * equipo. Complementa a PasswordToolsPanel, que se enfoca en credenciales
 * propias en vez de en romper acertijos.
 */
export function CryptoToolboxPanel() {
  return (
    <div className="h-full space-y-4 overflow-y-auto p-5">
      <IdentifyBlock />
      <HashBlock />
      <EncodingBlock />
      <JwtBlock />
      <ClassicCiphersBlock />
    </div>
  );
}
