"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { drawLandscape, drawTree, type Season } from "../lib/scenery";

export interface Person {
  id: string;
  name: string;
  color: string;
  /** Where they stand at the group's next time; shown on the back of their photo. "unset": nothing marked yet. */
  at: "free" | "maybe" | "busy" | "unset";
}

// The back of a photo: a word and a mark.
const BACK: Record<Person["at"], [word: string, mark: string, color: string]> = {
  free: ["Free", "✓", "#17a08f"],
  maybe: ["Maybe", "~", "#b45309"],
  busy: ["Busy", "–", "#a3172c"],
  unset: ["Not set", "?", "#5a6275"],
};

// The season from the calendar, flipped south of the equator.
const SOUTH =
  /^(Australia|Antarctica)\/|^America\/(Sao_Paulo|Argentina|Santiago|Montevideo|Asuncion|La_Paz|Lima)|^Africa\/(Johannesburg|Maputo|Harare|Windhoek|Gaborone)|^Pacific\/(Auckland|Fiji)/;
function seasonNow(): Season {
  // A preview can ask for a season with ?season=spring (or summer, fall, winter).
  const asked = new URLSearchParams(window.location.search).get("season");
  if (asked === "spring" || asked === "summer" || asked === "fall" || asked === "winter") return asked;
  let m = new Date().getMonth();
  if (SOUTH.test(Intl.DateTimeFormat().resolvedOptions().timeZone ?? "")) m = (m + 6) % 12;
  return m < 2 || m === 11 ? "winter" : m < 5 ? "spring" : m < 8 ? "summer" : "fall";
}

const noop = () => () => {};
const darkQuery = "(prefers-color-scheme: dark)";
const subscribeDark = (change: () => void) => {
  const q = window.matchMedia?.(darkQuery);
  q?.addEventListener("change", change);
  return () => q?.removeEventListener("change", change);
};

const FLAGS = ["#ef3b36", "#ff8a1f", "#ffc53d", "#17a08f"];

/** A point along a sagging string from a to b. */
const along = ([ax, ay]: number[], [bx, by]: number[], sag: number, u: number) => {
  const cx = (ax + bx) / 2, cy = (ay + by) / 2 + 2 * sag;
  return [(1 - u) ** 2 * ax + 2 * (1 - u) * u * cx + u * u * bx, (1 - u) ** 2 * ay + 2 * (1 - u) * u * cy + u * u * by];
};

/**
 * The group's own little park behind the top of the page: a painted landscape for this season, two maples with
 * bunting tied between them, and everyone's photo pegged to the bunting (tap one to see if they're free at the
 * next time). Birds by day; in dark mode it's night, with fairy lights and owls. Nothing renders on the server:
 * it all depends on the screen, the season and the colour scheme.
 */
