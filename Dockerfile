# ── Stage 1: Install dependencies ─────────────────────
# node:22-slim (Debian glibc) is required because @huggingface/transformers
# pulls in onnxruntime-node, whose native .so is glibc-only — Alpine/musl
# would fail at runtime when the embeddings pipeline tries to load it.
FROM node:22-slim AS deps
RUN corepack enable && corepack prepare pnpm@8.11.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# onnxruntime-node ships the napi binding but downloads libonnxruntime.so.1
# in its postinstall script. BuildKit's cached deps layer can sometimes
# replay without re-running postinstall (observed on 2026-04-27: cached
# layer had only onnxruntime_binding.node but no .so, so dlopen failed at
# runtime). Force the install.js explicitly so we get a verifiable failure
# at build time if it ever breaks again.
RUN cd /app/node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node \
    && node script/install.js \
    && test -f bin/napi-v6/linux/x64/libonnxruntime.so.1 \
    && echo "libonnxruntime.so.1 confirmed"

# ── Stage 2: Build ────────────────────────────────────
FROM node:22-slim AS builder
RUN corepack enable && corepack prepare pnpm@8.11.0 --activate
WORKDIR /app
ARG NEXT_DEPLOYMENT_ID=local
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Default env for build (can be overridden at runtime)
ENV TURSO_DATABASE_URL=file:data/second-brain.db
ENV AUTH_SECRET=change-me-in-production
ENV NEXT_DEPLOYMENT_ID=$NEXT_DEPLOYMENT_ID

# Pre-download the embedding + reranker models so the first runtime
# request doesn't hang for ~30s downloading. Cache lands in /app/.hf-cache
# and is copied into the runner stage. HF_HOME makes the same path the
# lookup location at runtime too.
ENV HF_HOME=/app/.hf-cache
RUN mkdir -p /app/.hf-cache && \
    node -e "import('@huggingface/transformers').then(async m => { \
      await m.pipeline('feature-extraction', 'Xenova/multilingual-e5-small', { dtype: 'q8' }); \
      await m.pipeline('text-classification', 'Xenova/ms-marco-MiniLM-L-6-v2', { dtype: 'q8' }); \
      console.log('models cached'); \
    }).catch(e => { console.error(e); process.exit(1); })"

RUN mkdir -p data && pnpm db:push && pnpm build

# ── Stage 3: Production runner ────────────────────────
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV HF_HOME=/app/.hf-cache

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs

# Copy standalone output. `--chown` is required because Next.js writes the
# ISR/prerender cache back into `.next/server/app/` at runtime (e.g. the
# `sitemap.xml` body with `revalidate: 3600`). Without it the nextjs user
# inherits root ownership from the builder and hits EACCES on updates.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Pre-warmed HuggingFace model cache (~120MB) — avoids cold-start download.
COPY --from=builder --chown=nextjs:nodejs /app/.hf-cache /app/.hf-cache

# Pre-warmed transformers.js v4 internal cache. v4.x ignores HF_HOME and
# stashes models under the package's own .cache/ instead — so the COPY
# above is a no-op until upstream restores HF_HOME support. Until then,
# this is the actual cache path the runtime reads from.
COPY --from=builder --chown=nextjs:nodejs \
  /app/node_modules/.pnpm/@huggingface+transformers@4.0.1/node_modules/@huggingface/transformers/.cache \
  /app/node_modules/.pnpm/@huggingface+transformers@4.0.1/node_modules/@huggingface/transformers/.cache

# onnxruntime-node native lib (libonnxruntime.so.1). Next.js standalone
# tracing doesn't pick up the .so because it's loaded via dlopen at runtime
# from a path computed in JS, not via static require(). Bring the whole
# bin/ directory across to make the napi binding find its sibling lib.
COPY --from=deps --chown=nextjs:nodejs \
  /app/node_modules/.pnpm/onnxruntime-node@1.24.3/node_modules/onnxruntime-node/bin \
  /app/node_modules/.pnpm/onnxruntime-node@1.24.3/node_modules/onnxruntime-node/bin

# Create data directory for SQLite
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
