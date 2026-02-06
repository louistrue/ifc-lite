#!/bin/bash
# Superset startup script for Railway

# Use PORT from Railway environment, fallback to 8088
export SUPERSET_WEBSERVER_PORT=${PORT:-8088}

# Initialize Superset (idempotent -- safe to run every boot)
echo "Running Superset database migrations..."
superset db upgrade

echo "Creating admin user (skipped if exists)..."
superset fab create-admin \
  --username "${ADMIN_USERNAME:-admin}" \
  --firstname "${ADMIN_FIRST_NAME:-Admin}" \
  --lastname "${ADMIN_LAST_NAME:-User}" \
  --email "${ADMIN_EMAIL:-admin@example.com}" \
  --password "${ADMIN_PASSWORD:-admin}" || true

echo "Initializing Superset roles and permissions..."
superset init || true

echo "Superset initialization complete"

# Start Superset web server
echo "Starting Superset on port ${SUPERSET_WEBSERVER_PORT}..."
exec superset run --host 0.0.0.0 --port ${SUPERSET_WEBSERVER_PORT} --with-threads --reload
