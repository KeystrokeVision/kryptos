import { cn } from "@/lib/utils";

export function DiffView({ diff }: { diff: string }) {
  if (!diff.trim()) {
    return <p className="p-4 text-xs text-text-dim">Sin diferencias para mostrar.</p>;
  }

  const lines = diff.split("\n");

  return (
    <pre className="overflow-x-auto p-3 font-mono text-[11px] leading-relaxed">
      {lines.map((line, i) => {
        let tone = "text-text-muted";
        if (line.startsWith("+") && !line.startsWith("+++")) tone = "bg-ok/10 text-ok";
        else if (line.startsWith("-") && !line.startsWith("---")) tone = "bg-accent-bright/10 text-accent-bright";
        else if (line.startsWith("@@")) tone = "text-accent-bright/80";
        else if (line.startsWith("diff --git") || line.startsWith("index ")) tone = "text-text-dim";
        return (
          <div key={i} className={cn("whitespace-pre px-1", tone)}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}
