###########
# Multi-stage build for SCIMServer API (fixes local-data permission issue)
###########

# Builder stage: install deps, generate Prisma, compile TS
FROM node:24-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
COPY public/ ./public
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
RUN npx prisma generate
RUN npm run build

# Runtime stage: only production deps + dist + entrypoint
FROM node:24-alpine AS runtime
RUN apk add --no-cache openssl
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/public ./public
COPY docker-entrypoint.sh ./

# Create non-root user and ensure writable local-data directory exists before dropping privileges
RUN addgroup -g 1001 -S nodejs \
	&& adduser -S nestjs -u 1001 \
	&& mkdir -p /app/local-data \
	&& chown -R nestjs:nodejs /app/local-data /app

USER nestjs
EXPOSE 8080
CMD ["/app/docker-entrypoint.sh"]
