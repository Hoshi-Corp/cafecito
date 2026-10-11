import { describe, expect, it } from "vitest";
import { EMPTY_PATTERN } from "./availability";
import { parseGroup } from "./store";

const member = { id: "a", name: "A", color: "#000", timeZone: "UTC", pattern: EMPTY_PATTERN, overrides: {} };
const group = { id: "g", name: "G", slotMinutes: 30, members: [member] };
const parse = (g: unknown) => parseGroup(JSON.stringify(g));

describe("parseGroup", () => {
  it("accepts a well-formed group", () => {
    expect(parse(group)).toEqual(group);
  });

  it("rejects data the UI cannot render, so the app falls back to the demo group", () => {
    expect(parseGroup(null)).toBeNull();
    expect(parseGroup("{not json")).toBeNull();
    expect(parse({ ...group, members: [] })).toBeNull();
    expect(parse({ ...group, members: [{}] })).toBeNull();
    expect(parse({ ...group, members: [{ ...member, pattern: "ff" }] })).toBeNull();
    expect(parse({ ...group, members: [{ ...member, name: undefined }] })).toBeNull();
    expect(parse({ ...group, members: [{ ...member, overrides: null }] })).toBeNull();
    expect(parse({ ...group, slotMinutes: 45 })).toBeNull();
  });
});
