# Multi-stage build: install and compile the Next.js app, then ship only the
# standalone server output (a minimal server.js plus the node_modules it traces)
# in a small image. The demo keeps data in the browser, so the container is
# stateless until shared storage lands (see docs/ROADMAP.md, 0.3).
FROM node:24-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /src/.next/standalone ./
COPY --from=build /src/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
