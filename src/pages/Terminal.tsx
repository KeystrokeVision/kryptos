import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X, Search, ZoomIn, ZoomOut, Eraser, ChevronDown, TerminalSquare, Columns2, Copy, ClipboardPaste, BookMarked } from "lucide-react";
import { TerminalPane, type TerminalPaneHandle } from "@/components/terminal/TerminalPane";
import { api } from "@/lib/tauri";
import { TERMINAL_SNIPPETS } from "@/lib/terminalSnippets";
import { CHEATSHEET } from "@/lib/cheatsheetData";
import type { ShellOption } from "@/types/terminal";
import { cn } from "@/lib/utils";

// Union del catalogo original de comandos rapidos con el cheatsheet de
// Modo Hacker — mismo comando, un solo cajon de busqueda en vez de dos
// listas separadas que el usuario tendria que recordar cual mirar.
const QUICK_COMMANDS = [
  ...TERMINAL_SNIPPETS.map((s) => ({ id: s.id, label: s.label, description: s.description, command: s.command, os: s.os })),
  ...CHEATSHEET.map((c) => ({ id: c.id, label: c.command, description: c.description, command: c.command, os: "any" as const })),
];

interface PaneInfo {
  sessionId: string;
  shellId?: string;
}

interface TerminalSessionTab {
  id: string;
  title: string;
  panes: PaneInfo[]; // 1 or 2 — a simple side-by-side split, like VS Code's terminal split
}

let internalCounter = 0;
const nextSessionId = () => `term-${Date.now()}-${internalCounter++}`;

/**
 * The Terminal module. Unlike the rest of KRYPTOS's navigation (one global
 * tab per module instance), this module keeps its own unlimited set of
 * internal shell tabs, matching a normal terminal app — and each tab can
 * itself be split into two side-by-side panes, matching VS Code/tmux
 * rather than a plain single-pane cmd window.
 */
