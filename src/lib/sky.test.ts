// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { SKY_SCRIPT, skyAt, skyNow, subscribeSky } from "./sky";

const at = (h: number, m = 0) => new Date(2026, 9, 20, h, m);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
  delete document.documentElement.dataset.sky;
});

describe("skyAt", () => {
  it.each([
    [0, 0, "night"],
    [4, 59, "night"],
    [5, 0, "dawn"],
    [7, 59, "dawn"],
    [8, 0, "day"],
    [16, 59, "day"],
    [17, 0, "dusk"],
    [19, 59, "dusk"],
    [20, 0, "night"],
    [23, 30, "night"],
  ])("at %i:%i it's %s", (h, m, sky) => {
    expect(skyAt(at(h, m))).toBe(sky);
  });

  it("is always night in dark mode", () => {
    expect(skyAt(at(12), true)).toBe("night");
  });

  it("shows the sky a preview asks for, and ignores one it doesn't know", () => {
    expect(skyAt(at(12), true, "dawn")).toBe("dawn");
    expect(skyAt(at(12), false, "noon")).toBe("day");
  });
});

/** Runs the <head> script as the browser would and returns what it set. */
function runScript(now: Date, dark = false) {
  vi.useFakeTimers({ toFake: ["Date"], now });
  vi.stubGlobal("matchMedia", () => ({ matches: dark }));
  new Function(SKY_SCRIPT)();
  return document.documentElement.dataset.sky;
}

describe("the script in <head>", () => {
  it("agrees with skyAt at every quarter hour, in light and dark mode", () => {
    for (let q = 0; q < 96; q++) {
      const now = at(Math.floor(q / 4), (q % 4) * 15);
      for (const dark of [false, true]) expect(runScript(now, dark)).toBe(skyAt(now, dark));
    }
  });

  it("honours ?sky=", () => {
    window.history.replaceState(null, "", "/?sky=dusk");
    expect(runScript(at(12))).toBe("dusk");
    window.history.replaceState(null, "", "/?sky=lunch");
    expect(runScript(at(12))).toBe("day");
  });
});

describe("skyNow and subscribeSky", () => {
  it("reads the clock, dark mode and ?sky=", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: at(18) });
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    expect(skyNow()).toBe("dusk");
    window.history.replaceState(null, "", "/?sky=dawn");
    expect(skyNow()).toBe("dawn");
  });

  it("checks every minute, when the page comes back, and when dark mode flips; and stops when asked", () => {
    vi.useFakeTimers();
    let flip = () => {};
    const removed = vi.fn();
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: (_: string, f: () => void) => (flip = f),
      removeEventListener: removed,
    }));
    const change = vi.fn();
    const stop = subscribeSky(change);
    vi.advanceTimersByTime(60_000);
    expect(change).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event("visibilitychange"));
    flip();
    expect(change).toHaveBeenCalledTimes(3);
    stop();
    expect(removed).toHaveBeenCalled();
    vi.advanceTimersByTime(120_000);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(change).toHaveBeenCalledTimes(3);
  });
});
