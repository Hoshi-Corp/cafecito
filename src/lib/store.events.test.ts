// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EMPTY_PATTERN } from "./availability";
import type { Group, GroupEvent } from "./types";

// Own file: the store keeps its state per module.
const member = (id: string, name: string, pattern = EMPTY_PATTERN) => ({ id, name, color: "#000000", timeZone: "UTC", pattern, overrides: {} });
const group: Group = { id: "g", name: "G", slotMinutes: 30, meId: "a", ownerId: "a", members: [member("a", "Ana"), member("b", "Ben")] };

class FakeSource {
  static last: FakeSource;
  static CLOSED = 2;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSource.last = this;
  }
  close() {
    this.readyState = FakeSource.CLOSED;
  }
  emit(event: GroupEvent) {
    act(() => this.onmessage!({ data: JSON.stringify(event) }));
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("applies other people's changes live and hints who made them", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("EventSource", FakeSource);
  let status = 200;
  let gets = 0;
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    if (!init?.method) gets++;
    return status === 200 ? { ok: true, status, json: async () => group } : { ok: false, status };
  });
  const store = await import("./store");
  const { result } = renderHook(() => ({
    group: store.useGroup(),
    recent: store.useRecentChange(),
    signedOut: store.useSignedOut(),
  }));
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(result.current.group?.name).toBe("G");
  expect(FakeSource.last.url).toBe("/api/groups/me/events");
  FakeSource.last.onopen!(); // first connection: nothing to resync
  expect(gets).toBe(1);

  // Someone else's change replaces just that member, without a reload, and shows a hint for a few seconds.
  FakeSource.last.emit({ by: "b", member: member("b", "Ben", "f" + EMPTY_PATTERN.slice(1)) });
  expect(result.current.group?.members[1].pattern[0]).toBe("f");
  expect(result.current.recent).toBe("Ben");
  expect(gets).toBe(1);
  await act(() => vi.advanceTimersByTimeAsync(8000));
  expect(result.current.recent).toBeNull();

  // Override changes arrive as a delta and are merged into what is already there.
  FakeSource.last.emit({ by: "b", overrides: { set: { 5: "b", 6: "f" }, remove: [] } });
  FakeSource.last.emit({ by: "b", overrides: { set: { 7: "m" }, remove: [6] } });
  expect(result.current.group?.members[1].overrides).toEqual({ 5: "b", 7: "m" });
  expect(result.current.recent).toBe("Ben");
  await act(() => vi.advanceTimersByTimeAsync(8000));

  // My own change echoing back while my write is in flight must not undo local edits; otherwise it applies silently.
  FakeSource.last.emit({ by: "a", member: member("a", "Ana2") });
  expect(result.current.group?.members[0].name).toBe("Ana2");
  expect(result.current.recent).toBeNull();

  // Bigger changes, and reconnecting after a drop, load the group again.
  FakeSource.last.emit({ by: "b", reload: true });
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(gets).toBe(2);
  FakeSource.last.onopen!();
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(gets).toBe(3);

  // A dropped connection that EventSource is retrying is left alone; a refused one is retried later, not in a loop.
  FakeSource.last.onerror!();
  expect(gets).toBe(3);
  FakeSource.last.readyState = FakeSource.CLOSED;
  FakeSource.last.onerror!();
  await act(() => vi.advanceTimersByTimeAsync(5000));
  expect(gets).toBe(4);

  // Removed by the owner: the next load is a 401, which signs the browser out.
  status = 401;
  FakeSource.last.emit({ by: "a", reload: true });
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(result.current.signedOut).toBe(true);
  expect(result.current.group).toBeNull();
  expect(FakeSource.last.readyState).toBe(FakeSource.CLOSED);
});

it("stops retrying the live stream after a few refusals", async () => {
  vi.useFakeTimers();
  vi.resetModules();
  vi.stubGlobal("EventSource", FakeSource);
  vi.spyOn(console, "error").mockImplementation(() => {});
  let gets = 0;
  vi.stubGlobal("fetch", async () => (gets++, { ok: true, status: 200, json: async () => group }));
  const store = await import("./store");
  await store.retryLoad();
  for (let i = 0; i < 5; i++) {
    FakeSource.last.readyState = FakeSource.CLOSED;
    FakeSource.last.onerror!();
    await vi.advanceTimersByTimeAsync(5000);
  }
  expect(gets).toBe(3); // the first load plus two retries, then it gives up
});
