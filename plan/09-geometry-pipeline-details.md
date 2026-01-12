# IFC-Lite: Part 9 - Geometry Pipeline Details

## Overview

This document provides detailed specifications for geometry processing that weren't fully covered in the main parsing pipeline document. It covers:
- Complete representation type handling
- Profile triangulation algorithms
- Curve discretization
- Surface meshing
- Geometry repair

---

## 9.1 IFC Representation Types Coverage

### Representation Type Support Matrix

| Representation Type | Priority | Complexity | Strategy |
|---------------------|----------|------------|----------|
| IfcExtrudedAreaSolid | P0 | Low | Extrude + triangulate |
| IfcRevolvedAreaSolid | P0 | Medium | Revolve + triangulate |
| IfcSweptDiskSolid | P1 | Medium | Sweep circle along curve |
| IfcSurfaceCurveSweptAreaSolid | P2 | High | Sweep along surface |
| IfcFixedReferenceSweptAreaSolid | P2 | High | Sweep with fixed direction |
| IfcTriangulatedFaceSet | P0 | Low | Direct passthrough |
| IfcPolygonalFaceSet | P0 | Low | Triangulate faces |
| IfcFacetedBrep | P0 | Medium | Triangulate BRep |
| IfcAdvancedBrep | P2 | Very High | NURBS tessellation |
| IfcBooleanResult | P0 | High | See Part 8 - CSG |
| IfcMappedItem | P0 | Low | Instance transform |
| IfcShellBasedSurfaceModel | P1 | Medium | Triangulate shells |
| IfcFaceBasedSurfaceModel | P1 | Medium | Triangulate faces |
| IfcTessellatedFaceSet | P0 | Low | Direct conversion |

### Implementation Priority

```typescript
/**
 * Geometry type router - directs to appropriate processor.
 */
class GeometryRouter {
  private processors: Map<string, GeometryProcessor> = new Map();
  
  constructor() {
    // P0 - Must have for MVP
    this.processors.set('IfcExtrudedAreaSolid', new ExtrudedAreaSolidProcessor());
    this.processors.set('IfcRevolvedAreaSolid', new RevolvedAreaSolidProcessor());
    this.processors.set('IfcTriangulatedFaceSet', new TriangulatedFaceSetProcessor());
    this.processors.set('IfcPolygonalFaceSet', new PolygonalFaceSetProcessor());
    this.processors.set('IfcFacetedBrep', new FacetedBrepProcessor());
    this.processors.set('IfcMappedItem', new MappedItemProcessor());
    this.processors.set('IfcBooleanResult', new BooleanResultProcessor());
    this.processors.set('IfcBooleanClippingResult', new BooleanResultProcessor());
    
    // P1 - Important for good coverage
    this.processors.set('IfcSweptDiskSolid', new SweptDiskSolidProcessor());
    this.processors.set('IfcShellBasedSurfaceModel', new ShellBasedProcessor());
    this.processors.set('IfcFaceBasedSurfaceModel', new FaceBasedProcessor());
    
    // P2 - Nice to have
    this.processors.set('IfcAdvancedBrep', new AdvancedBrepProcessor());
    this.processors.set('IfcSurfaceCurveSweptAreaSolid', new SurfaceSweptProcessor());
  }
  
  async process(
    representation: IfcRepresentation,
    decoder: EntityDecoder,
    options: GeometryOptions
  ): Promise<ColumnarMesh | null> {
    const items = representation.items;
    const meshes: ColumnarMesh[] = [];
    
    for (const itemId of items) {
      const itemRef = decoder.entityIndex.byId.get(itemId)!;
      const typeEnum = itemRef.typeEnum;
      const typeName = IfcTypeEnumToString(typeEnum);
      
      const processor = this.processors.get(typeName);
      if (!processor) {
        console.warn(`No processor for geometry type: ${typeName}`);
        continue;
      }
      
      try {
        const mesh = await processor.process(itemId, decoder, options);
        if (mesh) meshes.push(mesh);
      } catch (e) {
        console.error(`Failed to process ${typeName} #${itemId}:`, e);
        // Continue with other items
      }
    }
    
    if (meshes.length === 0) return null;
    if (meshes.length === 1) return meshes[0];
    
    return this.mergeMeshes(meshes);
  }
}
```

---

## 9.2 Profile Triangulation

### Supported Profile Types

| Profile Type | Triangulation Strategy |
|--------------|------------------------|
| IfcRectangleProfileDef | Direct quad → 2 triangles |
| IfcRectangleHollowProfileDef | Outer - inner holes |
| IfcCircleProfileDef | N-gon fan triangulation |
| IfcCircleHollowProfileDef | Ring triangulation |
| IfcEllipseProfileDef | Ellipse discretization → fan |
| IfcIShapeProfileDef | Parametric I-beam polygon |
| IfcLShapeProfileDef | Parametric L-angle polygon |
| IfcTShapeProfileDef | Parametric T-section polygon |
| IfcUShapeProfileDef | Parametric channel polygon |
| IfcCShapeProfileDef | Parametric C-channel polygon |
| IfcZShapeProfileDef | Parametric Z-section polygon |
| IfcArbitraryClosedProfileDef | Earcut triangulation |
| IfcArbitraryProfileDefWithVoids | Earcut with holes |
| IfcCompositeProfileDef | Union of sub-profiles |
| IfcDerivedProfileDef | Transform base profile |
| IfcAsymmetricIShapeProfileDef | Parametric asymmetric I |

### Profile Processor Implementation

```typescript
/**
 * Convert IFC profiles to 2D polygons for triangulation.
 */
