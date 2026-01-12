/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Math utilities for 3D transformations
 */

import type { Vec3, Mat4 } from './types.js';

export class MathUtils {
    /**
     * Create identity matrix
     */
    static identity(): Mat4 {
        const m = new Float32Array(16);
        m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
        return { m };
    }

    /**
     * Create perspective projection matrix
     */
    static perspective(fov: number, aspect: number, near: number, far: number): Mat4 {
        const f = 1.0 / Math.tan(fov / 2);
        const nf = 1 / (near - far);

        const m = new Float32Array(16);
        m[0] = f / aspect;
        m[5] = f;
        m[10] = (far + near) * nf;
        m[11] = -1;
        m[14] = (2 * far * near) * nf;
        return { m };
    }

    /**
     * Create look-at view matrix
     */
    static lookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
        const zx = eye.x - target.x;
        const zy = eye.y - target.y;
        const zz = eye.z - target.z;
        const len = 1 / Math.sqrt(zx * zx + zy * zy + zz * zz);
        const z0 = zx * len;
        const z1 = zy * len;
        const z2 = zz * len;

        const xx = up.y * z2 - up.z * z1;
        const xy = up.z * z0 - up.x * z2;
        const xz = up.x * z1 - up.y * z0;
        const len2 = 1 / Math.sqrt(xx * xx + xy * xy + xz * xz);
        const x0 = xx * len2;
        const x1 = xy * len2;
        const x2 = xz * len2;

        const y0 = z1 * x2 - z2 * x1;
        const y1 = z2 * x0 - z0 * x2;
        const y2 = z0 * x1 - z1 * x0;

        const m = new Float32Array(16);
        m[0] = x0; m[1] = y0; m[2] = z0; m[3] = 0;
        m[4] = x1; m[5] = y1; m[6] = z1; m[7] = 0;
        m[8] = x2; m[9] = y2; m[10] = z2; m[11] = 0;
        m[12] = -(x0 * eye.x + x1 * eye.y + x2 * eye.z);
        m[13] = -(y0 * eye.x + y1 * eye.y + y2 * eye.z);
        m[14] = -(z0 * eye.x + z1 * eye.y + z2 * eye.z);
        m[15] = 1;
        return { m };
    }

    /**
     * Multiply matrices
     */
    static multiply(a: Mat4, b: Mat4): Mat4 {
        const out = new Float32Array(16);
        const a00 = a.m[0], a01 = a.m[1], a02 = a.m[2], a03 = a.m[3];
        const a10 = a.m[4], a11 = a.m[5], a12 = a.m[6], a13 = a.m[7];
        const a20 = a.m[8], a21 = a.m[9], a22 = a.m[10], a23 = a.m[11];
        const a30 = a.m[12], a31 = a.m[13], a32 = a.m[14], a33 = a.m[15];

        const b00 = b.m[0], b01 = b.m[1], b02 = b.m[2], b03 = b.m[3];
        const b10 = b.m[4], b11 = b.m[5], b12 = b.m[6], b13 = b.m[7];
        const b20 = b.m[8], b21 = b.m[9], b22 = b.m[10], b23 = b.m[11];
        const b30 = b.m[12], b31 = b.m[13], b32 = b.m[14], b33 = b.m[15];

        out[0] = b00 * a00 + b01 * a10 + b02 * a20 + b03 * a30;
        out[1] = b00 * a01 + b01 * a11 + b02 * a21 + b03 * a31;
        out[2] = b00 * a02 + b01 * a12 + b02 * a22 + b03 * a32;
        out[3] = b00 * a03 + b01 * a13 + b02 * a23 + b03 * a33;
        out[4] = b10 * a00 + b11 * a10 + b12 * a20 + b13 * a30;
        out[5] = b10 * a01 + b11 * a11 + b12 * a21 + b13 * a31;
        out[6] = b10 * a02 + b11 * a12 + b12 * a22 + b13 * a32;
        out[7] = b10 * a03 + b11 * a13 + b12 * a23 + b13 * a33;
        out[8] = b20 * a00 + b21 * a10 + b22 * a20 + b23 * a30;
        out[9] = b20 * a01 + b21 * a11 + b22 * a21 + b23 * a31;
        out[10] = b20 * a02 + b21 * a12 + b22 * a22 + b23 * a32;
        out[11] = b20 * a03 + b21 * a13 + b22 * a23 + b23 * a33;
        out[12] = b30 * a00 + b31 * a10 + b32 * a20 + b33 * a30;
        out[13] = b30 * a01 + b31 * a11 + b32 * a21 + b33 * a31;
        out[14] = b30 * a02 + b31 * a12 + b32 * a22 + b33 * a32;
        out[15] = b30 * a03 + b31 * a13 + b32 * a23 + b33 * a33;

        return { m: out };
    }
}
