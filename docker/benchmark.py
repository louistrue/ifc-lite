#!/usr/bin/env python3
"""Benchmark ifc-lite-headless vs IfcConvert 0.8.4, both native.

Outputs CSV to stdout with anonymized file IDs, file sizes, geometry entity
counts, and timing. Progress goes to stderr. GLB outputs are preserved in
/tmp/benchmark_output/ for visual inspection.

Usage:
    python3 docker/benchmark.py > docker/benchmark_results.csv
    python3 docker/benchmark.py file1.ifc file2.ifc > results.csv
"""

import csv
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = Path("/tmp/benchmark_output")
IFC_LITE_BIN = ROOT / "target" / "release" / "ifc-lite-headless"
IFCCONVERT_BIN = ROOT / ".private" / "bin" / "IfcConvert"

# Regex-based entity counters (pattern -> column name)
# These match your go-style patterns for geometry complexity profiling
ENTITY_COUNTERS = [
    ("entity_count",          r"^#\d+"),
    ("vertex_count",          r"^#\d+\s*=\s*IFCCARTESIANPOINT"),
    ("face_count",            r"^#\d+\s*=\s*IFCFACE\b"),
    ("bspline_count",         r"^#\d+\s*=\s*IFCBSPLINE"),
    ("boolean_count",         r"^#\d+\s*=\s*IFCBOOLEAN"),
    ("swept_count",           r"^#\d+\s*=\s*IFC[A-Z]+SOLID"),
    ("brep_count",            r"^#\d+\s*=\s*IFC[A-Z]+BREP"),
    ("nurbs_count",           r"^#\d+\s*=\s*IFCNURBS"),
    ("mesh_count",            r"^#\d+\s*=\s*IFCTRIANGULATEDFACESET"),
    ("shape_rep_count",       r"^#\d+\s*=\s*IFCSHAPEREPRESENTATION"),
    ("prod_def_shape_count",  r"^#\d+\s*=\s*IFCPRODUCTDEFINITIONSHAPE"),
]

# Compiled regexes
COMPILED_COUNTERS = [(name, re.compile(pat, re.MULTILINE)) for name, pat in ENTITY_COUNTERS]

ENTITY_RE = re.compile(r"^#\d+=\s*(\w+)\(", re.MULTILINE)


def ensure_binaries():
    if not IFC_LITE_BIN.exists():
        print("Building ifc-lite-headless...", file=sys.stderr)
        subprocess.run(
            ["cargo", "build", "--release", "--bin", "ifc-lite-headless"],
            cwd=ROOT, check=True,
        )
    if not IFCCONVERT_BIN.exists():
        print(f"Error: IfcConvert not found at {IFCCONVERT_BIN}", file=sys.stderr)
        print("Download from: https://github.com/IfcOpenShell/IfcOpenShell/releases/tag/ifcconvert-0.8.4", file=sys.stderr)
        sys.exit(1)


def count_entities(ifc_path):
    """Count entities using regex patterns."""
    content = ifc_path.read_text(encoding="utf-8", errors="replace")
    counts = {}
    for name, regex in COMPILED_COUNTERS:
        counts[name] = len(regex.findall(content))
    return counts


def run_tool(args, timeout=600):
    """Run a tool and return (subprocess result or None on timeout)."""
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return None


