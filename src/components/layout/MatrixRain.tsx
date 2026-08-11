import { useEffect, useRef } from "react";

const GLYPHS = "01ABCDEF#$%&*+-/\\<>{}[]?!:;アイウエオカキクケコサシスセソ".split("");
const FONT_SIZE = 16;

/**
 * Fondo de "lluvia digital" en canvas, en rojo para que combine con la
 * identidad visual de KRYPTOS en vez del verde clasico de las peliculas.
 * Puramente decorativo — usado en el Modo demo (HackerDemoOverlay) y
 * pensado para reusarse en cualquier otro efecto visual futuro. Respeta
 * prefers-reduced-motion quedandose quieto en vez de animar.
 */
export function MatrixRain({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;

    let width = 0;
    let height = 0;
    let drops: number[] = [];

    function resize() {
      const parent = canvas!.parentElement;
      width = canvas!.width = parent ? parent.clientWidth : window.innerWidth;
      height = canvas!.height = parent ? parent.clientHeight : window.innerHeight;
      const columns = Math.ceil(width / FONT_SIZE);
      drops = new Array(columns).fill(0).map(() => Math.random() * -40);
    }
    resize();
    window.addEventListener("resize", resize);

    let raf: ReturnType<typeof setInterval>;
    function draw() {
      ctx!.fillStyle = "rgba(5, 5, 5, 0.14)";
      ctx!.fillRect(0, 0, width, height);
      ctx!.font = `${FONT_SIZE}px 'JetBrains Mono', monospace`;
      for (let i = 0; i < drops.length; i++) {
        const glyph = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        const x = i * FONT_SIZE;
        const y = drops[i] * FONT_SIZE;
        const atHead = Math.random() > 0.95;
        ctx!.fillStyle = atHead ? "rgba(255, 235, 235, 0.85)" : `rgba(255, 59, 59, ${0.2 + Math.random() * 0.35})`;
        ctx!.fillText(glyph, x, y);
        if (y > height && Math.random() > 0.975) drops[i] = 0;
        drops[i] += 0.5 + Math.random() * 0.3;
      }
    }
    raf = setInterval(draw, 50);

    return () => {
      window.removeEventListener("resize", resize);
      clearInterval(raf);
    };
  }, []);

  return <canvas ref={canvasRef} className={className} />;
}
