import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { openDb } from "./db";
import { createGroup, loadGroup, updateMe } from "./groups";

it("creates the database file's folder and keeps data across reopen", () => {
  const dir = mkdtempSync(join(tmpdir(), "cafecito-"));
  try {
    const file = join(dir, "nested", "cafecito.db");
    const first = openDb(file);
    const { groupId, memberId } = createGroup(first, { groupName: "G", name: "Zed" });
    updateMe(first, memberId, { name: "Kept" });
    first.close();

    const second = openDb(file);
    expect(loadGroup(second, groupId, memberId).members[0].name).toBe("Kept");
    expect(second.prepare(`SELECT count(*) n FROM "group"`).get()).toEqual({ n: 1 });
    expect(second.pragma("user_version", { simple: true })).toBe(3);
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
