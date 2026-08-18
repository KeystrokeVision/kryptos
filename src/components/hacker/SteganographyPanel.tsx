import { useRef, useState } from "react";
import { ImagePlus, EyeOff, Eye, Download, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

// Esteganografia LSB (bit menos significativo): el clasico de cualquier CTF.
// Cada canal de color pierde su bit mas bajo para guardar un bit del mensaje
// — invisible a simple vista, reversible con la misma tecnica. Todo corre en
// un <canvas> local; la imagen nunca sale del equipo.

const HEADER_BITS = 32; // 32 bits = longitud del mensaje en bytes, antes del contenido en si

function bytesToBits(bytes: Uint8Array): number[] {
  const bits: number[] = [];
  for (const byte of bytes) {
    for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  }
  return bits;
}

function bitsToBytes(bits: number[]): Uint8Array {
  const out = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) byte = (byte << 1) | bits[i * 8 + b];
    out[i] = byte;
  }
  return out;
}

function encodeLsb(imageData: ImageData, message: string): ImageData {
  const msgBytes = new TextEncoder().encode(message);
  const lenBits = bytesToBits(new Uint8Array([msgBytes.length >>> 24, (msgBytes.length >>> 16) & 0xff, (msgBytes.length >>> 8) & 0xff, msgBytes.length & 0xff]));
  const msgBits = bytesToBits(msgBytes);
  const allBits = [...lenBits, ...msgBits];

  const data = new Uint8ClampedArray(imageData.data);
  const capacityBits = (data.length / 4) * 3; // 3 canales usables por pixel (RGB, alpha intacto)
  if (allBits.length > capacityBits) {
    throw new Error(`El mensaje no entra: necesita ${allBits.length} bits y la imagen solo tiene lugar para ${capacityBits}.`);
  }

  let bitIndex = 0;
  for (let i = 0; i < data.length && bitIndex < allBits.length; i += 4) {
    for (let channel = 0; channel < 3 && bitIndex < allBits.length; channel++) {
      data[i + channel] = (data[i + channel] & 0xfe) | allBits[bitIndex];
      bitIndex++;
    }
  }
  return new ImageData(data, imageData.width, imageData.height);
}

function decodeLsb(imageData: ImageData): string {
  const data = imageData.data;
  const bits: number[] = [];

  // Primero levantamos el header (32 bits) para saber cuantos bytes de mensaje leer.
  let messageLenBytes: number | null = null;
  for (let i = 0; i < data.length; i += 4) {
    for (let channel = 0; channel < 3; channel++) {
      if (messageLenBytes === null || bits.length < HEADER_BITS + messageLenBytes * 8) {
        bits.push(data[i + channel] & 1);
      }
      if (messageLenBytes === null && bits.length === HEADER_BITS) {
        const lenBytes = bitsToBytes(bits);
        messageLenBytes = (lenBytes[0] << 24) | (lenBytes[1] << 16) | (lenBytes[2] << 8) | lenBytes[3];
        if (messageLenBytes < 0 || messageLenBytes > 5_000_000) {
          throw new Error("No se encontro un mensaje LSB reconocible en esta imagen.");
        }
      }
    }
    if (messageLenBytes !== null && bits.length >= HEADER_BITS + messageLenBytes * 8) break;
  }
  if (messageLenBytes === null) throw new Error("La imagen es demasiado chica para contener un header valido.");

  const msgBits = bits.slice(HEADER_BITS, HEADER_BITS + messageLenBytes * 8);
  const msgBytes = bitsToBytes(msgBits);
  return new TextDecoder("utf-8", { fatal: true }).decode(msgBytes);
}

function loadImageToCanvas(file: File, canvas: HTMLCanvasElement): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("No se pudo crear el contexto 2D."));
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
    };
    img.onerror = () => reject(new Error("No se pudo cargar la imagen."));
    img.src = URL.createObjectURL(file);
  });
}

