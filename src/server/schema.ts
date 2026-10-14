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
  // 1.0.1: a personal link per member that signs in any device until it is replaced. Only its hash is stored.
  `
  ALTER TABLE member ADD COLUMN access_hash TEXT;
  CREATE UNIQUE INDEX member_access_hash ON member(access_hash);
  `,
  // 1.1: outings (a slot the group proposes to meet in) and each member's RSVP.
  `
  CREATE TABLE outing (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES "group"(id),
    title TEXT NOT NULL,
    place TEXT NOT NULL DEFAULT '',
    start_q INTEGER NOT NULL,
    end_q INTEGER NOT NULL CHECK (end_q > start_q),
    created_by TEXT REFERENCES member(id) ON DELETE SET NULL
  );
  CREATE INDEX outing_group ON outing(group_id, start_q);
  CREATE TABLE rsvp (
    outing_id TEXT NOT NULL REFERENCES outing(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES member(id) ON DELETE CASCADE,
    answer TEXT NOT NULL CHECK (answer IN ('y', 'm', 'n')),
    PRIMARY KEY (outing_id, member_id)
  ) WITHOUT ROWID;
  `,
  // 1.1: the group's café and restaurant wishlist, with who wants to go.
  `
  CREATE TABLE place (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES "group"(id),
    name TEXT NOT NULL,
    link TEXT NOT NULL DEFAULT '',
    map_link TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    suggested_by TEXT REFERENCES member(id) ON DELETE SET NULL,
    been_there INTEGER NOT NULL DEFAULT 0 CHECK (been_there IN (0, 1)),
    created_at INTEGER NOT NULL
  );
  CREATE INDEX place_group ON place(group_id);
  CREATE TABLE place_vote (
    place_id TEXT NOT NULL REFERENCES place(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES member(id) ON DELETE CASCADE,
    PRIMARY KEY (place_id, member_id)
  ) WITHOUT ROWID;
  `,
  // 1.1: star ratings and comments on wishlist places. They go with the member who wrote them.
  `
  CREATE TABLE place_rating (
    place_id TEXT NOT NULL REFERENCES place(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES member(id) ON DELETE CASCADE,
    stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
    PRIMARY KEY (place_id, member_id)
  ) WITHOUT ROWID;
  CREATE TABLE place_comment (
    id TEXT PRIMARY KEY,
    place_id TEXT NOT NULL REFERENCES place(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES member(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX place_comment_place ON place_comment(place_id);
  `,
  // 1.1: a plan can point at a wishlist place; its own `place` text stays if the place is deleted.
  `
  ALTER TABLE outing ADD COLUMN place_id TEXT REFERENCES place(id) ON DELETE SET NULL;
  `,
  // 1.1: a comment stays when its author leaves (shown as written by a deleted user). SQLite cannot relax a column in place,
  // so the table is rebuilt with every row copied.
  `
  CREATE TABLE place_comment_new (
    id TEXT PRIMARY KEY,
    place_id TEXT NOT NULL REFERENCES place(id) ON DELETE CASCADE,
    member_id TEXT REFERENCES member(id) ON DELETE SET NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  INSERT INTO place_comment_new SELECT id, place_id, member_id, body, created_at FROM place_comment;
  DROP TABLE place_comment;
  ALTER TABLE place_comment_new RENAME TO place_comment;
  CREATE INDEX place_comment_place ON place_comment(place_id);
  `,
];
