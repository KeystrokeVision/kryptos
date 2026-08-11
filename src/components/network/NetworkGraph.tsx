import { useEffect, useMemo, useRef, useState } from "react";
import type { ConnectionInfo } from "@/types/network";
import type { ProcessInfo } from "@/types/system";

interface GraphNode {
  id: string;
  label: string;
  kind: "equipo" | "proceso" | "remoto";
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed?: boolean;
}

interface GraphEdge {
  source: string;
  target: string;
}

const KIND_COLOR: Record<GraphNode["kind"], string> = {
  equipo: "#FF3B3B",
  proceso: "#EAEAEA",
  remoto: "#FFB020",
};

const KIND_RADIUS: Record<GraphNode["kind"], number> = { equipo: 9, proceso: 6, remoto: 5 };

/** Direcciones que no representan un extremo remoto real. */
function isRemoteHost(host: string) {
  if (!host) return false;
  const bare = host.replace(/^\[|\]$/g, "");
  return !["0.0.0.0", "*", "127.0.0.1", "::", "::1", ""].includes(bare);
}

function remoteHostOf(addr: string): string | null {
  const idx = addr.lastIndexOf(":");
  const host = idx > 0 ? addr.slice(0, idx) : addr;
  return isRemoteHost(host) ? host.replace(/^\[|\]$/g, "") : null;
}

/**
 * Construye nodos y conexiones a partir de las conexiones activas reales
 * del equipo — nada simulado. Se limita a un maximo de nodos para que el
 * grafo siga siendo legible en vez de convertirse en una maraña.
 */
function buildGraph(connections: ConnectionInfo[], processes: ProcessInfo[], width: number, height: number, maxRemote: number): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const processName = new Map(processes.map((p) => [p.pid, p.name]));
  const cx = width / 2;
  const cy = height / 2;

  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();

  nodes.set("equipo", { id: "equipo", label: "Este equipo", kind: "equipo", x: cx, y: cy, vx: 0, vy: 0, fixed: true });

  let remoteCount = 0;
  for (const conn of connections) {
    if (!conn.pid) continue;
    const remoteHost = remoteHostOf(conn.remote_addr);
    if (!remoteHost) continue;
    if (!nodes.has(remoteHost) && remoteCount >= maxRemote) continue;

    const procId = `p:${conn.pid}`;
    if (!nodes.has(procId)) {
      const angle = Math.random() * Math.PI * 2;
      nodes.set(procId, {
        id: procId,
        label: processName.get(conn.pid) ?? `PID ${conn.pid}`,
        kind: "proceso",
        x: cx + Math.cos(angle) * 60,
        y: cy + Math.sin(angle) * 60,
        vx: 0,
        vy: 0,
      });
      edges.push({ source: "equipo", target: procId });
    }

    if (!nodes.has(remoteHost)) {
      const angle = Math.random() * Math.PI * 2;
      nodes.set(remoteHost, {
        id: remoteHost,
        label: remoteHost,
        kind: "remoto",
        x: cx + Math.cos(angle) * 160,
        y: cy + Math.sin(angle) * 160,
        vx: 0,
        vy: 0,
      });
      remoteCount++;
    }

    const key = `${procId}->${remoteHost}`;
    if (!edgeKeys.has(key)) {
      edgeKeys.add(key);
      edges.push({ source: procId, target: remoteHost });
    }
  }

  return { nodes: Array.from(nodes.values()), edges };
}

interface NetworkGraphProps {
  connections: ConnectionInfo[];
  processes: ProcessInfo[];
  height?: number;
  /** Tope de nodos remotos distintos, para que el grafo no se vuelva ilegible. */
  maxRemote?: number;
}

/**
 * Mapa de red en vivo: este equipo, los procesos con conexiones salientes,
 * y a que host remoto habla cada uno — todo animado con una simulacion de
 * fuerzas ligera (sin librerias externas, el CSP de la app no permite
 * cargar nada desde un CDN). Los datos son los mismos que ya alimentan la
 * tabla de conexiones; esto es otra forma de leerlos, no una fuente nueva.
 */
