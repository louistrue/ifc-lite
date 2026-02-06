#!/bin/bash
# Complete Superset setup script
# Run this after Superset is running correctly (check: https://superset-production-9a66.up.railway.app shows Superset login)

set -e

SUPERSET_URL="${SUPERSET_URL:-https://superset-production-9a66.up.railway.app}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-change-me-strong-password}"

echo "=========================================="
echo "Superset Setup Script"
echo "=========================================="
echo ""

# Step 1: Verify Superset is running
echo "Step 1: Verifying Superset is accessible..."
if curl -s "$SUPERSET_URL" | grep -q "Superset\|Login\|login"; then
  echo "✅ Superset is running"
else
  echo "❌ Superset is not running. Please fix Railway dashboard configuration first."
  echo "   See: deploy/URGENT_FIX.md"
  exit 1
fi

# Step 2: Get DATABASE_URL from Railway
echo ""
echo "Step 2: Getting Postgres connection string..."
echo "Please run this command and paste the DATABASE_URL:"
echo "  railway variables --service Postgres | grep DATABASE_URL"
echo ""
read -p "Enter DATABASE_URL: " DATABASE_URL

if [ -z "$DATABASE_URL" ]; then
  echo "❌ DATABASE_URL is required"
  exit 1
fi

# Step 3: Add database connection via API
echo ""
echo "Step 3: Adding database connection to Superset..."
cd "$(dirname "$0")/superset"

LOGIN_RESPONSE=$(curl -s \
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
  echo "❌ Failed to login to Superset"
  echo "Response: $LOGIN_RESPONSE"
  exit 1
fi

echo "✅ Logged in to Superset"

# Check if database already exists
EXISTING_DB=$(curl -s \
  -X GET "$SUPERSET_URL/api/v1/database/?q=(order_column:database_name,order_direction:asc)" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | grep -o '"database_name":"BIM Data (PostgreSQL)"' || true)

if [ -n "$EXISTING_DB" ]; then
  echo "⚠️  Database connection already exists, skipping creation"
  DB_ID=$(curl -s \
    -X GET "$SUPERSET_URL/api/v1/database/?q=(order_column:database_name,order_direction:asc)" \
    -H "Authorization: Bearer $ACCESS_TOKEN" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)
else
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
    echo "❌ Failed to create database connection"
    echo "Response: $DB_RESPONSE"
    exit 1
  fi

  echo "✅ Database connection created"
fi

echo ""
echo "Database ID: $DB_ID"

# Step 4: Set SUPERSET_DATABASE_ID on server
echo ""
echo "Step 4: Setting SUPERSET_DATABASE_ID on ifc-lite-api..."
railway variables set SUPERSET_DATABASE_ID="$DB_ID" --service ifc-lite-api

if [ $? -eq 0 ]; then
  echo "✅ SUPERSET_DATABASE_ID set on server"
else
  echo "⚠️  Failed to set SUPERSET_DATABASE_ID via CLI"
  echo "   Please run manually:"
  echo "   railway variables set SUPERSET_DATABASE_ID=$DB_ID --service ifc-lite-api"
fi

# Step 5: Summary
echo ""
echo "=========================================="
echo "Setup Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Configure Vercel environment variables:"
echo "   - VITE_SERVER_URL=https://ifc-lite-api-production.up.railway.app"
echo "   - VITE_SUPERSET_URL=$SUPERSET_URL"
echo ""
echo "2. Change default Superset password:"
echo "   - Login to $SUPERSET_URL"
echo "   - Settings → Users → Edit admin"
echo "   - Update password"
echo "   - Run: railway variables set ADMIN_PASSWORD='<new>' SUPERSET_ADMIN_PASSWORD='<new>' --service superset"
echo "   - Run: railway variables set SUPERSET_ADMIN_PASSWORD='<new>' --service ifc-lite-api"
echo ""
echo "3. Test end-to-end:"
echo "   - Load IFC file in viewer"
echo "   - Click 'Send to Analytics'"
echo "   - View auto-generated dashboard"
echo ""
