import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { MessageSquare, Server, LogIn, LogOut, Send, AlertTriangle, Users } from "lucide-react";
import { api } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types/chat";

type ConnectionState = "disconnected" | "connecting" | "hosting" | "connected";

export default function Chat() {
  const [state, setState] = useState<ConnectionState>("disconnected");
  const [nick, setNick] = useState("usuario");
  const [port, setPort] = useState("6667");
  const [remoteHost, setRemoteHost] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unlisten = listen<string>("chat://message", (event) => {
      try {
        const msg = JSON.parse(event.payload) as ChatMessage;
        // Los mensajes "status" son el latido de Modo Flota (Centro de
        // Operaciones los escucha aparte via FleetWatcher) — no son texto
        // para mostrar en la conversacion.
        if (msg.kind === "status") return;
        setMessages((prev) => [...prev, msg].slice(-500));
      } catch {
        // ignore malformed lines rather than crash the chat view
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    return () => {
      api.chatDisconnect().catch(() => {});
    };
  }, []);

  async function handleHost() {
    setError(null);
    setState("connecting");
    try {
      await api.chatStartServer(Number(port) || 6667, nick.trim() || "usuario");
      setState("hosting");
      setMessages([]);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      setState("disconnected");
    }
  }

  async function handleConnect() {
    if (!remoteHost.trim()) return;
    setError(null);
    setState("connecting");
    try {
      await api.chatConnect(remoteHost.trim(), Number(port) || 6667, nick.trim() || "usuario");
      setState("connected");
      setMessages([]);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      setState("disconnected");
    }
  }

  async function handleDisconnect() {
    await api.chatDisconnect().catch(() => {});
    setState("disconnected");
  }

  async function sendMessage() {
    if (!draft.trim()) return;
    try {
      await api.chatSendMessage(nick.trim() || "usuario", draft.trim(), false);
      setDraft("");
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    }
  }

  const isActive = state === "hosting" || state === "connected";

  if (!isActive) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-5 p-8">
        <MessageSquare size={30} className="text-accent-bright" />
        <div className="text-center">
          <h2 className="text-sm font-medium text-text">Chat interno</h2>
          <p className="mt-1 max-w-md text-xs text-text-dim">
            Mensajeria simple en tu red local — sin depender de internet ni de un servidor externo. Un equipo
            organiza el chat (host) y los demas se conectan a su direccion IP.
          </p>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent-bright">
            <AlertTriangle size={13} /> {error}
          </div>
        )}

        <div className="w-full max-w-sm space-y-3">
          <input
            value={nick}
            onChange={(e) => setNick(e.target.value)}
            placeholder="Tu nombre en el chat"
            className="h-9 w-full rounded-md border border-border bg-base px-3 text-xs text-text outline-none focus:border-accent/60"
          />

          <div className="rounded-md border border-border bg-panelAlt p-3">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-text">
              <Server size={12} /> Organizar el chat (host)
            </p>
            <div className="flex gap-2">
              <input
                value={port}
                onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
                placeholder="Puerto"
                className="h-8 w-24 rounded-md border border-border bg-base px-2 text-center font-mono text-xs text-text outline-none focus:border-accent/60"
              />
              <button
                onClick={handleHost}
                disabled={state === "connecting"}
                className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-accent text-xs font-medium text-white hover:bg-accent-bright disabled:opacity-40"
              >
                <Server size={12} /> Iniciar servidor
              </button>
            </div>
          </div>

          <div className="rounded-md border border-border bg-panelAlt p-3">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-text">
              <LogIn size={12} /> Conectarse a alguien mas
            </p>
            <div className="flex gap-2">
              <input
                value={remoteHost}
                onChange={(e) => setRemoteHost(e.target.value)}
                placeholder="IP del host"
                className="h-8 flex-1 rounded-md border border-border bg-base px-2 font-mono text-xs text-text outline-none focus:border-accent/60"
              />
              <input
                value={port}
                onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
                placeholder="Puerto"
                className="h-8 w-20 rounded-md border border-border bg-base px-2 text-center font-mono text-xs text-text outline-none focus:border-accent/60"
              />
            </div>
            <button
              onClick={handleConnect}
              disabled={!remoteHost.trim() || state === "connecting"}
              className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-accent/50 text-xs text-accent-bright hover:bg-accent/10 disabled:opacity-40"
            >
              <LogIn size={12} /> Conectar
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-borderMuted bg-panelAlt px-3">
        {state === "hosting" ? <Server size={13} className="text-ok" /> : <Users size={13} className="text-ok" />}
        <span className="text-[11px] text-text">{state === "hosting" ? `Organizando en el puerto ${port}` : `Conectado a ${remoteHost}:${port}`}</span>
        <span className="text-[11px] text-text-dim">como {nick}</span>
        <button onClick={handleDisconnect} className="ml-auto flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-[11px] text-text-muted hover:bg-overlay/[0.04]">
          <LogOut size={12} /> Salir
        </button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="space-y-1.5">
          {messages.map((m, i) =>
            m.kind === "system" ? (
              <p key={i} className="text-center text-[10px] text-text-dim">
                {m.text}
              </p>
            ) : (
              <div key={i} className="flex items-baseline gap-2 text-[12px]">
                <span className={cn("font-medium", m.nick === nick ? "text-accent-bright" : "text-ok")}>{m.nick}</span>
                <span className="text-text">{m.text}</span>
                <span className="ml-auto shrink-0 text-[9px] text-text-dim">{new Date(m.timestampUnix * 1000).toLocaleTimeString()}</span>
              </div>
            )
          )}
          {messages.length === 0 && <p className="text-center text-xs text-text-dim">Sin mensajes todavia.</p>}
        </div>
      </div>

      {error && <p className="border-t border-accent/30 bg-accent/10 px-3 py-1.5 text-[11px] text-accent-bright">{error}</p>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage();
        }}
        className="flex h-12 shrink-0 items-center gap-2 border-t border-borderMuted bg-panelAlt px-2"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Escribe un mensaje..."
          className="h-8 flex-1 rounded-md border border-border bg-base px-3 text-xs text-text outline-none focus:border-accent/60"
        />
        <button type="submit" disabled={!draft.trim()} className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-bright disabled:opacity-40">
          <Send size={12} />
        </button>
      </form>
    </div>
  );
}