export function NetworkGraph({ connections, processes, height = 380, maxRemote = 25 }: NetworkGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 600, height });
  const [hovered, setHovered] = useState<string | null>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  const [, forceTick] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ width: Math.max(200, rect.width), height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [height]);

  const graph = useMemo(() => buildGraph(connections, processes, size.width, size.height, maxRemote), [connections, processes, size.width, size.height, maxRemote]);

  // Preserva la posicion de un nodo que ya existia (para que no salte de
  // lugar cada vez que llega una lista de conexiones nueva) y solo asigna
  // posicion inicial a los nodos que aparecen por primera vez.
  useEffect(() => {
    const previous = new Map(nodesRef.current.map((n) => [n.id, n]));
    nodesRef.current = graph.nodes.map((n) => previous.get(n.id) ?? n);
    edgesRef.current = graph.edges;
  }, [graph]);

  useEffect(() => {
    let raf: number;
    const { width, height } = size;
    const cx = width / 2;
    const cy = height / 2;

    function tick() {
      const nodes = nodesRef.current;
      const edges = edgesRef.current;

      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        if (a.fixed) continue;
        let fx = 0;
        let fy = 0;

        // Repulsion entre todos los pares — mantiene los nodos separados.
        for (let j = 0; j < nodes.length; j++) {
          if (i === j) continue;
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const distSq = Math.max(dx * dx + dy * dy, 25);
          const force = 900 / distSq;
          fx += (dx / Math.sqrt(distSq)) * force;
          fy += (dy / Math.sqrt(distSq)) * force;
        }

        // Gravedad suave hacia el centro, para que no se dispersen fuera de vista.
        fx += (cx - a.x) * 0.002;
        fy += (cy - a.y) * 0.002;

        a.vx = (a.vx + fx) * 0.82;
        a.vy = (a.vy + fy) * 0.82;
      }

      // Resortes a lo largo de cada conexion real.
      for (const edge of edges) {
        const a = nodes.find((n) => n.id === edge.source);
        const b = nodes.find((n) => n.id === edge.target);
        if (!a || !b) continue;
        const idealLength = a.kind === "equipo" || b.kind === "equipo" ? 90 : 70;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const stretch = (dist - idealLength) * 0.02;
        const ux = dx / dist;
        const uy = dy / dist;
        if (!a.fixed) {
          a.vx += ux * stretch;
          a.vy += uy * stretch;
        }
        if (!b.fixed) {
          b.vx -= ux * stretch;
          b.vy -= uy * stretch;
        }
      }

      for (const n of nodes) {
        if (n.fixed) continue;
        n.x = Math.min(width - 20, Math.max(20, n.x + n.vx));
        n.y = Math.min(height - 20, Math.max(20, n.y + n.vy));
      }

      forceTick((t) => (t + 1) % 1_000_000);
      raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  const nodes = nodesRef.current;
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  return (
    <div ref={containerRef} className="relative w-full overflow-hidden rounded-md border border-border bg-base" style={{ height }}>
      <svg width={size.width} height={size.height} className="block">
        <g opacity={0.35}>
          {edgesRef.current.map((edge, i) => {
            const a = nodeById.get(edge.source);
            const b = nodeById.get(edge.target);
            if (!a || !b) return null;
            const active = hovered === a.id || hovered === b.id;
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={active ? "#FF3B3B" : "#3a3a3a"}
                strokeWidth={active ? 1.4 : 0.8}
                opacity={active ? 0.9 : 1}
              />
            );
          })}
        </g>
        {nodes.map((n) => {
          const isHovered = hovered === n.id;
          return (
            <g
              key={n.id}
              transform={`translate(${n.x}, ${n.y})`}
              onMouseEnter={() => setHovered(n.id)}
              onMouseLeave={() => setHovered((h) => (h === n.id ? null : h))}
              style={{ cursor: "default" }}
            >
              {n.kind === "equipo" && <circle r={KIND_RADIUS[n.kind] + 5} fill="none" stroke={KIND_COLOR[n.kind]} strokeWidth={1} opacity={0.35} />}
              <circle r={isHovered ? KIND_RADIUS[n.kind] + 2 : KIND_RADIUS[n.kind]} fill={KIND_COLOR[n.kind]} opacity={n.kind === "equipo" ? 1 : 0.85} />
              <text x={0} y={KIND_RADIUS[n.kind] + 11} textAnchor="middle" fontSize={9} fill={isHovered ? "#EAEAEA" : "#8A8A8A"} className="select-none font-mono">
                {n.label.length > 18 ? `${n.label.slice(0, 17)}…` : n.label}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-3 rounded bg-black/40 px-2 py-1 text-[9px] text-text-dim backdrop-blur-sm">
        <Legend color={KIND_COLOR.equipo} label="Este equipo" />
        <Legend color={KIND_COLOR.proceso} label="Proceso" />
        <Legend color={KIND_COLOR.remoto} label="Host remoto" />
      </div>

      {nodes.length <= 1 && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-text-dim">
          Sin conexiones salientes activas ahora mismo.
        </div>
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
