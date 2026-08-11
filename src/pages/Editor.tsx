import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { open, save } from "@tauri-apps/plugin-dialog";
import Editor, { type OnMount } from "@monaco-editor/react";
import "@/lib/monacoSetup";
import { KRYPTOS_MONACO_THEME } from "@/lib/monacoSetup";
import { FolderOpen, FilePlus2, Save, X, FileCode2, AlertTriangle, Play, Terminal as TerminalIcon, BookMarked, ChevronDown, FolderTree, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ProjectExplorer } from "@/components/editor/ProjectExplorer";
import { api } from "@/lib/tauri";
import { languageForPath, fileNameFromPath, isRunnableScript } from "@/lib/editorLanguages";
import { SCRIPT_LIBRARY, SCRIPT_CATEGORIES, type ScriptCategory } from "@/lib/scriptLibrary";
import { cn } from "@/lib/utils";

interface EditorTab {
  id: string;
  path: string | null; // null = new, unsaved buffer
  name: string;
  content: string;
  savedContent: string;
}

let counter = 0;
const nextId = () => `edit-${Date.now()}-${counter++}`;

export default function CodeEditor() {
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingClose, setPendingClose] = useState<EditorTab | null>(null);
  const [pendingRun, setPendingRun] = useState<EditorTab | null>(null);
  const [projectRoot, setProjectRoot] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [snippetsOpen, setSnippetsOpen] = useState(false);
  const [snippetQuery, setSnippetQuery] = useState("");
  const [snippetCategory, setSnippetCategory] = useState<ScriptCategory | "todas">("todas");
  const [output, setOutput] = useState<{ success: boolean; text: string } | null>(null);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  const active = tabs.find((t) => t.id === activeId) ?? null;
  const isDirty = (t: EditorTab) => t.content !== t.savedContent;

  const filteredSnippets = useMemo(() => {
    const q = snippetQuery.trim().toLowerCase();
    return SCRIPT_LIBRARY.filter((s) => {
      if (snippetCategory !== "todas" && s.category !== snippetCategory) return false;
      if (!q) return true;
      return s.title.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
    });
  }, [snippetQuery, snippetCategory]);

  const openMutation = useMutation({
    mutationFn: async () => {
      const selected = await open({ multiple: false });
      if (typeof selected !== "string") return null;
      const content = await api.readFileText(selected);
      return { path: selected, content };
    },
    onSuccess: (result) => {
      if (!result) return;
      const existing = tabs.find((t) => t.path === result.path);
      if (existing) {
        setActiveId(existing.id);
        return;
      }
      const tab: EditorTab = { id: nextId(), path: result.path, name: fileNameFromPath(result.path), content: result.content, savedContent: result.content };
      setTabs((prev) => [...prev, tab]);
      setActiveId(tab.id);
    },
    onError: (e: Error) => setError(e.message),
  });

  const saveMutation = useMutation({
    mutationFn: async (tab: EditorTab) => {
      let path = tab.path;
      if (!path) {
        const chosen = await save({ defaultPath: tab.name });
        if (!chosen) throw new Error("Guardado cancelado.");
        path = chosen;
      }
      await api.writeFileText(path, tab.content);
      return { ...tab, path, name: fileNameFromPath(path), savedContent: tab.content };
    },
    onSuccess: (updated) => {
      setTabs((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    },
    onError: (e: Error) => setError(e.message),
  });

  const runMutation = useMutation({
    mutationFn: async (tab: EditorTab) => {
      // Always run the version on disk — save first if there are unsaved
      // edits, so "Ejecutar" never silently runs stale content.
      let path = tab.path;
      if (!path || tab.content !== tab.savedContent) {
        path = await saveMutation.mutateAsync(tab).then((t) => t.path);
      }
      return api.runScript(path as string);
    },
    onSuccess: (result) => setOutput({ success: result.success, text: result.output }),
    onError: (e: Error) => setError(e.message),
  });

  function newTab() {
    const tab: EditorTab = { id: nextId(), path: null, name: "sin-titulo.txt", content: "", savedContent: "" };
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
  }

  async function openFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") setProjectRoot(selected);
  }

  async function openFileFromTree(path: string, name: string) {
    const existing = tabs.find((t) => t.path === path);
    if (existing) {
      setActiveId(existing.id);
      return;
    }
    try {
      const content = await api.readFileText(path);
      const tab: EditorTab = { id: nextId(), path, name, content, savedContent: content };
      setTabs((prev) => [...prev, tab]);
      setActiveId(tab.id);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    }
  }

  function openSnippet(snippet: (typeof SCRIPT_LIBRARY)[number]) {
    const tab: EditorTab = {
      id: nextId(),
      path: null,
      name: `${snippet.id}.${snippet.extension}`,
      content: snippet.code,
      savedContent: "", // starts "dirty" on purpose — nothing runs until the user explicitly saves it somewhere
    };
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
    setSnippetsOpen(false);
  }

  function updateContent(id: string, content: string) {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, content } : t)));
  }

  function requestClose(tab: EditorTab) {
    if (isDirty(tab)) {
      setPendingClose(tab);
    } else {
      closeTab(tab.id);
    }
  }

  function closeTab(id: string) {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      if (activeId === id) {
        setActiveId(next[idx]?.id ?? next[idx - 1]?.id ?? next[0]?.id ?? null);
      }
      return next;
    });
  }

  // Ctrl/Cmd+S saves the active tab.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (active) saveMutation.mutate(active);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-borderMuted bg-panelAlt px-1.5">
        {projectRoot && (
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-dim hover:bg-white/[0.06] hover:text-text"
            aria-label="Mostrar/ocultar explorador"
          >
            {sidebarOpen ? <PanelLeftClose size={13} /> : <PanelLeftOpen size={13} />}
          </button>
        )}
        <div className="flex flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              onClick={() => setActiveId(tab.id)}
              className={cn(
                "group flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[11px]",
                tab.id === activeId ? "bg-base text-text border border-borderMuted" : "text-text-dim hover:bg-white/[0.03]"
              )}
            >
              <FileCode2 size={11} className={tab.id === activeId ? "text-accent-bright" : "text-text-dim"} />
              <span className="max-w-[140px] truncate">{tab.name}</span>
              {isDirty(tab) && <span className="h-1.5 w-1.5 rounded-full bg-accent-bright" />}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  requestClose(tab);
                }}
                className="rounded p-0.5 text-text-dim opacity-0 hover:bg-white/10 hover:text-text group-hover:opacity-100"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>

        <button onClick={() => openMutation.mutate()} className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] text-text-dim hover:bg-white/[0.06] hover:text-text">
          <FolderOpen size={13} /> Abrir
        </button>
        <button onClick={openFolder} className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] text-text-dim hover:bg-white/[0.06] hover:text-text">
          <FolderTree size={13} /> Carpeta
        </button>
        <button onClick={newTab} className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] text-text-dim hover:bg-white/[0.06] hover:text-text">
          <FilePlus2 size={13} /> Nuevo
        </button>
        <div className="relative">
          <button
            onClick={() => setSnippetsOpen((v) => !v)}
            className={cn(
              "flex h-7 items-center gap-1 rounded-md px-2 text-[11px]",
              snippetsOpen ? "text-accent-bright" : "text-text-dim hover:bg-white/[0.06] hover:text-text"
            )}
          >
            <BookMarked size={13} /> Scripts <ChevronDown size={10} />
          </button>
          {snippetsOpen && (
            <div className="absolute left-0 top-8 z-20 w-96 overflow-hidden rounded-md border border-border bg-panel shadow-panel">
              <div className="space-y-2 border-b border-borderMuted p-2.5">
                <div className="flex items-center gap-1.5 rounded-md border border-border bg-base px-2">
                  <Search size={11} className="text-text-dim" />
                  <input
                    autoFocus
                    value={snippetQuery}
                    onChange={(e) => setSnippetQuery(e.target.value)}
                    placeholder="Buscar script..."
                    className="h-7 flex-1 bg-transparent text-[11px] text-text outline-none placeholder:text-text-dim"
                  />
                </div>
                <div className="flex flex-wrap gap-1">
                  <button
                    onClick={() => setSnippetCategory("todas")}
                    className={cn("rounded-full px-2 py-0.5 text-[10px]", snippetCategory === "todas" ? "bg-accent text-white" : "border border-border text-text-muted hover:bg-white/[0.04]")}
                  >
                    Todas
                  </button>
                  {(Object.keys(SCRIPT_CATEGORIES) as ScriptCategory[]).map((c) => (
                    <button
                      key={c}
                      onClick={() => setSnippetCategory(c)}
                      className={cn("rounded-full px-2 py-0.5 text-[10px]", snippetCategory === c ? "bg-accent text-white" : "border border-border text-text-muted hover:bg-white/[0.04]")}
                    >
                      {SCRIPT_CATEGORIES[c]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="max-h-96 overflow-y-auto">
                {filteredSnippets.length === 0 && <p className="px-3 py-3 text-[11px] text-text-dim">Sin resultados.</p>}
                {filteredSnippets.map((s) => (
                  <button key={s.id} onClick={() => openSnippet(s)} className="block w-full border-b border-borderMuted px-3 py-2 text-left last:border-b-0 hover:bg-white/[0.04]">
                    <div className="flex items-center gap-1.5">
                      <p className="flex-1 text-[11px] text-text">{s.title}</p>
                      <span className="shrink-0 text-[9px] uppercase text-text-dim">{s.os === "any" ? "" : s.os}</span>
                    </div>
                    <p className="mt-0.5 text-[10px] text-text-dim">{s.description}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <button
          onClick={() => active && saveMutation.mutate(active)}
          disabled={!active || saveMutation.isPending}
          className="flex h-7 items-center gap-1.5 rounded-md bg-accent px-2 text-[11px] font-medium text-white hover:bg-accent-bright disabled:opacity-40"
        >
          <Save size={13} /> Guardar
        </button>
        {active && isRunnableScript(active.path ?? active.name) && (
          <button
            onClick={() => setPendingRun(active)}
            disabled={runMutation.isPending}
            className="flex h-7 items-center gap-1.5 rounded-md border border-ok/40 px-2 text-[11px] font-medium text-ok hover:bg-ok/10 disabled:opacity-40"
          >
            <Play size={13} /> {runMutation.isPending ? "Ejecutando..." : "Ejecutar"}
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 border-b border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent-bright">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-accent-bright/70 hover:text-accent-bright">
            <X size={12} />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {projectRoot && sidebarOpen && <ProjectExplorer rootPath={projectRoot} onOpenFile={openFileFromTree} activePath={active?.path ?? undefined} />}

        <div className="flex min-h-0 flex-1 flex-col">
          <div className={cn("min-h-0", output ? "flex-[2]" : "flex-1")}>
            {!active && (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-text-dim">
                <FileCode2 size={28} />
                <p className="text-xs">Abre un archivo, una carpeta, o crea uno nuevo para empezar.</p>
              </div>
            )}
            {tabs.map((tab) => (
              <div key={tab.id} className={tab.id === activeId ? "h-full" : "hidden"}>
                <Editor
                  height="100%"
                  theme={KRYPTOS_MONACO_THEME}
                  language={languageForPath(tab.path ?? tab.name)}
                  value={tab.content}
                  onChange={(value) => updateContent(tab.id, value ?? "")}
                  onMount={(editor) => {
                    editorRef.current = editor;
                  }}
                  options={{
                    fontSize: 13,
                    fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
                    minimap: { enabled: true },
                    automaticLayout: true,
                    scrollBeyondLastLine: false,
                  }}
                />
              </div>
            ))}
          </div>

          {output && (
            <div className="flex h-48 shrink-0 flex-col border-t border-borderMuted">
          <div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-borderMuted bg-panelAlt px-2 text-[10px] uppercase tracking-widest text-text-dim">
            <TerminalIcon size={11} className={output.success ? "text-ok" : "text-accent-bright"} />
            Salida {output.success ? "" : "(termino con error)"}
            <button onClick={() => setOutput(null)} className="ml-auto text-text-dim hover:text-text">
              <X size={11} />
            </button>
          </div>
          <pre className="flex-1 overflow-auto whitespace-pre-wrap p-2 font-mono text-[11px] text-text-muted">{output.text || "(sin salida)"}</pre>
        </div>
      )}
        </div>
      </div>

      {pendingClose && (
        <ConfirmDialog
          title="Cerrar sin guardar"
          message={`"${pendingClose.name}" tiene cambios sin guardar. ¿Cerrarlo de todas formas? Los cambios se perderan.`}
          confirmLabel="Cerrar sin guardar"
          onCancel={() => setPendingClose(null)}
          onConfirm={() => {
            closeTab(pendingClose.id);
            setPendingClose(null);
          }}
        />
      )}

      {pendingRun && (
        <ConfirmDialog
          title="Ejecutar script"
          message={`¿Ejecutar "${pendingRun.name}" en este equipo? Se ejecuta con los mismos permisos que KRYPTOS.`}
          confirmLabel="Ejecutar"
          onCancel={() => setPendingRun(null)}
          onConfirm={() => {
            runMutation.mutate(pendingRun);
            setPendingRun(null);
          }}
        />
      )}
    </div>
  );
}
