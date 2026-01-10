# IFC-Lite Feasibility Spikes

This prototype implements the 4 core feasibility spike tests to validate key concepts before full development.

## Setup

```bash
cd prototype
npm install
npm run dev
```

The dev server will open automatically at `http://localhost:3000`.

## Spikes

### Spike 1: Parsing Speed
- **Goal:** Scan 100MB IFC file in under 200ms
- **Target:** >500 MB/s scan rate
- **Test:** Simple byte scan counting `#` characters (entity markers)

### Spike 2: Triangulation Coverage
- **Goal:** 80%+ geometry triangulation success
- **Test:** Uses web-ifc to load and triangulate geometry
- **Requires:** IFC file upload

### Spike 3: WebGPU Triangle Throughput
- **Goal:** Render 10M triangles at 60 FPS
- **Target:** <16ms per frame
- **Test:** Generates synthetic triangle mesh and measures rendering performance

### Spike 4: Columnar Query Speed
- **Goal:** Filter 500K properties in under 20ms
- **Target:** <20ms query time
- **Test:** Synthetic columnar data filtering benchmark

## Usage

1. Open the application in your browser
2. For Spikes 1 & 2: Upload an IFC file using the file input
3. Click "Run All Spikes" or run individual spikes
4. Review results in the UI and browser console

## Test Files

Download sample IFC files from:
- [IFC Wiki samples](https://www.ifcwiki.org/index.php?title=KIT_IFC_Examples)
- [BIMcollab sample files](https://www.bimcollab.com/en/resources/ifc-sample-files)

Place test files in `test-files/` directory (gitignored).

## Success Criteria

All spikes should pass for feasibility confirmation:
- ✅ Spike 1: >500 MB/s scan rate
- ✅ Spike 2: 80%+ triangulation coverage
- ✅ Spike 3: <16ms frame time for 10M triangles
- ✅ Spike 4: <20ms query time for 500K properties
