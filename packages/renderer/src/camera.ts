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

  constructor() {
    // IFC uses Z-up coordinate system, so we set up: {0, 0, 1}
    this.camera = {
      position: { x: 0, y: -100, z: 50 },
      target: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 0, z: 1 }, // Z-up for IFC compatibility
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
   * Orbit around target
   */
  orbit(deltaX: number, deltaY: number): void {
    const dx = deltaX * 0.01;
    const dy = deltaY * 0.01;

    const dir = {
      x: this.camera.position.x - this.camera.target.x,
      y: this.camera.position.y - this.camera.target.y,
      z: this.camera.position.z - this.camera.target.z,
    };

    const distance = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
    const theta = Math.atan2(dir.x, dir.z) + dx;
    const phi = Math.acos(dir.y / distance) + dy;
    const phiClamped = Math.max(0.1, Math.min(Math.PI - 0.1, phi));

    this.camera.position.x = this.camera.target.x + distance * Math.sin(phiClamped) * Math.sin(theta);
    this.camera.position.y = this.camera.target.y + distance * Math.cos(phiClamped);
    this.camera.position.z = this.camera.target.z + distance * Math.sin(phiClamped) * Math.cos(theta);

    this.updateMatrices();
  }

  /**
   * Pan camera
   */
  pan(deltaX: number, deltaY: number): void {
    const dir = {
      x: this.camera.position.x - this.camera.target.x,
      y: this.camera.position.y - this.camera.target.y,
      z: this.camera.position.z - this.camera.target.z,
    };
    const distance = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);

    const right = {
      x: -dir.z,
      y: 0,
      z: dir.x,
    };
    const rightLen = Math.sqrt(right.x * right.x + right.z * right.z);
    right.x /= rightLen;
    right.z /= rightLen;

    const up = {
      x: (right.z * dir.y - right.y * dir.z),
      y: (right.x * dir.z - right.z * dir.x),
      z: (right.y * dir.x - right.x * dir.y),
    };
    const upLen = Math.sqrt(up.x * up.x + up.y * up.y + up.z * up.z);
    up.x /= upLen;
    up.y /= upLen;
    up.z /= upLen;

    const panSpeed = distance * 0.001;
    this.camera.target.x += (right.x * deltaX + up.x * deltaY) * panSpeed;
    this.camera.target.y += (right.y * deltaX + up.y * deltaY) * panSpeed;
    this.camera.target.z += (right.z * deltaX + up.z * deltaY) * panSpeed;
    this.camera.position.x += (right.x * deltaX + up.x * deltaY) * panSpeed;
    this.camera.position.y += (right.y * deltaX + up.y * deltaY) * panSpeed;
    this.camera.position.z += (right.z * deltaX + up.z * deltaY) * panSpeed;

    this.updateMatrices();
  }

  /**
   * Zoom camera
   */
  zoom(delta: number): void {
    const dir = {
      x: this.camera.position.x - this.camera.target.x,
      y: this.camera.position.y - this.camera.target.y,
      z: this.camera.position.z - this.camera.target.z,
    };
    const distance = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
    // Normalize delta (wheel events can have large values)
    const normalizedDelta = Math.sign(delta) * Math.min(Math.abs(delta) * 0.001, 0.1);
    const newDistance = Math.max(0.1, distance * (1 + normalizedDelta));
    const scale = newDistance / distance;

    this.camera.position.x = this.camera.target.x + dir.x * scale;
    this.camera.position.y = this.camera.target.y + dir.y * scale;
    this.camera.position.z = this.camera.target.z + dir.z * scale;

    this.updateMatrices();
  }

  /**
   * Fit view to bounding box
   */
  fitToBounds(min: Vec3, max: Vec3): void {
    // #region agent log
    fetch('http://127.0.0.1:7248/ingest/23432d39-3a37-4dd4-80fc-bbd61504cb4e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'camera.ts:fitToBounds-input',message:'fitToBounds input',data:{minX:min.x,minY:min.y,minZ:min.z,maxX:max.x,maxY:max.y,maxZ:max.z,hasNaN:isNaN(min.x)||isNaN(max.x)||isNaN(min.y)||isNaN(max.y)||isNaN(min.z)||isNaN(max.z)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H4'})}).catch(()=>{});
    // #endregion
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
    // #region agent log
    fetch('http://127.0.0.1:7248/ingest/23432d39-3a37-4dd4-80fc-bbd61504cb4e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'camera.ts:fitToBounds-calc',message:'fitToBounds calculated',data:{centerX:center.x,centerY:center.y,centerZ:center.z,sizeX:size.x,sizeY:size.y,sizeZ:size.z,maxSize:maxSize,isMaxSizeNaN:isNaN(maxSize)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H4'})}).catch(()=>{});
    // #endregion
    const distance = maxSize * 2.0;

    this.camera.target = center;
    // For Z-up IFC models: position camera looking from front (negative Y) and above (positive Z)
    this.camera.position = {
      x: center.x,
      y: center.y - distance,  // Look from front (negative Y direction)
      z: center.z + distance * 0.5, // Elevated view
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
    
    // #region agent log
    const vp = this.viewProjMatrix.m;
    fetch('http://127.0.0.1:7248/ingest/23432d39-3a37-4dd4-80fc-bbd61504cb4e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'camera.ts:matrices-after-fit',message:'Matrices after fitToBounds',data:{viewProjFirst4:[vp[0],vp[1],vp[2],vp[3]],hasNaN:vp.some((v:number)=>!Number.isFinite(v)),near:this.camera.near,far:this.camera.far,distance},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H7'})}).catch(()=>{});
    // #endregion
  }

  getViewProjMatrix(): Mat4 {
    return this.viewProjMatrix;
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
