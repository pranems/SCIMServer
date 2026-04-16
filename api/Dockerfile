###########
# Multi-stage build for SCIMServer API
# Stage 1: Full build (devDeps + compile)
# Stage 2: Prod deps only (stripped)
# Stage 3: Minimal runtime
###########

# ── Stage 1: Build ──────────────────────────────────────────────────
FROM node:24-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
COPY public/ ./public
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
RUN npx prisma generate
RUN npm run build

# ── Stage 2: Production dependencies only ───────────────────────────
FROM node:24-alpine AS prod-deps
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
# Graft prisma CLI + engines from full build (needed for migrate deploy)
COPY --from=build /app/node_modules/prisma ./node_modules/prisma
COPY --from=build /app/node_modules/@prisma/engines ./node_modules/@prisma/engines
COPY --from=build /app/node_modules/@prisma/engines-version ./node_modules/@prisma/engines-version
# Clean non-essential files
RUN find ./node_modules -name "*.md" -delete 2>/dev/null || true && \
    find ./node_modules -name "*.map" -delete 2>/dev/null || true && \
    find ./node_modules/@prisma/client/runtime -name "*.cockroachdb.*" -delete 2>/dev/null || true && \
    find ./node_modules/@prisma/client/runtime -name "*.mysql.*" -delete 2>/dev/null || true && \
    find ./node_modules/@prisma/client/runtime -name "*.sqlite.*" -delete 2>/dev/null || true && \
    find ./node_modules/@prisma/client/runtime -name "*.sqlserver.*" -delete 2>/dev/null || true && \
    rm -rf ./node_modules/typescript ./node_modules/@types 2>/dev/null || true

# ── Stage 3: Minimal runtime ────────────────────────────────────────
FROM node:24-alpine AS runtime
RUN apk add --no-cache openssl && \
    addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001
WORKDIR /app
# Create writable directories BEFORE switching user
RUN mkdir -p /app/local-data /app/logs && chown nestjs:nodejs /app/local-data /app/logs

# Production environment — match root Dockerfile settings
ENV NODE_ENV=production \
    PORT=8080 \
    NODE_OPTIONS="--max_old_space_size=384"

# Copy with --chown (sets ownership at copy time, avoids duplicating layers)
COPY --from=prod-deps --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nestjs:nodejs /app/dist ./dist
COPY --from=build --chown=nestjs:nodejs /app/package.json ./package.json
COPY --from=build --chown=nestjs:nodejs /app/prisma ./prisma
COPY --from=build --chown=nestjs:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=nestjs:nodejs /app/public ./public
COPY --chown=nestjs:nodejs docker-entrypoint.sh ./

USER nestjs
EXPOSE 8080
CMD ["/app/docker-entrypoint.sh"]
