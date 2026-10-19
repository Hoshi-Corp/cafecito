// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drawLandscape, drawTree } from "@/lib/scenery";
import { Scenery, type Person } from "./Scenery";

vi.mock("@/lib/scenery", () => ({ drawLandscape: vi.fn(), drawTree: vi.fn() }));

const SIX: Person[] = ["Camille", "Diego", "Sofia", "Kenji", "Amara", "You"].map((name, i) => ({
  id: String(i),
  name,
  color: "#123456",
  at: (["free", "busy", "maybe", "unset", "free", "free"] as const)[i],
}));

/** The header's size and whether it's on screen, as the browser would report them. */
let resize: (w: number, h: number) => void;
let showing: (on: boolean) => void;
let media: Record<string, boolean>;

beforeEach(() => {
  media = {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: (e: { contentRect: { width: number; height: number } }[]) => void) {
        resize = (width, height) => act(() => cb([{ contentRect: { width, height } }]));
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: (e: { isIntersecting: boolean }[]) => void) {
        showing = (on) => act(() => cb([{ isIntersecting: on }]));
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: !!media[q], addEventListener() {}, removeEventListener() {} }));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance", "Date"] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.mocked(drawLandscape).mockClear();
  vi.mocked(drawTree).mockClear();
  window.history.replaceState(null, "", "/");
});

const DARK = "(prefers-color-scheme: dark)";

function park({ w = 390, h = 700, people = SIX, everyone = false } = {}) {
  const view = render(<Scenery people={people} everyone={everyone} />);
  const root = view.container.firstElementChild as HTMLElement;
  resize(w, h);
  const all = (sel: string) => [...root.querySelectorAll<HTMLElement>(sel)];
  return { root, all, rerender: view.rerender };
}

describe("the park", () => {
  it("waits for its size, then paints the meadow and two maples", () => {
    render(<Scenery people={SIX} everyone={false} />);
    expect(document.querySelector("canvas")).toBeNull();
    resize(1440, 640);
    expect(document.querySelectorAll("canvas")).toHaveLength(3);
    expect(drawLandscape).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), expect.objectContaining({ phase: "day", seed: 5 }));
    // The trees paint in their own tasks, after the meadow.
    expect(drawTree).not.toHaveBeenCalled();
    act(() => vi.runOnlyPendingTimers());
    expect(drawTree).toHaveBeenCalledTimes(2);
    expect(vi.mocked(drawTree).mock.calls.map(([, o]) => o.species)).toEqual(["maple", "maple"]);
  });

  it("is hidden from screen readers; the page says who's free in words", () => {
    const { root } = park();
    expect(root.getAttribute("aria-hidden")).toBe("true");
  });

  it("hangs everyone's photo on one line on a phone, and tapping a photo flips it to free or busy", () => {
    const { root, all } = park();
    expect(root.querySelectorAll(":scope > svg > path")).toHaveLength(1);
    const photos = all(".scn-pol");
    expect(photos.map((p) => p.querySelector(".scn-photo")!.textContent)).toEqual(["C", "D", "S", "K", "A", "Y"]);
    expect(photos.slice(0, 4).map((p) => p.querySelector(".scn-back")!.textContent)).toEqual(["Free✓", "Busy–", "Maybe~", "Not set?"]);
    fireEvent.click(photos[1]);
    expect(photos[1].classList).toContain("flip");
    fireEvent.click(photos[1]);
    expect(photos[1].classList).not.toContain("flip");
  });

  it("splits people over two lines on a wide screen, with flags between the photos", () => {
    const { root, all } = park({ w: 1440, h: 640 });
    expect(root.querySelectorAll(":scope > svg > path")).toHaveLength(2);
    expect(all(".scn-pol")).toHaveLength(6);
    expect(all(".scn-flag").length).toBeGreaterThan(6);
  });

  it("shows a ? for a blank name", () => {
    const { all } = park({ people: [{ id: "x", name: " ", color: "#000", at: "busy" }] });
    expect(all(".scn-photo")[0].textContent).toBe("?");
  });

  it("pauses everything while it's off screen", () => {
    const { root } = park();
    showing(false);
    expect(root.classList).toContain("scn-paused");
    showing(true);
    expect(root.classList).not.toContain("scn-paused");
  });
});

