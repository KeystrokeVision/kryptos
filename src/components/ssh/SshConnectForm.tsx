import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { Plug, Save, Trash2, FolderOpen, Star } from "lucide-react";
import { api } from "@/lib/tauri";
import type { SshProfile, SshConnectParams } from "@/types/ssh";

interface SshConnectFormProps {
  onConnect: (params: SshConnectParams, label: string) => void;
}

export function SshConnectForm({ onConnect }: SshConnectFormProps) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");
  const [authMethod, setAuthMethod] = useState<"password" | "key">("password");
  const [password, setPassword] = useState("");
  const [keyPath, setKeyPath] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [saveProfile, setSaveProfile] = useState(true);

  const profiles = useQuery({ queryKey: ["ssh", "profiles"], queryFn: api.listSshProfiles });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteSshProfile(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ssh", "profiles"] }),
  });

  function loadProfile(p: SshProfile) {
    setLabel(p.label);
    setHost(p.host);
    setPort(String(p.port));
    setUsername(p.username);
    setAuthMethod(p.auth_method);
    setKeyPath(p.key_path ?? "");
    setPassword("");
    setPassphrase("");
  }

  async function pickKeyFile() {
    const selected = await open({ multiple: false });
    if (typeof selected === "string") setKeyPath(selected);
  }

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    if (!host.trim() || !username.trim()) return;

    if (saveProfile && label.trim()) {
      api
        .addSshProfile(label.trim(), host.trim(), Number(port) || 22, username.trim(), authMethod, authMethod === "key" ? keyPath : undefined)
        .then(() => queryClient.invalidateQueries({ queryKey: ["ssh", "profiles"] }))
        .catch(() => {});
    }

    const params: SshConnectParams = {
      host: host.trim(),
      port: Number(port) || 22,
      username: username.trim(),
      auth_method: authMethod,
      password: authMethod === "password" ? password : undefined,
      key_path: authMethod === "key" ? keyPath : undefined,
      passphrase: authMethod === "key" && passphrase ? passphrase : undefined,
    };
    onConnect(params, label.trim() || `${username}@${host}`);
  }

  return (
    <div className="grid h-full grid-cols-1 gap-4 overflow-y-auto p-5 lg:grid-cols-[280px_1fr]">
      <div className="space-y-1.5">
        <p className="mb-1.5 px-1 text-[10px] uppercase tracking-widest text-text-dim">Perfiles guardados</p>
        {(profiles.data ?? []).length === 0 && <p className="px-1 text-[11px] text-text-dim">Ninguno todavia.</p>}
        {(profiles.data ?? []).map((p) => (
          <div key={p.id} className="group flex items-center gap-2 rounded-md border border-border bg-base px-2.5 py-2 text-[11px]">
            <Star size={11} className="shrink-0 text-accent-bright" />
            <button onClick={() => loadProfile(p)} className="min-w-0 flex-1 text-left">
              <p className="truncate text-text">{p.label}</p>
              <p className="truncate text-[10px] text-text-dim">
                {p.username}@{p.host}:{p.port}
              </p>
            </button>
            <button
              onClick={() => deleteMutation.mutate(p.id)}
              className="shrink-0 text-text-dim opacity-0 hover:text-accent-bright group-hover:opacity-100"
              aria-label={`Eliminar perfil ${p.label}`}
            >
              <Trash2 size={11} />
            </button>
          </div>
        ))}
      </div>

      <form onSubmit={handleConnect} className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Nombre (opcional)"
            className="h-8 rounded-md border border-border bg-base px-2.5 text-xs text-text outline-none focus:border-accent/60"
          />
          <label className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <input type="checkbox" checked={saveProfile} onChange={(e) => setSaveProfile(e.target.checked)} />
            Guardar perfil
          </label>
        </div>

        <div className="grid grid-cols-[1fr_80px] gap-2">
          <input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="Host o IP"
            className="h-8 rounded-md border border-border bg-base px-2.5 font-mono text-xs text-text outline-none focus:border-accent/60"
          />
          <input
            value={port}
            onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
            placeholder="22"
            className="h-8 rounded-md border border-border bg-base px-2.5 text-center font-mono text-xs text-text outline-none focus:border-accent/60"
          />
        </div>

        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Usuario"
          className="h-8 w-full rounded-md border border-border bg-base px-2.5 text-xs text-text outline-none focus:border-accent/60"
        />

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setAuthMethod("password")}
            className={`h-8 flex-1 rounded-md border text-xs ${authMethod === "password" ? "border-accent/60 bg-accent/10 text-text" : "border-border text-text-muted"}`}
          >
            Contrasena
          </button>
          <button
            type="button"
            onClick={() => setAuthMethod("key")}
            className={`h-8 flex-1 rounded-md border text-xs ${authMethod === "key" ? "border-accent/60 bg-accent/10 text-text" : "border-border text-text-muted"}`}
          >
            Llave privada
          </button>
        </div>

        {authMethod === "password" ? (
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Contrasena"
            className="h-8 w-full rounded-md border border-border bg-base px-2.5 text-xs text-text outline-none focus:border-accent/60"
          />
        ) : (
          <>
            <div className="flex gap-2">
              <input
                value={keyPath}
                onChange={(e) => setKeyPath(e.target.value)}
                placeholder="Ruta de la llave privada"
                className="h-8 flex-1 rounded-md border border-border bg-base px-2.5 font-mono text-xs text-text outline-none focus:border-accent/60"
              />
              <button type="button" onClick={pickKeyFile} className="flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-text-muted hover:bg-white/[0.04]">
                <FolderOpen size={13} />
              </button>
            </div>
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Frase de contrasena de la llave (si tiene)"
              className="h-8 w-full rounded-md border border-border bg-base px-2.5 text-xs text-text outline-none focus:border-accent/60"
            />
          </>
        )}

        <p className="text-[10px] text-text-dim">
          <Save size={9} className="mr-1 inline" />
          Solo se guarda host/usuario/metodo — la contrasena o frase de la llave se pide de nuevo cada vez, nunca se
          almacena.
        </p>

        <button
          type="submit"
          disabled={!host.trim() || !username.trim()}
          className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-accent text-xs font-medium text-white hover:bg-accent-bright disabled:opacity-40"
        >
          <Plug size={13} /> Conectar
        </button>
      </form>
    </div>
  );
}
