# Superset Deployment Checklist

## ✅ Automated Steps (Completed)

- [x] Created Superset Dockerfile with custom configuration
- [x] Created `superset_config.py` with embedded dashboards, CORS, guest tokens
- [x] Created Superset service on Railway
- [x] Configured all Superset environment variables
- [x] Configured Redis connection for Superset
- [x] Set Superset URL on server (`ifc-lite-api`)
- [x] Set Superset admin credentials on server
- [x] Generated secure secrets (SECRET_KEY, GUEST_TOKEN_JWT_SECRET)
- [x] Created database setup script
- [x] Fixed viewer `analyticsServerCacheKey` bug
- [x] Created comprehensive documentation

## ⚠️ CRITICAL: Fix Railway Configuration First

**Before proceeding, you MUST fix the Superset service configuration:**

1. Go to Railway Dashboard: https://railway.app/dashboard
2. Select project: `ifc-lite-server`
3. Click on `superset` service
4. Settings → Build & Deploy → Set **Root Directory** to: `deploy/superset`
5. Save (Railway will auto-redeploy)

**See:** `deploy/URGENT_FIX.md` for detailed instructions

**Verify fix:** Visit https://superset-production-9a66.up.railway.app - should show Superset login page, NOT API JSON

## ⏳ Waiting for Build

- [ ] Superset Docker build completes (Status: BUILDING → SUCCESS)
  - Check: `railway service status --service superset`
  - Expected: Status changes to `SUCCESS` or `ACTIVE`
  - Verify: https://superset-production-9a66.up.railway.app shows Superset login

## 📋 Manual Steps Required

### 1. Verify Superset Started ✅ (Automated check in script)
```bash
# Check status
railway service status --service superset

# Check logs
railway logs --service superset | tail -50

# Verify Superset UI is accessible
curl -I https://superset-production-9a66.up.railway.app
# Should return HTML, not JSON
```

### 2. Run Automated Setup Script ✅ (RECOMMENDED)

**Quick setup (automated):**
```bash
cd deploy
./complete-setup.sh
```

This script will:
- Verify Superset is running
- Prompt for DATABASE_URL
- Add database connection via API
- Set SUPERSET_DATABASE_ID on server automatically

**Or manual setup:**

### 2a. Access Superset UI
- URL: https://superset-production-9a66.up.railway.app
- Login with:
  - Username: `admin`
  - Password: `change-me-strong-password`

### 3. Add Database Connection
**Option A: Use automated script (recommended)**
```bash
cd deploy
./complete-setup.sh
```

**Option B: Manual via Superset UI**
1. Settings → Database Connections → "+ Database"
2. Select "PostgreSQL"
3. Connection string: Get from Railway dashboard → Postgres service → `DATABASE_URL`
   ```bash
   railway variables --service Postgres | grep DATABASE_URL
   ```
4. Test connection
5. Advanced → SQL Lab Settings → Schema: `bim_data`
6. Save
7. **Note the Database ID** from URL (e.g., `/database/list/1` → ID is `1`)

**Option C: Use API script**
```bash
cd deploy/superset
export SUPERSET_URL=https://superset-production-9a66.up.railway.app
export ADMIN_USERNAME=admin
export ADMIN_PASSWORD=change-me-strong-password
export DATABASE_URL='<get from: railway variables --service Postgres | grep DATABASE_URL>'
./setup-database.sh
```

### 4. Set SUPERSET_DATABASE_ID on Server ✅ (Automated in script)
```bash
# If using automated script, this is done automatically
# Otherwise, run manually:
railway variables set SUPERSET_DATABASE_ID=<id-from-step-3> --service ifc-lite-api
```

### 5. Configure Viewer (Vercel) ⏳ (Manual - requires Vercel dashboard access)
1. Go to Vercel project dashboard
2. Settings → Environment Variables
3. Add:
   - `VITE_SERVER_URL` = `https://ifc-lite-api-production.up.railway.app`
   - `VITE_SUPERSET_URL` = `https://superset-production-9a66.up.railway.app`
4. Redeploy viewer

**Note:** This step requires access to Vercel dashboard. If you don't have access, ask the project maintainer to add these variables.

### 6. Change Default Passwords ⏳ (Security - Recommended)
**Superset:**
1. Login to Superset UI
2. Settings → Users → Edit admin user
3. Set new password
4. Update Railway:
   ```bash
   railway variables set ADMIN_PASSWORD='<new-password>' SUPERSET_ADMIN_PASSWORD='<new-password>' --service superset
   railway variables set SUPERSET_ADMIN_PASSWORD='<new-password>' --service ifc-lite-api
   ```

### 7. Test End-to-End Flow ⏳ (Final verification)
1. **Load IFC file** in viewer
   - Should parse via server
   - Check console for cache key

2. **Publish to Analytics**
   - Click "Analytics" button
   - Click "Send to Analytics"
   - Wait for success message

3. **View Dashboard**
   - Click "Open Dashboard" or "Open Embedded Dashboard"
   - Should see auto-generated charts:
     - Element Type Breakdown (pie chart)
     - Storey Distribution (bar chart)
     - Entity Browser (table)
     - Quantity/Property tables (if available)

## 🔍 Verification Commands

```bash
# Check all services
railway status

# Check Superset status
railway service status --service superset

# Check Superset logs
railway logs --service superset | tail -50

# Check server variables
railway variables --service ifc-lite-api | grep SUPERSET

# Check Superset variables
railway variables --service superset | grep -E "ADMIN|SECRET|DATABASE"
```

## 🐛 Troubleshooting

### Superset won't start
- Check logs: `railway logs --service superset`
- Verify database connection string
- Check SECRET_KEY is set

### Database connection fails
- Verify `SQLALCHEMY_DATABASE_URI` uses `${{Postgres.DATABASE_URL}}`
- Check Postgres is running: `railway service status` (look for Postgres)
- Verify `bim_data` schema exists (server migrations should have created it)

### "Send to Analytics" button disabled
- Ensure model loaded via server (not client-side)
- Check `VITE_SERVER_URL` is set on viewer
- Check browser console for cache key

### Guest token errors
- Verify `GUEST_TOKEN_JWT_SECRET` matches
- Check CORS origins
- Ensure dashboard is published

## 📊 Current Status

**Services:**
- ✅ ifc-lite-api: Running
- ✅ Postgres: Running  
- ✅ Redis: Running
- ⚠️ Superset: **NEEDS RAILWAY DASHBOARD CONFIG FIX** (see URGENT_FIX.md)
  - Current: Running wrong Dockerfile (ifc-lite-server)
  - Required: Set root directory to `deploy/superset` in Railway dashboard

**Configuration:**
- ✅ Server env vars: Configured
- ✅ Superset env vars: Configured
- ⏳ Database connection: Waiting for Superset to start correctly
- ⏳ Viewer env vars: Needs Vercel configuration

**Code:**
- ✅ Server analytics endpoints: Implemented
- ✅ Superset API client: Implemented
- ✅ Viewer analytics panel: Fixed and ready
- ✅ Database migrations: Applied
- ✅ Automated setup script: Created (`deploy/complete-setup.sh`)

## 🚀 Quick Start (After Railway Fix)

Once Superset is running correctly:

```bash
# 1. Run automated setup
cd deploy
./complete-setup.sh

# 2. Configure Vercel (manual - see step 5 above)

# 3. Test end-to-end (see step 7 above)
```
