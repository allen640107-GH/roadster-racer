// Scenery: sky, environment map, lights, terrain (mountains + coast), ocean, track meshes, props.
import * as THREE from '../vendor/three.module.js';
import { TRACK_HALF_WIDTH as HW, CURB_WIDTH, BARRIER_OFFSET } from './track.js';

export const SUN_DIR = new THREE.Vector3(-0.55, 0.42, -0.72).normalize();
const SKY_TOP = new THREE.Color(0x2f6fcf), SKY_HORIZON = new THREE.Color(0xcfe2f3), FOG_COLOR = new THREE.Color(0xc4d8ea);

// ---------- noise
function hash(x, y) { let h = x * 374761393 + y * 668265263; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, o = 5) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; } return s; }
function ridged(x, y, o = 5) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * (1 - Math.abs(vnoise(x * f, y * f) * 2 - 1)) ** 2; f *= 2.1; a *= 0.5; } return s; }
let seed = 1337; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

export function terrainHeight(x, z) {
  const r = Math.hypot(x, z);
  if (r < 440) return 0;
  const north = THREE.MathUtils.smoothstep(-z / r, -0.15, 0.45); // mountains to the north (-z)
  const t = r - 440;
  const mount = (t * 0.18 + ridged(x * 0.0035, z * 0.0035) * 260 * THREE.MathUtils.smoothstep(t, 0, 420) + fbm(x * 0.02, z * 0.02, 3) * 8) * THREE.MathUtils.smoothstep(t, 0, 80);
  const coast = -Math.min(t * 0.06, 6) + fbm(x * 0.01, z * 0.01, 3) * 2.5 * THREE.MathUtils.smoothstep(t, 0, 30) * (1 - THREE.MathUtils.smoothstep(t, 30, 120));
  return north * mount + (1 - north) * coast;
}

function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ---------- sky + environment
function skyMaterial(sunBoost = 12) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: SKY_TOP }, horizon: { value: SKY_HORIZON }, sunDir: { value: SUN_DIR }, sunBoost: { value: sunBoost } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*p; gl_Position.z = gl_Position.w; }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform float sunBoost; varying vec3 vDir;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
        return mix(mix(h21(i), h21(i+vec2(1,0)), u.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), u.x), u.y); }
      void main(){ vec3 d = normalize(vDir); float h = max(d.y, 0.0);
        vec3 col = mix(horizon, top, pow(h, 0.55));
        if (d.y < 0.0) col = mix(horizon, vec3(0.62,0.70,0.74), clamp(-d.y*4.0,0.0,1.0));
        float s = max(dot(d, normalize(sunDir)), 0.0);
        col += vec3(1.0,0.82,0.55) * pow(s, 8.0) * 0.35 + vec3(1.0,0.9,0.7) * pow(s, 64.0) * 0.6;
        col += vec3(1.0,0.97,0.9) * smoothstep(0.9993, 0.9997, s) * sunBoost;
        // procedural clouds projected on a sky plane
        if (d.y > 0.0) {
          vec2 uv = d.xz / (d.y + 0.08) * 1.6;
          float n = 0.0, a = 0.5; vec2 q = uv;
          for (int i = 0; i < 4; i++) { n += a * vnoise(q); q = q * 2.07 + vec2(13.1, 7.7); a *= 0.5; }
          float cl = smoothstep(0.52, 0.78, n) * smoothstep(0.0, 0.18, d.y);
          col = mix(col, mix(vec3(1.0), vec3(0.82,0.86,0.92), smoothstep(0.6,0.9,n)), cl * 0.85);
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

export function createSky(scene, renderer) {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), skyMaterial());
  sky.renderOrder = -1; sky.frustumCulled = false;
  scene.add(sky);
  scene.fog = new THREE.Fog(FOG_COLOR, 380, 2900);
  // environment for reflections
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMaterial(2.5)));
  const gnd = new THREE.Mesh(new THREE.CircleGeometry(95, 32), new THREE.MeshBasicMaterial({ color: 0x4d5a40 }));
  gnd.rotation.x = -Math.PI / 2; gnd.position.y = -2; envScene.add(gnd);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(envScene, 0.02, 0.1, 500);
  scene.environment = rt.texture;
  scene.environmentIntensity = 1.05;
  pm.dispose();
  return sky;
}

