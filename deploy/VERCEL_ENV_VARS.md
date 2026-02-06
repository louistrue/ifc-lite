# Vercel Environment Variables Configuration

## Required Variables

Add these environment variables to your Vercel project:

### Production Environment

1. **VITE_SERVER_URL**
   - Value: `https://ifc-lite-api-production.up.railway.app`
   - Purpose: Points viewer to the Rust server for IFC parsing and analytics

2. **VITE_SUPERSET_URL**
   - Value: `https://superset-production-9a66.up.railway.app`
   - Purpose: Enables embedded Superset dashboards in the viewer

## How to Add

1. Go to Vercel Dashboard: https://vercel.com/dashboard
2. Select your IFC-Lite viewer project
3. Go to **Settings** → **Environment Variables**
4. Click **Add New**
5. Add each variable:
   - **Name**: `VITE_SERVER_URL`
   - **Value**: `https://ifc-lite-api-production.up.railway.app`
   - **Environment**: Select all (Production, Preview, Development)
   - Click **Save**
6. Repeat for `VITE_SUPERSET_URL`
7. **Redeploy** the project (Vercel will auto-redeploy on next push, or trigger manually)

## Verification

After adding variables and redeploying:

1. Open viewer in browser
2. Open browser DevTools → Console
3. Check for:
   - `[useIfc] Using PARQUET endpoint` (confirms server connection)
   - No errors about missing `VITE_SERVER_URL` or `VITE_SUPERSET_URL`

## Troubleshooting

- **Variables not working**: Ensure they start with `VITE_` (Vite requirement)
- **Still seeing errors**: Clear browser cache and hard refresh (Cmd+Shift+R)
- **Server not connecting**: Verify `VITE_SERVER_URL` matches Railway domain exactly
