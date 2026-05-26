# syntax=docker/dockerfile:1.7

# ─── Build stage ────────────────────────────────────────────────────────────
# This image is built with the repository root as the Docker context (not
# services/obsidian-mcp/) so the @niranjan/vault-shared workspace package
# is reachable. scripts/obsidian-mcp/deploy.sh handles the context dance.
#
# tsup (esbuild under the hood) inlines the workspace dependency into a
# single dist/main.js — the shared package is consumed at build time only,
# so the runtime image never sees its source.

FROM node:22-bookworm-slim AS build

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /workspace

# Copying the lockfile is required — without it, pnpm enters a
# fresh-resolve mode that (in pnpm 9, under `--filter`) doesn't reliably
# populate per-package node_modules with devDependencies. The build
# script (`tsup`) is a devDependency, so it would fail with
# MODULE_NOT_FOUND in stage 2.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY services/shared/package.json ./services/shared/
COPY services/obsidian-mcp/package.json ./services/obsidian-mcp/

RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter obsidian-mcp...

COPY services/shared ./services/shared
COPY services/obsidian-mcp ./services/obsidian-mcp

WORKDIR /workspace/services/obsidian-mcp
RUN pnpm run build

# Materialise a self-contained deployment directory at /deploy with a
# flat (hoisted) node_modules and workspace deps resolved into real
# folders. pnpm's default per-package node_modules is a tree of symlinks
# back into /workspace/node_modules/.pnpm — those links dangle the moment
# we `COPY` only the leaf package into the runtime stage, because the
# .pnpm store lives outside the copied tree. `pnpm deploy` is the
# supported way to flatten the workspace into a portable bundle.
WORKDIR /workspace
RUN pnpm --filter obsidian-mcp deploy --prod /deploy

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
# The bundle inlines @niranjan/vault-shared at build time, so its source
# is not present here.
COPY --from=build --chown=node:node /deploy/dist ./dist
COPY --from=build --chown=node:node /deploy/node_modules ./node_modules
COPY --from=build --chown=node:node /deploy/package.json ./package.json

USER node

EXPOSE 8080

CMD ["node", "dist/main.js"]
