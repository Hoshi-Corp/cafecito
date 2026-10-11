// Migrations run in order; `PRAGMA user_version` records how many have been applied.
// Append only: never edit a migration that has shipped.
export const MIGRATIONS = [
  `
  CREATE TABLE "group" (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slot_minutes INTEGER NOT NULL CHECK (slot_minutes IN (15, 30, 60))
  );
  CREATE TABLE member (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES "group"(id),
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    time_zone TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
    pattern TEXT NOT NULL,
    position INTEGER NOT NULL
  );
  CREATE TABLE override (
    member_id TEXT NOT NULL REFERENCES member(id) ON DELETE CASCADE,
    q INTEGER NOT NULL,
    mark TEXT NOT NULL CHECK (mark IN ('f', 'm', 'b')),
    PRIMARY KEY (member_id, q)
  ) WITHOUT ROWID;
  `,
];
