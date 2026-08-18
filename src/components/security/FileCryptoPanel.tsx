import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { Lock, Unlock, FileLock2, CheckCircle2, AlertTriangle, Eye, EyeOff } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { api } from "@/lib/tauri";

export function FileCryptoPanel() {
  const [mode, setMode] = useState<"encrypt" | "decrypt">("encrypt");
  const [filePath, setFilePath] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => (mode === "encrypt" ? api.encryptFile(filePath, password) : api.decryptFile(filePath, password)),
    onSuccess: (res) => setResult(res.output_path),
  });

  async function pickFile() {
    const selected = await open({ multiple: false });
    if (typeof selected === "string") {
      setFilePath(selected);
      setResult(null);
      mutation.reset();
    }
  }

  return (
    <div className="h-full overflow-y-auto p-5">
      <Card title="Cifrado de archivos">
        <div className="space-y-4">
          <p className="text-xs text-text-dim">
            Cifra o descifra cualquier archivo con una contrasena — AES-256-GCM con derivacion de clave Argon2id
            (la misma familia de algoritmos que usan gestores de contraseñas serios). Todo pasa localmente, sin
            conexion a ningun lado. Una contrasena incorrecta al descifrar falla limpio, nunca produce un archivo
            corrupto en silencio.
          </p>

          <div className="flex gap-2">
            <button
              onClick={() => {
                setMode("encrypt");
                setResult(null);
                mutation.reset();
              }}
              className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border text-xs ${mode === "encrypt" ? "border-accent/60 bg-accent/10 text-text" : "border-border text-text-muted"}`}
            >
              <Lock size={13} /> Cifrar
            </button>
            <button
              onClick={() => {
                setMode("decrypt");
                setResult(null);
                mutation.reset();
              }}
              className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border text-xs ${mode === "decrypt" ? "border-accent/60 bg-accent/10 text-text" : "border-border text-text-muted"}`}
            >
              <Unlock size={13} /> Descifrar
            </button>
          </div>

          <div className="flex gap-2">
            <input
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              placeholder="Archivo..."
              className="h-9 flex-1 rounded-md border border-border bg-base px-3 font-mono text-xs text-text outline-none focus:border-accent/60"
            />
            <button onClick={pickFile} className="flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-text-muted hover:bg-overlay/[0.04]">
              <FileLock2 size={13} /> Elegir
            </button>
          </div>

          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Contrasena..."
              className="h-9 w-full rounded-md border border-border bg-base px-3 pr-9 text-xs text-text outline-none focus:border-accent/60"
            />
            <button onClick={() => setShowPassword((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-dim hover:text-text">
              {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>

          {mutation.isError && (
            <div className="flex items-start gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent-bright">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {String((mutation.error as Error)?.message)}
            </div>
          )}
          {result && (
            <div className="flex items-start gap-2 rounded-md border border-ok/30 bg-ok/5 px-3 py-2 text-xs text-ok">
              <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
              <span>
                {mode === "encrypt" ? "Cifrado" : "Descifrado"} correctamente en: <span className="font-mono">{result}</span>
              </span>
            </div>
          )}

          <button
            onClick={() => mutation.mutate()}
            disabled={!filePath.trim() || !password.trim() || mutation.isPending}
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-accent text-xs font-medium text-white hover:bg-accent-bright disabled:opacity-40"
          >
            {mode === "encrypt" ? <Lock size={13} /> : <Unlock size={13} />}
            {mutation.isPending ? "Procesando..." : mode === "encrypt" ? "Cifrar archivo" : "Descifrar archivo"}
          </button>

          <p className="text-[10px] text-text-dim">
            Si olvidas la contrasena, el archivo cifrado no se puede recuperar de ninguna forma — no hay puerta
            trasera ni forma de saltarse esto.
          </p>
        </div>
      </Card>
    </div>
  );
}
