import type { Config } from "tailwindcss";

// KRYPTOS design tokens — premium dark terminal aesthetic
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "#050505",
        panel: "#0A0A0A",
        panelAlt: "#0D0D0D",
        border: "#222222",
        borderMuted: "#1A1A1A",
        text: {
          DEFAULT: "#EAEAEA",
          muted: "#8A8A8A",
          dim: "#5C5C5C",
        },
        accent: {
          DEFAULT: "#B00020",
          bright: "#FF3B3B",
          dim: "#4A0010",
        },
        ok: "#00D26A",
        warn: "#FFB020",
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
