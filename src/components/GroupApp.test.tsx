// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_PATTERN, QUANTA_PER_DAY, paintPattern, shiftPattern } from "@/lib/availability";
import { retryLoad } from "@/lib/store";
import type { Group, Mark, Member } from "@/lib/types";
import { GroupApp } from "./GroupApp";

// jsdom has no canvas; the park's painting has its own tests.
vi.mock("@/lib/scenery", () => ({ drawLandscape: () => {}, drawTree: () => {} }));

type Range = [weekday: number | "daily", from: number, to: number, mark?: Mark];

/** Typical week from hour ranges; weekday: Monday = 0. */
const pattern = (...ranges: Range[]) =>
  ranges
    .flatMap(([day, ...rest]) => (day === "daily" ? [0, 1, 2, 3, 4, 5, 6] : [day]).map((d) => [d, ...rest] as const))
    .reduce(
      (p, [d, from, to, mark = "f"]) => paintPattern(p, d * QUANTA_PER_DAY + from * 4, (to - from) * 4, mark),
      EMPTY_PATTERN,
    );

const member = (id: string, name: string, timeZone = "UTC", p = EMPTY_PATTERN): Member => ({
  id,
  name,
  color: "#000000",
  timeZone,
  pattern: p,
  overrides: {},
});

// Everyone is free Wednesday 03:00–04:00 UTC; every day 18:00–20:00 UTC three are free and Eli is a maybe.
const ANA = pattern(["daily", 18, 20], [2, 3, 4]);
const crew: Group = {
  id: "demo",
  name: "Café crew",
  slotMinutes: 60,
  meId: "a",
  ownerId: "a",
  members: [
    member("a", "Ana", "UTC", ANA),
    member("b", "Ben", "UTC", ANA),
    member("c", "Chie", "Asia/Tokyo", pattern(["daily", 3, 5], [2, 12, 13])),
    member("d", " "),
    member("e", "Eli", "UTC", pattern(["daily", 18, 20, "m"], [2, 3, 4])),
  ],
};

let writes: { path: string; body: Record<string, unknown> }[] = [];

/** Serves `group` to the store, records its writes, and renders the app once the group has loaded. */
async function open(group: Group = crew) {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (init?.method) {
      const body = init.body ? JSON.parse(init.body as string) : null;
      writes.push({ path: url.replace("/api/groups/me", ""), body });
    }
    return { ok: true, json: async () => group };
  });
  await retryLoad();
  writes = [];
  const { container } = render(<GroupApp />);
  const cell = (col: number, row: number) =>
    container.querySelector<HTMLElement>(`[data-col="${col}"][data-row="${row}"]`)!;
  return {
    cell,
    label: (col: number, row: number) => cell(col, row).getAttribute("aria-label")!,
    rowCount: () => container.querySelectorAll('[data-col="0"]').length,
    /** Day-of-month under each weekday header. */
    days: () => [...container.querySelectorAll(".sticky [data-day]")].map((el) => el.textContent),
    /** Enter on a cell: selects it on the group tab, paints it on the others. */
    enter: (col: number, row: number) => {
      act(() => cell(col, row).focus());
      fireEvent.keyDown(cell(col, row), { key: "Enter" });
    },
  };
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const pressed = (name: string | RegExp) => screen.getByRole("button", { name }).getAttribute("aria-pressed");
const sent = async (count: number) => {
  await vi.waitFor(() => expect(writes).toHaveLength(count));
  return writes;
};

// The grid starts at 07:00 with one-hour rows.
const ROW_7 = 0;
const ROW_18 = 11;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-13T15:00:00Z")); // a Tuesday
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("group tab", () => {
  it("lists the members with their city, local time elsewhere, and who has nothing marked", async () => {
    await open();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Café crew");
    expect(screen.getByText("Times in UTC")).toBeTruthy();
    expect(screen.getByText("Chie", { selector: "span" }).nextSibling!.textContent).toMatch(/^Tokyo · \d/);
    expect(screen.getByText("Ben", { selector: "span" }).nextSibling!.textContent).toBe("UTC");
    expect(screen.getByText("Not counted yet, nothing marked: Unnamed.")).toBeTruthy();
  });

  it("ranks the best times: everyone first, then the largest partial groups with their maybes", async () => {
    await open();
    const best = screen.getByText("Best times in the next two weeks").parentElement!;
    const lines = [...best.querySelectorAll("li > button:first-child")].map((b) => b.lastElementChild!.textContent);
    expect(lines).toEqual(["Everyone", "Everyone", ...Array(3).fill("3 of 4 · Eli maybe")]);
  });

  it("counts who is free in each slot and shows this week with today highlighted", async () => {
    const { label, days, rowCount } = await open();
    expect(days()).toEqual(["12", "13", "14", "15", "16", "17", "18"]);
    expect(screen.getByText("13").closest("[aria-current=date]")).toBeTruthy();
    expect(screen.getByText("14").closest("[aria-current=date]")).toBeNull();
    expect(rowCount()).toBe(17);
    expect(label(0, ROW_18)).toMatch(/: 3 of 4 free, 1 maybe$/);
    expect(label(0, ROW_7)).toMatch(/: 0 of 4 free$/);
    expect(screen.getByText("4 free")).toBeTruthy();
  });

  it("shows who is free, maybe or unavailable in the selected slot, with other zones' local time", async () => {
    const { enter } = await open();
    expect(screen.queryByText(/^Free · /)).toBeNull();
    enter(0, ROW_18);
    expect(screen.getByText("Free · 3")).toBeTruthy();
    expect(screen.getByText("Maybe · 1").nextSibling!.textContent).toBe("Eli");
    expect(screen.queryByText(/^Not available/)).toBeNull();
    expect(screen.getByText(/in Tokyo$/)).toBeTruthy();
    enter(0, ROW_7);
    expect(screen.getByText("Not available · 4")).toBeTruthy();
    expect(screen.queryByText(/^Free · /)).toBeNull();
  });

  it("jumps to a best time: opens the early hours and its week, and selects it", async () => {
    const { cell, days, rowCount } = await open();
    const [first, second] = screen.getAllByRole("button", { name: /Everyone/ });
    fireEvent.click(first);
    expect(rowCount()).toBe(24);
    expect((screen.getByLabelText("Show all 24 hours") as HTMLInputElement).checked).toBe(true);
    expect(cell(2, 3).className).toContain("outline-2"); // Wednesday 03:00
    expect(screen.getByText("Free · 4")).toBeTruthy();

    fireEvent.click(second);
    expect(days()).toEqual(["19", "20", "21", "22", "23", "24", "25"]);
    expect(cell(2, 3).className).toContain("outline-2");
  });

  it("moves between weeks and back to today", async () => {
    const { days } = await open();
    click("Next week");
    click("Next week");
    expect(days()[0]).toBe("26");
    click("Today");
    expect(days()[0]).toBe("12");
    click("Previous week");
    expect(days()[0]).toBe("5");
    // No day of the previous week is today.
    expect(document.querySelector(".sticky [aria-current=date]")).toBeNull();
  });

  it("rolls over to the new week when a tab left open becomes visible again", async () => {
    const { days } = await open();
    vi.setSystemTime(new Date("2026-10-20T15:00:00Z"));
    fireEvent(document, new Event("visibilitychange"));
    expect(days()[0]).toBe("19");
    expect(screen.getByText("20").closest("[aria-current=date]")).toBeTruthy();
  });

  it.each([
    ["one person", [member("a", "Ana", "UTC", ANA), member("b", "Ben")], "Needs at least two people with a week filled in."],
    ["two people who never overlap", [member("a", "Ana", "UTC", ANA), member("b", "Ben", "UTC", pattern([0, 8, 9]))], /when everyone is free/],
    [
      "four people who never overlap",
      [0, 1, 2, 3].map((d) => member(`m${d}`, `M${d}`, "UTC", pattern([d, 8, 9]))),
      /when nearly everyone is free/,
    ],
  ])("explains why there is no best time with %s", async (_case, members, message) => {
    // The signed-in member is not in the last group: the first member stands in.
    await open({ ...crew, members });
    expect(screen.getByText(message)).toBeTruthy();
  });

  it("shows no scale and counts nobody while no one has marked anything", async () => {
    const { label } = await open({ ...crew, members: [member("a", "Ana"), member("b", "Ben")] });
    expect(screen.queryByText("Tap a slot to see who")).toBeNull();
    expect(label(0, ROW_18)).toMatch(/: 0 of 0 free$/);
  });
});

