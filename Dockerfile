# One container, one service: Next.js handles the UI, the API routes and the Sarvam calls.
# (The old Python/EasyOCR service is no longer needed.)
#
# Build:  docker build -t pathwise .
# Run:    docker run -p 3000:3000 -e SARVAM_API_KEY=sk_... pathwise

# ── Stage 1: install deps ─────────────────────────────────────────────────────
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# ── Stage 2: build ────────────────────────────────────────────────────────────
FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Ensure public/ exists so the COPY below doesn't fail (A2a fix)
RUN mkdir -p public
RUN npm run build

# ── Stage 3: minimal runtime ──────────────────────────────────────────────────
FROM node:22-slim AS run
WORKDIR /app

# Run as non-root for security (item 4.4)
RUN groupadd --system pathwise && useradd --system --gid pathwise pathwise

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1

# Copy standalone server and static assets
COPY --from=build --chown=pathwise:pathwise /app/.next/standalone ./
COPY --from=build --chown=pathwise:pathwise /app/.next/static ./.next/static

# Copy public/ directory (favicon, any static assets) (item 4.4)
COPY --from=build --chown=pathwise:pathwise /app/public ./public

USER pathwise

EXPOSE 3000

# Health check using the /api/health endpoint (item 4.4)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
