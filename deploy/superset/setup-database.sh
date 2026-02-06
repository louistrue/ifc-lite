#!/bin/bash
# Script to add BIM data database connection to Superset via API
# Run this after Superset is deployed and admin user is created

set -e

SUPERSET_URL="${SUPERSET_URL:-https://superset-production-9a66.up.railway.app}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-change-me-strong-password}"
DATABASE_URL="${DATABASE_URL:-${{Postgres.DATABASE_URL}}}"

echo "Setting up Superset database connection..."
echo "Superset URL: $SUPERSET_URL"

# Login to get CSRF token and session
echo "Logging in..."
LOGIN_RESPONSE=$(curl -s -c /tmp/superset_cookies.txt \
  -X POST "$SUPERSET_URL/api/v1/security/login" \
  -H "Content-Type: application/json" \
  -d "{
    \"username\": \"$ADMIN_USERNAME\",
    \"password\": \"$ADMIN_PASSWORD\",
    \"provider\": \"db\",
    \"refresh\": true
  }")

ACCESS_TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)

if [ -z "$ACCESS_TOKEN" ]; then
  echo "Failed to login. Response: $LOGIN_RESPONSE"
  exit 1
fi

echo "Login successful"

# Add database connection
echo "Adding database connection..."
DB_RESPONSE=$(curl -s \
  -X POST "$SUPERSET_URL/api/v1/database/" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"database_name\": \"BIM Data (PostgreSQL)\",
    \"sqlalchemy_uri\": \"$DATABASE_URL\",
    \"cache_timeout\": null,
    \"expose_in_sqllab\": true,
    \"allow_ctas\": true,
    \"allow_cvas\": true,
    \"allow_dml\": true,
    \"allow_run_async\": false,
    \"configuration_method\": \"sqlalchemy_form\",
    \"engine\": \"postgresql\",
    \"extra\": {
      \"schemas_allowed_for_csv_upload\": [\"bim_data\"]
    }
  }")

DB_ID=$(echo "$DB_RESPONSE" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)

if [ -z "$DB_ID" ]; then
  echo "Failed to create database connection. Response: $DB_RESPONSE"
  exit 1
fi

echo "Database connection created with ID: $DB_ID"
echo ""
echo "Set this on your ifc-lite-api service:"
echo "railway variables set SUPERSET_DATABASE_ID=$DB_ID --service ifc-lite-api"
