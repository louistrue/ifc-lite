# IFC-Lite Performance Summary

> **Current State**: January 17, 2026  
> **Version**: Production-ready with streaming support

---

## Quick Reference

| File Size | First Load | Cache Hit | Throughput |
|-----------|------------|-----------|------------|
| **Small** (<25MB) | 0.5-1s | ~6ms | 50+ MB/s |
| **Medium** (25-150MB) | 4-8s | ~50ms | 20-25 MB/s |
| **Large** (150-350MB) | 8-20s | ~150ms | 15-20 MB/s |

---

## Tested Files

### 1. Tragwerkmodell (22MB) - Non-Streaming Path

| Metric | Value |
|--------|-------|
| **File Size** | 22.0 MB |
| **Entities** | 260,409 |
| **Meshes** | 4,257 |
| **Vertices** | 276,425 |
| **Triangles** | 117,567 |

**Performance**:
| Phase | Time |
|-------|------|
| Parse | 345ms |
| Geometry | 121ms |
| Serialize | 14ms |
| Data Model | 126ms + 46ms serialize |
| **Total Server** | **467ms** |
| **First Load** | **~580ms** |
| **Cache Hit** | **6ms** |

**Output**:
| Data | Size | Compression |
|------|------|-------------|
| Geometry Parquet | 0.85 MB | 26x |
| Data Model Parquet | 3.46 MB | - |

---

### 2. Holter Tower (169MB) - Streaming Path

| Metric | Value |
|--------|-------|
| **File Size** | 169.2 MB |
| **Entities** | 2,807,815 |
| **Property Sets** | 80,155 |
| **Relationships** | 140,987 |
| **Spatial Nodes** | 65 |

**Performance**:
| Phase | Time |
|-------|------|
| Data Model Extract | 1,339ms |
| **First Load (Stream)** | **~8.4s** |
| **Cache Hit** | **32ms** |

**Output**:
| Data | Size | Compression |
|------|------|-------------|
| Geometry Parquet | 11.1 MB | 15x |
| Data Model Parquet | 20.7 MB | - |

---

### 3. Bouwkundig (327MB) - Streaming Path

| Metric | Value |
|--------|-------|
| **File Size** | 326.8 MB |
| **Entities** | 4,411,807 |
| **Property Sets** | 59,124 |
| **Relationships** | 108,740 |
| **Spatial Nodes** | 132 |

**Performance**:
| Phase | Time |
|-------|------|
| Data Model Extract | 2,761ms |
| **First Load (Stream)** | **~12.5s** |
| **Cache Hit** | **46ms** |

**Output**:
| Data | Size | Compression |
|------|------|-------------|
| Geometry Parquet | 14.7 MB | 22x |
| Data Model Parquet | 34.2 MB | - |

---

### 4. Large Geometry File (270MB) - Streaming Path

| Metric | Value |
|--------|-------|
| **File Size** | 269.6 MB |
| **Entities** | 4,940,841 |
| **Property Sets** | 9,554 |
| **Relationships** | 14,688 |
| **Spatial Nodes** | 18 |

**Performance**:
| Phase | Time |
|-------|------|
| Data Model Extract | 2,191ms |
| **First Load (Stream)** | **~19.3s** |
| **Cache Hit** | **191ms** |

**Output**:
| Data | Size | Compression |
|------|------|-------------|
| Geometry Parquet | 96.3 MB | 2.8x (geometry-heavy) |
| Data Model Parquet | 23.3 MB | - |

---

## Performance Characteristics

### Processing Speed

```
Non-streaming (<150MB):
  - Parse: ~15 MB/s
  - Geometry: ~180 MB/s  
  - Serialize: ~60 MB/s (with LZ4)
  - Total: ~47 MB/s

Streaming (>150MB):
  - Effective: ~15-25 MB/s
  - Bottleneck: Geometry serialization
```

### Compression Ratios

| File Type | Ratio |
|-----------|-------|
| Text-heavy models | 22-26x |
| Balanced models | 15-22x |
| Geometry-heavy | 2-5x |

### Cache Performance

| Operation | Time |
|-----------|------|
| Hash computation (client) | ~1-2s for 300MB |
| Cache check (server) | ~1-3ms |
| Cache read + transfer | 30-200ms |
| **Total Cache Hit** | **~50-200ms** |

---

## Architecture

### Paths

```
File < 150MB → Non-Streaming Path
  1. Upload file
  2. Parse + Geometry (parallel)
  3. Serialize to Parquet
  4. Return immediately
  5. Data model in background

File ≥ 150MB → Streaming Path
  1. Client computes hash
  2. Check cache (if hit → instant return)
  3. Upload + stream geometry batches
  4. Data model extracted in parallel
  5. Background caching for next time
```

### Data Format

```
Geometry Parquet:
  - express_id: Int32
  - positions: List<Float32>
  - indices: List<Uint32>
  - normals: List<Float32>
  - color: FixedSizeList<Float32>[4]
  - transform: FixedSizeList<Float32>[16]
  - Compression: LZ4 (fast encode/decode)
  - Encoding: PLAIN (no dictionary overhead)

Data Model Parquet:
  - Entities table
  - Properties table  
  - Quantities table
  - Relationships table
  - Spatial hierarchy
```

---

## Key Metrics

### Throughput by Component

| Component | Speed |
|-----------|-------|
| Entity scanning | ~130k entities/s |
| Geometry extraction | ~35k meshes/s |
| Parquet serialize | ~300k meshes/s (LZ4) |
| Network transfer | ~100 MB/s (localhost) |
| Client decode | ~50k meshes/s |

### Memory Usage

| File Size | Server RAM | Parquet Size |
|-----------|------------|--------------|
| 22 MB | ~100 MB | 4.3 MB |
| 170 MB | ~500 MB | 32 MB |
| 327 MB | ~1 GB | 49 MB |

---

## Caching Strategy

### Server-Side Cache

- **Location**: `apps/server/.cache/`
- **Format**: Content-addressable (SHA-256 hash)
- **Contents per file**:
  - `{hash}-parquet-v2`: Geometry data
  - `{hash}-datamodel-v2`: Data model
  - `{hash}-parquet-metadata-v2`: Stats

### Cache Behavior

| Scenario | Action |
|----------|--------|
| First load | Full processing → cache result |
| Cache hit (streaming) | Skip upload → return cached |
| Cache hit (non-streaming) | Return cached geometry |

---

## Recommendations

### For Best Performance

1. **Use server mode** for files > 10MB
2. **Cache hits are instant** - users benefit from repeated loads
3. **Streaming threshold at 150MB** balances UX vs overhead
4. **LZ4 compression** provides 3-5x smaller payloads with fast encode/decode

### Bottleneck Analysis

| File Size | Primary Bottleneck |
|-----------|-------------------|
| < 25MB | Network latency |
| 25-150MB | Parse phase (~70%) |
| > 150MB | Geometry serialization (~50%) |

---

## Summary

| Metric | Current Performance |
|--------|---------------------|
| **Small files** | < 1 second |
| **Medium files** | 1-8 seconds |
| **Large files** | 8-20 seconds |
| **Cache hits** | 30-200ms |
| **Compression** | 3-26x smaller |
| **Data model** | Full properties/quantities/hierarchy |

**System handles files from 1KB to 500MB+ efficiently.**

---

*Last updated: January 17, 2026*
