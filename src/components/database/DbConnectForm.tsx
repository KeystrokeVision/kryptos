import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Plug, Save, Trash2, FolderOpen, Database, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { api } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { DbConnectionProfile, DbConnectParams, DbEngine } from "@/types/database";

interface DbConnectFormProps {
  onConnect: (params: DbConnectParams, label: string) => void;
}

const ENGINE_LABELS: Record<DbEngine, string> = { sqlite: "SQLite", postgres: "PostgreSQL", mysql: "MySQL" };
const DEFAULT_PORT: Record<DbEngine, number> = { sqlite: 0, postgres: 5432, mysql: 3306 };

export function DbConnectForm({ onConnect }: DbConnectFormProps) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState("");
  const [engine, setEngine] = useState<DbEngine>("sqlite");
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState(String(DEFAULT_PORT.postgres));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [databaseName, setDatabaseName] = useState("");
  const [filePath, setFilePath] = useState("");
  const [useTls, setUseTls] = useState(false);
  const [saveProfile, setSaveProfile] = useState(true);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const profiles = useQuery({ queryKey: ["db", "profiles"], queryFn: api.listDbConnections });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteDbConnection(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["db", "profiles"] }),
  });

  function changeEngine(next: DbEngine) {
    setEngine(next);
    setTestResult(null);
    if (next !== "sqlite") setPort(String(DEFAULT_PORT[next]));
  }

  function loadProfile(p: DbConnectionProfile) {
    setLabel(p.label);
    setEngine(p.engine);
    setHost(p.host ?? "localhost");
    setPort(String(p.port ?? DEFAULT_PORT[p.engine]));
    setUsername(p.username ?? "");
    setDatabaseName(p.database_name ?? "");
    setFilePath(p.file_path ?? "");
    setUseTls(p.use_tls);
    setPassword("");
    setTestResult(null);
  }

  async function pickSqliteFile() {
    const selected = await open({ multiple: false, filters: [{ name: "SQLite", extensions: ["db", "sqlite", "sqlite3"] }] });
    if (typeof selected === "string") setFilePath(selected);
  }

  async function pickNewSqliteFile() {
    const chosen = await save({ defaultPath: "database.db", filters: [{ name: "SQLite", extensions: ["db", "sqlite", "sqlite3"] }] });
    if (chosen) setFilePath(chosen);
  }

  function buildParams(): DbConnectParams {
    return {
      engine,
      host: engine !== "sqlite" ? host.trim() : undefined,
      port: engine !== "sqlite" ? Number(port) || DEFAULT_PORT[engine] : undefined,
      username: engine !== "sqlite" ? username.trim() : undefined,
      password: engine !== "sqlite" && password ? password : undefined,
      database_name: engine !== "sqlite" ? databaseName.trim() : undefined,
      file_path: engine === "sqlite" ? filePath.trim() : undefined,
      use_tls: engine !== "sqlite" ? useTls : false,
    };
  }

  const testMutation = useMutation({
    mutationFn: () => api.dbTestConnection(buildParams()),
    onSuccess: (info) => setTestResult({ ok: true, message: info }),
    onError: (e: Error) => setTestResult({ ok: false, message: e.message }),
  });

  const isValid = engine === "sqlite" ? filePath.trim().length > 0 : host.trim().length > 0;

  function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;

    const params = buildParams();
    if (saveProfile && label.trim()) {
      api
        .addDbConnection(
          label.trim(),
          engine,
          params.host,
          params.port,
          params.username,
          params.database_name,
          params.file_path,
          useTls
        )
        .then(() => queryClient.invalidateQueries({ queryKey: ["db", "profiles"] }))
        .catch(() => {});
    }

    const displayLabel = label.trim() || (engine === "sqlite" ? filePath.split(/[/\\]/).pop() || "sqlite" : `${username || engine}@${host}`);
    onConnect(params, displayLabel);
  }

  return (
    <div className="grid h-full grid-cols-1 gap-4 overflow-y-auto p-5 lg:grid-cols-[280px_1fr]">
      <div className="space-y-1.5">
        <p className="mb-1.5 px-1 text-[10px] uppercase tracking-widest text-text-dim">Conexiones guardadas</p>
        {(profiles.data ?? []).length === 0 && <p className="px-1 text-[11px] text-text-dim">Ninguna todavia.</p>}
        {(profiles.data ?? []).map((p) => (
          <div key={p.id} className="group flex items-center gap-2 rounded-md border border-border bg-base px-2.5 py-2 text-[11px]">
            <Database size={11} className="shrink-0 text-accent-bright" />
            <button onClick={() => loadProfile(p)} className="min-w-0 flex-1 text-left">
              <p className="truncate text-text">{p.label}</p>
              <p className="truncate text-[10px] text-text-dim">
                {ENGINE_LABELS[p.engine]} — {p.engine === "sqlite" ? p.file_path : `${p.username}@${p.host}:${p.port}/${p.database_name}`}
              </p>
            </button>
            <button
              onClick={() => deleteMutation.mutate(p.id)}
              className="shrink-0 text-text-dim opacity-0 hover:text-accent-bright group-hover:opacity-100"
              aria-label={`Eliminar conexion ${p.label}`}
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
            Guardar conexion
          </label>
        </div>

        <div className="flex gap-2">
          {(Object.keys(ENGINE_LABELS) as DbEngine[]).map((eng) => (
            <button
              key={eng}
              type="button"
              onClick={() => changeEngine(eng)}
              className={cn("h-8 flex-1 rounded-md border text-xs", engine === eng ? "border-accent/60 bg-accent/10 text-text" : "border-border text-text-muted")}
            >
              {ENGINE_LABELS[eng]}
            </button>
          ))}
        </div>

        {engine === "sqlite" ? (
          <div className="flex gap-2">
            <input
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              placeholder="Ruta al archivo .db / .sqlite"
              className="h-8 flex-1 rounded-md border border-border bg-base px-2.5 font-mono text-xs text-text outline-none focus:border-accent/60"
            />
            <button type="button" onClick={pickSqliteFile} className="flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-text-muted hover:bg-white/[0.04]" title="Abrir archivo existente">
              <FolderOpen size={13} />
            </button>
            <button type="button" onClick={pickNewSqliteFile} className="flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-text-muted hover:bg-white/[0.04]" title="Crear archivo nuevo">
              Nuevo
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[1fr_90px] gap-2">
              <input
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="Host o IP"
                className="h-8 rounded-md border border-border bg-base px-2.5 font-mono text-xs text-text outline-none focus:border-accent/60"
              />
              <input
                value={port}
                onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
                placeholder={String(DEFAULT_PORT[engine])}
                className="h-8 rounded-md border border-border bg-base px-2.5 text-center font-mono text-xs text-text outline-none focus:border-accent/60"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Usuario"
                className="h-8 rounded-md border border-border bg-base px-2.5 text-xs text-text outline-none focus:border-accent/60"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Contrasena"
                className="h-8 rounded-md border border-border bg-base px-2.5 text-xs text-text outline-none focus:border-accent/60"
              />
            </div>
            <input
              value={databaseName}
              onChange={(e) => setDatabaseName(e.target.value)}
              placeholder={engine === "postgres" ? "Base de datos (por defecto: postgres)" : "Base de datos"}
              className="h-8 w-full rounded-md border border-border bg-base px-2.5 text-xs text-text outline-none focus:border-accent/60"
            />
            <label className="flex items-center gap-1.5 text-[11px] text-text-muted">
              <input type="checkbox" checked={useTls} onChange={(e) => setUseTls(e.target.checked)} />
              Usar TLS (no valida el certificado del servidor — igual que el resto de KRYPTOS)
            </label>
          </>
        )}

        <p className="text-[10px] text-text-dim">
          <Save size={9} className="mr-1 inline" />
          {engine === "sqlite" ? "Solo se guarda la ruta del archivo." : "Solo se guarda host/usuario/base — la contrasena se pide de nuevo cada vez, nunca se almacena."}
        </p>

        {testResult && (
          <div
            className={cn(
              "flex items-start gap-2 rounded-md border px-2.5 py-2 text-[11px]",
              testResult.ok ? "border-ok/40 bg-ok/10 text-ok" : "border-accent/40 bg-accent/10 text-accent-bright"
            )}
          >
            {testResult.ok ? <CheckCircle2 size={13} className="mt-0.5 shrink-0" /> : <AlertTriangle size={13} className="mt-0.5 shrink-0" />}
            <span className="break-words">{testResult.message}</span>
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setTestResult(null);
              testMutation.mutate();
            }}
            disabled={!isValid || testMutation.isPending}
            className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-border text-xs text-text-muted hover:bg-white/[0.04] disabled:opacity-40"
          >
            {testMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
            Probar conexion
          </button>
          <button
            type="submit"
            disabled={!isValid}
            className="flex h-9 flex-[2] items-center justify-center gap-1.5 rounded-md bg-accent text-xs font-medium text-white hover:bg-accent-bright disabled:opacity-40"
          >
            <Plug size={13} /> Conectar
          </button>
        </div>
      </form>
    </div>
  );
}
