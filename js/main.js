import * as THREE from '../vendor/three.module.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createTrack } from './track.js';
import { createWorld, Car, STEP, CAR, FLIGHT } from './vehicle.js';
import { createMaterials, createCarBody, createWheel } from './carModel.js';
import { createSky, createLights, createTerrain, createTrackMeshes, createProps, SUN_DIR } from './world.js';
import { Sfx } from './audio.js';

const params = new URLSearchParams(location.search);
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || params.has('touch');
const quality = params.get('q') || (isTouch ? 'low' : 'high');
const TOTAL_LAPS = 3;
const $ = (id) => document.getElementById(id);
if (isTouch) document.body.classList.add('touch');

// ---------- renderer / scene
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, quality === 'low' ? 1.25 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 6000);

createSky(scene, renderer);
const sun = createLights(scene, quality);
const terrain = createTerrain(scene);
const track = createTrack();
const trackMeshes = createTrackMeshes(scene, track, renderer);
createProps(scene, track);

// ---------- post-processing
const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: quality === 'low' ? 0 : 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.24, 0.4, 1.0);
composer.addPass(bloom);
composer.addPass(new OutputPass());
let usePost = params.get('post') !== '0';

// ---------- physics + car
const { world, chassisMat, updateBarriers } = createWorld(track);
const car = new Car(world, chassisMat);
const mats = createMaterials();
const carGroup = new THREE.Group(); scene.add(carGroup);
const REST_Y = 0.465; // chassis origin height at rest (measured)
const { group: body, tailMat, reverseMat, headMat, wingGroup, fanBlades, rearThruster, rearGlow, perimeter, plumeGroup, cockpitHide } = createCarBody(mats);
body.position.y = -REST_Y; carGroup.add(body);
const wheels = [0, 1, 2, 3].map((i) => { const w = createWheel(mats, i % 2 === 0, i >= 2); scene.add(w.outer); return w; });

// ---------- skid marks
const SKID_MAX = 3000;
const skidPos = new Float32Array(SKID_MAX * 6 * 3);
const skidGeo = new THREE.BufferGeometry(); skidGeo.setAttribute('position', new THREE.BufferAttribute(skidPos, 3).setUsage(THREE.DynamicDrawUsage));
skidGeo.setDrawRange(0, 0);
const skidMesh = new THREE.Mesh(skidGeo, new THREE.MeshBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
skidMesh.frustumCulled = false; scene.add(skidMesh);
let skidCount = 0, skidHead = 0; const lastSkid = [null, null, null, null];
function addSkid(i, p, side) {
  const last = lastSkid[i];
  if (last && last.distanceToSquared(p) < 0.09) return;
  if (last && last.distanceToSquared(p) < 36) {
    const w = 0.13, o = skidHead * 18;
    const ax = last.x + side.x * w, az = last.z + side.z * w, bx = last.x - side.x * w, bz = last.z - side.z * w;
    const cx = p.x + side.x * w, cz = p.z + side.z * w, dx = p.x - side.x * w, dz = p.z - side.z * w, y = 0.045;
    skidPos.set([ax, y, az, cx, y, cz, bx, y, bz, bx, y, bz, cx, y, cz, dx, y, dz], o);
    skidHead = (skidHead + 1) % SKID_MAX; skidCount = Math.min(skidCount + 1, SKID_MAX);
    skidGeo.setDrawRange(0, skidCount * 6); skidGeo.attributes.position.needsUpdate = true;
  }
  lastSkid[i] = (last || new THREE.Vector3()).copy(p);
}
// tyre smoke
const smokeTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
const smoke = []; for (let i = 0; i < 40; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0xdddddd, transparent: true, opacity: 0, depthWrite: false })); s.visible = false; scene.add(s); smoke.push({ s, life: 0, vel: new THREE.Vector3() }); }
let smokeIdx = 0;
function spawnSmoke(p, strength) {
  const o = smoke[smokeIdx]; smokeIdx = (smokeIdx + 1) % smoke.length;
  o.s.position.copy(p).setY(0.35); o.life = 1; o.s.visible = true; o.strength = strength;
  o.vel.set((Math.random() - 0.5) * 1.2, 0.8 + Math.random() * 0.6, (Math.random() - 0.5) * 1.2);
}

