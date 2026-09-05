#!/bin/sh
set -e

echo "[api-entrypoint] applying pending database migrations..."
node_modules/.bin/prisma migrate deploy

exec "$@"
