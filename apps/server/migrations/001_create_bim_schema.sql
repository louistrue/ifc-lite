-- Create the bim_data schema for IFC analytics data.

CREATE SCHEMA IF NOT EXISTS bim_data;

-- Master table tracking published models
CREATE TABLE bim_data.models (
    model_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cache_key             VARCHAR(64) UNIQUE NOT NULL,
    file_name             VARCHAR(255),
    schema_version        VARCHAR(20),
    entity_count          INTEGER,
    geometry_count        INTEGER,
    published_at          TIMESTAMPTZ DEFAULT NOW(),
    superset_dataset_id   INTEGER,
    superset_dashboard_id INTEGER,
    model_url             TEXT
);