// ---------- input
const keys = {};
const touch = { left: false, right: false, throttle: false, brake: false, handbrake: false, flight: false };
addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys[e.code] = true;
  if (e.code === 'KeyR') resetCar();
  if (e.code === 'KeyC') cycleCamera();
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'KeyH') $('help').classList.toggle('hidden');
  if (e.code === 'KeyP') { usePost = !usePost; toast(usePost ? '後製特效：開' : '後製特效：關'); }
  if (e.code === 'KeyF') toast('飛行模式');
  sfx.resume();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
document.querySelectorAll('#touch .tb').forEach((b) => {
  const k = b.dataset.k;
  const on = (e) => {
    e.preventDefault(); e.stopPropagation();
    try { b.setPointerCapture(e.pointerId); } catch (_) {}
    b.classList.add('on'); sfx.resume();
    if (k in touch) touch[k] = true;
    else if (k === 'reset') resetCar();
    else if (k === 'camera') cycleCamera();
    else if (k === 'mute') toggleMute();
  };
  const off = (e) => {
    e.preventDefault();
    b.classList.remove('on');
    if (k in touch) touch[k] = false;
  };
  b.addEventListener('pointerdown', on, { passive: false });
  b.addEventListener('pointerup', off, { passive: false });
  b.addEventListener('pointercancel', off, { passive: false });
  b.addEventListener('lostpointercapture', off);
  b.addEventListener('contextmenu', (e) => e.preventDefault());
});
// Prevent browser gestures stealing multitouch from controls
document.getElementById('touch').addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

// ---------- gyroscope / DeviceOrientation tilt steering
const TILT_DEADZONE = 5;   // degrees — ignore slight tilts (responsive)
const TILT_MAX = 28;       // degrees → full steer
const TILT_MAX_STEER = 1.0; // full digital steer available
const tilt = {
  want: false,       // user toggle preference
  allowed: false,    // sensor permission / available
  denied: false,
  listening: false,
  rawDeg: 0,
  smoothed: 0,
};
const tiltToggle = $('tiltToggle');
const tiltTip = $('tiltTip');
function screenAngle() {
  if (typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
  if (typeof window.orientation === 'number') return window.orientation;
  return 0;
}
function orientationToTiltDeg(e) {
  // Map left/right lean to a signed degree value (positive = steer right)
  const ang = screenAngle();
  let deg;
  if (ang === 90) deg = e.beta;
  else if (ang === -90 || ang === 270) deg = e.beta == null ? 0 : -e.beta;
  else deg = e.gamma; // portrait / 0 / 180 — left-right is gamma
  if (deg == null || Number.isNaN(deg)) return 0;
  return deg;
}
function degToSteer(deg) {
  const a = Math.abs(deg);
  if (a <= TILT_DEADZONE) return 0;
  // Mild smoothstep — responsive past deadzone, full near TILT_MAX
  let u = Math.min(1, (a - TILT_DEADZONE) / (TILT_MAX - TILT_DEADZONE));
  u = u * u * (3 - 2 * u); // smoothstep only
  return (deg < 0 ? -1 : 1) * u * TILT_MAX_STEER;
}
function onDeviceOrientation(e) {
  tilt.rawDeg = orientationToTiltDeg(e);
}
function startTiltListen() {
  if (tilt.listening) return;
  addEventListener('deviceorientation', onDeviceOrientation, true);
  tilt.listening = true;
}
function stopTiltListen() {
  if (!tilt.listening) return;
  removeEventListener('deviceorientation', onDeviceOrientation, true);
  tilt.listening = false;
  tilt.rawDeg = 0;
  tilt.smoothed = 0;
}
function updateTiltUi() {
  if (!tiltToggle) return;
  const on = tilt.want && tilt.allowed;
  tiltToggle.classList.toggle('on', on);
  tiltToggle.setAttribute('aria-pressed', on ? 'true' : 'false');
  if (tiltTip) tiltTip.classList.toggle('hidden', !tilt.denied);
}
async function enableTiltSteering() {
  if (!isTouch) return false;
  tilt.want = true;
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const state = await DeviceOrientationEvent.requestPermission();
      if (state !== 'granted') {
        tilt.allowed = false; tilt.denied = true; tilt.want = false;
        stopTiltListen(); updateTiltUi();
        toast('傾斜轉向：權限被拒');
        return false;
      }
    }
    tilt.allowed = true; tilt.denied = false;
    startTiltListen(); updateTiltUi();
    return true;
  } catch (_) {
    tilt.allowed = false; tilt.denied = true; tilt.want = false;
    stopTiltListen(); updateTiltUi();
    toast('傾斜轉向：無法啟用');
    return false;
  }
}
function disableTiltSteering() {
  tilt.want = false;
  stopTiltListen();
  updateTiltUi();
}
if (tiltToggle) {
  tiltToggle.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    sfx.resume();
    if (tilt.want && tilt.allowed) {
      disableTiltSteering();
      toast('傾斜轉向：關');
    } else {
      enableTiltSteering().then((ok) => { if (ok) toast('傾斜轉向：開'); });
    }
  });
  // Default: try on for mobile (Android often works without prompt; iOS waits for gesture)
  if (isTouch) {
    tilt.want = true;
    // Non-iOS: start listening early; iOS needs a gesture (toggle or Start)
    if (!(typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function')) {
      tilt.allowed = true;
      startTiltListen();
    }
    updateTiltUi();
  }
}

