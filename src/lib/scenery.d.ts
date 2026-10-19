export type Season = "spring" | "summer" | "fall" | "winter";
export type Phase = "dawn" | "day" | "dusk" | "night";

/** Paints the landscape over the whole canvas; `ground` is where people and trees stand, in CSS pixels. */
export function drawLandscape(
  canvas: HTMLCanvasElement,
  opts: { season: Season; phase: Phase; seed?: number; ground?: number; page?: string },
): void;

/** Paints one tree standing at the bottom centre of the canvas (draw it 220 × 360 in shape). */
export function drawTree(
  canvas: HTMLCanvasElement,
  opts: { species: "maple" | "aspen" | "larch"; season: Season; phase: Phase; seed?: number; clearTrunk?: number },
): void;
