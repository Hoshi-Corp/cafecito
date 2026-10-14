import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
const cookieSets: string[] = [];
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    set: (name: string, value: string) => (cookieSets.push(name), jar.set(name, value)),
    delete: (name: string) => jar.delete(name),
  }),
}));
const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn<(mail: { to: string; text: string }) => Promise<void>>(async () => {}) }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail }) } }));
process.env.CAFECITO_DB = ":memory:";
process.env.CAFECITO_DEMO = "1";

const groups = await import("@/app/api/groups/route");
const group = await import("@/app/api/groups/[id]/route");
const me = await import("@/app/api/groups/[id]/me/route");
const overrides = await import("@/app/api/groups/[id]/me/overrides/route");
const invites = await import("@/app/api/groups/[id]/invites/route");
const invite = await import("@/app/api/groups/[id]/invites/[inviteId]/route");
const member = await import("@/app/api/groups/[id]/members/[memberId]/route");
const outings = await import("@/app/api/groups/[id]/outings/route");
const outingRsvp = await import("@/app/api/groups/[id]/outings/[outingId]/rsvp/route");
const outingOne = await import("@/app/api/groups/[id]/outings/[outingId]/route");
const places = await import("@/app/api/groups/[id]/places/route");
const placeOne = await import("@/app/api/groups/[id]/places/[placeId]/route");
const placeVote = await import("@/app/api/groups/[id]/places/[placeId]/vote/route");
const events = await import("@/app/api/groups/[id]/events/route");
const join = await import("@/app/api/invites/[token]/route");
const accessLink = await import("@/app/api/groups/[id]/me/access-link/route");
const memberLink = await import("@/app/api/groups/[id]/members/[memberId]/access-link/route");
const sessions = await import("@/app/api/groups/[id]/me/sessions/route");
const signIn = await import("@/app/api/sign-in/route");
const signInLink = await import("@/app/api/sign-in/link/route");
const { handle, SESSION_COOKIE } = await import("./http");
const { subscribe } = await import("./events");
const { getDb } = await import("./db");
const { bestWindows, isSetUp } = await import("@/lib/availability");
const { DAY_MS, startSession } = await import("./groups");

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

describe("outing routes", () => {
  it("needs a session and JSON, then proposes, answers and deletes", async () => {
    const { members } = await get();
    const q = Math.floor(Date.now() / 900_000);
    const [w] = bestWindows(members.filter(isSetUp), q + 1, q + 1 + 14 * 96);
    const body = { title: "Brunch", startQ: w.startQ, endQ: w.startQ + 4 };
    const one = (outingId: string) => ctx({ outingId });
    jar.clear();
    expect((await outings.POST(req(body), ctx())).status).toBe(401);
    as("you");
    expect((await outings.POST(req("x", "text/plain"), ctx())).status).toBe(415);
    expect((await outings.POST(req(body), ctx())).status).toBe(200);
    expect((await outings.POST(req({ ...body, startQ: q + 15 * 96, endQ: q + 15 * 96 + 4 }), ctx())).status).toBe(409);
    const { id } = getDb().prepare(`SELECT id FROM outing`).get() as { id: string };
    expect((await outingRsvp.PUT(req({ answer: "y" }), one(id))).status).toBe(200);
    expect((await outingRsvp.PUT(req({ answer: "?" }), one(id))).status).toBe(400);
    as("camille");
    expect((await outingOne.DELETE(req(), one(id))).status).toBe(403);
    as("you");
    expect((await outingOne.DELETE(req(), one(id))).status).toBe(200);
  });
});

