// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WeekGrid, type GridColumn, type GridRow } from "./WeekGrid";

const columns: GridColumn[] = [
  { key: "mon", label: "Mon", sub: "12" },
  { key: "tue", label: "Tue", sub: "13", highlight: true },
  { key: "wed", label: "Wed" },
];
const rows: GridRow[] = [{ key: "0", label: "7 AM" }, { key: "30" }, { key: "60", label: "8 AM" }];

// jsdom has no layout, so the pointer is "over" whichever element the test names.
let under: Element | null = null;
const capture = vi.fn();
beforeEach(() => {
  under = null;
  capture.mockClear();
  document.elementFromPoint = () => under;
  Element.prototype.setPointerCapture = capture;
});
afterEach(cleanup);

function setup(props: Partial<Parameters<typeof WeekGrid>[0]> = {}) {
  const view = render(
    <WeekGrid
      label="Test grid"
      columns={columns}
      rows={rows}
      rowHeight={10}
      cellStyle={() => undefined}
      cellLabel={(col, row) => `${col},${row}`}
      {...props}
    />,
  );
  const cell = (col: number, row: number) =>
    view.container.querySelector<HTMLElement>(`[data-col="${col}"][data-row="${row}"]`)!;
  const grid = cell(0, 0).parentElement!.parentElement!;
  const point = (type: "pointerDown" | "pointerMove", el: Element | null, init = {}) => {
    under = el;
    fireEvent[type](grid, init);
  };
  return { ...view, cell, grid, point };
}