class ProfileProcessor {
  private curveDiscretizer: CurveDiscretizer;
  
  /**
   * Process any profile type to polygon(s).
   */
  processProfile(
    profile: IfcProfileDef,
    decoder: EntityDecoder,
    options: ProfileOptions
  ): ProfileResult {
    switch (profile.type) {
      case 'IfcRectangleProfileDef':
        return this.processRectangle(profile as IfcRectangleProfileDef);
        
      case 'IfcRectangleHollowProfileDef':
        return this.processRectangleHollow(profile as IfcRectangleHollowProfileDef);
        
      case 'IfcCircleProfileDef':
        return this.processCircle(profile as IfcCircleProfileDef, options);
        
      case 'IfcCircleHollowProfileDef':
        return this.processCircleHollow(profile as IfcCircleHollowProfileDef, options);
        
      case 'IfcEllipseProfileDef':
        return this.processEllipse(profile as IfcEllipseProfileDef, options);
        
      case 'IfcIShapeProfileDef':
        return this.processIShape(profile as IfcIShapeProfileDef);
        
      case 'IfcLShapeProfileDef':
        return this.processLShape(profile as IfcLShapeProfileDef);
        
      case 'IfcTShapeProfileDef':
        return this.processTShape(profile as IfcTShapeProfileDef);
        
      case 'IfcArbitraryClosedProfileDef':
        return this.processArbitrary(profile as IfcArbitraryClosedProfileDef, decoder, options);
        
      case 'IfcArbitraryProfileDefWithVoids':
        return this.processArbitraryWithVoids(
          profile as IfcArbitraryProfileDefWithVoids, 
          decoder, 
          options
        );
        
      case 'IfcCompositeProfileDef':
        return this.processComposite(profile as IfcCompositeProfileDef, decoder, options);
        
      case 'IfcDerivedProfileDef':
        return this.processDerived(profile as IfcDerivedProfileDef, decoder, options);
        
      default:
        throw new Error(`Unsupported profile type: ${profile.type}`);
    }
  }
  
  /**
   * Rectangle profile - simplest case.
   */
  private processRectangle(profile: IfcRectangleProfileDef): ProfileResult {
    const xDim = profile.xDim / 2;
    const yDim = profile.yDim / 2;
    
    // Counter-clockwise polygon
    const outer: [number, number][] = [
      [-xDim, -yDim],
      [xDim, -yDim],
      [xDim, yDim],
      [-xDim, yDim],
    ];
    
    // Apply position if specified
    if (profile.position) {
      return this.transformProfile({ outer, holes: [] }, profile.position);
    }
    
    return { outer, holes: [] };
  }
  
  /**
   * Circle profile with configurable segments.
   */
  private processCircle(
    profile: IfcCircleProfileDef, 
    options: ProfileOptions
  ): ProfileResult {
    const radius = profile.radius;
    const segments = options.circleSegments ?? 32;
    
    const outer: [number, number][] = [];
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      outer.push([
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
      ]);
    }
    
    if (profile.position) {
      return this.transformProfile({ outer, holes: [] }, profile.position);
    }
    
