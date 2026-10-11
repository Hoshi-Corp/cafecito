// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EMPTY_PATTERN } from "@/lib/availability";
import { GroupApp } from "./GroupApp";

// Own file: the store keeps its state per module, and this test needs it empty.
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("shows loading, then a retry once loading has failed for good, then the group", async () => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const group = {
    id: "demo",
    name: "Café crew",
    slotMinutes: 30,
    meId: "a",
    ownerId: "a",
    members: [{ id: "a", name: "Ana", color: "#000000", timeZone: "UTC", pattern: EMPTY_PATTERN, overrides: {} }],
  };
  let up = false;
  vi.stubGlobal("fetch", async () => (up ? { ok: true, json: async () => group } : { ok: false, status: 500 }));

  render(<GroupApp />);
  expect(screen.getByText("Loading…")).toBeTruthy();
  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(screen.getByText("Loading…")).toBeTruthy();
  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(screen.getByText(/Could not load the group/)).toBeTruthy();

  up = true;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Café crew");
});
