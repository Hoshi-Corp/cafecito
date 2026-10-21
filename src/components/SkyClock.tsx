"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";
import { skyNow, subscribeSky } from "../lib/sky";

/**
 * Keeps the page's light in step with the viewer's clock: sets data-sky on <html> (which switches the colours) and
 * the browser's bar colour to match the sky. The inline script in the layout sets it before the first paint; this
 * keeps it right while the page stays open.
 */
export function SkyClock() {
  const sky = useSyncExternalStore(subscribeSky, skyNow, () => null);
  useLayoutEffect(() => {
    if (!sky) return;
    const root = document.documentElement;
    root.dataset.sky = sky;
    const color = getComputedStyle(root).getPropertyValue("--sky").trim();
    if (color) document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", color));
  }, [sky]);
  return null;
}