describe("wishlist routes", () => {
  it("needs a session and JSON, then adds, votes, edits and deletes, and the group carries the places", async () => {
    const one = (placeId: string) => ctx({ placeId });
    jar.clear();
    expect((await places.POST(req({ name: "Café X" }), ctx())).status).toBe(401);
    as("camille");
    expect((await places.POST(req("x", "text/plain"), ctx())).status).toBe(415);
    expect((await places.POST(req({ name: "Café X", link: "javascript:1" }), ctx())).status).toBe(400);
    expect((await places.POST(req({ name: "Café X", link: "https://x.example" }), ctx())).status).toBe(200);
    const { id } = getDb().prepare(`SELECT id FROM place`).get() as { id: string };
    expect((await placeVote.PUT(req(), one(id))).status).toBe(200);
    expect((await get()).places).toMatchObject([{ id, name: "Café X", suggestedBy: "camille", votes: ["camille"] }]);
    as("diego");
    expect((await placeOne.PATCH(req({ beenThere: true }), one(id))).status).toBe(200);
    expect((await placeOne.PATCH(req({ name: "Mine now" }), one(id))).status).toBe(403);
    expect((await placeOne.DELETE(req(), one(id))).status).toBe(403);
    as("you");
    expect((await placeVote.DELETE(req(), one(id))).status).toBe(200);
    expect((await placeOne.DELETE(req(), one(id))).status).toBe(200);
    expect((await get()).places).toEqual([]);
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

  it("gives a personal link at create and join that signs in a fresh browser, until it is replaced", async () => {
    const spend = (token: unknown) => signInLink.POST(req({ token })); // works with email sign-in off
    jar.clear();
    const created = await (await groups.POST(req({ ...profile, groupName: "Climbers" }))).json();
    expect(created.accessToken).toEqual(expect.any(String));
    const invite = await (await invites.POST(req(), ctx())).json();
    jar.clear();
    const joined = await (await join.POST(req(profile), ctx({ token: invite.token }))).json();
    expect(joined.accessToken).toEqual(expect.any(String));
    const memberId = (await get()).meId;

    jar.clear();
    expect((await spend(joined.accessToken)).status).toBe(200);
    expect((await get()).meId).toBe(memberId);

    const next = (await (await accessLink.POST(req(), ctx())).json()).accessToken;
    jar.clear();
    expect((await spend(joined.accessToken)).status).toBe(404); // replaced
    expect((await spend(next)).status).toBe(200);
  });

  it("lets only the owner replace another member's personal link", async () => {
    const reissue = (memberId: string) => memberLink.POST(req(), ctx({ memberId }));
    as("camille");
    expect((await reissue("diego")).status).toBe(403);
    as("you");
    expect((await reissue("nobody")).status).toBe(404);
    const { accessToken } = await (await reissue("camille")).json();
    jar.clear();
    expect((await signInLink.POST(req({ token: accessToken }))).status).toBe(200);
    expect((await get()).meId).toBe("camille");
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

describe("my account", () => {
  const from = (ip: string, body: unknown = {}, headers: Record<string, string> = {}) =>
    new Request("http://x/", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", "x-forwarded-for": ip, ...headers },
    });

  it("names a new session after the browser, lists devices and signs out the others", async () => {
    jar.clear();
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
    await groups.POST(from("10.0.0.1", { ...profile, groupName: "Devices" }, { "user-agent": ua }));
    const list = await (await sessions.GET(req(), ctx())).json();
    expect(list).toEqual([{ device: "Safari on Mac OS", createdAt: expect.any(Number), lastSeen: expect.any(Number), current: true }]);
    expect(await (await sessions.DELETE(req(), ctx())).json()).toEqual({ signedOut: 0 });
  });

  it("renews the cookie of a session in use, at most daily", async () => {
    startSession(getDb(), "kenji", "", "kenji-old", Date.now() - 2 * DAY_MS);
    jar.set(SESSION_COOKIE, "kenji-old");
    cookieSets.length = 0;
    expect((await group.GET(req(), ctx())).status).toBe(200);
    expect(cookieSets).toEqual([SESSION_COOKIE]);
    await group.GET(req(), ctx());
    expect(cookieSets).toHaveLength(1); // just recorded: no second renewal
  });

  it("downloads my data as a file", async () => {
    const res = await me.GET(req(), ctx());
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(await res.json()).toMatchObject({ group: "Café crew", role: "owner", typicalWeek: expect.any(String) });
  });

  it("deletes my account and signs this browser out", async () => {
    as("sofia");
    expect((await me.DELETE(req(), ctx())).status).toBe(200);
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    as("you");
    expect((await get()).members.map((m: { id: string }) => m.id)).not.toContain("sofia");
  });

  it("rate-limits invite lookups and joins per address", async () => {
    const lookup = () => join.GET(from("10.0.0.2"), ctx({ token: "nope" }));
    for (let i = 0; i < 30; i++) expect((await lookup()).status).toBe(404);
    expect((await lookup()).status).toBe(429);
    expect((await join.POST(from("10.0.0.2", profile), ctx({ token: "nope" }))).status).toBe(429);
    expect((await join.GET(from("10.0.0.3"), ctx({ token: "nope" }))).status).toBe(404);
  });
});

describe("email sign-in", () => {
  const ask = (email: unknown, ip = "10.1.0.1") =>
    signIn.POST(new Request("http://x/", { method: "POST", body: JSON.stringify({ email }), headers: { "content-type": "application/json", "x-forwarded-for": ip } }));
  const env = { SMTP_URL: "smtp://mail.test", SMTP_FROM: "Cafecito <cafe@mail.test>", CAFECITO_URL: "https://cafe.test/" };

  it("is off, and says so, without SMTP settings", async () => {
    expect(await signIn.GET().json()).toEqual({ enabled: false });
    expect((await ask("a@b.co")).status).toBe(404);
    expect(await get()).toMatchObject({ recovery: false, email: null });
  });

  it("emails a one-time link to a recovery address, and answers the same for unknown ones", async () => {
    Object.assign(process.env, env);
    try {
      expect(await signIn.GET().json()).toEqual({ enabled: true });
      await me.PATCH(req({ email: "you@example.org" }), ctx());
      expect(await get()).toMatchObject({ recovery: true, email: "you@example.org" });

      expect(await (await ask("stranger@example.org")).json()).toEqual({ ok: true });
      expect(sendMail).not.toHaveBeenCalled();
      expect((await ask("not an email")).status).toBe(400);
      expect((await ask("")).status).toBe(400);

      expect(await (await ask("You@Example.org")).json()).toEqual({ ok: true });
      await vi.waitFor(() => expect(sendMail).toHaveBeenCalledOnce());
      const mail = sendMail.mock.calls[0][0];
      expect(mail.to).toBe("you@example.org");
      const token = mail.text.match(/https:\/\/cafe\.test\/sign-in\/(\S+)/)![1];

      jar.clear();
      const spend = (type = "application/json", body: unknown = { token }) =>
        signInLink.POST(
          new Request("http://x/", { method: "POST", body: JSON.stringify(body), headers: { "content-type": type, "x-forwarded-for": "10.1.0.9" } }),
        );
      expect((await spend("application/json", {})).status).toBe(400); // a link with its token cut off
      expect((await spend("application/x-www-form-urlencoded")).status).toBe(415); // no cross-site form sign-in
      expect((await spend()).status).toBe(200);
      expect(await get()).toMatchObject({ meId: "you" });
      expect((await spend()).status).toBe(404);

      // Per address, whatever the caller's IP: no inbox gets flooded.
      expect((await ask("you@example.org", "10.1.0.2")).status).toBe(200);
      expect((await ask("you@example.org", "10.1.0.3")).status).toBe(200);
      expect((await ask("you@example.org", "10.1.0.4")).status).toBe(429);

      // And for the whole server, whatever the address and IP, so strangers' inboxes cannot be flooded.
      const statuses = [];
      for (let i = 0; i < 21; i++) statuses.push((await ask(`s${i}@example.org`, `10.2.0.${i}`)).status);
      expect(statuses).toContain(429);
      expect(statuses.at(-1)).toBe(429);
    } finally {
      for (const k of Object.keys(env)) delete process.env[k];
    }
  });
});
