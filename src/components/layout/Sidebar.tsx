import { motion } from "framer-motion";
import { MODULES, GROUP_LABELS, type ModuleDef } from "@/lib/modules";
import { useTabStore } from "@/store/useTabStore";
import { cn } from "@/lib/utils";
import logoMark from "@/assets/logo-mark-red.png";
import logoMarkWhite from "@/assets/logo-mark-white.png";

const GROUP_ORDER: ModuleDef["group"][] = ["core", "systems", "dev", "config"];

export function Sidebar() {
  const { tabs, activeTabId, openTab } = useTabStore();
  const activeModuleId = tabs.find((t) => t.id === activeTabId)?.moduleId;

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

      <nav className="relative z-10 flex-1 overflow-y-auto px-2 py-3">
        {GROUP_ORDER.map((group) => (
          <div key={group} className="mb-4">
            <p className="px-2 pb-1.5 text-[10px] font-medium uppercase tracking-widest text-text-dim">
              {GROUP_LABELS[group]}
            </p>
            <div className="flex flex-col gap-0.5">
              {MODULES.filter((m) => m.group === group).map((mod) => {
                const isActive = mod.id === activeModuleId;
                const Icon = mod.icon;
                return (
                  <button
                    key={mod.id}
                    onClick={() => openTab(mod.id, mod.label)}
                    className={cn(
                      "group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors",
                      isActive
                        ? "bg-accent/10 text-text"
                        : "text-text-muted hover:bg-white/[0.03] hover:text-text"
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
          </div>
        ))}
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
