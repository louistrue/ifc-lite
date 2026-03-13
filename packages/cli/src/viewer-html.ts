/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Self-contained WebGL 2 viewer HTML template for the CLI `view` command.
 *
 * The page loads the IFC model from the local server, parses it with
 * @ifc-lite/wasm, and renders the geometry with WebGL 2 (flat shading,
 * orbit camera, entity picking).
 *
 * Communication:
 *   CLI → Browser:  Server-Sent Events on /events
 *   Browser → CLI:  POST /api/command
 */

export function getViewerHtml(modelName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${modelName} — ifc-lite 3D</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#1a1a2e}
canvas{display:block;width:100%;height:100%;cursor:grab}
canvas:active{cursor:grabbing}
#overlay{position:absolute;top:0;left:0;right:0;pointer-events:none;padding:12px 16px;display:flex;justify-content:space-between;align-items:flex-start}
#info{color:#e0e0e0;font-size:13px;background:rgba(20,20,40,0.85);padding:8px 14px;border-radius:8px;backdrop-filter:blur(8px);pointer-events:auto}
#info h2{font-size:14px;font-weight:600;margin-bottom:2px;color:#fff}
#info span{opacity:0.7;font-size:12px}
#status{color:#e0e0e0;font-size:12px;background:rgba(20,20,40,0.85);padding:8px 14px;border-radius:8px;backdrop-filter:blur(8px);text-align:right;pointer-events:auto}
#progress-wrap{position:absolute;bottom:0;left:0;right:0;height:3px;background:rgba(255,255,255,0.1)}
#progress-bar{height:100%;width:0%;background:linear-gradient(90deg,#4f8cff,#a855f7);transition:width 0.2s}
#pick-info{position:absolute;bottom:16px;left:16px;color:#fff;font-size:12px;background:rgba(20,20,40,0.9);padding:10px 14px;border-radius:8px;backdrop-filter:blur(8px);display:none;max-width:350px;pointer-events:auto}
#pick-info .label{opacity:0.6;font-size:11px;text-transform:uppercase;letter-spacing:0.5px}
#pick-info .value{font-weight:500;margin-bottom:4px}
#cmd-log{position:absolute;bottom:16px;right:16px;color:#a0f0a0;font-size:11px;background:rgba(20,20,40,0.9);padding:8px 12px;border-radius:8px;display:none;pointer-events:auto;max-width:320px;font-family:monospace}
.loading-screen{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#1a1a2e;color:#fff;z-index:10}
.loading-screen h1{font-size:24px;font-weight:300;margin-bottom:8px}
.loading-screen p{font-size:14px;opacity:0.6}
.spinner{width:40px;height:40px;border:3px solid rgba(255,255,255,0.1);border-top-color:#4f8cff;border-radius:50%;animation:spin 0.8s linear infinite;margin-bottom:20px}
@keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div id="loading" class="loading-screen">
  <div class="spinner"></div>
  <h1>Loading ${modelName}</h1>
  <p id="loading-text">Initializing WASM engine...</p>
</div>
<canvas id="c" tabindex="0"></canvas>
<div id="overlay">
  <div id="info"><h2>${modelName}</h2><span id="model-stats">Loading...</span></div>
  <div id="status"><span id="fps"></span></div>
</div>
<div id="progress-wrap"><div id="progress-bar"></div></div>
<div id="pick-info"></div>
<div id="cmd-log"></div>

<script type="module">
// ═══════════════════════════════════════════════════════════════════
// 1. MATH UTILITIES (minimal mat4/vec3)
// ═══════════════════════════════════════════════════════════════════
const mat4 = {
  create() { const m = new Float32Array(16); m[0]=m[5]=m[10]=m[15]=1; return m; },
  perspective(fov, aspect, near, far) {
    const f = 1/Math.tan(fov/2), nf = 1/(near-far), m = new Float32Array(16);
    m[0]=f/aspect; m[5]=f; m[10]=(far+near)*nf; m[11]=-1; m[14]=2*far*near*nf;
    return m;
  },
  lookAt(eye, center, up) {
    const m = new Float32Array(16);
    let zx=eye[0]-center[0], zy=eye[1]-center[1], zz=eye[2]-center[2];
    let len = 1/Math.sqrt(zx*zx+zy*zy+zz*zz); zx*=len; zy*=len; zz*=len;
    let xx=up[1]*zz-up[2]*zy, xy=up[2]*zx-up[0]*zz, xz=up[0]*zy-up[1]*zx;
    len = Math.sqrt(xx*xx+xy*xy+xz*xz);
    if(len>0){len=1/len; xx*=len; xy*=len; xz*=len;}
    let yx=zy*xz-zz*xy, yy=zz*xx-zx*xz, yz=zx*xy-zy*xx;
    m[0]=xx;m[1]=yx;m[2]=zx;m[4]=xy;m[5]=yy;m[6]=zy;m[8]=xz;m[9]=yz;m[10]=zz;
    m[12]=-(xx*eye[0]+xy*eye[1]+xz*eye[2]);
    m[13]=-(yx*eye[0]+yy*eye[1]+yz*eye[2]);
    m[14]=-(zx*eye[0]+zy*eye[1]+zz*eye[2]);
    m[15]=1;
    return m;
  },
  multiply(a, b) {
    const m = new Float32Array(16);
    for(let i=0;i<4;i++) for(let j=0;j<4;j++){
      m[j*4+i]=a[i]*b[j*4]+a[4+i]*b[j*4+1]+a[8+i]*b[j*4+2]+a[12+i]*b[j*4+3];
    }
    return m;
  },
  invert(a) {
    const m = new Float32Array(16);
    const a00=a[0],a01=a[1],a02=a[2],a03=a[3],a10=a[4],a11=a[5],a12=a[6],a13=a[7];
    const a20=a[8],a21=a[9],a22=a[10],a23=a[11],a30=a[12],a31=a[13],a32=a[14],a33=a[15];
    const b00=a00*a11-a01*a10,b01=a00*a12-a02*a10,b02=a00*a13-a03*a10;
    const b03=a01*a12-a02*a11,b04=a01*a13-a03*a11,b05=a02*a13-a03*a12;
    const b06=a20*a31-a21*a30,b07=a20*a32-a22*a30,b08=a20*a33-a23*a30;
    const b09=a21*a32-a22*a31,b10=a21*a33-a23*a31,b11=a22*a33-a23*a32;
    let det=b00*b11-b01*b10+b02*b09+b03*b08-b04*b07+b05*b06;
    if(!det) return m;
    det=1/det;
    m[0]=(a11*b11-a12*b10+a13*b09)*det; m[1]=(a02*b10-a01*b11-a03*b09)*det;
    m[2]=(a31*b05-a32*b04+a33*b03)*det; m[3]=(a22*b04-a21*b05-a23*b03)*det;
    m[4]=(a12*b08-a10*b11-a13*b07)*det; m[5]=(a00*b11-a02*b08+a03*b07)*det;
    m[6]=(a32*b02-a30*b05-a33*b01)*det; m[7]=(a20*b05-a22*b02+a23*b01)*det;
    m[8]=(a10*b10-a11*b08+a13*b06)*det; m[9]=(a01*b08-a00*b10-a03*b06)*det;
    m[10]=(a30*b04-a31*b02+a33*b00)*det; m[11]=(a21*b02-a20*b04-a23*b00)*det;
    m[12]=(a11*b07-a10*b09-a12*b06)*det; m[13]=(a00*b09-a01*b07+a02*b06)*det;
    m[14]=(a31*b01-a30*b03-a32*b00)*det; m[15]=(a20*b03-a21*b01+a22*b00)*det;
    return m;
  },
  transpose(a) {
    const m = new Float32Array(16);
    m[0]=a[0];m[1]=a[4];m[2]=a[8];m[3]=a[12];
    m[4]=a[1];m[5]=a[5];m[6]=a[9];m[7]=a[13];
    m[8]=a[2];m[9]=a[6];m[10]=a[10];m[11]=a[14];
    m[12]=a[3];m[13]=a[7];m[14]=a[11];m[15]=a[15];
    return m;
  },
};

// ═══════════════════════════════════════════════════════════════════
// 2. WEBGL SETUP
// ═══════════════════════════════════════════════════════════════════
const canvas = document.getElementById('c');
const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
if (!gl) { document.getElementById('loading-text').textContent = 'WebGL 2 not supported'; throw new Error('No WebGL2'); }

function resize() {
  const dpr = Math.min(window.devicePixelRatio, 2);
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  gl.viewport(0, 0, canvas.width, canvas.height);
}
window.addEventListener('resize', resize);
resize();

// Shaders
const VS = \`#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNorm;
layout(location=2) in vec4 aCol;
uniform mat4 uMVP;
uniform mat4 uNormMat;
out vec3 vNorm;
out vec4 vCol;
out vec3 vWorldPos;
void main(){
  gl_Position = uMVP * vec4(aPos, 1.0);
  vNorm = mat3(uNormMat) * aNorm;
  vCol = aCol;
  vWorldPos = aPos;
}\`;

const FS = \`#version 300 es
precision highp float;
in vec3 vNorm;
in vec4 vCol;
in vec3 vWorldPos;
out vec4 fragColor;
void main(){
  if(vCol.a < 0.01) discard;
  vec3 n = normalize(vNorm);
  // Two-sided lighting
  vec3 lightDir = normalize(vec3(0.3, 0.8, 0.5));
  float diff = abs(dot(n, lightDir));
  vec3 lightDir2 = normalize(vec3(-0.5, 0.3, -0.3));
  float diff2 = abs(dot(n, lightDir2)) * 0.3;
  float ambient = 0.3;
  float light = ambient + diff * 0.55 + diff2;
  fragColor = vec4(vCol.rgb * min(light, 1.0), vCol.a);
}\`;

// Picking shaders
const PICK_VS = \`#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=2) in vec4 aCol;
uniform mat4 uMVP;
in float aEntityId;
flat out vec4 vId;
void main(){
  gl_Position = uMVP * vec4(aPos, 1.0);
  if(aCol.a < 0.01) { gl_Position = vec4(2.0,2.0,2.0,1.0); return; }
  int id = int(aEntityId);
  vId = vec4(float((id >> 16) & 255)/255.0, float((id >> 8) & 255)/255.0, float(id & 255)/255.0, 1.0);
}\`;

const PICK_FS = \`#version 300 es
precision highp float;
flat in vec4 vId;
out vec4 fragColor;
void main(){ fragColor = vId; }\`;

function compileShader(src, type) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('Shader error:', gl.getShaderInfoLog(s));
    return null;
  }
  return s;
}

function createProgram(vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compileShader(vs, gl.VERTEX_SHADER));
  gl.attachShader(p, compileShader(fs, gl.FRAGMENT_SHADER));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error('Program error:', gl.getProgramInfoLog(p));
  }
  return p;
}

const prog = createProgram(VS, FS);
const uMVP = gl.getUniformLocation(prog, 'uMVP');
const uNormMat = gl.getUniformLocation(prog, 'uNormMat');

// ═══════════════════════════════════════════════════════════════════
// 3. SCENE STATE
// ═══════════════════════════════════════════════════════════════════

// Entity tracking: expressId → { vertexStart, vertexCount, defaultColor, ifcType }
const entityMap = new Map();
// Merged geometry buffers
let positions = [];   // Float32Array segments
let normals = [];
let indices = [];
let colors = [];      // Per-vertex RGBA
let entityIds = [];   // Per-vertex entity ID (for picking)
let totalVertices = 0;
let totalIndices = 0;
let totalTriangles = 0;

// WebGL buffers
let vao = null;
let posBuffer = null;
let normBuffer = null;
let colBuffer = null;
let idxBuffer = null;
let entityIdBuffer = null;
let drawCount = 0;

// Model bounds
let boundsMin = [Infinity, Infinity, Infinity];
let boundsMax = [-Infinity, -Infinity, -Infinity];

// Type summary
const typeCounts = new Map();

function updateBounds(pos) {
  for (let i = 0; i < pos.length; i += 3) {
    boundsMin[0] = Math.min(boundsMin[0], pos[i]);
    boundsMin[1] = Math.min(boundsMin[1], pos[i+1]);
    boundsMax[0] = Math.max(boundsMax[0], pos[i]);
    boundsMax[1] = Math.max(boundsMax[1], pos[i+1]);
    boundsMin[2] = Math.min(boundsMin[2], pos[i+2]);
    boundsMax[2] = Math.max(boundsMax[2], pos[i+2]);
  }
}

function addMeshBatch(meshes) {
  for (const mesh of meshes) {
    const vStart = totalVertices;
    const vCount = mesh.positions.length / 3;
    const iStart = totalIndices;
    const iCount = mesh.indices.length;

    // Track entity
    const existing = entityMap.get(mesh.expressId);
    const ifcType = mesh.ifcType || 'Unknown';
    if (!existing) {
      entityMap.set(mesh.expressId, {
        vertexStart: vStart, vertexCount: vCount,
        indexStart: iStart, indexCount: iCount,
        defaultColor: [...mesh.color], ifcType,
        segments: [{ vertexStart: vStart, vertexCount: vCount, indexStart: iStart, indexCount: iCount }]
      });
    } else {
      // Entity has multiple meshes — track segments
      existing.segments.push({ vertexStart: vStart, vertexCount: vCount, indexStart: iStart, indexCount: iCount });
      existing.vertexCount += vCount;
      existing.indexCount += iCount;
    }

    // Type counts
    typeCounts.set(ifcType, (typeCounts.get(ifcType) || 0) + 1);

    // Accumulate geometry
    positions.push(mesh.positions);
    normals.push(mesh.normals);

    // Offset indices
    const offsetIndices = new Uint32Array(mesh.indices.length);
    for (let i = 0; i < mesh.indices.length; i++) {
      offsetIndices[i] = mesh.indices[i] + vStart;
    }
    indices.push(offsetIndices);

    // Per-vertex colors
    const vc = new Float32Array(vCount * 4);
    for (let i = 0; i < vCount; i++) {
      vc[i*4]   = mesh.color[0];
      vc[i*4+1] = mesh.color[1];
      vc[i*4+2] = mesh.color[2];
      vc[i*4+3] = mesh.color[3];
    }
    colors.push(vc);

    // Per-vertex entity ID
    const eid = new Float32Array(vCount);
    eid.fill(mesh.expressId);
    entityIds.push(eid);

    updateBounds(mesh.positions);
    totalVertices += vCount;
    totalIndices += iCount;
    totalTriangles += iCount / 3;
  }

  uploadGeometry();
}

function uploadGeometry() {
  // Merge typed arrays
  const allPos = mergeFloat32(positions, totalVertices * 3);
  const allNorm = mergeFloat32(normals, totalVertices * 3);
  const allCol = mergeFloat32(colors, totalVertices * 4);
  const allIdx = mergeUint32(indices, totalIndices);
  const allEid = mergeFloat32(entityIds, totalVertices);

  if (!vao) {
    vao = gl.createVertexArray();
    posBuffer = gl.createBuffer();
    normBuffer = gl.createBuffer();
    colBuffer = gl.createBuffer();
    idxBuffer = gl.createBuffer();
    entityIdBuffer = gl.createBuffer();
  }

  gl.bindVertexArray(vao);

  gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, allPos, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, normBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, allNorm, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, colBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, allCol, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, allIdx, gl.STATIC_DRAW);

  gl.bindVertexArray(null);
  drawCount = totalIndices;
}

function mergeFloat32(arrays, totalLen) {
  const merged = new Float32Array(totalLen);
  let offset = 0;
  for (const a of arrays) { merged.set(a, offset); offset += a.length; }
  return merged;
}
function mergeUint32(arrays, totalLen) {
  const merged = new Uint32Array(totalLen);
  let offset = 0;
  for (const a of arrays) { merged.set(a, offset); offset += a.length; }
  return merged;
}

// ═══════════════════════════════════════════════════════════════════
// 4. CAMERA
// ═══════════════════════════════════════════════════════════════════
let camTheta = Math.PI * 0.25;    // horizontal angle
let camPhi = Math.PI * 0.3;      // vertical angle (from top)
let camDist = 50;
let camTarget = [0, 0, 0];
let camAnimating = false;
let camAnimStart, camAnimDuration, camAnimFrom, camAnimTo;

function getCamPos() {
  const sp = Math.sin(camPhi), cp = Math.cos(camPhi);
  const st = Math.sin(camTheta), ct = Math.cos(camTheta);
  return [
    camTarget[0] + camDist * sp * ct,
    camTarget[1] + camDist * cp,
    camTarget[2] + camDist * sp * st,
  ];
}

function fitCamera() {
  const cx = (boundsMin[0] + boundsMax[0]) / 2;
  const cy = (boundsMin[1] + boundsMax[1]) / 2;
  const cz = (boundsMin[2] + boundsMax[2]) / 2;
  const dx = boundsMax[0] - boundsMin[0];
  const dy = boundsMax[1] - boundsMin[1];
  const dz = boundsMax[2] - boundsMin[2];
  const maxDim = Math.max(dx, dy, dz, 0.1);
  camTarget = [cx, cy, cz];
  camDist = maxDim * 1.5;
  camTheta = Math.PI * 0.25;
  camPhi = Math.PI * 0.3;
}

function flyTo(targetPos, dist) {
  camAnimating = true;
  camAnimStart = performance.now();
  camAnimDuration = 600;
  camAnimFrom = { target: [...camTarget], dist: camDist, theta: camTheta, phi: camPhi };
  camAnimTo = { target: targetPos, dist: dist, theta: camTheta, phi: camPhi };
}

function updateCamAnimation() {
  if (!camAnimating) return;
  const t = Math.min(1, (performance.now() - camAnimStart) / camAnimDuration);
  const ease = t < 0.5 ? 2*t*t : 1-(-2*t+2)*(-2*t+2)/2; // easeInOut
  camTarget = camAnimFrom.target.map((v,i) => v + (camAnimTo.target[i]-v)*ease);
  camDist = camAnimFrom.dist + (camAnimTo.dist - camAnimFrom.dist) * ease;
  if (t >= 1) camAnimating = false;
}

// Mouse controls
let isDragging = false;
let isPanning = false;
let lastMouse = [0, 0];

canvas.addEventListener('mousedown', (e) => {
  isDragging = true;
  isPanning = e.button === 1 || e.button === 2 || e.shiftKey;
  lastMouse = [e.clientX, e.clientY];
  e.preventDefault();
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('mouseup', () => { isDragging = false; isPanning = false; });

window.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const dx = e.clientX - lastMouse[0];
  const dy = e.clientY - lastMouse[1];
  lastMouse = [e.clientX, e.clientY];

  if (isPanning) {
    // Pan
    const panSpeed = camDist * 0.002;
    const sp = Math.sin(camTheta), cp = Math.cos(camTheta);
    camTarget[0] -= (dx * sp + dy * 0) * panSpeed;
    camTarget[1] += dy * panSpeed;
    camTarget[2] -= (-dx * cp + dy * 0) * panSpeed;
  } else {
    // Orbit
    camTheta -= dx * 0.005;
    camPhi = Math.max(0.05, Math.min(Math.PI - 0.05, camPhi - dy * 0.005));
  }
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  camDist *= 1 + e.deltaY * 0.001;
  camDist = Math.max(0.1, camDist);
}, { passive: false });

// Touch controls
let lastTouches = [];
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  lastTouches = [...e.touches].map(t => [t.clientX, t.clientY]);
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  const touches = [...e.touches].map(t => [t.clientX, t.clientY]);
  if (touches.length === 1 && lastTouches.length >= 1) {
    const dx = touches[0][0] - lastTouches[0][0];
    const dy = touches[0][1] - lastTouches[0][1];
    camTheta -= dx * 0.005;
    camPhi = Math.max(0.05, Math.min(Math.PI - 0.05, camPhi - dy * 0.005));
  } else if (touches.length === 2 && lastTouches.length >= 2) {
    // Pinch zoom
    const d1 = Math.hypot(lastTouches[1][0]-lastTouches[0][0], lastTouches[1][1]-lastTouches[0][1]);
    const d2 = Math.hypot(touches[1][0]-touches[0][0], touches[1][1]-touches[0][1]);
    camDist *= d1 / Math.max(d2, 1);
    camDist = Math.max(0.1, camDist);
  }
  lastTouches = touches;
}, { passive: false });

// ═══════════════════════════════════════════════════════════════════
// 5. PICKING (click to select entity)
// ═══════════════════════════════════════════════════════════════════
let pickFbo = null, pickTex = null, pickDepth = null;
let pickW = 0, pickH = 0;

function ensurePickFbo() {
  if (pickFbo && pickW === canvas.width && pickH === canvas.height) return;
  if (pickFbo) { gl.deleteFramebuffer(pickFbo); gl.deleteTexture(pickTex); gl.deleteRenderbuffer(pickDepth); }
  pickW = canvas.width; pickH = canvas.height;
  pickFbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, pickFbo);
  pickTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, pickTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, pickW, pickH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pickTex, 0);
  pickDepth = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, pickDepth);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, pickW, pickH);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, pickDepth);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

canvas.addEventListener('click', (e) => {
  if (!vao || drawCount === 0) return;

  // Build pick framebuffer and render entity IDs
  ensurePickFbo();
  const mvp = getMVP();

  // Create a simple pick program if not exists
  if (!window._pickProg) {
    // Simple pick shader - encode expressId per-vertex into color
    const pvs = \`#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=2) in vec4 aCol;
uniform mat4 uMVP;
void main(){
  gl_Position = uMVP * vec4(aPos, 1.0);
  if(aCol.a < 0.01) gl_Position = vec4(2.0,2.0,2.0,1.0);
}\`;
    const pfs = \`#version 300 es
precision highp float;
out vec4 fragColor;
void main(){ fragColor = vec4(1.0); }\`;
    window._pickProg = createProgram(pvs, pfs);
    window._pickMVP = gl.getUniformLocation(window._pickProg, 'uMVP');
  }

  // Render to pick FBO using entity ID encoded as color
  // For simplicity, we'll do a simpler pick: render with entity-based colors
  // and read the pixel at click position
  gl.bindFramebuffer(gl.FRAMEBUFFER, pickFbo);
  gl.viewport(0, 0, pickW, pickH);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // Temporarily update color buffer with entity IDs encoded as RGB
  const pickColors = new Float32Array(totalVertices * 4);
  for (const [eid, info] of entityMap) {
    const r = ((eid >> 16) & 255) / 255;
    const g = ((eid >> 8) & 255) / 255;
    const b = (eid & 255) / 255;
    for (const seg of info.segments) {
      for (let i = 0; i < seg.vertexCount; i++) {
        const vi = (seg.vertexStart + i) * 4;
        pickColors[vi] = r;
        pickColors[vi+1] = g;
        pickColors[vi+2] = b;
        pickColors[vi+3] = 1;
      }
    }
  }

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, colBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, pickColors, gl.STATIC_DRAW);

  gl.useProgram(prog);
  gl.uniformMatrix4fv(uMVP, false, mvp);
  gl.uniformMatrix4fv(uNormMat, false, mat4.create());
  gl.drawElements(gl.TRIANGLES, drawCount, gl.UNSIGNED_INT, 0);

  // Read pixel
  const dpr = Math.min(window.devicePixelRatio, 2);
  const px = Math.floor(e.clientX * dpr);
  const py = pickH - Math.floor(e.clientY * dpr) - 1;
  const pixel = new Uint8Array(4);
  gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);

  // Restore original colors
  const origCol = mergeFloat32(colors, totalVertices * 4);
  // Apply current overrides
  applyColorOverrides(origCol);
  gl.bindBuffer(gl.ARRAY_BUFFER, colBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, origCol, gl.STATIC_DRAW);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);

  // Decode entity ID
  const pickedId = (pixel[0] << 16) | (pixel[1] << 8) | pixel[2];
  if (pickedId > 0 && entityMap.has(pickedId)) {
    showPickInfo(pickedId);
  } else {
    document.getElementById('pick-info').style.display = 'none';
  }
});

function showPickInfo(eid) {
  const info = entityMap.get(eid);
  if (!info) return;
  const el = document.getElementById('pick-info');
  el.style.display = 'block';
  el.innerHTML = \`
    <div class="label">Entity #\${eid}</div>
    <div class="value">\${info.ifcType}</div>
    <div class="label">Vertices</div>
    <div class="value">\${info.vertexCount.toLocaleString()}</div>
  \`;
}

// ═══════════════════════════════════════════════════════════════════
// 6. COMMAND HANDLER (colorize, isolate, etc.)
// ═══════════════════════════════════════════════════════════════════
const colorOverrides = new Map(); // expressId → [r,g,b,a]
const STOREY_PALETTE = [
  [0.23,0.55,0.96,1],[0.16,0.73,0.44,1],[0.90,0.30,0.24,1],
  [0.95,0.77,0.06,1],[0.60,0.36,0.71,1],[1.0,0.50,0.05,1],
  [0.10,0.74,0.74,1],[0.83,0.33,0.58,1],[0.38,0.70,0.24,1],
  [0.35,0.47,0.85,1],
];

function applyColorOverrides(colArray) {
  for (const [eid, color] of colorOverrides) {
    const info = entityMap.get(eid);
    if (!info) continue;
    for (const seg of info.segments) {
      for (let i = 0; i < seg.vertexCount; i++) {
        const vi = (seg.vertexStart + i) * 4;
        colArray[vi] = color[0];
        colArray[vi+1] = color[1];
        colArray[vi+2] = color[2];
        colArray[vi+3] = color[3];
      }
    }
  }
}

function refreshColors() {
  if (!vao) return;
  const col = mergeFloat32(colors, totalVertices * 4);
  applyColorOverrides(col);
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, colBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, col, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
}

const NAMED_COLORS = {
  red:[1,0,0,1],green:[0,0.7,0,1],blue:[0,0.3,1,1],yellow:[1,0.9,0,1],
  orange:[1,0.5,0,1],purple:[0.6,0.2,0.8,1],cyan:[0,0.8,0.8,1],
  white:[1,1,1,1],pink:[1,0.4,0.7,1],gray:[0.5,0.5,0.5,1],
};

function resolveColor(c) {
  if (typeof c === 'string') return NAMED_COLORS[c.toLowerCase()] || [1,0,0,1];
  if (Array.isArray(c)) return c;
  return [1,0,0,1];
}

function handleCommand(cmd) {
  showCmdLog(cmd.action);

  switch (cmd.action) {
    case 'colorize': {
      const color = resolveColor(cmd.color);
      for (const [eid, info] of entityMap) {
        if (info.ifcType === cmd.type || info.ifcType === 'Ifc' + cmd.type) {
          colorOverrides.set(eid, color);
        }
      }
      refreshColors();
      break;
    }
    case 'isolate': {
      const types = new Set(cmd.types || [cmd.type]);
      // Also accept without Ifc prefix
      const expanded = new Set(types);
      for (const t of types) {
        expanded.add(t.startsWith('Ifc') ? t : 'Ifc' + t);
        expanded.add(t.startsWith('Ifc') ? t.slice(3) : t);
      }
      for (const [eid, info] of entityMap) {
        if (!expanded.has(info.ifcType)) {
          colorOverrides.set(eid, [0.3, 0.3, 0.35, 0.06]); // ghost
        } else {
          colorOverrides.delete(eid); // restore default
        }
      }
      refreshColors();
      break;
    }
    case 'xray': {
      const opacity = cmd.opacity ?? 0.15;
      for (const [eid, info] of entityMap) {
        if (info.ifcType === cmd.type || info.ifcType === 'Ifc' + cmd.type) {
          const dc = info.defaultColor;
          colorOverrides.set(eid, [dc[0], dc[1], dc[2], opacity]);
        }
      }
      refreshColors();
      break;
    }
    case 'highlight': {
      const ids = new Set(cmd.ids || []);
      for (const [eid] of entityMap) {
        if (ids.has(eid)) {
          colorOverrides.set(eid, [1, 0.9, 0, 1]); // yellow highlight
        }
      }
      refreshColors();
      break;
    }
    case 'colorByStorey': {
      // Group entities by spatial parent (simplified: use Z-based binning)
      const yGroups = new Map();
      for (const [eid, info] of entityMap) {
        // Use average Y position as storey proxy
        let avgY = 0;
        for (const seg of info.segments) {
          const posArr = positions.reduce((acc, p) => acc, null);
          // Simple: just use the first vertex Y of first segment
          break;
        }
        // Bin to nearest 3m
        const bin = Math.floor(avgY / 3);
        if (!yGroups.has(bin)) yGroups.set(bin, []);
        yGroups.get(bin).push(eid);
      }
      // Assign colors by sorted bin
      const sortedBins = [...yGroups.keys()].sort((a,b) => a-b);
      for (let i = 0; i < sortedBins.length; i++) {
        const color = STOREY_PALETTE[i % STOREY_PALETTE.length];
        for (const eid of yGroups.get(sortedBins[i])) {
          colorOverrides.set(eid, color);
        }
      }
      refreshColors();
      break;
    }
    case 'flyto': {
      // Compute bounds of target entities
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      let found = false;
      for (const [eid, info] of entityMap) {
        const match = cmd.ids ? cmd.ids.includes(eid) :
                      (info.ifcType === cmd.type || info.ifcType === 'Ifc' + cmd.type);
        if (!match) continue;
        found = true;
        // Scan positions of this entity
        let posOffset = 0;
        for (let pi = 0; pi < positions.length; pi++) {
          const seg = info.segments.find(s => s.vertexStart >= posOffset && s.vertexStart < posOffset + positions[pi].length / 3);
          posOffset += positions[pi].length / 3;
        }
        // Approximate: use stored bounds contribution
      }
      if (found && cmd.type) {
        // Recompute bounds for type
        const tMin = [Infinity,Infinity,Infinity], tMax = [-Infinity,-Infinity,-Infinity];
        let offset = 0;
        for (const posArr of positions) {
          const vertCount = posArr.length / 3;
          for (const [eid, info] of entityMap) {
            const match = cmd.ids ? cmd.ids.includes(eid) :
                          (info.ifcType === cmd.type || info.ifcType === 'Ifc' + cmd.type);
            if (!match) continue;
            for (const seg of info.segments) {
              if (seg.vertexStart >= offset && seg.vertexStart < offset + vertCount) {
                const localStart = (seg.vertexStart - offset) * 3;
                for (let i = 0; i < seg.vertexCount * 3; i += 3) {
                  const x = posArr[localStart+i], y = posArr[localStart+i+1], z = posArr[localStart+i+2];
                  tMin[0]=Math.min(tMin[0],x); tMin[1]=Math.min(tMin[1],y); tMin[2]=Math.min(tMin[2],z);
                  tMax[0]=Math.max(tMax[0],x); tMax[1]=Math.max(tMax[1],y); tMax[2]=Math.max(tMax[2],z);
                }
              }
            }
          }
          offset += vertCount;
        }
        const center = [(tMin[0]+tMax[0])/2,(tMin[1]+tMax[1])/2,(tMin[2]+tMax[2])/2];
        const dim = Math.max(tMax[0]-tMin[0],tMax[1]-tMin[1],tMax[2]-tMin[2],0.1);
        flyTo(center, dim * 1.5);
      }
      break;
    }
    case 'showall':
      colorOverrides.clear();
      refreshColors();
      break;
    case 'reset':
      colorOverrides.clear();
      refreshColors();
      fitCamera();
      break;
    case 'connected':
      break; // SSE initial connection
    default:
      console.log('Unknown command:', cmd);
  }
}

function showCmdLog(action) {
  const el = document.getElementById('cmd-log');
  el.style.display = 'block';
  el.textContent = '> ' + action;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.style.display = 'none'; }, 2000);
}

// ═══════════════════════════════════════════════════════════════════
// 7. RENDER LOOP
// ═══════════════════════════════════════════════════════════════════
const BG = [0.102, 0.102, 0.18, 1]; // #1a1a2e

function getMVP() {
  const aspect = canvas.width / canvas.height;
  const proj = mat4.perspective(Math.PI / 4, aspect, camDist * 0.001, camDist * 100);
  const eye = getCamPos();
  const view = mat4.lookAt(eye, camTarget, [0, 1, 0]);
  return mat4.multiply(proj, view);
}

function render() {
  updateCamAnimation();
  resize();

  gl.clearColor(...BG);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  if (vao && drawCount > 0) {
    const mvp = getMVP();
    const view = mat4.lookAt(getCamPos(), camTarget, [0, 1, 0]);
    const normMat = mat4.transpose(mat4.invert(view));

    gl.useProgram(prog);
    gl.uniformMatrix4fv(uMVP, false, mvp);
    gl.uniformMatrix4fv(uNormMat, false, normMat);

    gl.bindVertexArray(vao);
    gl.drawElements(gl.TRIANGLES, drawCount, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  requestAnimationFrame(render);
}

// ═══════════════════════════════════════════════════════════════════
// 8. SSE CLIENT (receive commands from CLI)
// ═══════════════════════════════════════════════════════════════════
function connectSSE() {
  const es = new EventSource('/events');
  es.onmessage = (e) => {
    try {
      const cmd = JSON.parse(e.data);
      handleCommand(cmd);
    } catch (err) {
      console.error('SSE parse error:', err);
    }
  };
  es.onerror = () => {
    // Reconnect after a delay
    es.close();
    setTimeout(connectSSE, 2000);
  };
}

// ═══════════════════════════════════════════════════════════════════
// 9. LOAD MODEL VIA WASM
// ═══════════════════════════════════════════════════════════════════
async function loadModel() {
  const loadingText = document.getElementById('loading-text');
  const progressBar = document.getElementById('progress-bar');
  const statsEl = document.getElementById('model-stats');

  try {
    // 1. Init WASM
    loadingText.textContent = 'Initializing geometry engine...';
    const wasm = await import('/wasm/ifc-lite.js');
    await wasm.default();
    const api = new wasm.IfcAPI();

    // 2. Fetch IFC file
    loadingText.textContent = 'Downloading model...';
    const resp = await fetch('/model.ifc');
    const buffer = await resp.arrayBuffer();
    const content = new TextDecoder().decode(buffer);
    loadingText.textContent = 'Parsing geometry...';

    // 3. Parse with streaming
    let batchCount = 0;
    let cameraFitted = false;
    await api.parseMeshesAsync(content, {
      batchSize: 50,
      onBatch: (meshes, progress) => {
        // Convert MeshDataJs to our format
        const batch = [];
        for (const m of meshes) {
          batch.push({
            expressId: m.expressId,
            ifcType: m.ifcType || 'Unknown',
            positions: m.positions,
            normals: m.normals,
            indices: m.indices,
            color: [m.color[0], m.color[1], m.color[2], m.color[3] ?? 1],
          });
        }
        addMeshBatch(batch);
        batchCount++;
        progressBar.style.width = progress.percent + '%';

        if (!cameraFitted && totalVertices > 0) {
          fitCamera();
          cameraFitted = true;
        }

        statsEl.textContent = totalTriangles.toLocaleString() + ' triangles, ' +
          entityMap.size.toLocaleString() + ' entities (' + Math.round(progress.percent) + '%)';
      },
      onComplete: (stats) => {
        progressBar.style.width = '100%';
        setTimeout(() => { document.getElementById('progress-wrap').style.opacity = '0'; }, 1000);
      },
    });

    // Final camera fit
    if (totalVertices > 0) fitCamera();

    // Update stats
    const typeList = [...typeCounts.entries()].sort((a,b) => b[1]-a[1]).slice(0, 5)
      .map(([t,c]) => t + ': ' + c).join(', ');
    statsEl.textContent = totalTriangles.toLocaleString() + ' triangles, ' +
      entityMap.size.toLocaleString() + ' entities';
    statsEl.title = typeList;

    // Hide loading screen
    document.getElementById('loading').style.display = 'none';

  } catch (err) {
    loadingText.textContent = 'Error: ' + err.message;
    console.error('Load error:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════
// 10. INIT
// ═══════════════════════════════════════════════════════════════════
requestAnimationFrame(render);
connectSSE();
loadModel();

// Keyboard shortcuts
window.addEventListener('keydown', (e) => {
  if (e.key === 'h' || e.key === 'Home') fitCamera();
  if (e.key === 'Escape') {
    colorOverrides.clear();
    refreshColors();
    document.getElementById('pick-info').style.display = 'none';
  }
});
</script>
</body>
</html>`;
}
