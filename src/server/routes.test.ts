import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    set: (name: string, value: string) => jar.set(name, value),
  }),
}));
process.env.CAFECITO_DB = ":memory:";
process.env.CAFECITO_DEMO = "1";

const groups = await import("@/app/api/groups/route");
const group = await import("@/app/api/groups/[id]/route");
const me = await import("@/app/api/groups/[id]/me/route");
const overrides = await import("@/app/api/groups/[id]/me/overrides/route");
const invites = await import("@/app/api/groups/[id]/invites/route");
const invite = await import("@/app/api/groups/[id]/invites/[inviteId]/route");
const member = await import("@/app/api/groups/[id]/members/[memberId]/route");
const events = await import("@/app/api/groups/[id]/events/route");
const join = await import("@/app/api/invites/[token]/route");
const { handle, SESSION_COOKIE } = await import("./http");
const { subscribe } = await import("./events");

const ctx = <T extends object>(params: T & { id?: string } = {} as T) => ({ params: Promise.resolve({ id: "me", ...params }) });
const req = (body: unknown = {}, type = "application/json") =>
  new Request("http://x/", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": type },
  });
const as = (id: string) => jar.set(SESSION_COOKIE, `demo-${id}`);
const get = async () => (await group.GET(req(), ctx())).json();
const profile = { name: "Zed", color: "#112233", timeZone: "Europe/Paris" };

beforeEach(() => {
  jar.clear();
  as("you");
});

