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
  private animationEasing: ((t: number) => number) | null = null;

  // First-person mode
  private isFirstPersonMode = false;
  private firstPersonSpeed = 0.1;

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
   * Orbit around target (Y-up coordinate system)
   */
  orbit(deltaX: number, deltaY: number, addVelocity = false): void {
    // Invert controls: mouse movement direction = model rotation direction
    const dx = -deltaX * 0.01;
    const dy = -deltaY * 0.01;

    const dir = {
      x: this.camera.position.x - this.camera.target.x,
      y: this.camera.position.y - this.camera.target.y,
      z: this.camera.position.z - this.camera.target.z,
    };

    const distance = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);

    // Y-up coordinate system using standard spherical coordinates
    // theta: horizontal rotation around Y axis
    // phi: vertical angle from Y axis (0 = top, PI = bottom)
    const theta = Math.atan2(dir.x, dir.z) + dx;
    const currentPhi = Math.acos(Math.max(-1, Math.min(1, dir.y / distance)));
    const phi = currentPhi + dy;

    // Clamp phi to prevent gimbal lock and going below ground
    const phiClamped = Math.max(0.1, Math.min(Math.PI - 0.1, phi));

    // Calculate new position
    this.camera.position.x = this.camera.target.x + distance * Math.sin(phiClamped) * Math.sin(theta);
    this.camera.position.y = this.camera.target.y + distance * Math.cos(phiClamped);
    this.camera.position.z = this.camera.target.z + distance * Math.sin(phiClamped) * Math.cos(theta);

    if (addVelocity) {
      // Store original delta (not inverted) since orbit() will invert it
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

    console.log('[Camera] fitToBounds:', {
      min, max, center, size, maxSize, distance,
      position: this.camera.position,
      target: this.camera.target,
      near: this.camera.near,
      far: this.camera.far,
    });

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
        this.updateMatrices();
        isAnimating = true;
      } else {
        // Animation complete
        this.animationStartTime = 0;
        this.animationDuration = 0;
        this.animationStartPos = null;
        this.animationEndPos = null;
        this.animationStartTarget = null;
        this.animationEndTarget = null;
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
   * Animate camera to position and target
   */
  async animateTo(endPos: Vec3, endTarget: Vec3, duration = 500): Promise<void> {
    this.animationStartPos = { ...this.camera.position };
    this.animationStartTarget = { ...this.camera.target };
    this.animationEndPos = endPos;
    this.animationEndTarget = endTarget;
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
   * Set preset view (Y-up coordinate system)
   */
  setPresetView(view: 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right'): void {
    const bounds = this.getCurrentBounds();
    if (!bounds) return;

    const center = {
      x: (bounds.min.x + bounds.max.x) / 2,
      y: (bounds.min.y + bounds.max.y) / 2,
      z: (bounds.min.z + bounds.max.z) / 2,
    };
    const size = {
      x: bounds.max.x - bounds.min.x,
      y: bounds.max.y - bounds.min.y,
      z: bounds.max.z - bounds.min.z,
    };
    const maxSize = Math.max(size.x, size.y, size.z);
    const distance = maxSize * 2.0;

    let endPos: Vec3;
    const endTarget = center;

    switch (view) {
      case 'top':
        // Top view: looking straight down from above (+Y)
        endPos = { x: center.x, y: center.y + distance, z: center.z };
        break;
      case 'bottom':
        // Bottom view: looking straight up from below (-Y)
        endPos = { x: center.x, y: center.y - distance, z: center.z };
        break;
      case 'front':
        // Front view: from +Z looking at model
        endPos = { x: center.x, y: center.y, z: center.z + distance };
        break;
      case 'back':
        // Back view: from -Z looking at model
        endPos = { x: center.x, y: center.y, z: center.z - distance };
        break;
      case 'left':
        // Left view: from -X looking at model
        endPos = { x: center.x - distance, y: center.y, z: center.z };
        break;
      case 'right':
        // Right view: from +X looking at model
        endPos = { x: center.x + distance, y: center.y, z: center.z };
        break;
    }

    this.animateTo(endPos, endTarget, 300);
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

    // Azimuth: angle around Y axis (0 = +Z direction, 90 = +X)
    const azimuth = (Math.atan2(dir.x, dir.z) * 180 / Math.PI + 360) % 360;

    // Elevation: angle from horizontal plane
    const elevation = Math.asin(Math.max(-1, Math.min(1, dir.y / distance))) * 180 / Math.PI;

    return { azimuth, elevation };
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