describe("WeekGrid", () => {
  it("shows a header per column with today marked, hour labels in the gutter and a label on every cell", () => {
    const { getByText, queryByText, cell, container } = setup();
    expect(getByText("Tue").closest("[aria-current=date]")).toBeTruthy();
    expect(getByText("Mon").closest("[aria-current=date]")).toBeNull();
    expect(getByText("13").closest("[aria-current=date]")).toBeTruthy();
    expect(getByText("7 AM")).toBeTruthy();
    expect(queryByText("7:30 AM")).toBeNull();
    expect(container.querySelectorAll("[data-col]")).toHaveLength(9);
    expect(cell(2, 1).getAttribute("aria-label")).toBe("2,1");
    // Read-only: cells are not buttons.
    expect(cell(0, 0).getAttribute("role")).toBeNull();
  });

  it("applies the cell style and outlines the selected cell", () => {
    const { cell } = setup({
      onSelect: () => {},
      selected: { col: 1, row: 2 },
      cellStyle: (col, row) => (col === 0 && row === 1 ? { background: "red" } : undefined),
    });
    expect(cell(0, 1).style.background).toBe("red");
    expect(cell(0, 0).style.background).toBe("");
    expect(cell(1, 2).className).toContain("outline-2");
    expect(cell(1, 1).className).not.toContain("outline-2");
  });

  it("selects the cell under the pointer and ignores presses outside the cells", () => {
    const onSelect = vi.fn();
    const { cell, point } = setup({ onSelect });
    point("pointerDown", null);
    expect(onSelect).not.toHaveBeenCalled();
    point("pointerDown", cell(2, 1));
    expect(onSelect).toHaveBeenCalledWith(2, 1);
    expect(capture).not.toHaveBeenCalled();
  });

  it("paints the rectangle dragged over, previewing it on the way", () => {
    const onPaint = vi.fn();
    const { cell, grid, point } = setup({ onPaint, paintPreview: "red" });
    point("pointerMove", cell(1, 1)); // no drag yet
    expect(cell(1, 1).style.background).toBe("");

    point("pointerDown", cell(2, 2), { pointerId: 1 });
    expect(capture).toHaveBeenCalled();
    point("pointerMove", cell(1, 0));
    point("pointerMove", cell(1, 0)); // same cell again
    point("pointerMove", null); // left the grid: keep the last cell
    expect(cell(1, 0).style.background).toBe("red");
    expect(cell(2, 2).style.opacity).toBe("0.75");
    expect(cell(0, 0).style.background).toBe("");

    fireEvent.pointerUp(grid);
    expect(onPaint).toHaveBeenCalledExactlyOnceWith({ col0: 1, col1: 2, row0: 0, row1: 2 });
    expect(cell(1, 0).style.background).toBe("");
  });

  it("paints nothing when the drag is cancelled or released without one", () => {
    const onPaint = vi.fn();
    const { cell, grid, point } = setup({ onPaint, paintPreview: "red" });
    fireEvent.pointerUp(grid);
    point("pointerDown", cell(0, 0));
    fireEvent.pointerCancel(grid);
    expect(cell(0, 0).style.background).toBe("");
    fireEvent.pointerUp(grid);
    expect(onPaint).not.toHaveBeenCalled();
  });

  it("lets touches scroll instead of painting when asked, while the mouse still paints", () => {
    const onPaint = vi.fn();
    const { cell, grid, point } = setup({ onPaint, scrollTouches: true });
    expect(cell(0, 0).className).not.toContain("touch-none");
    point("pointerDown", cell(0, 0), { pointerType: "touch" });
    fireEvent.pointerUp(grid);
    expect(onPaint).not.toHaveBeenCalled();
    point("pointerDown", cell(0, 0), { pointerType: "mouse" });
    fireEvent.pointerUp(grid);
    expect(onPaint).toHaveBeenCalledTimes(1);
  });

  it("moves focus with the arrow keys, stopping at the edges, and keeps one tab stop", () => {
    const { cell } = setup({ onSelect: () => {} });
    const press = (key: string) => fireEvent.keyDown(document.activeElement!, { key });
    act(() => cell(0, 0).focus());
    press("ArrowLeft");
    press("ArrowUp");
    expect(document.activeElement).toBe(cell(0, 0));
    press("ArrowRight");
    press("ArrowDown");
    expect(document.activeElement).toBe(cell(1, 1));
    for (let i = 0; i < 5; i++) press("ArrowRight");
    for (let i = 0; i < 5; i++) press("ArrowDown");
    expect(document.activeElement).toBe(cell(2, 2));
    expect(cell(2, 2).tabIndex).toBe(0);
    expect(cell(0, 0).tabIndex).toBe(-1);
    press("a"); // other keys are left alone
    expect(document.activeElement).toBe(cell(2, 2));
  });

  it("selects or paints the focused cell with Enter or Space", () => {
    const onSelect = vi.fn();
    const select = setup({ onSelect });
    act(() => select.cell(1, 2).focus());
    fireEvent.keyDown(select.cell(1, 2), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(1, 2);
    select.unmount();

    const onPaint = vi.fn();
    const paint = setup({ onPaint });
    act(() => paint.cell(2, 0).focus());
    fireEvent.keyDown(paint.cell(2, 0), { key: " " });
    expect(onPaint).toHaveBeenCalledWith({ col0: 2, col1: 2, row0: 0, row1: 0 });
  });

  it("paints the cells Shift and an arrow key move across, and only moves without Shift", () => {
    const onPaint = vi.fn();
    const { cell } = setup({ onPaint });
    act(() => cell(0, 0).focus());
    fireEvent.keyDown(cell(0, 0), { key: "ArrowDown", shiftKey: true });
    expect(onPaint).toHaveBeenCalledWith({ col0: 0, col1: 0, row0: 0, row1: 1 });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft", shiftKey: true }); // at the edge: just this cell
    expect(onPaint).toHaveBeenLastCalledWith({ col0: 0, col1: 0, row0: 1, row1: 1 });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(onPaint).toHaveBeenCalledTimes(2);
  });

  it("names the grid, explains the keys, and marks the selected cell as pressed", () => {
    const { getByRole, cell, getByText } = setup({ onSelect: vi.fn(), selected: { col: 1, row: 0 } });
    expect(getByRole("group", { name: "Test grid" }).getAttribute("aria-describedby")).toBeTruthy();
    expect(getByText(/Enter or Space shows who is free/)).toBeTruthy();
    expect(cell(1, 0).getAttribute("aria-pressed")).toBe("true");
    expect(cell(0, 0).getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps the focused cell inside the grid when rows are removed", () => {
    const onSelect = vi.fn();
    const { cell, rerender } = setup({ onSelect });
    act(() => cell(2, 2).focus());
    rerender(
      <WeekGrid label="Test grid" columns={columns} rows={rows.slice(0, 1)} rowHeight={10} cellStyle={() => undefined} onSelect={onSelect} />,
    );
    expect(cell(2, 0).tabIndex).toBe(0);
    fireEvent.keyDown(cell(2, 0), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(2, 0);
  });
});
