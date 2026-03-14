#!/bin/sh
set -e

#############################################
# Phase 3: PostgreSQL-backed entrypoint     #
# Simple startup: migrate then run.         #
# No SQLite backup/restore dance needed —   #
# PostgreSQL manages its own persistence.   #
#############################################

echo "╔════════════════════════════════════════════════════════════╗"
echo "║  SCIMServer — PostgreSQL Startup                           ║"
echo "╚════════════════════════════════════════════════════════════╝"

echo ""
echo "DATABASE_URL: ${DATABASE_URL:-(not set)}"
echo ""

if [ "$PERSISTENCE_BACKEND" = "inmemory" ]; then
    echo "⚡ PERSISTENCE_BACKEND=inmemory — skipping database migrations"
else
    echo "Running database migrations..."
    npx prisma migrate deploy

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
