// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { drawLandscape, drawTree, type Phase, type Season } from "./scenery";

const SEASONS: Season[] = ["spring", "summer", "fall", "winter"];
const PHASES: Phase[] = ["dawn", "day", "dusk", "night"];
const SPECIES = ["maple", "aspen", "larch"] as const;

/** Every call a painter makes, as "method" or "property=value", so two paintings can be compared. */
type Log = string[];

/** A 2D context (and Path2D) that accepts any drawing call and writes it down. jsdom has no canvas. */
function recorder(log: Log): object {
  return new Proxy(
    {},
    {
      get: (_, key) =>
        key === "createLinearGradient" || key === "createRadialGradient"
          ? () => ({ addColorStop: () => {} })
          : (...args: unknown[]) => void log.push(`${String(key)}(${args.filter((a) => typeof a === "number").length})`),
      set: (_, key, value) => (log.push(`${String(key)}=${typeof value === "string" ? value : "gradient"}`), true),
    },
  );
}

function canvas(width: number, height: number) {
  const log: Log = [];
  const el = document.createElement("canvas");
  Object.defineProperty(el, "clientWidth", { value: width });
  Object.defineProperty(el, "clientHeight", { value: height });
  el.getContext = (() => recorder(log)) as unknown as HTMLCanvasElement["getContext"];
  return { el, log };
}

function browser({ agent = "Mozilla/5.0 (X11; Linux x86_64)", cores = 4, ratio = 3 } = {}) {
  vi.stubGlobal("Path2D", class { constructor() { return recorder([]); } });
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(agent);
  vi.spyOn(navigator, "hardwareConcurrency", "get").mockReturnValue(cores);
  vi.stubGlobal("devicePixelRatio", ratio);
}

const fills = (log: Log) => log.filter((l) => l.startsWith("fill(") || l.startsWith("stroke(")).length;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("drawLandscape", () => {
  it.each(SEASONS.flatMap((s) => PHASES.map((p) => [s, p] as const)))("paints a %s %s meadow", (season, phase) => {
    browser();
    const { el, log } = canvas(1280, 300);
    drawLandscape(el, { season, phase, seed: 5, ground: 240, page: "#fff7ec" });
    expect(fills(log)).toBeGreaterThan(50);
  });

  it("paints the same scene from the same seed, and another from another seed", () => {
    browser();
    const paint = (seed: number) => {
      const { el, log } = canvas(800, 230);
      drawLandscape(el, { season: "fall", phase: "day", seed });
      return log;
    };
    expect(paint(5)).toEqual(paint(5));
    expect(paint(5)).not.toEqual(paint(6));
  });

  it("winter draws snow where summer draws green", () => {
    browser();
    const colors = (season: Season) => {
      const { el, log } = canvas(800, 230);
      drawLandscape(el, { season, phase: "day", seed: 5 });
      return log.filter((l) => l.startsWith("fillStyle=")).join();
    };
    expect(colors("winter")).toContain("rgba(255,255,255");
    expect(colors("summer")).not.toEqual(colors("winter"));
  });

  it("paints Apple devices and 8-core machines at up to 3x, everything else at up to 2x", () => {
    const width = (opts: Parameters<typeof browser>[0]) => {
      browser(opts);
      const { el } = canvas(400, 200);
      drawLandscape(el, { season: "summer", phase: "day" });
      vi.restoreAllMocks();
      return el.width / 400;
    };
    expect(width({ agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" })).toBe(3);
    expect(width({ agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)" })).toBe(3);
    expect(width({ cores: 8 })).toBe(3);
    expect(width({ agent: "Mozilla/5.0 (Linux; Android 15)", cores: 4 })).toBe(2);
    // Never sharper than the screen itself.
    expect(width({ agent: "Mozilla/5.0 (iPhone)", ratio: 1 })).toBe(1);
  });
});

describe("drawTree", () => {
  it.each(SPECIES.flatMap((sp) => SEASONS.flatMap((s) => PHASES.map((p) => [sp, s, p] as const))))(
    "paints a %s in %s at %s",
    (species, season, phase) => {
      browser({ ratio: 1 });
      const { el, log } = canvas(130, 200);
      drawTree(el, { species, season, phase, seed: 11, clearTrunk: 0.48 });
      expect(fills(log)).toBeGreaterThan(5);
    },
  );

  it.each(SPECIES)("grows the same %s from the same seed, and another from another seed", (species) => {
    browser({ ratio: 1 });
    const grow = (seed: number) => {
      const { el, log } = canvas(130, 200);
      drawTree(el, { species, season: "summer", phase: "day", seed });
      return log;
    };
    expect(grow(11)).toEqual(grow(11));
    expect(grow(11)).not.toEqual(grow(23));
  });

  it("turns its leaves in the fall and drops them for winter", () => {
    browser({ ratio: 1 });
    const paint = (season: Season) => {
      const { el, log } = canvas(130, 200);
      drawTree(el, { species: "maple", season, phase: "day", seed: 11 });
      return { strokes: fills(log), colors: log.filter((l) => l.startsWith("fillStyle=")).join() };
    };
    expect(paint("fall").colors).not.toEqual(paint("summer").colors);
    expect(paint("winter").strokes).toBeLessThan(paint("summer").strokes);
  });
});
