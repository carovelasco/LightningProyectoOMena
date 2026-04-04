// shader.wgsl
// The uniform struct and vertex pipeline are already wired up for you.
// model_id values:
//   0 = Gouraud
//   1 = Phong
//   2 = Normals
//   3 = Wireframe
//   4 = Depth
//   5 = Texture
//   6 = UV Coords
//
// Useful WGSL built-ins:
//   normalize(v) — returns unit vector
//   dot(a, b) — scalar dot product
//   reflect(I, N) — reflects incident vector I around normal N
//   max(a, b) — component-wise max
//   pow(base, exp) — power function
//   dpdx(v), dpdy(v) — screen-space partial derivatives (fragment stage only)
//   cross(a, b)— cross product

struct Uniforms {
  mvp        : mat4x4<f32>,
  model      : mat4x4<f32>,
  normalMat  : mat4x4<f32>,

  lightPos   : vec3<f32>,
  _p0        : f32,

  lightColor : vec3<f32>,
  _p1        : f32,

  ambient    : f32,
  diffuse    : f32,
  specular   : f32,
  shininess  : f32,

  camPos     : vec3<f32>,
  model_id   : u32,

  objectColor : vec3<f32>,
  time        : f32,
  use_texture : u32,
  _p4 : f32,
  _p5 : f32,
  _p6 : f32,
};

@group(0) @binding(0) var<uniform> u : Uniforms;
@group(0) @binding(1) var tex_samp : sampler;
@group(0) @binding(2) var tex_img  : texture_2d<f32>;

struct VSIn {
  @location(0) position    : vec3<f32>,
  @location(1) normal      : vec3<f32>,
  @location(2) barycentric : vec3<f32>,
  @location(3) uv          : vec2<f32>,
};

struct VSOut {
  @builtin(position) clipPos : vec4<f32>,
  @location(0) worldPos      : vec3<f32>,
  @location(1) worldNormal   : vec3<f32>,
  @location(2) uv            : vec2<f32>,
  @location(3) gouraudColor  : vec3<f32>,
  @location(4) barycentric   : vec3<f32>,
  @location(5) depth: f32,

};

fn gouraudLighting(N: vec3<f32>, vertWorldPos: vec3<f32>) -> vec3<f32> {
  let L = normalize(u.lightPos - vertWorldPos);
  let V = normalize(u.camPos   - vertWorldPos);

  let ambientC  = u.ambient * u.lightColor;
  let NdotL     = max(dot(N, L), 0.0);
  let diffuseC  = u.diffuse * NdotL * u.lightColor;

  var specularC = vec3<f32>(0.0);
  if NdotL > 0.0 {
    let R = reflect(-L, N);
    specularC = u.specular * pow(max(dot(R, V), 0.0), u.shininess) * u.lightColor;
  }

  return (ambientC + diffuseC + specularC) * u.objectColor;
}

fn phongLighting(N: vec3<f32>, fragWorldPos: vec3<f32>, baseColor: vec3<f32>) -> vec3<f32> {
  let L = normalize(u.lightPos - fragWorldPos);
  let V = normalize(u.camPos   - fragWorldPos);
  let ambientC  = u.ambient * u.lightColor;
  let NdotL     = max(dot(N, L), 0.0);
  let diffuseC  = u.diffuse * NdotL * u.lightColor;
  var specularC = vec3<f32>(0.0);
  if NdotL > 0.0 {
    let R = reflect(-L, N);
    specularC = u.specular * pow(max(dot(R, V), 0.0), u.shininess) * u.lightColor;
  }
  return (ambientC + diffuseC + specularC) * baseColor;
}

fn blinnPhongLighting(N: vec3<f32>, fragWorldPos: vec3<f32>, baseColor: vec3<f32>) -> vec3<f32> {
  let L = normalize(u.lightPos - fragWorldPos);
  let V = normalize(u.camPos   - fragWorldPos);
  let ambientC  = u.ambient * u.lightColor;
  let NdotL     = max(dot(N, L), 0.0);
  let diffuseC  = u.diffuse * NdotL * u.lightColor;
  var specularC = vec3<f32>(0.0);
  if NdotL > 0.0 {
    let H = normalize(L + V);
    specularC = u.specular * pow(max(dot(N, H), 0.0), u.shininess) * u.lightColor;
  }
  return (ambientC + diffuseC + specularC) * baseColor;
}

fn wireframeEdgeFactor(bary: vec3<f32>) -> f32 {
  let d  = fwidth(bary);
  let a3 = smoothstep(vec3<f32>(0.0), d * 1.5, bary);
  return min(min(a3.x, a3.y), a3.z);
}

@vertex
fn vs_main(input: VSIn) -> VSOut {
  var out: VSOut;

  let worldPos4    = u.model    * vec4<f32>(input.position, 1.0);
  let worldNormal4 = u.normalMat * vec4<f32>(input.normal, 0.0);

  out.clipPos     = u.mvp * vec4<f32>(input.position, 1.0);
  out.worldPos    = worldPos4.xyz;
  out.worldNormal = normalize(worldNormal4.xyz);
  out.uv          = input.uv;
  out.barycentric = input.barycentric;
  out.depth = out.clipPos.z / out.clipPos.w;


  if u.model_id == 0u {
    out.gouraudColor = gouraudLighting(out.worldNormal, out.worldPos);
  } else {
    out.gouraudColor = vec3<f32>(0.0);
  }

  return out;
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
  var color: vec3<f32>;
  let N = normalize(input.worldNormal);

  var baseColor = u.objectColor;
  if u.use_texture == 1u {
    baseColor = textureSample(tex_img, tex_samp, input.uv).rgb;
  }

  switch u.model_id {
    case 0u: {
      color = input.gouraudColor;
      if u.use_texture == 1u {
        color = color * textureSample(tex_img, tex_samp, input.uv).rgb;
      }
    }
    case 1u: {
      color = phongLighting(N, input.worldPos, baseColor);
    }
    case 2u: {
      color = N * 0.5 + vec3<f32>(0.5);
    }
    case 3u: {
      let edgeFactor = wireframeEdgeFactor(input.barycentric);
      let wireColor = vec3<f32>(0.0, 0.0, 0.0);   
      let fillColor = vec3<f32>(1.0, 1.0, 1.0);
      color = mix(wireColor, fillColor, edgeFactor);
    }
    case 4u: {
      let d = (input.depth + 1.0) * 0.5;
      color = vec3<f32>(d);
    }
    case 5u: {
      let tc = textureSample(tex_img, tex_samp, input.uv).rgb;
      color = phongLighting(N, input.worldPos, tc);
    }
    case 6u: {
      color = vec3<f32>(input.uv, 0.0);
    }
    default: {
      color = blinnPhongLighting(N, input.worldPos, baseColor);
    }
  }

  return vec4<f32>(color, 1.0);
}