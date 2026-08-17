import { useState } from "react";
import { X, Plus, Database as DatabaseIcon } from "lucide-react";
import { DbConnectForm } from "@/components/database/DbConnectForm";
import { DbWorkspace } from "@/components/database/DbWorkspace";
import { cn } from "@/lib/utils";
import type { DbConnectParams } from "@/types/database";

interface DbSessionTab {
  id: string;
  label: string;
  params: DbConnectParams;
}

let counter = 0;
const nextId = () => `db-${Date.now()}-${counter++}`;

export default function Database() {
  const [sessions, setSessions] = useState<DbSessionTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  function connect(params: DbConnectParams, label: string) {
    const tab: DbSessionTab = { id: nextId(), label, params };
    setSessions((prev) => [...prev, tab]);
    setActiveId(tab.id);
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
              <DatabaseIcon size={11} className={s.id === activeId ? "text-accent-bright" : "text-text-dim"} />
              <span className="max-w-[160px] truncate font-mono">{s.label}</span>
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
      </div>

      <div className="relative min-h-0 flex-1">
        <div className={cn("absolute inset-0", activeId === null ? "block" : "hidden")}>
          <DbConnectForm onConnect={connect} />
        </div>
        {sessions.map((s) => (
          <div key={s.id} className={cn("absolute inset-0", s.id === activeId ? "block" : "hidden")}>
            <DbWorkspace sessionId={s.id} params={s.params} label={s.label} />
          </div>
        ))}
      </div>
    </div>
  );
}
