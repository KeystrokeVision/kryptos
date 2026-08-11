import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { SearchAddon } from "xterm-addon-search";
import { WebLinksAddon } from "xterm-addon-web-links";
import { listen } from "@tauri-apps/api/event";
import { api } from "@/lib/tauri";
import { getTerminalTheme } from "@/lib/terminalThemes";
import type { TerminalExitEvent, TerminalOutputEvent } from "@/types/terminal";
import "xterm/css/xterm.css";

const RED = "\x1b[1;31m";
const DIM_RED = "\x1b[0;31m";
const RESET = "\x1b[0m";

/**
 * Prints the KRYPTOS banner + real system info at the top of a fresh
 * terminal session, before the shell prompt shows up — purely cosmetic,
 * backed by actual data from get_system_snapshot (not placeholder text).
 */
async function writeKryptosBanner(term: XTerm, sessionId: string) {
  const line = (text = "") => term.writeln(`${RED}${text}${RESET}`);
  line();
  line("██╗  ██╗██████╗ ██╗   ██╗██████╗ ████████╗ ██████╗ ███████╗");
  line("██║ ██╔╝██╔══██╗╚██╗ ██╔╝██╔══██╗╚══██╔══╝██╔═══██╗██╔════╝");
  line("█████╔╝ ██████╔╝ ╚████╔╝ ██████╔╝   ██║   ██║   ██║███████╗");
  line("██╔═██╗ ██╔══██╗  ╚██╔╝  ██╔═══╝    ██║   ██║   ██║╚════██║");
  line("██║  ██╗██║  ██║   ██║   ██║        ██║   ╚██████╔╝███████║");
  line("╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   ╚═╝        ╚═╝    ╚═════╝ ╚══════╝");
  line();

  try {
    const snap = await api.getSystemSnapshot();
    term.writeln(`${DIM_RED}SISTEMA:  ${RESET}${snap.os_name} ${snap.os_version}`);
    term.writeln(`${DIM_RED}EQUIPO:   ${RESET}${snap.hostname}`);
    term.writeln(`${DIM_RED}SESION:   ${RESET}${sessionId}`);
    term.writeln(`${DIM_RED}FECHA:    ${RESET}${new Date().toLocaleString()}`);
  } catch {
    // Snapshot fetch failing is not worth blocking the terminal over —
    // just skip the info lines and carry on to the shell.
  }
  line("─────────────────────────────────────────────────────────────");
  term.writeln("");
}

export interface TerminalPaneHandle {
  focus: () => void;
  clear: () => void;
  findNext: (term: string) => void;
  findPrevious: (term: string) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  copySelection: () => void;
  pasteFromClipboard: () => void;
  writeText: (text: string) => void;
}

interface TerminalPaneProps {
  sessionId: string;
  shell?: string;
  cwd?: string;
  themeId?: string;
  onExit?: () => void;
  onReady?: (handle: TerminalPaneHandle) => void;
}

/**
 * Owns one xterm.js instance wired to one PTY session created via
 * create_terminal_session. Handles the full lifecycle: spawn on mount,
 * stream output in, forward keystrokes out, resize on layout changes, and
 * tear the PTY down on unmount.
 */
export function TerminalPane({ sessionId, shell, cwd, themeId, onExit, onReady }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const fontSizeRef = useRef(13);

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;

    const term = new XTerm({
      convertEol: true,
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
      fontSize: fontSizeRef.current,
      theme: getTerminalTheme(themeId),
      scrollback: 10000,
      allowProposedApi: true,
    });
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitRef.current = fitAddon;
    searchRef.current = searchAddon;

    const dataSub = term.onData((data) => {
      api.writeToTerminal(sessionId, data).catch(() => {
        term.writeln("\r\n\x1b[31m[kryptos] No se pudo enviar la entrada a la terminal.\x1b[0m");
      });
    });

    let unlistenOutput: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;
    let resizeObserver: ResizeObserver | undefined;

    (async () => {
      unlistenOutput = await listen<TerminalOutputEvent>("terminal://output", (event) => {
        if (event.payload.sessionId === sessionId) {
          term.write(event.payload.data);
        }
      });
      unlistenExit = await listen<TerminalExitEvent>("terminal://exit", (event) => {
        if (event.payload.sessionId === sessionId) {
          term.writeln("\r\n\x1b[2m[proceso finalizado]\x1b[0m");
          onExit?.();
        }
      });

      if (disposed) return;

      await writeKryptosBanner(term, sessionId);

      try {
        await api.createTerminalSession(sessionId, term.cols, term.rows, shell, cwd);
      } catch (err) {
        term.writeln(`\r\n\x1b[31m[kryptos] No se pudo iniciar la terminal: ${String(err)}\x1b[0m`);
        return;
      }

      onReady?.({
        focus: () => term.focus(),
        clear: () => term.clear(),
        findNext: (term: string) => searchAddon.findNext(term),
        findPrevious: (term: string) => searchAddon.findPrevious(term),
        zoomIn: () => {
          fontSizeRef.current = Math.min(fontSizeRef.current + 1, 28);
          term.options.fontSize = fontSizeRef.current;
          fitAddon.fit();
        },
        zoomOut: () => {
          fontSizeRef.current = Math.max(fontSizeRef.current - 1, 9);
          term.options.fontSize = fontSizeRef.current;
          fitAddon.fit();
        },
        copySelection: () => {
          const selection = term.getSelection();
          if (selection) navigator.clipboard.writeText(selection).catch(() => {});
        },
        pasteFromClipboard: () => {
          navigator.clipboard
            .readText()
            .then((text) => {
              if (text) api.writeToTerminal(sessionId, text).catch(() => {});
            })
            .catch(() => {});
        },
        writeText: (text: string) => {
          api.writeToTerminal(sessionId, text).catch(() => {});
          term.focus();
        },
      });

      // Ctrl+Shift+C / Ctrl+Shift+V — Ctrl+C alone is reserved for SIGINT
      // in a real shell, so terminals conventionally use the Shift variant
      // for clipboard copy/paste instead of stealing plain Ctrl+C.
      term.attachCustomKeyEventHandler((e) => {
        if (e.type !== "keydown") return true;
        if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "c") {
          const selection = term.getSelection();
          if (selection) navigator.clipboard.writeText(selection).catch(() => {});
          return false;
        }
        if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "v") {
          navigator.clipboard
            .readText()
            .then((text) => {
              if (text) api.writeToTerminal(sessionId, text).catch(() => {});
            })
            .catch(() => {});
          return false;
        }
        return true;
      });

      term.focus();
    })();

    resizeObserver = new ResizeObserver(() => {
      if (!containerRef.current) return;
      fitAddon.fit();
      api.resizeTerminal(sessionId, term.cols, term.rows).catch(() => {});
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      disposed = true;
      dataSub.dispose();
      unlistenOutput?.();
      unlistenExit?.();
      resizeObserver?.disconnect();
      term.dispose();
      api.closeTerminalSession(sessionId).catch(() => {});
    };
    // sessionId identifies the PTY 1:1 with this pane; shell/cwd/themeId only
    // apply at creation time, so they're intentionally excluded from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full px-2 py-1.5"
      onContextMenu={(e) => {
        e.preventDefault();
        const term = termRef.current;
        if (!term) return;
        const selection = term.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection).catch(() => {});
          term.clearSelection();
        } else {
          navigator.clipboard
            .readText()
            .then((text) => {
              if (text) api.writeToTerminal(sessionId, text).catch(() => {});
            })
            .catch(() => {});
        }
      }}
    />
  );
}
