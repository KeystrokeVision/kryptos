import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  action?: ReactNode;
}

export function Card({ title, action, className, children, ...props }: CardProps) {
  return (
    <div className={cn("panel flex flex-col overflow-hidden", className)} {...props}>
      {title && (
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h3 className="text-[11px] font-medium uppercase tracking-widest text-text-muted">
            {title}
          </h3>
          {action}
        </div>
      )}
      <div className="flex-1 p-4">{children}</div>
    </div>
  );
}