    return { outer, holes: [] };
  }
  
  /**
   * I-beam profile from parameters.
   */
  private processIShape(profile: IfcIShapeProfileDef): ProfileResult {
    const {
      overallWidth: w,
      overallDepth: d,
      webThickness: tw,
      flangeThickness: tf,
      filletRadius: r = 0,
    } = profile;
    
    // Build I-shape polygon (counter-clockwise)
    const outer: [number, number][] = [];
    
    // Bottom flange (left to right)
    outer.push([-w/2, -d/2]);
    outer.push([w/2, -d/2]);
    outer.push([w/2, -d/2 + tf]);
    
    // Right side of web (with optional fillet)
    if (r > 0) {
      this.addFillet(outer, [w/2, -d/2 + tf], [tw/2, -d/2 + tf], [tw/2, d/2 - tf], r);
    } else {
      outer.push([tw/2, -d/2 + tf]);
    }
    
    outer.push([tw/2, d/2 - tf]);
    
    // Top flange
    if (r > 0) {
      this.addFillet(outer, [tw/2, d/2 - tf], [w/2, d/2 - tf], [w/2, d/2], r);
    } else {
      outer.push([w/2, d/2 - tf]);
    }
    
    outer.push([w/2, d/2]);
    outer.push([-w/2, d/2]);
    outer.push([-w/2, d/2 - tf]);
    
    // Left side of web (with optional fillet)
    if (r > 0) {
      this.addFillet(outer, [-w/2, d/2 - tf], [-tw/2, d/2 - tf], [-tw/2, -d/2 + tf], r);
    } else {
      outer.push([-tw/2, d/2 - tf]);
    }
    
    outer.push([-tw/2, -d/2 + tf]);
    
    if (r > 0) {
      this.addFillet(outer, [-tw/2, -d/2 + tf], [-w/2, -d/2 + tf], [-w/2, -d/2], r);
    } else {
      outer.push([-w/2, -d/2 + tf]);
    }
    
    if (profile.position) {
      return this.transformProfile({ outer, holes: [] }, profile.position);
    }
    
    return { outer, holes: [] };
  }
  
  /**
   * Arbitrary closed profile from curve.
   */
  private processArbitrary(
    profile: IfcArbitraryClosedProfileDef,
    decoder: EntityDecoder,
    options: ProfileOptions
  ): ProfileResult {
    const outerCurve = decoder.decodeCurve(profile.outerCurve);
    const outer = this.curveDiscretizer.discretize(outerCurve, options);
    
    // Ensure correct winding (counter-clockwise)
    if (this.computeSignedArea(outer) < 0) {
      outer.reverse();
    }
    
    if (profile.position) {
      return this.transformProfile({ outer, holes: [] }, profile.position);
    }
    
    return { outer, holes: [] };
  }
  
  /**
   * Arbitrary profile with holes.
   */
  private processArbitraryWithVoids(
    profile: IfcArbitraryProfileDefWithVoids,
    decoder: EntityDecoder,
    options: ProfileOptions
  ): ProfileResult {
    // Process outer boundary
    const outerCurve = decoder.decodeCurve(profile.outerCurve);
    const outer = this.curveDiscretizer.discretize(outerCurve, options);
    
    if (this.computeSignedArea(outer) < 0) {
      outer.reverse();
    }
    
    // Process inner boundaries (holes)
    const holes: [number, number][][] = [];
    for (const voidCurveId of profile.innerCurves) {
      const voidCurve = decoder.decodeCurve(voidCurveId);
      const hole = this.curveDiscretizer.discretize(voidCurve, options);
      
      // Holes should be clockwise
      if (this.computeSignedArea(hole) > 0) {
        hole.reverse();
      }
      
      holes.push(hole);
    }
    
    if (profile.position) {
      return this.transformProfile({ outer, holes }, profile.position);
    }
    
    return { outer, holes };
  }
  
  /**
   * Compute signed area to determine winding.
   */
  private computeSignedArea(polygon: [number, number][]): number {
    let area = 0;
    for (let i = 0; i < polygon.length; i++) {
      const j = (i + 1) % polygon.length;
      area += polygon[i][0] * polygon[j][1];
      area -= polygon[j][0] * polygon[i][1];
    }
    return area / 2;
  }
  
  /**
   * Transform profile by IfcAxis2Placement2D.
   */
  private transformProfile(
    profile: ProfileResult, 
    position: IfcAxis2Placement2D
  ): ProfileResult {
    const location = position.location;
    const refDir = position.refDirection ?? [1, 0];
    
    // Build 2D transformation
    const cos = refDir[0];
    const sin = refDir[1];
    
    const transform = (p: [number, number]): [number, number] => [
      p[0] * cos - p[1] * sin + location[0],
      p[0] * sin + p[1] * cos + location[1],
    ];
    
    return {
      outer: profile.outer.map(transform),
      holes: profile.holes.map(hole => hole.map(transform)),
    };
  }
}

interface ProfileResult {
  outer: [number, number][];
  holes: [number, number][][];
}

interface ProfileOptions {
  circleSegments?: number;
  curveSegments?: number;
  tolerance?: number;
}
```

### Profile Triangulation with Earcut

```typescript
/**
 * Triangulate profile polygon using earcut algorithm.
 */
class ProfileTriangulator {
  
  /**
   * Triangulate profile result to indices.
   */
  triangulate(profile: ProfileResult): Uint32Array {
    // Flatten to earcut format
    const vertices: number[] = [];
    const holeIndices: number[] = [];
    
    // Add outer boundary
    for (const [x, y] of profile.outer) {
      vertices.push(x, y);
    }
    
    // Add holes
    for (const hole of profile.holes) {
      holeIndices.push(vertices.length / 2);
      for (const [x, y] of hole) {
        vertices.push(x, y);
      }
    }
    
    // Triangulate
    const indices = earcut(vertices, holeIndices.length > 0 ? holeIndices : undefined, 2);
    
    return new Uint32Array(indices);
  }
  