let steerKb = 0;
function readInput(dt) {
  const L = keys.KeyA || keys.ArrowLeft || touch.left, R = keys.KeyD || keys.ArrowRight || touch.right;
  const target = (R ? 1 : 0) - (L ? 1 : 0);
  steerKb += (target - steerKb) * Math.min(1, dt * (target === 0 ? 10 : 7));
  // Smooth + clamp tilt; buttons take priority when held
  let steer = steerKb;
  if (tilt.want && tilt.allowed && !(L || R)) {
    const targetTilt = degToSteer(tilt.rawDeg);
    // Light low-pass — snappy but still filters sensor jitter
    tilt.smoothed += (targetTilt - tilt.smoothed) * Math.min(1, dt * 9);
    if (Math.abs(tilt.smoothed) < 0.02) tilt.smoothed = 0;
    steer = Math.max(-1, Math.min(1, tilt.smoothed));
  } else {
    tilt.smoothed += (0 - tilt.smoothed) * Math.min(1, dt * 8);
  }
  const flight = !!(keys.KeyF || touch.flight);
  const handbrake = !!(keys.Space || touch.handbrake);
  return {
    throttle: (keys.KeyW || keys.ArrowUp || touch.throttle) ? 1 : 0,
    brake: (keys.KeyS || keys.ArrowDown || touch.brake) ? 1 : 0,
    steer,
    handbrake: flight ? false : handbrake,
    flight,
    boost: flight && handbrake,
  };
}

// ---------- audio
const sfx = new Sfx();
function toggleMute() { sfx.setMuted(!sfx.muted); toast(sfx.muted ? '聲音：關' : '聲音：開'); }

