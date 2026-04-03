

// Shared GUI state  (read by the render loop in main.ts)
export const gui = {
  modelId:      0,
  ambient:      0.12,
  diffuse:      0.75,
  specular:     0.60,
  shininess:    32,
  lightX:       3.0,
  lightY:       4.0,
  lightZ:       3.0,
  autoRotLight: true,
  objectColor:  "#4a9eff",
  lightColor:   "#ffffff",

   // Per-object transform (for the selected object in scene)
  translateX: 0, translateY: 0, translateZ: 0,
  rotateX: 0, rotateY: 0, rotateZ: 0,
  scaleX: 1, scaleY: 1, scaleZ: 1,
  useTexture: false,
};

// Colour utility
export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

// Model metadata
const MODEL_DESCS: Record<number, string> = {
  //0: "Flat: face normal derived from dpdx/dpdy — one colour per triangle, hard faceted edges.",
  0:"Gouraud: lighting computed per vertex in vs_main, interpolated across the face. Implement gouraudLighting() in shader.wgsl.",
  1: "Phong: smooth normals interpolated per pixel, full lighting in fs_main. Implement phongLighting() in shader.wgsl.",
  2: "Normals: RGB visualisation of world-space normals.",
  3: "Wireframe: edge-only rendering with hidden surface removal.",
  4: "Depth: fragment depth encoded as greyscale.",
  5: "Texture: spherical UV parameterisation with loaded texture.",
  6: "UV Coords: UV coordinates visualised as RG colour.",
};

// Update the auto-rotating light display
export function updateLightDisplay(lx: number, lz: number) {
  (document.getElementById("lightX") as HTMLInputElement).value = lx.toFixed(1);
  document.getElementById("lightX-val")!.textContent = lx.toFixed(1);
  (document.getElementById("lightZ") as HTMLInputElement).value = lz.toFixed(1);
  document.getElementById("lightZ-val")!.textContent = lz.toFixed(1);
}

let sceneObjects: Array<{ id: number; type: string; label: string }> = [];
let selectedId = -1;

//i added this function to render the list of objects in the scene and allow selection-caro
function renderSceneList() {
  const list = document.getElementById("scene-list");
  if (!list) return;
  list.innerHTML = sceneObjects.map((obj, i) =>
    `<div class="scene-item ${obj.id === selectedId ? "active" : ""}" data-id="${obj.id}">
      <span class="scene-idx">${i + 1}.</span> ${obj.label}
    </div>`
  ).join("");
  list.querySelectorAll<HTMLDivElement>(".scene-item").forEach(el => {
    el.addEventListener("click", () => {
      selectedId = Number(el.dataset.id);
      renderSceneList();
      updateRightPanel();
    });
  });
}

//in case new object is added-caro
function updateRightPanel() {
  const titleEl = document.getElementById("obj-type-title");
  if (!titleEl) return;
  const obj = sceneObjects.find(o => o.id === selectedId);
  titleEl.textContent = obj ? obj.type.toUpperCase() : "";
}
let _nextId = 1;
export function addObject(type: string) {
  const id = _nextId++;
  sceneObjects.push({ id, type, label: type.charAt(0).toUpperCase() + type.slice(1) });
  selectedId = id;
  renderSceneList();
  updateRightPanel();
}

//to delete the selected object from the scene-caro
function deleteSelected() {
  const idx= sceneObjects.findIndex(o => o.id === selectedId );
  sceneObjects = sceneObjects.filter(o => o.id !== selectedId);
  selectedId = sceneObjects.length > 0 ? sceneObjects[sceneObjects.length - 1].id : -1;
  renderSceneList();
  updateRightPanel();
  (window as any).__onObjectRemoved?.(idx); 
}


// HTML helpers
function slider(id: string, label: string, min: number, max: number, step: number, val: number, isCompact = false) {
  return `
   <div class="slider-row ${isCompact ? "compact" : ""}">
    <span class="slider-label">${label}</span>
    <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}">
    <span class="slider-val" id="${id}-val">${val}</span>
  </div>`;
}

//for the buttons of each shading-caro
const RENDER_MODES = [
  { id: 0, label: "Gouraud" },
  { id: 1, label: "Phong"   },
  { id: 2, label: "Normals" },
  { id: 3, label: "Wireframe" },
  { id: 4, label: "Depth"   },
  { id: 5, label: "Texture" },
  { id: 6, label: "UV Coords" },
];


// initGUI — build the overlayRight and wire up all events
// onShapeChange is called with the new shape whenever the user switches