describe("the park", () => {
  /** Gives the header a size and a colour scheme, so the park behind it draws. */
  function sky(dark: boolean) {
    let resize = () => {};
    vi.stubGlobal("ResizeObserver", class {
      constructor(cb: (e: { contentRect: { width: number; height: number } }[]) => void) {
        resize = () => act(() => cb([{ contentRect: { width: 1440, height: 640 } }]));
      }
      observe() {}
      disconnect() {}
    });
    vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: dark && q.includes("dark"), addEventListener() {}, removeEventListener() {} }));
    return () => resize();
  }
  const backs = () => [...document.querySelectorAll(".scn-pol")].map((p) => [p.querySelector(".scn-photo")!.textContent, p.querySelector(".scn-back")!.textContent]);

  it("shows on each photo where that person stands at the next time; nobody unmarked is called busy", async () => {
    const draw = sky(false);
    // Eli is only a maybe, so the best time is an evening: three free, Eli maybe, the unnamed member not counted.
    await open({ ...crew, members: crew.members.map((m) => (m.id === "e" ? { ...m, pattern: pattern(["daily", 18, 20, "m"]) } : m)) });
    draw();
    expect(backs()).toEqual([["A", "Free✓"], ["B", "Free✓"], ["C", "Free✓"], ["U", "Not set?"], ["E", "Maybe~"]]);
  });

  it("the owls start happy when everyone counted is free, even with someone still unmarked", async () => {
    const draw = sky(true);
    await open({ ...crew, members: crew.members.map((m) => (m.id === "e" ? { ...m, pattern: ANA } : m)) });
    draw();
    expect([...document.querySelectorAll(".scn-owl svg")].map((o) => o.getAttribute("data-mood"))).toEqual(["happy", "happy"]);
  });
});

describe("my week tab", () => {
  it("paints free, maybe and busy over one slot and resets it to the typical week", async () => {
    const { enter, label } = await open();
    click("My week");
    expect(pressed("My week")).toBe("true");
    expect(pressed("Free")).toBe("true");
    expect(label(0, ROW_7)).toMatch(/: not marked$/);
    expect(label(0, ROW_18)).toMatch(/: free$/);

    const q = Date.parse("2026-10-12T07:00:00Z") / 900_000;
    const slot = (mark: string) => Object.fromEntries([0, 1, 2, 3].map((i) => [q + i, mark]));

    enter(0, ROW_7);
    expect(label(0, ROW_7)).toMatch(/: free$/);
    click("Maybe");
    enter(0, ROW_7);
    expect(label(0, ROW_7)).toMatch(/: maybe$/);
    click("Busy");
    expect(pressed("Busy")).toBe("true");
    enter(0, ROW_7);
    expect(label(0, ROW_7)).toMatch(/: busy$/);
    click("Reset to typical");
    enter(0, ROW_7);
    expect(label(0, ROW_7)).toMatch(/: not marked$/);

    expect(await sent(4)).toEqual([
      { path: "/me/overrides", body: { set: slot("f"), remove: [] } },
      { path: "/me/overrides", body: { set: slot("m"), remove: [] } },
      { path: "/me/overrides", body: { set: slot("b"), remove: [] } },
      { path: "/me/overrides", body: { set: {}, remove: [q, q + 1, q + 2, q + 3] } },
    ]);
  });

  it("shows a slot as busy when only part of it is busy", async () => {
    // Free 18:00-20:00 by pattern, busy 18:30-19:00 (e.g. painted at 30-minute slots); the group shows hours.
    const q = Date.parse("2026-10-12T18:30:00Z") / 900_000;
    const ana = { ...crew.members[0], overrides: { [q]: "b" as const, [q + 1]: "b" as const } };
    const { label, cell } = await open({ ...crew, members: [ana, ...crew.members.slice(1)] });
    click("My week");
    expect(label(0, ROW_18)).toMatch(/: busy$/);
    expect(cell(0, ROW_18).getAttribute("style")).toContain("--busy");
  });

  it("can leave touches to scrolling", async () => {
    const { cell } = await open();
    click("My week");
    expect(cell(0, 0).className).toContain("touch-none");
    click("Scroll with touch");
    expect(pressed("Scroll with touch")).toBe("true");
    expect(cell(0, 0).className).not.toContain("touch-none");
  });
});

