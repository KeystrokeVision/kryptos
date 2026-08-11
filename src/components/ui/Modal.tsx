import { useEffect } from "react";
import { X } from "lucide-react";
import { createPortal } from "react-dom";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  widthClassName?: string;
}

export function Modal({ title, onClose, children, widthClassName = "w-[420px]" }: ModalProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`${widthClassName} max-h-[85vh] overflow-y-auto rounded-lg border border-border bg-panel shadow-panel`}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-xs font-medium uppercase tracking-widest text-text-muted">{title}</h3>
          <button onClick={onClose} className="text-text-dim hover:text-text">
            <X size={14} />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>,
    document.body
  );
}
