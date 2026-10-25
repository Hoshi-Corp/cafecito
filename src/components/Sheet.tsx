"use client";

import { useId, useLayoutEffect, useRef, type ReactNode } from "react";

type Props = { title: string; open: boolean; onClose: () => void; children: ReactNode };

/**
 * A pop-up card over the page: a modal <dialog>, so focus stays inside and the page behind can't be used. Escape,
 * the ✕, or a tap on the dimmed page closes it. It only exists while open, so a form inside starts fresh each time.
 */
export function Sheet(props: Props) {
  return props.open ? <OpenSheet {...props} /> : null;
}

function OpenSheet({ title, onClose, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    // Its own component, so this runs while the dialog is still on the page: closing it there (not only taking it
    // off) is what puts keyboard focus back where it was before it opened.
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      className="sheet"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // A tap outside the card lands on the dialog itself (the card fills it).
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex flex-col gap-1 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <h3 id={id} className="round pt-1 text-xl font-bold">
            {title}
          </h3>
          <button aria-label="Close" className="icon-btn -mt-1 -mr-2 shrink-0 text-lg" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
