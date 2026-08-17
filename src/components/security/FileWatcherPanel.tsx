import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { isPermissionGranted, sendNotification } from "@tauri-apps/plugin-notification";
import { open } from "@tauri-apps/plugin-dialog";
import { Eye, EyeOff, FolderOpen, FilePlus2, FileEdit, FileMinus2, AlertTriangle, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { api } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { FileWatchEvent } from "@/types/filewatch";

interface LogLine extends FileWatchEvent {
  time: number;
}

const KIND_ICON = { created: FilePlus2, modified: FileEdit, removed: FileMinus2, error: AlertTriangle };
const KIND_TONE = { created: "text-ok", modified: "text-warn", removed: "text-accent-bright", error: "text-accent-bright" };

let counter = 0;
const nextWatchId = () => `watch-${Date.now()}-${counter++}`;

export function FileWatcherPanel() {
  const [path, setPath] = useState("");
  const [watchId, setWatchId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const watchIdRef = useRef<string | null>(null);

  useEffect(() => {
    const unlisten = listen<FileWatchEvent>("filewatch://event", (event) => {
      if (event.payload.watchId !== watchIdRef.current) return;
      setLog((prev) => [{ ...event.payload, time: Date.now() }, ...prev].slice(0, 200));

      if (event.payload.kind !== "error") {
        isPermissionGranted().then((granted) => {
          if (!granted) return;
          const fileName = event.payload.paths[0]?.split(/[\\/]/).pop() ?? "";
          sendNotification({
            title: "KRYPTOS — Vigilante de archivos",
            body: `${event.payload.kind}: ${fileName}`,
          });
        });
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  useEffect(() => {
    return () => {
      if (watchIdRef.current) api.stopFileWatch(watchIdRef.current).catch(() => {});
    };
  }, []);

  async function pickFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") setPath(selected);
  }

  async function startWatch() {
    if (!path.trim()) return;
    setError(null);
    const id = nextWatchId();
    try {
      await api.startFileWatch(id, path.trim());
      setWatchId(id);
      watchIdRef.current = id;
      setLog([]);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    }
  }

  async function stopWatch() {
    if (!watchId) return;
    await api.stopFileWatch(watchId).catch(() => {});
    setWatchId(null);
    watchIdRef.current = null;
  }

  return (
    <div className="h-full overflow-y-auto p-5">
      <Card title="Vigilante de archivos en tiempo real">
        <div className="space-y-4">
          <p className="text-xs text-text-dim">
            Vigila una carpeta critica (config del sistema, un directorio sensible) y te avisa al instante si algo se
            crea, modifica o elimina dentro de ella — util para detectar cambios no esperados mientras trabajas.
          </p>

          <div className="flex gap-2">
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              disabled={!!watchId}
              placeholder="Carpeta a vigilar..."
              className="h-8 flex-1 rounded-md border border-border bg-base px-2.5 font-mono text-xs text-text outline-none focus:border-accent/60 disabled:opacity-50"
            />
            <button
              onClick={pickFolder}
              disabled={!!watchId}
              className="flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-text-muted hover:bg-overlay/[0.04] disabled:opacity-50"
            >
              <FolderOpen size={13} />
            </button>
            {watchId ? (
              <button onClick={stopWatch} className="flex h-8 items-center gap-1.5 rounded-md border border-accent/50 px-3 text-xs font-medium text-accent-bright hover:bg-accent/10">
                <EyeOff size={13} /> Detener
              </button>
            ) : (
              <button
                onClick={startWatch}
                disabled={!path.trim()}
                className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-bright disabled:opacity-40"
              >
                <Eye size={13} /> Vigilar
              </button>
            )}
          </div>

          {error && <p className="text-xs text-accent-bright">{error}</p>}

          {watchId && (
            <div className="flex items-center gap-2 rounded-md border border-ok/30 bg-ok/5 px-3 py-1.5 text-[11px] text-ok">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ok" />
              Vigilando activamente...
            </div>
          )}

          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-widest text-text-dim">Eventos ({log.length})</p>
            {log.length > 0 && (
              <button onClick={() => setLog([])} className="flex items-center gap-1 text-[10px] text-text-dim hover:text-text">
                <Trash2 size={10} /> Limpiar
              </button>
            )}
          </div>

          <div className="space-y-1">
            {log.map((entry, i) => {
              const Icon = KIND_ICON[entry.kind];
              return (
                <div key={i} className="flex items-start gap-2 rounded-md border border-border bg-base px-2.5 py-1.5 text-[11px]">
                  <Icon size={12} className={cn("mt-0.5 shrink-0", KIND_TONE[entry.kind])} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={cn("font-medium", KIND_TONE[entry.kind])}>{entry.kind}</span>
                      <span className="text-text-dim">{new Date(entry.time).toLocaleTimeString()}</span>
                    </div>
                    {entry.paths.map((p, j) => (
                      <p key={j} className="truncate font-mono text-[10px] text-text-muted">
                        {p}
                      </p>
                    ))}
                  </div>
                </div>
              );
            })}
            {log.length === 0 && <p className="text-xs text-text-dim">Sin eventos todavia.</p>}
          </div>
        </div>
      </Card>
    </div>
  );
}