// ---------- game state
const N = track.N;
const CPS = [Math.floor(N * 0.25), Math.floor(N * 0.5), Math.floor(N * 0.75)];
const G = {
  state: 'menu', countdown: 0, lap: 1, lapStart: 0, raceTime: 0, lapTimes: [], best: Number(localStorage.getItem('rr_best') || 0) || null,
  last: null, idx: N - 14, prevIdx: N - 14, nextCp: 0, finished: false, wrongWay: 0, flipTimer: 0, time: 0,
};
function fmt(t) { if (t == null) return '--:--.---'; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(3).padStart(6, '0')}`; }
function placeAt(idx, lateral = 0) {
  const p = track.pos[idx], t = track.tan[idx], s = track.side[idx];
  car.reset(p.x + s.x * lateral, p.z + s.z * lateral, Math.atan2(t.x, t.z));
  G.idx = G.prevIdx = idx;
  lastSkid.fill(null);
  updateBarriers(car.chassis.position);
}
function resetCar() {
  if (G.state === 'menu') return;
  const i = track.nearest(car.chassis.position, G.idx, 80);
  placeAt(i, 0); toast('車輛已重置');
}
function startRace() {
  placeAt(N - 14, 0);
  Object.assign(G, { state: 'countdown', countdown: 3.999, lap: 1, nextCp: 0, finished: false, lapTimes: [], last: null, raceTime: 0, lapStart: 0 });
  $('hud').classList.remove('hidden'); if (isTouch) $('touch').classList.remove('hidden');
  $('start').classList.add('hidden');
  setTimeout(() => $('help').classList.add('hidden'), 15000);
}

// ---------- camera
const CAM_NAMES = ['追尾鏡頭', '遠距追尾', '車內視角', '電視轉播', '環繞展示'];
let camMode = 0, camYaw = 0, camInit = false;
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
function cycleCamera() { camMode = (camMode + 1) % CAM_NAMES.length; toast('鏡頭：' + CAM_NAMES[camMode]); camInit = false; }
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), fwdV = new THREE.Vector3(), tvSpot = new THREE.Vector3();
function updateCamera(dt) {
  const p = carGroup.position;
  fwdV.set(0, 0, 1).applyQuaternion(carGroup.quaternion); fwdV.y = 0; fwdV.normalize();
  const yaw = Math.atan2(fwdV.x, fwdV.z);
  let dy = yaw - camYaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
  const kmh = Math.abs(car.speed) * 3.6;
  if (!camInit) { camYaw = yaw; dy = 0; }
  camYaw += dy * Math.min(1, dt * (camMode === 1 ? 3 : 4.5));
  let fov = 62;
  if (camMode === 0 || camMode === 1) {
    const flyH = car.flying ? Math.min(8, Math.max(0, p.y - 0.5)) * 0.45 : 0;
    const d = (camMode === 0 ? 6.2 + kmh * 0.006 : 10.5) + (car.flying ? 4 : 0);
    const h = (camMode === 0 ? 2.0 : 3.6) + flyH + (car.flying ? 2 : 0);
    tmpV.set(p.x - Math.sin(camYaw) * d, p.y + h, p.z - Math.cos(camYaw) * d);
    tmpV2.set(p.x + Math.sin(camYaw) * 3, p.y + 0.9, p.z + Math.cos(camYaw) * 3);
    fov = 60 + Math.min(kmh, 260) * 0.065;
    if (!camInit) { camPos.copy(tmpV); camLook.copy(tmpV2); }
    camPos.lerp(tmpV, 1 - Math.exp(-dt * 12)); camLook.lerp(tmpV2, 1 - Math.exp(-dt * 16));
  } else if (camMode === 2) {
    // Clean driver POV: eye at head height, gaze over low dash through windshield
    tmpV.set(0.26, 1.02 - REST_Y, -0.18).applyQuaternion(carGroup.quaternion).add(p);
    tmpV2.set(0.22, 0.88 - REST_Y, 14).applyQuaternion(carGroup.quaternion).add(p);
    camPos.copy(tmpV); camLook.copy(tmpV2); fov = 65;
  } else if (camMode === 4) {
    G.orbit = (G.orbit ?? 0.6) + dt * (G.orbitSpeed ?? 0.35);
    const r = G.orbitR ?? 6.0;
    camPos.set(p.x + Math.sin(yaw + G.orbit) * r, p.y + (G.orbitH ?? 1.3), p.z + Math.cos(yaw + G.orbit) * r);
    camLook.set(p.x, p.y + 0.1, p.z); fov = 45;
  } else {
    // TV camera: fixed spots beside the track, hop when car gets far
    if (!camInit || tvSpot.distanceTo(p) > 70) {
      const ahead = (G.idx + 45) % N, s = track.side[ahead], sd = Math.random() < 0.5 ? -1 : 1;
      tvSpot.set(track.pos[ahead].x + s.x * sd * 15, 3.2 + Math.random() * 3, track.pos[ahead].z + s.z * sd * 15);
    }
    camPos.copy(tvSpot); camLook.lerp(tmpV2.copy(p).setY(p.y + 0.5), camInit ? 1 - Math.exp(-dt * 10) : 1);
    fov = THREE.MathUtils.clamp(900 / Math.max(10, tvSpot.distanceTo(p)), 12, 60);
  }
  camInit = true;
  camera.position.copy(camPos); camera.lookAt(camLook);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix(); }
  // Cockpit: hide HUD clutter + bulky interior meshes that block the windshield
  const inCockpit = camMode === 2;
  document.body.classList.toggle('cockpit-cam', inCockpit);
  if (cockpitHide) cockpitHide.visible = !inCockpit;
  // shadow camera follows car
  sun.position.copy(p).addScaledVector(SUN_DIR, 120); sun.target.position.copy(p);
}

// ---------- HUD
const hud = { lap: $('lap'), laptime: $('laptime'), lastlap: $('lastlap'), bestlap: $('bestlap'), cps: $('cps'), speed: $('speed'), garc: $('garc'), msg: $('msg'), sub: $('sub'), gear: $('gearflag'), fps: $('fps'), flight: $('flightHud'), fuelFill: $('fuelFill'), thrustFill: $('thrustFill'), flightBtn: document.querySelector('#touch .tb.flight') };
const arcLen = hud.garc.getTotalLength(); hud.garc.style.strokeDasharray = arcLen; hud.garc.style.strokeDashoffset = arcLen;
let toastT = 0;
function toast(t) { const e = $('toast'); e.textContent = t; e.classList.add('show'); toastT = 1.6; }
function bigMsg(t, sub = '') { if (hud.msg.textContent !== t) { hud.msg.textContent = t; hud.msg.classList.remove('pop'); void hud.msg.offsetWidth; if (t) hud.msg.classList.add('pop'); } hud.sub.textContent = sub; }
let msgT = 0;
const mm = $('minimap'), mctx = mm.getContext('2d');
let mmBounds = null;
const mmBg = (() => {
  let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
  for (const p of track.pos) { minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); minz = Math.min(minz, p.z); maxz = Math.max(maxz, p.z); }
  const sc = 170 / Math.max(maxx - minx, maxz - minz); mmBounds = { minx, minz, sc, ox: (200 - (maxx - minx) * sc) / 2, oz: (200 - (maxz - minz) * sc) / 2 };
  const c = document.createElement('canvas'); c.width = c.height = 200; const g = c.getContext('2d');
  g.lineJoin = 'round'; g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 6; g.beginPath();
  track.pos.forEach((p, i) => { const [x, y] = mmXY(p.x, p.z); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.stroke();
  g.strokeStyle = '#333'; g.lineWidth = 3; g.stroke();
  const [sx, sy] = mmXY(track.pos[0].x, track.pos[0].z); g.fillStyle = '#fff'; g.fillRect(sx - 4, sy - 4, 8, 8);
  return c;
})();
function mmXY(x, z) { const b = mmBounds; return [b.ox + (x - b.minx) * b.sc, b.oz + (z - b.minz) * b.sc]; }
function drawMinimap() {
  mctx.clearRect(0, 0, 200, 200); mctx.drawImage(mmBg, 0, 0);
  CPS.forEach((ci, k) => { const [x, y] = mmXY(track.pos[ci].x, track.pos[ci].z); mctx.fillStyle = k < G.nextCp ? '#4caf50' : '#ffd54a'; mctx.beginPath(); mctx.arc(x, y, 4, 0, 7); mctx.fill(); });
  const [x, y] = mmXY(car.chassis.position.x, car.chassis.position.z);
  mctx.fillStyle = '#ff3b3b'; mctx.strokeStyle = '#fff'; mctx.lineWidth = 2; mctx.beginPath(); mctx.arc(x, y, 6, 0, 7); mctx.fill(); mctx.stroke();
}
let hudTick = 0, fpsAcc = 0, fpsN = 0;
function updateHud(dt) {
  hudTick += dt;
  if (fpsAcc > 0.5) { hud.fps.textContent = Math.round(fpsN / fpsAcc) + ' fps'; fpsAcc = 0; fpsN = 0; }
  if (toastT > 0 && (toastT -= dt) <= 0) $('toast').classList.remove('show');
  if (msgT > 0 && (msgT -= dt) <= 0) bigMsg('');
  if (hudTick < 1 / 20) return; hudTick = 0;
  const kmh = Math.round(Math.abs(car.speed) * 3.6);
  hud.speed.textContent = kmh;
  hud.garc.style.strokeDashoffset = arcLen * (1 - Math.min(kmh, 280) / 280);
  if (car.flying) {
    hud.gear.textContent = car.thrustLevel > 0.5 && (keys.Space || touch.handbrake) ? '· 推進加力' : '· 飛行模式';
    hud.flight?.classList.add('on');
    if (hud.flightBtn) hud.flightBtn.classList.add('lit');
  } else {
    hud.gear.textContent = car.speed < -0.5 ? '· R 倒車' : car.handbrake ? '· 手煞車' : '';
    hud.flight?.classList.remove('on');
    if (hud.flightBtn) hud.flightBtn.classList.remove('lit');
  }
  if (hud.fuelFill) hud.fuelFill.style.width = `${(car.fuel / FLIGHT.maxFuel) * 100}%`;
  if (hud.thrustFill) hud.thrustFill.style.width = `${car.thrustLevel * 100}%`;
  hud.lap.textContent = G.finished ? `${G.lap} · 練習` : `${Math.min(G.lap, TOTAL_LAPS)} / ${TOTAL_LAPS}`;
  const cur = G.state === 'racing' ? G.time - G.lapStart : 0;
  hud.laptime.textContent = fmt(cur);
  hud.lastlap.textContent = fmt(G.last);
  hud.bestlap.textContent = fmt(G.best);
  hud.cps.textContent = [0, 1, 2].map((k) => (k < G.nextCp ? '●' : '○')).join(' ');
  drawMinimap();
}

// ---------- lap logic
function updateProgress(dt) {
  G.prevIdx = G.idx;
  let ni = track.nearest(car.chassis.position, G.idx, 60);
  let dd = Math.abs(ni - G.idx); dd = Math.min(dd, N - dd);
  if (dd >= 58) ni = track.nearest(car.chassis.position, -1); // lost track of progress (teleport) -> global search
  G.idx = ni;
  if (G.state !== 'racing') return;
  const a = G.prevIdx, b = G.idx;
  let d = b - a; if (d > N / 2) d -= N; if (d < -N / 2) d += N;
  if (G.nextCp < 3 && d > 0) {
    const cp = CPS[G.nextCp];
    if (a < cp && b >= cp) { G.nextCp++; toast(`檢查點 ${G.nextCp} / 3 ✓`); sfx.beep(880, 0.08); }
  }
  if (d > 0 && a > N * 0.8 && b < N * 0.2) {
    if (G.nextCp === 3) {
      const lt = G.time - G.lapStart; G.lapStart = G.time; G.last = lt; G.lapTimes.push(lt);
      const isBest = !G.best || lt < G.best;
      if (isBest) { G.best = lt; localStorage.setItem('rr_best', String(lt)); }
      G.nextCp = 0;
      if (!G.finished && G.lap >= TOTAL_LAPS) {
        G.finished = true; G.lap++;
        const total = G.lapTimes.slice(0, TOTAL_LAPS).reduce((s, x) => s + x, 0);
        bigMsg('完賽！', `總時間 ${fmt(total)}\n最佳圈速 ${fmt(Math.min(...G.lapTimes))}\n（繼續自由練習）`); msgT = 6; sfx.fanfare();
      } else {
        G.lap++;
        bigMsg(isBest ? '最佳圈速！' : `第 ${Math.min(G.lap, TOTAL_LAPS)} 圈`, `單圈 ${fmt(lt)}`); msgT = 2.5; sfx.beep(isBest ? 1320 : 990, 0.15);
        if (!G.finished && G.lap === TOTAL_LAPS) hud.sub.textContent += '\n最後一圈！';
      }
    }
  }
  // wrong-way detection
  const v = car.chassis.velocity, t = track.tan[G.idx];
  if (v.x * t.x + v.z * t.z < -4) G.wrongWay += dt; else G.wrongWay = 0;
  if (G.wrongWay > 1.0 && msgT <= 0) { hud.sub.textContent = '⚠ 逆向行駛！'; } else if (G.wrongWay === 0 && hud.sub.textContent === '⚠ 逆向行駛！') hud.sub.textContent = '';
}

// ---------- main loop
const clock = new THREE.Clock();
let acc = 0;
const ZERO_INPUT = { throttle: 0, brake: 0, steer: 0, handbrake: false, flight: false, boost: false };
const w_q = new THREE.Quaternion(), qTmp = new THREE.Quaternion(), qSteer = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0), sideV = new THREE.Vector3();
function frame() {
  const rawDt = clock.getDelta(); const dt = Math.min(rawDt, 0.1);
  fpsAcc += rawDt; fpsN++;
  G.time += dt;
  let input = readInput(dt);
  if (G.state === 'countdown') {
    const before = Math.ceil(G.countdown);
    G.countdown -= dt;
    const n = Math.ceil(G.countdown);
    trackMeshes.startLights.forEach((m, k) => (m.emissiveIntensity = (4 - G.countdown) > k * 0.75 ? 4 : 0));
    if (n !== before || !hud.msg.textContent) { if (n > 0 && n <= 3) { bigMsg(String(n)); sfx.beep(520, 0.15); } }
    if (G.countdown <= 0) { G.state = 'racing'; G.lapStart = G.time; bigMsg('出發！'); msgT = 1.2; sfx.beep(1040, 0.35); trackMeshes.startLights.forEach((m) => { m.emissive.setHex(0x00ff40); }); setTimeout(() => trackMeshes.startLights.forEach((m) => { m.emissiveIntensity = 0; m.emissive.setHex(0xff0000); }), 3000); }
    input = { ...ZERO_INPUT, brake: 0 };
  } else if (G.state === 'menu') input = ZERO_INPUT;

  // physics (fixed step, per-substep control so forces persist correctly)
  acc += dt; let n = 0;
  if ((G.frameNo = (G.frameNo || 0) + 1) % 8 === 0) updateBarriers(car.chassis.position);
  while (acc >= STEP && n < 10) { car.update(STEP, input, track, G.idx); world.step(STEP); acc -= STEP; n++; }
  if (n === 10) acc = 0;

  updateProgress(dt);
  // auto recover if flipped / stuck upside down
  if (car.isFlipped() && G.state !== 'menu') { G.flipTimer += dt; if (G.flipTimer > 2.0) { G.flipTimer = 0; resetCar(); } } else G.flipTimer = 0;
  if (car.chassis.position.y < -5) resetCar();

  // sync visuals
  carGroup.position.copy(car.chassis.position); carGroup.quaternion.copy(car.chassis.quaternion);
  const v = car.vehicle;
  const kmh = Math.abs(car.speed) * 3.6;
  let slipAmt = 0;
  for (let i = 0; i < 4; i++) {
    v.updateWheelTransform(i);
    const wi = v.wheelInfos[i], tr = wi.worldTransform, w = wheels[i];
    w.outer.position.copy(tr.position);
    qSteer.setFromAxisAngle(yAxis, wi.steering);
    w.outer.quaternion.copy(car.chassis.quaternion).multiply(qSteer);
    w.spin.rotation.x = -wi.rotation;
    // skids
    let sliding = false;
    if (wi.raycastResult.hasHit && kmh > 12) {
      const hp = wi.raycastResult.hitPointWorld, cp = car.chassis.position, cv = car.chassis.velocity, w = car.chassis.angularVelocity;
      const rx = hp.x - cp.x, ry = hp.y - cp.y, rz = hp.z - cp.z;
      const vx = cv.x + (w.y * rz - w.z * ry), vz = cv.z + (w.x * ry - w.y * rx);
      sideV.set(1, 0, 0).applyQuaternion(w_q.copy(car.chassis.quaternion).multiply(qSteer));
      const lat = Math.abs(vx * sideV.x + vz * sideV.z);
      sliding = lat > 2.6 || (car.handbrake && i >= 2);
    }
    if (sliding) {
      const hp = wi.raycastResult.hitPointWorld; tmpV.set(hp.x, hp.y, hp.z);
      sideV.y = 0; sideV.normalize();
      addSkid(i, tmpV, sideV); slipAmt += 1;
      if (Math.random() < 0.35 * dt * 60) spawnSmoke(tmpV, Math.min(1, kmh / 80));
    } else lastSkid[i] = null;
  }
  for (const o of smoke) {
    if (o.life <= 0) continue;
    o.life -= dt * 0.9; o.s.position.addScaledVector(o.vel, dt);
    const s = 1.2 + (1 - o.life) * 4; o.s.scale.set(s, s, s);
    o.s.material.opacity = Math.max(0, o.life) * 0.35 * o.strength;
    if (o.life <= 0) o.s.visible = false;
  }
  tailMat.emissiveIntensity = car.braking || (input.brake && car.speed > 0.5) ? 6 : 1.6;
  reverseMat.emissiveIntensity = car.speed < -0.5 ? 3 : 0;
  headMat.emissiveIntensity = 0.2 + (car.flying ? 1.2 : 0);

  // Active wing: deploys with speed / flight
  const wingT = car.flying ? 1 : Math.min(1, kmh / 160);
  wingGroup.rotation.x = -0.35 * wingT;
  wingGroup.position.y = 0.96 + 0.14 * wingT;
  fanBlades.rotation.z += dt * (8 + kmh * 0.15 + (car.flying ? 20 : 0));

  // Thruster glow + cold-gas plumes
  const tl = car.thrustLevel;
  rearGlow.material.emissiveIntensity = tl * 4;
  rearGlow.scale.setScalar(0.7 + tl * 1.4);
  for (const p of perimeter) {
    p.glow.material.emissiveIntensity = tl * 3.5;
    p.glow.scale.setScalar(0.6 + tl * 1.2);
  }
  updatePlumes(dt, tl, input);

  // Camera pulls back when flying
  if (car.flying && (camMode === 0 || camMode === 1)) {
    /* handled via altitude in updateCamera below via carGroup.position */
  }

  terrain.update(G.time);
  updateCamera(dt);
  updateHud(dt);
  sfx.update(kmh, input.throttle, slipAmt / 4, G.state !== 'menu');

  if (usePost) composer.render(dt); else renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
});

// boot
placeAt(N - 14, 0);
for (let i = 0; i < 120; i++) { car.update(STEP, ZERO_INPUT, track, G.idx); world.step(STEP); }
$('loading').classList.add('hidden');
$('go').classList.remove('hidden');
$('go').addEventListener('click', () => { sfx.resume(); if (isTouch && tilt.want && !tilt.allowed && !tilt.denied) enableTiltSteering(); else if (isTouch && tilt.want && tilt.allowed) startTiltListen(); startRace(); });
if (params.has('autostart')) startRace();
requestAnimationFrame(frame);


// ---------- cold-gas plume particles
const plumeTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(180,220,255,1)'); r.addColorStop(0.35, 'rgba(120,180,255,0.7)');
  r.addColorStop(1, 'rgba(80,140,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const plumes = [];
for (let i = 0; i < 48; i++) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: plumeTex, color: 0xaad4ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.visible = false; scene.add(s);
  plumes.push({ s, life: 0, vel: new THREE.Vector3() });
}
let plumeIdx = 0;
const _plumeOrigin = new THREE.Vector3();
function spawnPlume(localPos, localDir, strength) {
  const o = plumes[plumeIdx]; plumeIdx = (plumeIdx + 1) % plumes.length;
  _plumeOrigin.copy(localPos).applyMatrix4(carGroup.matrixWorld);
  o.s.position.copy(_plumeOrigin);
  o.life = 0.55 + Math.random() * 0.25;
  o.s.visible = true; o.strength = strength;
  const dir = localDir.clone().transformDirection(carGroup.matrixWorld);
  o.vel.copy(dir).multiplyScalar(6 + strength * 10).add(new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2));
}
function updatePlumes(dt, tl, input) {
  if (tl > 0.05) {
    const boost = !!(input.boost);
    const str = tl * (boost ? 1.4 : 1);
    if (Math.random() < 0.85) spawnPlume(new THREE.Vector3(0, 0.38 - REST_Y, -2.35), new THREE.Vector3(0, 0.15, -1), str);
    if (Math.random() < 0.5) {
      const sx = Math.random() < 0.5 ? 0.7 : -0.7;
      spawnPlume(new THREE.Vector3(sx, 0.22 - REST_Y, -1.55), new THREE.Vector3(sx * 0.3, -0.2, -0.8), str * 0.7);
    }
    if (car.flying && Math.random() < 0.4) {
      spawnPlume(new THREE.Vector3((Math.random() - 0.5) * 1.4, 0.15 - REST_Y, (Math.random() - 0.5) * 2), new THREE.Vector3(0, -1, 0), str * 0.5);
    }
  }
  for (const o of plumes) {
    if (o.life <= 0) continue;
    o.life -= dt * 2.2; o.s.position.addScaledVector(o.vel, dt);
    const s = 0.4 + (1 - Math.max(0, o.life)) * 2.2; o.s.scale.set(s, s, s);
    o.s.material.opacity = Math.max(0, o.life) * 0.7 * o.strength;
    if (o.life <= 0) o.s.visible = false;
  }
}

// debug/test hook
window.__game = { G, car, track, camera, renderer, get skids() { return skidCount; }, teleport(i) { const p = track.pos[i], t = track.tan[i]; car.reset(p.x, p.z, Math.atan2(t.x, t.z)); updateBarriers(car.chassis.position); }, get kmh() { return Math.abs(car.speed) * 3.6; }, setCam(m) { camMode = m; camInit = false; }, keys, touch, tilt, startRace, wingGroup, forceFlight(on) { touch.flight = !!on; keys.KeyF = !!on; } };