export default function Terminal() {
  const [shells, setShells] = useState<ShellOption[]>([]);
  const [themeId, setThemeId] = useState<string | undefined>(undefined);
  const [sessions, setSessions] = useState<TerminalSessionTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [focusedSessionId, setFocusedSessionId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [snippetsOpen, setSnippetsOpen] = useState(false);
  const [snippetQuery, setSnippetQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const handlesRef = useRef<Map<string, TerminalPaneHandle>>(new Map());

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.listAvailableShells(), api.getSetting("terminal.default_shell").catch(() => null), api.getSetting("terminal.theme").catch(() => null)])
      .then(([list, savedShellId, savedThemeId]) => {
        if (cancelled) return;
        setShells(list);
        if (savedThemeId) setThemeId(savedThemeId);
        const preferred = savedShellId ? list.find((s) => s.id === savedShellId) : undefined;
        const first = preferred ?? list[0];
        const paneId = nextSessionId();
        setSessions([{ id: nextSessionId(), title: first?.label ?? "Terminal", panes: [{ sessionId: paneId, shellId: first?.id }] }]);
        setFocusedSessionId(paneId);
      })
      .catch(() => {
        if (cancelled) return;
        const paneId = nextSessionId();
        setSessions([{ id: nextSessionId(), title: "Terminal", panes: [{ sessionId: paneId }] }]);
        setFocusedSessionId(paneId);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeId && sessions.length > 0) setActiveId(sessions[0].id);
  }, [sessions, activeId]);

  const activeTab = sessions.find((t) => t.id === activeId);
  const activeHandle = focusedSessionId ? handlesRef.current.get(focusedSessionId) : undefined;

  function openTab(shell?: ShellOption) {
    const paneId = nextSessionId();
    const tab: TerminalSessionTab = {
      id: nextSessionId(),
      title: shell?.label ?? "Terminal",
      panes: [{ sessionId: paneId, shellId: shell?.id }],
    };
    setSessions((prev) => [...prev, tab]);
    setActiveId(tab.id);
    setFocusedSessionId(paneId);
    setPickerOpen(false);
  }

  function closeTab(id: string) {
    const tab = sessions.find((t) => t.id === id);
    tab?.panes.forEach((p) => handlesRef.current.delete(p.sessionId));
    setSessions((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      if (activeId === id) {
        const fallback = next[idx] ?? next[idx - 1] ?? next[0];
        setActiveId(fallback?.id ?? null);
        setFocusedSessionId(fallback?.panes[0]?.sessionId ?? null);
      }
      return next;
    });
  }

  function splitActiveTab() {
    if (!activeTab || activeTab.panes.length >= 2) return;
    const paneId = nextSessionId();
    setSessions((prev) => prev.map((t) => (t.id === activeTab.id ? { ...t, panes: [...t.panes, { sessionId: paneId }] } : t)));
    setFocusedSessionId(paneId);
  }

  function closePane(tabId: string, sessionId: string) {
    handlesRef.current.delete(sessionId);
    setSessions((prev) => {
      const tab = prev.find((t) => t.id === tabId);
      if (!tab) return prev;
      const remaining = tab.panes.filter((p) => p.sessionId !== sessionId);
      if (remaining.length === 0) {
        // No panes left in this tab — close the whole tab.
        const idx = prev.findIndex((t) => t.id === tabId);
        const next = prev.filter((t) => t.id !== tabId);
        if (activeId === tabId) {
          const fallback = next[idx] ?? next[idx - 1] ?? next[0];
          setActiveId(fallback?.id ?? null);
          setFocusedSessionId(fallback?.panes[0]?.sessionId ?? null);
        }
        return next;
      }
      if (focusedSessionId === sessionId) setFocusedSessionId(remaining[0].sessionId);
      return prev.map((t) => (t.id === tabId ? { ...t, panes: remaining } : t));
    });
  }

  function runSearch(direction: "next" | "prev") {
    if (!searchTerm) return;
    if (direction === "next") activeHandle?.findNext(searchTerm);
    else activeHandle?.findPrevious(searchTerm);
  }

  const shellMenu = useMemo(() => (shells.length > 0 ? shells : [{ id: "", label: "Shell del sistema" }]), [shells]);

  const filteredQuickCommands = useMemo(() => {
    const q = snippetQuery.trim().toLowerCase();
    if (!q) return QUICK_COMMANDS;
    return QUICK_COMMANDS.filter((s) => s.label.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.command.toLowerCase().includes(q));
  }, [snippetQuery]);

  return (
    <div className="flex h-full flex-col">
      {/* Internal tab strip — separate from the app's global TabBar above it */}
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-borderMuted bg-panelAlt px-1.5">
        <div className="flex flex-1 items-center gap-1 overflow-x-auto">
          {sessions.map((tab) => {
            const isActive = tab.id === activeId;
            return (
              <div
                key={tab.id}
                onClick={() => {
                  setActiveId(tab.id);
                  setFocusedSessionId(tab.panes[0]?.sessionId ?? null);
                }}
                className={cn(
                  "group flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[11px] transition-colors",
                  isActive ? "bg-base text-text border border-borderMuted" : "text-text-dim hover:bg-overlay/[0.03]"
                )}
              >
                <TerminalSquare size={11} className={isActive ? "text-accent-bright" : "text-text-dim"} />
                <span className="max-w-[120px] truncate font-mono">{tab.title}</span>
                {tab.panes.length > 1 && <span className="rounded bg-accent/20 px-1 text-[9px] text-accent-bright">2</span>}
                {sessions.length > 1 && (
                  <button
                    aria-label={`Cerrar ${tab.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                    className="rounded p-0.5 text-text-dim opacity-0 hover:bg-overlay/10 hover:text-text group-hover:opacity-100"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="relative flex items-center gap-0.5">
          <button
            onClick={() => setPickerOpen((v) => !v)}
            className="flex h-7 items-center gap-1 rounded-md px-1.5 text-text-dim hover:bg-overlay/[0.06] hover:text-text"
            aria-label="Nueva terminal"
          >
            <Plus size={13} />
            <ChevronDown size={10} />
          </button>
          {pickerOpen && (
            <div className="absolute right-0 top-8 z-20 w-44 overflow-hidden rounded-md border border-border bg-panel shadow-panel">
              {shellMenu.map((s) => (
                <button
                  key={s.id || "default"}
                  onClick={() => openTab(s.id ? s : undefined)}
                  className="flex w-full items-center px-3 py-2 text-left text-[11px] text-text-muted hover:bg-overlay/[0.05] hover:text-text"
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}

          <button
            onClick={splitActiveTab}
            disabled={!activeTab || activeTab.panes.length >= 2}
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-dim hover:bg-overlay/[0.06] hover:text-text disabled:opacity-30"
            aria-label="Dividir panel"
          >
            <Columns2 size={13} />
          </button>

          <div className="mx-1 h-4 w-px bg-border" />

          <div className="relative">
            <button
              onClick={() => setSnippetsOpen((v) => !v)}
              className={cn("flex h-7 w-7 items-center justify-center rounded-md hover:bg-overlay/[0.06]", snippetsOpen ? "text-accent-bright" : "text-text-dim hover:text-text")}
              aria-label="Comandos rapidos"
            >
              <BookMarked size={13} />
            </button>
            {snippetsOpen && (
              <div className="absolute right-0 top-8 z-20 w-80 overflow-hidden rounded-md border border-border bg-panel shadow-panel">
                <div className="flex items-center gap-1.5 border-b border-borderMuted px-2.5 py-1.5">
                  <Search size={11} className="shrink-0 text-text-dim" />
                  <input
                    autoFocus
                    value={snippetQuery}
                    onChange={(e) => setSnippetQuery(e.target.value)}
                    placeholder="Buscar comando (incluye el cheatsheet)..."
                    className="h-6 flex-1 bg-transparent text-[11px] text-text outline-none placeholder:text-text-dim"
                  />
                </div>
                <div className="max-h-96 overflow-y-auto">
                  {filteredQuickCommands.length === 0 && <p className="px-3 py-3 text-[11px] text-text-dim">Sin resultados.</p>}
                  {filteredQuickCommands.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => {
                        activeHandle?.writeText(s.command);
                        setSnippetsOpen(false);
                      }}
                      className="block w-full border-b border-borderMuted px-3 py-2 text-left last:border-b-0 hover:bg-overlay/[0.04]"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] text-text">{s.label}</p>
                        <span className="text-[9px] uppercase text-text-dim">{s.os === "any" ? "" : s.os}</span>
                      </div>
                      <p className="mt-0.5 text-[10px] text-text-dim">{s.description}</p>
                      <p className="mt-0.5 truncate font-mono text-[10px] text-accent-bright/80">{s.command}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <button onClick={() => activeHandle?.copySelection()} className="flex h-7 w-7 items-center justify-center rounded-md text-text-dim hover:bg-overlay/[0.06] hover:text-text" aria-label="Copiar seleccion">
            <Copy size={13} />
          </button>
          <button onClick={() => activeHandle?.pasteFromClipboard()} className="flex h-7 w-7 items-center justify-center rounded-md text-text-dim hover:bg-overlay/[0.06] hover:text-text" aria-label="Pegar">
            <ClipboardPaste size={13} />
          </button>

          <div className="mx-1 h-4 w-px bg-border" />

          <button
            onClick={() => setSearchOpen((v) => !v)}
            className={cn("flex h-7 w-7 items-center justify-center rounded-md hover:bg-overlay/[0.06]", searchOpen ? "text-accent-bright" : "text-text-dim hover:text-text")}
            aria-label="Buscar en la terminal"
          >
            <Search size={13} />
          </button>
          <button onClick={() => activeHandle?.zoomOut()} className="flex h-7 w-7 items-center justify-center rounded-md text-text-dim hover:bg-overlay/[0.06] hover:text-text" aria-label="Reducir tamano de fuente">
            <ZoomOut size={13} />
          </button>
          <button onClick={() => activeHandle?.zoomIn()} className="flex h-7 w-7 items-center justify-center rounded-md text-text-dim hover:bg-overlay/[0.06] hover:text-text" aria-label="Aumentar tamano de fuente">
            <ZoomIn size={13} />
          </button>
          <button onClick={() => activeHandle?.clear()} className="flex h-7 w-7 items-center justify-center rounded-md text-text-dim hover:bg-overlay/[0.06] hover:text-text" aria-label="Limpiar terminal">
            <Eraser size={13} />
          </button>
        </div>
      </div>

      {searchOpen && (
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-borderMuted bg-panelAlt px-2">
          <Search size={12} className="text-text-dim" />
          <input
            autoFocus
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") runSearch(e.shiftKey ? "prev" : "next");
              if (e.key === "Escape") setSearchOpen(false);
            }}
            placeholder="Buscar en el buffer..."
            className="h-6 flex-1 bg-transparent font-mono text-[11px] text-text outline-none placeholder:text-text-dim"
          />
          <button onClick={() => setSearchOpen(false)} className="text-text-dim hover:text-text">
            <X size={12} />
          </button>
        </div>
      )}

      {/* All internal tabs stay mounted (hidden, not unmounted) so switching
          between them doesn't kill the shells underneath. Within the active
          tab, panes render side by side when split. */}
      <div className="relative min-h-0 flex-1">
        {sessions.map((tab) => (
          <div key={tab.id} className={cn("absolute inset-0 flex", tab.id === activeId ? "flex" : "hidden")}>
            {tab.panes.map((pane, i) => (
              <div
                key={pane.sessionId}
                onClick={() => setFocusedSessionId(pane.sessionId)}
                className={cn("relative min-w-0 flex-1", i > 0 && "border-l border-borderMuted")}
              >
                {tab.panes.length > 1 && (
                  <div
                    className={cn(
                      "pointer-events-none absolute inset-0 z-10 border",
                      focusedSessionId === pane.sessionId ? "border-accent/50" : "border-transparent"
                    )}
                  />
                )}
                {tab.panes.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      closePane(tab.id, pane.sessionId);
                    }}
                    className="absolute right-2 top-1 z-20 rounded p-1 text-text-dim hover:bg-overlay/10 hover:text-text"
                    aria-label="Cerrar panel"
                  >
                    <X size={11} />
                  </button>
                )}
                <TerminalPane
                  sessionId={pane.sessionId}
                  shell={pane.shellId}
                  themeId={themeId}
                  onReady={(handle) => handlesRef.current.set(pane.sessionId, handle)}
                  onExit={() => {
                    // Leave the pane in place showing "[proceso finalizado]" —
                    // the user closes it explicitly, matching how real
                    // terminal emulators handle a dead shell.
                  }}
                />
              </div>
            ))}
          </div>
        ))}
        {sessions.length === 0 && (
          <div className="flex h-full items-center justify-center text-xs text-text-dim">Sin sesiones de terminal.</div>
        )}
      </div>
    </div>
  );
}
