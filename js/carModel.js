// Procedural Tesla Roadster (2026 unveil / aerospace wedge) — refined detail pass.
// Local frame: +Z forward, +Y up, +X = car's left. Ground at y = 0.
import * as THREE from '../vendor/three.module.js';
import { CAR } from './vehicle.js';

const smooth = (t) => t * t * (3 - 2 * t);
function interp(keys, z) {
  if (z <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [z0, v0] = keys[i], [z1, v1] = keys[i + 1];
    if (z <= z1) return v0 + (v1 - v0) * smooth((z - z0) / (z1 - z0));
  }
  return keys[keys.length - 1][1];
}
const sgnPow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);

const ZR = -2.20, ZF = 2.28;
const WF = CAR.frontZ, WR = CAR.rearZ, WC = CAR.wheelRadius;

// Angular wedge: sharp nose, flat deck, abrupt truncated rear (SR-71 / F-35 cues)
const W_KEYS = [[ZR, 0.78], [-2.05, 0.92], [-1.7, 1.02], [-1.3, 1.08], [-1.1, 1.06], [-0.4, 1.0], [0.3, 0.98], [0.9, 1.04], [1.36, 1.08], [1.55, 1.02], [1.85, 0.88], [2.1, 0.68], [2.2, 0.42], [ZF, 0.18]];
const H_KEYS = [[ZR, 0.62], [-2.05, 0.78], [-1.7, 0.88], [-1.3, 0.95], [-1.2, 0.93], [-0.6, 0.90], [0.2, 0.86], [0.8, 0.80], [1.36, 0.78], [1.55, 0.68], [1.8, 0.52], [2.05, 0.42], [2.18, 0.34], [ZF, 0.28]];
const B_KEYS = [[ZR, 0.38], [-2.0, 0.26], [-1.6, 0.18], [1.6, 0.16], [2.0, 0.22], [ZF, 0.30]];

function archBottom(z, base, topC) {
  let b = base;
  for (const zw of [WF, WR]) {
    // Smooth semicircle well; tire top≈0.72 needs lip≳0.78; keep ≥16cm roof above lip
    const R = 0.48, d = z - zw;
    if (Math.abs(d) < R) {
      const arch = 0.34 + Math.sqrt(Math.max(0, R * R - d * d)) * 0.92; // peak ≈ 0.78
      b = Math.max(b, Math.min(arch, topC - 0.16));
    }
  }
  return b;
}
function fender(z) {
  return 0.14 * Math.exp(-(((z - WF) / 0.50) ** 2)) + 0.12 * Math.exp(-(((z - WR) / 0.55) ** 2));
}

