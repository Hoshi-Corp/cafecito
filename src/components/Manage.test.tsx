// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EMPTY_PATTERN } from "@/lib/availability";
import type { Group } from "@/lib/types";
import { Manage } from "./Manage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const m = (id: string, name: string) => ({ id, name, color: "#000000", timeZone: "UTC", pattern: EMPTY_PATTERN, overrides: {} });
const group: Group = { id: "g", name: "G", slotMinutes: 30, meId: "a", ownerId: "a", members: [m("a", "Ana"), m("b", "Ben")] };

it("lists live invites, creates a link shown once, revokes, and removes a member after confirming", async () => {
  const calls: string[] = [];
  let invites = [{ id: "i1", expiresAt: Date.now() + 86_400_000, maxUses: 3, uses: 1 }];
  vi.stubGlobal("location", { origin: "https://cafe.test" });
  const asked: string[] = [];
  vi.stubGlobal("confirm", (q: string) => (asked.push(q), true));
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/invites") && init?.method === "POST") return { ok: true, json: async () => ({ id: "i2", token: "tok" }) };
    if (init?.method === "DELETE" && url.includes("/invites/")) invites = [];
    return { ok: true, json: async () => (url.endsWith("/invites") ? invites : group) };
  });
  render(<Manage group={group} />);
  expect(await screen.findByText(/used 1 of 3/)).toBeTruthy();

  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Create invite link" })));
  expect((screen.getByDisplayValue(/cafe\.test\/join\/tok/) as HTMLInputElement).readOnly).toBe(true);

  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Revoke" })));
  expect(calls).toContain("DELETE /api/groups/me/invites/i1");
  expect(screen.queryByText(/used 1 of 3/)).toBeNull();

  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Remove" })));
  expect(calls).toContain("DELETE /api/groups/me/members/b");
  expect(asked.at(-1)).toBe("Remove Ben? Their availability is deleted. Their plans, wishlist places and comments stay, without their name.");
});

it("shows the server's reason when an invite cannot be made", async () => {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) =>
    init?.method === "POST" ? { ok: false, json: async () => ({ error: "Invalid expiry" }) } : { ok: true, json: async () => [] },
  );
  render(<Manage group={group} />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Create invite link" })));
  expect(screen.getByRole("alert").textContent).toBe("Invalid expiry");
});

it("lets the owner make a new link for a member and shows it to send on", async () => {
  const calls: string[] = [];
  vi.stubGlobal("location", { origin: "https://cafe.test" });
  vi.stubGlobal("confirm", () => true);
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    return { ok: true, json: async () => (init?.method === "POST" ? { accessToken: "tok" } : []) };
  });
  render(<Manage group={group} />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "New link" })));
  expect(calls).toContain("POST /api/groups/me/members/b/access-link");
  expect((screen.getByLabelText("Your personal link") as HTMLInputElement).value).toBe("https://cafe.test/sign-in#tok");
  expect(screen.getByText(/Send this to Ben privately/)).toBeTruthy();
});
