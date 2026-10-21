/** The light outside, from the viewer's own clock: dawn, day, dusk or night. */
export type Sky = "dawn" | "day" | "dusk" | "night";

const DARK = "(prefers-color-scheme: dark)";

/** The hour each part of the day starts at, on the viewer's clock. */
export const HOURS = { dawn: 5, day: 8, dusk: 17, night: 20 } as const;

const SKIES = /^(dawn|day|dusk|night)$/;

/**
 * The sky at a given time. A device in dark mode always gets night, so the page stays dark for people who asked
 * for it. A preview can ask for a sky with ?sky=dusk (or dawn, day, night).
 */
export function skyAt(now: Date, dark = false, asked?: string | null): Sky {
  if (asked && SKIES.test(asked)) return asked as Sky;
  const h = now.getHours() + now.getMinutes() / 60;
  if (dark || h < HOURS.dawn || h >= HOURS.night) return "night";
  return h < HOURS.day ? "dawn" : h < HOURS.dusk ? "day" : "dusk";
}

export const skyNow = (): Sky =>
  skyAt(new Date(), !!window.matchMedia?.(DARK).matches, new URLSearchParams(window.location.search).get("sky"));

/** Calls back when the sky may have changed: every minute, when the page comes back, or when dark mode flips. */
export function subscribeSky(change: () => void) {
  const q = window.matchMedia?.(DARK);
  q?.addEventListener("change", change);
  document.addEventListener("visibilitychange", change);
  const tick = window.setInterval(change, 60_000);
  return () => {
    q?.removeEventListener("change", change);
    document.removeEventListener("visibilitychange", change);
    window.clearInterval(tick);
  };
}

/**
 * The same rule as skyAt, run in <head> before the first paint, so a page opened at night is dark from the start
 * instead of flashing light first.
 */
export const SKY_SCRIPT = `(function(){try{var q=new URLSearchParams(location.search).get("sky"),d=new Date(),h=d.getHours()+d.getMinutes()/60;document.documentElement.dataset.sky=${SKIES}.test(q)?q:matchMedia("${DARK}").matches||h<${HOURS.dawn}||h>=${HOURS.night}?"night":h<${HOURS.day}?"dawn":h<${HOURS.dusk}?"day":"dusk"}catch(e){}})()`;
