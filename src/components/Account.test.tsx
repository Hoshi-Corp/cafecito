// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EMPTY_PATTERN } from "@/lib/availability";
import type { Group } from "@/lib/types";
import { Account } from "./Account";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const m = (id: string, name: string) => ({ id, name, color: "#000000", timeZone: "UTC", pattern: EMPTY_PATTERN, overrides: {} });
const group: Group = { id: "g", name: "G", slotMinutes: 30, meId: "a", ownerId: "a", members: [m("a", "Ana"), m("b", "Ben")] };

function serve(sessions: unknown[], answer = { ok: true, body: {} as unknown }) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}${init?.body ? ` ${init.body}` : ""}`);
    if (url.endsWith("/sessions") && !init?.method) return { ok: true, json: async () => sessions };
    return { ok: answer.ok, json: async () => answer.body };
  });
  return calls;
}

it("lists my devices and signs out the others", async () => {
  const calls = serve([
    { device: "Firefox on Linux", createdAt: 0, lastSeen: 0, current: true },
    { device: "", createdAt: 0, lastSeen: Date.UTC(2026, 0, 2), current: false },
  ]);
  render(<Account group={group} />);
  expect(await screen.findByText(/Firefox on Linux/)).toBeTruthy();
  expect(screen.getByText(/this device/)).toBeTruthy();
  expect(screen.getByText(/Unknown device/)).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Sign out other devices" })));
  expect(calls).toContain("DELETE /api/groups/me/me/sessions");
  expect(screen.getByRole("link", { name: "Export my data" }).getAttribute("href")).toBe("/api/groups/me/me");
});

it("saves a recovery email only when the server can send email, and shows a refusal", async () => {
  serve([]);
  const { unmount } = render(<Account group={group} />);
  expect(screen.queryByLabelText(/Recovery email/)).toBeNull();
  unmount();

  const calls = serve([], { ok: false, body: { error: "Invalid email address" } });
  render(<Account group={{ ...group, recovery: true, email: "ana@example.org" }} />);
  const input = screen.getByLabelText(/Recovery email/) as HTMLInputElement;
  expect(input.value).toBe("ana@example.org");
  fireEvent.change(input, { target: { value: "x@y.co" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
  expect(calls).toContain(`PATCH /api/groups/me/me {"email":"x@y.co"}`);
  expect(screen.getByRole("status").textContent).toBe("Invalid email address");
});

it("deletes my account after a warning that says what happens to the group", async () => {
  const calls = serve([]);
  const asked: string[] = [];
  let answer = false;
  vi.stubGlobal("confirm", (q: string) => (asked.push(q), answer));
  const { rerender } = render(<Account group={group} />);
  const del = () => act(async () => fireEvent.click(screen.getByRole("button", { name: "Delete my account" })));
  await del();
  expect(asked[0]).toMatch(/Ben becomes its owner/);
  expect(asked[0]).toMatch(/Plans, wishlist places and comments you wrote stay in the group, without your name/);
  expect(calls.some((c) => c.startsWith("DELETE /api/groups/me/me "))).toBe(false);

  rerender(<Account group={{ ...group, members: [group.members[0]] }} />);
  await del();
  expect(asked[1]).toMatch(/deleted too/);
  expect(asked[1]).not.toMatch(/stay in the group/); // the group goes with them, nothing stays
  rerender(<Account group={{ ...group, meId: "b" }} />);
  answer = true;
  await del();
  expect(asked[2]).not.toMatch(/owner|deleted too/);
  expect(calls).toContain("DELETE /api/groups/me/me");
});

it("makes a new personal link after confirming, and shows it once", async () => {
  const calls = serve([], { ok: true, body: { accessToken: "newtok" } });
  vi.stubGlobal("location", { origin: "https://cafe.test" });
  vi.stubGlobal("confirm", () => true);
  render(<Account group={group} />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Get a new personal link" })));
  expect(calls).toContain("POST /api/groups/me/me/access-link");
  expect((screen.getByLabelText("Your personal link") as HTMLInputElement).value).toBe("https://cafe.test/sign-in#newtok");
  expect(screen.getByRole("button", { name: "Get a new personal link" })).toBeTruthy(); // can make another
});