describe("typical week tab", () => {
  it("paints the weekly pattern, treating a busy brush carried over from My week as Clear", async () => {
    const { enter, label } = await open();
    click("My week");
    click("Busy");
    click("Typical week");
    expect(screen.getByText("Repeats every week, in your local time (UTC).")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Busy" })).toBeNull();
    expect(pressed("Clear")).toBe("true");
    expect(label(0, ROW_18)).toMatch(/^Mon .*: free$/);

    enter(0, ROW_18);
    expect(label(0, ROW_18)).toMatch(/: not marked$/);
    click("Maybe");
    enter(1, ROW_7);
    expect(label(1, ROW_7)).toMatch(/^Tue .*: maybe$/);

    const cleared = paintPattern(ANA, 18 * 4, 4, null);
    expect(await sent(2)).toEqual([
      { path: "/me", body: { pattern: cleared } },
      { path: "/me", body: { pattern: paintPattern(cleared, QUANTA_PER_DAY + 7 * 4, 4, "m") } },
    ]);
  });
});

describe("settings", () => {
  it("renames the member", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Anna" } });
    expect(screen.getByText("Anna", { selector: "span" })).toBeTruthy();
    expect(await sent(1)).toEqual([{ path: "/me", body: { name: "Anna" } }]);
  });

  it("changes the member's color", async () => {
    await open();
    expect(screen.getByRole("button", { name: "Teal", pressed: false })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Teal" }));
    expect(screen.getByRole("button", { name: "Teal" }).getAttribute("aria-pressed")).toBe("true");
    expect(await sent(1)).toEqual([{ path: "/me", body: { color: "#0f766e" } }]);
  });

  it("changes time zone keeping wall-clock times by default, or the same moments when asked", async () => {
    await open();
    const zone = screen.getByLabelText("Your time zone") as HTMLSelectElement;
    // A zone the browser does not list is still shown as the current choice.
    expect(zone.value).toBe("UTC");
    fireEvent.change(zone, { target: { value: "Asia/Tokyo" } });
    expect(screen.getByText("Times in Tokyo")).toBeTruthy();

    fireEvent.click(screen.getByLabelText(/^Keep the same moments/));
    fireEvent.change(zone, { target: { value: "Australia/Darwin" } });

    expect(await sent(2)).toEqual([
      { path: "/me", body: { timeZone: "Asia/Tokyo" } },
      // Darwin is half an hour ahead of Tokyo, so the week moves two quarter-hours later.
      { path: "/me", body: { timeZone: "Australia/Darwin", pattern: shiftPattern(ANA, 2) } },
    ]);
  });

  it("lets the owner change the slot size and anyone show all 24 hours", async () => {
    const { rowCount } = await open();
    expect(pressed("1 h")).toBe("true");
    click("30 min");
    expect(pressed("30 min")).toBe("true");
    expect(rowCount()).toBe(34);
    fireEvent.click(screen.getByLabelText("Show all 24 hours"));
    expect(rowCount()).toBe(48);
    expect(await sent(1)).toEqual([{ path: "", body: { slotMinutes: 30 } }]);
  });

  it("shows a member who is not the owner their own name and no slot-size control", async () => {
    await open({ ...crew, meId: "b" });
    expect((screen.getByRole("button", { name: "15 min" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Your name") as HTMLInputElement).value).toBe("Ben");
    expect(screen.queryByText(/Create invite link/)).toBeNull();
  });

  it("lets the owner make an invite link, shown once", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Create invite link" }));
    expect(await sent(1)).toEqual([{ path: "/invites", body: { days: 7, maxUses: null } }]);
  });
});

describe("outings", () => {
  const outing = { id: "o1", title: "Brunch", place: "Café X", placeId: null, startQ: Date.now() / 900_000 + 100, endQ: Date.now() / 900_000 + 104, createdBy: "b", rsvps: { b: "y" as const } };

  it("proposes a best time with a title and place", async () => {
    await open();
    fireEvent.click(screen.getAllByRole("button", { name: /^Propose / })[0]);
    fireEvent.change(screen.getByLabelText("What"), { target: { value: "Coffee" } });
    fireEvent.change(screen.getByLabelText("Where (optional)"), { target: { value: "Café Y" } });
    fireEvent.click(screen.getByRole("button", { name: "Propose" }));
    const [w] = await sent(1);
    expect(w).toMatchObject({ path: "/outings", body: { title: "Coffee", place: "Café Y" } });
    await vi.waitFor(() => expect(screen.queryByLabelText("What")).toBeNull());
  });

  it("sends a proposal once however often Propose is pressed", async () => {
    await open();
    fireEvent.click(screen.getAllByRole("button", { name: /^Propose / })[0]);
    fireEvent.change(screen.getByLabelText("What"), { target: { value: "Coffee" } });
    const form = screen.getByLabelText("What").closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(await sent(1)).toHaveLength(1);
    await vi.waitFor(() => expect(screen.queryByLabelText("What")).toBeNull());
    expect(writes).toHaveLength(1);
  });

  it("keeps the form open and shows the server's reason when a proposal is refused", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await open();
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? { ok: false, status: 409, json: async () => ({ error: "That time is no longer free for the group" }) }
        : { ok: true, json: async () => crew },
    );
    fireEvent.click(screen.getAllByRole("button", { name: /^Propose / })[0]);
    fireEvent.change(screen.getByLabelText("What"), { target: { value: "Coffee" } });
    fireEvent.click(screen.getByRole("button", { name: "Propose" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That time is no longer free for the group");
    expect((screen.getByLabelText("What") as HTMLInputElement).value).toBe("Coffee");
  });

  it("does not accept a title of only spaces", async () => {
    await open();
    fireEvent.click(screen.getAllByRole("button", { name: /^Propose / })[0]);
    fireEvent.change(screen.getByLabelText("What"), { target: { value: "  " } });
    expect((screen.getByLabelText("What") as HTMLInputElement).validity.valid).toBe(false);
  });

  const cafe = { id: "p9", name: "Café Y", link: "https://y.example", mapLink: "", notes: "", suggestedBy: "b", beenThere: false, createdAt: 0, archivedAt: null, votes: [], ratings: {}, comments: [] };

  it("offers the wishlist (not what is archived) when proposing: picking a place fills Where and sends its id", async () => {
    await open({ ...crew, places: [cafe, { ...cafe, id: "p8", name: "Old Haunt", beenThere: true }, { ...cafe, id: "p7", name: "Shelved", archivedAt: 1 }] });
    fireEvent.click(screen.getAllByRole("button", { name: /^Propose / })[0]);
    expect(screen.getByRole("option", { name: "Old Haunt (been there)" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Shelved" })).toBeNull(); // archived places aren't offered
    fireEvent.change(screen.getByLabelText("From the wishlist (optional)"), { target: { value: "p9" } });
    expect((screen.getByLabelText("Where (optional)") as HTMLInputElement).value).toBe("Café Y");
    fireEvent.change(screen.getByLabelText("What"), { target: { value: "Coffee" } });
    fireEvent.click(screen.getByRole("button", { name: "Propose" }));
    expect(await sent(1)).toMatchObject([{ path: "/outings", body: { title: "Coffee", place: "Café Y", placeId: "p9" } }]);
  });

  it("does not show the wishlist picker when the wishlist is empty, and sends no placeId without a pick", async () => {
    await open();
    fireEvent.click(screen.getAllByRole("button", { name: /^Propose / })[0]);
    expect(screen.queryByLabelText("From the wishlist (optional)")).toBeNull();
    fireEvent.change(screen.getByLabelText("What"), { target: { value: "Coffee" } });
    fireEvent.click(screen.getByRole("button", { name: "Propose" }));
    const [w] = await sent(1);
    expect(w.body).not.toHaveProperty("placeId");
  });

  it("links a plan to its wishlist place while it exists, and shows plain text once it is gone", async () => {
    const group = { ...crew, places: [cafe], outings: [{ ...outing, place: "Café Y", placeId: "p9" }] };
    await open(group);
    const plans = within(screen.getByRole("heading", { name: "Plans" }).closest("section")!);
    expect(plans.getByRole("link", { name: "Café Y" }).getAttribute("href")).toBe("https://y.example");
    cleanup();
    await open({ ...group, places: [], outings: [{ ...outing, place: "Café Y", placeId: null }] });
    expect(screen.queryByRole("link", { name: "Café Y" })).toBeNull();
    expect(screen.getByText(/Café Y/).textContent).toBe(" · Café Y");
  });

  it("lists plans with who answered, sends my answer, and hides delete from people who did not propose it", async () => {
    await open({ ...crew, meId: "c", outings: [outing] });
    expect(screen.getByText("Brunch")).toBeTruthy();
    expect(screen.getByText("Yes: Ben")).toBeTruthy();
    expect(screen.queryByText("Delete")).toBeNull();
    fireEvent.click(screen.getByLabelText("Mark busy in my week when I say yes"));
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(await sent(1)).toEqual([{ path: "/outings/o1/rsvp", body: { answer: "y", markBusy: true } }]);
  });

  it("marks busy right away when ticked after already saying yes", async () => {
    await open({ ...crew, outings: [outing] });
    fireEvent.click(screen.getByLabelText("Mark busy in my week when I say yes"));
    expect(await sent(0)).toEqual([]);
    cleanup();
    await open({ ...crew, meId: "b", outings: [outing] });
    fireEvent.click(screen.getByLabelText("Mark busy in my week when I say yes"));
    expect(await sent(1)).toEqual([{ path: "/outings/o1/rsvp", body: { answer: "y", markBusy: true } }]);
  });

  it("lets the owner delete a plan", async () => {
    vi.stubGlobal("confirm", () => true);
    await open({ ...crew, outings: [outing] });
    fireEvent.click(screen.getByText("Delete"));
    expect(await sent(1)).toEqual([{ path: "/outings/o1", body: null }]);
  });
});

describe("wishlist", () => {
  const NOW = Date.parse("2026-10-13T15:00:00Z");
  const DAY = 864e5;
  const place = { id: "p1", name: "Café X", link: "https://x.example", mapLink: "https://maps.example/x", notes: "Great pastries", suggestedBy: "b", beenThere: false, createdAt: NOW - 21 * DAY, archivedAt: null, votes: ["c"], ratings: {}, comments: [] };
  const visited = { ...place, id: "p2", name: "Old Haunt", link: "", mapLink: "", notes: "", suggestedBy: null, beenThere: true, votes: ["a", "b", "c"] };
  const wanted = { ...place, id: "p3", name: "Wanted", link: "", mapLink: "", notes: "", votes: ["a", "b"] };
  const shelved = { ...place, id: "p4", name: "Shelved", link: "", mapLink: "", notes: "", archivedAt: NOW - 2 * DAY };
  /** `n` places to try, the newest first, none wanted yet. */
  const many = (n: number, extra: object = {}) =>
    Array.from({ length: n }, (_, i) => ({ ...place, id: `m${i}`, name: `Place ${i + 1}`, link: "", mapLink: "", notes: "", votes: [], createdAt: NOW - i * DAY, ...extra }));

  // jsdom has no modal dialogs; the browser's showModal opens one on top of the page, and close puts focus back.
  let closed = 0;
  beforeEach(() => {
    closed = 0;
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      // Only a dialog still on the page can hand focus back when it closes.
      if (this.isConnected) closed++;
      this.removeAttribute("open");
    };
  });
  /** Serves `group` from now on (a live update), and loads it. */
  const update = async (group: Group) => {
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (init?.method) writes.push({ path: url.replace("/api/groups/me", ""), body: init.body ? JSON.parse(init.body as string) : null });
      return { ok: true, json: async () => group };
    });
    await act(() => retryLoad());
  };

  const section = () => within(screen.getByRole("heading", { name: "Wishlist" }).closest("section")!);
  /** The names in the list, top to bottom. */
  const titles = () => section().queryAllByRole("button", { name: /^Open / }).map((b) => b.getAttribute("aria-label")!.slice(5));
  const row = (name: string) => screen.getByRole("button", { name: `Open ${name}` }).closest("li")!;
  const list = (name: RegExp) => fireEvent.click(screen.getByRole("button", { name }));
  const sheet = (title: string) => within(screen.getByRole("dialog", { name: title }));
  const openPlace = (name: string) => fireEvent.click(screen.getByRole("button", { name: `Open ${name}` }));
  const menu = (place: string, item: string) => {
    fireEvent.click(screen.getByRole("button", { name: `Options for ${place}` }));
    fireEvent.click(screen.getByRole("menuitem", { name: item }));
  };

  it("sorts places into To try, Been there and Archived as short rows, the most wanted first", async () => {
    await open({ ...crew, places: [visited, place, { ...wanted, comments: [{ id: "k", memberId: "a", body: "Yes", createdAt: NOW }] }, shelved] });
    expect(screen.getByRole("button", { name: "To try · 2" }).getAttribute("aria-pressed")).toBe("true");
    expect(titles()).toEqual(["Wanted", "Café X"]);
    expect(row("Wanted").textContent).toBe("WantedBen · 3 weeks ago · 1 comment♥2›");
    expect(row("Café X").textContent).toBe("Café XBen · 3 weeks ago♥1›");
    list(/^Been there · 1/);
    expect(titles()).toEqual(["Old Haunt"]);
    expect(row("Old Haunt").textContent).toContain("Someone who left · 3 weeks ago");
    list(/^Archived · 1/);
    expect(titles()).toEqual(["Shelved"]);
    expect(row("Shelved").textContent).toContain("Ben · archived 2 days ago");
  });

  it("shows the group's stars on the rows of places it has been to, the best rated first", async () => {
    await open({ ...crew, places: [{ ...visited, ratings: { a: 3 } }, { ...visited, id: "p5", name: "Favourite", ratings: { a: 5, b: 4 } }, { ...visited, id: "p6", name: "Unrated" }] });
    list(/^Been there · 3/);
    expect(titles()).toEqual(["Favourite", "Old Haunt", "Unrated"]);
    expect(row("Favourite").textContent).toContain("4.5 from 2 ratings4.5");
    expect(row("Unrated").textContent).toContain("No ratings yet");
    // The sun-coloured part of each little star.
    const fills = [...row("Favourite").querySelectorAll("svg")].map((svg) => Number(svg.querySelector("rect")?.getAttribute("width") ?? 0) / 24);
    expect(fills).toEqual([1, 1, 1, 1, 0.5]);
  });

  it("says what each empty list is for, and what to do when there are no places at all", async () => {
    await open({ ...crew, places: [visited] });
    expect(screen.getByText(/^Nothing left to try/)).toBeTruthy();
    list(/^Archived · 0/);
    expect(screen.getByText(/^Old suggestions you archive wait here/)).toBeTruthy();
    cleanup();
    await open({ ...crew, places: [wanted] });
    list(/^Been there · 0/);
    expect(screen.getByText(/^Places the group has been to show up here/)).toBeTruthy();
    cleanup();
    await open();
    expect(screen.getByText("No places yet. Add a café or restaurant the group wants to try.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^To try/ })).toBeNull();
  });

  it("pages through long lists eight at a time, and starts over on another list", async () => {
    await open({ ...crew, places: [...many(19), visited] });
    expect(titles()).toEqual(["Place 1", "Place 2", "Place 3", "Place 4", "Place 5", "Place 6", "Place 7", "Place 8"]);
    expect(screen.getByText("Page 1 of 3")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Previous page" }) as HTMLButtonElement).disabled).toBe(true);
    click("Next page");
    click("Next page");
    expect(titles()).toEqual(["Place 17", "Place 18", "Place 19"]);
    expect((screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement).disabled).toBe(true);
    click("Previous page");
    expect(screen.getByText("Page 2 of 3")).toBeTruthy();
    list(/^Been there · /);
    expect(screen.queryByRole("navigation", { name: "Wishlist pages" })).toBeNull(); // one page: no pager
    list(/^To try · /);
    expect(titles()[0]).toBe("Place 1");
  });

  it("searches names and notes, accents or not, once the wishlist is long", async () => {
    await open({ ...crew, places: many(8) });
    expect(screen.queryByLabelText("Search the wishlist")).toBeNull();
    cleanup();
    await open({ ...crew, places: [...many(10), { ...wanted, name: "Café Lumen" }, { ...wanted, id: "p7", name: "Torta Boyz", notes: "Best CAFE con leche" }] });
    const search = (text: string) => fireEvent.change(screen.getByLabelText("Search the wishlist"), { target: { value: text } });
    click("Next page");
    search("  cafe ");
    expect(titles()).toEqual(["Café Lumen", "Torta Boyz"]); // back to the first page of results
    search("place 1");
    expect(titles()).toEqual(["Place 1", "Place 10"]);
    search("place");
    expect(titles()).toHaveLength(8);
    expect(screen.getByText("Page 1 of 2")).toBeTruthy();
    search("");
    expect(titles()).toHaveLength(8);
  });

  it("says when a search finds nothing in this list, and offers the lists where it did", async () => {
    await open({ ...crew, places: [...many(9), visited, { ...visited, id: "p8", name: "Old Haunt 2", archivedAt: NOW }] });
    fireEvent.change(screen.getByLabelText("Search the wishlist"), { target: { value: "haunt" } });
    expect(screen.getByText("Nothing in To try matches “haunt”.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "1 in Archived" })).toBeTruthy();
    click("1 in Been there");
    expect(titles()).toEqual(["Old Haunt"]);
    fireEvent.change(screen.getByLabelText("Search the wishlist"), { target: { value: "zzz" } });
    expect(screen.getByText("Nothing in Been there matches “zzz”.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^\d+ in / })).toBeNull();
  });

  it("adds a place in a pop-up, then turns to its page and marks it, even from a search on another list", async () => {
    const before = { ...crew, places: [...many(9, { votes: ["a"] }), visited] };
    await open(before);
    list(/^Been there · /);
    fireEvent.change(screen.getByLabelText("Search the wishlist"), { target: { value: "haunt" } });
    // The server answers the add, then sends the list with the new place in it (nobody wants to go yet, so it's last).
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (init?.method) writes.push({ path: url.replace("/api/groups/me", ""), body: JSON.parse(init.body as string) });
      if (init?.method === "POST") return { ok: true, json: async () => ({ id: "new" }) };
      return { ok: true, json: async () => (writes.length ? { ...before, places: [...before.places, { ...wanted, id: "new", name: "Café New", votes: [], createdAt: NOW }] } : before) };
    });
    fireEvent.click(screen.getByRole("button", { name: "+ Add a place" }));
    const form = sheet("Add a place");
    fireEvent.change(form.getByLabelText("Name"), { target: { value: " Café New " } });
    fireEvent.change(form.getByLabelText("Website (optional)"), { target: { value: "https://new.example" } });
    fireEvent.change(form.getByLabelText("Notes (optional)"), { target: { value: "Quiet" } });
    fireEvent.click(form.getByRole("button", { name: "Add" }));
    expect((await sent(1))[0]).toEqual({ path: "/places", body: { name: "Café New", link: "https://new.example", mapLink: "", notes: "Quiet" } });
    await vi.waitFor(() => expect(titles()).toEqual(["Place 9", "Café New"]));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Page 2 of 2")).toBeTruthy();
    expect(row("Café New").className).toContain("bg-butter");
    expect((screen.getByLabelText("Search the wishlist") as HTMLInputElement).value).toBe("");
    click("Previous page"); // turning the page lets go of it
    expect(titles()).toHaveLength(8);
  });

  it("finds a just-added place by its id, not its name, when another place has the same name", async () => {
    const before = { ...crew, places: [...many(8, { votes: ["a"] }), { ...wanted, id: "old", name: "Café New", votes: ["a", "b"] }] };
    await open(before);
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (init?.method) writes.push({ path: url.replace("/api/groups/me", ""), body: JSON.parse(init.body as string) });
      if (init?.method === "POST") return { ok: true, json: async () => ({ id: "new" }) };
      return { ok: true, json: async () => (writes.length ? { ...before, places: [...before.places, { ...wanted, id: "new", name: "Café New", votes: [], createdAt: NOW }] } : before) };
    });
    fireEvent.click(screen.getByRole("button", { name: "+ Add a place" }));
    fireEvent.change(sheet("Add a place").getByLabelText("Name"), { target: { value: "Café New" } });
    fireEvent.click(sheet("Add a place").getByRole("button", { name: "Add" }));
    await vi.waitFor(() => expect(screen.getByText("Page 2 of 2")).toBeTruthy()); // the new one sorts last, onto page 2
    const rows = section().getAllByRole("listitem");
    expect(rows.map((r) => r.className.includes("bg-butter"))).toEqual([false, true]);
  });

  it("closes a pop-up with Cancel, ✕, Escape or a tap outside it, and starts over empty", async () => {
    await open();
    const add = () => fireEvent.click(screen.getByRole("button", { name: "+ Add a place" }));
    add();
    fireEvent.change(sheet("Add a place").getByLabelText("Name"), { target: { value: "Café Y" } });
    fireEvent.click(sheet("Add a place").getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    add();
    expect((sheet("Add a place").getByLabelText("Name") as HTMLInputElement).value).toBe("");
    fireEvent.click(sheet("Add a place").getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(closed).toBe(2); // closed, not just taken off the page, so focus goes back to the button that opened it
    add();
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
    add();
    fireEvent.click(sheet("Add a place").getByLabelText("Name")); // inside: stays open
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(writes).toEqual([]);
  });

  it("sends once however often Add is pressed, and shows why a place was refused", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await open();
    fireEvent.click(screen.getByRole("button", { name: "+ Add a place" }));
    fireEvent.change(sheet("Add a place").getByLabelText("Name"), { target: { value: "Café Y" } });
    const form = sheet("Add a place").getByLabelText("Name").closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(await sent(1)).toHaveLength(1);
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? { ok: false, status: 400, json: async () => ({ error: "Links must start with http:// or https://" }) }
        : { ok: true, json: async () => crew },
    );
    fireEvent.click(screen.getByRole("button", { name: "+ Add a place" }));
    fireEvent.change(sheet("Add a place").getByLabelText("Name"), { target: { value: "Café Z" } });
    fireEvent.submit(sheet("Add a place").getByLabelText("Name").closest("form")!);
    expect((await sheet("Add a place").findByRole("alert")).textContent).toBe("Links must start with http:// or https://");
    expect((sheet("Add a place").getByLabelText("Name") as HTMLInputElement).value).toBe("Café Z");
  });

  it("opens a place from its row with its links, notes and who suggested it when", async () => {
    await open({ ...crew, places: [place] });
    openPlace("Café X");
    const details = sheet("Café X");
    expect(details.getByText("Suggested by Ben · 3 weeks ago")).toBeTruthy();
    expect(details.getByText("Great pastries")).toBeTruthy();
    const website = details.getByRole("link", { name: "Website" });
    expect(website.getAttribute("href")).toBe("https://x.example");
    expect(website.getAttribute("rel")).toBe("noopener noreferrer");
    expect(details.getByRole("link", { name: "Map" }).getAttribute("href")).toBe("https://maps.example/x");
    expect(details.queryByRole("radiogroup")).toBeNull(); // nobody has been: no stars yet
  });

  it("votes from the row or the pop-up, and marks a place as visited and back", async () => {
    await open({ ...crew, places: [{ ...place, votes: ["a"] }, { ...wanted, votes: [] }, visited] });
    fireEvent.click(screen.getByRole("button", { name: "I want to go to Wanted · 0" }));
    expect(screen.queryByRole("dialog")).toBeNull(); // the vote doesn't open the place
    openPlace("Café X");
    fireEvent.click(sheet("Café X").getByRole("button", { name: "I want to go · 1" }));
    fireEvent.click(sheet("Café X").getByRole("button", { name: "Been there" }));
    fireEvent.click(sheet("Café X").getByRole("button", { name: "Close" }));
    list(/^Been there · 1/);
    openPlace("Old Haunt");
    fireEvent.click(sheet("Old Haunt").getByRole("button", { name: "Been there", pressed: true }));
    expect(await sent(4)).toEqual([
      { path: "/places/p3/vote", body: null },
      { path: "/places/p1/vote", body: null },
      { path: "/places/p1", body: { beenThere: true } },
      { path: "/places/p2", body: { beenThere: false } },
    ]);
  });

  it("shows on its row why a vote was refused", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const group = { ...crew, places: [wanted] };
    await open(group);
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) =>
      init?.method ? { ok: false, status: 404, json: async () => ({ error: "No such place" }) } : { ok: true, json: async () => group },
    );
    fireEvent.click(screen.getByRole("button", { name: "I want to go to Wanted · 2" }));
    expect((await within(row("Wanted")).findByRole("alert")).textContent).toBe("No such place");
  });

  it("offers the ⋯ menu only to whoever suggested a place, or the owner; Remove asks first and closes the pop-up", async () => {
    await open({ ...crew, meId: "c", places: [place, { ...wanted, suggestedBy: "c" }] });
    openPlace("Café X");
    expect(screen.queryByRole("button", { name: "Options for Café X" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    openPlace("Wanted");
    expect(screen.getByRole("button", { name: "Options for Wanted" })).toBeTruthy(); // the one Chie suggested
    cleanup();
    let asked = "";
    vi.stubGlobal("confirm", (q: string) => ((asked = q), true));
    await open({ ...crew, places: [place] }); // Ana owns the group
    openPlace("Café X");
    // Once removed, the server's list no longer has it.
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (init?.method) writes.push({ path: url.replace("/api/groups/me", ""), body: init.body ? JSON.parse(init.body as string) : null });
      return { ok: true, json: async () => ({ ...crew, places: [] }) };
    });
    menu("Café X", "Remove");
    expect(asked).toBe("Remove “Café X” for good? Its ratings and comments go too.");
    expect(await sent(1)).toEqual([{ path: "/places/p1", body: null }]);
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("closes the ⋯ menu with Escape or a tap elsewhere", async () => {
    await open({ ...crew, places: [place] });
    openPlace("Café X");
    const button = screen.getByRole("button", { name: "Options for Café X" });
    fireEvent.click(button);
    expect(document.activeElement?.textContent).toBe("Edit");
    fireEvent.pointerDown(screen.getByRole("menuitem", { name: "Archive" })); // inside: stays open
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByRole("menu")).toBeTruthy();
    // The menu's Escape is used up there, so the browser doesn't also close the pop-up around it.
    expect(fireEvent.keyDown(document, { key: "Escape" })).toBe(false);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Café X" })).toBeTruthy();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(writes).toEqual([]);
  });

  it("archives a place and brings it back", async () => {
    await open({ ...crew, places: [place, shelved] });
    openPlace("Café X");
    menu("Café X", "Archive");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    list(/^Archived · 1/);
    openPlace("Shelved");
    expect(sheet("Shelved").getByText("Suggested by Ben · 3 weeks ago · archived 2 days ago")).toBeTruthy();
    menu("Shelved", "Bring back");
    expect(await sent(2)).toEqual([
      { path: "/places/p1", body: { archived: true } },
      { path: "/places/p4", body: { archived: false } },
    ]);
  });

  it("edits a place in the pop-up: only the fields that changed are sent, nothing when none did", async () => {
    await open({ ...crew, meId: "b", places: [place] });
    openPlace("Café X");
    menu("Café X", "Edit");
    expect((sheet("Edit Café X").getByLabelText("Name") as HTMLInputElement).value).toBe("Café X");
    expect((sheet("Edit Café X").getByLabelText("Notes (optional)") as HTMLTextAreaElement).value).toBe("Great pastries");
    fireEvent.click(sheet("Edit Café X").getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(screen.getByRole("dialog", { name: "Café X" })).toBeTruthy()); // back to the place
    expect(writes).toEqual([]);

    menu("Café X", "Edit");
    fireEvent.change(sheet("Edit Café X").getByLabelText("Name"), { target: { value: " Café Z " } });
    fireEvent.change(sheet("Edit Café X").getByLabelText("Website (optional)"), { target: { value: "" } });
    fireEvent.click(sheet("Edit Café X").getByRole("button", { name: "Save" }));
    expect(await sent(1)).toEqual([{ path: "/places/p1", body: { name: "Café Z", link: "" } }]);
    await vi.waitFor(() => expect(screen.getByRole("dialog", { name: "Café X" })).toBeTruthy());
  });

  it("doesn't jump back to a place whose save finishes after I've opened another, and keeps drafts with their place", async () => {
    await open({ ...crew, places: [place, wanted] }); // Ana owns the group
    let finish = () => {};
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        writes.push({ path: url.replace("/api/groups/me", ""), body: JSON.parse(init.body as string) });
        await new Promise<void>((done) => (finish = done)); // a slow connection
      }
      return { ok: true, json: async () => ({ ...crew, places: [place, wanted] }) };
    });
    openPlace("Café X");
    menu("Café X", "Edit");
    fireEvent.change(sheet("Edit Café X").getByLabelText("Notes (optional)"), { target: { value: "Closed Mondays" } });
    fireEvent.click(sheet("Edit Café X").getByRole("button", { name: "Save" }));
    await sent(1);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    openPlace("Wanted");
    fireEvent.change(sheet("Wanted").getByLabelText("Your comment"), { target: { value: "Draft for Wanted" } });
    await act(async () => finish());
    expect(screen.getByRole("dialog", { name: "Wanted" })).toBeTruthy();
    expect((sheet("Wanted").getByLabelText("Your comment") as HTMLTextAreaElement).value).toBe("Draft for Wanted");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    openPlace("Café X");
    expect((sheet("Café X").getByLabelText("Your comment") as HTMLTextAreaElement).value).toBe("");
  });

  it("only sends back the fields I changed, even when someone else changed others while I was editing", async () => {
    await open({ ...crew, places: [place] });
    openPlace("Café X");
    menu("Café X", "Edit");
    await update({ ...crew, places: [{ ...place, name: "Café X (new spot)" }] }); // renamed meanwhile
    fireEvent.change(sheet("Edit Café X (new spot)").getByLabelText("Notes (optional)"), { target: { value: "Bigger now" } });
    fireEvent.click(sheet("Edit Café X (new spot)").getByRole("button", { name: "Save" }));
    expect(await sent(1)).toEqual([{ path: "/places/p1", body: { notes: "Bigger now" } }]);
  });

  it("cancels an edit, and keeps it open with the reason when refused", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const mine = { ...crew, meId: "c", places: [{ ...wanted, suggestedBy: "c" }] };
    await open(mine);
    openPlace("Wanted");
    menu("Wanted", "Edit");
    fireEvent.click(sheet("Edit Wanted").getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("dialog", { name: "Wanted" })).toBeTruthy();
    expect(writes).toEqual([]);

    menu("Wanted", "Edit");
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) =>
      init?.method === "PATCH"
        ? { ok: false, status: 400, json: async () => ({ error: "Links must start with http:// or https://" }) }
        : { ok: true, json: async () => mine }, // a refused write reloads the group
    );
    fireEvent.change(sheet("Edit Wanted").getByLabelText("Website (optional)"), { target: { value: "https://ok.example" } });
    fireEvent.click(sheet("Edit Wanted").getByRole("button", { name: "Save" }));
    expect((await sheet("Edit Wanted").findByRole("alert")).textContent).toBe("Links must start with http:// or https://");
    expect((sheet("Edit Wanted").getByLabelText("Website (optional)") as HTMLInputElement).value).toBe("https://ok.example");
  });

  /** Opens a visited place, where the stars are. */
  const rated = async (ratings: Record<string, number>) => {
    await open({ ...crew, meId: "a", places: [{ ...visited, name: "Café X", id: "p1", ratings }] });
    list(/^Been there · /);
    openPlace("Café X");
    return within(screen.getByRole("radiogroup", { name: "Your rating of Café X" }));
  };

  it("shows the average rating and lets me rate in half stars, change and take back my own", async () => {
    const stars = await rated({ a: 4, b: 5, c: 2.5 });
    expect(sheet("Café X").getByText("3.8 from 3 ratings")).toBeTruthy();
    expect(stars.getAllByRole("radio").map((r) => r.getAttribute("aria-label"))).toEqual(
      ["0.5 stars", "1 star", "1.5 stars", "2 stars", "2.5 stars", "3 stars", "3.5 stars", "4 stars", "4.5 stars", "5 stars"],
    );
    expect(stars.getByRole("radio", { name: "4 stars" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(stars.getByRole("radio", { name: "2.5 stars" }));
    fireEvent.click(stars.getByRole("radio", { name: "2.5 stars" })); // what I just picked: takes it back
    expect(await sent(2)).toEqual([
      { path: "/places/p1/rating", body: { stars: 2.5 } },
      { path: "/places/p1/rating", body: null },
    ]);
  });

  it("fills the stars by halves: my rating, or a preview under the mouse", async () => {
    const stars = await rated({ a: 3.5 });
    const group = screen.getByRole("radiogroup");
    const fills = () => [...group.querySelectorAll("svg")].map((svg) => Number(svg.querySelector("rect")?.getAttribute("width") ?? 0) / 24);
    expect(fills()).toEqual([1, 1, 1, 0.5, 0]);
    fireEvent.pointerEnter(stars.getByRole("radio", { name: "1.5 stars" }), { pointerType: "touch" }); // a finger doesn't preview
    expect(fills()).toEqual([1, 1, 1, 0.5, 0]);
    fireEvent.pointerEnter(stars.getByRole("radio", { name: "1.5 stars" }), { pointerType: "mouse" });
    expect(fills()).toEqual([1, 0.5, 0, 0, 0]);
    expect(sheet("Café X").getByText("1.5 stars")).toBeTruthy();
    fireEvent.pointerLeave(group);
    expect(fills()).toEqual([1, 1, 1, 0.5, 0]);
    expect(sheet("Café X").getByText("3.5 from 1 rating")).toBeTruthy();
  });

  it("rates from the keyboard: one stop in the tab order, arrows move by half a star from what I just picked, Delete clears", async () => {
    const stars = await rated({ a: 3.5 });
    expect(stars.getAllByRole("radio").filter((r) => r.tabIndex === 0).map((r) => r.getAttribute("aria-label"))).toEqual(["3.5 stars"]);
    const mine = stars.getAllByRole("radio")[6];
    fireEvent.keyDown(mine, { key: "ArrowRight" });
    expect(document.activeElement?.getAttribute("aria-label")).toBe("4 stars");
    fireEvent.keyDown(mine, { key: "ArrowRight" }); // builds on the 4 just picked, before the server answers
    expect(stars.getAllByRole("radio").find((r) => r.getAttribute("aria-checked") === "true")?.getAttribute("aria-label")).toBe("4.5 stars");
    fireEvent.keyDown(mine, { key: "End" });
    fireEvent.keyDown(mine, { key: "End" }); // already 5: nothing
    fireEvent.keyDown(mine, { key: "Home" });
    fireEvent.keyDown(mine, { key: "ArrowLeft" }); // already the lowest: nothing
    fireEvent.keyDown(mine, { key: "Delete" });
    fireEvent.keyDown(mine, { key: "Backspace" }); // nothing left to clear
    fireEvent.keyDown(mine, { key: "Enter" }); // not a rating key: nothing
    expect(await sent(5)).toEqual([
      { path: "/places/p1/rating", body: { stars: 4 } },
      { path: "/places/p1/rating", body: { stars: 4.5 } },
      { path: "/places/p1/rating", body: { stars: 5 } },
      { path: "/places/p1/rating", body: { stars: 0.5 } },
      { path: "/places/p1/rating", body: null },
    ]);
  });

  it("keeps my newest stars when the server's answer to an earlier press arrives in between", async () => {
    const stars = await rated({ a: 3.5 });
    const checked = () => stars.getAllByRole("radio").find((r) => r.getAttribute("aria-checked") === "true")?.getAttribute("aria-label");
    const mine = stars.getAllByRole("radio")[6];
    fireEvent.keyDown(mine, { key: "ArrowRight" });
    fireEvent.keyDown(mine, { key: "ArrowRight" });
    expect(checked()).toBe("4.5 stars");
    const withRating = (a: number) => ({ ...crew, meId: "a", places: [{ ...visited, name: "Café X", id: "p1", ratings: { a } }] });
    await update(withRating(4)); // the server has the first press so far
    expect(checked()).toBe("4.5 stars");
    fireEvent.keyDown(mine, { key: "ArrowRight" });
    expect(checked()).toBe("5 stars");
    await update(withRating(5)); // it has caught up: its copy takes over again
    await update(withRating(3)); // changed on my other device
    expect(checked()).toBe("3 stars");
    expect(writes.map((w) => w.body)).toEqual([{ stars: 4 }, { stars: 4.5 }, { stars: 5 }]);
  });

  it("starts the keyboard on half a star when I haven't rated, and puts my old rating back when a new one is refused", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const stars = await rated({});
    expect(stars.getAllByRole("radio").filter((r) => r.tabIndex === 0).map((r) => r.getAttribute("aria-label"))).toEqual(["0.5 stars"]);
    fireEvent.keyDown(stars.getAllByRole("radio")[0], { key: "ArrowLeft" }); // down from no rating: no half star
    fireEvent.keyDown(stars.getAllByRole("radio")[0], { key: "ArrowDown" });
    expect(stars.getAllByRole("radio").filter((r) => r.getAttribute("aria-checked") === "true")).toEqual([]);
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(writes).toEqual([]);
    expect(sheet("Café X").getByText("No ratings yet")).toBeTruthy();
    cleanup();
    const again = await rated({ a: 2 });
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) =>
      init?.method === "PUT" ? { ok: false, status: 404, json: async () => ({ error: "No such place" }) } : { ok: true, json: async () => ({ ...crew, places: [{ ...visited, name: "Café X", id: "p1", ratings: { a: 2 } }] }) },
    );
    const checked = () => again.getAllByRole("radio").find((r) => r.getAttribute("aria-checked") === "true")?.getAttribute("aria-label");
    fireEvent.click(again.getByRole("radio", { name: "4.5 stars" }));
    expect(checked()).toBe("4.5 stars");
    expect((await sheet("Café X").findByRole("alert")).textContent).toBe("No such place");
    expect(checked()).toBe("2 stars");
  });

  it("lists the comments with who wrote each and when, and offers Delete only on my own (or all to the owner)", async () => {
    const withComments = { ...place, comments: [{ id: "k1", memberId: "b", body: "Loved it", createdAt: NOW - DAY - 1000 }, { id: "k2", memberId: "c", body: "Loud", createdAt: NOW - 5 * 6e4 }] };
    await open({ ...crew, meId: "c", places: [withComments] });
    expect(row("Café X").textContent).toContain("· 2 comments");
    openPlace("Café X");
    expect(sheet("Café X").getByRole("heading", { name: "Comments · 2" })).toBeTruthy();
    const bubble = (body: string) => screen.getByText(body).parentElement!;
    expect(bubble("Loved it").textContent).toBe("Ben · yesterdayLoved it");
    expect(bubble("Loud").textContent).toBe("Chie · 5 minutes agoDeleteLoud");
    expect(screen.queryByRole("button", { name: "Delete comment by Ben" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete comment by Chie" }));
    expect(await sent(1)).toEqual([{ path: "/places/p1/comments/k2", body: null }]);
    cleanup();
    await open({ ...crew, places: [withComments] }); // Ana owns the group
    openPlace("Café X");
    expect(screen.getByRole("button", { name: "Delete comment by Ben" })).toBeTruthy();
  });

  it("shows a comment of someone who left as written by a deleted user, and only the owner can delete it", async () => {
    const orphan = { ...place, comments: [{ id: "k9", memberId: null, body: "See you", createdAt: NOW - 400 * DAY }] };
    await open({ ...crew, meId: "c", places: [orphan] });
    openPlace("Café X");
    expect(screen.getByText("See you").parentElement!.textContent).toBe("Deleted user · last yearSee you");
    expect(screen.queryByRole("button", { name: "Delete comment by a deleted user" })).toBeNull();
    cleanup();
    await open({ ...crew, places: [orphan] }); // Ana owns the group
    openPlace("Café X");
    fireEvent.click(screen.getByRole("button", { name: "Delete comment by a deleted user" }));
    expect(await sent(1)).toEqual([{ path: "/places/p1/comments/k9", body: null }]);
  });

  it("writes a comment in the pop-up and empties the box once it's posted", async () => {
    await open({ ...crew, places: [place] });
    openPlace("Café X");
    expect(sheet("Café X").getByRole("heading", { name: "No comments yet" })).toBeTruthy();
    const box = sheet("Café X").getByLabelText("Your comment") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "  Nice  " } });
    expect(sheet("Café X").getByText("8/500")).toBeTruthy();
    fireEvent.click(sheet("Café X").getByRole("button", { name: "Post" }));
    expect(await sent(1)).toEqual([{ path: "/places/p1/comments", body: { body: "Nice" } }]);
    await vi.waitFor(() => expect(box.value).toBe(""));
  });

  it("does not send an empty comment, and keeps the text with the reason when a comment is refused", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const group = { ...crew, places: [place] };
    await open(group);
    openPlace("Café X");
    expect((sheet("Café X").getByRole("button", { name: "Post" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(sheet("Café X").getByLabelText("Your comment").closest("form")!);
    expect(writes).toEqual([]);
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? { ok: false, status: 409, json: async () => ({ error: "The wishlist can hold 300 comments" }) }
        : { ok: true, json: async () => group },
    );
    fireEvent.change(sheet("Café X").getByLabelText("Your comment"), { target: { value: "Hi" } });
    fireEvent.click(sheet("Café X").getByRole("button", { name: "Post" }));
    expect((await sheet("Café X").findByRole("alert")).textContent).toBe("The wishlist can hold 300 comments");
    expect((sheet("Café X").getByLabelText("Your comment") as HTMLTextAreaElement).value).toBe("Hi");
  });
});
