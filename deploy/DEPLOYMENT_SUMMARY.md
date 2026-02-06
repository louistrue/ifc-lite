# Deployment Summary - Superset Integration

## ✅ Completed

### Infrastructure
- [x] Superset service created on Railway
- [x] Redis service configured (already existed)
- [x] Superset Dockerfile created with custom config
- [x] Superset configuration file (`superset_config.py`) with:
  - Embedded dashboards enabled
  - CORS configured
  - Guest token authentication
  - WASM CSP headers for IFC Viewer plugin
  - Redis caching support

### Environment Variables Configured

**Superset Service:**
- `SQLALCHEMY_DATABASE_URI` = `${{Postgres.DATABASE_URL}}` (shared Postgres)
- `ADMIN_USERNAME` = `admin`
- `ADMIN_PASSWORD` = `change-me-strong-password` ⚠️ **CHANGE THIS**
- `SECRET_KEY` = Generated secure random string
- `GUEST_TOKEN_JWT_SECRET` = Generated secure random string
- `SUPERSET_WEBSERVER_PORT` = `8088`
- `PORT` = `8088`
- `CORS_ORIGIN_VIEWER` = `https://ifc-lite.vercel.app`
- `REDIS_HOST` = `${{Redis.REDIS_HOST}}`
- `REDIS_PORT` = `${{Redis.REDIS_PORT}}`
- `REDIS_PASSWORD` = `${{Redis.REDIS_PASSWORD}}`

**Server Service (ifc-lite-api):**
- `SUPERSET_URL` = `https://superset-production-9a66.up.railway.app`
- `SUPERSET_ADMIN_USERNAME` = `admin`
- `SUPERSET_ADMIN_PASSWORD` = `change-me-strong-password` ⚠️ **CHANGE THIS**
- `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (already configured)

**Viewer (Vercel) - TODO:**
- `VITE_SERVER_URL` = `https://ifc-lite-api-production.up.railway.app`
- `VITE_SUPERSET_URL` = `https://superset-production-9a66.up.railway.app`

### Code Changes
- [x] Fixed `analyticsServerCacheKey` storage in viewer (`useIfc.ts`)
- [x] Updated `AnalyticsPanel` to use server cache key
- [x] Added `analyticsServerCacheKey` to analytics slice
- [x] Reset analytics state on new file load

### Documentation
- [x] Created `deploy/superset/DEPLOYMENT.md` - Deployment guide
- [x] Created `deploy/superset/setup-database.sh` - Database setup script
- [x] Created `deploy/SETUP.md` - Complete setup instructions

## ⏳ In Progress

- [ ] Superset build/deployment (Status: BUILDING → will become SUCCESS)
- [ ] Database connection setup in Superset UI (waiting for Superset to start)

## 📋 Remaining Steps

### 1. Wait for Superset Deployment
```bash
railway service status --service superset
# Wait for Status: SUCCESS
```

### 2. Add Database Connection in Superset
- Login: https://superset-production-9a66.up.railway.app
- Username: `admin`, Password: `change-me-strong-password`
- Add PostgreSQL connection pointing to shared Postgres
- Set schema to `bim_data`
- Note the Database ID

### 3. Set SUPERSET_DATABASE_ID
```bash
railway variables set SUPERSET_DATABASE_ID=<id> --service ifc-lite-api
```

### 4. Configure Viewer on Vercel
- Add `VITE_SERVER_URL` and `VITE_SUPERSET_URL`
- Redeploy viewer

### 5. Change Default Passwords
- Update Superset admin password
- Update environment variables on both services

### 6. Test End-to-End
- Load IFC file → Publish to Analytics → View Dashboard

## 🔗 Service URLs

- **Server API**: https://ifc-lite-api-production.up.railway.app
- **Superset**: https://superset-production-9a66.up.railway.app
- **Postgres**: Internal (via `${{Postgres.DATABASE_URL}}`)
- **Redis**: Internal (via `${{Redis.REDIS_HOST}}`)

## 📝 Notes

- Superset first boot takes 2-3 minutes (initializing database, creating admin user)
- Database connection must be added manually via Superset UI (or API script)
- Viewer environment variables must be set on Vercel for embedding to work
- Default passwords should be changed immediately after first login

## 🚀 Next Phase (Follow-up)

- [ ] Build custom Superset Docker image with IFC Viewer plugin
- [ ] Enable 3D viewer cross-filtering in dashboards
- [ ] Add more chart templates for different model types
