# Superset Configuration for IFC-Lite Analytics
# This file configures Superset for embedded dashboards, CORS, and guest tokens

import os

# Feature flags for embedded dashboards and cross-filtering
FEATURE_FLAGS = {
    "EMBEDDED_SUPERSET": True,
    "DASHBOARD_CROSS_FILTERS": True,
    "ENABLE_TEMPLATE_PROCESSING": True,
}

# Guest token configuration
GUEST_ROLE_NAME = "Public"
GUEST_TOKEN_JWT_SECRET = os.environ.get("GUEST_TOKEN_JWT_SECRET", "change-me-to-a-secure-random-string")

# CORS configuration for iframe embedding
ENABLE_CORS = True
CORS_OPTIONS = {
    "supports_credentials": True,
    "allow_headers": ["*"],
    "origins": [
        os.environ.get("CORS_ORIGIN_VIEWER", "https://ifc-lite.vercel.app"),
        "http://localhost:5173",
        "http://localhost:3000",
    ],
}

# Content Security Policy for WASM (required for IFC Viewer plugin)
TALISMAN_CONFIG = {
    "content_security_policy": {
        "script-src": ["'self'", "'unsafe-eval'", "'wasm-unsafe-eval'"],
        "worker-src": ["'self'", "blob:"],
        "connect-src": ["'self'"],
    },
    "force_https": False,  # Railway handles HTTPS termination
}

# Database configuration
# Railway injects SQLALCHEMY_DATABASE_URI pointing to the shared Postgres
_db_uri = os.environ.get("SQLALCHEMY_DATABASE_URI", "")
if _db_uri:
    SQLALCHEMY_DATABASE_URI = _db_uri

# Redis configuration for caching (optional but recommended)
REDIS_HOST = os.environ.get("REDIS_HOST") or None
_redis_port_str = os.environ.get("REDIS_PORT", "6379")
REDIS_PORT = int(_redis_port_str) if _redis_port_str else 6379
REDIS_PASSWORD = os.environ.get("REDIS_PASSWORD") or None

if REDIS_HOST:
    CACHE_CONFIG = {
        "CACHE_TYPE": "RedisCache",
        "CACHE_DEFAULT_TIMEOUT": 300,
        "CACHE_KEY_PREFIX": "superset_",
        "CACHE_REDIS_HOST": REDIS_HOST,
        "CACHE_REDIS_PORT": REDIS_PORT,
        "CACHE_REDIS_PASSWORD": REDIS_PASSWORD,
        "CACHE_REDIS_DB": 0,
    }
    DATA_CACHE_CONFIG = CACHE_CONFIG.copy()
    DATA_CACHE_CONFIG["CACHE_KEY_PREFIX"] = "superset_data_"

# Web server configuration
SUPERSET_WEBSERVER_PORT = int(os.environ.get("SUPERSET_WEBSERVER_PORT", 8088))
SUPERSET_WEBSERVER_ADDRESS = "0.0.0.0"

# Security settings
SECRET_KEY = os.environ.get("SECRET_KEY", "change-me-to-a-secure-random-string")

# Enable public role for guest tokens
PUBLIC_ROLE_LIKE_GAMMA = True

# Allow guest tokens to access dashboards
GUEST_TOKEN_ROLES = ["Public"]