export function createLights(scene, quality) {
  const hemi = new THREE.HemisphereLight(0xd4e6ff, 0x4a5a38, 0.62); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffefd4, 3.35);
  sun.castShadow = true;
  const S = quality === 'low' ? 1024 : 2048;
  sun.shadow.mapSize.set(S, S);
  const c = sun.shadow.camera; c.left = -50; c.right = 50; c.top = 50; c.bottom = -50; c.near = 1; c.far = 320;
  sun.shadow.bias = -0.00035; sun.shadow.normalBias = 0.035;
  scene.add(sun); scene.add(sun.target);
  // Soft fill from ocean / sky opposite the sun
  const fill = new THREE.DirectionalLight(0xa8c4e8, 0.45);
  fill.position.set(40, 30, 60); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffd8a8, 0.28);
  rim.position.set(-30, 18, -40); scene.add(rim);
  return sun;
}

// ---------- terrain + ocean
export function createTerrain(scene) {
  const SIZE = 3600, SEG = 240;
  const g = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, colors = new Float32Array(p.count * 3);
  const grass = new THREE.Color(0x5f8a3a), grass2 = new THREE.Color(0x7a9a45), sand = new THREE.Color(0xd9c48e), rock = new THREE.Color(0x77736d), rock2 = new THREE.Color(0x5b5650), snow = new THREE.Color(0xf4f6f8), tmp = new THREE.Color();
  const dry = new THREE.Color(0x8a9a55), wet = new THREE.Color(0xcbb98a), cliff = new THREE.Color(0x6a6560);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), h = terrainHeight(x, z); p.setY(i, h);
    const n = fbm(x * 0.03, z * 0.03, 3);
    tmp.copy(grass).lerp(grass2, n).lerp(dry, Math.max(0, n - 0.55) * 0.35);
    const r = Math.hypot(x, z);
    // Beach band + wet sand near waterline
    if (h < 2.0 && r > 430) {
      const beach = THREE.MathUtils.smoothstep(2.0 - h, 0, 2.2) * THREE.MathUtils.smoothstep(r, 430, 460);
      tmp.lerp(sand, beach);
      if (h < 0.35) tmp.lerp(wet, THREE.MathUtils.smoothstep(0.35 - h, 0, 0.5));
    }
    // Coastal cliffs on the south/east where height rises sharply off the beach
    if (r > 450 && h > 4 && h < 40) {
      const north = THREE.MathUtils.smoothstep(-z / (r + 1e-3), -0.1, 0.4);
      tmp.lerp(cliff, (1 - north) * THREE.MathUtils.smoothstep(h, 4, 22) * 0.65);
    }
    if (h > 18) tmp.lerp(n > 0.5 ? rock : rock2, THREE.MathUtils.smoothstep(h, 18, 70));
    if (h > 150) tmp.lerp(snow, THREE.MathUtils.smoothstep(h + n * 40, 150, 210));
    colors.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  const noiseTex = canvasTex(256, 256, (ctx, w, h) => {
    const img = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) { const v = 200 + Math.random() * 55; img.data.set([v, v, v, 255], i * 4); }
    ctx.putImageData(img, 0, 0);
  });
  noiseTex.repeat.set(500, 500);
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, map: noiseTex });
  const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; scene.add(mesh);

  // ocean
  const nrm = canvasTex(256, 256, (ctx, w, h) => {
    const img = ctx.createImageData(w, h);
    const H = (x, y) => fbm(x / 24, y / 24, 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = (H((x + 1) % w, y) - H((x - 1 + w) % w, y)) * 3, dy = (H(x, (y + 1) % h) - H(x, (y - 1 + h) % h)) * 3;
      const v = new THREE.Vector3(-dx, -dy, 1).normalize();
      img.data.set([(v.x * 0.5 + 0.5) * 255, (v.y * 0.5 + 0.5) * 255, (v.z * 0.5 + 0.5) * 255, 255], (y * w + x) * 4);
    }
    ctx.putImageData(img, 0, 0);
  });
  nrm.colorSpace = THREE.NoColorSpace; nrm.repeat.set(160, 160);
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshPhysicalMaterial({ color: 0x176a88, roughness: 0.1, metalness: 0.05, normalMap: nrm, normalScale: new THREE.Vector2(0.7, 0.7), clearcoat: 0.75, clearcoatRoughness: 0.12, envMapIntensity: 1.35 }));
  ocean.rotation.x = -Math.PI / 2; ocean.position.y = -1.2; ocean.receiveShadow = false; scene.add(ocean);
  // Soft foam ring just outside the coastal shelf
  const foamTex = canvasTex(256, 256, (ctx, w, h) => {
    const img = ctx.createImageData(w, h);
    const ss = (e0, e1, x) => { x = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return x * x * (3 - 2 * x); };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const n = fbm(x / 18, y / 18, 4), a = Math.floor(ss(0.45, 0.75, n) * 180);
      img.data.set([245, 250, 255, a], (y * w + x) * 4);
    }
    ctx.putImageData(img, 0, 0);
  });
  foamTex.repeat.set(48, 48);
  const foam = new THREE.Mesh(new THREE.RingGeometry(455, 520, 96), new THREE.MeshBasicMaterial({ map: foamTex, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
  foam.rotation.x = -Math.PI / 2; foam.position.y = -1.05; scene.add(foam);
  return { mesh, ocean, foam, update: (t) => { nrm.offset.set(t * 0.004, t * 0.0025); foamTex.offset.set(t * 0.002, -t * 0.0015); } };
}

// ---------- track meshes
function curvatureMask(track) {
  const N = track.N, k = new Float32Array(N), mask = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const a = track.tan[(i - 4 + N) % N], b = track.tan[(i + 4) % N];
    k[i] = Math.acos(Math.min(1, a.dot(b))) / (8 * track.seg); // 1/R
  }
  for (let i = 0; i < N; i++) if (k[i] > 1 / 140) for (let d = -18; d <= 18; d++) mask[(i + d + N) % N] = 1;
  return { k, mask };
}

export function createTrackMeshes(scene, track, renderer) {
  const N = track.N, STEP = 2;
  const aniso = renderer.capabilities.getMaxAnisotropy();
  // asphalt texture with edge lines and dashed centre line baked in
  const roadTex = canvasTex(512, 1024, (ctx, w, h) => {
    ctx.fillStyle = '#3a3c40'; ctx.fillRect(0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < w * h; i++) {
      const n = (Math.random() - 0.5) * 38;
      const speck = Math.random() < 0.012 ? 28 : 0;
      img.data[i * 4] = Math.max(0, Math.min(255, img.data[i * 4] + n + speck));
      img.data[i * 4 + 1] = Math.max(0, Math.min(255, img.data[i * 4 + 1] + n + speck * 0.9));
      img.data[i * 4 + 2] = Math.max(0, Math.min(255, img.data[i * 4 + 2] + n + 2));
    }
    ctx.putImageData(img, 0, 0);
    // dual racing-line rubber streaks
    for (const [a, b, c] of [[0.22, 0.34, 0.46], [0.54, 0.66, 0.78]]) {
      const gr = ctx.createLinearGradient(0, 0, w, 0);
      gr.addColorStop(a, 'rgba(18,18,20,0)'); gr.addColorStop(b, 'rgba(18,18,20,0.28)'); gr.addColorStop(c, 'rgba(18,18,20,0)');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
    }
    // white edge lines
    ctx.fillStyle = '#f4f4f4';
    ctx.fillRect(w * 0.02, 0, w * 0.024, h); ctx.fillRect(w * 0.956, 0, w * 0.024, h);
    // dashed centre
    ctx.fillStyle = '#ececec';
    for (let y = 0; y < h; y += 48) ctx.fillRect(w * 0.492, y, w * 0.016, 26);
    // faint yellow pit-lane style inner edge (left)
    ctx.fillStyle = 'rgba(230,190,40,0.55)';
    ctx.fillRect(w * 0.055, 0, w * 0.01, h);
  });
  roadTex.anisotropy = aniso;
  const pos = [], uv = [], idx = [];
  let dist = 0;
  for (let i = 0; i <= N; i += STEP) {
    const j = i % N, p = track.pos[j], s = track.side[j];
    if (i > 0) dist += track.seg * STEP;
    pos.push(p.x - s.x * HW, 0.03, p.z - s.z * HW, p.x + s.x * HW, 0.03, p.z + s.z * HW);
    uv.push(0, dist / 20, 1, dist / 20);
  }
  const rows = pos.length / 6;
  for (let r = 0; r < rows - 1; r++) { const a = r * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  rg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  rg.setIndex(idx); rg.computeVertexNormals();
  const road = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.78, metalness: 0.04, envMapIntensity: 0.35, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  road.receiveShadow = true; scene.add(road);

  // run-off verge (darker grass/gravel band) under road edges
  const vpos = [], vidx = [];
  for (let i = 0; i <= N; i += STEP) { const j = i % N, p = track.pos[j], s = track.side[j], W = BARRIER_OFFSET + 1; vpos.push(p.x - s.x * W, 0.012, p.z - s.z * W, p.x + s.x * W, 0.012, p.z + s.z * W); }
  for (let r = 0; r < vpos.length / 6 - 1; r++) { const a = r * 2; vidx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const vg = new THREE.BufferGeometry(); vg.setAttribute('position', new THREE.Float32BufferAttribute(vpos, 3)); vg.setIndex(vidx); vg.computeVertexNormals();
  const vergeTex = canvasTex(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#6a7358'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgb(${90 + Math.random() * 70|0},${85 + Math.random() * 50|0},${60 + Math.random() * 40|0})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  });
  vergeTex.repeat.set(40, 40);
  const verge = new THREE.Mesh(vg, new THREE.MeshStandardMaterial({ map: vergeTex, color: 0x8a9078, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  verge.receiveShadow = true; scene.add(verge);

  // curbs (red/white) on corners
  const { mask } = curvatureMask(track);
  const cpos = [], ccol = [], red = new THREE.Color(0xd8211b), white = new THREE.Color(0xf4f4f4);
  for (const sd of [-1, 1]) {
    for (let i = 0; i < N; i += 2) {
      if (!mask[i]) continue;
      const j = (i + 2) % N, a = track.pos[i], b = track.pos[j], sa = track.side[i], sb = track.side[j];
      const r0 = HW - 0.15, r1 = HW + CURB_WIDTH;
      const q = [
        [a.x + sa.x * sd * r0, 0.05, a.z + sa.z * sd * r0], [a.x + sa.x * sd * r1, 0.035, a.z + sa.z * sd * r1],
        [b.x + sb.x * sd * r0, 0.05, b.z + sb.z * sd * r0], [b.x + sb.x * sd * r1, 0.035, b.z + sb.z * sd * r1],
      ];
      const tri = sd > 0 ? [0, 1, 2, 1, 3, 2] : [0, 2, 1, 1, 2, 3];
      const col = (Math.floor(i / 2) % 2) ? red : white;
      for (const t of tri) { cpos.push(...q[t]); ccol.push(col.r, col.g, col.b); }
    }
  }
  const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(cpos, 3)); cg.setAttribute('color', new THREE.Float32BufferAttribute(ccol, 3)); cg.computeVertexNormals();
  const curbs = new THREE.Mesh(cg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  curbs.receiveShadow = true; scene.add(curbs);

  // barriers: concrete wall with red/white stripes + blue top rail
  const bpos = [], bcol = [], Hh = 1.05, T = 0.5;
  const wall1 = new THREE.Color(0xe9e9e9), wall2 = new THREE.Color(0xc9241e), railC = new THREE.Color(0x2a4d8f), scuff = new THREE.Color(0x2a2a2c);
  const quad = (A, B, C, D, col) => { for (const v of [A, B, C, B, D, C]) { bpos.push(...v); bcol.push(col.r, col.g, col.b); } };
  for (const sd of [-1, 1]) {
    for (let i = 0; i < N; i += 4) {
      const j = (i + 4) % N, a = track.pos[i], b = track.pos[j], sa = track.side[i], sb = track.side[j];
      const off0 = BARRIER_OFFSET, off1 = BARRIER_OFFSET + T;
      const P = (pp, s, o, y) => [pp.x + s.x * sd * o, y, pp.z + s.z * sd * o];
      const col = (Math.floor(i / 4) % 2) ? wall1 : wall2;
      const inner = sd > 0 ? (A, B, C, D, c) => quad(A, B, C, D, c) : (A, B, C, D, c) => quad(B, A, D, C, c);
      // Lower wall face
      inner(P(a, sa, off0, 0), P(b, sb, off0, 0), P(a, sa, off0, 0.55), P(b, sb, off0, 0.55), col);
      // Mid tire-scuff band
      inner(P(a, sa, off0, 0.55), P(b, sb, off0, 0.55), P(a, sa, off0, 0.78), P(b, sb, off0, 0.78), scuff);
      // Upper wall face
      inner(P(a, sa, off0, 0.78), P(b, sb, off0, 0.78), P(a, sa, off0, Hh), P(b, sb, off0, Hh), col);
      // Blue Armco-style top rail (thicker)
      inner(P(a, sa, off0, Hh), P(b, sb, off0, Hh), P(a, sa, off1, Hh + 0.08), P(b, sb, off1, Hh + 0.08), railC);
      inner(P(b, sb, off1, 0), P(a, sa, off1, 0), P(b, sb, off1, Hh + 0.08), P(a, sa, off1, Hh + 0.08), wall1);
    }
  }
  const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(bpos, 3)); bg.setAttribute('color', new THREE.Float32BufferAttribute(bcol, 3)); bg.computeVertexNormals();
  const barriers = new THREE.Mesh(bg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide }));
  barriers.castShadow = true; barriers.receiveShadow = true; scene.add(barriers);

  // start/finish: checkered line + gate
  const p0 = track.pos[0], t0 = track.tan[0], yaw = Math.atan2(t0.x, t0.z);
  const checker = canvasTex(256, 32, (ctx, w, h) => { const s = 16; for (let y = 0; y < h / s; y++) for (let x = 0; x < w / s; x++) { ctx.fillStyle = (x + y) % 2 ? '#111' : '#f5f5f5'; ctx.fillRect(x * s, y * s, s, s); } }, false);
  const lineGeo = new THREE.PlaneGeometry(HW * 2, 1.8); lineGeo.rotateX(-Math.PI / 2);
  const line = new THREE.Mesh(lineGeo, new THREE.MeshStandardMaterial({ map: checker, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  line.rotation.y = yaw;
  line.position.set(p0.x, 0.04, p0.z); line.receiveShadow = true; scene.add(line);

  const gate = new THREE.Group(); gate.position.set(p0.x, 0, p0.z); gate.rotation.y = yaw; scene.add(gate);
  const steel = new THREE.MeshStandardMaterial({ color: 0x2b2e33, metalness: 0.8, roughness: 0.35 });
  const span = BARRIER_OFFSET + 1.3;
  for (const s of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 8, 0.9), steel); pillar.position.set(s * span, 4, 0); pillar.castShadow = true; gate.add(pillar);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 0.9, 1.8, 0.8), steel); beam.position.set(0, 7.6, 0); beam.castShadow = true; gate.add(beam);
  const banner = canvasTex(1024, 128, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#b3121b'); g.addColorStop(0.5, '#e01b24'); g.addColorStop(1, '#b3121b');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 70px "Noto Sans CJK TC","PingFang TC","Microsoft JhengHei",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('ROADSTER RACER  ·  起點 / 終點', w / 2, h / 2 + 4);
  }, false);
  const bmat = new THREE.MeshStandardMaterial({ map: banner, emissive: 0xffffff, emissiveMap: banner, emissiveIntensity: 0.35, roughness: 0.5 });
  for (const s of [-1, 1]) { const b = new THREE.Mesh(new THREE.PlaneGeometry(span * 2 - 1, 1.5), bmat); b.position.set(0, 7.6, s * 0.41); if (s < 0) b.rotation.y = Math.PI; gate.add(b); }
  // start lights
  const lightMat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff0000, emissiveIntensity: 0 });
  const startLights = [];
  for (let k = 0; k < 5; k++) { const lm = lightMat.clone(); const l = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 8), lm); l.position.set((k - 2) * 0.9, 6.3, -0.45); gate.add(l); startLights.push(lm); }

  // grandstand outside the barrier near the start
  const stand = new THREE.Group(); scene.add(stand);
  const crowd = canvasTex(512, 64, (ctx, w, h) => { ctx.fillStyle = '#555'; ctx.fillRect(0, 0, w, h); const cols = ['#e33', '#fff', '#36c', '#fc3', '#3a3', '#f7a', '#222']; for (let i = 0; i < 900; i++) { ctx.fillStyle = cols[i % cols.length]; ctx.beginPath(); ctx.arc(Math.random() * w, Math.random() * h, 2.6, 0, 7); ctx.fill(); } });
  crowd.repeat.set(6, 1);
  const standMat = new THREE.MeshStandardMaterial({ map: crowd, roughness: 0.9 }), concrete = new THREE.MeshStandardMaterial({ color: 0xbfc2c6, roughness: 0.9 });
  const sIdx = 40, sp = track.pos[sIdx], ss = track.side[sIdx], st = track.tan[sIdx];
  stand.position.set(sp.x - ss.x * (BARRIER_OFFSET + 9), 0, sp.z - ss.z * (BARRIER_OFFSET + 9)); stand.rotation.y = Math.atan2(st.x, st.z);
  for (let r = 0; r < 6; r++) { const step = new THREE.Mesh(new THREE.BoxGeometry(70, 0.9, 1.6), r % 2 ? standMat : standMat); step.position.set(0, 0.45 + r * 0.9, -r * 1.6); step.castShadow = step.receiveShadow = true; step.rotation.y = Math.PI / 2; step.position.set(-r * 1.6, 0.45 + r * 0.9, 0); stand.add(step); }
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7, 70), concrete); back.position.set(-9.5, 3.5, 0); back.castShadow = true; stand.add(back);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(13, 0.4, 72), new THREE.MeshStandardMaterial({ color: 0xeeeeee, metalness: 0.4, roughness: 0.4 })); roof.position.set(-4, 8.6, 0); roof.rotation.z = -0.08; roof.castShadow = true; stand.add(roof);
  for (const z of [-34, -12, 12, 34]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 8.6), steel); c.position.set(1.5, 4.3, z); stand.add(c); }

  // Braking distance markers on the main straight approach (before start)
  const markerMat = [
    new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.5 }),
    new THREE.MeshStandardMaterial({ color: 0xd01820, roughness: 0.5 }),
  ];
  for (const distM of [100, 150, 200]) {
    const idx = (N - Math.round(distM / track.seg) + N) % N;
    const pp = track.pos[idx], ss = track.side[idx], tt = track.tan[idx];
    for (const sd of [-1, 1]) {
      const board = new THREE.Group();
      board.position.set(pp.x + ss.x * sd * (HW + 1.8), 0, pp.z + ss.z * sd * (HW + 1.8));
      board.rotation.y = Math.atan2(tt.x, tt.z);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.6, 0.12), steel); post.position.y = 0.8; board.add(post);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.9), markerMat[0]); plate.position.set(0, 1.35, 0); board.add(plate);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.18, 0.9), markerMat[1]); stripe.position.set(0, 1.35, 0); board.add(stripe);
      // count bars = dist/50 style
      for (let k = 0; k < distM / 50; k++) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.7), markerMat[1]);
        bar.position.set(0, 1.05 - k * 0.16, 0); board.add(bar);
      }
      scene.add(board);
    }
  }

  // Sponsor boards along barriers (every ~40m on outside of a few corners)
  const sponsorCols = [0x1a3a8a, 0xc41e1e, 0x111111, 0xe8a010, 0x0a6b4a];
  for (let i = 80; i < N; i += 55) {
    if (!mask[i] && i % 110 !== 0) continue;
    const pp = track.pos[i], ss = track.side[i], tt = track.tan[i];
    const sd = (i % 2 === 0) ? 1 : -1;
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 1.1, 4.2),
      new THREE.MeshStandardMaterial({ color: sponsorCols[i % sponsorCols.length], roughness: 0.55, metalness: 0.15 })
    );
    board.position.set(pp.x + ss.x * sd * (BARRIER_OFFSET + 0.35), 1.4, pp.z + ss.z * sd * (BARRIER_OFFSET + 0.35));
    board.rotation.y = Math.atan2(tt.x, tt.z);
    board.castShadow = true; scene.add(board);
  }

  // Trackside floodlights near start/finish
  for (const side of [-1, 1]) {
    for (const along of [-18, 18]) {
      const i = (along + N) % N;
      const pp = track.pos[i], ss = track.side[i], tt = track.tan[i];
      const pole = new THREE.Group();
      pole.position.set(pp.x + ss.x * side * (BARRIER_OFFSET + 3.5), 0, pp.z + ss.z * side * (BARRIER_OFFSET + 3.5));
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 11, 8), steel);
      mast.position.y = 5.5; mast.castShadow = true; pole.add(mast);
      const head = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.25, 0.6), new THREE.MeshStandardMaterial({ color: 0x222226, metalness: 0.7, roughness: 0.35 }));
      head.position.set(-side * 0.5, 11.0, 0); head.rotation.z = side * 0.35; pole.add(head);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 0.4), new THREE.MeshStandardMaterial({ color: 0xffffee, emissive: 0xfff5d0, emissiveIntensity: 1.2 }));
      lamp.position.set(-side * 0.5, 10.85, 0); lamp.rotation.z = side * 0.35; pole.add(lamp);
      scene.add(pole);
    }
  }

  return { road, startLights };
}

