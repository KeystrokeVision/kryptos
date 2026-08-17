import { useState } from "react";
import { X, Plus, ServerCog, TerminalSquare, FolderOpen } from "lucide-react";
import { SshConnectForm } from "@/components/ssh/SshConnectForm";
import { SshPane } from "@/components/ssh/SshPane";
import { SftpBrowser } from "@/components/ssh/SftpBrowser";
import { cn } from "@/lib/utils";
import type { SshConnectParams } from "@/types/ssh";

interface SshSessionTab {
  id: string;
  label: string;
  params: SshConnectParams;
  mode: "shell" | "sftp";
}

let counter = 0;
const nextId = () => `ssh-${Date.now()}-${counter++}`;

export default function Ssh() {
  const [sessions, setSessions] = useState<SshSessionTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  function connect(params: SshConnectParams, label: string) {
    const tab: SshSessionTab = { id: nextId(), label, params, mode: "shell" };
    setSessions((prev) => [...prev, tab]);
    setActiveId(tab.id);
  }

  function setMode(id: string, mode: "shell" | "sftp") {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, mode } : s)));
  }

  function closeTab(id: string) {
    setSessions((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      if (activeId === id) {
        setActiveId(next[idx]?.id ?? next[idx - 1]?.id ?? next[0]?.id ?? null);
      }
      return next;
    });
  }

  const activeSession = sessions.find((s) => s.id === activeId);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-borderMuted bg-panelAlt px-1.5">
        <button
          onClick={() => setActiveId(null)}
          className={cn(
            "flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px]",
            activeId === null ? "bg-base text-text border border-borderMuted" : "text-text-dim hover:bg-overlay/[0.03]"
          )}
        >
          <Plus size={12} /> Nueva conexion
        </button>

        <div className="flex flex-1 items-center gap-1 overflow-x-auto">
          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => setActiveId(s.id)}
              className={cn(
                "group flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[11px]",
                s.id === activeId ? "bg-base text-text border border-borderMuted" : "text-text-dim hover:bg-overlay/[0.03]"
              )}
            >
              <ServerCog size={11} className={s.id === activeId ? "text-accent-bright" : "text-text-dim"} />
              <span className="max-w-[140px] truncate font-mono">{s.label}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(s.id);
                }}
                className="rounded p-0.5 text-text-dim opacity-0 hover:bg-overlay/10 hover:text-text group-hover:opacity-100"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>

        {activeSession && (
          <div className="flex gap-1">
            <button
              onClick={() => setMode(activeSession.id, "shell")}
              className={cn("flex h-7 items-center gap-1 rounded-md px-2 text-[11px]", activeSession.mode === "shell" ? "bg-overlay/[0.06] text-text" : "text-text-dim hover:bg-overlay/[0.03]")}
            >
              <TerminalSquare size={12} /> Shell
            </button>
            <button
              onClick={() => setMode(activeSession.id, "sftp")}
              className={cn("flex h-7 items-center gap-1 rounded-md px-2 text-[11px]", activeSession.mode === "sftp" ? "bg-overlay/[0.06] text-text" : "text-text-dim hover:bg-overlay/[0.03]")}
            >
              <FolderOpen size={12} /> SFTP
            </button>
          </div>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        <div className={cn("absolute inset-0", activeId === null ? "block" : "hidden")}>
          <SshConnectForm onConnect={connect} />
        </div>
        {sessions.map((s) => (
          <div key={s.id} className={cn("absolute inset-0", s.id === activeId ? "block" : "hidden")}>
            {/* The shell pane stays mounted even while viewing SFTP, so the
                live session isn't torn down by switching tabs — same
                "keep mounted, just hide" pattern used everywhere else in
                KRYPTOS for exactly this reason. */}
            <div className={s.mode === "shell" ? "h-full" : "hidden"}>
              <SshPane sessionId={s.id} connectParams={s.params} onExit={() => {}} />
            </div>
            {s.mode === "sftp" && (
              <div className="h-full">
                <SftpBrowser connectParams={s.params} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
