import { expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Google_Sans_Flex: () => ({ variable: "flex" }),
}));
const { default: RootLayout, metadata } = await import("./layout");
const { default: Home } = await import("./page");
const { GroupApp } = await import("@/components/GroupApp");

it("wraps pages in an English document carrying the font variable", () => {
  const html = RootLayout({ children: "page", params: Promise.resolve({}) });
  expect(html.type).toBe("html");
  expect(html.props.lang).toBe("en");
  expect(html.props.className).toContain("flex");
  expect(html.props.children.props.children).toBe("page");
  expect(metadata.title).toBe("Cafecito");
});

it("renders the group app as the home page", () => {
  expect(Home().type).toBe(GroupApp);
});
