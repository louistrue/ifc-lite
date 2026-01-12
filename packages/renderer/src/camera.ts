/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Camera and orbit controls
 */

import type { Camera as CameraType, Vec3, Mat4 } from './types.js';
import { MathUtils } from './math.js';

export class Camera {
  private camera: CameraType;
  private viewMatrix: Mat4;
  private projMatrix: Mat4;
  private viewProjMatrix: Mat4;

  // Inertia system
  private velocity = { orbit: { x: 0, y: 0 }, pan: { x: 0, y: 0 }, zoom: 0 };
  private damping = 0.92; // Inertia factor (0-1), higher = more damping
  private minVelocity = 0.001; // Minimum velocity threshold

  // Animation system
  private animationStartTime = 0;
  private animationDuration = 0;
  private animationStartPos: Vec3 | null = null;
  private animationStartTarget: Vec3 | null = null;
  private animationEndPos: Vec3 | null = null;
  private animationEndTarget: Vec3 | null = null;
  private animationStartUp: Vec3 | null = null;
  private animationEndUp: Vec3 | null = null;
  private animationEasing: ((t: number) => number) | null = null;

  // First-person mode
  private isFirstPersonMode = false;
  private firstPersonSpeed = 0.1;

  // Dynamic orbit pivot (for orbiting around selected element or cursor point)
  private orbitPivot: Vec3 | null = null;

  // Track preset view for rotation cycling (clicking same view rotates 90°)
  private lastPresetView: string | null = null;
  private presetViewRotation = 0; // 0, 1, 2, 3 = 0°, 90°, 180°, 270°

