"use client";

import { useId, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";

export interface GridColumn {
  key: string;
  label: string;
  sub?: string;
  highlight?: boolean;
}

export interface GridRow {
  key: string;
  /** Shown in the time gutter; rows that start an hour carry one. */
  label?: string;
}

export interface CellRange {
  col0: number;
  col1: number;
  row0: number;
  row1: number;
}

interface Props {
  /** What the grid shows, for screen readers. */
  label: string;
  columns: GridColumn[];
  rows: GridRow[];
  rowHeight: number;
  cellStyle: (col: number, row: number) => CSSProperties | undefined;
  cellLabel?: (col: number, row: number) => string;
  /** Drag to paint a rectangle of cells. */
  onPaint?: (range: CellRange) => void;
  /** Background previewed on the cells being dragged over. */
  paintPreview?: string;
  /** Touches scroll the page instead of painting (mouse and keyboard still paint). */
  scrollTouches?: boolean;
  onSelect?: (col: number, row: number) => void;
  selected?: { col: number; row: number } | null;
}

function cellAt(x: number, y: number) {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-col]");
  return el ? { col: Number(el.dataset.col), row: Number(el.dataset.row) } : null;
}

export function WeekGrid({
  label,
  columns,
  rows,
  rowHeight,
  cellStyle,
  cellLabel,
  onPaint,
  paintPreview,
  scrollTouches,
  onSelect,
  selected,
}: Props) {
  const [drag, setDrag] = useState<{ from: { col: number; row: number }; to: { col: number; row: number } } | null>(null);
  const [focus, setFocus] = useState({ col: 0, row: 0 });
  const hintId = useId();
  // Rows or columns can shrink (e.g. "Show all 24 hours" off) under the focused cell.
  const cur = { col: Math.min(focus.col, columns.length - 1), row: Math.min(focus.row, rows.length - 1) };
  const range: CellRange | null = drag && {
    col0: Math.min(drag.from.col, drag.to.col),
    col1: Math.max(drag.from.col, drag.to.col),
    row0: Math.min(drag.from.row, drag.to.row),
    row1: Math.max(drag.from.row, drag.to.row),
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const cell = cellAt(e.clientX, e.clientY);
    if (!cell) return;
    if (!onPaint) return onSelect?.(cell.col, cell.row);
    if (scrollTouches && e.pointerType === "touch") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ from: cell, to: cell });
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const cell = cellAt(e.clientX, e.clientY);
    if (cell && (cell.col !== drag.to.col || cell.row !== drag.to.row)) setDrag({ ...drag, to: cell });
  };
  const onPointerUp = () => {
    if (range) onPaint?.(range);
    setDrag(null);
  };

  // One tab stop for the whole grid; arrows move inside it, Enter or Space selects or paints a cell,
  // and Shift with an arrow paints the cells it moves across.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (step) {
      e.preventDefault();
      const col = Math.max(0, Math.min(columns.length - 1, cur.col + step[0]));
      const row = Math.max(0, Math.min(rows.length - 1, cur.row + step[1]));
      if (e.shiftKey && onPaint)
        onPaint({
          col0: Math.min(cur.col, col),
          col1: Math.max(cur.col, col),
          row0: Math.min(cur.row, row),
          row1: Math.max(cur.row, row),
        });
      setFocus({ col, row });
      e.currentTarget.querySelector<HTMLElement>(`[data-col="${col}"][data-row="${row}"]`)?.focus();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (onPaint) onPaint({ col0: cur.col, col1: cur.col, row0: cur.row, row1: cur.row });
      else onSelect?.(cur.col, cur.row);
    }
  };

  const template = { gridTemplateColumns: `3.25rem repeat(${columns.length}, minmax(0, 1fr))` };

  return (
    <div className="select-none" role="group" aria-label={label} aria-describedby={hintId}>
      <p id={hintId} className="sr-only">
        {onPaint
          ? "Arrow keys move between slots. Enter or Space paints a slot; hold Shift with an arrow key to paint as you move."
          : "Arrow keys move between slots. Enter or Space shows who is free."}
      </p>
      <div className="sticky top-0 z-10 grid gap-x-[3px] bg-card pt-1 pb-2 sm:gap-x-[5px]" style={template}>
        <div />
        {columns.map((c) => (
          <div
            key={c.key}
            aria-current={c.highlight ? "date" : undefined}
            className={`rounded-xl py-1.5 text-center leading-tight ${
              c.highlight ? "bg-sun text-[#1c2840] shadow-[0_4px_0_var(--sun-edge)]" : ""
            }`}
          >
            <div className={`text-sm ${c.highlight ? "font-semibold" : "text-muted"}`}>{c.label}</div>
            {c.sub && (
              <div data-day className="round text-lg font-bold">
                {c.sub}
              </div>
            )}
          </div>
        ))}
      </div>
      <div
        className="grid gap-x-[3px] gap-y-[2px] pt-3.5 sm:gap-x-[5px]"
        style={template}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
        onKeyDown={onKeyDown}
      >
        {rows.map((r, row) => (
          <div key={r.key} className="contents">
            <div className="relative" style={{ height: rowHeight }}>
              {r.label && (
                <span className="absolute -top-2.5 right-1.5 text-sm leading-none whitespace-nowrap text-muted tabular-nums">{r.label}</span>
              )}
            </div>
            {columns.map((c, col) => {
              const painting =
                range && col >= range.col0 && col <= range.col1 && row >= range.row0 && row <= range.row1;
              const isSelected = selected?.col === col && selected.row === row;
              return (
                <div
                  key={c.key}
                  data-col={col}
                  data-row={row}
                  role={onSelect || onPaint ? "button" : undefined}
                  aria-pressed={onSelect && !onPaint ? isSelected : undefined}
                  tabIndex={col === cur.col && row === cur.row ? 0 : -1}
                  onFocus={() => setFocus({ col, row })}
                  aria-label={cellLabel?.(col, row)}
                  title={cellLabel?.(col, row)}
                  className={`rounded-[4px] bg-cell ${
                    onPaint
                      ? `cursor-crosshair ${scrollTouches ? "" : "touch-none"}`
                      : "cursor-pointer transition-transform duration-150 hover:scale-110"
                  } ${isSelected ? "pop relative z-[1] outline-2 outline-offset-1 outline-foreground" : ""}`}
                  style={{
                    height: rowHeight,
                    ...(painting && paintPreview ? { background: paintPreview, opacity: 0.75 } : cellStyle(col, row)),
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