function loft({ zs, M, section, capStart = true, capEnd = true }) {
  const pos = [], idx = [];
  zs.forEach((z) => { for (const [x, y] of section(z)) pos.push(x, y, z); });
  const S = zs.length;
  for (let i = 0; i < S - 1; i++) for (let j = 0; j < M; j++) {
    const a = i * M + j, b = i * M + (j + 1) % M, c = (i + 1) * M + j, d = (i + 1) * M + (j + 1) % M;
    idx.push(a, b, c, b, d, c);
  }
  const addCap = (ring, flip) => {
    const ci = pos.length / 3; let cx = 0, cy = 0;
    for (let j = 0; j < M; j++) { cx += pos[(ring * M + j) * 3]; cy += pos[(ring * M + j) * 3 + 1]; }
    pos.push(cx / M, cy / M, pos[ring * M * 3 + 2]);
    for (let j = 0; j < M; j++) { const a = ring * M + j, b = ring * M + (j + 1) % M; flip ? idx.push(ci, a, b) : idx.push(ci, b, a); }
  };
  if (capStart) addCap(0, false);
  if (capEnd) addCap(S - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function bodyPoint(z, th) {
  const W = interp(W_KEYS, z), H = interp(H_KEYS, z), fb = fender(z);
  const B = archBottom(z, interp(B_KEYS, z), H);
  const xn = sgnPow(Math.cos(th), 0.38), yn = sgnPow(Math.sin(th), 0.45);
  const tumble = 1 - 0.18 * Math.pow(Math.max(0, yn), 1.4) - 0.05 * Math.pow(Math.max(0, -yn), 2);
  const top = H + 0.018 * (1 - xn * xn) + fb * Math.pow(Math.abs(xn), 2.5);
  return [W * xn * tumble, B + (yn + 1) / 2 * (top - B)];
}

function surfaceMatrix(z, th, sweep, scale, lift = 0.004) {
  const P = (zz, tt) => { const [x, y] = bodyPoint(zz, tt); return new THREE.Vector3(x, y, zz); };
  const p = P(z, th), dz = P(z + 0.01, th).sub(P(z - 0.01, th)).normalize(), dt = P(z, th + 0.01).sub(P(z, th - 0.01)).normalize();
  let n = new THREE.Vector3().crossVectors(dt, dz).normalize();
  if (n.dot(new THREE.Vector3(p.x, p.y - 0.5, 0)) < 0 && n.z < 0.3) n.negate();
  const X = dz.clone().multiplyScalar(Math.cos(sweep)).addScaledVector(dt, Math.sin(sweep)).normalize();
  const Z = new THREE.Vector3().crossVectors(X, n).normalize(); const Y = new THREE.Vector3().crossVectors(Z, X);
  const m = new THREE.Matrix4().makeBasis(X, Y, Z); m.setPosition(p.addScaledVector(n, lift));
  return m.multiply(new THREE.Matrix4().makeScale(...scale));
}

function addBox(parent, mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz); parent.add(m); return m;
}

export function createMaterials(envMap, paintColor = 0xf2f0ea) {
  return {
    paint: new THREE.MeshPhysicalMaterial({
      color: paintColor, metalness: 0.62, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.03,
      envMapIntensity: 1.55, reflectivity: 0.9,
    }),
    paintAccent: new THREE.MeshPhysicalMaterial({
      color: 0xe8e4dc, metalness: 0.7, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.3,
    }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x2a2418, metalness: 0.35, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.02,
      transparent: true, opacity: 0.42, envMapIntensity: 1.6,
      attenuationColor: 0xc9a227, attenuationDistance: 0.55,
      transmission: 0.35, ior: 1.45,
      depthWrite: false,
    }),
    mirrorGlass: new THREE.MeshPhysicalMaterial({
      color: 0x8899aa, metalness: 1, roughness: 0.05, envMapIntensity: 2.2,
    }),
    black: new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.5, metalness: 0.2 }),
    gloss: new THREE.MeshPhysicalMaterial({ color: 0x060606, roughness: 0.12, metalness: 0.45, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.2 }),
    gap: new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.95, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xc8c4bc, metalness: 1, roughness: 0.12, envMapIntensity: 1.6 }),
    titanium: new THREE.MeshStandardMaterial({ color: 0x8a8780, metalness: 0.95, roughness: 0.26, envMapIntensity: 1.4 }),
    carbon: new THREE.MeshStandardMaterial({ color: 0x1a1a1c, metalness: 0.55, roughness: 0.35 }),
    rim: new THREE.MeshStandardMaterial({ color: 0xd8d4cc, metalness: 0.95, roughness: 0.16, envMapIntensity: 1.5 }),
    rimFace: new THREE.MeshStandardMaterial({ color: 0xe8e4dc, metalness: 1, roughness: 0.14, envMapIntensity: 1.6 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.92, metalness: 0 }),
    sidewall: new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.85, metalness: 0.05 }),
    lettering: new THREE.MeshStandardMaterial({ color: 0xc8c4b8, roughness: 0.55, metalness: 0.15 }),
    disc: new THREE.MeshStandardMaterial({ color: 0x77787c, metalness: 0.95, roughness: 0.32 }),
    caliper: new THREE.MeshStandardMaterial({ color: 0xb01010, metalness: 0.35, roughness: 0.38 }),
    caliperAccent: new THREE.MeshStandardMaterial({ color: 0xe8e8ea, metalness: 0.8, roughness: 0.25 }),
    head: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdcecff, emissiveIntensity: 0.35 }),
    headLens: new THREE.MeshPhysicalMaterial({ color: 0x0e1218, metalness: 0.7, roughness: 0.06, transparent: true, opacity: 0.5, clearcoat: 1, envMapIntensity: 1.4 }),
    drl: new THREE.MeshStandardMaterial({ color: 0xeef6ff, emissive: 0xb8d4ff, emissiveIntensity: 1.1 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1830, emissiveIntensity: 2.0 }),
    tailSeg: new THREE.MeshStandardMaterial({ color: 0x280000, emissive: 0xff2040, emissiveIntensity: 1.4 }),
    reverse: new THREE.MeshStandardMaterial({ color: 0x777777, emissive: 0xffffff, emissiveIntensity: 0 }),
    interior: new THREE.MeshStandardMaterial({ color: 0x161618, roughness: 0.78 }),
    seat: new THREE.MeshStandardMaterial({ color: 0xf0ebe3, roughness: 0.55, metalness: 0.05 }),
    screen: new THREE.MeshStandardMaterial({ color: 0x0a1018, emissive: 0x224466, emissiveIntensity: 0.55 }),
    thruster: new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.88, roughness: 0.32 }),
    thrusterInner: new THREE.MeshStandardMaterial({ color: 0x111214, metalness: 0.9, roughness: 0.4 }),
    thrusterGlow: new THREE.MeshStandardMaterial({ color: 0x88ccff, emissive: 0x44aaff, emissiveIntensity: 0 }),
    fan: new THREE.MeshStandardMaterial({ color: 0x1a1c20, metalness: 0.7, roughness: 0.4 }),
    badge: new THREE.MeshStandardMaterial({ color: 0xb8b4ac, metalness: 1, roughness: 0.18 }),
  };
}

