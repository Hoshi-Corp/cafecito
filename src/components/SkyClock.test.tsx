// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SkyClock } from "./SkyClock";

let metas: HTMLMetaElement[];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"], now: new Date(2026, 9, 20, 19, 59, 30) });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  metas = ["light", "dark"].map((scheme) => {
    const m = document.createElement("meta");
    m.name = "theme-color";
    m.media = `(prefers-color-scheme: ${scheme})`;
    document.head.append(m);
    return m;
  });
  // jsdom doesn't load globals.css, so give each sky its colour here.
  const style = document.createElement("style");
  style.textContent = ':root[data-sky="dusk"] { --sky: #f8dbd2 } :root[data-sky="night"] { --sky: #1d3550 }';
  document.head.append(style);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.head.innerHTML = "";
  delete document.documentElement.dataset.sky;
});

it("sets the page's sky and the browser bar from the clock, and turns to night at 8 pm", () => {
  render(<SkyClock />);
  expect(document.documentElement.dataset.sky).toBe("dusk");
  expect(metas.map((m) => m.content)).toEqual(["#f8dbd2", "#f8dbd2"]);
  act(() => vi.advanceTimersByTime(60_000));
  expect(document.documentElement.dataset.sky).toBe("night");
  expect(metas.map((m) => m.content)).toEqual(["#1d3550", "#1d3550"]);
});
