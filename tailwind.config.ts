import type { Config } from "tailwindcss";

// Cada token de color se resuelve contra una variable CSS (definida para
// tema oscuro y claro en src/styles/globals.css) en vez de un hex fijo, asi
// los modificadores de opacidad de Tailwind (bg-panel/40, border-ok/30...)
// siguen funcionando igual que antes en los dos temas.
function withOpacity(variable: string) {
  return ({ opacityValue }: { opacityValue?: string }) =>
    opacityValue !== undefined ? `rgb(var(${variable}) / ${opacityValue})` : `rgb(var(${variable}))`;
}

// KRYPTOS design tokens — premium terminal aesthetic, oscuro y claro
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: withOpacity("--kryptos-base"),
        panel: withOpacity("--kryptos-panel"),
        panelAlt: withOpacity("--kryptos-panel-alt"),
        border: withOpacity("--kryptos-border"),
        borderMuted: withOpacity("--kryptos-border-muted"),
        text: {
          DEFAULT: withOpacity("--kryptos-text"),
          muted: withOpacity("--kryptos-text-muted"),
          dim: withOpacity("--kryptos-text-dim"),
        },
        accent: {
          DEFAULT: withOpacity("--kryptos-accent"),
          bright: withOpacity("--kryptos-accent-bright"),
          dim: withOpacity("--kryptos-accent-dim"),
        },
        ok: withOpacity("--kryptos-ok"),
        warn: withOpacity("--kryptos-warn"),
        // Overlay de realce (hover/seleccion) relativo a la superficie que
        // tiene debajo — antes era literalmente "blanco a baja opacidad",
        // lo que en tema claro se volvia invisible. Ver globals.css.
        overlay: withOpacity("--kryptos-overlay"),
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "ui-monospace", "monospace"],
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 24px -6px rgba(255, 59, 59, 0.35)",
        glowSm: "0 0 12px -4px rgba(255, 59, 59, 0.3)",
        panel: "0 1px 0 0 rgba(255,255,255,0.02) inset",
      },
      backdropBlur: {
        xs: "2px",
      },
      keyframes: {
        pulseGlow: {
          "0%, 100%": { opacity: "0.55" },
          "50%": { opacity: "1" },
        },
        fadeIn: {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        breachShake: {
          "0%, 100%": { transform: "translate(0, 0)" },
          "20%": { transform: "translate(-6px, 2px)" },
          "40%": { transform: "translate(5px, -2px)" },
          "60%": { transform: "translate(-4px, -1px)" },
          "80%": { transform: "translate(3px, 2px)" },
        },
      },
      animation: {
        pulseGlow: "pulseGlow 2.4s ease-in-out infinite",
        fadeIn: "fadeIn 0.18s ease-out",
      },
    },
  },
  plugins: [],
} satisfies Config;
