/// <reference types="@webgpu/types" />

import "./style.css";
import shaderCode from "./shader.wgsl?raw";
import { Camera } from "./camera";
import { mat4, quat, screenToSphere, arcballRotation } from "./math";
import type { Vec3, Quat  } from "./math";
import { gui, hexToRgb, initGUI, addObject, getSelectedIndex } from "./gui";


const BARY: [number,number,number][] = [[1,0,0],[0,1,0],[0,0,1]];
 
// OBJ loader — returns a flat (non-indexed) vertex array and bounding sphere info
function parseOBJ(text: string) {
  const pos: [number,number,number][] = [];
  const nrm: [number,number,number][] = [];
  const uvs: [number,number][]        = [];
 
  // temp storage for triangles before we know if normals exist
  type Corner = [[number,number,number],[number,number,number],[number,number]][];
  type Tri = [Corner, Corner, Corner];
  const tris: Tri[] = [];
  let hasNormals = false;
 
  const resolve = (s: string, len: number) => {
    const n = parseInt(s);
    return isNaN(n) ? -1 : n < 0 ? len + n : n - 1;
  };
 
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === "#") continue;
    const p = line.split(/\s+/);
 
    if (p[0] === "v")  pos.push([+p[1], +p[2], +p[3]]);
    if (p[0] === "vn") { nrm.push([+p[1], +p[2], +p[3]]); hasNormals = true; }
    if (p[0] === "vt") uvs.push([+p[1], +(p[2] ?? 0)]);
    if (p[0] === "f") {
      const corners = p.slice(1).map(tok => {
        const t  = tok.split("/");
        const pi = resolve(t[0], pos.length);
        const ui = t.length > 1 && t[1] !== "" ? resolve(t[1], uvs.length)  : -1;
        const ni = t.length > 2 && t[2] !== "" ? resolve(t[2], nrm.length)  : -1;
        return [
          pos[pi] ?? [0,0,0] ,
          ni >= 0 ? nrm[ni] : [0,1,0],
          ui >= 0 ? uvs[ui] : [0,0] ,
        ] as unknown as Corner; // typed loosely, fixed below
      });
      // fan triangulation — works for tris and quads
      for (let i = 1; i + 1 < corners.length; i++)
        tris.push([corners[0], corners[i], corners[i+1]] as unknown as Tri);
    }
  }
 
  // if no normals in file, compute face normals per vertex (averaged)
  if (!hasNormals) {
    const acc = new Map<string, [number,number,number]>();
    for (const tri of tris) {
      const [p0,,] = tri[0] as any, [p1,,] = tri[1] as any, [p2,,] = tri[2] as any;
      const e1 = [p1[0]-p0[0], p1[1]-p0[1], p1[2]-p0[2]];
      const e2 = [p2[0]-p0[0], p2[1]-p0[1], p2[2]-p0[2]];
      const fn: [number,number,number] = [
        e1[1]*e2[2]-e1[2]*e2[1], e1[2]*e2[0]-e1[0]*e2[2], e1[0]*e2[1]-e1[1]*e2[0]
      ];
      for (const c of tri as any) {
        const k = (c[0] as number[]).join();
        const a = acc.get(k) ?? [0,0,0] as [number,number,number];
        acc.set(k, [a[0]+fn[0], a[1]+fn[1], a[2]+fn[2]]);
      }
    }
    for (const tri of tris as any)
      for (const c of tri) {
        const a = acc.get((c[0] as number[]).join())!;
        const l = Math.sqrt(a[0]**2+a[1]**2+a[2]**2) || 1;
        c[1] = [a[0]/l, a[1]/l, a[2]/l];
      }
  }
 
  // pack into flat vertex buffer
  const verts: number[] = [];
  for (const tri of tris as any)
    for (let i = 0; i < 3; i++) {
      const [p, n, uv] = tri[i];
      verts.push(...p, ...n, ...BARY[i], uv[0], uv[1]);
    }
 
  // bounding sphere
  let minX= Infinity, minY= Infinity, minZ= Infinity;
  let maxX=-Infinity, maxY=-Infinity, maxZ=-Infinity;
  for (const [x,y,z] of pos) {
    if (x<minX) minX=x; if (x>maxX) maxX=x;
    if (y<minY) minY=y; if (y>maxY) maxY=y;
    if (z<minZ) minZ=z; if (z>maxZ) maxZ=z;
  }
  const cx=(minX+maxX)/2, cy=(minY+maxY)/2, cz=(minZ+maxZ)/2;
  let radius = 0;
  for (const [x,y,z] of pos) {
    const d = Math.sqrt((x-cx)**2+(y-cy)**2+(z-cz)**2);
    if (d > radius) radius = d;
  }
 
  return { verts: new Float32Array(verts), count: verts.length/11, cx, cy, cz, radius };
}
 



