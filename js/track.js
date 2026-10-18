// Track definition & math (no DOM) — shared by game and node tests.
import * as THREE from '../vendor/three.module.js';

export const TRACK_HALF_WIDTH = 7.5;   // asphalt half width (m)
export const CURB_WIDTH = 1.3;
export const BARRIER_OFFSET = 12.0;    // centre-line -> barrier face (m)
const SCALE = 1.3;
// Closed-loop circuit control points (x, z). Index 0 sits in the middle of the main straight.
const RAW = [
  [-50, -158], [100, -160], [205, -138], [255, -70], [248, 0], [205, 38], [135, 30],
  [80, 70], [100, 150], [45, 222], [-70, 214], [-145, 150], [-120, 70], [-205, 30],
  [-262, -50], [-215, -140],
];

export function createTrack() {
  const pts = RAW.map(([x, z]) => new THREE.Vector3(x * SCALE, 0, z * SCALE));
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  const length = curve.getLength();
  const N = Math.round(length / 1.0);
  const spaced = curve.getSpacedPoints(N); // N+1, last == first
  const pos = spaced.slice(0, N);
  const tan = [], side = [];
  for (let i = 0; i < N; i++) {
    const a = pos[(i - 1 + N) % N], b = pos[(i + 1) % N];
    const t = new THREE.Vector3().subVectors(b, a).setY(0).normalize();
    tan.push(t);
    side.push(new THREE.Vector3(-t.z, 0, t.x)); // "right-hand" lateral (left of travel when looking along +t in three coords)
  }
  const seg = length / N;

  function nearest(p, hint = -1, range = 60) {
    let best = -1, bd = Infinity;
    if (hint < 0) {
      for (let i = 0; i < N; i++) {
        const dx = pos[i].x - p.x, dz = pos[i].z - p.z, d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = i; }
      }
    } else {
      for (let k = -range; k <= range; k++) {
        const i = (hint + k + N) % N;
        const dx = pos[i].x - p.x, dz = pos[i].z - p.z, d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = i; }
      }
    }
    return best;
  }
  // signed lateral offset of p from centre at sample i
  function lateral(p, i) {
    return (p.x - pos[i].x) * side[i].x + (p.z - pos[i].z) * side[i].z;
  }
  // brute distance to centre line (for scenery placement); coarse grid accelerated
  const cell = 20, grid = new Map();
  for (let i = 0; i < N; i++) {
    const key = Math.floor(pos[i].x / cell) + ',' + Math.floor(pos[i].z / cell);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  }
  function distToCenter(x, z, maxR = 60) {
    const r = Math.ceil(maxR / cell), cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    let bd = Infinity;
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
      const l = grid.get((cx + a) + ',' + (cz + b)); if (!l) continue;
      for (const i of l) { const dx = pos[i].x - x, dz = pos[i].z - z; const d = dx * dx + dz * dz; if (d < bd) bd = d; }
    }
    return Math.sqrt(bd);
  }
  return { curve, length, N, seg, pos, tan, side, nearest, lateral, distToCenter };
}
