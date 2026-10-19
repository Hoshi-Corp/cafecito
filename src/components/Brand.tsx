"use client";

import { useEffect, useRef, type CSSProperties } from "react";

/** The Rainbow c: the four stripes bent into a c, and the dot in the gap is you, about to join. */
export function Mark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} aria-hidden="true">
      <g fill="none" strokeWidth="7" strokeLinecap="round">
        <path stroke="#ef3b36" d="M74.7,25.3A35,35 0 1 0 74.7,74.7" />
        <path stroke="#ff8a1f" d="M69,31A27,27 0 1 0 69,69" />
        <path stroke="#ffc53d" d="M63.4,36.6A19,19 0 1 0 63.4,63.4" />
        <path stroke="#17a08f" d="M57.8,42.2A11,11 0 1 0 57.8,57.8" />
      </g>
      <circle cx="80" cy="50" r="7" fill="currentColor" />
    </svg>
  );
}

const STRIPES: [color: string, radius: number, depth: number][] = [
  ["#ef3b36", 300, 4],
  ["#ff8a1f", 266, 9],
  ["#ffc53d", 232, 14],
  ["#17a08f", 198, 20],
];

/**
 * The rainbow behind the top of the page. Each stripe sits on its own layer, so under a mouse they drift apart
 * at different rates and the whole arc tilts a little. Touch and reduced motion leave it still.
 */
export function Rainbow({ className }: { className?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = ref.current;
    const host = svg?.parentElement;
    if (!svg || !host || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const r = host.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      svg.style.setProperty("--ry", `${x * 10}deg`);
      svg.style.setProperty("--rx", `${-y * 8}deg`);
      svg.querySelectorAll<SVGGElement>("g[data-depth]").forEach((g) => {
        const k = Number(g.dataset.depth);
        g.style.transform = `translate(${x * k}px, ${y * k * 0.6}px)`;
      });
    };
    const leave = () => {
      svg.style.setProperty("--ry", "0deg");
      svg.style.setProperty("--rx", "0deg");
      svg.querySelectorAll<SVGGElement>("g[data-depth]").forEach((g) => (g.style.transform = ""));
    };
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerleave", leave);
    return () => {
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", leave);
    };
  }, []);
  return (
    <svg
      ref={ref}
      viewBox="0 0 640 330"
      aria-hidden="true"
      className={`rainbow overflow-visible transition-transform duration-400 ease-out ${className ?? ""}`}
      style={{ transform: "perspective(900px) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg))" }}
    >
      <defs>
        <radialGradient id="rainbow-sun" cx="38%" cy="30%" r="75%">
          <stop offset="0" stopColor="#fff7d9" />
          <stop offset=".55" stopColor="#ffd76a" />
          <stop offset="1" stopColor="#f6a623" />
        </radialGradient>
      </defs>
      <circle className="sun" cx="320" cy="330" r="150" fill="url(#rainbow-sun)" />
      {STRIPES.map(([color, r, depth]) => (
        <g key={color} data-depth={depth}>
          <path
            pathLength={1}
            fill="none"
            stroke={color}
            strokeWidth={30}
            style={{ filter: "drop-shadow(0 6px 6px rgb(28 40 64 / .22))" }}
            d={`M${320 - r},360 V330 A${r},${r} 0 0 1 ${320 + r},330 V360`}
          />
        </g>
      ))}
    </svg>
  );
}

/** The soft edge where the sky meets the page. */
export function Wave({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 1440 64" preserveAspectRatio="none" aria-hidden="true" className={className}>
      <path
        style={{ fill: "var(--background)" }}
        d="M0,34 C180,6 360,6 540,30 C720,54 900,58 1080,34 C1260,10 1350,12 1440,22 V64 H0 Z"
      />
    </svg>
  );
}

/** A friend's initial on their color. */
export function Face({ name, color, size = 44, ring, className, style }: {
  name: string;
  color: string;
  size?: number;
  /** The background around the face, so overlapping faces stay apart. */
  ring?: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      className={`round grid shrink-0 place-items-center rounded-full font-bold text-white ${className ?? ""}`}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: color,
        boxShadow: ring ? `0 0 0 3px ${ring}` : undefined,
        ...style,
      }}
    >
      {(name.trim() || "?")[0].toUpperCase()}
    </span>
  );
}

/** The four stripes, for the corner of a card. */
export function Arcs({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 160" aria-hidden="true" className={className}>
      <g fill="none" strokeWidth="12">
        <circle cx="160" cy="0" r="138" stroke="#ef3b36" />
        <circle cx="160" cy="0" r="124" stroke="#ff8a1f" />
        <circle cx="160" cy="0" r="110" stroke="#ffc53d" />
        <circle cx="160" cy="0" r="96" stroke="#17a08f" />
      </g>
    </svg>
  );
}
