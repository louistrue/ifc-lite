/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Simple Constraint Solver for Geometry Editing
 *
 * Provides basic geometric constraints: parallel, perpendicular, distance, etc.
 * More complex constraint solving would require a full parametric engine.
 */

import type { Vec3 } from '@ifc-lite/geometry';
import {
  type Constraint,
  type GeometryParameter,
  type ParameterValue,
  type Point2D,
  ConstraintType,
  ParameterType,
  normalizeVec3,
  dotVec3,
  crossVec3,
  subtractVec3,
  scaleVec3,
  addVec3,
  lengthVec3,
} from './types.js';

/**
 * Constraint solve result
 */
export interface ConstraintSolveResult {
  /** Whether constraint was satisfied */
  satisfied: boolean;
  /** Adjusted value (if constraint required adjustment) */
  adjustedValue?: ParameterValue;
  /** Distance from constraint (0 = satisfied) */
  error: number;
  /** Human-readable message */
  message?: string;
}

/**
 * Reference data for relational constraints
 */
export interface ConstraintReference {
  /** Reference entity ID */
  entityId: number;
  /** Reference parameter value */
  value: ParameterValue;
  /** Reference type */
  type: ParameterType;
}

/**
 * Simple geometric constraint solver
 */
export class ConstraintSolver {
  /** Tolerance for constraint satisfaction */
  private tolerance: number;

  constructor(tolerance: number = 0.001) {
    this.tolerance = tolerance;
  }

  /**
   * Check if a value satisfies a constraint
   */
  checkConstraint(
    constraint: Constraint,
    value: ParameterValue,
    parameterType: ParameterType,
    reference?: ConstraintReference
  ): ConstraintSolveResult {
    if (!constraint.enabled) {
      return { satisfied: true, error: 0 };
    }

    switch (constraint.type) {
      case ConstraintType.Positive:
        return this.checkPositive(value);

      case ConstraintType.MinValue:
        return this.checkMinValue(value, constraint.value || 0);

      case ConstraintType.MaxValue:
        return this.checkMaxValue(value, constraint.value || Infinity);

      case ConstraintType.ClosedProfile:
        return this.checkClosedProfile(value as Point2D[]);

      case ConstraintType.Parallel:
        if (reference && parameterType === ParameterType.Vec3) {
          return this.checkParallel(value as Vec3, reference.value as Vec3);
        }
        return { satisfied: true, error: 0 };

      case ConstraintType.Perpendicular:
        if (reference && parameterType === ParameterType.Vec3) {
          return this.checkPerpendicular(value as Vec3, reference.value as Vec3);
        }
        return { satisfied: true, error: 0 };

      case ConstraintType.Distance:
        if (reference && constraint.value !== undefined) {
          return this.checkDistance(
            value as Vec3,
            reference.value as Vec3,
            constraint.value
          );
        }
        return { satisfied: true, error: 0 };

      case ConstraintType.Coincident:
        if (reference) {
          return this.checkCoincident(value as Vec3, reference.value as Vec3);
        }
        return { satisfied: true, error: 0 };

      default:
        return { satisfied: true, error: 0 };
    }
  }

  /**
   * Solve constraints by adjusting value
   */
  solveConstraint(
    constraint: Constraint,
    value: ParameterValue,
    parameterType: ParameterType,
    reference?: ConstraintReference
  ): ConstraintSolveResult {
    if (!constraint.enabled) {
      return { satisfied: true, error: 0 };
    }

    switch (constraint.type) {
      case ConstraintType.Positive:
        return this.solvePositive(value);

      case ConstraintType.MinValue:
        return this.solveMinValue(value, constraint.value || 0);

      case ConstraintType.MaxValue:
        return this.solveMaxValue(value, constraint.value || Infinity);

      case ConstraintType.ClosedProfile:
        return this.solveClosedProfile(value as Point2D[]);

      case ConstraintType.Parallel:
        if (reference && parameterType === ParameterType.Vec3) {
          return this.solveParallel(value as Vec3, reference.value as Vec3);
        }
        return { satisfied: true, error: 0 };

      case ConstraintType.Perpendicular:
        if (reference && parameterType === ParameterType.Vec3) {
          return this.solvePerpendicular(value as Vec3, reference.value as Vec3);
        }
        return { satisfied: true, error: 0 };

      case ConstraintType.Distance:
        if (reference && constraint.value !== undefined) {
          return this.solveDistance(
            value as Vec3,
            reference.value as Vec3,
            constraint.value
          );
        }
        return { satisfied: true, error: 0 };

      default:
        return { satisfied: true, error: 0 };
    }
  }

