import { expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Google_Sans_Flex: () => ({ variable: "flex" }),
}));
const { default: RootLayout, metadata } = await import("./layout");
const { default: Home } = await import("./page");
const { GroupApp } = await import("@/components/GroupApp");
const { SkyClock } = await import("@/components/SkyClock");
const { SKY_SCRIPT } = await import("@/lib/sky");

it("wraps pages in an English document carrying the font variable, with the sky set before the first paint", () => {
  const html = RootLayout({ children: "page", params: Promise.resolve({}) });
  expect(html.type).toBe("html");
  expect(html.props.lang).toBe("en");
  expect(html.props.className).toContain("flex");
  const [head, body] = html.props.children;
  expect(head.props.children.props.dangerouslySetInnerHTML.__html).toBe(SKY_SCRIPT);
  expect(body.props.children[0].type).toBe(SkyClock);
  expect(body.props.children[1]).toBe("page");
  expect(metadata.title).toBe("Cafecito");
});

it("renders the group app as the home page", () => {
  expect(Home().type).toBe(GroupApp);
});