  /**
   * Create 3D mesh from profile at Z=0.
   */
  createCapMesh(profile: ProfileResult, flipNormal: boolean = false): CapMesh {
    const indices = this.triangulate(profile);
    
    // Build positions (Z = 0)
    const positions: number[] = [];
    for (const [x, y] of profile.outer) {
      positions.push(x, y, 0);
    }
    for (const hole of profile.holes) {
      for (const [x, y] of hole) {
        positions.push(x, y, 0);
      }
    }
    
    // Normals (all +Z or -Z)
    const normals: number[] = [];
    const nz = flipNormal ? -1 : 1;
    for (let i = 0; i < positions.length / 3; i++) {
      normals.push(0, 0, nz);
    }
    
    // Flip indices if needed for correct winding
    const finalIndices = flipNormal 
      ? this.flipTriangleWinding(indices)
      : indices;
    
    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      indices: finalIndices,
    };
  }
  
  private flipTriangleWinding(indices: Uint32Array): Uint32Array {
    const flipped = new Uint32Array(indices.length);
    for (let i = 0; i < indices.length; i += 3) {
      flipped[i] = indices[i];
      flipped[i + 1] = indices[i + 2];
      flipped[i + 2] = indices[i + 1];
    }
    return flipped;
  }
}

interface CapMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}
```

---

## 9.3 Curve Discretization

### Supported Curve Types

| Curve Type | Discretization Strategy |
|------------|------------------------|
| IfcLine | 2 endpoints |
| IfcCircle | Arc segments |
| IfcEllipse | Parametric sampling |
| IfcTrimmedCurve | Trim parent curve |
| IfcPolyline | Direct vertices |
| IfcCompositeCurve | Join segments |
| IfcBSplineCurve | De Boor evaluation |
| IfcIndexedPolyCurve | Indexed segments |
| IfcOffsetCurve2D | Offset parent curve |

### Curve Discretizer Implementation

```typescript
/**
 * Convert IFC curves to discrete point sequences.
 */
class CurveDiscretizer {
  
  /**
   * Discretize any curve type to points.
   */
  discretize(
    curve: IfcCurve,
    options: CurveOptions
  ): [number, number][] {
    switch (curve.type) {
      case 'IfcLine':
        return this.discretizeLine(curve as IfcLine);
        
      case 'IfcCircle':
        return this.discretizeCircle(curve as IfcCircle, options);
        
      case 'IfcEllipse':
        return this.discretizeEllipse(curve as IfcEllipse, options);
        
      case 'IfcTrimmedCurve':
        return this.discretizeTrimmed(curve as IfcTrimmedCurve, options);
        
      case 'IfcPolyline':
        return this.discretizePolyline(curve as IfcPolyline);
        
      case 'IfcCompositeCurve':
        return this.discretizeComposite(curve as IfcCompositeCurve, options);
        
      case 'IfcBSplineCurveWithKnots':
        return this.discretizeBSpline(curve as IfcBSplineCurveWithKnots, options);
        
      case 'IfcIndexedPolyCurve':
        return this.discretizeIndexedPolyCurve(curve as IfcIndexedPolyCurve, options);
        
      default:
        throw new Error(`Unsupported curve type: ${curve.type}`);
    }
  }
  
  /**
   * Circle arc discretization with adaptive segments.
   */
  private discretizeCircle(
    circle: IfcCircle, 
    options: CurveOptions
  ): [number, number][] {
    const radius = circle.radius;
    const position = circle.position;
    
    // Adaptive segment count based on radius and tolerance
    const tolerance = options.tolerance ?? 0.001;
    const minSegments = options.minSegments ?? 8;
    const maxSegments = options.maxSegments ?? 128;
    
    // Calculate segments needed to meet tolerance
    // Error = r - r*cos(theta/2) ≈ r*theta²/8 for small theta
    // theta = sqrt(8 * tolerance / r)
    // segments = 2*PI / theta
    const theta = Math.sqrt(8 * tolerance / radius);
    let segments = Math.ceil((2 * Math.PI) / theta);
    segments = Math.max(minSegments, Math.min(maxSegments, segments));
    
    const points: [number, number][] = [];
    const center = position?.location ?? [0, 0];
    const refDir = position?.refDirection ?? [1, 0];
    const perpDir = [-refDir[1], refDir[0]];
    
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      
      // Transform to position
      points.push([
        center[0] + x * refDir[0] + y * perpDir[0],
        center[1] + x * refDir[1] + y * perpDir[1],
      ]);
    }
    