describe("API routes", () => {
  it("serves the signed-in member's group, by id or as 'me'", async () => {
    expect(await get()).toMatchObject({ id: "demo", meId: "you", ownerId: "you" });
    expect((await group.GET(req(), ctx({ id: "demo" }))).status).toBe(200);
    as("camille");
    expect(await get()).toMatchObject({ meId: "camille" });
  });

  it("answers 401 without a session, 404 for another group", async () => {
    jar.clear();
    expect((await group.GET(req(), ctx())).status).toBe(401);
    jar.set(SESSION_COOKIE, "forged");
    expect((await group.GET(req(), ctx())).status).toBe(401);
    as("you");
    const res = await group.GET(req(), ctx({ id: "other" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "No such group" });
  });

  it("writes the caller's profile and overrides", async () => {
    expect(await (await me.PATCH(req({ name: "Yo" }), ctx())).json()).toEqual({ ok: true });
    await overrides.PATCH(req({ set: { 7: "m" } }), ctx());
    expect((await get()).members[0]).toMatchObject({ name: "Yo", overrides: { 7: "m" } });
  });

  it("refuses bodies that are not JSON", async () => {
    expect((await me.PATCH(req("name=x", "text/plain"), ctx())).status).toBe(415);
    expect((await me.PATCH(req("{nope"), ctx())).status).toBe(400);
  });

  it("applies the member's rights: only the owner changes the group", async () => {
    as("camille");
    expect((await group.PATCH(req({ slotMinutes: 60 }), ctx())).status).toBe(403);
    as("you");
    expect((await group.PATCH(req({ slotMinutes: 60 }), ctx())).status).toBe(200);
    expect((await get()).slotMinutes).toBe(60);
  });

  it("lets unexpected errors through instead of hiding them as a JSON error", async () => {
    await expect(handle(ctx().params, () => { throw new Error("boom"); })).rejects.toThrow("boom");
  });
});

describe("start a group and join it", () => {
  it("creates a group and signs the creator in as owner", async () => {
    jar.clear();
    expect((await groups.POST(req({ ...profile, groupName: "Climbers" }))).status).toBe(200);
    expect(await get()).toMatchObject({ name: "Climbers", members: [{ name: "Zed" }] });
    expect((await groups.POST(req({ ...profile, groupName: "" }))).status).toBe(400);
  });

  it("lets a guest see the invite, join, and then act as themselves", async () => {
    const created = await (await invites.POST(req({ days: 1, maxUses: 2 }), ctx())).json();
    expect(await (await invites.GET(req(), ctx())).json()).toMatchObject([{ id: created.id, uses: 0 }]);

    jar.clear();
    const token = { token: created.token };
    expect(await (await join.GET(req(), ctx(token))).json()).toMatchObject({ groupName: "Café crew" });
    expect((await join.POST(req({ ...profile, name: "" }), ctx(token))).status).toBe(400);
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    const seen: unknown[] = [];
    subscribe("demo", { memberId: "you", send: (e) => seen.push(e), close() {} });
    expect((await join.POST(req(profile), ctx(token))).status).toBe(200);
    expect(seen).toMatchObject([{ reload: true }]); // the group's open pages learn someone joined
    const g = await get();
    expect(g.members.find((m: { id: string }) => m.id === g.meId)).toMatchObject({ name: "Zed" });
    expect(g.ownerId).toBe("you");
    expect((await invites.GET(req(), ctx())).status).toBe(403);
  });

  it("refuses a bad or revoked link", async () => {
    expect((await join.GET(req(), ctx({ token: "nope" }))).status).toBe(404);
    expect((await join.POST(req(profile), ctx({ token: "nope" }))).status).toBe(404);
    expect((await join.POST(req("x", "text/plain"), ctx({ token: "nope" }))).status).toBe(415);
    const { id, token } = await (await invites.POST(req(), ctx())).json();
    expect((await invite.DELETE(req(), ctx({ inviteId: id }))).status).toBe(200);
    expect((await join.GET(req(), ctx({ token }))).status).toBe(404);
  });

  it("removes a member, who is then signed out", async () => {
    expect((await member.DELETE(req(), ctx({ memberId: "diego" }))).status).toBe(200);
    expect((await get()).members.map((m: { id: string }) => m.id)).not.toContain("diego");
    as("diego");
    expect((await group.GET(req(), ctx())).status).toBe(401);
  });
});

describe("live updates", () => {
  const open = async (as_: string) => {
    as(as_);
    const abort = new AbortController();
    const res = await events.GET(new Request("http://x/", { signal: abort.signal }), ctx());
    return { res, reader: res.body!.getReader(), abort };
  };
  const next = async (reader: ReadableStreamDefaultReader<Uint8Array>) =>
    new TextDecoder().decode((await reader.read()).value);

  it("streams a member's change to the rest of the group, and closes when they are removed", async () => {
    const watcher = await open("camille");
    expect(watcher.res.headers.get("content-type")).toBe("text/event-stream");
    expect(await next(watcher.reader)).toBe(": open\n\n");

    as("you");
    await me.PATCH(req({ name: "Yo" }), ctx());
    const event = JSON.parse((await next(watcher.reader)).replace(/^data: /, ""));
    expect(event).toMatchObject({ by: "you", member: { id: "you", name: "Yo" } });

    const written = await overrides.PATCH(req({ set: { 7: "m" }, remove: [3] }), ctx());
    expect(await written.json()).toEqual({ ok: true });
    expect(JSON.parse((await next(watcher.reader)).replace(/^data: /, ""))).toEqual({
      by: "you",
      overrides: { set: { 7: "m" }, remove: [3] }, // just the change, not the member's history
    });

    await group.PATCH(req({ slotMinutes: 15 }), ctx());
    expect(JSON.parse((await next(watcher.reader)).replace(/^data: /, ""))).toEqual({ by: "you", reload: true });

    await member.DELETE(req(), ctx({ memberId: "camille" }));
    expect((await watcher.reader.read()).done).toBe(true);
  });

  it("stops sending once the client goes away, and needs a session", async () => {
    const watcher = await open("diego");
    await next(watcher.reader);
    watcher.abort.abort();
    expect((await watcher.reader.read()).done).toBe(true);
    jar.clear();
    expect((await events.GET(new Request("http://x/"), ctx())).status).toBe(401);
  });
});
