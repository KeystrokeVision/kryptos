import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown, Search } from "lucide-react";
import { MODULES, GROUP_LABELS, type ModuleDef } from "@/lib/modules";
import { useTabStore } from "@/store/useTabStore";
import { cn } from "@/lib/utils";
import logoMark from "@/assets/logo-mark-red.png";
import logoMarkWhite from "@/assets/logo-mark-white.png";

const GROUP_ORDER: ModuleDef["group"][] = ["core", "systems", "dev", "config"];

const COLLAPSE_STORAGE_KEY = "kryptos:sidebar-collapsed-groups";

function loadCollapsedGroups(): Partial<Record<ModuleDef["group"], boolean>> {
  try {
    const raw = localStorage.getItem(COLLAPSE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function Sidebar() {
  const { tabs, activeTabId, openTab } = useTabStore();
  const activeModuleId = tabs.find((t) => t.id === activeTabId)?.moduleId;
  const activeGroup = MODULES.find((m) => m.id === activeModuleId)?.group;

  const [collapsed, setCollapsed] = useState(loadCollapsedGroups);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(collapsed));
  }, [collapsed]);

  function toggleGroup(group: ModuleDef["group"]) {
    setCollapsed((prev) => ({ ...prev, [group]: !prev[group] }));
  }

  const query = filter.trim().toLowerCase();
  const isFiltering = query.length > 0;

  return (
    <aside className="relative flex h-full w-60 flex-col border-r border-border bg-panel">
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-4">
        <img src={logoMark} alt="KRYPTOS" className="h-8 w-8 shrink-0 drop-shadow-[0_0_10px_rgba(255,59,59,0.45)]" />
        <div className="leading-tight">
          <p className="font-mono text-sm font-semibold tracking-wide text-text">KRYPTOS</p>
          <p className="text-[10px] uppercase tracking-widest text-text-dim">
            The Ultimate System Terminal
          </p>
        </div>
      </div>

      <div className="border-b border-borderMuted px-2.5 py-2">
        <div className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-base px-2">
          <Search size={11} className="text-text-dim" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrar modulos..."
            className="h-full flex-1 bg-transparent text-[11px] text-text outline-none placeholder:text-text-dim"
          />
        </div>
      </div>

      <nav className="relative z-10 flex-1 overflow-y-auto px-2 py-3">
        {GROUP_ORDER.map((group) => {
          const groupModules = MODULES.filter(
            (m) => m.group === group && (!isFiltering || m.label.toLowerCase().includes(query))
          );
          if (groupModules.length === 0) return null;
          const isOpen = isFiltering || group === activeGroup || !collapsed[group];

          return (
            <div key={group} className="mb-2">
              <button
                onClick={() => toggleGroup(group)}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[10px] font-medium uppercase tracking-widest text-text-dim hover:text-text-muted"
              >
                <ChevronDown
                  size={11}
                  className={cn("shrink-0 transition-transform", !isOpen && "-rotate-90")}
                />
                {GROUP_LABELS[group]}
                <span className="ml-auto text-text-dim/70">{groupModules.length}</span>
              </button>
              {isOpen && (
                <div className="flex flex-col gap-0.5 pt-0.5">
                  {groupModules.map((mod) => {
                    const isActive = mod.id === activeModuleId;
                    const Icon = mod.icon;
                    return (
                      <button
                        key={mod.id}
                        onClick={() => openTab(mod.id, mod.label)}
                        title={mod.description}
                        className={cn(
                          "group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors",
                          isActive
                            ? "bg-accent/10 text-text"
                            : "text-text-muted hover:bg-overlay/[0.03] hover:text-text"
                        )}
                      >
                        {isActive && (
                          <motion.span
                            layoutId="sidebar-active-indicator"
                            className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-accent-bright shadow-glowSm"
                            transition={{ type: "spring", stiffness: 500, damping: 40 }}
                          />
                        )}
                        <Icon
                          size={16}
                          className={cn(isActive ? "text-accent-bright" : "text-text-dim group-hover:text-text-muted")}
                        />
                        <span className="truncate">{mod.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {isFiltering && GROUP_ORDER.every((g) => MODULES.filter((m) => m.group === g && m.label.toLowerCase().includes(query)).length === 0) && (
          <p className="px-2.5 py-4 text-center text-[11px] text-text-dim">Sin resultados.</p>
        )}
      </nav>

      <img
        src={logoMarkWhite}
        alt=""
        aria-hidden
        className="pointer-events-none absolute -bottom-6 -right-8 h-32 w-32 opacity-[0.06]"
      />
    </aside>
  );
}
