# Cafecito

[![CI](https://github.com/Hoshi-Corp/cafecito/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Hoshi-Corp/cafecito/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Hoshi-Corp/cafecito)](https://github.com/Hoshi-Corp/cafecito/releases/latest)
![Coverage gate: 85% minimum](https://img.shields.io/badge/coverage-%E2%89%A585%25-brightgreen)
![Node 26](https://img.shields.io/badge/node-26-339933?logo=node.js&logoColor=white)

A shared availability calendar for a group of friends: everyone marks when they are free, and the group view overlays it into a heatmap.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:4174. `npm test` runs the tests; `npm test -- --coverage` also enforces the 85% coverage threshold CI requires.

## Status

Release 0.3: one shared demo group stored in SQLite (`data/cafecito.db`, or `CAFECITO_DB`), written per member through an API. There are no accounts yet: the server signs each browser in as a member through a cookie, and Settings → *Act as* switches member, so anyone can act as anyone. Invite links and real sessions come in 0.4.

## How availability works

- Availability is stored in 15-minute quanta, so the group's slot size (15 min, 30 min or 1 h) only changes how the grid is drawn and painted.
- Each member has a **typical week** in their own wall-clock time, plus date-specific **overrides** stored as UTC instants.
- Each viewer sees the calendar in their own time zone. A slot counts as free for a member only if they are free for all of it.

The logic lives in `src/lib/availability.ts`.

## Data and backups

The database is created and migrated on first start (`src/server/schema.ts`) and seeded with the demo group. In Docker it lives in the `cafecito-data` volume, mounted at `/data`. Back it up with SQLite's online backup, which is safe while the app runs:

```bash
docker run --rm -v cafecito-data:/data -v "$PWD":/backup alpine \
  sh -c "apk add -q sqlite && sqlite3 /data/cafecito.db \".backup /backup/cafecito.db\""
```

To restore, stop the container, replace the database in the volume (dropping the `-wal` and `-shm` files beside it, and handing the file to the `node` user, uid 1000), then start it again:

```bash
docker compose down
docker run --rm -v cafecito-data:/data -v "$PWD":/backup alpine sh -c \
  "rm -f /data/cafecito.db-wal /data/cafecito.db-shm && cp /backup/cafecito.db /data/cafecito.db && chown 1000:1000 /data/cafecito.db"
docker compose up -d
```

Backup and restore were tested once against the built image: a change made after the backup was gone after the restore.

## CI, releases and Docker

Same strategy as [Jocasta](https://github.com/masaruhoshi/jocasta): one shared test workflow, a CI check on every change, and a manual release that publishes the image.

- **`test.yml`** (reusable): `npm ci`, lint, type-check, `npm test -- --coverage` (fails under 85% coverage). Called by `ci.yml` and `publish.yml`.
- **`ci.yml`**: on every push and pull request to `main`, runs the tests, builds the Docker image without pushing it, and validates `docker-compose.yml`.
- **`publish.yml`**: run by hand from `main` (*Actions → Release → Run workflow*; other branches are skipped) with a bump of `patch`, `minor`, `major` or `none`. It re-runs the tests, refuses to publish if `main` moved since dispatch, pushes `ghcr.io/hoshi-corp/cafecito:latest` (and `:<version>` for a bump), and only then commits the new `VERSION` to `main`, tags `v<version>` and creates the GitHub release. A failed image build leaves no bump, tag or release behind. `none` refreshes `:latest` only. The bump is pushed with a write deploy key (secret `RELEASE_DEPLOY_KEY`) on the `main` ruleset's bypass list, since `main` otherwise only accepts pull requests.
- **Dependabot** checks GitHub Actions, the Dockerfile base images and npm packages weekly.

The `Dockerfile` builds the app and ships only Next.js's standalone server output in a `node:26-alpine` image (non-root, port 4174):

```bash
docker build -t cafecito .
docker run --rm -p 4174:4174 cafecito
# or, with the published image:
docker compose up -d
```

`docker-compose.yml` binds to `127.0.0.1` so a reverse proxy on the host is the public front door. New GHCR packages start private: after the first release, check the package's visibility under the repo's **Packages** tab. `VERSION` is the single source of truth for releases; the version in `package.json` is not bumped.

## Docs

- [Architecture](docs/ARCHITECTURE.md): concepts, rules, data model, target design.
- [Roadmap](docs/ROADMAP.md): releases 0.2 to 1.0 and possible future releases.
