import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { MIGRATIONS } from "./schema";
import { seed } from "./seed";

export type Db = Database.Database;

export function openDb(file: string): Db {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const applied = db.pragma("user_version", { simple: true }) as number;
  MIGRATIONS.slice(applied).forEach((sql, i) => {
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${applied + i + 1}`);
    })();
  });
  return db;
}

// Survives dev hot reloads, which re-evaluate this module.
const globalForDb = globalThis as unknown as { cafecitoDb?: Db };

export function getDb(): Db {
  if (!globalForDb.cafecitoDb) {
    const db = openDb(process.env.CAFECITO_DB ?? "data/cafecito.db");
    // Demo data is opt-in: it comes with sessions anyone can use (see seed.ts).
    if (process.env.CAFECITO_DEMO === "1" && !db.prepare(`SELECT 1 FROM "group" LIMIT 1`).get()) seed(db);
    globalForDb.cafecitoDb = db;
  }
  return globalForDb.cafecitoDb;
}
