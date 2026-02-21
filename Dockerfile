#############################
# Optimized multi-stage build for SCIMServer
# Phase 3: PostgreSQL-backed (no more SQLite / better-sqlite3)
#
# Stages:
#   1. web-build   — React/Vite frontend → static dist/
#   2. api-build   — NestJS compile, Prisma generate (full devDeps)
#   3. prod-deps   — Production node_modules + prisma CLI only
#   4. runtime     — Minimal Alpine with compiled output
#############################

#############################
# Stage 1: Build web frontend (React + Vite)
#############################
FROM node:24-alpine AS web-build
WORKDIR /web
COPY web/package*.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build && rm -rf node_modules

#############################
# Stage 2: Build API (NestJS + Prisma generate)
#############################
FROM node:24-alpine AS api-build
WORKDIR /app
RUN apk add --no-cache openssl
COPY api/package*.json ./
RUN npm ci --no-audit --no-fund
COPY api/ ./
COPY --from=web-build /web/dist ./public

# Generate Prisma 7 client (→ src/generated/prisma), compile TS
# Phase 3: No db push needed — migrations run at container startup against PostgreSQL
RUN npx prisma generate && \
    npx tsc -p tsconfig.build.json

#############################
# Stage 3: Production-only dependencies
# - npm ci --omit=dev strips typescript, eslint, jest, prettier, etc.
# - prisma CLI (devDep) is needed for `prisma migrate deploy` at container
#   startup, so we copy it from the full-install stage instead of reinstalling
#   (which would pull 100+ MB of transitive deps back in).
#############################
FROM node:24-alpine AS prod-deps
WORKDIR /app
RUN apk add --no-cache openssl
COPY api/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && \
    npm cache clean --force

# Graft prisma CLI + engines from the full build (avoids npm install pulling transitive deps)
COPY --from=api-build /app/node_modules/prisma ./node_modules/prisma
COPY --from=api-build /app/node_modules/@prisma/engines ./node_modules/@prisma/engines
COPY --from=api-build /app/node_modules/@prisma/engines-version ./node_modules/@prisma/engines-version

# Clean up non-essential files inside node_modules
RUN find ./node_modules -name "*.md" -delete 2>/dev/null || true && \
    find ./node_modules -name "*.map" -delete 2>/dev/null || true && \
    find ./node_modules -path "*/effect" -prune -o -name "test*" -type d -exec rm -rf {} + 2>/dev/null || true && \
    # Phase 3: Keep PostgreSQL WASM query compiler, remove others — saves ~56 MB
    find ./node_modules/@prisma/client/runtime -name "*.cockroachdb.*" -delete 2>/dev/null || true && \
    find ./node_modules/@prisma/client/runtime -name "*.mysql.*" -delete 2>/dev/null || true && \
    find ./node_modules/@prisma/client/runtime -name "*.sqlite.*" -delete 2>/dev/null || true && \
    find ./node_modules/@prisma/client/runtime -name "*.sqlserver.*" -delete 2>/dev/null || true && \
    # Remove packages not needed at runtime — saves ~50 MB
    rm -rf ./node_modules/typescript 2>/dev/null || true && \
    rm -rf ./node_modules/@types 2>/dev/null || true && \
    rm -rf ./node_modules/@prisma/studio-core/dist/ui 2>/dev/null || true && \
    rm -rf ./node_modules/@prisma/client/generator-build 2>/dev/null || true

#############################
# Stage 4: Minimal runtime
#############################
FROM node:24-alpine AS runtime
WORKDIR /app

# Install runtime essentials and create non-root user in single layer
RUN apk add --no-cache openssl && \
    rm -rf /var/cache/apk/* && \
    addgroup -g 1001 -S nodejs && \
    adduser -S scim -u 1001

# Production environment — Phase 3: PostgreSQL connection via DATABASE_URL env var
ENV NODE_ENV=production \
    PORT=8080 \
    NODE_OPTIONS="--max_old_space_size=384"

# Create data directory for volume mount
RUN mkdir -p /app/data && chown scim:nodejs /app/data

# Copy production node_modules (prod deps + prisma CLI for migrate deploy)
COPY --from=prod-deps --chown=scim:nodejs /app/node_modules ./node_modules

# Copy compiled application
COPY --from=api-build --chown=scim:nodejs /app/dist ./dist
COPY --from=api-build --chown=scim:nodejs /app/public ./public
COPY --from=api-build --chown=scim:nodejs /app/prisma ./prisma
COPY --from=api-build --chown=scim:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --from=api-build --chown=scim:nodejs /app/package.json ./package.json

# Write image tag to file at build time
ARG IMAGE_TAG=unknown
RUN echo "${IMAGE_TAG}" > /app/.image-tag

# Copy entrypoint script
COPY --chown=scim:nodejs api/docker-entrypoint.sh /app/
RUN chmod +x /app/docker-entrypoint.sh

USER scim
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
    CMD node -e "require('http').get('http://127.0.0.1:8080/',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

CMD ["/app/docker-entrypoint.sh"]