// ---------- vegetation & rocks (instanced)
export function createProps(scene, track) {
  seed = 4242;
  const trunkG = new THREE.CylinderGeometry(0.18, 0.3, 2.4, 6); trunkG.translate(0, 1.2, 0);
  const coneG1 = new THREE.ConeGeometry(2.0, 4.4, 8); coneG1.translate(0, 4.0, 0);
  const coneG2 = new THREE.ConeGeometry(1.45, 3.4, 8); coneG2.translate(0, 6.2, 0);
  const blobG = new THREE.IcosahedronGeometry(2.4, 1); blobG.translate(0, 4.0, 0);
  const trunkM = new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 1 });
  const pineM = new THREE.MeshStandardMaterial({ color: 0x2f5a2c, roughness: 0.95, flatShading: true });
  const leafM = new THREE.MeshStandardMaterial({ color: 0x4f7d32, roughness: 0.95, flatShading: true });
  const pines = [], broads = [];
  let guard = 0;
  while ((pines.length + broads.length) < 1300 && guard++ < 20000) {
    const a = rnd() * Math.PI * 2, r = 30 + Math.sqrt(rnd()) * 780;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = terrainHeight(x, z);
    if (h < 0.4 && r > 440) continue;
    if (h > 120) continue;
    if (track.distToCenter(x, z, 40) < BARRIER_OFFSET + 6) continue;
    const s = 0.75 + rnd() * 0.7;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, h - 0.2, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd() * 6.28, 0)), new THREE.Vector3(s, s * (0.85 + rnd() * 0.4), s));
    (rnd() < 0.68 || h > 15 ? pines : broads).push(m);
  }
  const mk = (geo, mat, list) => { const im = new THREE.InstancedMesh(geo, mat, list.length); list.forEach((m, i) => im.setMatrixAt(i, m)); im.castShadow = true; im.receiveShadow = true; im.instanceMatrix.needsUpdate = true; scene.add(im); return im; };
  mk(trunkG, trunkM, [...pines, ...broads]); mk(coneG1, pineM, pines); mk(coneG2, pineM, pines); mk(blobG, leafM, broads);
  // tint variation
  // rocks
  const rockG = new THREE.IcosahedronGeometry(1, 1); const rp = rockG.attributes.position;
  for (let i = 0; i < rp.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(rp, i); v.multiplyScalar(0.75 + vnoise(v.x * 2 + 5, v.z * 2 + v.y * 3) * 0.5); rp.setXYZ(i, v.x, v.y * 0.7, v.z); }
  rockG.computeVertexNormals();
  const rocks = [];
  guard = 0;
  while (rocks.length < 320 && guard++ < 10000) {
    const a = rnd() * Math.PI * 2, r = 60 + Math.sqrt(rnd()) * 720;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, h = terrainHeight(x, z);
    if (h < -0.8) continue;
    if (track.distToCenter(x, z, 40) < BARRIER_OFFSET + 3) continue;
    const s = (0.6 + rnd() * 2.2) * (r > 440 ? 2.2 : 1);
    rocks.push(new THREE.Matrix4().compose(new THREE.Vector3(x, h, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd(), rnd() * 6, rnd())), new THREE.Vector3(s, s * (0.6 + rnd() * 0.6), s * (0.8 + rnd() * 0.5))));
  }
  mk(rockG, new THREE.MeshStandardMaterial({ color: 0x8a857c, roughness: 0.9, flatShading: true }), rocks);
  // lighthouse on the coast for the seaside vibe
  const lh = new THREE.Group(); const ang = 1.2, R = 470; const lx = Math.cos(ang) * R, lz = Math.sin(ang) * R;
  lh.position.set(lx, Math.max(0, terrainHeight(lx, lz)), lz); scene.add(lh);
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.2, 24, 20), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 })); tower.position.y = 12; tower.castShadow = true; lh.add(tower);
  for (const y of [6, 14]) { const band = new THREE.Mesh(new THREE.CylinderGeometry(2.9 - y * 0.035, 3.0 - y * 0.035, 3, 20), new THREE.MeshStandardMaterial({ color: 0xc8202a, roughness: 0.6 })); band.position.y = y; lh.add(band); }
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 2.2, 12), new THREE.MeshStandardMaterial({ color: 0xffffcc, emissive: 0xfff0a0, emissiveIntensity: 2.5 })); lamp.position.y = 25; lh.add(lamp);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(2.2, 2.2, 12), new THREE.MeshStandardMaterial({ color: 0x222222 })); cap.position.y = 27.2; lh.add(cap);
}