export function createCarBody(mat) {
  const g = new THREE.Group();
  const M = 52, zs = [];
  const NS = 96;
  for (let i = 0; i <= NS; i++) zs.push(ZR + (ZF - ZR) * (0.5 - 0.5 * Math.cos(Math.PI * i / NS)));

  const bodyGeo = loft({
    zs, M,
    section: (z) => { const ring = []; for (let j = 0; j < M; j++) ring.push(bodyPoint(z, (j / M) * Math.PI * 2)); return ring; },
  });
  const body = new THREE.Mesh(bodyGeo, mat.paint); body.castShadow = true; body.receiveShadow = true; g.add(body);

  const tub = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.32, 3.2), mat.black);
  tub.position.set(0, 0.40, -0.08); g.add(tub);
  const linerMat = new THREE.MeshStandardMaterial({ color: 0x050505, side: THREE.DoubleSide, roughness: 1 });
  for (const zw of [WF, WR]) for (const s of [1, -1]) {
    const lg = new THREE.CylinderGeometry(0.42, 0.42, 0.22, 20, 1, true, 0, Math.PI); lg.rotateZ(Math.PI / 2);
    const liner = new THREE.Mesh(lg, linerMat);
    liner.position.set(s * 0.72, 0.40, zw);
    g.add(liner);
  }

  const gapZs = [
    [1.85, 0.42, 0.55],
    [1.55, 0.55, 0.72],
    [1.15, 0.52, 0.78],
    [0.55, 0.55, 0.78],
    [-0.55, 0.48, 0.72],
    [-1.35, 0.45, 0.68],
  ];
  for (const [gz, gy, gw] of gapZs) {
    for (const s of [1, -1]) {
      addBox(g, mat.gap, 0.004, 0.002, gw, s * 0.94, gy, gz);
    }
  }
  addBox(g, mat.titanium, 0.012, 0.003, 1.05, 0, 0.52, 1.45, -0.12, 0, 0);
  for (const s of [1, -1]) {
    addBox(g, mat.gloss, 0.04, 0.018, 0.12, s * 0.99, 0.62, -0.15);
    addBox(g, mat.gap, 0.01, 0.006, 0.08, s * 1.01, 0.62, -0.15);
  }

  const CZ0 = 0.55, CZ1 = -1.15, CN = 44, czs = [];
  for (let i = 0; i <= CN; i++) czs.push(CZ0 + (CZ1 - CZ0) * i / CN);
  const WC_K = [[CZ1, 0.48], [-0.7, 0.62], [-0.2, 0.68], [0.25, 0.72], [CZ0, 0.74]];
  const HC_K = [[CZ1, 0.88], [-0.75, 1.05], [-0.35, 1.12], [0.0, 1.13], [0.25, 1.02], [CZ0, 0.82]];
  const CM = 28;
  const canopyGeo = loft({
    zs: czs.slice().reverse(), M: CM,
    section: (z) => {
      const W = interp(WC_K, z), Ht = interp(HC_K, z), base = interp(H_KEYS, z) + 0.004;
      const ring = [];
      for (let j = 0; j < CM; j++) {
        const th = (j / (CM - 1)) * Math.PI;
        const xn = sgnPow(Math.cos(th), 0.5), yn = Math.pow(Math.sin(th), 0.5);
        ring.push([W * xn * (1 - 0.2 * yn), base + yn * (Ht - base)]);
      }
      return ring;
    },
  });
  const canopy = new THREE.Mesh(canopyGeo, mat.glass); canopy.castShadow = true; canopy.renderOrder = 2; g.add(canopy);
  for (const s of [1, -1]) {
    // Inset from canopy surface so tube radius never punches through glass
    const seal = new THREE.CatmullRomCurve3([[s * 0.70, 0.78, 0.52], [s * 0.62, 0.94, 0.26], [s * 0.52, 1.05, 0.0], [s * 0.44, 1.05, -0.4], [s * 0.38, 0.96, -0.82], [s * 0.32, 0.84, -1.08]].map((p) => new THREE.Vector3(...p)));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(seal, 28, 0.01, 5), mat.gloss));
    const pillar = new THREE.CatmullRomCurve3([[s * 0.68, 0.80, 0.52], [s * 0.60, 0.96, 0.26], [s * 0.50, 1.06, 0.0], [s * 0.42, 1.06, -0.4], [s * 0.36, 0.97, -0.82], [s * 0.30, 0.85, -1.08]].map((p) => new THREE.Vector3(...p)));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(pillar, 28, 0.012, 5), mat.titanium));
  }
  // Roof spine stays under canopy crown (max Ht ≈ 1.13)
  addBox(g, mat.titanium, 0.035, 0.008, 0.50, 0, 1.095, -0.25);

  // ---- Cabin interior: fully inside canopy/body envelope (no penetration) ----
  // Canopy half-W ≈ 0.48–0.72, crown ≈ 0.88–1.13; deck ≈ 0.82–0.90
  const interior = new THREE.Group(); g.add(interior);
  // Floor carpet (above tub, below seat cushions)
  addBox(interior, mat.interior, 1.00, 0.02, 1.55, 0, 0.50, -0.15);
  // Center tunnel / console
  addBox(interior, mat.gloss, 0.16, 0.10, 1.15, 0, 0.58, -0.05);
  addBox(interior, mat.carbon, 0.14, 0.04, 0.55, 0, 0.64, 0.15);
  addBox(interior, mat.screen, 0.10, 0.06, 0.012, 0, 0.70, 0.38); // console screen face
  addBox(interior, mat.chrome, 0.04, 0.01, 0.08, 0, 0.66, -0.35); // drive selector
  for (const s of [1, -1]) {
    // Compact seats fully inside canopy (W≥0.62, Ht≥1.05 over seating zone)
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.07, 0.38), mat.seat);
    cushion.position.set(s * 0.25, 0.54, -0.08); interior.add(cushion);
    addBox(interior, mat.seat, 0.035, 0.12, 0.32, s * 0.39, 0.60, -0.10);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.28, 0.07), mat.seat);
    back.position.set(s * 0.25, 0.72, -0.30); back.rotation.x = -0.18; interior.add(back);
    // Headrest clear of glass (top ≤ 0.88 ≪ Ht≈1.10)
    addBox(interior, mat.seat, 0.18, 0.06, 0.045, s * 0.25, 0.88, -0.34, -0.1, 0, 0);
    addBox(interior, mat.interior, 0.022, 0.18, 0.85, s * 0.44, 0.64, 0.02);
  }
  // Dash (under windshield base; half-W 0.46 < canopy ~0.72)
  addBox(interior, mat.interior, 0.92, 0.07, 0.20, 0, 0.70, 0.36);
  addBox(interior, mat.gloss, 0.88, 0.015, 0.04, 0, 0.74, 0.28);
  // Main landscape screen + driver cluster (low profile)
  const mainScreen = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.14, 0.012), mat.screen);
  mainScreen.position.set(0, 0.78, 0.28); mainScreen.rotation.x = -0.32; interior.add(mainScreen);
  const cluster = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.01), mat.screen);
  cluster.position.set(0.28, 0.76, 0.30); cluster.rotation.x = -0.28; interior.add(cluster);
  // Vent slots
  for (const x of [-0.28, -0.12, 0.12, 0.28]) {
    addBox(interior, mat.black, 0.06, 0.02, 0.03, x, 0.735, 0.40);
  }
  // Yoke + column only hidden in cockpit cam (blocks driver FOV); rest stays for orbit
  const cockpitHide = new THREE.Group(); interior.add(cockpitHide);
  const yokeG = new THREE.Group(); yokeG.position.set(0.26, 0.72, 0.18); yokeG.rotation.x = -0.48; cockpitHide.add(yokeG);
  const yokeRing = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.011, 6, 20, Math.PI * 1.12), mat.titanium);
  yokeRing.rotation.z = Math.PI; yokeG.add(yokeRing);
  addBox(yokeG, mat.gloss, 0.11, 0.028, 0.022, 0, -0.015, 0);
  addBox(yokeG, mat.chrome, 0.03, 0.03, 0.04, 0, 0.012, 0.015);
  addBox(cockpitHide, mat.black, 0.03, 0.03, 0.14, 0.26, 0.66, 0.26, -0.4, 0, 0);

  const sph = new THREE.SphereGeometry(1, 20, 12);
  // 2026 Roadster nose: recessed slit headlights, hood panel breaks, fascia + multi-level splitter
  for (const sd of [1, -1]) {
    // Outer aperture pocket (gloss recess into body)
    const pocket = new THREE.Mesh(sph, mat.gloss); pocket.matrixAutoUpdate = false;
    pocket.matrix.copy(surfaceMatrix(2.02, sd > 0 ? 0.42 : Math.PI - 0.42, sd * 0.15, [0.26, 0.01, 0.045], 0.004)); g.add(pocket);
    const aperture = new THREE.Mesh(sph, mat.black); aperture.matrixAutoUpdate = false;
    aperture.matrix.copy(surfaceMatrix(2.04, sd > 0 ? 0.42 : Math.PI - 0.42, sd * 0.12, [0.22, 0.007, 0.032], 0.005)); g.add(aperture);
    // Thin horizontal LED bar + projector
    const lens = new THREE.Mesh(sph, mat.headLens); lens.matrixAutoUpdate = false;
    lens.matrix.copy(surfaceMatrix(2.05, sd > 0 ? 0.40 : Math.PI - 0.40, sd * 0.1, [0.22, 0.006, 0.022], 0.006)); g.add(lens);
    const lamp = new THREE.Mesh(sph, mat.head); lamp.matrixAutoUpdate = false;
    lamp.matrix.copy(surfaceMatrix(2.055, sd > 0 ? 0.40 : Math.PI - 0.40, sd * 0.08, [0.14, 0.004, 0.012], 0.007)); g.add(lamp);
    // Upper DRL stripe along fender crease
    const drl = new THREE.Mesh(sph, mat.drl); drl.matrixAutoUpdate = false;
    drl.matrix.copy(surfaceMatrix(1.92, sd > 0 ? 0.58 : Math.PI - 0.58, sd * 0.2, [0.22, 0.005, 0.004], 0.005)); g.add(drl);
    const led = new THREE.Mesh(sph, mat.drl); led.matrixAutoUpdate = false;
    led.matrix.copy(surfaceMatrix(2.08, sd > 0 ? 0.36 : Math.PI - 0.36, sd * 0.18, [0.08, 0.004, 0.01], 0.006)); g.add(led);
    // Corner marker / turn signal slit
    const turn = new THREE.Mesh(sph, mat.drl); turn.matrixAutoUpdate = false;
    turn.matrix.copy(surfaceMatrix(2.12, sd > 0 ? 0.22 : Math.PI - 0.22, sd * 0.35, [0.07, 0.004, 0.008], 0.004)); g.add(turn);
  }
  // Hood panel seams (center spine + side breaks)
  addBox(g, mat.gap, 0.004, 0.002, 0.95, 0, 0.50, 1.55);
  for (const s of [1, -1]) {
    addBox(g, mat.gap, 0.004, 0.002, 0.85, s * 0.38, 0.48, 1.58, 0, 0, s * 0.08);
    addBox(g, mat.gap, 0.55, 0.002, 0.004, s * 0.55, 0.46, 1.95, 0, s * 0.25, 0);
  }
  // Front fascia / chin
  const fascia = new THREE.Mesh(sph, mat.gloss); fascia.scale.set(0.50, 0.04, 0.08); fascia.position.set(0, 0.248, 2.15); fascia.renderOrder = 1; g.add(fascia);
  const fasciaLip = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.014, 0.05), mat.titanium); fasciaLip.position.set(0, 0.238, 2.16); g.add(fasciaLip);
  // Multi-level carbon splitter + canards
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.40, 0.014, 0.26), mat.carbon); splitter.position.set(0, 0.175, 2.00); g.add(splitter);
  addBox(g, mat.titanium, 1.28, 0.005, 0.03, 0, 0.185, 2.10);
  addBox(g, mat.carbon, 1.32, 0.01, 0.06, 0, 0.168, 2.12);
  for (const s of [1, -1]) {
    addBox(g, mat.carbon, 0.14, 0.012, 0.18, s * 0.68, 0.188, 1.95, 0, s * 0.3, s * 0.12);
    addBox(g, mat.black, 0.20, 0.04, 0.10, s * 0.42, 0.255, 2.08);
    // Vertical aero fence at splitter tip
    addBox(g, mat.titanium, 0.01, 0.04, 0.12, s * 0.70, 0.20, 2.02);
  }
  // Center intake with mesh bars
  const intake = new THREE.Mesh(sph, mat.black);
  intake.scale.set(0.32, 0.035, 0.06); intake.position.set(0, 0.275, 2.16); g.add(intake);
  for (let i = -3; i <= 3; i++) {
    addBox(g, mat.titanium, 0.006, 0.028, 0.045, i * 0.042, 0.275, 2.18);
  }
  // Nose tip badge (Tesla T) on angled mount
  const badgeG = new THREE.Group(); badgeG.position.set(0, 0.355, 2.20); badgeG.rotation.x = -0.9; g.add(badgeG);
  const embRing = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.006, 8, 24), mat.badge); badgeG.add(embRing);
  const emb = new THREE.Mesh(new THREE.CircleGeometry(0.038, 20), mat.chrome); badgeG.add(emb);
  addBox(badgeG, mat.gloss, 0.01, 0.048, 0.005, 0, 0.004, 0.008);
  addBox(badgeG, mat.gloss, 0.036, 0.009, 0.005, 0, 0.024, 0.008);
  // Soft under-nose DRL strip
  const noseDrl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.006, 0.01), mat.drl);
  noseDrl.position.set(0, 0.215, 2.18); g.add(noseDrl);

  const tailBlack = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.09, 0.012), mat.gloss); tailBlack.position.set(0, 0.58, ZR - 0.002); g.add(tailBlack);
  const tailBar = new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.026, 0.014), mat.tail);
  tailBar.position.set(0, 0.58, ZR - 0.01); g.add(tailBar);
  for (let i = -6; i <= 6; i++) {
    if (i === 0) continue;
    const seg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.018, 0.01), mat.tailSeg);
    seg.position.set(i * 0.11, 0.58, ZR - 0.016); g.add(seg);
  }
  for (const s of [1, -1]) {
    const c = new THREE.Mesh(sph, mat.tail); c.matrixAutoUpdate = false;
    c.matrix.copy(surfaceMatrix(-2.05, s > 0 ? 0.4 : Math.PI - 0.4, 0, [0.14, 0.01, 0.018], 0.003)); g.add(c);
    const rev = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.028, 0.01), mat.reverse);
    rev.position.set(s * 0.48, 0.48, ZR - 0.008); g.add(rev);
  }

  const diff = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.10, 0.32), mat.carbon); diff.position.set(0, 0.22, -2.05); diff.rotation.x = 0.28; g.add(diff);
  for (let i = -3; i <= 3; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.09, 0.28), mat.titanium);
    fin.position.set(i * 0.16, 0.20, -2.06); fin.rotation.x = 0.28; g.add(fin);
  }

  // Wing sits ABOVE rear deck (H≈0.84 @ z=-1.85); struts bridge down without burying plate
  const wingGroup = new THREE.Group();
  wingGroup.position.set(0, 0.96, -1.92);
  const wingPlate = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.02, 0.26), mat.paint);
  wingPlate.castShadow = true; wingGroup.add(wingPlate);
  const wingEdge = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.03, 0.03), mat.titanium); wingEdge.position.set(0, 0.01, -0.13); wingGroup.add(wingEdge);
  addBox(wingGroup, mat.carbon, 1.24, 0.01, 0.018, 0, 0.016, -0.12);
  for (const s of [1, -1]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.05), mat.titanium);
    strut.position.set(s * 0.42, -0.10, 0.04); wingGroup.add(strut);
    const endplate = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.10, 0.28), mat.carbon);
    endplate.position.set(s * 0.64, 0.01, 0); wingGroup.add(endplate);
  }
  g.add(wingGroup);

  const fanGroup = new THREE.Group();
  fanGroup.position.set(0, 0.12, -0.15);
  const fanHousing = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.42, 0.08, 20), mat.fan);
  fanHousing.rotation.x = Math.PI / 2; fanGroup.add(fanHousing);
  const grill = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.018, 6, 24), mat.titanium);
  grill.rotation.x = Math.PI / 2; fanGroup.add(grill);
  const fanBlades = new THREE.Group();
  for (let k = 0; k < 7; k++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.30, 0.01), mat.titanium);
    blade.position.y = 0.11; blade.rotation.z = (k / 7) * Math.PI * 2;
    fanBlades.add(blade);
  }
  fanBlades.rotation.x = Math.PI / 2; fanGroup.add(fanBlades);
  g.add(fanGroup);

  const rearThruster = new THREE.Group();
  rearThruster.position.set(0, 0.38, ZR - 0.02);
  const rtNozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.16, 14), mat.thruster);
  rtNozzle.rotation.x = Math.PI / 2; rearThruster.add(rtNozzle);
  const rtInner = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 0.08, 12), mat.thrusterInner);
  rtInner.rotation.x = Math.PI / 2; rtInner.position.z = -0.04; rearThruster.add(rtInner);
  const rtGlow = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), mat.thrusterGlow);
  rtGlow.position.z = -0.1; rearThruster.add(rtGlow);
  g.add(rearThruster);

  const perimeter = [];
  const periPos = [
    [0.7, 0.22, 1.6], [-0.7, 0.22, 1.6],
    [0.85, 0.22, 0.2], [-0.85, 0.22, 0.2],
    [0.7, 0.22, -1.5], [-0.7, 0.22, -1.5],
    [0.0, 0.18, 1.9],
    [0.55, 0.55, -0.3], [-0.55, 0.55, -0.3],
  ];
  for (const [x, y, z] of periPos) {
    const pg = new THREE.Group(); pg.position.set(x, y, z);
    const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.08, 8), mat.thruster);
    noz.rotation.x = Math.PI / 2; pg.add(noz);
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.028, 0.04, 6), mat.thrusterInner);
    inner.rotation.x = Math.PI / 2; inner.position.z = -0.02; pg.add(inner);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), mat.thrusterGlow.clone());
    glow.position.z = -0.05;
    if (Math.abs(x) > 0.4) { noz.rotation.z = x > 0 ? -0.4 : 0.4; inner.rotation.z = noz.rotation.z; }
    pg.add(glow);
    g.add(pg);
    perimeter.push({ group: pg, glow });
  }

  for (const s of [1, -1]) {
    const sk = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.04, 1.55), mat.titanium); sk.position.set(s * 0.96, 0.235, 0.05); g.add(sk);
    const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.016, 0.03), mat.titanium); stalk.position.set(s * 0.88, 0.86, 0.40); g.add(stalk);
    const mirBody = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.10), mat.paint); mirBody.position.set(s * 0.96, 0.88, 0.38); mirBody.castShadow = true; g.add(mirBody);
    const mirGlass = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.035, 0.008), mat.mirrorGlass); mirGlass.position.set(s * 1.005, 0.88, 0.38); g.add(mirGlass);
    addBox(g, mat.gloss, 0.03, 0.022, 0.04, s * 1.00, 0.85, 0.45);
  }

  addBox(g, mat.badge, 0.28, 0.035, 0.008, 0, 0.42, ZR - 0.005);
  addBox(g, mat.black, 0.32, 0.12, 0.02, 0, 0.36, ZR - 0.01);

  const plumeGroup = new THREE.Group(); g.add(plumeGroup);

  g.traverse((o) => { if (o.isMesh && o !== canopy) o.castShadow = true; });
  return {
    group: g, tailMat: mat.tail, reverseMat: mat.reverse, headMat: mat.head,
    wingGroup, fanBlades, rearThruster, rearGlow: rtGlow, perimeter, plumeGroup,
    thrusterGlowMat: mat.thrusterGlow, cockpitHide,
  };
}

