# Multi-stage build: install and compile the Next.js app, then ship only the
# standalone server output (a minimal server.js plus the node_modules it traces)
# in a small image. Data lives in a SQLite file under /data: mount a volume there.
FROM node:25-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
# better-sqlite3 ships prebuilt binaries; skipping its node-gyp install script avoids needing a compiler here.
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:25-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=4174 HOSTNAME=0.0.0.0 CAFECITO_DB=/data/cafecito.db
# Created and owned here so a fresh named volume is writable by the non-root user.
RUN mkdir /data && chown node /data
VOLUME /data
COPY --from=build /src/.next/standalone ./
COPY --from=build /src/.next/static ./.next/static
USER node
EXPOSE 4174
CMD ["node", "server.js"]