function HideBlock() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imageData, setImageData] = useState<ImageData | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  async function onFile(file: File) {
    setError(null);
    setResultUrl(null);
    try {
      const data = await loadImageToCanvas(file, canvasRef.current!);
      setImageData(data);
      setFileName(file.name);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    }
  }

  function hide() {
    if (!imageData || !canvasRef.current) return;
    setError(null);
    try {
      const encoded = encodeLsb(imageData, message);
      const ctx = canvasRef.current.getContext("2d")!;
      ctx.putImageData(encoded, 0, 0);
      setResultUrl(canvasRef.current.toDataURL("image/png"));
    } catch (e) {
      setResultUrl(null);
      setError(String((e as Error)?.message ?? e));
    }
  }

  const capacityBytes = imageData ? Math.floor(((imageData.width * imageData.height * 3) / 8) - 4) : 0;

  return (
    <Card title="Ocultar mensaje">
      <div className="space-y-3">
        <label className="flex h-9 w-fit cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 text-xs text-text-muted hover:border-accent/60 hover:text-text">
          <ImagePlus size={13} />
          {fileName ?? "Elegir imagen (PNG recomendado)"}
          <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>

        {imageData && (
          <>
            <p className="text-[10px] text-text-dim">
              {imageData.width}x{imageData.height}px · capacidad aproximada: {capacityBytes.toLocaleString()} caracteres
            </p>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Mensaje a esconder dentro de la imagen..."
              rows={3}
              className="w-full resize-none rounded-md border border-border bg-base px-2.5 py-1.5 font-mono text-xs text-text outline-none focus:border-accent/60"
            />
            <button
              onClick={hide}
              disabled={!message}
              className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-bright disabled:opacity-40"
            >
              <EyeOff size={13} /> Ocultar en la imagen
            </button>
          </>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent-bright">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}

        {resultUrl && (
          <div className="space-y-2 border-t border-borderMuted pt-3">
            <img src={resultUrl} alt="Imagen con mensaje oculto" className="max-h-56 rounded-md border border-border" />
            <a
              href={resultUrl}
              download="kryptos-stego.png"
              className="flex h-8 w-fit items-center gap-1.5 rounded-md border border-border px-3 text-xs text-text-muted hover:bg-overlay/[0.04]"
            >
              <Download size={13} /> Descargar PNG
            </a>
            <p className="text-[10px] text-text-dim">Guardala como PNG — un formato con perdida (JPG) destruye los bits menos significativos y el mensaje se pierde.</p>
          </div>
        )}

        <canvas ref={canvasRef} className="hidden" />
      </div>
    </Card>
  );
}

function RevealBlock() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imageData, setImageData] = useState<ImageData | null>(null);

  async function onFile(file: File) {
    setError(null);
    setResult(null);
    setFileName(file.name);
    try {
      const data = await loadImageToCanvas(file, canvasRef.current!);
      setImageData(data);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    }
  }

  function reveal() {
    if (!imageData) return;
    setError(null);
    try {
      setResult(decodeLsb(imageData));
    } catch (e) {
      setResult(null);
      setError(String((e as Error)?.message ?? e));
    }
  }

  return (
    <Card title="Revelar mensaje">
      <div className="space-y-3">
        <label className="flex h-9 w-fit cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 text-xs text-text-muted hover:border-accent/60 hover:text-text">
          <ImagePlus size={13} />
          {fileName ?? "Elegir imagen a analizar"}
          <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
        {imageData && (
          <button onClick={reveal} className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-bright">
            <Eye size={13} /> Intentar revelar
          </button>
        )}
        {error && <p className="text-xs text-text-dim">{error} — no significa que la imagen no tenga nada oculto, solo que no usa este mismo esquema LSB.</p>}
        {result !== null && (
          <div className="rounded-md border border-ok/40 bg-ok/10 px-3 py-2 font-mono text-xs text-text">{result}</div>
        )}
        <canvas ref={canvasRef} className="hidden" />
      </div>
    </Card>
  );
}

export function SteganographyPanel() {
  const [tab, setTab] = useState<"hide" | "reveal">("hide");
  return (
    <div className="h-full space-y-4 overflow-y-auto p-5">
      <div className="flex gap-1.5">
        {(["hide", "reveal"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn("rounded-full px-3 py-1 text-xs", tab === t ? "bg-accent text-white" : "border border-border text-text-muted hover:bg-overlay/[0.04]")}
          >
            {t === "hide" ? "Ocultar" : "Revelar"}
          </button>
        ))}
      </div>
      {tab === "hide" ? <HideBlock /> : <RevealBlock />}
    </div>
  );
}
