import React, { useEffect, useRef, useId } from 'react';
import { X } from 'lucide-react';

export function ModalDialog({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer = null,
}) {
  const dialogRef = useRef(null);
  const backdropPressStartedOutside = useRef(false);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  const handleCloseEvent = () => {
    if (onClose) onClose();
  };

  // Fallback light-dismiss for browsers lacking closedby="any"
  const handlePointerDown = (e) => {
    if ('closedBy' in HTMLDialogElement.prototype) return;
    if (e.target === dialogRef.current) {
      const rect = dialogRef.current.getBoundingClientRect();
      const clickedInDialog =
        rect.top <= e.clientY &&
        e.clientY <= rect.top + rect.height &&
        rect.left <= e.clientX &&
        e.clientX <= rect.left + rect.width;
      backdropPressStartedOutside.current = !clickedInDialog;
    } else {
      backdropPressStartedOutside.current = false;
    }
  };

  const handlePointerUp = (e) => {
    if ('closedBy' in HTMLDialogElement.prototype) return;
    if (backdropPressStartedOutside.current && e.target === dialogRef.current) {
      const rect = dialogRef.current.getBoundingClientRect();
      const releasedOutside =
        e.clientY < rect.top ||
        e.clientY > rect.top + rect.height ||
        e.clientX < rect.left ||
        e.clientX > rect.left + rect.width;
      if (releasedOutside && dialogRef.current.open) {
        dialogRef.current.close();
      }
    }
    backdropPressStartedOutside.current = false;
  };

  return (
    <dialog
      ref={dialogRef}
      closedby="any"
      aria-labelledby={titleId}
      onClose={handleCloseEvent}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      className="studio-dialog"
    >
      <div className="flex flex-col max-h-[calc(100dvh-2rem)]">
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-slate-800/80 shrink-0">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-white">
              {title}
            </h2>
            {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/70 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">{children}</div>

        {footer && (
          <div className="px-5 py-3.5 border-t border-slate-800/80 bg-[#0b0e15] flex items-center justify-end gap-2 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </dialog>
  );
}