export function createWheel(mat, left, rear) {
  const outer = new THREE.Group();
  const spin = new THREE.Group(); outer.add(spin);
  const width = rear ? 0.3 : 0.27, R = WC, rimR = 0.268;
  const prof = [];
  const hw = width / 2, rr = 0.04;
  prof.push(new THREE.Vector2(rimR - 0.01, -hw + 0.01));
  for (let i = 0; i <= 6; i++) { const a = -Math.PI / 2 + (i / 6) * (Math.PI / 2); prof.push(new THREE.Vector2(R - rr + Math.cos(a) * rr, -hw + rr + Math.sin(a) * rr)); }
  for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI / 2; prof.push(new THREE.Vector2(R - rr + Math.cos(a) * rr, hw - rr + Math.sin(a) * rr)); }
  prof.push(new THREE.Vector2(rimR - 0.01, hw - 0.01));
  const tireGeo = new THREE.LatheGeometry(prof, 36); tireGeo.rotateZ(Math.PI / 2);
  const tire = new THREE.Mesh(tireGeo, mat.tire); tire.castShadow = true; spin.add(tire);
  for (const o of [-0.07, -0.025, 0.025, 0.07]) {
    const groove = new THREE.Mesh(new THREE.TorusGeometry(R + 0.001, 0.005, 4, 32), mat.black);
    groove.rotation.y = Math.PI / 2; groove.position.x = o; spin.add(groove);
  }
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.TorusGeometry(R - 0.045, 0.012, 5, 28), mat.sidewall);
    wall.rotation.y = Math.PI / 2; wall.position.x = side * (hw - 0.02); spin.add(wall);
    const letters = new THREE.Mesh(new THREE.TorusGeometry(R - 0.07, 0.006, 4, 24), mat.lettering);
    letters.rotation.y = Math.PI / 2; letters.position.x = side * (hw - 0.015); spin.add(letters);
  }
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(rimR, rimR, width - 0.03, 28, 1, true), mat.rim);
  barrel.rotation.z = Math.PI / 2; barrel.material = mat.rim.clone(); barrel.material.side = THREE.DoubleSide; spin.add(barrel);
  const face = new THREE.Group(); spin.add(face);
  const fx = hw - 0.035;
  const lip = new THREE.Mesh(new THREE.TorusGeometry(rimR - 0.005, 0.01, 5, 32), mat.rimFace); lip.rotation.y = Math.PI / 2; lip.position.x = fx; face.add(lip);
  const SPOKES = 12;
  for (let k = 0; k < SPOKES; k++) {
    const a = (k / SPOKES) * Math.PI * 2;
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.215, 0.016), mat.rimFace);
    sp.position.set(fx - 0.01, Math.cos(a) * 0.125, Math.sin(a) * 0.125); sp.rotation.x = -a; face.add(sp);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.045, 16), mat.rimFace); hub.rotation.z = Math.PI / 2; hub.position.x = fx - 0.01; face.add(hub);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.05, 14), mat.titanium); cap.rotation.z = Math.PI / 2; cap.position.x = fx; face.add(cap);
  const hubBadge = new THREE.Mesh(new THREE.CircleGeometry(0.018, 12), mat.badge);
  hubBadge.rotation.y = Math.PI / 2; hubBadge.position.x = fx + 0.01; face.add(hubBadge);

  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.028, 28), mat.disc); disc.rotation.z = Math.PI / 2; disc.position.x = -0.02; spin.add(disc);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.032, 6), mat.black);
    hole.rotation.z = Math.PI / 2;
    hole.position.set(-0.02, Math.cos(a) * 0.14, Math.sin(a) * 0.14);
    spin.add(hole);
  }

  const calG = new THREE.Group();
  const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.14, 0.095), mat.caliper);
  calG.add(caliper);
  addBox(calG, mat.caliperAccent, 0.04, 0.025, 0.08, 0.02, 0, 0);
  addBox(calG, mat.caliper, 0.03, 0.05, 0.06, -0.02, 0.04, 0);
  addBox(calG, mat.caliper, 0.03, 0.05, 0.06, -0.02, -0.04, 0);
  calG.position.set(-0.01, 0.12, rear ? 0.12 : -0.12);
  calG.rotation.x = rear ? 0.7 : -0.7;
  outer.add(calG);

  if (!left) { spin.scale.x = -1; calG.position.x *= -1; }
  return { outer, spin };
}
