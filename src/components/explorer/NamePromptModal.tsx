import { useState } from "react";
import { Modal } from "@/components/ui/Modal";

interface NamePromptModalProps {
  title: string;
  confirmLabel: string;
  initialValue?: string;
  placeholder?: string;
  submitting: boolean;
  errorMessage?: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

export function NamePromptModal({
  title,
  confirmLabel,
  initialValue = "",
  placeholder,
  submitting,
  errorMessage,
  onSubmit,
  onCancel,
}: NamePromptModalProps) {
  const [value, setValue] = useState(initialValue);

  return (
    <Modal title={title} onClose={onCancel} widthClassName="w-[360px]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSubmit(value.trim());
        }}
        className="space-y-3"
      >
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          onFocus={(e) => e.currentTarget.select()}
          className="h-8 w-full rounded-md border border-border bg-base px-2.5 text-xs text-text outline-none focus:border-accent/60"
        />
        {errorMessage && <p className="text-xs text-accent-bright">{errorMessage}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="h-8 rounded-md border border-border px-3 text-xs text-text-muted hover:bg-white/[0.04]">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!value.trim() || submitting}
            className="h-8 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-bright disabled:opacity-40"
          >
            {submitting ? "Guardando..." : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