describe("seasons", () => {
  const season = () => vi.mocked(drawLandscape).mock.calls.at(-1)![1].season;
  const zone = (timeZone: string) =>
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({ timeZone } as Intl.ResolvedDateTimeFormatOptions);

  it.each([
    ["2026-01-15", "winter"],
    ["2026-04-15", "spring"],
    ["2026-07-15", "summer"],
    ["2026-10-15", "fall"],
    ["2026-12-15", "winter"],
  ])("follows the calendar: %s is %s", (date, expected) => {
    vi.setSystemTime(new Date(`${date}T12:00:00Z`));
    zone("America/Toronto");
    park();
    expect(season()).toBe(expected);
  });

  it("flips south of the equator", () => {
    vi.setSystemTime(new Date("2026-07-15T12:00:00Z"));
    zone("Australia/Sydney");
    park();
    expect(season()).toBe("winter");
  });

  it("can be previewed with ?season=", () => {
    vi.setSystemTime(new Date("2026-07-15T12:00:00Z"));
    window.history.replaceState(null, "", "/?season=winter");
    park();
    expect(season()).toBe("winter");
  });

  it("ignores a ?season= it doesn't know", () => {
    vi.setSystemTime(new Date("2026-07-15T12:00:00Z"));
    zone("America/Toronto");
    window.history.replaceState(null, "", "/?season=monsoon");
    park();
    expect(season()).toBe("summer");
  });
});

describe("robins", () => {
  it("fly around the trees, then land on the line after 25 seconds and stay there", () => {
    const { all } = park({ w: 1440, h: 640 });
    const birds = all(".scn-bird");
    expect(birds).toHaveLength(2);
    act(() => vi.advanceTimersByTime(1000));
    const early = birds[0].style.transform;
    expect(early).toMatch(/^translate\(/);
    act(() => vi.advanceTimersByTime(1000));
    expect(birds[0].style.transform).not.toBe(early);
    expect(birds[0].classList).not.toContain("perched");
    act(() => vi.advanceTimersByTime(26000));
    expect(birds.every((b) => b.classList.contains("perched"))).toBe(true);
    const landed = birds[0].style.transform;
    act(() => vi.advanceTimersByTime(5000));
    expect(birds[0].style.transform).toBe(landed);
  });

  it("stay perched when the park scrolls away and back", () => {
    const { all } = park({ w: 1440, h: 640 });
    act(() => vi.advanceTimersByTime(28000));
    showing(false);
    showing(true);
    expect(all(".scn-bird").every((b) => b.classList.contains("perched"))).toBe(true);
  });

  it("stay still for people who ask for reduced motion", () => {
    media["(prefers-reduced-motion: reduce)"] = true;
    const { all } = park();
    act(() => vi.advanceTimersByTime(2000));
    expect(all(".scn-bird")[0].style.transform).toBe("");
  });
});

describe("at night", () => {
  beforeEach(() => {
    media[DARK] = true;
  });

  it("paints the night, hangs fairy lights instead of flags, and has owls instead of robins", () => {
    const { all } = park({ w: 1440, h: 640 });
    expect(vi.mocked(drawLandscape).mock.calls.at(-1)![1].phase).toBe("night");
    expect(all(".scn-bulb").length).toBeGreaterThan(0);
    expect(all(".scn-flag")).toHaveLength(0);
    expect(all(".scn-bird")).toHaveLength(0);
    expect(all(".scn-owl")).toHaveLength(2);
  });

  it("has one owl on a phone", () => {
    const { all } = park();
    expect(all(".scn-owl")).toHaveLength(1);
  });

  const mood = (owl: HTMLElement) => owl.querySelector("svg")!.getAttribute("data-mood");

  it("an owl starts awake, or happy when everyone is free", () => {
    expect(mood(park().all(".scn-owl")[0])).toBe("awake");
    cleanup();
    expect(mood(park({ everyone: true }).all(".scn-owl")[0])).toBe("happy");
  });

  it("an owl says Hoo when tapped, is pleased a moment later, then drifts back to awake or sleepy", () => {
    const owl = park().all(".scn-owl")[0];
    fireEvent.pointerDown(owl);
    expect(mood(owl)).toBe("surprised");
    expect(owl.textContent).toBe("Hoo!");
    act(() => vi.advanceTimersByTime(500));
    expect(mood(owl)).toBe("happy");
    act(() => vi.advanceTimersByTime(2500));
    expect(["awake", "sleepy"]).toContain(mood(owl));
  });

  it("an owl poked three times fast says Hmph and is grumpy for a while", () => {
    const owl = park().all(".scn-owl")[0];
    for (let i = 0; i < 3; i++) {
      fireEvent.pointerDown(owl);
      act(() => vi.advanceTimersByTime(200));
    }
    expect(mood(owl)).toBe("grumpy");
    expect(owl.textContent).toBe("Hmph!");
    act(() => vi.advanceTimersByTime(3000));
    expect(mood(owl)).toBe("grumpy");
    act(() => vi.advanceTimersByTime(600));
    expect(["awake", "sleepy"]).toContain(mood(owl));
  });

  it("taps spread out don't make an owl grumpy", () => {
    const owl = park().all(".scn-owl")[0];
    for (let i = 0; i < 3; i++) {
      fireEvent.pointerDown(owl);
      act(() => vi.advanceTimersByTime(1000));
    }
    expect(mood(owl)).not.toBe("grumpy");
  });

  it("an owl left alone drifts between awake and sleepy", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    const owl = park().all(".scn-owl")[0];
    act(() => vi.advanceTimersByTime(6000));
    expect(mood(owl)).toBe("sleepy");
  });
});
