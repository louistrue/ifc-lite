/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * bSDD (buildingSMART Data Dictionary) API client.
 *
 * Fetches IFC class definitions, property sets, and properties from the
 * bSDD REST API so that users can discover schema-conform properties
 * for a selected IFC entity type and add them in one click.
 *
 * API docs: https://app.swaggerhub.com/apis/buildingSMART/Dictionaries/v1
 */

// Proxy through our own origin to avoid CORS issues.
// In dev Vite proxies /api/bsdd → https://api.bsdd.buildingsmart.org,
// in production Vercel rewrites do the same.
const BSDD_API = '/api/bsdd';
const IFC_DICTIONARY_URI =
  'https://identifier.buildingsmart.org/uri/buildingsmart/ifc/4.3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BsddClassProperty {
  /** Property name, e.g. "IsExternal" */
  name: string;
  /** URI of the property definition */
  uri: string;
  /** Human-readable description */
  description: string | null;
  /** bSDD data type, e.g. "Boolean", "Real", "String" */
  dataType: string | null;
  /** Name of the property set this property belongs to */
  propertySet: string | null;
  /** Allowed values (enum constraints) */
  allowedValues: Array<{ uri?: string; value: string; description?: string }> | null;
  /** Units */
  units: string[] | null;
  /** Whether this is from the IFC standard dictionary */
  isIfcStandard: boolean;
}

export interface BsddClassInfo {
  /** Class URI */
  uri: string;
  /** IFC entity code, e.g. "IfcWall" */
  code: string;
  /** Human-readable name */
  name: string;
  /** Description / definition */
  definition: string | null;
  /** Parent class URI */
  parentClassUri: string | null;
  /** Properties defined for this class */
  classProperties: BsddClassProperty[];
  /** Related IFC entity names */
  relatedIfcEntityNames: string[] | null;
}

export interface BsddSearchResult {
  uri: string;
  code: string;
  name: string;
  definition: string | null;
  dictionaryUri: string;
}

// ---------------------------------------------------------------------------
// In-memory cache (keyed by class URI)
// ---------------------------------------------------------------------------

const classCache = new Map<string, { data: BsddClassInfo; ts: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getCached(key: string): BsddClassInfo | null {
  const entry = classCache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL_MS) return entry.data;
  if (entry) classCache.delete(key);
  return null;
}