//WebGPU init
if (!navigator.gpu) throw new Error("WebGPU not supported");

const canvas = document.querySelector("#gfx-main") as HTMLCanvasElement;
if (!canvas) throw new Error("Canvas #gfx-main not found");

const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error("No GPU adapter found");

const device = await adapter.requestDevice();
const context = canvas.getContext("webgpu")!;
const format  = navigator.gpu.getPreferredCanvasFormat();

let depthTexture: GPUTexture | null = null;

function resize() {
  canvas.width  = Math.max(1, Math.floor(window.innerWidth  * devicePixelRatio));
  canvas.height = Math.max(1, Math.floor(window.innerHeight * devicePixelRatio));
  context.configure({ device, format, alphaMode: "premultiplied" });
  depthTexture?.destroy();
  depthTexture = device.createTexture({
    size: [canvas.width, canvas.height], 
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
}
resize();
window.addEventListener("resize", resize);

// ─────────────────────────────────────────────────────────────────────────────
// Vertex format: [x, y, z,  nx, ny, nz,  u, v]
//                 position    normal       uv
// stride = 8 floats = 32 bytes
// ─────────────────────────────────────────────────────────────────────────────

// ── Cube geometry ───────────────────────────────────────────────
// Each face is 2 triangles
// Normals are constant per face so flat and smooth shading look identical on a cube.

function generateCube(): { vd: Float32Array; id: Uint32Array } {
  const faces: Array<{ n: Vec3; verts: number[][] }> = [
    { n: [ 0,  0,  1], verts: [[-1,-1, 1,0,1],[1,-1, 1,1,1],[1, 1, 1,1,0],[-1,-1, 1,0,1],[1, 1, 1,1,0],[-1, 1, 1,0,0]] },
    { n: [ 0,  0, -1], verts: [[ 1,-1,-1,0,1],[-1,-1,-1,1,1],[-1, 1,-1,1,0],[1,-1,-1,0,1],[-1, 1,-1,1,0],[1, 1,-1,0,0]] },
    { n: [-1,  0,  0], verts: [[-1,-1,-1,0,1],[-1,-1, 1,1,1],[-1, 1, 1,1,0],[-1,-1,-1,0,1],[-1, 1, 1,1,0],[-1, 1,-1,0,0]] },
    { n: [ 1,  0,  0], verts: [[ 1,-1, 1,0,1],[ 1,-1,-1,1,1],[ 1, 1,-1,1,0],[1,-1, 1,0,1],[1, 1,-1,1,0],[1, 1, 1,0,0]] },
    { n: [ 0,  1,  0], verts: [[-1, 1, 1,0,1],[ 1, 1, 1,1,1],[ 1, 1,-1,1,0],[-1, 1, 1,0,1],[1, 1,-1,1,0],[-1, 1,-1,0,0]] },
    { n: [ 0, -1,  0], verts: [[-1,-1,-1,0,1],[ 1,-1,-1,1,1],[ 1,-1, 1,1,0],[-1,-1,-1,0,1],[1,-1, 1,1,0],[-1,-1, 1,0,0]] },
  ];

  const data: number[] = [];
  for (const face of faces) {
    for (const v of face.verts) {
      data.push(v[0], v[1], v[2]);// position
      data.push(...face.n); // normal (same for all verts on a face)
      data.push(v[3], v[4]);// uv
    }
  }
  const vd = new Float32Array(data);
  const id = new Uint32Array(vd.length / 8).map((_, i) => i); // sequential indices
  return { vd, id };
}

function generateSphere(stacks: number, slices: number): { vd: Float32Array; id: Uint32Array } {
  const verts: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= stacks; i++) {
    const phi = (i / stacks) * Math.PI;
    for (let j = 0; j <= slices; j++) {
      const theta = (j / slices) * 2 * Math.PI;
      const x = Math.sin(phi)*Math.cos(theta), y = Math.cos(phi), z = Math.sin(phi)*Math.sin(theta);
      verts.push(x,y,z, x,y,z, j/slices, i/stacks);
    }
  }
  for (let i = 0; i < stacks; i++) {
    for (let j = 0; j < slices; j++) {
      const a = i*(slices+1)+j, b = a+1, c = a+(slices+1), d = c+1;
      idx.push(a,c,b, b,c,d);
    }
  }
  return { vd: new Float32Array(verts), id: new Uint32Array(idx) };
}


// Geometry buffers — rebuilt when the user switches shape
let activeShape: "cube" | "sphere" = "cube";
let meshCenter: [number,number,number] = [0,0,0];

function buildVertexBuffer(shape: "cube" | "sphere"): { buf: GPUBuffer; count: number } {
  meshCenter = [0,0,0];

  const { vd, id } = shape === "cube" ? generateCube() : generateSphere(64, 64);
  const { verts, count } = expandToFlat(vd, id);
  const buf = device.createBuffer({
    size: verts.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(buf, 0, verts);
  return { buf, count };
}

//let { buf: vertexBuffer, count: vertexCount } = buildVertexBuffer("cube");


// Uniform buffer  structure
//
// Layout (byte offsets):
//   0   mvp        mat4   64 B
//   64  model      mat4   64 B
//   128 normalMat  mat4   64 B
//   192 lightPos   vec3   12 B  + 4 pad
//   208 lightColor vec3   12 B  + 4 pad
//   224 ambient    f32     4 B
//   228 diffuse    f32     4 B
//   232 specular   f32     4 B
//   236 shininess  f32     4 B
//   240 camPos     vec3   12 B
//   252 model_id   u32     4 B  ← packed with camPos pad
//   256 objectColor vec3  12 B
//   268 time       f32     4 B
// ─────────────────────────────────────────────────────────────────────────────
const UNIFORM_SIZE = 288;

const uniformBuffer = device.createBuffer({
  size: UNIFORM_SIZE,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

const uArrayBuf = new ArrayBuffer(UNIFORM_SIZE);
const uData     = new Float32Array(uArrayBuf);
const uData32   = new Uint32Array(uArrayBuf);

// Pipeline
const shader = device.createShaderModule({ label: "Lighting Shader", code: shaderCode });

const pipeline = device.createRenderPipeline({
  label: "Lighting Pipeline",
  layout: "auto",
  vertex: {
    module: shader,
    entryPoint: "vs_main",
    buffers: [{
      arrayStride: 11 * 4,//it was8 bfre
      attributes: [
        { shaderLocation: 0, offset: 0,     format: "float32x3" }, // position
        { shaderLocation: 1, offset: 3 * 4, format: "float32x3" }, // normal
        { shaderLocation: 2, offset: 6 * 4, format: "float32x3" }, // barycentric
        { shaderLocation: 3, offset: 9 * 4, format: "float32x2" }, // uv
      ],
    }],
  },
  fragment: { module: shader, entryPoint: "fs_main", targets: [{ format }] },
  primitive: { topology: "triangle-list", cullMode: "back" },
  depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
});

// Camera
const camera = new Camera();
camera.position = [0, 0, 5];

// ── Scene list

class MeshObject {
  vertexBuffer: GPUBuffer;
  drawCount:    number;
  center:       [number,number,number];
  uniformBuf:   GPUBuffer;
  bindGroup:    GPUBindGroup;
  transform = { tx:0, ty:0, tz:0, rx:0, ry:0, rz:0, sx:1, sy:1, sz:1 };
  boundingRadius: number = 1;
 
  private _uab  = new ArrayBuffer(UNIFORM_SIZE);
  private _uf32 = new Float32Array(this._uab);
  private _uu32 = new Uint32Array(this._uab);
 
  constructor(verts: Float32Array, count: number, center: [number,number,number] = [0,0,0], radius = 1) {
    this.drawCount = count;
    this.center    = center;          // local-space bounding centre
    this.boundingRadius = radius;
 
    this.vertexBuffer = device.createBuffer({
      size: verts.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.vertexBuffer, 0, verts);
 
    this.uniformBuf = device.createBuffer({
      size: UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
 
    this.bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuf } }],
    });
  }
  // Arcball state
  arcballBase: Quat = quat.identity();      
  arcballDrag: Quat = quat.identity();      
  arcballDragStart: [number,number,number] | null = null;

  getArcballMatrix(): Mat4 {
    const combined = quat.normalize(quat.multiply(this.arcballDrag, this.arcballBase));
    return quat.toMat4(combined);
  }

  worldCenter(): [number,number,number] {
    return [this.transform.tx, this.transform.ty, this.transform.tz];
  }

  //for arcball
  buildModel(): Mat4 {
    const [cx, cy, cz] = this.center;
 
    const toOrigin   = mat4.translation(-cx, -cy, -cz);
    const rotation   = this.getArcballMatrix();
    const scale      = mat4.scaling(this.transform.sx, this.transform.sy, this.transform.sz);
    const userOffset = mat4.translation(this.transform.tx, this.transform.ty, this.transform.tz);
     return mat4.multiply(
      userOffset,
      mat4.multiply(rotation, mat4.multiply(scale, toOrigin))
    );
  }
 
  uploadUniforms(
    proj: Float32Array, view: Float32Array, t: number,
    lx: number, ly: number, lz: number,
    lr: number, lg: number, lb: number,
    or: number, og: number, ob: number,
  ) {
    const [cx, cy, cz] = this.center;
    const model  = this.buildModel();
    //const model = mat4.multiply(
    //mat4.translation(this.transform.tx - cx, this.transform.ty - cy, this.transform.tz - cz),mat4.identity());
    const normM = mat4.normalMatrix(model);
    const mvp   = mat4.multiply(mat4.multiply(proj, view), model);
 
    this._uf32.set(mvp,   0);
    this._uf32.set(model, 16);
    this._uf32.set(normM, 32);
    this._uf32[48]=lx; this._uf32[49]=ly; this._uf32[50]=lz; this._uf32[51]=0;
    this._uf32[52]=lr; this._uf32[53]=lg; this._uf32[54]=lb; this._uf32[55]=0;
    this._uf32[56]=gui.ambient;   this._uf32[57]=gui.diffuse;
    this._uf32[58]=gui.specular;  this._uf32[59]=gui.shininess;
    this._uf32[60]=camera.position[0]; this._uf32[61]=camera.position[1]; this._uf32[62]=camera.position[2];
    this._uu32[63]=gui.modelId;
    this._uf32[64]=or; this._uf32[65]=og; this._uf32[66]=ob;
    this._uf32[67]=t;
 
    device.queue.writeBuffer(this.uniformBuf, 0, this._uab);
  }
 
  destroy() {
    this.vertexBuffer.destroy();
    this.uniformBuf.destroy();
  }
}

  //list
const sceneObjects: MeshObject[] = [];

(window as any).__getSelectedObject = () => sceneObjects[getSelectedIndex()] ?? null;
// GUI----------------------------------------------------------------------------------------------INIT GUI--------------------------------------------
initGUI(shape => {
  const { vd, id } = shape === "cube" ? generateCube() : generateSphere(64, 64);
  const { verts, count } = expandToFlat(vd, id);
  const obj = new MeshObject(verts, count, [0,0,0],1);
  obj.transform.tx = (sceneObjects.length % 2 === 0 ? 1 : -1) * Math.ceil(sceneObjects.length / 2) * 2.5;
  sceneObjects.push(obj);
});

// ── Arcball mouse controls-car
function toNDC(clientX: number, clientY: number): [number, number] {
  const rect = canvas.getBoundingClientRect();
  return [
    ((clientX - rect.left) / rect.width)  *  2 - 1,
   -((clientY - rect.top)  / rect.height) *  2 + 1,
  ];
}

canvas.addEventListener("mousedown", e => {
  if (e.button !== 0) return;
  const activeObj = (window as any).__getSelectedObject() as MeshObject | null;
  if (!activeObj) return;
  const [nx, ny] = toNDC(e.clientX, e.clientY);
  activeObj.arcballDragStart = screenToSphere(nx, ny);
  activeObj.arcballDrag      = quat.identity();
});

canvas.addEventListener("mousemove", e => {
  const activeObj = (window as any).__getSelectedObject() as MeshObject | null;
  if (!activeObj || !activeObj.arcballDragStart) return;
  const [nx, ny] = toNDC(e.clientX, e.clientY);
  const current  = screenToSphere(nx, ny);
  activeObj.arcballDrag = arcballRotation(activeObj.arcballDragStart, current);
});

canvas.addEventListener("mouseup", () => {
  const activeObj = (window as any).__getSelectedObject() as MeshObject | null;
  if (!activeObj || !activeObj.arcballDragStart) return;
  // Mouse_Release: last = current * last, reset current
  activeObj.arcballBase      = quat.normalize(quat.multiply(activeObj.arcballDrag, activeObj.arcballBase));
  activeObj.arcballDrag      = quat.identity();
  activeObj.arcballDragStart = null;
});

canvas.addEventListener("mouseleave", () => {
  const activeObj = (window as any).__getSelectedObject() as MeshObject | null;
  if (!activeObj) return;
  activeObj.arcballBase      = quat.normalize(quat.multiply(activeObj.arcballDrag, activeObj.arcballBase));
  activeObj.arcballDrag      = quat.identity();
  activeObj.arcballDragStart = null;
});





//defalt cube
{
  const { vd, id } = generateCube();
  const { verts, count } = expandToFlat(vd, id);
  const obj = new MeshObject(verts, count, [0,0,0],1);
  sceneObjects.push(obj);
}

(window as any).__onObjectRemoved = (index: number) => {//Called by gui.ts deleteSelected()
  if (index >= 0 && index < sceneObjects.length) {
    sceneObjects[index].destroy();
    sceneObjects.splice(index, 1);
  }
};

//for obj -------------------------
document.getElementById("obj-file-input")?.addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const { verts, count, cx, cy, cz, radius } = parseOBJ(await file.text());
  addObject(file.name.replace(".obj", ""));

  const obj = new MeshObject(verts, count, [cx, cy, cz],radius);
  obj.transform.tx = 0;
  obj.transform.ty = 0;
  obj.transform.tz = 0;
  sceneObjects.push(obj);

  camera.position = [0, cy, radius * 2.5]; 
  camera.yaw   = -Math.PI / 2;
  camera.pitch = 0;
 
  console.log(`${file.name}: ${count/3} tris, centre=[${cx.toFixed(1)},${cy.toFixed(1)},${cz.toFixed(1)}], r=${radius.toFixed(1)}`);
  (e.target as HTMLInputElement).value = "";

});


const keys = new Set<string>();
window.addEventListener("keydown", e => keys.add(e.key));
window.addEventListener("keyup",   e => keys.delete(e.key));


// Render loop
let lastTime    = performance.now();
const startTime = performance.now();

function frame(now: number) {
  const dt = Math.min(0.033, (now - lastTime) / 1000);
  lastTime = now;
  const t  = (now - startTime) / 1000;

  camera.update(keys, dt);

  const aspect = canvas.width / canvas.height;
  const proj   = mat4.perspective((60 * Math.PI) / 180, aspect, 0.1, 1500);//1500 instead 0f 100 so it fits

  const selObj = (window as any).__getSelectedObject() as MeshObject | null;
  const target: [number,number,number] = selObj
    ? selObj.worldCenter()
    : [0, 0, 0];    

  const view = mat4.lookAt(camera.position, target, [0, 1, 0]);

  const model  = mat4.translation(-meshCenter[0], -meshCenter[1], -meshCenter[2]);//c
  const normM  = mat4.normalMatrix(model);
  const mvp    = mat4.multiply(mat4.multiply(proj, view), model);

  let lx = gui.lightX, ly = gui.lightY, lz = gui.lightZ;
  if (gui.autoRotLight) {
    lx = Math.cos(t * 0.8) * 4.5;
    lz = Math.sin(t * 0.8) * 4.5;
  }

  const [or, og, ob] = hexToRgb(gui.objectColor);
  const [lr, lg, lb] = hexToRgb(gui.lightColor);

  uData.set(mvp,   0); uData.set(model, 16);  uData.set(normM, 32);
  uData[48] = lx;          uData[49] = ly;          uData[50] = lz; uData[51] = 0;
  uData[52] = lr;          uData[53] = lg;           uData[54] = lb; uData[55] = 0;
  uData[56] = gui.ambient; uData[57] = gui.diffuse;  uData[58] = gui.specular; uData[59] = gui.shininess;
  uData[60] = camera.position[0]; uData[61] = camera.position[1]; uData[62] = camera.position[2];
  uData32[63] = gui.modelId;//<-must be u32 bits
  uData[64] = or; uData[65] = og; uData[66] = ob;  uData[67] = t;

  device.queue.writeBuffer(uniformBuffer, 0, uArrayBuf);

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      clearValue: { r: 0.08, g: 0.08, b: 0.12, a: 1 },
      loadOp: "clear", storeOp: "store",
    }],
    depthStencilAttachment: {
      view: depthTexture!.createView(),
      depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store",
    },
  });

  pass.setPipeline(pipeline);
  for (const obj of sceneObjects) {
    obj.uploadUniforms(proj, view, t, lx, ly, lz, lr, lg, lb, or, og, ob);
    pass.setBindGroup(0, obj.bindGroup);
    pass.setVertexBuffer(0, obj.vertexBuffer);
    pass.draw(obj.drawCount);
  }

  pass.end();
  device.queue.submit([encoder.finish()]);
  requestAnimationFrame(frame);
}


//caro
// Expands indexed 8-float geometry to 11-float vertices with barycentric coords
function expandToFlat(vertData: Float32Array, indexData: Uint32Array): { verts: Float32Array; count: number } {
  const triCount = indexData.length / 3;
  const out = new Float32Array(triCount * 3 * 11);

  for (let t = 0; t < triCount; t++) {
    for (let c = 0; c < 3; c++) {
      const vi  = indexData[t * 3 + c];
      const dst = (t * 3 + c) * 11;
      out[dst+0]=vertData[vi*8+0]; out[dst+1]=vertData[vi*8+1]; out[dst+2]=vertData[vi*8+2];
      out[dst+3]=vertData[vi*8+3]; out[dst+4]=vertData[vi*8+4]; out[dst+5]=vertData[vi*8+5];
      // barycentric corner (1,0,0) / (0,1,0) / (0,0,1)
      out[dst+6]=BARY[c][0]; out[dst+7]=BARY[c][1]; out[dst+8]=BARY[c][2];
      out[dst+9]=vertData[vi*8+6]; out[dst+10]=vertData[vi*8+7];
    }
  }

  return { verts: out, count: out.length / 11 };
}

requestAnimationFrame(frame);
