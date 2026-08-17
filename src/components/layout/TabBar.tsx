import { AnimatePresence, motion } from "framer-motion";
import { X, Pin, Plus } from "lucide-react";
import { useTabStore } from "@/store/useTabStore";
import { MODULES } from "@/lib/modules";
import { cn } from "@/lib/utils";

export function TabBar() {
  const { tabs, activeTabId, setActive, closeTab, togglePin, openTab } = useTabStore();

  return (
    <div className="flex h-10 shrink-0 items-center border-b border-border bg-base px-1">
      <div className="flex flex-1 items-center gap-0.5 overflow-x-auto">
        <AnimatePresence initial={false}>
          {tabs.map((tab) => {
            const mod = MODULES.find((m) => m.id === tab.moduleId);
            const Icon = mod?.icon;
            const isActive = tab.id === activeTabId;
            return (
              <motion.div
                key={tab.id}
                layout
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.15 }}
                onClick={() => setActive(tab.id)}
                onDoubleClick={() => togglePin(tab.id)}
                className={cn(
                  "group flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors",
                  isActive
                    ? "bg-panel text-text border border-border"
                    : "text-text-muted hover:bg-overlay/[0.03] border border-transparent"
                )}
              >
                {tab.pinned && <Pin size={11} className="text-accent-bright" />}
                {Icon && <Icon size={13} className={isActive ? "text-accent-bright" : "text-text-dim"} />}
                <span className="max-w-[140px] truncate font-mono">{tab.title}</span>
                {!tab.pinned && (
                  <button
                    aria-label={`Cerrar ${tab.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                    className="ml-1 rounded p-0.5 text-text-dim opacity-0 hover:bg-overlay/10 hover:text-text group-hover:opacity-100"
                  >
                    <X size={11} />
                  </button>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      <button
        aria-label="Nueva pestana"
        onClick={() => openTab("terminal", "Terminal")}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-dim hover:bg-overlay/[0.06] hover:text-text"
      >
        <Plus size={15} />
      </button>
    </div>
  );
}
