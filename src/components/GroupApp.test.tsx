// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_PATTERN, QUANTA_PER_DAY, paintPattern, shiftPattern } from "@/lib/availability";
import { retryLoad } from "@/lib/store";
import type { Group, Mark, Member } from "@/lib/types";
import { GroupApp } from "./GroupApp";

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
    days: () => [...container.querySelectorAll(".sticky .text-sm")].map((el) => el.textContent),
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
    expect(screen.getByText("13").className).toContain("text-accent");
    expect(screen.getByText("14").className).not.toContain("text-accent");
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
    expect(document.querySelector(".sticky .text-accent")).toBeNull();
  });

  it("rolls over to the new week when a tab left open becomes visible again", async () => {
    const { days } = await open();
    vi.setSystemTime(new Date("2026-10-20T15:00:00Z"));
    fireEvent(document, new Event("visibilitychange"));
    expect(days()[0]).toBe("19");
    expect(screen.getByText("20").className).toContain("text-accent");
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
  const outing = { id: "o1", title: "Brunch", place: "Café X", startQ: Date.now() / 900_000 + 100, endQ: Date.now() / 900_000 + 104, createdBy: "b", rsvps: { b: "y" as const } };

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