  constructor() {
    // Geometry is converted from IFC Z-up to WebGL Y-up during import
    this.camera = {
      position: { x: 50, y: 50, z: 100 },
      target: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 }, // Y-up (standard WebGL)
      fov: Math.PI / 4,
      aspect: 1,
      near: 0.1,
      far: 10000,
    };
    this.viewMatrix = MathUtils.identity();
    this.projMatrix = MathUtils.identity();
    this.viewProjMatrix = MathUtils.identity();
    this.updateMatrices();
  }

  /**
   * Set camera aspect ratio
   */
  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.updateMatrices();
  }

  /**
   * Set camera position
   */
  setPosition(x: number, y: number, z: number): void {
    this.camera.position = { x, y, z };
    this.updateMatrices();
  }

  /**
   * Set camera target
   */
  setTarget(x: number, y: number, z: number): void {
    this.camera.target = { x, y, z };
    this.updateMatrices();
  }

  /**
   * Set temporary orbit pivot (for orbiting around selected element or cursor point)
   * When set, orbit() will rotate around this point instead of the camera target
   */
  setOrbitPivot(pivot: Vec3 | null): void {
    this.orbitPivot = pivot ? { ...pivot } : null;
  }

  /**
   * Get current orbit pivot (returns temporary pivot if set, otherwise target)
   */
  getOrbitPivot(): Vec3 {
    return this.orbitPivot ? { ...this.orbitPivot } : { ...this.camera.target };
  }

  /**
   * Check if a temporary orbit pivot is set
   */
  hasOrbitPivot(): boolean {
    return this.orbitPivot !== null;
  }

  /**
   * Orbit around target or pivot (Y-up coordinate system)
   * If an orbit pivot is set, orbits around that point and moves target along
   */
  orbit(deltaX: number, deltaY: number, addVelocity = false): void {
    // Always ensure Y-up for consistent orbit behavior
    this.camera.up = { x: 0, y: 1, z: 0 };

    // Reset preset view tracking when user orbits
    this.lastPresetView = null;
    this.presetViewRotation = 0;

    // Invert controls: mouse movement direction = model rotation direction
    const dx = -deltaX * 0.01;
    const dy = -deltaY * 0.01;

    // Use orbit pivot if set, otherwise use target
    const pivotPoint = this.orbitPivot || this.camera.target;

    const dir = {
      x: this.camera.position.x - pivotPoint.x,
      y: this.camera.position.y - pivotPoint.y,
      z: this.camera.position.z - pivotPoint.z,
    };

    const distance = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
    if (distance < 1e-6) return;

    // Y-up coordinate system using standard spherical coordinates
    // theta: horizontal rotation around Y axis
    // phi: vertical angle from Y axis (0 = top, PI = bottom)
    let currentPhi = Math.acos(Math.max(-1, Math.min(1, dir.y / distance)));

    // When at poles (top/bottom view), use a stable theta based on current direction
    // to avoid gimbal lock issues
    let theta: number;
    const sinPhi = Math.sin(currentPhi);
    if (sinPhi > 0.05) {
      // Normal case - calculate theta from horizontal position
      theta = Math.atan2(dir.x, dir.z);
    } else {
      // At a pole - determine which one and push away
      theta = 0; // Default theta when at pole
      if (currentPhi < Math.PI / 2) {
        // Top pole (phi ≈ 0) - push down
        currentPhi = 0.15;
      } else {
        // Bottom pole (phi ≈ π) - push up
        currentPhi = Math.PI - 0.15;
      }
    }

    theta += dx;
    const phi = currentPhi + dy;

    // Clamp phi to prevent gimbal lock (stay away from exact poles)
    const phiClamped = Math.max(0.15, Math.min(Math.PI - 0.15, phi));

    // Calculate new camera position around pivot
    const newPosX = pivotPoint.x + distance * Math.sin(phiClamped) * Math.sin(theta);
    const newPosY = pivotPoint.y + distance * Math.cos(phiClamped);
    const newPosZ = pivotPoint.z + distance * Math.sin(phiClamped) * Math.cos(theta);

    // Update camera position
    this.camera.position.x = newPosX;
    this.camera.position.y = newPosY;
    this.camera.position.z = newPosZ;

    if (addVelocity) {
      this.velocity.orbit.x += deltaX * 0.001;
      this.velocity.orbit.y += deltaY * 0.001;
    }

    this.updateMatrices();
  }

  /**
   * Pan camera (Y-up coordinate system)
   */
  pan(deltaX: number, deltaY: number, addVelocity = false): void {
    const dir = {
      x: this.camera.position.x - this.camera.target.x,
      y: this.camera.position.y - this.camera.target.y,
      z: this.camera.position.z - this.camera.target.z,
    };
    const distance = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);

    // Right vector: cross product of direction and up (0,1,0)
    const right = {
      x: -dir.z,
      y: 0,
      z: dir.x,
    };
    const rightLen = Math.sqrt(right.x * right.x + right.z * right.z);
    if (rightLen > 1e-10) {
      right.x /= rightLen;
      right.z /= rightLen;
    }

    // Up vector: cross product of right and direction
    const up = {
      x: (right.z * dir.y - right.y * dir.z),
      y: (right.x * dir.z - right.z * dir.x),
      z: (right.y * dir.x - right.x * dir.y),
    };
    const upLen = Math.sqrt(up.x * up.x + up.y * up.y + up.z * up.z);
    if (upLen > 1e-10) {
      up.x /= upLen;
      up.y /= upLen;
      up.z /= upLen;
    }

    const panSpeed = distance * 0.001;
    this.camera.target.x += (right.x * deltaX + up.x * deltaY) * panSpeed;
    this.camera.target.y += (right.y * deltaX + up.y * deltaY) * panSpeed;
    this.camera.target.z += (right.z * deltaX + up.z * deltaY) * panSpeed;
    this.camera.position.x += (right.x * deltaX + up.x * deltaY) * panSpeed;
    this.camera.position.y += (right.y * deltaX + up.y * deltaY) * panSpeed;
    this.camera.position.z += (right.z * deltaX + up.z * deltaY) * panSpeed;

    if (addVelocity) {
      this.velocity.pan.x += deltaX * panSpeed * 0.1;
      this.velocity.pan.y += deltaY * panSpeed * 0.1;
    }

    this.updateMatrices();
  }

  /**
   * Zoom camera towards mouse position
   * @param delta - Zoom delta (positive = zoom out, negative = zoom in)
   * @param addVelocity - Whether to add velocity for inertia
   * @param mouseX - Mouse X position in canvas coordinates
   * @param mouseY - Mouse Y position in canvas coordinates
   * @param canvasWidth - Canvas width
   * @param canvasHeight - Canvas height
   */
  zoom(delta: number, addVelocity = false, mouseX?: number, mouseY?: number, canvasWidth?: number, canvasHeight?: number): void {
    const dir = {
      x: this.camera.position.x - this.camera.target.x,
      y: this.camera.position.y - this.camera.target.y,
      z: this.camera.position.z - this.camera.target.z,
    };
    const distance = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
    // Normalize delta (wheel events can have large values)
    const normalizedDelta = Math.sign(delta) * Math.min(Math.abs(delta) * 0.001, 0.1);
    const zoomFactor = 1 + normalizedDelta;

    // If mouse position provided, zoom towards that point
    if (mouseX !== undefined && mouseY !== undefined && canvasWidth && canvasHeight) {
      // Convert mouse to normalized device coordinates (-1 to 1)
      const ndcX = (mouseX / canvasWidth) * 2 - 1;
      const ndcY = 1 - (mouseY / canvasHeight) * 2; // Flip Y

      // Calculate offset from center in world space
      // Use the camera's right and up vectors
      const forward = {
        x: -dir.x / distance,
        y: -dir.y / distance,
        z: -dir.z / distance,
      };

      // Right = forward × up
      const up = this.camera.up;
      const right = {
        x: forward.y * up.z - forward.z * up.y,
        y: forward.z * up.x - forward.x * up.z,
        z: forward.x * up.y - forward.y * up.x,
      };
      const rightLen = Math.sqrt(right.x * right.x + right.y * right.y + right.z * right.z);
      if (rightLen > 1e-10) {
        right.x /= rightLen;
        right.y /= rightLen;
        right.z /= rightLen;
      }

      // Actual up = right × forward
      const actualUp = {
        x: right.y * forward.z - right.z * forward.y,
        y: right.z * forward.x - right.x * forward.z,
        z: right.x * forward.y - right.y * forward.x,
      };

      // Calculate view frustum size at target distance
      const halfHeight = distance * Math.tan(this.camera.fov / 2);
      const halfWidth = halfHeight * this.camera.aspect;

      // World offset from center towards mouse position
      const worldOffsetX = ndcX * halfWidth;
      const worldOffsetY = ndcY * halfHeight;

      // Point in world space that mouse is pointing at (on the target plane)
      const mouseWorldPoint = {
        x: this.camera.target.x + right.x * worldOffsetX + actualUp.x * worldOffsetY,
        y: this.camera.target.y + right.y * worldOffsetX + actualUp.y * worldOffsetY,
        z: this.camera.target.z + right.z * worldOffsetX + actualUp.z * worldOffsetY,
      };

      // Move both camera and target towards mouse point while zooming
      const moveAmount = (1 - zoomFactor); // Negative when zooming in

      this.camera.target.x += (mouseWorldPoint.x - this.camera.target.x) * moveAmount;
      this.camera.target.y += (mouseWorldPoint.y - this.camera.target.y) * moveAmount;
      this.camera.target.z += (mouseWorldPoint.z - this.camera.target.z) * moveAmount;
    }

    // Apply zoom (scale distance)
    const newDistance = Math.max(0.1, distance * zoomFactor);
    const scale = newDistance / distance;

    this.camera.position.x = this.camera.target.x + dir.x * scale;
    this.camera.position.y = this.camera.target.y + dir.y * scale;
    this.camera.position.z = this.camera.target.z + dir.z * scale;

    if (addVelocity) {
      this.velocity.zoom += normalizedDelta * 0.1;
    }

    this.updateMatrices();
  }

  /**
   * Fit view to bounding box
   * Sets camera to southeast isometric view (typical BIM starting view)
   * Y-up coordinate system: Y is vertical
   */
  fitToBounds(min: Vec3, max: Vec3): void {
    const center = {
      x: (min.x + max.x) / 2,
      y: (min.y + max.y) / 2,
      z: (min.z + max.z) / 2,
    };
    const size = {
      x: max.x - min.x,
      y: max.y - min.y,
      z: max.z - min.z,
    };
    const maxSize = Math.max(size.x, size.y, size.z);
    const distance = maxSize * 2.0;

    this.camera.target = center;

    // Southeast isometric view for Y-up:
    // Position camera above and to the front-right of the model
    this.camera.position = {
      x: center.x + distance * 0.6,   // Right
      y: center.y + distance * 0.5,   // Above
      z: center.z + distance * 0.6,   // Front
    };

    // Adjust far plane for large models
    this.camera.far = Math.max(10000, distance * 20);
    this.camera.near = Math.max(0.01, distance * 0.0001);

    this.updateMatrices();
  }

  /**
   * Update camera animation and inertia
   * Returns true if camera is still animating
   */
  update(_deltaTime: number): boolean {
    // deltaTime reserved for future physics-based animation smoothing
    void _deltaTime;
    let isAnimating = false;

    // Handle animation
    if (this.animationStartTime > 0 && this.animationDuration > 0) {
      const elapsed = Date.now() - this.animationStartTime;
      const progress = Math.min(elapsed / this.animationDuration, 1);

      if (progress < 1 && this.animationStartPos && this.animationEndPos &&
        this.animationStartTarget && this.animationEndTarget && this.animationEasing) {
        const t = this.animationEasing(progress);
        this.camera.position.x = this.animationStartPos.x + (this.animationEndPos.x - this.animationStartPos.x) * t;
        this.camera.position.y = this.animationStartPos.y + (this.animationEndPos.y - this.animationStartPos.y) * t;
        this.camera.position.z = this.animationStartPos.z + (this.animationEndPos.z - this.animationStartPos.z) * t;
        this.camera.target.x = this.animationStartTarget.x + (this.animationEndTarget.x - this.animationStartTarget.x) * t;
        this.camera.target.y = this.animationStartTarget.y + (this.animationEndTarget.y - this.animationStartTarget.y) * t;
        this.camera.target.z = this.animationStartTarget.z + (this.animationEndTarget.z - this.animationStartTarget.z) * t;

        // Interpolate up vector if animating with up
        if (this.animationStartUp && this.animationEndUp) {
          // SLERP-like interpolation for up vector (normalized lerp)
          let upX = this.animationStartUp.x + (this.animationEndUp.x - this.animationStartUp.x) * t;
          let upY = this.animationStartUp.y + (this.animationEndUp.y - this.animationStartUp.y) * t;
          let upZ = this.animationStartUp.z + (this.animationEndUp.z - this.animationStartUp.z) * t;
          // Normalize
          const len = Math.sqrt(upX * upX + upY * upY + upZ * upZ);
          if (len > 0.0001) {
            this.camera.up.x = upX / len;
            this.camera.up.y = upY / len;
            this.camera.up.z = upZ / len;
          }
        }

        this.updateMatrices();
        isAnimating = true;
      } else {
        // Animation complete - set final values
        if (this.animationEndPos) {
          this.camera.position.x = this.animationEndPos.x;
          this.camera.position.y = this.animationEndPos.y;
          this.camera.position.z = this.animationEndPos.z;
        }
        if (this.animationEndTarget) {
          this.camera.target.x = this.animationEndTarget.x;
          this.camera.target.y = this.animationEndTarget.y;
          this.camera.target.z = this.animationEndTarget.z;
        }
        if (this.animationEndUp) {
          this.camera.up.x = this.animationEndUp.x;
          this.camera.up.y = this.animationEndUp.y;
          this.camera.up.z = this.animationEndUp.z;
        }
        this.updateMatrices();

        this.animationStartTime = 0;
        this.animationDuration = 0;
        this.animationStartPos = null;
        this.animationEndPos = null;
        this.animationStartTarget = null;
        this.animationEndTarget = null;
        this.animationStartUp = null;
        this.animationEndUp = null;
        this.animationEasing = null;
      }
    }

    // Apply inertia
    if (Math.abs(this.velocity.orbit.x) > this.minVelocity || Math.abs(this.velocity.orbit.y) > this.minVelocity) {
      this.orbit(this.velocity.orbit.x * 100, this.velocity.orbit.y * 100, false);
      this.velocity.orbit.x *= this.damping;
      this.velocity.orbit.y *= this.damping;
      isAnimating = true;
    }

    if (Math.abs(this.velocity.pan.x) > this.minVelocity || Math.abs(this.velocity.pan.y) > this.minVelocity) {
      this.pan(this.velocity.pan.x * 1000, this.velocity.pan.y * 1000, false);
      this.velocity.pan.x *= this.damping;
      this.velocity.pan.y *= this.damping;
      isAnimating = true;
    }

    if (Math.abs(this.velocity.zoom) > this.minVelocity) {
      this.zoom(this.velocity.zoom * 1000, false);
      this.velocity.zoom *= this.damping;
      isAnimating = true;
    }

    return isAnimating;
  }

  /**
   * Animate camera to fit bounds (southeast isometric view)
   * Y-up coordinate system
   */
  async zoomToFit(min: Vec3, max: Vec3, duration = 500): Promise<void> {
    const center = {
      x: (min.x + max.x) / 2,
      y: (min.y + max.y) / 2,
      z: (min.z + max.z) / 2,
    };
    const size = {
      x: max.x - min.x,
      y: max.y - min.y,
      z: max.z - min.z,
    };
    const maxSize = Math.max(size.x, size.y, size.z);
    const distance = maxSize * 2.0;

    const endTarget = center;
    // Southeast isometric view for Y-up (same as fitToBounds)
    const endPos = {
      x: center.x + distance * 0.6,
      y: center.y + distance * 0.5,
      z: center.z + distance * 0.6,
    };

    return this.animateTo(endPos, endTarget, duration);
  }

  /**
   * Zoom to fit bounds WITHOUT changing view direction
   * Just centers on bounds and adjusts distance to fit
   */
  /**
   * Frame/center view on a point (keeps current distance and direction)
   * Standard CAD "Frame Selection" behavior
   */
  async framePoint(point: Vec3, duration = 300): Promise<void> {
    // Keep current viewing direction and distance
    const dir = {
      x: this.camera.position.x - this.camera.target.x,
      y: this.camera.position.y - this.camera.target.y,
      z: this.camera.position.z - this.camera.target.z,
    };

    // New position: point + current offset
    const endPos = {
      x: point.x + dir.x,
      y: point.y + dir.y,
      z: point.z + dir.z,
    };

    return this.animateTo(endPos, point, duration);
  }

  /**
   * Frame selection - zoom to fit bounds while keeping current view direction
   * This is what "Frame Selection" should do - zoom to fill screen
   */
  async frameBounds(min: Vec3, max: Vec3, duration = 300): Promise<void> {
    const center = {
      x: (min.x + max.x) / 2,
      y: (min.y + max.y) / 2,
      z: (min.z + max.z) / 2,
    };
    const size = {
      x: max.x - min.x,
      y: max.y - min.y,
      z: max.z - min.z,
    };
    const maxSize = Math.max(size.x, size.y, size.z);

    if (maxSize < 1e-6) {
      // Very small or zero size - just center on it
      return this.framePoint(center, duration);
    }

    // Calculate required distance based on FOV to fit bounds
    const fovFactor = Math.tan(this.camera.fov / 2);
    const distance = (maxSize / 2) / fovFactor * 1.2; // 1.2x padding for nice framing

    // Get current viewing direction from view matrix (more reliable than position-target)
    // View matrix forward is -Z axis in view space
    const viewMatrix = this.viewMatrix.m;
    // Extract forward direction from view matrix (negative Z column, normalized)
    let dir = {
      x: -viewMatrix[8],   // -m[2][0] (forward X)
      y: -viewMatrix[9],   // -m[2][1] (forward Y)
      z: -viewMatrix[10],  // -m[2][2] (forward Z)
    };
    const dirLen = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);

    // Normalize direction
    if (dirLen > 1e-6) {
      dir.x /= dirLen;
      dir.y /= dirLen;
      dir.z /= dirLen;
    } else {
      // Fallback: use position-target if view matrix is invalid
      dir = {
        x: this.camera.position.x - this.camera.target.x,
        y: this.camera.position.y - this.camera.target.y,
        z: this.camera.position.z - this.camera.target.z,
      };
      const fallbackLen = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
      if (fallbackLen > 1e-6) {
        dir.x /= fallbackLen;
        dir.y /= fallbackLen;
        dir.z /= fallbackLen;
      } else {
        // Last resort: southeast isometric
        dir.x = 0.6;
        dir.y = 0.5;
        dir.z = 0.6;
        const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
        dir.x /= len;
        dir.y /= len;
        dir.z /= len;
      }
    }

    // New position: center + direction * distance
    const endPos = {
      x: center.x + dir.x * distance,
      y: center.y + dir.y * distance,
      z: center.z + dir.z * distance,
    };

    return this.animateTo(endPos, center, duration);
  }

  async zoomExtent(min: Vec3, max: Vec3, duration = 300): Promise<void> {
    const center = {
      x: (min.x + max.x) / 2,
      y: (min.y + max.y) / 2,
      z: (min.z + max.z) / 2,
    };
    const size = {
      x: max.x - min.x,
      y: max.y - min.y,
      z: max.z - min.z,
    };
    const maxSize = Math.max(size.x, size.y, size.z);

    // Calculate required distance based on FOV
    const fovFactor = Math.tan(this.camera.fov / 2);
    const distance = (maxSize / 2) / fovFactor * 1.5; // 1.5x for padding

    // Keep current viewing direction
    const dir = {
      x: this.camera.position.x - this.camera.target.x,
      y: this.camera.position.y - this.camera.target.y,
      z: this.camera.position.z - this.camera.target.z,
    };
    const currentDistance = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);

    // Normalize direction
    if (currentDistance > 1e-10) {
      dir.x /= currentDistance;
      dir.y /= currentDistance;
      dir.z /= currentDistance;
    } else {
      // Fallback direction
      dir.x = 0.6;
      dir.y = 0.5;
      dir.z = 0.6;
      const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
      dir.x /= len;
      dir.y /= len;
      dir.z /= len;
    }

    // New position: center + direction * distance
    const endPos = {
      x: center.x + dir.x * distance,
      y: center.y + dir.y * distance,
      z: center.z + dir.z * distance,
    };

    return this.animateTo(endPos, center, duration);
  }

  /**
   * Animate camera to position and target
   */
  async animateTo(endPos: Vec3, endTarget: Vec3, duration = 500): Promise<void> {
    this.animationStartPos = { ...this.camera.position };
    this.animationStartTarget = { ...this.camera.target };
    this.animationEndPos = endPos;
    this.animationEndTarget = endTarget;
    this.animationStartUp = null;
    this.animationEndUp = null;
    this.animationDuration = duration;
    this.animationStartTime = Date.now();
    this.animationEasing = this.easeOutCubic;

    // Wait for animation to complete
    return new Promise((resolve) => {
      const checkAnimation = () => {
        if (this.animationStartTime === 0) {
          resolve();
        } else {
          requestAnimationFrame(checkAnimation);
        }
      };
      checkAnimation();
    });
  }

  /**
   * Animate camera to position, target, and up vector (for orthogonal preset views)
   */
  async animateToWithUp(endPos: Vec3, endTarget: Vec3, endUp: Vec3, duration = 500): Promise<void> {
    // Clear all velocities to prevent inertia from interfering with animation
    this.velocity.orbit.x = 0;
    this.velocity.orbit.y = 0;
    this.velocity.pan.x = 0;
    this.velocity.pan.y = 0;
    this.velocity.zoom = 0;

    this.animationStartPos = { ...this.camera.position };
    this.animationStartTarget = { ...this.camera.target };
    this.animationStartUp = { ...this.camera.up };
    this.animationEndPos = endPos;
    this.animationEndTarget = endTarget;
    this.animationEndUp = endUp;
    this.animationDuration = duration;
    this.animationStartTime = Date.now();
    this.animationEasing = this.easeOutCubic;

    // Wait for animation to complete
    return new Promise((resolve) => {
      const checkAnimation = () => {
        if (this.animationStartTime === 0) {
          resolve();
        } else {
          requestAnimationFrame(checkAnimation);
        }
      };
      checkAnimation();
    });
  }

  /**
   * Easing function: easeOutCubic
   */
  private easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }

  /**
   * Set first-person mode
   */
  enableFirstPersonMode(enabled: boolean): void {
    this.isFirstPersonMode = enabled;
  }

  /**
   * Move in first-person mode (Y-up coordinate system)
   */
  moveFirstPerson(forward: number, right: number, up: number): void {
    if (!this.isFirstPersonMode) return;

    const dir = {
      x: this.camera.target.x - this.camera.position.x,
      y: this.camera.target.y - this.camera.position.y,
      z: this.camera.target.z - this.camera.position.z,
    };
    const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
    if (len > 1e-10) {
      dir.x /= len;
      dir.y /= len;
      dir.z /= len;
    }

    // Right vector: cross product of direction and up (0,1,0)
    const rightVec = {
      x: -dir.z,
      y: 0,
      z: dir.x,
    };
    const rightLen = Math.sqrt(rightVec.x * rightVec.x + rightVec.z * rightVec.z);
    if (rightLen > 1e-10) {
      rightVec.x /= rightLen;
      rightVec.z /= rightLen;
    }

    // Up vector: cross product of right and direction
    const upVec = {
      x: (rightVec.z * dir.y - rightVec.y * dir.z),
      y: (rightVec.x * dir.z - rightVec.z * dir.x),
      z: (rightVec.y * dir.x - rightVec.x * dir.y),
    };

    const speed = this.firstPersonSpeed;
    this.camera.position.x += (dir.x * forward + rightVec.x * right + upVec.x * up) * speed;
    this.camera.position.y += (dir.y * forward + rightVec.y * right + upVec.y * up) * speed;
    this.camera.position.z += (dir.z * forward + rightVec.z * right + upVec.z * up) * speed;
    this.camera.target.x += (dir.x * forward + rightVec.x * right + upVec.x * up) * speed;
    this.camera.target.y += (dir.y * forward + rightVec.y * right + upVec.y * up) * speed;
    this.camera.target.z += (dir.z * forward + rightVec.z * right + upVec.z * up) * speed;

    this.updateMatrices();
  }

  /**
   * Set preset view with explicit bounds (Y-up coordinate system)
   * Clicking the same view again rotates 90° around the view axis
   */
  setPresetView(
    view: 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right',
    bounds?: { min: Vec3; max: Vec3 }
  ): void {
    const useBounds = bounds || this.getCurrentBounds();
    if (!useBounds) {
      console.warn('[Camera] No bounds available for setPresetView');
      return;
    }

    // Check if clicking the same view again - cycle rotation
    if (this.lastPresetView === view) {
      this.presetViewRotation = (this.presetViewRotation + 1) % 4;
    } else {
      this.lastPresetView = view;
      this.presetViewRotation = 0;
    }

    const center = {
      x: (useBounds.min.x + useBounds.max.x) / 2,
      y: (useBounds.min.y + useBounds.max.y) / 2,
      z: (useBounds.min.z + useBounds.max.z) / 2,
    };
    const size = {
      x: useBounds.max.x - useBounds.min.x,
      y: useBounds.max.y - useBounds.min.y,
      z: useBounds.max.z - useBounds.min.z,
    };
    const maxSize = Math.max(size.x, size.y, size.z);

    // Calculate distance based on FOV for proper fit
    const fovFactor = Math.tan(this.camera.fov / 2);
    const distance = (maxSize / 2) / fovFactor * 1.5; // 1.5x for padding

    let endPos: Vec3;
    const endTarget = center;

    // WebGL uses Y-up coordinate system internally
    // We set both position AND up vector for proper orthogonal views
    let upVector: Vec3 = { x: 0, y: 1, z: 0 }; // Default Y-up

    // Up vector rotation options for top/bottom views (rotate around Y axis)
    // 0: -Z, 1: -X, 2: +Z, 3: +X
    const topUpVectors: Vec3[] = [
      { x: 0, y: 0, z: -1 },  // 0° - North up
      { x: -1, y: 0, z: 0 },  // 90° - West up
      { x: 0, y: 0, z: 1 },   // 180° - South up
      { x: 1, y: 0, z: 0 },   // 270° - East up
    ];
    const bottomUpVectors: Vec3[] = [
      { x: 0, y: 0, z: 1 },   // 0° - South up
      { x: 1, y: 0, z: 0 },   // 90° - East up
      { x: 0, y: 0, z: -1 },  // 180° - North up
      { x: -1, y: 0, z: 0 },  // 270° - West up
    ];

    switch (view) {
      case 'top':
        // Top view: looking straight down from above (+Y)
        endPos = { x: center.x, y: center.y + distance, z: center.z };
        upVector = topUpVectors[this.presetViewRotation];
        break;
      case 'bottom':
        // Bottom view: looking straight up from below (-Y)
        endPos = { x: center.x, y: center.y - distance, z: center.z };
        upVector = bottomUpVectors[this.presetViewRotation];
        break;
      case 'front':
        // Front view: from +Z looking at model
        endPos = { x: center.x, y: center.y, z: center.z + distance };
        upVector = { x: 0, y: 1, z: 0 }; // Y-up
        break;
      case 'back':
        // Back view: from -Z looking at model
        endPos = { x: center.x, y: center.y, z: center.z - distance };
        upVector = { x: 0, y: 1, z: 0 }; // Y-up
        break;
      case 'left':
        // Left view: from -X looking at model
        endPos = { x: center.x - distance, y: center.y, z: center.z };
        upVector = { x: 0, y: 1, z: 0 }; // Y-up
        break;
      case 'right':
        // Right view: from +X looking at model
        endPos = { x: center.x + distance, y: center.y, z: center.z };
        upVector = { x: 0, y: 1, z: 0 }; // Y-up
        break;
    }

    this.animateToWithUp(endPos, endTarget, upVector, 300);
  }

  /**
   * Get current bounds estimate (simplified - in production would use scene bounds)
   */
  private getCurrentBounds(): { min: Vec3; max: Vec3 } | null {
    // Estimate bounds from camera distance
    const dir = {
      x: this.camera.position.x - this.camera.target.x,
      y: this.camera.position.y - this.camera.target.y,
      z: this.camera.position.z - this.camera.target.z,
    };
    const distance = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
    const size = distance / 2;

    return {
      min: {
        x: this.camera.target.x - size,
        y: this.camera.target.y - size,
        z: this.camera.target.z - size,
      },
      max: {
        x: this.camera.target.x + size,
        y: this.camera.target.y + size,
        z: this.camera.target.z + size,
      },
    };
  }

  /**
   * Reset velocity (stop inertia)
   */
  stopInertia(): void {
    this.velocity.orbit.x = 0;
    this.velocity.orbit.y = 0;
    this.velocity.pan.x = 0;
    this.velocity.pan.y = 0;
    this.velocity.zoom = 0;
  }

  /**
   * Reset camera state (clear orbit pivot, stop inertia, cancel animations)
   * Called when loading a new model to ensure clean state
   */
  reset(): void {
    this.orbitPivot = null;
    this.stopInertia();
    // Cancel any ongoing animations
    this.animationStartTime = 0;
    this.animationDuration = 0;
    this.animationStartPos = null;
    this.animationStartTarget = null;
    this.animationEndPos = null;
    this.animationEndTarget = null;
    this.animationStartUp = null;
    this.animationEndUp = null;
    this.animationEasing = null;
    // Reset preset view tracking
    this.lastPresetView = null;
    this.presetViewRotation = 0;
  }

  getViewProjMatrix(): Mat4 {
    return this.viewProjMatrix;
  }

  getPosition(): Vec3 {
    return { ...this.camera.position };
  }

  getTarget(): Vec3 {
    return { ...this.camera.target };
  }

  /**
   * Get camera FOV in radians
   */
  getFOV(): number {
    return this.camera.fov;
  }

  /**
   * Get distance from camera position to target
   */
  getDistance(): number {
    const dir = {
      x: this.camera.position.x - this.camera.target.x,
      y: this.camera.position.y - this.camera.target.y,
      z: this.camera.position.z - this.camera.target.z,
    };
    return Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
  }

  /**
   * Get current camera rotation angles in degrees
   * Returns { azimuth, elevation } where:
   * - azimuth: horizontal rotation (0-360), 0 = front
   * - elevation: vertical rotation (-90 to 90), 0 = horizon
   */
  getRotation(): { azimuth: number; elevation: number } {
    const dir = {
      x: this.camera.position.x - this.camera.target.x,
      y: this.camera.position.y - this.camera.target.y,
      z: this.camera.position.z - this.camera.target.z,
    };
    const distance = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
    if (distance < 1e-6) return { azimuth: 0, elevation: 0 };

    // Elevation: angle from horizontal plane
    const elevation = Math.asin(Math.max(-1, Math.min(1, dir.y / distance))) * 180 / Math.PI;

    // Calculate azimuth smoothly using up vector
    // The up vector defines the "screen up" direction, which determines rotation
    const upX = this.camera.up.x;
    const upY = this.camera.up.y;
    const upZ = this.camera.up.z;

    // Project up vector onto horizontal plane (XZ plane)
    const upLen = Math.sqrt(upX * upX + upZ * upZ);

    let azimuth: number;
    if (upLen > 0.01) {
      // Use up vector projection for azimuth (smooth and consistent)
      azimuth = (Math.atan2(-upX, -upZ) * 180 / Math.PI + 360) % 360;

      // For bottom view, flip azimuth
      if (elevation < -80 && upY < 0) {
        azimuth = (azimuth + 180) % 360;
      }
    } else {
      // Fallback: use position-based azimuth when up vector is vertical
      azimuth = (Math.atan2(dir.x, dir.z) * 180 / Math.PI + 360) % 360;
    }

    return { azimuth, elevation };
  }

  /**
   * Project a world position to screen coordinates
   * @param worldPos - Position in world space
   * @param canvasWidth - Canvas width in pixels
   * @param canvasHeight - Canvas height in pixels
   * @returns Screen coordinates { x, y } or null if behind camera
   */
  projectToScreen(worldPos: Vec3, canvasWidth: number, canvasHeight: number): { x: number; y: number } | null {
    // Transform world position by view-projection matrix
    const m = this.viewProjMatrix.m;

    // Manual matrix-vector multiplication for vec4(worldPos, 1.0)
    const clipX = m[0] * worldPos.x + m[4] * worldPos.y + m[8] * worldPos.z + m[12];
    const clipY = m[1] * worldPos.x + m[5] * worldPos.y + m[9] * worldPos.z + m[13];
    const clipZ = m[2] * worldPos.x + m[6] * worldPos.y + m[10] * worldPos.z + m[14];
    const clipW = m[3] * worldPos.x + m[7] * worldPos.y + m[11] * worldPos.z + m[15];

    // Check if behind camera
    if (clipW <= 0) {
      return null;
    }

    // Perspective divide to get NDC
    const ndcX = clipX / clipW;
    const ndcY = clipY / clipW;
    const ndcZ = clipZ / clipW;

    // Check if outside clip volume
    if (ndcZ < -1 || ndcZ > 1) {
      return null;
    }

    // Convert NDC to screen coordinates
    // NDC: (-1,-1) = bottom-left, (1,1) = top-right
    // Screen: (0,0) = top-left, (width, height) = bottom-right
    const screenX = (ndcX + 1) * 0.5 * canvasWidth;
    const screenY = (1 - ndcY) * 0.5 * canvasHeight; // Flip Y

    return { x: screenX, y: screenY };
  }

  private updateMatrices(): void {
    this.viewMatrix = MathUtils.lookAt(
      this.camera.position,
      this.camera.target,
      this.camera.up
    );
    this.projMatrix = MathUtils.perspective(
      this.camera.fov,
      this.camera.aspect,
      this.camera.near,
      this.camera.far
    );
    this.viewProjMatrix = MathUtils.multiply(this.projMatrix, this.viewMatrix);
  }
}
