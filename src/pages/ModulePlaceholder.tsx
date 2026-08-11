import type { LucideIcon } from "lucide-react";

interface ModulePlaceholderProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

// KRYPTOS is built module by module. This placeholder keeps navigation,
// tabs, and layout fully functional while each module gets implemented
// with real backend commands.
export default function ModulePlaceholder({ icon: Icon, title, description }: ModulePlaceholderProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-border bg-panel">
        <Icon size={24} className="text-accent-bright" />
      </div>
      <div>
        <h2 className="font-mono text-base text-text">{title}</h2>
        <p className="mt-1 max-w-sm text-xs text-text-dim">{description}</p>
      </div>
      <span className="mt-2 rounded-full border border-border px-3 py-1 text-[10px] uppercase tracking-widest text-text-dim">
        Modulo en construccion
      </span>
    </div>
  );
}