def benchmark_file(ifc_path, file_id):
    """Run benchmark for a single file, return result dict."""
    ifc_path = Path(ifc_path).resolve()
    file_size = ifc_path.stat().st_size
    size_mb = file_size / 1024 / 1024

    print(f"  [{file_id}] {size_mb:.1f} MB ...", end="", flush=True, file=sys.stderr)

    entity_counts = count_entities(ifc_path)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    result = {
        "file_id": file_id,
        "file_size_mb": round(size_mb, 2),
        **entity_counts,
    }

    timeout = max(120, int(120 + size_mb / 10 * 60))

    # --- ifc-lite-headless ---
    out_glb = OUTPUT_DIR / f"{file_id}_ifc-lite.glb"
    out_glb.unlink(missing_ok=True)
    t0 = time.time()
    r = run_tool([str(IFC_LITE_BIN), str(ifc_path), str(out_glb), "--quiet"], timeout=timeout)
    t1 = time.time()
    if r and r.returncode == 0 and out_glb.exists():
        result["ifc_lite_time_s"] = round(t1 - t0, 2)
        result["ifc_lite_glb_mb"] = round(out_glb.stat().st_size / 1024 / 1024, 2)
        result["ifc_lite_status"] = "OK"
    else:
        result["ifc_lite_time_s"] = round(t1 - t0, 2) if r else ""
        result["ifc_lite_glb_mb"] = ""
        result["ifc_lite_status"] = "TIMEOUT" if r is None else "FAIL"

    # --- IfcConvert 0.8.4 ---
    out_glb2 = OUTPUT_DIR / f"{file_id}_ifcconvert.glb"
    out_glb2.unlink(missing_ok=True)
    cpus = os.cpu_count() or 1
    t0 = time.time()
    r = run_tool([str(IFCCONVERT_BIN), "-j", str(cpus), str(ifc_path), str(out_glb2)], timeout=timeout)
    t1 = time.time()
    if r and r.returncode == 0 and out_glb2.exists():
        result["ifcconvert_time_s"] = round(t1 - t0, 2)
        result["ifcconvert_glb_mb"] = round(out_glb2.stat().st_size / 1024 / 1024, 2)
        result["ifcconvert_status"] = "OK"
    else:
        result["ifcconvert_time_s"] = round(t1 - t0, 2) if r else ""
        result["ifcconvert_glb_mb"] = ""
        result["ifcconvert_status"] = "TIMEOUT" if r is None else "FAIL"

    # Speedup
    ifc_t = result.get("ifc_lite_time_s")
    conv_t = result.get("ifcconvert_time_s")
    if (isinstance(ifc_t, (int, float)) and isinstance(conv_t, (int, float))
            and ifc_t > 0
            and result["ifc_lite_status"] == "OK"
            and result["ifcconvert_status"] == "OK"):
        result["speedup"] = round(conv_t / ifc_t, 1)
    else:
        result["speedup"] = ""

    print(
        f" ifc-lite={result['ifc_lite_status']} ifcconvert={result['ifcconvert_status']}",
        file=sys.stderr,
    )
    return result


def main():
    os.chdir(ROOT)
    ensure_binaries()

    if len(sys.argv) > 1:
        files = [Path(f) for f in sys.argv[1:]]
    else:
        files = sorted(Path(".private").glob("*.ifc"))

    if not files:
        print("No IFC files found. Pass file paths or place them in .private/", file=sys.stderr)
        sys.exit(1)

    files.sort(key=lambda f: f.stat().st_size)

    counter_cols = [name for name, _ in ENTITY_COUNTERS]
    fieldnames = [
        "file_id", "file_size_mb",
        *counter_cols,
        "ifc_lite_time_s", "ifc_lite_glb_mb", "ifc_lite_status",
        "ifcconvert_time_s", "ifcconvert_glb_mb", "ifcconvert_status",
        "speedup",
    ]

    results = []
    cpus = os.cpu_count() or 1
    writer = csv.DictWriter(sys.stdout, fieldnames=fieldnames)
    writer.writeheader()
    sys.stdout.flush()

    print(f"Benchmarking {len(files)} files ({cpus} CPUs, native)...\n", file=sys.stderr)
    print(f"GLB outputs preserved in {OUTPUT_DIR}/\n", file=sys.stderr)
    for i, f in enumerate(files, 1):
        file_id = f"file_{i:02d}"
        r = benchmark_file(f, file_id)
        results.append(r)
        writer.writerow(r)
        sys.stdout.flush()

    ok_results = [r for r in results
                  if r["ifc_lite_status"] == "OK" and r["ifcconvert_status"] == "OK"]
    if ok_results:
        speedups = [r["speedup"] for r in ok_results if r["speedup"]]
        if speedups:
            avg = sum(speedups) / len(speedups)
            print(f"\nAverage speedup: {avg:.1f}x ({len(ok_results)} files with both OK)", file=sys.stderr)


if __name__ == "__main__":
    main()
