# syntax=docker/dockerfile:1.7

# ─── transcription-service container ─────────────────────────────────────────
#
# A small Cloud Run service: accepts an audio artifact and returns a
# diarized transcript via a pluggable backend (Deepgram today). Shaped
# exactly like services/obsidian-mcp/Dockerfile — no model-fetch stage,
# no native bindings, because the v1 backend is a cloud API call.
#
# Built with the repository ROOT as the Docker context (not
# services/transcription-service/) so the @niranjan/vault-shared workspace
# package is reachable. scripts/transcription-service/deploy.sh sets it.

# ─── Build stage ────────────────────────────────────────────────────────────

FROM node:22-bookworm-slim AS build

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /workspace

# Copy lockfile + manifests first so install caches across source-only
# edits. The lockfile is required — without it pnpm 9 under `--filter`
# doesn't reliably populate per-package node_modules with devDependencies,
# so the subsequent `tsup` invocation fails with MODULE_NOT_FOUND.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY services/shared/package.json ./services/shared/
COPY services/transcription-service/package.json ./services/transcription-service/

RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter transcription-service...

COPY services/shared ./services/shared
COPY services/transcription-service ./services/transcription-service

WORKDIR /workspace/services/transcription-service
RUN pnpm run build

# Materialise a self-contained deployment directory at /deploy with a flat
# node_modules and workspace deps resolved into real folders (pnpm's
# default per-package node_modules is symlinks back into the .pnpm store,
# which dangle once we COPY only the leaf package into the runtime stage).
WORKDIR /workspace
RUN pnpm --filter transcription-service deploy --prod /deploy

# ─── Runtime stage ──────────────────────────────────────────────────────────

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=8080

WORKDIR /app

COPY --from=build --chown=node:node /deploy/dist ./dist
COPY --from=build --chown=node:node /deploy/node_modules ./node_modules
COPY --from=build --chown=node:node /deploy/package.json ./package.json

USER node

EXPOSE 8080

CMD ["node", "dist/main.js"]
