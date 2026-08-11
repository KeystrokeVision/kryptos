import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { generateDemoLine } from "@/lib/demoLines";
import { MatrixRain } from "@/components/layout/MatrixRain";

interface FakeWindowProps {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  speed: number;
}

function FakeWindow({ x, y, w, h, title, speed }: FakeWindowProps) {
  const [lines, setLines] = useState<string[]>([]);
  const maxLines = Math.floor(h / 15);

  useEffect(() => {
    const interval = setInterval(() => {
      setLines((prev) => {
        const next = [...prev, generateDemoLine()];
        return next.length > maxLines ? next.slice(next.length - maxLines) : next;
      });
    }, speed);
    return () => clearInterval(interval);
  }, [speed, maxLines]);

  return (
    <div
      style={{ left: x, top: y, width: w, height: h }}
      className="absolute overflow-hidden rounded-md border border-ok/30 bg-black/95 shadow-[0_0_30px_rgba(0,0,0,0.6)]"
    >
      <div className="flex h-6 items-center gap-1.5 border-b border-white/10 bg-white/5 px-2">
        <span className="h-2 w-2 rounded-full bg-[#ff5f56]" />
        <span className="h-2 w-2 rounded-full bg-[#ffbd2e]" />
        <span className="h-2 w-2 rounded-full bg-[#27c93f]" />
        <span className="ml-2 truncate font-mono text-[9px] text-white/40">{title}</span>
      </div>
      <div className="p-1.5 font-mono text-[10px] leading-tight text-ok">
        {lines.map((l, i) => (
          <div key={i} className="whitespace-nowrap">
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}

const WINDOW_TITLES = ["node_sync.exe", "trace_monitor", "packet_cap", "sys_diag", "buffer_watch", "kernel_log"];

export function HackerDemoOverlay({ onClose }: { onClose: () => void }) {
  const [windows, setWindows] = useState<FakeWindowProps[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);

    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    const count = 5;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i < count; i++) {
      const timer = setTimeout(() => {
        setWindows((prev) => [
          ...prev,
          {
            x: 40 + Math.random() * (screenW - 500),
            y: 40 + Math.random() * (screenH - 320),
            w: 380 + Math.random() * 220,
            h: 200 + Math.random() * 140,
            title: WINDOW_TITLES[i % WINDOW_TITLES.length],
            speed: 55 + Math.random() * 90,
          },
        ]);
      }, i * 280);
      timers.push(timer);
    }
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      timers.forEach(clearTimeout);
    };
  }, [onClose]);

  return createPortal(
    <div ref={containerRef} className="fixed inset-0 z-[200] overflow-hidden bg-black/70">
      <MatrixRain className="absolute inset-0 opacity-40" />
      {windows.map((w, i) => (
        <FakeWindow key={i} {...w} />
      ))}

      <div className="absolute left-1/2 top-6 z-10 flex -translate-x-1/2 items-center gap-3 rounded-full border border-white/10 bg-black/80 px-4 py-2">
        <span className="text-[11px] text-white/70">
          Efecto visual — <span className="text-accent-bright">no ejecuta nada real</span> (Esc para salir)
        </span>
        <button onClick={onClose} className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[10px] text-white hover:bg-white/20">
          <X size={11} /> Salir
        </button>
      </div>
    </div>,
    document.body
  );
}
