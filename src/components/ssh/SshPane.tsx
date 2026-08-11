import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { SearchAddon } from "xterm-addon-search";
import { WebLinksAddon } from "xterm-addon-web-links";
import { listen } from "@tauri-apps/api/event";
import { api } from "@/lib/tauri";
import type { SshConnectParams, SshOutputEvent, SshExitEvent } from "@/types/ssh";
import "xterm/css/xterm.css";

const XTERM_THEME = {
  background: "#00000000",
  foreground: "#FF5B5B",
  cursor: "#FF3B3B",
  cursorAccent: "#050505",
  selectionBackground: "rgba(255, 59, 59, 0.28)",
  black: "#0A0A0A",
  red: "#FF3B3B",
  green: "#00D26A",
  yellow: "#FFB020",
  blue: "#5B9BFF",
  magenta: "#C77DFF",
  cyan: "#3BD1D6",
  white: "#EAEAEA",
  brightBlack: "#5C5C5C",
  brightRed: "#FF6B6B",
  brightGreen: "#3EE58F",
  brightYellow: "#FFC94D",
  brightBlue: "#84B4FF",
  brightMagenta: "#D9A6FF",
  brightCyan: "#6FE0E4",
  brightWhite: "#FFFFFF",
};

export interface SshPaneHandle {
  focus: () => void;
  clear: () => void;
}

interface SshPaneProps {
  sessionId: string;
  connectParams: SshConnectParams;
  onExit?: (errorMessage: string | null) => void;
  onReady?: (handle: SshPaneHandle) => void;
}

/**
 * One xterm.js instance bound to one real SSH session. Same lifecycle
 * shape as TerminalPane: connect on mount, stream remote output in,
 * forward keystrokes out over the SSH channel, resize on layout changes,
 * and disconnect on unmount.
 */
export function SshPane({ sessionId, connectParams, onExit, onReady }: SshPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;

    const term = new XTerm({
      convertEol: true,
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
      fontSize: 13,
      theme: XTERM_THEME,
      scrollback: 10000,
      allowProposedApi: true,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new SearchAddon());
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    fitAddon.fit();

    term.writeln("\x1b[1;31mKRYPTOS SSH\x1b[0m");
    term.writeln(`\x1b[0;31mConectando a ${connectParams.username}@${connectParams.host}:${connectParams.port}...\x1b[0m\r\n`);

    const dataSub = term.onData((data) => {
      api.writeToSshSession(sessionId, data).catch(() => {});
    });

    let unlistenOutput: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;
    let resizeObserver: ResizeObserver | undefined;

    (async () => {
      unlistenOutput = await listen<SshOutputEvent>("ssh://output", (event) => {
        if (event.payload.sessionId === sessionId) term.write(event.payload.data);
      });
      unlistenExit = await listen<SshExitEvent>("ssh://exit", (event) => {
        if (event.payload.sessionId === sessionId) {
          term.writeln(`\r\n\x1b[2m[sesion SSH finalizada]\x1b[0m`);
          onExit?.(event.payload.errorMessage);
        }
      });

      if (disposed) return;

      try {
        await api.createSshSession(sessionId, connectParams, term.cols, term.rows);
      } catch (err) {
        term.writeln(`\r\n\x1b[31m[kryptos] No se pudo conectar: ${String(err)}\x1b[0m`);
        onExit?.(String(err));
        return;
      }

      onReady?.({ focus: () => term.focus(), clear: () => term.clear() });
      term.focus();
    })();

    resizeObserver = new ResizeObserver(() => {
      if (!containerRef.current) return;
      fitAddon.fit();
      api.resizeSshSession(sessionId, term.cols, term.rows).catch(() => {});
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      disposed = true;
      dataSub.dispose();
      unlistenOutput?.();
      unlistenExit?.();
      resizeObserver?.disconnect();
      term.dispose();
      api.closeSshSession(sessionId).catch(() => {});
    };
    // sessionId identifies the session 1:1 with this pane; connectParams
    // only matters at creation time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  return <div ref={containerRef} className="h-full w-full px-2 py-1.5" />;
}
