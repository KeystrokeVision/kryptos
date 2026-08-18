import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { isEnabled as isAutostartEnabled, enable as enableAutostart, disable as disableAutostart } from "@tauri-apps/plugin-autostart";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { getVersion } from "@tauri-apps/api/app";
import { check as checkForUpdate, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  Settings as SettingsIcon,
  FolderOpen,
  TerminalSquare,
  Info,
  Check,
  Power,
  BellRing,
  Radar,
  Palette,
  Sun,
  Moon,
  DownloadCloud,
  RefreshCw,
  PartyPopper,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { api } from "@/lib/tauri";
import { TERMINAL_THEMES, DEFAULT_TERMINAL_THEME_ID } from "@/lib/terminalThemes";
import { applyTheme, getCachedTheme, THEME_SETTING_KEY, type AppTheme } from "@/lib/theme";

type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "up-to-date" }
  | { status: "available"; update: Update }
  | { status: "downloading"; percent: number | null }
  | { status: "ready" }
  | { status: "error"; message: string };

const DEFAULT_SHELL_KEY = "terminal.default_shell";
const TERMINAL_THEME_KEY = "terminal.theme";
const SENTINEL_AUTOSTART_KEY = "sentinel.autostart_with_app";

export default function Settings() {
  const [savedFlash, setSavedFlash] = useState(false);
  const [themeSavedFlash, setThemeSavedFlash] = useState(false);
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [notifPermission, setNotifPermission] = useState<"granted" | "denied" | "default" | null>(null);
  const [sentinelAutostart, setSentinelAutostart] = useState<boolean | null>(null);
  const [appTheme, setAppTheme] = useState<AppTheme>(getCachedTheme());
  const [appVersion, setAppVersion] = useState<string>("");
  const [updateState, setUpdateState] = useState<UpdateState>({ status: "idle" });

  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion(""));
  }, []);

  async function handleCheckForUpdate() {
    setUpdateState({ status: "checking" });
    try {
      const update = await checkForUpdate();
      setUpdateState(update ? { status: "available", update } : { status: "up-to-date" });
    } catch (err) {
      setUpdateState({ status: "error", message: String(err) });
    }
  }

  async function handleInstallUpdate(update: Update) {
    setUpdateState({ status: "downloading", percent: null });
    try {
      let downloaded = 0;
      let total = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setUpdateState({ status: "downloading", percent: total > 0 ? Math.round((downloaded / total) * 100) : null });
        } else if (event.event === "Finished") {
          setUpdateState({ status: "ready" });
        }
      });
      setUpdateState({ status: "ready" });
    } catch (err) {
      setUpdateState({ status: "error", message: String(err) });
    }
  }

  useEffect(() => {
    api
      .getSetting(THEME_SETTING_KEY)
      .then((v) => {
        if (v === "light" || v === "dark") setAppTheme(v);
      })
      .catch(() => {});
  }, []);

  async function chooseTheme(next: AppTheme) {
    setAppTheme(next);
    applyTheme(next);
    try {
      await api.setSetting(THEME_SETTING_KEY, next);
    } catch {
      // el tema ya se aplico visualmente; si esto falla, el proximo
      // arranque cae de nuevo al ultimo valor que si se guardo bien.
    }
  }

  useEffect(() => {
    isAutostartEnabled().then(setAutostart).catch(() => setAutostart(false));
    isPermissionGranted()
      .then((granted) => setNotifPermission(granted ? "granted" : "default"))
      .catch(() => setNotifPermission("default"));
    api
      .getSetting(SENTINEL_AUTOSTART_KEY)
      .then((v) => setSentinelAutostart(v === "true"))
      .catch(() => setSentinelAutostart(false));
  }, []);

  async function toggleSentinelAutostart() {
    const next = !sentinelAutostart;
    try {
      await api.setSetting(SENTINEL_AUTOSTART_KEY, String(next));
      setSentinelAutostart(next);
    } catch {
      // el interruptor se queda como estaba si no se pudo guardar
    }
  }

  async function toggleAutostart() {
    try {
      if (autostart) {
        await disableAutostart();
        setAutostart(false);
      } else {
        await enableAutostart();
        setAutostart(true);
      }
    } catch {
      // leave the toggle as-is; the OS may have blocked the request
    }
  }

  async function askNotificationPermission() {
    try {
      const result = await requestPermission();
      setNotifPermission(result);
    } catch {
      setNotifPermission("denied");
    }
  }

  const { data: dataDir } = useQuery({ queryKey: ["settings", "data-dir"], queryFn: api.getDataDirectory });
  const { data: shells } = useQuery({ queryKey: ["terminal", "shells"], queryFn: api.listAvailableShells });
  const { data: defaultShellSetting } = useQuery({
    queryKey: ["settings", DEFAULT_SHELL_KEY],
    queryFn: () => api.getSetting(DEFAULT_SHELL_KEY),
  });

  const [selectedShell, setSelectedShell] = useState<string>("");
  useEffect(() => {
    if (defaultShellSetting) setSelectedShell(defaultShellSetting);
  }, [defaultShellSetting]);

  const saveShellMutation = useMutation({
    mutationFn: (value: string) => api.setSetting(DEFAULT_SHELL_KEY, value),
    onSuccess: () => {
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    },
  });

  const { data: themeSetting } = useQuery({
    queryKey: ["settings", TERMINAL_THEME_KEY],
    queryFn: () => api.getSetting(TERMINAL_THEME_KEY),
  });
  const [selectedTheme, setSelectedTheme] = useState<string>(DEFAULT_TERMINAL_THEME_ID);
  useEffect(() => {
    if (themeSetting) setSelectedTheme(themeSetting);
  }, [themeSetting]);
  const saveThemeMutation = useMutation({
    mutationFn: (value: string) => api.setSetting(TERMINAL_THEME_KEY, value),
    onSuccess: () => {
      setThemeSavedFlash(true);
      setTimeout(() => setThemeSavedFlash(false), 1500);
    },
  });

  return (
    <div className="h-full space-y-4 overflow-y-auto p-5">
      <div className="flex items-center gap-2">
        <SettingsIcon size={16} className="text-accent-bright" />
        <h2 className="text-sm font-medium text-text">Configuracion</h2>
      </div>

      <Card title="Apariencia">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-text-dim">
            <Palette size={13} />
            Tema de la aplicacion
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={() => chooseTheme("dark")}
              className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border text-xs ${
                appTheme === "dark" ? "border-accent bg-accent/10 text-text" : "border-border text-text-muted hover:bg-overlay/[0.04]"
              }`}
            >
              <Moon size={13} /> Oscuro
            </button>
            <button
              onClick={() => chooseTheme("light")}
              className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border text-xs ${
                appTheme === "light" ? "border-accent bg-accent/10 text-text" : "border-border text-text-muted hover:bg-overlay/[0.04]"
              }`}
            >
              <Sun size={13} /> Claro
            </button>
          </div>
          <p className="text-[10px] text-text-dim">
            Oscuro es el tema original de KRYPTOS. La Terminal y el Modo Hacker mantienen su propia estetica siempre
            oscura, independiente de esto.
          </p>
        </div>
      </Card>

      <Card title="Datos locales">
        <div className="space-y-2 text-xs">
          <p className="text-text-dim">
            KRYPTOS guarda todo localmente en este equipo — base de datos, lineas base de integridad, iconos de
            aplicaciones. Nada se sincroniza ni se envia a ningun lado.
          </p>
          <div className="flex items-center gap-2">
            <FolderOpen size={13} className="shrink-0 text-text-dim" />
            <code className="flex-1 truncate rounded bg-base px-2 py-1 font-mono text-[11px] text-text-muted">
              {dataDir ?? "Cargando..."}
            </code>
            <button
              onClick={() => dataDir && api.openInFileManager(dataDir)}
              disabled={!dataDir}
              className="h-7 shrink-0 rounded-md border border-border px-2.5 text-[11px] text-text-muted hover:bg-overlay/[0.04] disabled:opacity-40"
            >
              Abrir carpeta
            </button>
          </div>
        </div>
      </Card>

      <Card title="Terminal">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-text-dim">
            <TerminalSquare size={13} />
            Shell por defecto para pestanas nuevas
          </div>
          <div className="flex items-center gap-2">
            <select
              value={selectedShell}
              onChange={(e) => setSelectedShell(e.target.value)}
              className="h-8 flex-1 rounded-md border border-border bg-base px-2 text-xs text-text outline-none"
            >
              <option value="">Automatico (primero disponible)</option>
              {(shells ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <button
              onClick={() => saveShellMutation.mutate(selectedShell)}
              disabled={saveShellMutation.isPending}
              className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-bright disabled:opacity-40"
            >
              {savedFlash ? <Check size={13} /> : null}
              {savedFlash ? "Guardado" : "Guardar"}
            </button>
          </div>

          <div className="flex items-center gap-2 border-t border-borderMuted pt-3 text-xs text-text-dim">
            <Palette size={13} />
            Tema de color (aplica a las pestanas nuevas)
          </div>
          <div className="flex flex-wrap gap-1.5">
            {TERMINAL_THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedTheme(t.id)}
                className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] ${
                  selectedTheme === t.id ? "border-accent bg-accent/10 text-text" : "border-border text-text-muted hover:bg-overlay/[0.04]"
                }`}
              >
                <span className="flex gap-0.5">
                  <span className="h-3 w-3 rounded-sm" style={{ background: t.theme.red }} />
                  <span className="h-3 w-3 rounded-sm" style={{ background: t.theme.green }} />
                  <span className="h-3 w-3 rounded-sm" style={{ background: t.theme.blue }} />
                </span>
                {t.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => saveThemeMutation.mutate(selectedTheme)}
            disabled={saveThemeMutation.isPending}
            className="flex h-8 w-fit items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-bright disabled:opacity-40"
          >
            {themeSavedFlash ? <Check size={13} /> : null}
            {themeSavedFlash ? "Guardado" : "Guardar tema"}
          </button>
        </div>
      </Card>

      <Card title="Inicio y notificaciones">
        <div className="space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-text-dim">
              <Power size={13} />
              <span>Iniciar KRYPTOS automaticamente con Windows</span>
            </div>
            <button
              onClick={toggleAutostart}
              disabled={autostart === null}
              className={`h-6 w-11 shrink-0 rounded-full transition-colors ${autostart ? "bg-accent" : "bg-overlay/10"} disabled:opacity-40`}
              aria-label="Alternar inicio automatico"
            >
              <span className={`block h-5 w-5 rounded-full bg-white transition-transform ${autostart ? "translate-x-5" : "translate-x-0.5"}`} />
            </button>
          </div>
          <p className="text-[10px] text-text-dim">
            Apagado por defecto. Vos decides — nunca se activa sin que lo prendas aqui.
          </p>
          <p className="rounded-md border border-borderMuted bg-base px-2.5 py-2 text-[10px] text-text-dim">
            Nota: cerrar esta ventana (la X) ahora minimiza KRYPTOS a la bandeja del sistema en vez de cerrarlo — asi
            el Vigilante de archivos y otras tareas de fondo siguen corriendo. Para salir del todo, click derecho en
            el icono de la bandeja y elegi "Salir de KRYPTOS".
          </p>

          <div className="flex items-center justify-between border-t border-borderMuted pt-3">
            <div className="flex items-center gap-2 text-text-dim">
              <BellRing size={13} />
              <span>Notificaciones nativas (ej. Vigilante de archivos)</span>
            </div>
            {notifPermission === "granted" ? (
              <span className="flex items-center gap-1 text-[11px] text-ok">
                <Check size={11} /> Permitidas
              </span>
            ) : (
              <button onClick={askNotificationPermission} className="h-7 rounded-md border border-border px-2.5 text-[11px] text-text-muted hover:bg-overlay/[0.04]">
                Permitir
              </button>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-borderMuted pt-3">
            <div className="flex items-center gap-2 text-text-dim">
              <Radar size={13} />
              <span>Iniciar Sentinel (vigilancia continua) al abrir KRYPTOS</span>
            </div>
            <button
              onClick={toggleSentinelAutostart}
              disabled={sentinelAutostart === null}
              className={`h-6 w-11 shrink-0 rounded-full transition-colors ${sentinelAutostart ? "bg-accent" : "bg-overlay/10"} disabled:opacity-40`}
              aria-label="Alternar inicio automatico de Sentinel"
            >
              <span className={`block h-5 w-5 rounded-full bg-white transition-transform ${sentinelAutostart ? "translate-x-5" : "translate-x-0.5"}`} />
            </button>
          </div>
          <p className="text-[10px] text-text-dim">
            Apagado por defecto. Si lo prendes, la vigilancia arranca sola cada vez que abras la app, sin que tengas
            que ir a Seguridad y presionar "Iniciar".
          </p>
        </div>
      </Card>

      <Card title="Acerca de">
        <div className="flex items-start gap-3 text-xs">
          <Info size={14} className="mt-0.5 shrink-0 text-text-dim" />
          <div className="space-y-1 text-text-dim">
            <p className="text-text">KRYPTOS {appVersion ? `v${appVersion}` : ""}</p>
            <p>Terminal y suite de administracion/seguridad de sistemas construida con Tauri, React y Rust.</p>
            <p>21 modulos — ver el README del proyecto para el listado completo.</p>
          </div>
        </div>
      </Card>

      <Card title="Actualizaciones">
        <div className="space-y-3 text-xs">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-text-dim">
              <DownloadCloud size={13} />
              <span>Buscar una version nueva en GitHub Releases</span>
            </div>
            <button
              onClick={handleCheckForUpdate}
              disabled={updateState.status === "checking" || updateState.status === "downloading"}
              className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 text-[11px] text-text-muted hover:bg-overlay/[0.04] disabled:opacity-40"
            >
              <RefreshCw size={12} className={updateState.status === "checking" ? "animate-spin" : ""} />
              {updateState.status === "checking" ? "Buscando..." : "Buscar actualizaciones"}
            </button>
          </div>

          {updateState.status === "up-to-date" && (
            <p className="flex items-center gap-1.5 rounded-md border border-ok/30 bg-ok/10 px-2.5 py-2 text-[11px] text-ok">
              <Check size={12} /> Ya tenes la ultima version
            </p>
          )}

          {updateState.status === "error" && (
            <p className="rounded-md border border-warn/30 bg-warn/10 px-2.5 py-2 text-[11px] text-warn">
              No se pudo chequear: {updateState.message}
            </p>
          )}

          {updateState.status === "available" && (
            <div className="space-y-2 rounded-md border border-accent/40 bg-accent/10 px-2.5 py-2">
              <p className="text-[11px] text-text">
                Nueva version disponible: <span className="font-medium">v{updateState.update.version}</span>
                {appVersion ? <span className="text-text-dim"> (tenes v{appVersion})</span> : null}
              </p>
              {updateState.update.body ? (
                <p className="whitespace-pre-line text-[10px] text-text-dim">{updateState.update.body}</p>
              ) : null}
              <button
                onClick={() => handleInstallUpdate(updateState.update)}
                className="flex h-7 items-center gap-1.5 rounded-md bg-accent px-2.5 text-[11px] font-medium text-white hover:bg-accent-bright"
              >
                <DownloadCloud size={12} /> Descargar e instalar
              </button>
            </div>
          )}

          {updateState.status === "downloading" && (
            <div className="space-y-1.5 rounded-md border border-border bg-base px-2.5 py-2">
              <p className="text-[11px] text-text-dim">Descargando actualizacion...</p>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-overlay/10">
                <div
                  className="h-full rounded-full bg-accent transition-all"
                  style={{ width: updateState.percent !== null ? `${updateState.percent}%` : "35%" }}
                />
              </div>
            </div>
          )}

          {updateState.status === "ready" && (
            <div className="space-y-2 rounded-md border border-ok/30 bg-ok/10 px-2.5 py-2">
              <p className="flex items-center gap-1.5 text-[11px] text-ok">
                <PartyPopper size={12} /> Instalada. Reinicia KRYPTOS para terminar.
              </p>
              <button
                onClick={() => relaunch()}
                className="flex h-7 items-center gap-1.5 rounded-md bg-accent px-2.5 text-[11px] font-medium text-white hover:bg-accent-bright"
              >
                <RefreshCw size={12} /> Reiniciar ahora
              </button>
            </div>
          )}

          <p className="text-[10px] text-text-dim">
            Nunca se descarga ni instala nada sin que lo pidas aca. Los paquetes se verifican con firma Ed25519 antes
            de instalarse — si la firma no coincide con la clave publica embebida, la instalacion se rechaza.
          </p>
        </div>
      </Card>
    </div>
  );
}
