# Complete Superset + IFC Viewer Setup Guide

## Current Status

✅ **Deployed Services:**
- `ifc-lite-api` (Rust server) - Running
- `Postgres` - Running with `bim_data` schema
- `superset` - Initializing (first boot takes 2-3 minutes)
- `redis` - Running

✅ **Environment Variables Configured:**
- Server: `SUPERSET_URL`, `SUPERSET_ADMIN_USERNAME`, `SUPERSET_ADMIN_PASSWORD`
- Superset: Database connection, admin credentials, CORS, guest tokens

## Remaining Steps

### 1. Wait for Superset to Start

Check status:
```bash
railway service status --service superset
```

When status is `SUCCESS`, proceed to next step.

### 2. Add Database Connection in Superset

**Option A: Via Superset UI (Recommended)**
1. Open https://superset-production-9a66.up.railway.app
2. Login with:
   - Username: `admin`
   - Password: `change-me-strong-password` (update this!)
3. Go to Settings → Database Connections → "+ Database"
4. Select "PostgreSQL"
5. Connection string: Use `${{Postgres.DATABASE_URL}}` from Railway dashboard
6. In "Advanced" → "SQL Lab Settings":
   - Schema: `bim_data`
7. Test connection → Save
8. Note the Database ID from the URL (e.g., `/database/list/1` → ID is `1`)

**Option B: Via API Script**
```bash
cd deploy/superset
export SUPERSET_URL=https://superset-production-9a66.up.railway.app
export ADMIN_USERNAME=admin
export ADMIN_PASSWORD=change-me-strong-password
export DATABASE_URL='${{Postgres.DATABASE_URL}}'  # Get from Railway dashboard
./setup-database.sh
```

### 3. Set SUPERSET_DATABASE_ID on Server

After getting the database ID from step 2:
```bash
railway variables set SUPERSET_DATABASE_ID=1 --service ifc-lite-api
```
(Replace `1` with the actual database ID)

### 4. Configure Viewer Environment Variables (Vercel)

Go to your Vercel project dashboard:
1. Settings → Environment Variables
2. Add:
   - `VITE_SERVER_URL` = `https://ifc-lite-api-production.up.railway.app`
   - `VITE_SUPERSET_URL` = `https://superset-production-9a66.up.railway.app`
3. Redeploy the viewer

### 5. Update Admin Password

**Important:** Change the default Superset admin password:
1. Login to Superset
2. Go to Settings → Users → Edit admin user
3. Set a strong password
4. Update on Railway:
   ```bash
   railway variables set ADMIN_PASSWORD='<new-password>' SUPERSET_ADMIN_PASSWORD='<new-password>' --service superset
   railway variables set SUPERSET_ADMIN_PASSWORD='<new-password>' --service ifc-lite-api
   ```

### 6. Test End-to-End Flow

1. **Load IFC file** in viewer (Vercel)
   - File should parse via server
   - Check browser console for "Cache key: ..."

2. **Publish to Analytics**
   - Click "Analytics" button in toolbar
   - Click "Send to Analytics"
   - Wait for "Published to analytics database" message

3. **View Dashboard**
   - Click "Open Dashboard" or "Open Embedded Dashboard"
   - Should see auto-generated charts:
     - Element Type Breakdown (pie)
     - Storey Distribution (bar)
     - Entity Browser (table)
     - Quantity/Property tables (if available)

4. **Test Cross-Filtering**
   - Click on chart elements
   - Other charts should filter accordingly
   - (3D viewer plugin not yet installed - coming in follow-up)

## Troubleshooting

### Superset won't start
- Check logs: `railway logs --service superset`
- Verify database connection string is correct
- Ensure `SECRET_KEY` and `GUEST_TOKEN_JWT_SECRET` are set

### "Send to Analytics" button disabled
- Ensure model was loaded via server (not client-side WASM)
- Check browser console for cache key
- Verify `VITE_SERVER_URL` is set on viewer

### Database connection fails in Superset
- Verify `SQLALCHEMY_DATABASE_URI` uses `${{Postgres.DATABASE_URL}}`
- Check Postgres is accessible from Superset
- Ensure `bim_data` schema exists (migrations should have created it)

### Guest token errors
- Verify `GUEST_TOKEN_JWT_SECRET` matches on Superset
- Check CORS origins include your viewer domain
- Ensure dashboard is published and accessible

### CORS errors in browser
- Verify `CORS_ORIGIN_VIEWER` matches viewer domain exactly
- Check Superset logs for CORS rejection details
- Ensure `ENABLE_CORS=True` in config

## Next Steps (Follow-up)

- [ ] Install IFC Viewer plugin in Superset (custom Docker build)
- [ ] Enable cross-filtering between 3D viewer and charts
- [ ] Add more chart templates for different model types
- [ ] Set up monitoring and alerts