    return points;
  }
  
  /**
   * Trimmed curve - trim parent curve to bounds.
   */
  private discretizeTrimmed(
    trimmed: IfcTrimmedCurve, 
    options: CurveOptions
  ): [number, number][] {
    const parentCurve = trimmed.basisCurve;
    const trim1 = trimmed.trim1;
    const trim2 = trimmed.trim2;
    const senseAgreement = trimmed.senseAgreement;
    
    // Handle different trim types (parameter or point)
    let startParam: number, endParam: number;
    
    if (typeof trim1 === 'number') {
      startParam = trim1;
      endParam = trim2 as number;
    } else {
      // Point-based trimming - find parameters
      startParam = this.findParameterForPoint(parentCurve, trim1);
      endParam = this.findParameterForPoint(parentCurve, trim2 as [number, number]);
    }
    
    if (!senseAgreement) {
      [startParam, endParam] = [endParam, startParam];
    }
    
    // Discretize with modified parameter range
    return this.discretizeWithRange(parentCurve, startParam, endParam, options);
  }
  
  /**
   * B-Spline curve evaluation using de Boor algorithm.
   */
  private discretizeBSpline(
    bspline: IfcBSplineCurveWithKnots, 
    options: CurveOptions
  ): [number, number][] {
    const controlPoints = bspline.controlPointsList;
    const degree = bspline.degree;
    const knots = bspline.knots;
    const knotMultiplicities = bspline.knotMultiplicities;
    
    // Expand knot vector
    const knotVector: number[] = [];
    for (let i = 0; i < knots.length; i++) {
      const mult = knotMultiplicities[i];
      for (let j = 0; j < mult; j++) {
        knotVector.push(knots[i]);
      }
    }
    
    // Sample curve
    const numSamples = options.bsplineSegments ?? 64;
    const points: [number, number][] = [];
    
    const tMin = knotVector[degree];
    const tMax = knotVector[knotVector.length - degree - 1];
    
    for (let i = 0; i <= numSamples; i++) {
      const t = tMin + (i / numSamples) * (tMax - tMin);
      const point = this.deBoor(t, degree, knotVector, controlPoints);
      points.push([point[0], point[1]]);
    }
    
    return points;
  }
  
  /**
   * De Boor algorithm for B-spline evaluation.
   */
  private deBoor(
    t: number,
    degree: number,
    knots: number[],
    controlPoints: [number, number][]
  ): [number, number] {
    // Find knot span
    let k = degree;
    while (k < knots.length - degree - 1 && knots[k + 1] <= t) {
      k++;
    }
    
    // Initialize with relevant control points
    const d: [number, number][] = [];
    for (let j = 0; j <= degree; j++) {
      d.push([...controlPoints[k - degree + j]]);
    }
    
    // Triangular computation
    for (let r = 1; r <= degree; r++) {
      for (let j = degree; j >= r; j--) {
        const alpha = (t - knots[k - degree + j]) / 
                      (knots[k + 1 + j - r] - knots[k - degree + j]);
        d[j][0] = (1 - alpha) * d[j - 1][0] + alpha * d[j][0];
        d[j][1] = (1 - alpha) * d[j - 1][1] + alpha * d[j][1];
      }
    }
    
    return d[degree];
  }
  
  /**
   * Indexed polycurve with line and arc segments.
   */
  private discretizeIndexedPolyCurve(
    polycurve: IfcIndexedPolyCurve, 
    options: CurveOptions
  ): [number, number][] {
    const points = polycurve.points.coordList;
    const segments = polycurve.segments;
    
    const result: [number, number][] = [];
    
    if (!segments) {
      // No segments specified - treat as polyline
      for (const point of points) {
        result.push([point[0], point[1]]);
      }
      return result;
    }
    
    for (const segment of segments) {
      if (segment.type === 'IfcLineIndex') {
        // Line segment
        const indices = segment.indices;
        for (const idx of indices) {
          const pt = points[idx - 1]; // 1-indexed
          if (result.length === 0 || 
              result[result.length - 1][0] !== pt[0] || 
              result[result.length - 1][1] !== pt[1]) {
            result.push([pt[0], pt[1]]);
          }
        }
      } else if (segment.type === 'IfcArcIndex') {
        // Arc through 3 points
        const [i1, i2, i3] = segment.indices;
        const p1 = points[i1 - 1];
        const p2 = points[i2 - 1];
        const p3 = points[i3 - 1];
        
        const arcPoints = this.discretizeArcThrough3Points(
          [p1[0], p1[1]], 
          [p2[0], p2[1]], 
          [p3[0], p3[1]], 
          options
        );
        
        // Add points (skip first if duplicate)
        for (let i = 0; i < arcPoints.length; i++) {
          const pt = arcPoints[i];
          if (i === 0 && result.length > 0 && 
              Math.abs(result[result.length - 1][0] - pt[0]) < 1e-9 &&
              Math.abs(result[result.length - 1][1] - pt[1]) < 1e-9) {
            continue;
          }
          result.push(pt);
        }
      }
    }
    
    return result;
  }
  
  /**
   * Discretize arc defined by 3 points.
   */
  private discretizeArcThrough3Points(
    p1: [number, number],
    p2: [number, number],
    p3: [number, number],
    options: CurveOptions
  ): [number, number][] {
    // Find center of circle through 3 points
    const ax = p1[0], ay = p1[1];
    const bx = p2[0], by = p2[1];
    const cx = p3[0], cy = p3[1];
    
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 1e-10) {
      // Collinear points - treat as line
      return [p1, p2, p3];
    }
    
    const ux = ((ax * ax + ay * ay) * (by - cy) + 
                (bx * bx + by * by) * (cy - ay) + 
                (cx * cx + cy * cy) * (ay - by)) / d;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + 
                (bx * bx + by * by) * (ax - cx) + 
                (cx * cx + cy * cy) * (bx - ax)) / d;
    
    const radius = Math.sqrt((ax - ux) ** 2 + (ay - uy) ** 2);
    
    // Compute angles
    const angle1 = Math.atan2(ay - uy, ax - ux);
    const angle2 = Math.atan2(by - uy, bx - ux);
    const angle3 = Math.atan2(cy - uy, cx - ux);
    
    // Determine arc direction
    let startAngle = angle1;
    let endAngle = angle3;
    
    // Check if middle point is on the shorter arc
    const midAngle = angle2;
    const arcLength1 = this.normalizeAngle(endAngle - startAngle);
    const arcLength2 = this.normalizeAngle(midAngle - startAngle);
    
    const direction = (arcLength2 < arcLength1 && arcLength2 > 0) ? 1 : -1;
    
    // Number of segments
    const arcAngle = Math.abs(direction > 0 ? arcLength1 : 2 * Math.PI - arcLength1);
    const segments = Math.max(
      options.minSegments ?? 4,
      Math.ceil(arcAngle / (Math.PI / 16)) // ~11.25° per segment
    );
    
    const points: [number, number][] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const angle = startAngle + direction * t * arcAngle;
      points.push([
        ux + radius * Math.cos(angle),
        uy + radius * Math.sin(angle),
      ]);
    }
    
    return points;
  }
  
  private normalizeAngle(angle: number): number {
    while (angle < 0) angle += 2 * Math.PI;
    while (angle >= 2 * Math.PI) angle -= 2 * Math.PI;
    return angle;
  }
}