  /**
   * Solve all constraints for a parameter
   */
  solveAllConstraints(
    parameter: GeometryParameter,
    value: ParameterValue,
    references: Map<number, ConstraintReference> = new Map()
  ): { value: ParameterValue; violations: Constraint[] } {
    let currentValue = value;
    const violations: Constraint[] = [];

    for (const constraint of parameter.constraints) {
      if (!constraint.enabled) continue;

      const reference = constraint.referenceEntityId
        ? references.get(constraint.referenceEntityId)
        : undefined;

      const result = this.solveConstraint(
        constraint,
        currentValue,
        parameter.type,
        reference
      );

      if (!result.satisfied) {
        violations.push(constraint);
      }

      if (result.adjustedValue !== undefined) {
        currentValue = result.adjustedValue;
      }
    }

    return { value: currentValue, violations };
  }

  // =========================================================================
  // Check Methods
  // =========================================================================

  private checkPositive(value: ParameterValue): ConstraintSolveResult {
    if (typeof value !== 'number') {
      return { satisfied: true, error: 0 };
    }

    const satisfied = value > 0;
    return {
      satisfied,
      error: satisfied ? 0 : Math.abs(value),
      message: satisfied ? undefined : 'Value must be positive',
    };
  }

  private checkMinValue(
    value: ParameterValue,
    minValue: number
  ): ConstraintSolveResult {
    if (typeof value !== 'number') {
      return { satisfied: true, error: 0 };
    }

    const satisfied = value >= minValue - this.tolerance;
    return {
      satisfied,
      error: satisfied ? 0 : minValue - value,
      message: satisfied ? undefined : `Value must be at least ${minValue}`,
    };
  }

  private checkMaxValue(
    value: ParameterValue,
    maxValue: number
  ): ConstraintSolveResult {
    if (typeof value !== 'number') {
      return { satisfied: true, error: 0 };
    }

    const satisfied = value <= maxValue + this.tolerance;
    return {
      satisfied,
      error: satisfied ? 0 : value - maxValue,
      message: satisfied ? undefined : `Value must be at most ${maxValue}`,
    };
  }

  private checkClosedProfile(points: Point2D[]): ConstraintSolveResult {
    if (!points || points.length < 3) {
      return {
        satisfied: false,
        error: 1,
        message: 'Profile must have at least 3 points',
      };
    }

    // Check if first and last points are close (or would be closed by IFC)
    const first = points[0];
    const last = points[points.length - 1];
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Profile is closed if last point is close to first, or if it has enough points
    // (IFC automatically closes profiles)
    const satisfied = distance < this.tolerance || points.length >= 3;

    return {
      satisfied,
      error: satisfied ? 0 : distance,
      message: satisfied ? undefined : 'Profile must be closed',
    };
  }

  private checkParallel(v1: Vec3, v2: Vec3): ConstraintSolveResult {
    const n1 = normalizeVec3(v1);
    const n2 = normalizeVec3(v2);

    // Vectors are parallel if cross product is near zero
    const cross = crossVec3(n1, n2);
    const error = lengthVec3(cross);

    const satisfied = error < this.tolerance;
    return {
      satisfied,
      error,
      message: satisfied ? undefined : 'Vectors must be parallel',
    };
  }

  private checkPerpendicular(v1: Vec3, v2: Vec3): ConstraintSolveResult {
    const n1 = normalizeVec3(v1);
    const n2 = normalizeVec3(v2);

    // Vectors are perpendicular if dot product is near zero
    const error = Math.abs(dotVec3(n1, n2));

    const satisfied = error < this.tolerance;
    return {
      satisfied,
      error,
      message: satisfied ? undefined : 'Vectors must be perpendicular',
    };
  }

  private checkDistance(
    p1: Vec3,
    p2: Vec3,
    targetDistance: number
  ): ConstraintSolveResult {
    const diff = subtractVec3(p2, p1);
    const actualDistance = lengthVec3(diff);
    const error = Math.abs(actualDistance - targetDistance);

    const satisfied = error < this.tolerance;
    return {
      satisfied,
      error,
      message: satisfied ? undefined : `Distance must be ${targetDistance}`,
    };
  }

  private checkCoincident(p1: Vec3, p2: Vec3): ConstraintSolveResult {
    const diff = subtractVec3(p2, p1);
    const error = lengthVec3(diff);

    const satisfied = error < this.tolerance;
    return {
      satisfied,
      error,
      message: satisfied ? undefined : 'Points must be coincident',
    };
  }

  // =========================================================================
  // Solve Methods (adjust value to satisfy constraint)
  // =========================================================================

  private solvePositive(value: ParameterValue): ConstraintSolveResult {
    if (typeof value !== 'number') {
      return { satisfied: true, error: 0 };
    }

    if (value > 0) {
      return { satisfied: true, error: 0 };
    }

    return {
      satisfied: true,
      error: 0,
      adjustedValue: this.tolerance,
    };
  }

  private solveMinValue(
    value: ParameterValue,
    minValue: number
  ): ConstraintSolveResult {
    if (typeof value !== 'number') {
      return { satisfied: true, error: 0 };
    }

    if (value >= minValue) {
      return { satisfied: true, error: 0 };
    }

    return {
      satisfied: true,
      error: 0,
      adjustedValue: minValue,
    };
  }

