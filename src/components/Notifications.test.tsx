// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Notifications } from "./Notifications";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "serviceWorker");
  Reflect.deleteProperty(navigator, "maxTouchPoints");
});

/**
 * A browser that can do push. `permission` is what the person answers when asked; `held` is whether it already holds a
 * subscription (`serverKnows` is what the server's row says).
 */
function browser(
  permission: NotificationPermission,
  options: { serverKnows?: boolean; held?: boolean; saves?: boolean; start?: NotificationPermission } = {},
) {
  const { serverKnows = false, held = serverKnows, saves = true, start = serverKnows ? "granted" : "default" } = options;
  const calls: string[] = [];
  const order: string[] = [];
  let current: ReturnType<typeof subscription> | null = held ? subscription() : null;
  function subscription() {
    return {
      toJSON: () => ({ endpoint: "https://push.example/1", keys: { p256dh: "a", auth: "b" } }),
      unsubscribe: vi.fn(async () => (order.push("unsubscribe"), (current = null), true)),
    };
  }
  const pushManager = {
    subscribe: vi.fn(async () => (order.push("subscribe"), (current = subscription()))),
    getSubscription: async () => current,
  };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      // Like a real browser: right after register() the worker is not active yet, so it cannot subscribe; `ready` waits for it.
      register: async () => ({ pushManager: { ...pushManager, subscribe: async () => { throw new Error("no active Service Worker"); } } }),
      ready: Promise.resolve({ pushManager }),
      getRegistration: async () => ({ pushManager }),
    },
  });
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("Notification", { permission: start, requestPermission: async () => permission });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    return { ok: init?.method === "PUT" ? saves : true, json: async () => ({ publicKey: "BPkey_-", subscribed: serverKnows }) };
  });
  return { calls, order, pushManager, held: () => current };
}

it("says why when the browser cannot do push: no https, an iPhone, or just no support", () => {
  vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({}) }));
  const why = (secure: boolean, agent: string) => {
    vi.stubGlobal("isSecureContext", secure);
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(agent);
    const { container, unmount } = render(<Notifications />);
    const text = container.textContent;
    unmount();
    return text;
  };
  expect(why(false, "iPhone")).toMatch(/secure \(https\) address/);
  expect(why(true, "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toMatch(/Add to Home Screen/);
  expect(why(true, "Mozilla/5.0 (X11; Linux)")).toMatch(/cannot show notifications/);
  Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 5 }); // an iPad says it is a Mac, but has a touch screen
  expect(why(true, "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toMatch(/Add to Home Screen/);
});

it("subscribes this device when the switch is turned on, and unsubscribes when it is turned off", async () => {
  const { calls, pushManager, held } = browser("granted");
  render(<Notifications />);
  const box = (await screen.findByRole("checkbox")) as HTMLInputElement;
  expect(box.checked).toBe(false);
  fireEvent.click(box);
  await waitFor(() => expect(box.checked).toBe(true));
  expect(pushManager.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: expect.any(Uint8Array) });
  expect(calls).toContain("PUT /api/groups/me/me/push");
  fireEvent.click(box);
  await waitFor(() => expect(box.checked).toBe(false));
  expect(held()).toBeNull();
  expect(calls).toContain("DELETE /api/groups/me/me/push");
});

it("gives the browser's subscription back when the server could not save it", async () => {
  const { held } = browser("granted", { saves: false });
  render(<Notifications />);
  const box = (await screen.findByRole("checkbox")) as HTMLInputElement;
  fireEvent.click(box);
  expect((await screen.findByRole("status")).textContent).toMatch(/Could not turn notifications on/);
  await waitFor(() => expect(held()).toBeNull());
  expect(box.checked).toBe(false);
});

it("drops a subscription the browser already holds before subscribing again, so a changed server key cannot block it", async () => {
  const { order } = browser("granted", { held: true, start: "default" });
  render(<Notifications />);
  fireEvent.click(await screen.findByRole("checkbox"));
  await waitFor(() => expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true));
  expect(order).toEqual(["unsubscribe", "subscribe"]);
});

it("ignores a second tap while the first is still working", async () => {
  const { pushManager } = browser("granted");
  render(<Notifications />);
  const box = (await screen.findByRole("checkbox")) as HTMLInputElement;
  fireEvent.click(box);
  fireEvent.click(box);
  await waitFor(() => expect(box.checked).toBe(true));
  expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
});

it("shows off, and clears the server's row, when the browser no longer has the subscription or the permission", async () => {
  for (const options of [{ held: false }, { start: "denied" as const }]) {
    const { calls } = browser("granted", { serverKnows: true, ...options });
    const { unmount } = render(<Notifications />);
    const box = (await screen.findByRole("checkbox")) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(calls).toContain("DELETE /api/groups/me/me/push");
    unmount();
  }
});

it("leaves the switch off when the browser holds a subscription the server has no row for, so nobody is opted in by a tap they never made", async () => {
  const { calls, held } = browser("granted", { held: true, start: "granted" });
  render(<Notifications />);
  expect(((await screen.findByRole("checkbox")) as HTMLInputElement).checked).toBe(false);
  expect(calls).not.toContain("PUT /api/groups/me/me/push");
  expect(held()).not.toBeNull();
});

it("still shows the switch when tidying the server's row fails", async () => {
  browser("granted", { serverKnows: true, held: false });
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    if (init?.method === "DELETE") throw new TypeError("offline");
    return { ok: true, json: async () => ({ publicKey: "BPkey_-", subscribed: true }) };
  });
  render(<Notifications />);
  expect(((await screen.findByRole("checkbox")) as HTMLInputElement).checked).toBe(false);
});

it("keeps the switch on when the browser and the server agree", async () => {
  const { calls } = browser("granted", { serverKnows: true });
  render(<Notifications />);
  expect(((await screen.findByRole("checkbox")) as HTMLInputElement).checked).toBe(true);
  expect(calls).not.toContain("DELETE /api/groups/me/me/push");
});

it("says so up front when notifications were already blocked", async () => {
  browser("denied", { start: "denied" });
  render(<Notifications />);
  expect((await screen.findByRole("status")).textContent).toMatch(/blocked/);
});

it("stays off and explains when the person blocks notifications", async () => {
  const { calls } = browser("denied");
  render(<Notifications />);
  fireEvent.click(await screen.findByRole("checkbox"));
  expect((await screen.findByRole("status")).textContent).toMatch(/blocked/);
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  expect(calls).not.toContain("PUT /api/groups/me/me/push");
});