export function initGUI(onShapeChange: (shape: "cube" | "sphere") => void) {
 // ── LEFT PANEL-caro
  const overlayLeft = document.createElement("div");
  overlayLeft.id = "left-panel";
  overlayLeft.innerHTML = `
    <div class="panel-title">PIPELINE</div>
    
    <div class="panel-section">
      <div class="section-label">ADD OBJECT</div>
      <div class="btn-row">
        <button class="pill-btn" id="add-sphere">Sphere</button>
        <button class="pill-btn" id="add-cube">Cube</button>
      </div>
    </div>
    
    <div class="panel-section">
      <div class="section-label">ADD OBJ MODEL</div>
      <div class="file-row">
        <label class="file-btn" for="obj-file-input">Seleccionar archivo</label>
        <input type="file" id="obj-file-input" accept=".obj" style="display:none">
        <span class="file-name" id="obj-file-name">Sin archivos seleccionados</span>
      </div>
    </div>
    
    <div class="panel-section">
      <div class="section-label">RENDER MODE (GLOBAL)</div>
      <div class="model-btns" id="render-mode-btns">
        ${RENDER_MODES.slice(0,6).map(m =>
          `<button class="model-btn ${m.id === gui.modelId ? "active" : ""}" data-id="${m.id}">${m.label}</button>`
        ).join("")}
      </div>
      <div class="btn-row" style="margin-top:6px">
        <button class="model-btn wide ${gui.modelId === 6 ? "active" : ""}" data-id="6">UV Coords</button>
      </div>
      <div class="model-desc" id="model-desc">${MODEL_DESCS [gui.modelId]}</div>
    </div>
    
    <div class="panel-section">
      <div class="section-label">GLOBAL LIGHT COLOR</div>
      <div class="color-row-left">
        <span>Light</span>
        <input type="color" id="lightColor" value="${gui.lightColor}">
      </div>
    </div>
    
    <div class="panel-hint">No selection: drag orbits camera<br>Object selected: drag rotates object<br>Scroll: zoom toward target</div>
    `;
  document.body.appendChild(overlayLeft);
 
//RIGHT based on the base project 
  const overlayRight = document.createElement("div");
  overlayRight.id = "right-panel";
  overlayRight.innerHTML = `
<div class="panel-title">SCENE</div>
<div class="scene-list" id="scene-list"></div>
<div class="scene-actions">
  <button class="scene-act-btn" id="btn-deselect">Deselect</button>
  <button class="scene-act-btn danger" id="btn-remove">Remove</button>
</div>
 
<div class="obj-sliders" id="obj-sliders">
  <div class="obj-section-title" id="obj-type-title"></div>
 
  <div class="slider-group-title">TRANSFORM</div>
  ${slider("translateX", "Translate X", -12, 12, 0.01, 0, true)}
  ${slider("translateY", "Translate Y", -12, 12, 0.01, 0, true)}
  ${slider("translateZ", "Translate Z", -12, 12, 0.01, 0, true)}
  ${slider("rotateX",    "Rotate X",    -180, 180, 1,   0, true)}
  ${slider("rotateY",    "Rotate Y",    -180, 180, 1,   0, true)}
  ${slider("rotateZ",    "Rotate Z",    -180, 180, 1,   0, true)}
  ${slider("scaleX",     "Scale X",     0.01, 5,  0.01, 1, true)}
  ${slider("scaleY",     "Scale Y",     0.01, 5,  0.01, 1, true)}
  ${slider("scaleZ",     "Scale Z",     0.01, 5,  0.01, 1, true)}
 
  <div class="slider-group-title">MATERIAL</div>
  ${slider("ambient",   "Ambient (Ka)",  0, 1,   0.01, gui.ambient,   true)}
  ${slider("diffuse",   "Diffuse (Kd)",  0, 1,   0.01, gui.diffuse,   true)}
  ${slider("specular",  "Specular (Ks)", 0, 1,   0.01, gui.specular,  true)}
  ${slider("shininess", "Shininess (n)", 1, 256, 1,    gui.shininess, true)}
  <div class="slider-row compact">
    <span class="slider-label">Object color</span>
    <input type="color" id="objectColor" value="${gui.objectColor}">
  </div>
 
  <div class="slider-group-title">TEXTURE (SPHERICAL UV)</div>
  <div class="file-row">
    <label class="file-btn" for="tex-file-input">Seleccionar archivo</label>
    <input type="file" id="tex-file-input" accept="image/*" style="display:none">
    <span class="file-name" id="tex-file-name">Sin archivos seleccionados</span>
  </div>
  <label class="checkbox-row">
    <input type="checkbox" id="useTexture"> Use texture
  </label>
</div>
`;
  document.body.appendChild(overlayRight);


   // ── Wire render mode buttons
  document.querySelectorAll<HTMLButtonElement>("[data-id]").forEach(btn => {
    btn.addEventListener("click", () => {
      gui.modelId = Number(btn.dataset.id);
      document.querySelectorAll("[data-id]").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(`[data-id="${gui.modelId}"]`).forEach(b => b.classList.add("active"));
      const d = document.getElementById("model-desc");
      if (d) d.textContent = MODEL_DESCS[gui.modelId];
    });
  });
 
  // ── Add object buttons -caro
  document.getElementById("add-sphere")?.addEventListener("click", () => {
    addObject("Sphere");
    onShapeChange("sphere");
  });
  document.getElementById("add-cube")?.addEventListener("click", () => {
    addObject("Cube");
    onShapeChange("cube");
  });
 
  document.getElementById("btn-deselect")?.addEventListener("click", () => {
    selectedId = -1;
    renderSceneList();
    updateRightPanel();
  });
  document.getElementById("btn-remove")?.addEventListener("click", deleteSelected);
 
  // OBJ file input-caro
  document.getElementById("obj-file-input")?.addEventListener("change", e => {
    const f = (e.target as HTMLInputElement).files?.[0];
    const nameEl = document.getElementById("obj-file-name");
    if (nameEl) nameEl.textContent = f ? f.name : "Sin archivos seleccionados";
  });
  document.getElementById("tex-file-input")?.addEventListener("change", e => {
    const f = (e.target as HTMLInputElement).files?.[0];
    const nameEl = document.getElementById("tex-file-name");
    if (nameEl) nameEl.textContent = f ? f.name : "Sin archivos seleccionados";
  });



//   <div class="gui-section">
//     <div class="gui-label">Material</div>
//     ${slider("ambient",   "Ambient (Ka)",  0,   1,   0.01, gui.ambient)}
//     ${slider("diffuse",   "Diffuse (Kd)",  0,   1,   0.01, gui.diffuse)}
//     ${slider("specular",  "Specular (Ks)", 0,   1,   0.01, gui.specular)}
//     ${slider("shininess", "Shininess (n)", 1,   256, 1,    gui.shininess)}
//   </div>


//   <div class="gui-section">
//     <div class="gui-label">Colors</div>
//     <div class="color-row"><span>Object</span><input type="color" id="objectColor" value="${gui.objectColor}"></div>
//     <div class="color-row"><span>Light</span><input type="color" id="lightColor"  value="${gui.lightColor}"></div>
//   </div>

//   <div class="gui-hint">WASD/QE move · Arrows look</div>
// </div>`;
//   document.body.appendChild(overlayRight);

//   // Model description
//   function updateDesc() {
//     document.getElementById("model-desc")!.textContent = MODEL_DESCS[gui.modelId];
//   }
//   updateDesc();

//   // Shading model buttons
//   document.querySelectorAll<HTMLButtonElement>(".model-btn").forEach(btn => {
//     btn.addEventListener("click", () => {
//       gui.modelId = Number(btn.dataset.id);
//       document.querySelectorAll(".model-btn").forEach(b => b.classList.remove("active"));
//       btn.classList.add("active");
//       updateDesc();
//     });
//   });

//   // Shape buttons
//   document.querySelectorAll<HTMLButtonElement>(".shape-btn").forEach(btn => {
//     btn.addEventListener("click", () => {
//       const shape = btn.dataset.shape as "cube" | "sphere";
//       document.querySelectorAll(".shape-btn").forEach(b => b.classList.remove("active"));
//       btn.classList.add("active");
//       document.getElementById("shape-desc")!.textContent =
//         shape === "sphere"
//           ? "Implement generateSphere() in main.ts to see the sphere."
//           : "Cube is provided as a reference.";
//       onShapeChange(shape);
//     });
//   });

  // Sliders
  (["ambient", "diffuse", "specular", "shininess", "translateX", "translateY", "translateZ", "rotateX", "rotateY", "rotateZ","scaleX", "scaleY", "scaleZ",] as const).forEach(id => {
  const el = document.getElementById(id) as HTMLInputElement | null;
    const valEl = document.getElementById(`${id}-val`)!;
    if (!el || !valEl) return;
    el.addEventListener("input", () => {
    (gui as Record<string, number | string | boolean>)[id] = parseFloat(el.value);    
    valEl.textContent = el.value;
    });
  });

  // Checkboxes & colour pickers
  (document.getElementById("autoRotLight") as HTMLInputElement)
    ?.addEventListener("change", e => { gui.autoRotLight = (e.target as HTMLInputElement).checked; });

  (document.getElementById("objectColor") as HTMLInputElement)
    .addEventListener("input", e => { gui.objectColor = (e.target as HTMLInputElement).value; });

  (document.getElementById("lightColor") as HTMLInputElement)
    .addEventListener("input", e => { gui.lightColor = (e.target as HTMLInputElement).value; });

    // Use texture -csro
  (document.getElementById("useTexture") as HTMLInputElement)
    .addEventListener("change", e => { gui.useTexture = (e.target as HTMLInputElement).checked; });

    addObject("Cube");

}
export function getSelectedIndex(): number {
  return sceneObjects.findIndex(o => o.id === selectedId);
}