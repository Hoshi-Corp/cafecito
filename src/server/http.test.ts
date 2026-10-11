import { expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {} }) }));
const { json } = await import("./http");

const req = (type: string | null) =>
  new Request("http://x/", { method: "POST", body: '{"a":1}', headers: type ? { "content-type": type } : {} });

it("accepts only JSON bodies, so a cross-site text/plain form is refused", async () => {
  expect(await json(req("application/json"))).toEqual({ a: 1 });
  await expect(json(req("text/plain"))).rejects.toMatchObject({ status: 415 });
  await expect(json(req(null))).rejects.toMatchObject({ status: 415 });
});
