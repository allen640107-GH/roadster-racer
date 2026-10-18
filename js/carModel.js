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
const W_KEYS = [[ZR, 0.78], [-2.05, 0.92], [-1.7, 1.02], [-1.1, 1.05], [-0.4, 1.0], [0.3, 0.98], [0.9, 1.02], [1.4, 1.0], [1.85, 0.88], [2.1, 0.68], [2.2, 0.42], [ZF, 0.18]];
const H_KEYS = [[ZR, 0.62], [-2.05, 0.78], [-1.7, 0.88], [-1.2, 0.92], [-0.6, 0.90], [0.2, 0.86], [0.8, 0.78], [1.35, 0.66], [1.8, 0.52], [2.05, 0.42], [2.18, 0.34], [ZF, 0.28]];
const B_KEYS = [[ZR, 0.38], [-2.0, 0.26], [-1.6, 0.18], [1.6, 0.16], [2.0, 0.22], [ZF, 0.30]];

function archBottom(z, base, topC) {
  let b = base;
  for (const zw of [WF, WR]) {
    const R = 0.455, d = z - zw;
    if (Math.abs(d) < R) b = Math.max(b, 0.36 + Math.sqrt(R * R - d * d) * 0.97);
  }
  return Math.min(b, topC - 0.06);
}
function fender(z) {
  return 0.055 * Math.exp(-(((z - WF) / 0.48) ** 2)) + 0.05 * Math.exp(-(((z - WR) / 0.55) ** 2));
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
      color: 0x3a2e10, metalness: 0.55, roughness: 0.045, clearcoat: 1, clearcoatRoughness: 0.015,
      transparent: true, opacity: 0.72, envMapIntensity: 2.1,
      attenuationColor: 0xc9a227, attenuationDistance: 0.45,
      transmission: 0.12, ior: 1.45,
    }),
    mirrorGlass: new THREE.MeshPhysicalMaterial({
      color: 0x8899aa, metalness: 1, roughness: 0.05, envMapIntensity: 2.2,
    }),
    black: new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.5, metalness: 0.2 }),
    gloss: new THREE.MeshPhysicalMaterial({ color: 0x060606, roughness: 0.12, metalness: 0.45, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.2 }),
    gap: new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.95, metalness: 0 }),
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
    seat: new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.58 }),
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

  const tub = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.36, 3.6), mat.black);
  tub.position.set(0, 0.42, -0.05); g.add(tub);
  const linerMat = new THREE.MeshStandardMaterial({ color: 0x050505, side: THREE.DoubleSide, roughness: 1 });
  for (const zw of [WF, WR]) for (const s of [1, -1]) {
    const lg = new THREE.CylinderGeometry(0.41, 0.41, 0.26, 20, 1, true, 0, Math.PI); lg.rotateZ(Math.PI / 2);
    const liner = new THREE.Mesh(lg, linerMat);
    liner.position.set(s * 0.82, 0.36, zw);
    g.add(liner);
  }

  const gapZs = [
    [1.55, 0.55, 0.72],
    [0.55, 0.55, 0.78],
    [-0.55, 0.48, 0.72],
    [-1.35, 0.45, 0.68],
  ];
  for (const [gz, gy, gw] of gapZs) {
    for (const s of [1, -1]) {
      addBox(g, mat.gap, 0.005, 0.002, gw, s * 0.97, gy, gz);
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
      const W = interp(WC_K, z), Ht = interp(HC_K, z), base = interp(H_KEYS, z) - 0.02;
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
    const seal = new THREE.CatmullRomCurve3([[s * 0.76, 0.80, 0.55], [s * 0.68, 0.96, 0.28], [s * 0.58, 1.08, 0.0], [s * 0.50, 1.08, -0.4], [s * 0.42, 0.98, -0.85], [s * 0.36, 0.86, -1.12]].map((p) => new THREE.Vector3(...p)));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(seal, 28, 0.012, 5), mat.gloss));
    const pillar = new THREE.CatmullRomCurve3([[s * 0.74, 0.82, 0.55], [s * 0.66, 0.98, 0.28], [s * 0.56, 1.1, 0.0], [s * 0.48, 1.1, -0.4], [s * 0.4, 1.0, -0.85], [s * 0.34, 0.88, -1.12]].map((p) => new THREE.Vector3(...p)));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(pillar, 28, 0.016, 5), mat.titanium));
  }
  addBox(g, mat.titanium, 0.04, 0.01, 0.55, 0, 1.115, -0.25);

  for (const s of [1, -1]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.48, 0.12), mat.seat);
    seat.position.set(s * 0.33, 0.86, -0.55); seat.rotation.x = -0.28; g.add(seat);
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.1, 0.48), mat.seat);
    cushion.position.set(s * 0.33, 0.58, -0.28); g.add(cushion);
    addBox(g, mat.seat, 0.06, 0.18, 0.4, s * 0.52, 0.68, -0.32);
  }
  const dash = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.12, 0.32), mat.interior); dash.position.set(0, 0.86, 0.32); g.add(dash);
  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.22, 0.02), mat.screen);
  screen.position.set(0, 0.92, 0.18); screen.rotation.x = -0.35; g.add(screen);
  const yokeG = new THREE.Group(); yokeG.position.set(0.30, 0.88, 0.08); yokeG.rotation.x = -0.5; g.add(yokeG);
  const yokeRing = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.016, 8, 24, Math.PI * 1.15), mat.titanium);
  yokeRing.rotation.z = Math.PI; yokeG.add(yokeRing);
  addBox(yokeG, mat.gloss, 0.16, 0.04, 0.03, 0, -0.02, 0);
  addBox(yokeG, mat.chrome, 0.04, 0.04, 0.05, 0, 0.02, 0.02);
  addBox(g, mat.black, 0.05, 0.05, 0.18, 0.30, 0.82, 0.18, -0.4, 0, 0);

  const sph = new THREE.SphereGeometry(1, 20, 12);
  for (const sd of [1, -1]) {
    const th = sd > 0 ? 0.38 : Math.PI - 0.38;
    const housing = new THREE.Mesh(sph, mat.gloss); housing.matrixAutoUpdate = false;
    housing.matrix.copy(surfaceMatrix(1.95, th, sd * 0.3, [0.28, 0.01, 0.055], 0.0)); g.add(housing);
    const lens = new THREE.Mesh(sph, mat.headLens); lens.matrixAutoUpdate = false;
    lens.matrix.copy(surfaceMatrix(1.96, th, sd * 0.3, [0.24, 0.012, 0.04], 0.002)); g.add(lens);
    const lamp = new THREE.Mesh(sph, mat.head); lamp.matrixAutoUpdate = false;
    lamp.matrix.copy(surfaceMatrix(1.965, th, sd * 0.3, [0.18, 0.008, 0.025], 0.003)); g.add(lamp);
    const drl = new THREE.Mesh(sph, mat.drl); drl.matrixAutoUpdate = false;
    drl.matrix.copy(surfaceMatrix(1.88, sd > 0 ? 0.55 : Math.PI - 0.55, sd * 0.15, [0.18, 0.006, 0.005], 0.004)); g.add(drl);
    const led = new THREE.Mesh(sph, mat.drl); led.matrixAutoUpdate = false;
    led.matrix.copy(surfaceMatrix(1.97, th, sd * 0.25, [0.06, 0.005, 0.012], 0.005)); g.add(led);
  }

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

  const intake = new THREE.Mesh(sph, mat.black);
  intake.scale.set(0.5, 0.055, 0.09); intake.position.set(0, 0.32, 2.15); g.add(intake);
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.022, 0.28), mat.carbon); splitter.position.set(0, 0.20, 2.0); g.add(splitter);
  addBox(g, mat.titanium, 1.4, 0.008, 0.04, 0, 0.215, 2.12);
  for (const s of [1, -1]) {
    addBox(g, mat.black, 0.22, 0.06, 0.12, s * 0.55, 0.28, 2.05);
  }

  const diff = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.14, 0.38), mat.carbon); diff.position.set(0, 0.30, -2.0); diff.rotation.x = 0.32; g.add(diff);
  for (let i = -3; i <= 3; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.12, 0.34), mat.titanium);
    fin.position.set(i * 0.18, 0.28, -2.02); fin.rotation.x = 0.32; g.add(fin);
  }

  const wingGroup = new THREE.Group();
  wingGroup.position.set(0, 0.72, -1.85);
  const wingPlate = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.022, 0.28), mat.paint);
  wingPlate.castShadow = true; wingGroup.add(wingPlate);
  const wingEdge = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.035, 0.035), mat.titanium); wingEdge.position.set(0, 0.012, -0.14); wingGroup.add(wingEdge);
  addBox(wingGroup, mat.carbon, 1.32, 0.012, 0.02, 0, 0.02, -0.13);
  for (const s of [1, -1]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.18, 0.055), mat.titanium);
    strut.position.set(s * 0.45, -0.1, 0.05); wingGroup.add(strut);
    const endplate = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 0.3), mat.carbon);
    endplate.position.set(s * 0.68, 0.02, 0); wingGroup.add(endplate);
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
    const sk = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 1.8), mat.titanium); sk.position.set(s * 0.95, 0.22, 0.05); g.add(sk);
    const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.018, 0.035), mat.titanium); stalk.position.set(s * 0.90, 0.90, 0.42); g.add(stalk);
    const mirBody = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.055, 0.12), mat.paint); mirBody.position.set(s * 0.98, 0.92, 0.40); mirBody.castShadow = true; g.add(mirBody);
    const mirGlass = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.04, 0.01), mat.mirrorGlass); mirGlass.position.set(s * 1.025, 0.92, 0.40); g.add(mirGlass);
    addBox(g, mat.gloss, 0.035, 0.025, 0.05, s * 1.02, 0.88, 0.48);
  }

  const badgeG = new THREE.Group(); badgeG.position.set(0, 0.48, 2.18); badgeG.rotation.x = -0.85; g.add(badgeG);
  const emb = new THREE.Mesh(new THREE.CircleGeometry(0.045, 20), mat.badge); badgeG.add(emb);
  addBox(badgeG, mat.gloss, 0.012, 0.055, 0.006, 0, 0.005, 0.01);
  addBox(badgeG, mat.gloss, 0.04, 0.01, 0.006, 0, 0.028, 0.01);
  addBox(g, mat.badge, 0.28, 0.035, 0.008, 0, 0.42, ZR - 0.005);
  addBox(g, mat.black, 0.32, 0.12, 0.02, 0, 0.36, ZR - 0.01);

  const plumeGroup = new THREE.Group(); g.add(plumeGroup);

  g.traverse((o) => { if (o.isMesh && o !== canopy) o.castShadow = true; });
  return {
    group: g, tailMat: mat.tail, reverseMat: mat.reverse, headMat: mat.head,
    wingGroup, fanBlades, rearThruster, rearGlow: rtGlow, perimeter, plumeGroup,
    thrusterGlowMat: mat.thrusterGlow,
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