  private solveMaxValue(
    value: ParameterValue,
    maxValue: number
  ): ConstraintSolveResult {
    if (typeof value !== 'number') {
      return { satisfied: true, error: 0 };
    }

    if (value <= maxValue) {
      return { satisfied: true, error: 0 };
    }

    return {
      satisfied: true,
      error: 0,
      adjustedValue: maxValue,
    };
  }

  private solveClosedProfile(points: Point2D[]): ConstraintSolveResult {
    if (!points || points.length < 3) {
      return {
        satisfied: false,
        error: 1,
        message: 'Profile must have at least 3 points',
      };
    }

    const first = points[0];
    const last = points[points.length - 1];
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < this.tolerance) {
      return { satisfied: true, error: 0 };
    }

    // Close the profile by adjusting last point
    const adjustedPoints = [...points];
    adjustedPoints[adjustedPoints.length - 1] = { x: first.x, y: first.y };

    return {
      satisfied: true,
      error: 0,
      adjustedValue: adjustedPoints,
    };
  }

  private solveParallel(v: Vec3, reference: Vec3): ConstraintSolveResult {
    const refNorm = normalizeVec3(reference);
    const vNorm = normalizeVec3(v);

    // Check if already parallel
    const cross = crossVec3(vNorm, refNorm);
    const error = lengthVec3(cross);

    if (error < this.tolerance) {
      return { satisfied: true, error: 0 };
    }

    // Project v onto reference direction
    const len = lengthVec3(v);
    const dot = dotVec3(vNorm, refNorm);
    const sign = dot >= 0 ? 1 : -1;

    const adjusted = scaleVec3(refNorm, len * sign);

    return {
      satisfied: true,
      error: 0,
      adjustedValue: adjusted,
    };
  }

  private solvePerpendicular(v: Vec3, reference: Vec3): ConstraintSolveResult {
    const refNorm = normalizeVec3(reference);

    // Check if already perpendicular
    const dot = dotVec3(normalizeVec3(v), refNorm);
    if (Math.abs(dot) < this.tolerance) {
      return { satisfied: true, error: 0 };
    }

    // Remove component parallel to reference
    const len = lengthVec3(v);
    const parallel = scaleVec3(refNorm, dotVec3(v, refNorm));
    const perpendicular = subtractVec3(v, parallel);

    // If perpendicular component is too small, pick an arbitrary perpendicular
    if (lengthVec3(perpendicular) < this.tolerance) {
      // Create perpendicular by rotating around an axis
      let perp: Vec3;
      if (Math.abs(refNorm.x) < 0.9) {
        perp = crossVec3(refNorm, { x: 1, y: 0, z: 0 });
      } else {
        perp = crossVec3(refNorm, { x: 0, y: 1, z: 0 });
      }
      const adjusted = scaleVec3(normalizeVec3(perp), len);
      return { satisfied: true, error: 0, adjustedValue: adjusted };
    }

    // Normalize and scale to original length
    const adjusted = scaleVec3(normalizeVec3(perpendicular), len);

    return {
      satisfied: true,
      error: 0,
      adjustedValue: adjusted,
    };
  }

  private solveDistance(
    p1: Vec3,
    reference: Vec3,
    targetDistance: number
  ): ConstraintSolveResult {
    const diff = subtractVec3(p1, reference);
    const currentDistance = lengthVec3(diff);

    if (Math.abs(currentDistance - targetDistance) < this.tolerance) {
      return { satisfied: true, error: 0 };
    }

    // If points are coincident, pick a direction
    let direction: Vec3;
    if (currentDistance < this.tolerance) {
      direction = { x: 1, y: 0, z: 0 }; // Arbitrary direction
    } else {
      direction = normalizeVec3(diff);
    }

    // Adjust p1 to be at target distance from reference
    const adjusted = addVec3(reference, scaleVec3(direction, targetDistance));

    return {
      satisfied: true,
      error: 0,
      adjustedValue: adjusted,
    };
  }
}

/**
 * Create a constraint solver
 */
export function createConstraintSolver(tolerance?: number): ConstraintSolver {
  return new ConstraintSolver(tolerance);
}

/**
 * Apply a snap constraint to a value
 * Useful for snapping to grid, angles, etc.
 */
export function snapValue(
  value: number,
  snapInterval: number,
  offset: number = 0
): number {
  if (snapInterval <= 0) return value;
  return Math.round((value - offset) / snapInterval) * snapInterval + offset;
}

/**
 * Snap a Vec3 to grid
 */
export function snapVec3ToGrid(v: Vec3, gridSize: number): Vec3 {
  return {
    x: snapValue(v.x, gridSize),
    y: snapValue(v.y, gridSize),
    z: snapValue(v.z, gridSize),
  };
}

/**
 * Snap an angle to common increments (15, 30, 45, 90 degrees)
 */
export function snapAngle(
  radians: number,
  snapDegrees: number = 15
): number {
  const snapRadians = (snapDegrees * Math.PI) / 180;
  return snapValue(radians, snapRadians);
}
