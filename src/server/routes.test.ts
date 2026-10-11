import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    set: (name: string, value: string) => jar.set(name, value),
  }),
}));
process.env.CAFECITO_DB = ":memory:";

const group = await import("@/app/api/groups/[id]/route");
const me = await import("@/app/api/groups/[id]/me/route");
const overrides = await import("@/app/api/groups/[id]/me/overrides/route");
const session = await import("@/app/api/groups/[id]/session/route");
const { handle, ME_COOKIE } = await import("./http");

const ctx = (id = "demo") => ({ params: Promise.resolve({ id }) });
const req = (body: unknown, type = "application/json") =>
  new Request("http://x/", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": type },
  });
const get = async () => (await group.GET(req({}), ctx())).json();

beforeEach(() => jar.clear());

describe("API routes", () => {
  it("serves the group and signs a new browser in as its first member", async () => {
    const res = await group.GET(req({}), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "demo", meId: "you", ownerId: "you" });
    expect(jar.get(ME_COOKIE)).toBe("you");
  });

  it("answers 404 for a group that does not exist", async () => {
    const res = await group.GET(req({}), ctx("missing"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "No such group" });
  });

  it("writes the caller's profile and overrides", async () => {
    expect(await (await me.PATCH(req({ name: "Yo" }), ctx())).json()).toEqual({ ok: true });
    await overrides.PATCH(req({ set: { 7: "m" } }), ctx());
    const you = (await get()).members[0];
    expect(you).toMatchObject({ name: "Yo", overrides: { 7: "m" } });
  });

  it("refuses bodies that are not JSON", async () => {
    expect((await me.PATCH(req("name=x", "text/plain"), ctx())).status).toBe(415);
    expect((await me.PATCH(req("{nope"), ctx())).status).toBe(400);
  });

  it("switches member through the session route and applies that member's rights", async () => {
    expect((await session.POST(req({ memberId: "camille" }), ctx())).status).toBe(200);
    expect((await get()).meId).toBe("camille");
    expect((await group.PATCH(req({ slotMinutes: 60 }), ctx())).status).toBe(403);

    await session.POST(req({ memberId: "you" }), ctx());
    expect((await group.PATCH(req({ slotMinutes: 60 }), ctx())).status).toBe(200);
    expect((await get()).slotMinutes).toBe(60);
  });

  it("rejects a session for an unknown member, another group's member or a non-JSON body", async () => {
    expect((await session.POST(req({ memberId: "nobody" }), ctx())).status).toBe(400);
    expect((await session.POST(req({ memberId: "camille" }), ctx("other"))).status).toBe(400);
    expect((await session.POST(req({ memberId: 3 }), ctx())).status).toBe(400);
    expect((await session.POST(req("memberId=camille", "text/plain"), ctx())).status).toBe(400);
    expect(jar.has(ME_COOKIE)).toBe(false);
  });

  it("lets unexpected errors through instead of hiding them as a JSON error", async () => {
    await expect(handle(ctx().params, () => { throw new Error("boom"); })).rejects.toThrow("boom");
  });
});
