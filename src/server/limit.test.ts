import { afterEach, expect, it } from "vitest";
import { MINUTE, clearLimits, limit, withinLimit } from "./limit";

afterEach(clearLimits);

it("answers whether an attempt is within the limit instead of throwing, and starts again when the window ends", () => {
  const t0 = 1_000_000;
  expect([1, 2, 3].map(() => withinLimit("k", 2, MINUTE, t0))).toEqual([true, true, false]);
  expect(withinLimit("other", 2, MINUTE, t0)).toBe(true); // keys are separate
  expect(withinLimit("k", 2, MINUTE, t0 + MINUTE)).toBe(true);
  expect(() => limit("k", 1, MINUTE, t0 + MINUTE)).toThrow(/Too many attempts/); // the throwing form is unchanged
});
