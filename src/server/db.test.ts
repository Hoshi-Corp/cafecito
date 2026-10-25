import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { openDb } from "./db";
import { createGroup, loadGroup, updateMe } from "./groups";
import { MIGRATIONS } from "./schema";

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
    expect(second.pragma("user_version", { simple: true })).toBe(MIGRATIONS.length);
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("upgrades a database from before the wishlist: only new tables appear, every row stays", () => {
  const dir = mkdtempSync(join(tmpdir(), "cafecito-"));
  try {
    const file = join(dir, "old.db");
    const old = new Database(file);
    old.pragma("foreign_keys = ON");
    MIGRATIONS.slice(0, 5).forEach((sql) => old.exec(sql));
    old.pragma("user_version = 5");
    old.exec(`INSERT INTO "group" VALUES ('g', 'G', 30);
      INSERT INTO member (id, group_id, name, color, time_zone, role, pattern, position) VALUES ('a', 'g', 'Ana', '#000000', 'UTC', 'owner', '', 0);
      INSERT INTO outing (id, group_id, title, start_q, end_q, created_by) VALUES ('o', 'g', 'Brunch', 10, 14, 'a');
      INSERT INTO rsvp VALUES ('o', 'a', 'y');`);
    old.close();

    const db = openDb(file);
    expect(db.pragma("user_version", { simple: true })).toBe(MIGRATIONS.length);
    expect(db.prepare(`SELECT (SELECT count(*) FROM "group") g, (SELECT count(*) FROM member) m, (SELECT count(*) FROM outing) o, (SELECT count(*) FROM rsvp) r`).get()).toEqual({ g: 1, m: 1, o: 1, r: 1 });
    expect(db.prepare(`SELECT (SELECT count(*) FROM place) p, (SELECT count(*) FROM place_vote) v`).get()).toEqual({ p: 0, v: 0 });
    db.close();
    expect(openDb(file).pragma("user_version", { simple: true })).toBe(MIGRATIONS.length); // opening again runs nothing
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("upgrades comments to survive their author leaving: every comment is copied, the author link can now be cleared", () => {
  const dir = mkdtempSync(join(tmpdir(), "cafecito-"));
  try {
    const file = join(dir, "old.db");
    const old = new Database(file);
    old.pragma("foreign_keys = ON");
    MIGRATIONS.slice(0, 8).forEach((sql) => old.exec(sql));
    old.pragma("user_version = 8");
    old.exec(`INSERT INTO "group" VALUES ('g', 'G', 30);
      INSERT INTO member (id, group_id, name, color, time_zone, role, pattern, position) VALUES ('a', 'g', 'Ana', '#000000', 'UTC', 'owner', '', 0), ('b', 'g', 'Ben', '#000000', 'UTC', 'member', '', 1);
      INSERT INTO place (id, group_id, name, created_at) VALUES ('p', 'g', 'Café', 1);
      INSERT INTO place_comment VALUES ('c1', 'p', 'a', 'one', 1), ('c2', 'p', 'b', 'two', 2);`);
    old.close();

    const db = openDb(file);
    expect(db.pragma("user_version", { simple: true })).toBe(MIGRATIONS.length);
    db.prepare(`DELETE FROM member WHERE id = 'b'`).run();
    expect(db.prepare(`SELECT id, member_id memberId, body FROM place_comment ORDER BY id`).all()).toEqual([
      { id: "c1", memberId: "a", body: "one" },
      { id: "c2", memberId: null, body: "two" },
    ]);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("upgrades ratings to half stars: every rating is copied, halves are now allowed, and anything else is still refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "cafecito-"));
  try {
    const file = join(dir, "old.db");
    const old = new Database(file);
    old.pragma("foreign_keys = ON");
    const before = MIGRATIONS.length - 1;
    MIGRATIONS.slice(0, before).forEach((sql) => old.exec(sql));
    old.pragma(`user_version = ${before}`);
    old.exec(`INSERT INTO "group" VALUES ('g', 'G', 30);
      INSERT INTO member (id, group_id, name, color, time_zone, role, pattern, position) VALUES ('a', 'g', 'Ana', '#000000', 'UTC', 'owner', '', 0), ('b', 'g', 'Ben', '#000000', 'UTC', 'member', '', 1);
      INSERT INTO place (id, group_id, name, created_at) VALUES ('p', 'g', 'Café', 1);
      INSERT INTO place_rating VALUES ('p', 'a', 4), ('p', 'b', 1);`);
    old.close();

    const db = openDb(file);
    expect(db.pragma("user_version", { simple: true })).toBe(MIGRATIONS.length);
    expect(db.prepare(`SELECT member_id memberId, stars FROM place_rating ORDER BY member_id`).all()).toEqual([
      { memberId: "a", stars: 4 },
      { memberId: "b", stars: 1 },
    ]);
    db.prepare(`UPDATE place_rating SET stars = 2.5 WHERE member_id = 'a'`).run();
    for (const stars of [0, 0.25, 5.5]) expect(() => db.prepare(`UPDATE place_rating SET stars = ? WHERE member_id = 'b'`).run(stars)).toThrow(/CHECK/);
    db.prepare(`DELETE FROM place WHERE id = 'p'`).run(); // the ratings still go with their place
    expect(db.prepare(`SELECT count(*) n FROM place_rating`).get()).toEqual({ n: 0 });
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
