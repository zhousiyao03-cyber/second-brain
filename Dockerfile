# ── Stage 1: Install dependencies ─────────────────────
FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@8.11.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ── Stage 2: Build ────────────────────────────────────
FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@8.11.0 --activate
WORKDIR /app
ARG NEXT_DEPLOYMENT_ID=local
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Default env for build (can be overridden at runtime)
ENV TURSO_DATABASE_URL=file:data/second-brain.db
ENV AUTH_SECRET=change-me-in-production
ENV NEXT_DEPLOYMENT_ID=$NEXT_DEPLOYMENT_ID

RUN mkdir -p data && pnpm db:push && pnpm build

# ── Stage 3: Production runner ────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Create data directory for SQLite
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
