# Superset Deployment Guide for Railway

## Quick Start

### Option 1: Use Railway Superset Template (Recommended)

1. Go to Railway Dashboard: https://railway.app/dashboard
2. Select your project: `ifc-lite-server`
3. Click "+ Create" → "Template"
4. Search for "Apache Superset" (template ID: S7TBaH)
5. Deploy it to your project

### Option 2: Custom Dockerfile Deployment

1. In Railway Dashboard, click "+ Create" → "Empty Service"
2. Name it "superset"
3. Connect it to this repository
4. Set the root directory to `deploy/superset`
5. Railway will automatically detect the Dockerfile

## Required Environment Variables

Set these in Railway Dashboard for the Superset service:

### Database Connection
```
SQLALCHEMY_DATABASE_URI=${{Postgres.DATABASE_URL}}
```

### Admin Credentials
```
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<strong-password>
ADMIN_EMAIL=admin@example.com
ADMIN_FIRST_NAME=Admin
ADMIN_LAST_NAME=User
```

### Security
```
SECRET_KEY=<generate-strong-random-string>
GUEST_TOKEN_JWT_SECRET=<generate-strong-random-string>
```

Generate secrets:
```bash
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

### Port Configuration
```
SUPERSET_WEBSERVER_PORT=8088
PORT=8088
```

### CORS (for viewer embedding)
```
CORS_ORIGIN_VIEWER=https://ifc-lite.vercel.app
```

### Redis (Optional but Recommended)

If you add Redis:
1. Add Redis service: "+ Create" → "Database" → "Redis"
2. Set on Superset:
```
REDIS_HOST=${{Redis.REDIS_HOST}}
REDIS_PORT=${{Redis.REDIS_PORT}}
REDIS_PASSWORD=${{Redis.REDIS_PASSWORD}}
```

## Post-Deployment Setup

1. **Wait for Superset to start** (first boot takes 2-3 minutes)
2. **Access Superset**: Get the public domain from Railway dashboard
3. **Login** with admin credentials
4. **Add Database Connection**:
   - Go to Settings → Database Connections → "+ Database"
   - Select "PostgreSQL"
   - Connection string: Use the same `${{Postgres.DATABASE_URL}}`
   - Test connection
   - **Important**: In "Advanced" → "SQL Lab Settings", set:
     - Schema: `bim_data`
   - Save

5. **Get Database ID**:
   - After saving, note the database ID from the URL or API
   - You'll need this for `SUPERSET_DATABASE_ID` on the Rust server

## Verify Configuration

Check that embedded dashboards work:
1. Create a test dashboard
2. Get a guest token (via API or Superset UI)
3. Try embedding: `https://<superset-domain>/superset/dashboard/<id>/?standalone=3&guest_token=<token>`

## Troubleshooting

- **Superset won't start**: Check logs for database connection errors
- **CORS errors**: Verify `CORS_ORIGIN_VIEWER` matches your viewer domain exactly
- **Guest tokens fail**: Ensure `GUEST_TOKEN_JWT_SECRET` is set and matches
- **WASM errors**: Check CSP headers allow `wasm-unsafe-eval`
