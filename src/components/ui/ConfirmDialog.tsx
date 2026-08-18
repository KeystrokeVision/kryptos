import { AlertTriangle } from "lucide-react";
import { Modal } from "@/components/ui/Modal";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Every destructive or system-changing action in KRYPTOS (kill process,
 * delete baseline, delete firewall rule, remove app) should confirm
 * through this component instead of window.confirm(), so the prompt looks
 * like the rest of the app and the action being confirmed is always named
 * explicitly rather than a generic browser "Are you sure?".
 */
export function ConfirmDialog({ title, message, confirmLabel = "Confirmar", cancelLabel = "Cancelar", danger = true, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Modal title={title} onClose={onCancel} widthClassName="w-[380px]">
      <div className="flex items-start gap-3">
        {danger && <AlertTriangle size={18} className="mt-0.5 shrink-0 text-accent-bright" />}
        <p className="text-xs leading-relaxed text-text-muted">{message}</p>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="h-8 rounded-md border border-border px-3 text-xs text-text-muted hover:bg-overlay/[0.04]"
        >
          {cancelLabel}
        </button>
        <button
          onClick={onConfirm}
          className={`h-8 rounded-md px-3 text-xs font-medium text-white ${danger ? "bg-accent hover:bg-accent-bright" : "bg-overlay/10 hover:bg-overlay/20"}`}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