interface CurveOptions {
  tolerance?: number;
  minSegments?: number;
  maxSegments?: number;
  bsplineSegments?: number;
}
```

---

## 9.4 Extrusion Processor

```typescript
/**
 * Process IfcExtrudedAreaSolid - the most common geometry type.
 */
class ExtrudedAreaSolidProcessor implements GeometryProcessor {
  private profileProcessor: ProfileProcessor;
  private profileTriangulator: ProfileTriangulator;
  
  async process(
    entityId: number,
    decoder: EntityDecoder,
    options: GeometryOptions
  ): Promise<ColumnarMesh> {
    const solid = decoder.decodeExtrudedAreaSolid(entityId);
    
    // Get profile polygon
    const profile = this.profileProcessor.processProfile(
      solid.sweptArea,
      decoder,
      { circleSegments: options.curveSegments }
    );
    
    // Get extrusion direction and depth
    const direction = solid.extrudedDirection;
    const depth = solid.depth;
    
    // Create bottom cap
    const bottomCap = this.profileTriangulator.createCapMesh(profile, true);
    
    // Create top cap (translated by extrusion)
    const topCap = this.profileTriangulator.createCapMesh(profile, false);
    const topPositions = this.translatePositions(
      topCap.positions,
      direction,
      depth
    );
    
    // Create side walls
    const sideWalls = this.createSideWalls(profile, direction, depth);
    
    // Merge all parts
    const merged = this.mergeMeshParts([
      { positions: bottomCap.positions, normals: bottomCap.normals, indices: bottomCap.indices },
      { positions: topPositions, normals: topCap.normals, indices: topCap.indices },
      sideWalls,
    ]);
    
    // Apply position transform
    if (solid.position) {
      return this.applyPlacement(merged, solid.position);
    }
    
    return {
      expressId: entityId,
      ...merged,
      bounds: this.computeBounds(merged.positions),
    };
  }
  
  /**
   * Create side walls by connecting profile edges.
   */
  private createSideWalls(
    profile: ProfileResult,
    direction: [number, number, number],
    depth: number
  ): MeshPart {
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    
    // Process outer boundary
    this.addSideWallsForLoop(
      profile.outer,
      direction,
      depth,
      false, // outer loop
      positions,
      normals,
      indices
    );
    
    // Process holes (reversed winding)
    for (const hole of profile.holes) {
      this.addSideWallsForLoop(
        hole,
        direction,
        depth,
        true, // hole (reversed)
        positions,
        normals,
        indices
      );
    }
    
    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      indices: new Uint32Array(indices),
    };
  }
  
  /**
   * Add side wall quads for a polygon loop.
   */
  private addSideWallsForLoop(
    loop: [number, number][],
    direction: [number, number, number],
    depth: number,
    isHole: boolean,
    positions: number[],
    normals: number[],
    indices: number[]
  ): void {
    const n = loop.length;
    
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      
      const p0 = loop[i];
      const p1 = loop[j];
      
      // Four corners of the quad
      const v0: [number, number, number] = [p0[0], p0[1], 0];
      const v1: [number, number, number] = [p1[0], p1[1], 0];
      const v2: [number, number, number] = [
        p1[0] + direction[0] * depth,
        p1[1] + direction[1] * depth,
        direction[2] * depth,
      ];
      const v3: [number, number, number] = [
        p0[0] + direction[0] * depth,
        p0[1] + direction[1] * depth,
        direction[2] * depth,
      ];
      
      // Compute face normal
      const edge1: [number, number, number] = [
        v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]
      ];
      const edge2: [number, number, number] = [
        v3[0] - v0[0], v3[1] - v0[1], v3[2] - v0[2]
      ];
      
      let normal: [number, number, number] = [
        edge1[1] * edge2[2] - edge1[2] * edge2[1],
        edge1[2] * edge2[0] - edge1[0] * edge2[2],
        edge1[0] * edge2[1] - edge1[1] * edge2[0],
      ];
      
      // Normalize
      const len = Math.sqrt(normal[0]**2 + normal[1]**2 + normal[2]**2);
      normal = [normal[0]/len, normal[1]/len, normal[2]/len];
      
      // Flip normal for holes
      if (isHole) {
        normal = [-normal[0], -normal[1], -normal[2]];
      }
      
      // Add vertices
      const baseIdx = positions.length / 3;
      positions.push(
        v0[0], v0[1], v0[2],
        v1[0], v1[1], v1[2],
        v2[0], v2[1], v2[2],
        v3[0], v3[1], v3[2]
      );
      
      // Add normals (same for all 4 vertices)
      for (let k = 0; k < 4; k++) {
        normals.push(normal[0], normal[1], normal[2]);
      }
      
      // Add indices (two triangles)
      if (isHole) {
        indices.push(baseIdx, baseIdx + 2, baseIdx + 1);
        indices.push(baseIdx, baseIdx + 3, baseIdx + 2);
      } else {
        indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
        indices.push(baseIdx, baseIdx + 2, baseIdx + 3);
      }
    }
  }
}

