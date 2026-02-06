-- Flat entity view with storey name (most common query pattern)
CREATE VIEW bim_data.entity_summary AS
SELECT
    e.model_id,
    e.express_id,
    e.ifc_type,
    e.global_id,
    e.name AS entity_name,
    e.has_geometry,
    sn.name AS storey_name,
    sn.elevation AS storey_elevation
FROM bim_data.entities e
LEFT JOIN bim_data.spatial_containment sc
    ON e.model_id = sc.model_id AND e.express_id = sc.element_id
LEFT JOIN bim_data.spatial_nodes sn
    ON e.model_id = sn.model_id AND sc.storey_id = sn.entity_id;

-- Entity with quantities (for takeoff dashboards)
CREATE VIEW bim_data.entity_quantities AS
SELECT
    e.model_id,
    e.express_id,
    e.ifc_type,
    e.name AS entity_name,
    sn.name AS storey_name,
    r.related_id AS entity_id,
    q.qset_name,
    q.quantity_name,
    q.quantity_type,
    q.quantity_value
FROM bim_data.entities e
JOIN bim_data.relationships r
    ON e.model_id = r.model_id
    AND r.rel_type = 'IfcRelDefinesByProperties'
    AND r.related_id = e.express_id
JOIN bim_data.quantities q
    ON e.model_id = q.model_id AND r.relating_id = q.qset_id
LEFT JOIN bim_data.spatial_containment sc
    ON e.model_id = sc.model_id AND e.express_id = sc.element_id
LEFT JOIN bim_data.spatial_nodes sn
    ON e.model_id = sn.model_id AND sc.storey_id = sn.entity_id;
