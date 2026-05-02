# syntax=docker/dockerfile:1.7

# ─── Build stage ────────────────────────────────────────────────────────────
# Compile TypeScript to dist/ in a fat image, then drop everything except
# the build output and runtime dependencies into the runtime stage.

FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY tsconfig.json biome.json ./
COPY src ./src

RUN npm run build && npm prune --omit=dev

# ─── Runtime stage ──────────────────────────────────────────────────────────
# node:22-bookworm-slim ships with libc + a minimal toolchain. We do NOT
# use distroless here because we may need `node --inspect` style debugging
# in production; the marginal image-size cost is worth the debuggability.
#
# Drops to a non-root user for defence in depth. The `node` user already
# exists in the official image (uid 1000).

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=8080

WORKDIR /app

# Copy only what's needed at runtime — no .ts sources, no dev deps.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json

USER node

EXPOSE 8080

CMD ["node", "dist/main.js"]
