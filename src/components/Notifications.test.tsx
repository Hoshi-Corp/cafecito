// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Notifications } from "./Notifications";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

/** A browser that can do push. `permission` is what the person answers when asked. */
function browser(permission: NotificationPermission, subscribed = false) {
  const calls: string[] = [];
  const subscription = { toJSON: () => ({ endpoint: "https://push.example/1", keys: { p256dh: "a", auth: "b" } }), unsubscribe: vi.fn(async () => true) };
  const pushManager = { subscribe: vi.fn(async () => subscription), getSubscription: async () => subscription };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register: async () => ({ pushManager }), getRegistration: async () => ({ pushManager }) },
  });
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("Notification", { permission: "default", requestPermission: async () => permission });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    return { ok: true, json: async () => ({ publicKey: "BPkey_-", subscribed }) };
  });
  return { calls, pushManager, subscription };
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
});

it("subscribes this device when the switch is turned on, and unsubscribes when it is turned off", async () => {
  const { calls, pushManager, subscription } = browser("granted");
  render(<Notifications />);
  const box = (await screen.findByRole("checkbox")) as HTMLInputElement;
  expect(box.checked).toBe(false);
  fireEvent.click(box);
  await waitFor(() => expect(box.checked).toBe(true));
  expect(pushManager.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: expect.any(Uint8Array) });
  expect(calls).toContain("PUT /api/groups/me/me/push");
  fireEvent.click(box);
  await waitFor(() => expect(box.checked).toBe(false));
  expect(subscription.unsubscribe).toHaveBeenCalled();
  expect(calls).toContain("DELETE /api/groups/me/me/push");
});

it("says so up front when notifications were already blocked", async () => {
  browser("denied");
  vi.stubGlobal("Notification", { permission: "denied", requestPermission: async () => "denied" });
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
