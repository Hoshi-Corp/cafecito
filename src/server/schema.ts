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
  // 0.4: sessions and invite links. Only SHA-256 hashes of tokens are stored.
  `
  CREATE TABLE session (
    token_hash TEXT PRIMARY KEY,
    member_id TEXT NOT NULL REFERENCES member(id) ON DELETE CASCADE
  ) WITHOUT ROWID;
  CREATE TABLE invite (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    group_id TEXT NOT NULL REFERENCES "group"(id),
    expires_at INTEGER NOT NULL,
    max_uses INTEGER,
    uses INTEGER NOT NULL DEFAULT 0,
    revoked_at INTEGER
  );
  `,
  // 1.0: overrides as non-overlapping [start_q, end_q) ranges, built from runs of equal marks in the per-quantum rows;
  // session devices and idle expiry; optional recovery email and one-time sign-in links.
  `
  CREATE TABLE override_range (
    member_id TEXT NOT NULL REFERENCES member(id) ON DELETE CASCADE,
    start_q INTEGER NOT NULL,
    end_q INTEGER NOT NULL CHECK (end_q > start_q),
    mark TEXT NOT NULL CHECK (mark IN ('f', 'm', 'b')),
    PRIMARY KEY (member_id, start_q)
  ) WITHOUT ROWID;
  INSERT INTO override_range
    SELECT member_id, MIN(q), MAX(q) + 1, mark
    FROM (SELECT member_id, q, mark, q - ROW_NUMBER() OVER (PARTITION BY member_id, mark ORDER BY q) run FROM override)
    GROUP BY member_id, mark, run;
  DROP TABLE override;
  ALTER TABLE override_range RENAME TO override;

  ALTER TABLE session ADD COLUMN device TEXT NOT NULL DEFAULT '';
  ALTER TABLE session ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE session ADD COLUMN last_seen INTEGER NOT NULL DEFAULT 0;
  UPDATE session SET created_at = unixepoch() * 1000, last_seen = unixepoch() * 1000;

  ALTER TABLE member ADD COLUMN email TEXT;
  CREATE TABLE sign_in_link (
    token_hash TEXT PRIMARY KEY,
    member_id TEXT NOT NULL REFERENCES member(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  ) WITHOUT ROWID;
  `,
];
