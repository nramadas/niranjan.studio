# syntax=docker/dockerfile:1.7

# ─── vault-indexer container ───────────────────────────────────────────────
#
# Built with the repository ROOT as the Docker context (not
# services/vault-indexer/) so the @niranjan/vault-shared workspace package
# is reachable. scripts/vault-indexer/deploy.sh sets the context.
#
# Three stages:
#   1. model-fetch — pulls the bge-small ONNX + tokeniser files from
#      Hugging Face once. Cached separately from app code so iterating
#      on TypeScript does not re-download weights.
#   2. build       — pnpm install (workspace-aware) + tsup build.
#   3. runtime     — slim Node 22 image with the bundled JS, the pruned
#      node_modules (better-sqlite3 native binding, onnxruntime-node
#      binding, sqlite-vec platform package), and the model files at
#      /opt/vault-indexer/model.

# ─── Stage 1: model-fetch ───────────────────────────────────────────────────

FROM node:22-bookworm-slim AS model-fetch

WORKDIR /tmp/model-fetch

# Tiny throwaway package.json so npm doesn't complain.
RUN echo '{"type":"module","name":"model-fetch"}' > package.json

# Pull a minimal install of transformers + onnxruntime-node so we can
# trigger the model download.
RUN npm install --no-save --no-fund --no-audit \
      @huggingface/transformers@4.2.0 \
      onnxruntime-node@1.24.3

# Run the pipeline once with the cache pointed at /opt/vault-indexer/model.
# The first call downloads ONNX + tokenizer + special_tokens_map; subsequent
# calls would be offline. We exit immediately after the download completes.
RUN mkdir -p /opt/vault-indexer/model && \
    node --input-type=module -e " \
      import { pipeline, env } from '@huggingface/transformers'; \
      env.cacheDir = '/opt/vault-indexer/model'; \
      env.localModelPath = '/opt/vault-indexer/model'; \
      env.allowRemoteModels = true; \
      console.log('downloading bge-small-en-v1.5 quantized ONNX...'); \
      await pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5', { quantized: true }); \
      console.log('done'); \
    "

# ─── Stage 2: build ─────────────────────────────────────────────────────────

FROM node:22-bookworm-slim AS build

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /workspace

# Copy lockfile + manifests first so install caches across source-only
# edits. Copying the lockfile is required — without it, pnpm enters a
# fresh-resolve mode that (in pnpm 9, under `--filter`) doesn't reliably
# populate per-package node_modules with devDependencies, so the
# subsequent `tsup` invocation fails with MODULE_NOT_FOUND.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY services/shared/package.json ./services/shared/
COPY services/vault-indexer/package.json ./services/vault-indexer/

RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter vault-indexer...

# Bring in the source trees.
COPY services/shared ./services/shared
COPY services/vault-indexer ./services/vault-indexer

WORKDIR /workspace/services/vault-indexer

RUN pnpm run build

# Materialise a self-contained deployment directory at /deploy with a
# flat (hoisted) node_modules and workspace deps resolved into real
# folders. pnpm's default per-package node_modules is a tree of symlinks
# back into /workspace/node_modules/.pnpm — those links dangle the moment
# we `COPY` only the leaf package into the runtime stage, because the
# .pnpm store lives outside the copied tree. `pnpm deploy` is the
# supported way to flatten the workspace into a portable bundle.
WORKDIR /workspace
RUN pnpm --filter vault-indexer deploy --prod /deploy

# ─── Stage 3: runtime ──────────────────────────────────────────────────────

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=8081

# Create the runtime user / dirs. The `node` user already exists in the
# official image (uid 1000); we just chown the paths we use.
RUN mkdir -p /app /opt/vault-indexer/model /var/lib/vault-indexer && \
    chown -R node:node /app /opt/vault-indexer /var/lib/vault-indexer

WORKDIR /app

COPY --from=build --chown=node:node /deploy/dist ./dist
COPY --from=build --chown=node:node /deploy/node_modules ./node_modules
COPY --from=build --chown=node:node /deploy/package.json ./package.json
# schema.sql is read at runtime via `import.meta.url`. The bundled
# dist/main.js resolves the relative path to /app/schema.sql, so we
# stage the file alongside dist/ rather than inside it. If we add more
# static SQL/JSON/etc. assets, the cleaner fix is to declare a `files`
# field in package.json and let pnpm deploy stage them — for now, one
# explicit copy keeps the change minimal.
COPY --from=build --chown=node:node /workspace/services/vault-indexer/src/store/schema.sql ./schema.sql
COPY --from=model-fetch --chown=node:node /opt/vault-indexer/model /opt/vault-indexer/model

USER node

EXPOSE 8081
VOLUME ["/var/lib/vault-indexer"]

CMD ["node", "dist/main.js"]
