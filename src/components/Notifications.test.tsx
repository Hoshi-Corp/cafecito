// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Notifications } from "./Notifications";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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
  vi.stubGlobal("Notification", { requestPermission: async () => permission });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    return { ok: true, json: async () => ({ publicKey: "BPkey_-", subscribed }) };
  });
  return { calls, pushManager, subscription };
}

it("says why when the browser cannot do push", () => {
  vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({}) }));
  render(<Notifications />);
  expect(screen.getByText(/secure \(https\) address/)).toBeTruthy();
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

it("stays off and explains when the person blocks notifications", async () => {
  const { calls } = browser("denied");
  render(<Notifications />);
  fireEvent.click(await screen.findByRole("checkbox"));
  expect((await screen.findByRole("status")).textContent).toMatch(/blocked/);
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  expect(calls).not.toContain("PUT /api/groups/me/me/push");
});
