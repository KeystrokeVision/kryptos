import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Image as ImageIcon, Link2 } from "lucide-react";
import type { ScriptEntry } from "@/types/scripts";

interface ScriptFormProps {
  initial: ScriptEntry;
  onSubmit: (values: { name: string; repoUrl?: string; iconSourcePath?: string }) => void;
  submitting: boolean;
  errorMessage?: string;
}

/**
 * Edit-only: renames a script, updates its repo link, and/or replaces its
 * icon. To change the script's actual content, remove it and import the
 * new version through ScriptImportModal — same "delete and re-add"
 * convention AppForm uses for removing an icon entirely.
 */
export function ScriptForm({ initial, onSubmit, submitting, errorMessage }: ScriptFormProps) {
  const [name, setName] = useState(initial.name);
  const [repoUrl, setRepoUrl] = useState(initial.repo_url ?? "");
  const [iconSourcePath, setIconSourcePath] = useState<string | undefined>(undefined);

  async function pickIcon() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Imagenes", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "ico"] }],
    });
    if (typeof selected === "string") setIconSourcePath(selected);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onSubmit({ name: name.trim(), repoUrl: repoUrl.trim(), iconSourcePath });
      }}
      className="space-y-3"
    >
      <div>
        <label className="mb-1 block text-[10px] uppercase tracking-widest text-text-dim">Nombre</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-8 w-full rounded-md border border-border bg-base px-2.5 text-xs text-text outline-none focus:border-accent/60"
        />
      </div>

      <div>
        <label className="mb-1 block text-[10px] uppercase tracking-widest text-text-dim">
          Link del repositorio (opcional)
        </label>
        <div className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-base px-2.5">
          <Link2 size={12} className="shrink-0 text-text-dim" />
          <input
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/usuario/repo"
            className="h-full flex-1 bg-transparent text-xs text-text outline-none placeholder:text-text-dim"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-[10px] uppercase tracking-widest text-text-dim">
          Foto {initial.icon_file && !iconSourcePath ? "(se mantiene la actual)" : ""}
        </label>
        <button
          type="button"
          onClick={pickIcon}
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-text-muted hover:bg-overlay/[0.04]"
        >
          <ImageIcon size={13} />
          {iconSourcePath ? iconSourcePath.split(/[\\/]/).pop() : "Elegir imagen..."}
        </button>
      </div>

      <p className="text-[10px] text-text-dim">
        Para cambiar el contenido del script, quitalo y vuelve a agregarlo con el archivo/carpeta/.zip nuevo.
      </p>

      {errorMessage && <p className="text-xs text-accent-bright">{errorMessage}</p>}

      <button
        type="submit"
        disabled={!name.trim() || submitting}
        className="flex h-8 w-full items-center justify-center rounded-md bg-accent text-xs font-medium text-white hover:bg-accent-bright disabled:opacity-40"
      >
        {submitting ? "Guardando..." : "Guardar cambios"}
      </button>
    </form>
  );
}
