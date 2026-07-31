#!/bin/sh
set -e

#############################################
# Phase 3: PostgreSQL-backed entrypoint     #
# Simple startup: migrate then run.         #
# No SQLite backup/restore dance needed -   #
# PostgreSQL manages its own persistence.   #
#############################################

echo "╔════════════════════════════════════════════════════════════╗"
echo "║  SCIMServer - PostgreSQL Startup                           ║"
echo "╚════════════════════════════════════════════════════════════╝"

echo ""
echo "DATABASE_URL: ${DATABASE_URL:-(not set)}"
echo ""

if [ "$PERSISTENCE_BACKEND" = "inmemory" ]; then
    echo "⚡ PERSISTENCE_BACKEND=inmemory - skipping database migrations"
else
    echo "Running database migrations..."
    # Invoke the Prisma CLI DIRECTLY rather than through `npx`.
    #
    # `npx` is part of npm, and npm is no longer present in the runtime image:
    # its bundled dependencies (tar, undici, brace-expansion) accounted for 5 of
    # the 7 HIGH/CRITICAL findings blocking the Trivy gate, including the only
    # CRITICAL - none of them ours, and none fixable from our package.json.
    #
    # This is exactly equivalent, not a workaround: prisma's `bin` field is
    # {"prisma": "build/index.js"}, so `npx prisma` resolved to this same file.
    # The CLI is grafted into the runtime image by the prod-deps stage, and this
    # is the same invocation the standalone Windows launcher already uses.
    node node_modules/prisma/build/index.js migrate deploy

    if [ $? -eq 0 ]; then
        echo "✓ Migrations completed successfully"
    else
        echo "✗ Migrations failed"
        exit 1
    fi
fi

echo ""
echo "Starting application..."
echo ""

exec node dist/main.js
