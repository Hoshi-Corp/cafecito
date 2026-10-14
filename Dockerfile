# Multi-stage build: install and compile the Next.js app, then ship only the
# standalone server output (a minimal server.js plus the node_modules it traces)
# in a small image. Data lives in a SQLite file under /data: mount a volume there.
FROM node:26-alpine AS build
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Keep this pnpm version in step with "packageManager" in package.json (CI reads that one).
# better-sqlite3 ships prebuilt binaries; skipping its node-gyp install script avoids needing a compiler here.
RUN npm install -g pnpm@12.11.2 && pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm build

FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=4174 HOSTNAME=0.0.0.0 CAFECITO_DB=/data/cafecito.db
# Created and owned here so a fresh named volume is writable by the non-root user.
RUN mkdir /data && chown node /data
VOLUME /data
COPY --from=build /src/.next/standalone ./
COPY --from=build /src/.next/static ./.next/static
COPY --from=build /src/public ./public
USER node
EXPOSE 4174
CMD ["node", "server.js"]