interface MeshPart {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}
```

---

## 9.5 Geometry Repair

### Common Issues and Fixes

```typescript
/**
 * Repair common geometry issues.
 */
class GeometryRepair {
  
  /**
   * Full repair pipeline.
   */
  repair(mesh: ColumnarMesh, options: RepairOptions = {}): ColumnarMesh {
    let result = mesh;
    
    // 1. Remove degenerate triangles
    if (options.removeDegenerates !== false) {
      result = this.removeDegenerateTriangles(result);
    }
    
    // 2. Merge close vertices
    if (options.mergeVertices !== false) {
      result = this.mergeCloseVertices(result, options.mergeThreshold ?? 1e-6);
    }
    
    // 3. Remove duplicate triangles
    if (options.removeDuplicates !== false) {
      result = this.removeDuplicateTriangles(result);
    }
    
    // 4. Fix triangle winding (consistent orientation)
    if (options.fixWinding !== false) {
      result = this.fixTriangleWinding(result);
    }
    
    // 5. Recompute normals
    if (options.recomputeNormals !== false) {
      result = this.recomputeNormals(result, options.smoothNormals ?? true);
    }
    
    // 6. Recompute bounds
    result.bounds = this.computeBounds(result.positions);
    
    return result;
  }
  
  /**
   * Remove triangles with zero or near-zero area.
   */
  private removeDegenerateTriangles(
    mesh: ColumnarMesh, 
    areaThreshold: number = 1e-10
  ): ColumnarMesh {
    const validIndices: number[] = [];
    
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const i0 = mesh.indices[i];
      const i1 = mesh.indices[i + 1];
      const i2 = mesh.indices[i + 2];
      
      // Check for duplicate indices
      if (i0 === i1 || i1 === i2 || i2 === i0) continue;
      
      // Check triangle area
      const v0 = this.getVertex(mesh.positions, i0);
      const v1 = this.getVertex(mesh.positions, i1);
      const v2 = this.getVertex(mesh.positions, i2);
      
      const area = this.triangleArea(v0, v1, v2);
      if (area < areaThreshold) continue;
      
      validIndices.push(i0, i1, i2);
    }
    
