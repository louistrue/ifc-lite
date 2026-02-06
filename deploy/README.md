# Superset Deployment - Complete Setup

This directory contains all files needed to deploy Apache Superset on Railway for IFC-Lite analytics integration.

## Quick Start

1. **Superset is deploying** (check status: `railway service status --service superset`)
2. **Once Status = SUCCESS**, follow [CHECKLIST.md](./CHECKLIST.md) for remaining manual steps
3. **See [SETUP.md](./SETUP.md)** for detailed setup instructions

## Files

- `superset/Dockerfile` - Custom Superset Docker image with embedded dashboard config
- `superset/superset_config.py` - Superset configuration (CORS, guest tokens, WASM CSP)
- `superset/setup-database.sh` - Script to add BIM data database connection via API
- `superset/DEPLOYMENT.md` - Deployment guide for Superset
- `SETUP.md` - Complete end-to-end setup instructions
- `CHECKLIST.md` - Step-by-step checklist for remaining tasks
- `DEPLOYMENT_SUMMARY.md` - Summary of what's been automated vs manual

## Current Status

✅ **Infrastructure Deployed:**
- Superset service created and building
- Redis configured
- All environment variables set

⏳ **Waiting:**
- Superset Docker build to complete (first boot takes 5-10 minutes)

📋 **Manual Steps Remaining:**
1. Add database connection in Superset UI
2. Set `SUPERSET_DATABASE_ID` on server
3. Configure viewer environment variables on Vercel
4. Change default passwords

## Service URLs

- **Server**: https://ifc-lite-api-production.up.railway.app
- **Superset**: https://superset-production-9a66.up.railway.app
- **Postgres**: Internal (shared with server)
- **Redis**: Internal

## Next Steps

1. Wait for Superset to finish building
2. Follow [CHECKLIST.md](./CHECKLIST.md) for remaining setup
3. Test end-to-end flow: Load IFC → Publish → View Dashboard

## Troubleshooting

See [SETUP.md](./SETUP.md) for detailed troubleshooting guide.
