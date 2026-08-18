import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FileSearch, Image as ImageIcon } from "lucide-react";
import type { AppEntry } from "@/types/apps";

interface AppFormProps {
  initial?: AppEntry;
  prefill?: { name: string; exePath: string };
  onSubmit: (values: { name: string; exePath: string; iconSourcePath?: string }) => void;
  submitting: boolean;
  errorMessage?: string;
}

export function AppForm({ initial, prefill, onSubmit, submitting, errorMessage }: AppFormProps) {
  const [name, setName] = useState(initial?.name ?? prefill?.name ?? "");
  const [exePath, setExePath] = useState(initial?.exe_path ?? prefill?.exePath ?? "");
  const [iconSourcePath, setIconSourcePath] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (prefill) {
      setName(prefill.name);
      setExePath(prefill.exePath);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  async function pickExe() {
    const selected = await open({ multiple: false, filters: [{ name: "Ejecutables", extensions: ["exe"] }, { name: "Todos los archivos", extensions: ["*"] }] });
    if (typeof selected === "string") {
      setExePath(selected);
      if (!name.trim()) {
        const base = selected.split(/[\\/]/).pop() ?? selected;
        setName(base.replace(/\.[^.]+$/, ""));
      }
    }
  }

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
        if (!name.trim() || !exePath.trim()) return;
        onSubmit({ name: name.trim(), exePath: exePath.trim(), iconSourcePath });
      }}
      className="space-y-3"
    >
      <div>
        <label className="mb-1 block text-[10px] uppercase tracking-widest text-text-dim">Nombre</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej. Visual Studio Code"
          className="h-8 w-full rounded-md border border-border bg-base px-2.5 text-xs text-text outline-none focus:border-accent/60"
        />
      </div>

      <div>
        <label className="mb-1 block text-[10px] uppercase tracking-widest text-text-dim">Ejecutable o enlace web</label>
        <div className="flex gap-2">
          <input
            value={exePath}
            onChange={(e) => setExePath(e.target.value)}
            placeholder="C:\Ruta\a\programa.exe  o  https://sitio.com"
            className="h-8 flex-1 rounded-md border border-border bg-base px-2.5 font-mono text-[11px] text-text outline-none focus:border-accent/60"
          />
          <button
            type="button"
            onClick={pickExe}
            className="flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-text-muted hover:bg-overlay/[0.04]"
          >
            <FileSearch size={13} />
          </button>
        </div>
        <p className="mt-1 text-[10px] text-text-dim">
          Si empieza con http:// o https://, se guarda como enlace y se abre en tu navegador.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-[10px] uppercase tracking-widest text-text-dim">
          Foto {initial?.icon_file && !iconSourcePath ? "(se mantiene la actual)" : ""}
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

      {errorMessage && <p className="text-xs text-accent-bright">{errorMessage}</p>}

      <button
        type="submit"
        disabled={!name.trim() || !exePath.trim() || submitting}
        className="flex h-8 w-full items-center justify-center rounded-md bg-accent text-xs font-medium text-white hover:bg-accent-bright disabled:opacity-40"
      >
        {submitting ? "Guardando..." : initial ? "Guardar cambios" : "Agregar aplicacion"}
      </button>
    </form>
  );
}