    return {
      ...mesh,
      indices: new Uint32Array(validIndices),
    };
  }
  
  /**
   * Merge vertices that are closer than threshold.
   */
  private mergeCloseVertices(
    mesh: ColumnarMesh, 
    threshold: number
  ): ColumnarMesh {
    const vertexCount = mesh.positions.length / 3;
    const mapping = new Uint32Array(vertexCount);
    const uniquePositions: number[] = [];
    const uniqueNormals: number[] = [];
    
    // Spatial hash for fast lookup
    const cellSize = threshold * 10;
    const grid = new Map<string, number[]>();
    
    const hashVertex = (x: number, y: number, z: number): string => {
      const cx = Math.floor(x / cellSize);
      const cy = Math.floor(y / cellSize);
      const cz = Math.floor(z / cellSize);
      return `${cx},${cy},${cz}`;
    };
    
    for (let i = 0; i < vertexCount; i++) {
      const x = mesh.positions[i * 3];
      const y = mesh.positions[i * 3 + 1];
      const z = mesh.positions[i * 3 + 2];
      
      const hash = hashVertex(x, y, z);
      let merged = false;
      
      // Check nearby cells
      for (let dx = -1; dx <= 1 && !merged; dx++) {
        for (let dy = -1; dy <= 1 && !merged; dy++) {
          for (let dz = -1; dz <= 1 && !merged; dz++) {
            const cx = Math.floor(x / cellSize) + dx;
            const cy = Math.floor(y / cellSize) + dy;
            const cz = Math.floor(z / cellSize) + dz;
            const neighborHash = `${cx},${cy},${cz}`;
            
            const candidates = grid.get(neighborHash);
            if (!candidates) continue;
            
            for (const candidateIdx of candidates) {
              const cx = uniquePositions[candidateIdx * 3];
              const cy = uniquePositions[candidateIdx * 3 + 1];
              const cz = uniquePositions[candidateIdx * 3 + 2];
              
              const dist = Math.sqrt(
                (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2
              );
              
              if (dist < threshold) {
                mapping[i] = candidateIdx;
                merged = true;
                break;
              }
            }
          }
        }
      }
      
      if (!merged) {
        const newIdx = uniquePositions.length / 3;
        mapping[i] = newIdx;
        
        uniquePositions.push(x, y, z);
        uniqueNormals.push(
          mesh.normals[i * 3],
          mesh.normals[i * 3 + 1],
          mesh.normals[i * 3 + 2]
        );
        
        if (!grid.has(hash)) grid.set(hash, []);
        grid.get(hash)!.push(newIdx);
      }
    }
    
    // Remap indices
    const newIndices = new Uint32Array(mesh.indices.length);
    for (let i = 0; i < mesh.indices.length; i++) {
      newIndices[i] = mapping[mesh.indices[i]];
    }
    
    return {
      ...mesh,
      positions: new Float32Array(uniquePositions),
      normals: new Float32Array(uniqueNormals),
      indices: newIndices,
    };
  }
  
  /**
   * Recompute normals from geometry.
   */
  private recomputeNormals(mesh: ColumnarMesh, smooth: boolean): ColumnarMesh {
    const vertexCount = mesh.positions.length / 3;
    const normals = new Float32Array(mesh.normals.length);
    
    if (smooth) {
      // Accumulate face normals to vertices
      const normalAccum = new Float32Array(vertexCount * 3);
      
      for (let i = 0; i < mesh.indices.length; i += 3) {
        const i0 = mesh.indices[i];
        const i1 = mesh.indices[i + 1];
        const i2 = mesh.indices[i + 2];
        
        const v0 = this.getVertex(mesh.positions, i0);
        const v1 = this.getVertex(mesh.positions, i1);
        const v2 = this.getVertex(mesh.positions, i2);
        
        const faceNormal = this.computeFaceNormal(v0, v1, v2);
        
        // Weight by angle at each vertex
        const angles = this.computeAngles(v0, v1, v2);
        
        for (let j = 0; j < 3; j++) {
          const idx = mesh.indices[i + j];
          const weight = angles[j];
          normalAccum[idx * 3] += faceNormal[0] * weight;
          normalAccum[idx * 3 + 1] += faceNormal[1] * weight;
          normalAccum[idx * 3 + 2] += faceNormal[2] * weight;
        }
      }
      
      // Normalize
      for (let i = 0; i < vertexCount; i++) {
        const nx = normalAccum[i * 3];
        const ny = normalAccum[i * 3 + 1];
        const nz = normalAccum[i * 3 + 2];
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        
        if (len > 0) {
          normals[i * 3] = nx / len;
          normals[i * 3 + 1] = ny / len;
          normals[i * 3 + 2] = nz / len;
        }
      }
    } else {
      // Flat shading - each triangle gets its own vertices
      // This would require expanding the mesh
      // For now, just compute per-face normals assigned to vertices
      for (let i = 0; i < mesh.indices.length; i += 3) {
        const i0 = mesh.indices[i];
        const i1 = mesh.indices[i + 1];
        const i2 = mesh.indices[i + 2];
        
        const v0 = this.getVertex(mesh.positions, i0);
        const v1 = this.getVertex(mesh.positions, i1);
        const v2 = this.getVertex(mesh.positions, i2);
        
        const faceNormal = this.computeFaceNormal(v0, v1, v2);
        
        // Assign to all three vertices (last write wins)
        for (const idx of [i0, i1, i2]) {
          normals[idx * 3] = faceNormal[0];
          normals[idx * 3 + 1] = faceNormal[1];
          normals[idx * 3 + 2] = faceNormal[2];
        }
      }
    }
    
    return { ...mesh, normals };
  }
  
  private computeFaceNormal(
    v0: [number, number, number],
    v1: [number, number, number],
    v2: [number, number, number]
  ): [number, number, number] {
    const e1: [number, number, number] = [
      v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]
    ];
    const e2: [number, number, number] = [
      v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]
    ];
    
    const n: [number, number, number] = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    
    const len = Math.sqrt(n[0]**2 + n[1]**2 + n[2]**2);
    if (len < 1e-10) return [0, 0, 1];
    
    return [n[0]/len, n[1]/len, n[2]/len];
  }
}

interface RepairOptions {
  removeDegenerates?: boolean;
  mergeVertices?: boolean;
  mergeThreshold?: number;
  removeDuplicates?: boolean;
  fixWinding?: boolean;
  recomputeNormals?: boolean;
  smoothNormals?: boolean;
}
```

---

## Summary

This document completes the geometry pipeline specification with:

1. **Complete representation type coverage** - All common IFC geometry types
2. **Profile triangulation** - All profile types with earcut
3. **Curve discretization** - Lines, arcs, B-splines, composite curves
4. **Extrusion processing** - Most common geometry type, fully specified
5. **Geometry repair** - Handles real-world mesh issues

Together with Part 8 (Critical Solutions), this provides a complete foundation for implementing robust IFC geometry processing.
