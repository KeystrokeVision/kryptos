export type AppTheme = "dark" | "light";

export const THEME_SETTING_KEY = "app.theme";
const CACHE_KEY = "kryptos.theme";

/**
 * Preferencia cacheada en localStorage para poder aplicar el tema antes de
 * que React siquiera monte (ver main.tsx) — sin esto, cada arranque
 * mostraria un flash del tema oscuro por defecto mientras se espera la
 * respuesta async de api.getSetting(). La fuente de verdad real sigue
 * siendo la base de datos (mismo mecanismo que el resto de Configuracion);
 * esto es solo una copia rapida para el primer pintado.
 */
export function getCachedTheme(): AppTheme {
  try {
    return localStorage.getItem(CACHE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(theme: AppTheme) {
  document.documentElement.classList.toggle("light", theme === "light");
  try {
    localStorage.setItem(CACHE_KEY, theme);
  } catch {
    // localStorage no disponible — la app sigue funcionando, solo no
    // recuerda la eleccion instantaneamente en el proximo arranque.
  }
}
