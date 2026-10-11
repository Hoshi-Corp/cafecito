import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_PATTERN } from "./availability";
import { signInAs, updateGroup, updateMember } from "./store";
import type { Group } from "./types";

const group: Group = {
  id: "demo",
  name: "G",
  slotMinutes: 30,
  meId: "a",
  ownerId: "a",
  members: [{ id: "a", name: "A", color: "#000000", timeZone: "UTC", pattern: EMPTY_PATTERN, overrides: { 1: "f", 2: "b" } }],
};

/** Loads `group` into the store and records every write the store then sends. */
async function setup() {
  const writes: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") writes.push({ url, method: "PATCH", body: JSON.parse(init.body as string) });
    return { ok: true, json: async () => group };
  });
  await signInAs("a");
  return writes;
}

afterEach(() => vi.unstubAllGlobals());

describe("store writes", () => {
  it("sends only what changed: profile fields, set marks and removed marks", async () => {
    const writes = await setup();
    updateMember("a", (m) => ({ ...m, name: "Ana", overrides: { 2: "b", 3: "m" } }));
    await vi.waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[0]).toMatchObject({ url: "/api/groups/demo/me", body: { name: "Ana" } });
    expect(writes[1]).toMatchObject({ url: "/api/groups/demo/me/overrides", body: { set: { 3: "m" }, remove: [1] } });
  });

  it("sends nothing for another member or an unchanged member", async () => {
    const writes = await setup();
    updateMember("b", (m) => ({ ...m, name: "X" }));
    updateMember("a", (m) => ({ ...m }));
    await new Promise((r) => setTimeout(r, 20));
    expect(writes).toEqual([]);
  });

  it("sends only the slot size for a group change", async () => {
    const writes = await setup();
    updateGroup({ slotMinutes: 60 });
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ url: "/api/groups/demo", body: { slotMinutes: 60 } });
  });
});
