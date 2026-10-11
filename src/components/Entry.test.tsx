// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { JoinForm, Landing, SignInLink } from "./Entry";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const submit = async (name: string, groupName?: string) => {
  if (groupName) fireEvent.change(screen.getByLabelText("Group name"), { target: { value: groupName } });
  fireEvent.change(screen.getByLabelText("Your name"), { target: { value: name } });
  await act(async () => fireEvent.submit(screen.getByRole("button", { name: /Create group|Join/ })));
};

it("creates a group from the sign-in screen and shows the server's refusal", async () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  let ok = false;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") calls.push({ url, body: JSON.parse(init.body as string) });
    return { ok, status: ok ? 200 : 400, json: async () => (ok ? {} : { error: "Invalid group name" }) };
  });
  render(<Landing />);
  await submit("Ana", "Climbers");
  expect(screen.getByRole("alert").textContent).toBe("Invalid group name");
  expect(calls[0]).toMatchObject({ url: "/api/groups", body: { name: "Ana", groupName: "Climbers" } });
  expect(calls[0].body.timeZone).toEqual(expect.any(String));

  ok = true;
  await submit("Ana", "Climbers");
  expect(screen.queryByRole("alert")).toBeNull();
});

it("shows who is in the group and what they will see before joining", async () => {
  const loc = { href: "" };
  vi.stubGlobal("location", loc);
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) =>
    init?.method === "POST"
      ? { ok: true, json: async () => ({}) }
      : { ok: true, json: async () => ({ groupName: "Climbers", members: ["Ana", " "] }) },
  );
  render(<JoinForm token="t" />);
  expect(await screen.findByRole("heading", { name: "Join Climbers" })).toBeTruthy();
  expect(screen.getByText(/Already in: Ana, Unnamed/).textContent).toMatch(/never shows a reason/);
  await submit("Ben");
  expect(loc.href).toBe("/");
});

it("explains a dead invite link", async () => {
  vi.stubGlobal("fetch", async () => ({ ok: false, status: 404 }));
  render(<JoinForm token="t" />);
  expect(await screen.findByText(/no longer valid/)).toBeTruthy();
});

it("offers an emailed sign-in link when the server can send email", async () => {
  const posts: { url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") posts.push({ url, body: JSON.parse(init.body as string) });
    return { ok: true, json: async () => ({ enabled: true }) };
  });
  render(<Landing />);
  fireEvent.change(await screen.findByLabelText("Your recovery email"), { target: { value: "ana@example.org" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Email me a sign-in link" })));
  expect(posts).toEqual([{ url: "/api/sign-in", body: { email: "ana@example.org" } }]);
  expect(screen.getByRole("status").textContent).toMatch(/on its way/);
});

it("signs in from an emailed link with a click, or says the link is spent", async () => {
  const loc = { href: "" };
  vi.stubGlobal("location", loc);
  let ok = false;
  vi.stubGlobal("fetch", async () => ({ ok, json: async () => (ok ? {} : { error: "This sign-in link is no longer valid" }) }));
  render(<SignInLink token="t" />);
  const button = screen.getByRole("button", { name: "Sign in on this device" });
  await act(async () => fireEvent.click(button));
  expect(screen.getByRole("alert").textContent).toMatch(/no longer valid/);
  ok = true;
  await act(async () => fireEvent.click(button));
  expect(loc.href).toBe("/");
});
