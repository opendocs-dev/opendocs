#!/bin/sh
set -e

# Fail loudly if DATABASE_URL is unset or empty; never print its contents for security
if [ -z "${DATABASE_URL}" ]; then
  echo "Error: DATABASE_URL environment variable is not set." >&2
  exit 1
fi

cd /app/apps/api

# Validate the whole env first, so a bad config fails with one readable list before migrating.
bun src/env-check.ts

echo "Deploying database migrations..."
bun run prisma:deploy

echo "Starting OpenDocs API..."
if [ "$#" -gt 0 ]; then
  exec "$@"
fi
exec bun src/index.ts
