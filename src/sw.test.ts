import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";

/** Runs public/sw.js against a fake worker scope and returns what it did. */
function run(event: "push" | "notificationclick", data: unknown, windows: { focus: () => void }[] = []) {
  const listeners: Record<string, (e: unknown) => void> = {};
  const shown: [string, { body: string }][] = [];
  const opened: string[] = [];
  const self = {
    addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] = fn),
    registration: { showNotification: async (title: string, options: { body: string }) => void shown.push([title, options]) },
  };
  const clients = { matchAll: async () => windows, openWindow: async (url: string) => void opened.push(url) };
  new Function("self", "clients", readFileSync("public/sw.js", "utf8"))(self, clients);
  const waits: Promise<unknown>[] = [];
  listeners[event]({ data, notification: { close: vi.fn() }, waitUntil: (p: Promise<unknown>) => waits.push(p) });
  return Promise.all(waits).then(() => ({ shown, opened }));
}

it("shows the title and body of a push", async () => {
  const { shown } = await run("push", { json: () => ({ title: "Ana proposed a plan", body: "in G" }) });
  expect(shown[0]).toEqual(["Ana proposed a plan", expect.objectContaining({ body: "in G" })]);
});

it("still shows a notification when the push body is not JSON, or empty", async () => {
  const bad = await run("push", { json: () => { throw new SyntaxError("not json"); } });
  expect(bad.shown[0][0]).toBe("Cafecito");
  expect((await run("push", null)).shown[0][0]).toBe("Cafecito");
});

it("opens the app on a tap, or focuses it when it is already open", async () => {
  expect((await run("notificationclick", null)).opened).toEqual(["/"]);
  const focus = vi.fn();
  expect((await run("notificationclick", null, [{ focus }])).opened).toEqual([]);
  expect(focus).toHaveBeenCalled();
});
