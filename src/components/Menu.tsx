"use client";

import { useEffect, useRef, useState } from "react";

/** A ⋯ button that opens a short list of actions. A tap elsewhere or Escape closes it. */
export function Menu({ label, items }: { label: string; items: { label: string; onSelect: () => void; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    // Keyboard users land on the first action.
    ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      ref.current?.querySelector("button")?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative shrink-0">
      <button aria-label={label} aria-haspopup="menu" aria-expanded={open} className="icon-btn" onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor">
          <circle cx="5" cy="12" r="2.2" />
          <circle cx="12" cy="12" r="2.2" />
          <circle cx="19" cy="12" r="2.2" />
        </svg>
      </button>
      {open && (
        <div role="menu" aria-label={label} className="menu">
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              className={`menu-item${item.danger ? " text-danger" : ""}`}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
