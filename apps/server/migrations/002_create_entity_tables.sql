-- Entity metadata (maps to DataModel.entities / EntityMetadata)
CREATE TABLE bim_data.entities (
    model_id     UUID NOT NULL REFERENCES bim_data.models(model_id) ON DELETE CASCADE,
    express_id   INTEGER NOT NULL,
    ifc_type     VARCHAR(100) NOT NULL,
    global_id    VARCHAR(36),
    name         VARCHAR(255),
    has_geometry BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (model_id, express_id)
);

CREATE INDEX idx_entities_type ON bim_data.entities(model_id, ifc_type);
CREATE INDEX idx_entities_global_id ON bim_data.entities(model_id, global_id);

-- Flattened properties (maps to DataModel.property_sets -> flattened)
CREATE TABLE bim_data.properties (
    model_id       UUID NOT NULL REFERENCES bim_data.models(model_id) ON DELETE CASCADE,
    pset_id        INTEGER NOT NULL,
    pset_name      VARCHAR(255) NOT NULL,
    property_name  VARCHAR(255) NOT NULL,
    property_type  VARCHAR(50),
    property_value TEXT
);

CREATE INDEX idx_properties_pset ON bim_data.properties(model_id, pset_id);

-- Flattened quantities (maps to DataModel.quantity_sets -> flattened)
CREATE TABLE bim_data.quantities (
    model_id       UUID NOT NULL REFERENCES bim_data.models(model_id) ON DELETE CASCADE,
    qset_id        INTEGER NOT NULL,
    qset_name      VARCHAR(255) NOT NULL,
    quantity_name  VARCHAR(255) NOT NULL,
    quantity_type  VARCHAR(50),
    quantity_value DOUBLE PRECISION NOT NULL
);

CREATE INDEX idx_quantities_qset ON bim_data.quantities(model_id, qset_id);

-- Relationships (maps to DataModel.relationships)
CREATE TABLE bim_data.relationships (
    model_id    UUID NOT NULL REFERENCES bim_data.models(model_id) ON DELETE CASCADE,
    rel_type    VARCHAR(100) NOT NULL,
    relating_id INTEGER NOT NULL,
    related_id  INTEGER NOT NULL
);

CREATE INDEX idx_relationships_type ON bim_data.relationships(model_id, rel_type);

-- Spatial hierarchy nodes (maps to DataModel.spatial_hierarchy.nodes)
CREATE TABLE bim_data.spatial_nodes (
    model_id  UUID NOT NULL REFERENCES bim_data.models(model_id) ON DELETE CASCADE,
    entity_id INTEGER NOT NULL,
    parent_id INTEGER,
    level     SMALLINT NOT NULL,
    path      TEXT NOT NULL,
    type_name VARCHAR(100) NOT NULL,
    name      VARCHAR(255),
    elevation DOUBLE PRECISION,
    PRIMARY KEY (model_id, entity_id)
);

-- Element-to-spatial containment
CREATE TABLE bim_data.spatial_containment (
    model_id    UUID NOT NULL REFERENCES bim_data.models(model_id) ON DELETE CASCADE,
    element_id  INTEGER NOT NULL,
    storey_id   INTEGER,
    building_id INTEGER,
    site_id     INTEGER,
    space_id    INTEGER
);

CREATE INDEX idx_containment_storey ON bim_data.spatial_containment(model_id, storey_id);
