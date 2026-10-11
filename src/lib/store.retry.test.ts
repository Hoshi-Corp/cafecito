import { afterEach, expect, it, vi } from "vitest";
import { retryLoad, updateGroup } from "./store";

// Own file: the store keeps its state per module, and this test needs it empty.
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("retries a failed first load until the group arrives", async () => {
  vi.useFakeTimers();
  const group = { id: "demo", slotMinutes: 30, meId: "a", ownerId: "a", members: [] };
  let gets = 0;
  const patches: unknown[] = [];
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") patches.push(init.body);
    if (!init?.method && ++gets === 1) return { ok: false, status: 500 };
    return { ok: true, json: async () => group };
  });
  vi.spyOn(console, "error").mockImplementation(() => {});

  await retryLoad();
  updateGroup({ slotMinutes: 60 });
  expect(gets).toBe(1);
  expect(patches).toEqual([]); // nothing loaded yet, so there is no group to change

  await vi.advanceTimersByTimeAsync(3000);
  expect(gets).toBe(2);
  updateGroup({ slotMinutes: 60 });
  await vi.advanceTimersByTimeAsync(0);
  expect(patches).toHaveLength(1); // now loaded
});

it("gives up after three failed loads and tries again only when asked", async () => {
  vi.useFakeTimers();
  vi.resetModules();
  const { retryLoad } = await import("./store");
  let gets = 0;
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) =>
    init?.method ? { ok: true } : (gets++, { ok: false, status: 500 }),
  );
  vi.spyOn(console, "error").mockImplementation(() => {});

  await retryLoad();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(gets).toBe(3);

  retryLoad();
  await vi.advanceTimersByTimeAsync(0);
  expect(gets).toBe(4);
});