export function Scenery({ people, everyone }: { people: Person[]; /** Everyone is free at the next time. */ everyone: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const land = useRef<HTMLCanvasElement>(null);
  const trees = useRef<(HTMLCanvasElement | null)[]>([]);
  const birds = useRef<(HTMLDivElement | null)[]>([]);
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const night = useSyncExternalStore(subscribeDark, () => !!window.matchMedia?.(darkQuery).matches, () => false);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  // Off screen, nothing moves: the birds stop and every animation pauses.
  const [onScreen, setOnScreen] = useState(true);
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const season = mounted ? seasonNow() : "summer";
  const phase = night ? "night" : "day";

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setBox({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting));
    io.observe(el);
    return () => {
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  // Where everything goes, from the size of the header.
  const W = box?.w ?? 0, Hh = box?.h ?? 0, wide = W >= 1024;
  const band = wide ? 300 : 230, ground = Hh - (wide ? 62 : 56);
  const th = wide ? Math.min(400, ground - 30) : 200, tw = (th * 220) / 360;
  // The headline's right edge: the page is 1200 px wide, 1480 px from 1360 px up (the `wide` breakpoint).
  const contentRight = Math.max(20, (W - (W >= 1360 ? 1480 : 1200)) / 2 + 20) + 560;
  const xs = wide ? [Math.max(W * 0.7, contentRight + tw * 0.55), W * 0.985] : [W * 0.04, W * 0.96];
  const strings: { a: number[]; b: number[]; sag: number; who: Person[] }[] = [];
  if (box) {
    const tie = (x: number, dir: number, f: number) => [x + dir * 5, ground - f * th];
    if (wide) {
      const half = Math.ceil(people.length / 2);
      strings.push({ a: tie(xs[0], 1, 0.45), b: tie(xs[1], -1, 0.46), sag: 18, who: people.slice(0, half) });
      strings.push({ a: tie(xs[0], 1, 0.22), b: tie(xs[1], -1, 0.23), sag: 18, who: people.slice(half) });
    } else {
      strings.push({ a: tie(xs[0], 1, 0.44), b: tie(xs[1], -1, 0.44), sag: 14, who: people });
    }
  }
  const photo = wide ? 52 : Math.min(38, (W * 0.84) / Math.max(1, people.length) - 8);

  // Paint the landscape and the trees whenever the size, season or light changes.
  useEffect(() => {
    if (!box || !land.current) return;
    const page = getComputedStyle(document.documentElement).getPropertyValue("--background").trim();
    drawLandscape(land.current, { season, phase, seed: 5, ground: band - (Hh - ground), page });
    // Each tree paints in its own task, so a slow phone never stalls on one long one.
    const later = trees.current.map((c, i) =>
      window.setTimeout(() => c && drawTree(c, { species: "maple", season, phase, seed: [11, 23][i], clearTrunk: 0.48 }), 0),
    );
    return () => later.forEach(window.clearTimeout);
  }, [box, season, phase, band, Hh, ground]);

  // Birds fly loose loops around the trees by day, then after a while glide down and perch on the bunting, so a
  // page left open goes still.
  const settled = useRef(false);
  useEffect(() => {
    if (!box || night || !onScreen || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const [x0, x1] = xs, cx = (x0 + x1) / 2, rx = wide ? (x1 - x0) / 2 + 40 : W * 0.42;
    const cy = wide ? ground - th * 0.82 : ground - th * 0.75, ry = wide ? th * 0.09 : 10;
    const paths = [[1, 0.5, 0], [0.8, 0.38, 2.2]];
    const top = strings[0];
    const perches = top ? [0.27, 0.73].map((u) => along(top.a, top.b, top.sag, u)) : [];
    const place = (b: HTMLDivElement, x: number, y: number, left: boolean) =>
      (b.style.transform = `translate(${x - 19}px, ${y - 13}px) scaleX(${left ? -1 : 1})`);
    const perch = () =>
      birds.current.forEach((b, i) => {
        if (!b || !perches[i]) return;
        b.classList.add("perched");
        place(b, perches[i][0], perches[i][1] - 10, i === 1);
      });
    if (settled.current) return perch();
    const FLY = 25, GLIDE = 1.6;
    const start = performance.now(), last: number[][] = [];
    let frame = 0, drawn = 0;
    const fly = (now: number) => {
      frame = requestAnimationFrame(fly);
      if (now - drawn < 31) return; // birds are small: 30 frames a second is plenty
      drawn = now;
      const t = (now - start) / 1000;
      birds.current.forEach((b, i) => {
        if (!b) return;
        if (t < FLY || !perches[i]) {
          const [reach, speed, head] = paths[i], a = speed * t + head;
          last[i] = [cx + rx * reach * Math.sin(a), cy + ry * Math.sin(2 * a + head)];
          place(b, last[i][0], last[i][1], Math.cos(a) < 0);
          return;
        }
        // Glide in to land.
        const p = Math.min(1, (t - FLY) / GLIDE), e = 1 - (1 - p) ** 3, [fx, fy] = last[i], [px, py] = perches[i];
        place(b, fx + (px - fx) * e, fy + (py - 10 - fy) * e - Math.sin(Math.PI * p) * 18, px < fx);
      });
      if (t >= FLY + GLIDE && perches.length) {
        cancelAnimationFrame(frame);
        settled.current = true;
        perch();
      }
    };
    frame = requestAnimationFrame(fly);
    return () => cancelAnimationFrame(frame);
  }, [box, night, onScreen, xs[0], xs[1], wide, W, ground, th]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) =>
    setFlipped((f) => {
      const next = new Set(f);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div ref={ref} aria-hidden="true" className={`scenery pointer-events-none absolute inset-0 -z-10 overflow-hidden${onScreen ? "" : " scn-paused"}`}>
      {box && (
        <>
          <canvas ref={land} className="absolute inset-x-0 bottom-0 w-full" style={{ height: band }} />
          {xs.map((x, i) => (
            <canvas
              key={i}
              ref={(c) => {
                trees.current[i] = c;
              }}
              className="scn-tree absolute"
              style={{ width: tw, height: th, left: x - tw / 2, top: ground - th }}
            />
          ))}
          <svg className="absolute inset-0" width={W} height={Hh}>
            {strings.map(({ a, b, sag }, i) => {
              const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2 + 2 * sag;
              return (
                <path
                  key={i}
                  d={`M${a[0]},${a[1]} Q${cx},${cy} ${b[0]},${b[1]}`}
                  fill="none"
                  stroke={night ? "rgb(255 255 255 / .45)" : "rgb(28 40 64 / .45)"}
                  strokeWidth={1.5}
                />
              );
            })}
            {night &&
              [0, 1].slice(0, wide ? 2 : 1).map((i) => {
                const x = xs[wide ? i : 1], dir = x > W / 2 ? -1 : 1, y = ground - th * 0.5;
                return (
                  <path
                    key={i}
                    d={`M${x},${y} q${dir * th * 0.08},-6 ${dir * th * 0.16},-${th * 0.05}`}
                    stroke="#3a2e27"
                    strokeWidth={5}
                    strokeLinecap="round"
                    fill="none"
                  />
                );
              })}
          </svg>
          {strings.flatMap(({ a, b, sag, who }, si) => {
            // Photos with a flag (or, at night, a little light) between each.
            const span = Math.hypot(b[0] - a[0], b[1] - a[1]), withFlags = span / (2 * who.length + 1) >= 30;
            const slots = withFlags ? 2 * who.length + 1 : who.length;
            return Array.from({ length: slots }, (_, k) => {
              const [x, y] = along(a, b, sag, (k + (si % 2 ? 1 : 0.5)) / (slots + (si % 2 ? 1 : 0)));
              const person = withFlags ? (k % 2 ? who[(k - 1) / 2] : null) : who[k];
              const sway = { "--sw": `${2.4 + ((k * 37 + si * 11) % 10) / 6}s`, "--sd": `${-((k * 53) % 30) / 10}s` } as CSSProperties;
              if (!person)
                return night ? (
                  <span key={`${si}-${k}`} className="scn-hang scn-bulb" style={{ ...sway, left: x, top: y, "--c": FLAGS[k % 4] } as CSSProperties} />
                ) : (
                  <span key={`${si}-${k}`} className="scn-hang scn-flag" style={{ ...sway, left: x, top: y, background: FLAGS[k % 4] }} />
                );
              return (
                <span
                  key={person.id}
                  className={`scn-hang scn-pol${flipped.has(person.id) ? " flip" : ""}`}
                  style={{ ...sway, left: x, top: y, width: photo, height: photo * 1.18, marginLeft: -photo / 2 }}
                  onClick={() => toggle(person.id)}
                >
                  <span className="scn-peg" />
                  <span className="scn-card">
                    <span className="scn-side">
                      <span className="scn-photo" style={{ background: person.color, fontSize: photo * 0.42 }}>
                        {(person.name.trim() || "?")[0].toUpperCase()}
                      </span>
                    </span>
                    <span className="scn-side scn-back" style={{ fontSize: Math.max(11, photo * 0.24) }}>
                      {BACK[person.at][0]}
                      <b style={{ color: BACK[person.at][2] }}>{BACK[person.at][1]}</b>
                    </span>
                  </span>
                </span>
              );
            });
          })}
          {!night &&
            [0, 1].map((i) => (
              <div
                key={i}
                ref={(d) => {
                  birds.current[i] = d;
                }}
                className="scn-bird absolute top-0 left-0"
              >
                <Robin />
              </div>
            ))}
          {night &&
            [0, 1].slice(0, wide ? 2 : 1).map((i) => {
              const x = xs[wide ? i : 1], dir = x > W / 2 ? -1 : 1, size = wide ? 40 : 30;
              const tipX = x + dir * th * 0.16, tipY = ground - th * 0.55;
              return (
                <Owl
                  key={i}
                  kit={OWLS[i % OWLS.length]}
                  start={everyone ? "happy" : "awake"}
                  style={{ width: size, left: tipX - size / 2, top: tipY - size * 1.2 + 3, "--blink": `${4 + i * 1.3}s` } as CSSProperties}
                />
              );
            })}
        </>
      )}
    </div>
  );
}

/** A robin facing right, wings beating. */
function Robin() {
  return (
    <svg viewBox="0 0 64 44" width={38}>
      <defs>
        <clipPath id="robin-body">
          <circle cx="35" cy="22" r="16" />
        </clipPath>
      </defs>
      <path d="M25 24L6 30.5C2.5 31.6 0 28.8 1.2 25.7C1.8 24.3 3 23.5 4.4 23.4L25 19Z" fill="#4e3024" />
      <circle cx="35" cy="22" r="16" fill="#6b4636" />
      <g clipPath="url(#robin-body)">
        <ellipse cx="34" cy="38" rx="15" ry="7" fill="#ffffff" />
        <circle cx="45.5" cy="22" r="12.5" fill="#fbb49a" />
        <circle cx="46.5" cy="20.5" r="12" fill="#f4743b" />
      </g>
      <circle cx="46.2" cy="16.4" r="2.1" fill="#16120f" />
      <path d="M50.6 16.6L58.4 18.6L50.8 21.2Z" fill="#16120f" />
      <path className="scn-wing" d="M14 21.5C16.5 10.5 28.5 7 36.5 14C33 21 24.5 25 14 21.5Z" fill="#553326" />
    </svg>
  );
}

// Two owls: a slate-blue one and a caramel one.
const OWLS = [
  { body: "#7d8aa6", dark: "#5f6b86", chest: "#f1ead8", disc: "#e6e2d6", scallop: "#b9b2a0" },
  { body: "#c98a4b", dark: "#a96c34", chest: "#ffe7b0", disc: "#f6e3c2", scallop: "#d9b277" },
];
type Mood = "awake" | "sleepy" | "surprised" | "happy" | "grumpy";

/**
 * An owl with moods: awake or sleepy on its own; tapped, it's surprised, then pleased; poked three times fast,
 * grumpy. It starts happy when everyone is free at the next time.
 */
function Owl({ kit, start, style }: { kit: (typeof OWLS)[number]; start: Mood; style: CSSProperties }) {
  const [mood, setMood] = useState<Mood>(start);
  const [note, setNote] = useState<{ text: string; n: number } | null>(null);
  const timer = useRef(0);
  const taps = useRef<number[]>([]);
  const after = (ms: number, fn: () => void) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(fn, ms);
  };
  // Left alone, it drifts between awake and sleepy.
  const idle = useRef(() => {});
  useEffect(() => {
    idle.current = () => {
      setMood(Math.random() < 0.55 ? "awake" : "sleepy");
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(idle.current, 5000 + Math.random() * 4000);
    };
    timer.current = window.setTimeout(idle.current, 6000);
    return () => window.clearTimeout(timer.current);
  }, []);
  const poke = () => {
    const now = performance.now();
    taps.current = taps.current.filter((t) => now - t < 1500).concat(now);
    if (taps.current.length >= 3) {
      setMood("grumpy");
      setNote({ text: "Hmph!", n: now });
      after(3500, () => idle.current());
    } else {
      setMood("surprised");
      setNote({ text: "Hoo!", n: now });
      after(500, () => {
        setMood("happy");
        after(2500, () => idle.current());
      });
    }
  };
  const eye = (cx: number) => (
    <g transform={`translate(${cx} 27)`}>
      <circle r="8.6" fill={kit.disc} />
      <g className="open">
        <circle className="iris" r="6.4" fill="#ffc53d" />
        <circle className="pupil" r="3.3" fill="#1c2840" />
        <circle r="1.1" cx="-1.4" cy="-1.5" fill="#fff" />
      </g>
      <path className="lid lid-sleepy" d="M-7 -7H7V0.5C3 -1.4 -3 -1.4 -7 0.5Z" fill={kit.body} />
      <path className="lid lid-grumpy" d={cx < 30 ? "M-7.4 -7.4H7.4V-0.6Z" : "M-7.4 -7.4H7.4L-7.4 -0.6Z"} fill={kit.body} />
      <path className="lid lid-blink" d="M-7.2 -7.2H7.2V7.2H-7.2Z" fill={kit.body} />
      <path className="smile" d="M-5 1.6Q0 -4.6 5 1.6" stroke="#1c2840" strokeWidth="2.4" fill="none" strokeLinecap="round" />
    </g>
  );
  return (
    <div className="scn-owl absolute" style={style} onPointerDown={poke}>
      {note && (
        <span key={note.n} className="scn-note">
          {note.text}
        </span>
      )}
      <svg viewBox="0 0 60 72" className="block w-full" data-mood={mood}>
        <g className="body">
          <path d="M10 14L12 1L22 10ZM50 14L48 1L38 10Z" fill={kit.dark} />
          <path d="M30 6C47 6 54 20 54 38C54 57 44 66 30 66C16 66 6 57 6 38C6 20 13 6 30 6Z" fill={kit.body} />
          <path d="M30 34C40 34 45 42 45 50C45 59 38 64 30 64C22 64 15 59 15 50C15 42 20 34 30 34Z" fill={kit.chest} />
          <path
            d="M20 44q2.5 2.6 5 0q2.5 2.6 5 0q2.5 2.6 5 0q2.5 2.6 5 0M18 51q2.5 2.6 5 0q2.5 2.6 5 0q2.5 2.6 5 0q2.5 2.6 5 0q2.5 2.6 5 0M21 58q2.5 2.6 5 0q2.5 2.6 5 0q2.5 2.6 5 0q2.5 2.6 5 0"
            stroke={kit.scallop}
            strokeWidth="1.4"
            fill="none"
            strokeLinecap="round"
          />
          <path d="M7 32C4 44 6 56 14 63C11 53 11 42 14 33Z" fill={kit.dark} />
          <path d="M53 32C56 44 54 56 46 63C49 53 49 42 46 33Z" fill={kit.dark} />
          {eye(20.5)}
          {eye(39.5)}
          <path d="M27.4 33H32.6L30 39.5Z" fill="#c17a00" />
          <path className="brow" d="M13 15.5Q20 12.5 26 16.5M34 16.5Q40 12.5 47 15.5" stroke={kit.dark} strokeWidth="2.2" fill="none" strokeLinecap="round" />
          <path d="M23 65.5v4M26 65.5v4M34 65.5v4M37 65.5v4" stroke="#c17a00" strokeWidth="2.2" strokeLinecap="round" />
        </g>
      </svg>
    </div>
  );
}