function setCache(key: string, data: BsddClassInfo) {
  classCache.set(key, { data, ts: Date.now() });
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`bSDD API ${res.status}: ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the bSDD class URI for an IFC entity type.
 * e.g. "IfcWall" -> "https://identifier.buildingsmart.org/uri/buildingsmart/ifc/4.3/class/IfcWall"
 */
export function ifcClassUri(ifcType: string): string {
  // Use the type name as-is.  IFC parsers typically produce PascalCase
  // names (e.g. "IfcWall") which match the bSDD URI scheme directly.
  // Previous best-effort lowercasing corrupted multi-word names like
  // IFCWALLSTANDARDCASE → "IfcWallstandardcase", so we no longer attempt
  // case normalisation — the bSDD API will simply 404 for unknown names
  // and we handle that gracefully.
  return `${IFC_DICTIONARY_URI}/class/${ifcType}`;
}

/**
 * Fetch full class info (including properties) for an IFC entity type.
 *
 * Uses the `/api/Class/v1` endpoint with `IncludeClassProperties=true`
 * (PascalCase parameter names per the bSDD OpenAPI spec).
 * Falls back to the paginated `/api/Class/Properties/v1` endpoint when
 * the inline property list comes back empty.
 */
export async function fetchClassInfo(
  ifcType: string,
): Promise<BsddClassInfo | null> {
  const uri = ifcClassUri(ifcType);
  const cached = getCached(uri);
  if (cached) return cached;

  try {
    // Parameter names must be PascalCase per the bSDD OpenAPI spec
    const raw = await fetchJson<Record<string, unknown>>(
      `${BSDD_API}/api/Class/v1?Uri=${encodeURIComponent(uri)}&IncludeClassProperties=true&IncludeClassRelations=true`,
    );

    let info = mapClassResponse(raw, true);

    // Fallback: if inline classProperties came back empty, try the
    // dedicated paginated properties endpoint
    if (info.classProperties.length === 0) {
      const propsRaw = await fetchJson<Record<string, unknown>>(
        `${BSDD_API}/api/Class/Properties/v1?ClassUri=${encodeURIComponent(uri)}`,
      ).catch(() => null);

      if (propsRaw) {
        const propsList = propsRaw.classProperties as Array<Record<string, unknown>> | undefined;
        if (propsList && propsList.length > 0) {
          info = {
            ...info,
            classProperties: propsList.map((p) => ({
              name: String(p.name ?? p.propertyCode ?? ''),
              uri: String(p.propertyUri ?? p.uri ?? ''),
              description: p.description ? String(p.description) : null,
              dataType: p.dataType ? String(p.dataType) : null,
              propertySet: p.propertySet ? String(p.propertySet) : null,
              allowedValues: Array.isArray(p.allowedValues)
                ? p.allowedValues.map((v: Record<string, unknown>) => ({
                    uri: v.uri ? String(v.uri) : undefined,
                    value: String(v.value ?? ''),
                    description: v.description ? String(v.description) : undefined,
                  }))
                : null,
              units: Array.isArray(p.units) ? (p.units as string[]) : null,
              isIfcStandard: true,
            })),
          };
        }
      }
    }

    setCache(uri, info);
    return info;
  } catch {
    // Silently return null – bSDD may not have data for every type
    return null;
  }
}

/**
 * Search bSDD for classes related to a given IFC entity type across all
 * dictionaries (not just the IFC dictionary).
 *
 * Uses `/api/Class/Search/v1` with a RelatedIfcEntities filter.
 * Returns lightweight results. Call `fetchClassInfo` on a specific result
 * to get full properties.
 */
export async function searchRelatedClasses(
  ifcType: string,
): Promise<BsddSearchResult[]> {
  try {
    const raw = await fetchJson<{
      classes?: Array<Record<string, unknown>>;
    }>(
      `${BSDD_API}/api/Class/Search/v1?SearchText=${encodeURIComponent(ifcType)}&RelatedIfcEntities=${encodeURIComponent(ifcType)}`,
    );
    return (raw.classes ?? []).map((c) => ({
      uri: String(c.uri ?? ''),
      code: String(c.code ?? c.name ?? ''),
      name: String(c.name ?? ''),
      definition: c.definition ? String(c.definition) : null,
      dictionaryUri: String(c.dictionaryUri ?? ''),
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Response mapping
// ---------------------------------------------------------------------------

function mapClassResponse(
  raw: Record<string, unknown>,
  isIfcStandard: boolean,
): BsddClassInfo {
  const props = raw.classProperties as Array<Record<string, unknown>> | undefined;

  return {
    uri: String(raw.uri ?? ''),
    code: String(raw.code ?? raw.name ?? ''),
    name: String(raw.name ?? ''),
    definition: raw.definition ? String(raw.definition) : null,
    parentClassUri: raw.parentClassReference
      ? String((raw.parentClassReference as Record<string, unknown>).uri ?? '')
      : null,
    relatedIfcEntityNames: raw.relatedIfcEntityNames as string[] | null,
    classProperties: (props ?? []).map((p) => ({
      name: String(p.name ?? p.propertyCode ?? ''),
      uri: String(p.propertyUri ?? p.uri ?? ''),
      description: p.description ? String(p.description) : null,
      dataType: p.dataType ? String(p.dataType) : null,
      propertySet: p.propertySet ? String(p.propertySet) : null,
      allowedValues: Array.isArray(p.allowedValues)
        ? p.allowedValues.map((v: Record<string, unknown>) => ({
            uri: v.uri ? String(v.uri) : undefined,
            value: String(v.value ?? ''),
            description: v.description ? String(v.description) : undefined,
          }))
        : null,
      units: Array.isArray(p.units) ? (p.units as string[]) : null,
      isIfcStandard,
    })),
  };
}

/**
 * Map bSDD dataType string to a human-friendly label.
 */
export function bsddDataTypeLabel(dt: string | null): string {
  if (!dt) return 'String';
  const lower = dt.toLowerCase();
  if (lower === 'boolean') return 'Boolean';
  if (lower === 'real' || lower === 'number') return 'Real';
  if (lower === 'integer') return 'Integer';
  if (lower === 'string' || lower === 'character') return 'String';
  return dt;
}
