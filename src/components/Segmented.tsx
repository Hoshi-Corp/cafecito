import type { ReactNode } from "react";

/** A row of choices with a dark pill that slides to the chosen one: the week's views, the wishlist's lists. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: T; label: ReactNode }[];
  value: T;
  onChange: (id: T) => void;
  label?: string;
}) {
  const index = options.findIndex((o) => o.id === value);
  return (
    <nav
      aria-label={label}
      className="relative grid rounded-2xl bg-cell p-1 text-[15px]"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-1 left-1 rounded-xl bg-foreground shadow-[0_3px_0_var(--ledge)] transition-transform duration-500 ease-[cubic-bezier(.3,1.35,.5,1)]"
        style={{ width: `calc((100% - 0.5rem) / ${options.length})`, transform: `translateX(${index * 100}%)` }}
      />
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={`round relative rounded-xl px-1 py-2.5 font-semibold transition-colors duration-300 ${value === o.id ? "text-background" : ""}`}
        >
          {o.label}
        </button>
      ))}
    </nav>
  );
}
