// Vehicle physics on cannon-es RaycastVehicle + Rocket-trim cold-gas flight.
// Body frame: +Z forward, +Y up, +X left.
import * as CANNON from '../vendor/cannon-es.js';
import { BARRIER_OFFSET, TRACK_HALF_WIDTH, CURB_WIDTH } from './track.js';

export const CAR = {
  mass: 1450,
  wheelRadius: 0.36,
  frontZ: 1.36, rearZ: -1.30, trackX: 0.83,
  connY: 0.13,
  restLength: 0.30,
  maxForce: 15500,
  power: 600000,
  reverseForce: 6000,
  brakeImpulse: 38,
  handbrakeImpulse: 18,
  drag: 1.15, rolling: 120, downforce: 1.6,
  frictionFront: 1.75, frictionRear: 1.65, frictionRearHandbrake: 0.95,
};

export const FLIGHT = {
  maxFuel: 100,
  burnRate: 18,          // fuel/s while thrusting
  boostBurn: 28,         // extra while Space boost
  rechargeRate: 12,      // fuel/s on ground
  liftForce: 22000,      // N upward hold
  hoverForce: 15500,     // approx weight cancel
  forwardThrust: 28000,
  lateralThrust: 14000,
  boostMult: 1.85,
  torquePitch: 9000,
  torqueYaw: 7000,
  torqueRoll: 8000,
  airDrag: 0.55,
  softLandSpeed: 8,      // m/s vertical soft landing threshold
};

export const STEP = 1 / 120;

export function createWorld(track) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = false;
  world.solver.iterations = 10;
  const groundMat = new CANNON.Material('ground');
  const chassisMat = new CANNON.Material('chassis');
  const barrierMat = new CANNON.Material('barrier');
  world.addContactMaterial(new CANNON.ContactMaterial(chassisMat, barrierMat, { friction: 0.02, restitution: 0.25 }));
  world.addContactMaterial(new CANNON.ContactMaterial(chassisMat, groundMat, { friction: 0.35, restitution: 0.05 }));
  const ground = new CANNON.Body({ mass: 0, material: groundMat, shape: new CANNON.Box(new CANNON.Vec3(1500, 5, 1500)) });
  ground.position.set(0, -5, 0);
  world.addBody(ground);

  const barriers = [];
  if (track) {
    const K = 5;
    for (const s of [-1, 1]) {
      for (let i = 0; i < track.N; i += K) {
        const j = (i + K) % track.N;
        const ax = track.pos[i].x + track.side[i].x * s * BARRIER_OFFSET, az = track.pos[i].z + track.side[i].z * s * BARRIER_OFFSET;
        const bx = track.pos[j].x + track.side[j].x * s * BARRIER_OFFSET, bz = track.pos[j].z + track.side[j].z * s * BARRIER_OFFSET;
        const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
        const th = 0.4, ox = track.side[i].x * s * th, oz = track.side[i].z * s * th;
        const body = new CANNON.Body({ mass: 0, material: barrierMat, shape: new CANNON.Box(new CANNON.Vec3(th, 0.75, len / 2 + 0.25)) });
        body.position.set((ax + bx) / 2 + ox, 0.75, (az + bz) / 2 + oz);
        body.quaternion.setFromEuler(0, Math.atan2(dx, dz), 0);
        body.inWorld = false;
        barriers.push(body);
      }
    }
  }
  function updateBarriers(p, radius = 45) {
    const r2 = radius * radius;
    for (const b of barriers) {
      const dx = b.position.x - p.x, dz = b.position.z - p.z, near = dx * dx + dz * dz < r2;
      if (near && !b.inWorld) { world.addBody(b); b.inWorld = true; }
      else if (!near && b.inWorld) { world.removeBody(b); b.inWorld = false; }
    }
  }
  return { world, groundMat, chassisMat, barrierMat, barriers, updateBarriers };
}

export class Car {
  constructor(world, chassisMat) {
    const chassis = new CANNON.Body({ mass: CAR.mass, material: chassisMat });
    chassis.addShape(new CANNON.Box(new CANNON.Vec3(0.9, 0.33, 2.12)), new CANNON.Vec3(0, 0.17, 0));
    chassis.addShape(new CANNON.Box(new CANNON.Vec3(0.6, 0.18, 0.9)), new CANNON.Vec3(0, 0.62, -0.25));
    chassis.angularDamping = 0.35;
    chassis.linearDamping = 0.01;
    this.chassis = chassis;
    const v = new CANNON.RaycastVehicle({ chassisBody: chassis, indexRightAxis: 0, indexUpAxis: 1, indexForwardAxis: 2 });
    const base = {
      radius: CAR.wheelRadius, directionLocal: new CANNON.Vec3(0, -1, 0),
      suspensionStiffness: 38, suspensionRestLength: CAR.restLength,
      dampingRelaxation: 2.6, dampingCompression: 4.0, maxSuspensionForce: 1e6,
      rollInfluence: 0.06, axleLocal: new CANNON.Vec3(-1, 0, 0),
      maxSuspensionTravel: 0.25, customSlidingRotationalSpeed: -30, useCustomSlidingRotationalSpeed: true,
      frictionSlip: CAR.frictionFront,
    };
    const P = [[CAR.trackX, CAR.frontZ], [-CAR.trackX, CAR.frontZ], [CAR.trackX, CAR.rearZ], [-CAR.trackX, CAR.rearZ]];
    for (const [x, z] of P) v.addWheel({ ...base, chassisConnectionPointLocal: new CANNON.Vec3(x, CAR.connY, z) });
    v.addToWorld(world);
    this.vehicle = v;
    this.steer = 0;
    this.speed = 0;
    this.offTrack = [false, false, false, false];
    this.braking = false;
    this.handbrake = false;
    this.flying = false;
    this.thrustLevel = 0; // 0..1 visual
    this.fuel = FLIGHT.maxFuel;
    this.altitude = 0;
    this.wheelsOnGround = true;
    this._f = new CANNON.Vec3(); this._tmp = new CANNON.Vec3();
    this._up = new CANNON.Vec3(); this._right = new CANNON.Vec3();
  }
  forward(out = new CANNON.Vec3()) { return this.chassis.quaternion.vmult(new CANNON.Vec3(0, 0, 1), out); }
  up(out = new CANNON.Vec3()) { return this.chassis.quaternion.vmult(new CANNON.Vec3(0, 1, 0), out); }
  right(out = new CANNON.Vec3()) { return this.chassis.quaternion.vmult(new CANNON.Vec3(1, 0, 0), out); }

  // input: {throttle, brake, steer, handbrake, flight, boost}
  update(dt, input, track, hintIdx) {
    const v = this.vehicle, ch = this.chassis;
    const fwd = this.forward(this._f);
    const vel = ch.velocity;
    const speed = vel.dot(fwd); this.speed = speed;
    const absV = Math.abs(speed), kmh = absV * 3.6;

    // ground contact from wheel rays
    let nContact = 0;
    for (let i = 0; i < 4; i++) if (v.wheelInfos[i].raycastResult.hasHit) nContact++;
    this.wheelsOnGround = nContact >= 2;
    this.altitude = ch.position.y;

    const wantFlight = !!(input.flight) && this.fuel > 0.5;
    if (wantFlight) {
      this.flying = true;
      this._updateFlight(dt, input, fwd);
    } else {
      if (this.flying) this._trySoftLand();
      this.flying = false;
      this.thrustLevel = Math.max(0, this.thrustLevel - dt * 4);
      this._updateDrive(dt, input, track, hintIdx, fwd, speed, absV, kmh);
      if (this.wheelsOnGround && this.fuel < FLIGHT.maxFuel) {
        this.fuel = Math.min(FLIGHT.maxFuel, this.fuel + FLIGHT.rechargeRate * dt);
      }
    }
  }

  _updateDrive(dt, input, track, hintIdx, fwd, speed, absV, kmh) {
    const v = this.vehicle, ch = this.chassis;
    const vel = ch.velocity;

    const steerMax = 0.58 / (1 + kmh / 75);
    const target = -input.steer * steerMax;
    const rate = (Math.abs(target) < Math.abs(this.steer) ? 6 : 3.2) * steerMax + 0.6;
    const d = target - this.steer;
    this.steer += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
    v.setSteeringValue(this.steer, 0); v.setSteeringValue(this.steer, 1);

    let engine = 0, brake = 0; this.braking = false;
    if (input.throttle > 0) {
      if (speed < -1) { brake = CAR.brakeImpulse * input.throttle; this.braking = true; }
      else engine = Math.min(CAR.maxForce, CAR.power / Math.max(absV, 1)) * input.throttle;
    }
    if (input.brake > 0) {
      if (speed > 1) { brake = Math.max(brake, CAR.brakeImpulse * input.brake); this.braking = true; }
      else if (speed > -16) engine = -CAR.reverseForce * input.brake;
    }
    const s = -1;
    v.applyEngineForce(s * engine * 0.2, 0); v.applyEngineForce(s * engine * 0.2, 1);
    v.applyEngineForce(s * engine * 0.3, 2); v.applyEngineForce(s * engine * 0.3, 3);
    for (let i = 0; i < 4; i++) v.setBrake(brake, i);
    this.handbrake = !!input.handbrake;
    if (this.handbrake) { v.setBrake(CAR.handbrakeImpulse, 2); v.setBrake(CAR.handbrakeImpulse, 3); v.applyEngineForce(0, 2); v.applyEngineForce(0, 3); }
    if (!input.throttle && !input.brake && !this.handbrake && absV < 0.5) for (let i = 0; i < 4; i++) v.setBrake(2, i);

    let nOff = 0;
    for (let i = 0; i < 4; i++) {
      const w = v.wheelInfos[i];
      let off = false;
      if (track && hintIdx >= 0) {
        const p = w.raycastResult.hitPointWorld;
        const lat = Math.abs(track.lateral(p, hintIdx));
        off = lat > TRACK_HALF_WIDTH + CURB_WIDTH + 0.3;
      }
      this.offTrack[i] = off; if (off) nOff++;
      let f = i < 2 ? CAR.frictionFront : (this.handbrake ? CAR.frictionRearHandbrake : CAR.frictionRear);
      if (i >= 2 && input.throttle > 0 && absV < 25 && Math.abs(input.steer) > 0.5) f *= 0.9;
      w.frictionSlip = off ? f * 0.6 : f;
    }
    const sp = vel.length();
    if (sp > 0.01) {
      const k = CAR.drag * sp + CAR.rolling / sp + nOff * 260 / Math.max(sp, 1);
      ch.applyForce(new CANNON.Vec3(-vel.x * k, -vel.y * k * 0.2, -vel.z * k));
    }
    ch.applyForce(new CANNON.Vec3(0, -CAR.downforce * sp * sp, 0));

    if (sp > 5) {
      const beta = Math.atan2(fwd.x * vel.z - fwd.z * vel.x, fwd.x * vel.x + fwd.z * vel.z);
      this.slipAngle = beta;
      const ab = Math.abs(beta);
      if (ab > 0.3 && ab < 2.2) {
        const k = Math.min(1, (ab - 0.3) * 2.5);
        ch.torque.y += -ch.angularVelocity.y * 11000 * k;
        const pull = 900 * k;
        const fx = fwd.x * sp - vel.x, fz = fwd.z * sp - vel.z;
        ch.force.x += fx * pull / Math.max(sp, 1) * 2; ch.force.z += fz * pull / Math.max(sp, 1) * 2;
      }
    } else this.slipAngle = 0;
  }

  _updateFlight(dt, input, fwd) {
    const ch = this.chassis, v = this.vehicle;
    // kill drive / brakes while flying
    for (let i = 0; i < 4; i++) { v.applyEngineForce(0, i); v.setBrake(0, i); v.setSteeringValue(0, i < 2 ? 0 : 0); }
    this.steer *= 0.9;
    this.braking = false;
    this.handbrake = false;

    const boost = !!(input.boost || input.handbrake);
    const burn = (FLIGHT.burnRate + (boost ? FLIGHT.boostBurn : 0)) * dt;
    this.fuel = Math.max(0, this.fuel - burn);
    const mult = boost ? FLIGHT.boostMult : 1;
    this.thrustLevel = Math.min(1, this.thrustLevel + dt * 5);

    const up = this.up(this._up);
    const right = this.right(this._right);

    // Hover / lift: cancel gravity + climb with throttle, descend with brake
    const lift = FLIGHT.hoverForce + FLIGHT.liftForce * (input.throttle - input.brake * 0.7);
    ch.applyForce(new CANNON.Vec3(up.x * lift * mult, up.y * lift * mult, up.z * lift * mult));

    // Forward / reverse thrust along body forward
    const ft = FLIGHT.forwardThrust * (input.throttle * 0.35 + (boost ? 0.65 : 0.25));
    ch.applyForce(new CANNON.Vec3(fwd.x * ft * mult, fwd.y * ft * mult, fwd.z * ft * mult));

    // Lateral from steer
    const lat = -input.steer * FLIGHT.lateralThrust;
    ch.applyForce(new CANNON.Vec3(right.x * lat, right.y * lat, right.z * lat));

    // Attitude: pitch (W/S already used for lift — use residual via angular from steer combos)
    // Pitch: brake pitches nose down slightly when flying without much throttle change handled above
    // Use angular torque from WASD-style: steer = yaw+roll, throttle/brake bias pitch
    const pitchCmd = (input.brake - input.throttle) * 0.35; // slight
    // Better air control: map steer to yaw, and also roll; Space boost keeps forward
    // Additional: when flying, A/D = yaw+roll, W/S = pitch via dedicated fields if present
    const pitch = (input.pitch != null ? input.pitch : (input.brake - input.throttle) * 0.5);
    const yaw = input.steer;
    const roll = input.steer * 0.85;
    ch.torque.x += right.x * pitch * FLIGHT.torquePitch + fwd.x * (-roll) * FLIGHT.torqueRoll;
    ch.torque.y += up.y * (-yaw) * FLIGHT.torqueYaw + right.y * pitch * FLIGHT.torquePitch;
    ch.torque.z += right.z * pitch * FLIGHT.torquePitch + fwd.z * (-roll) * FLIGHT.torqueRoll;
    // damp angular for controllable flight
    ch.angularVelocity.x *= 0.985; ch.angularVelocity.y *= 0.98; ch.angularVelocity.z *= 0.985;

    // Air drag
    const vel = ch.velocity, sp = vel.length();
    if (sp > 0.01) {
      const k = FLIGHT.airDrag * sp;
      ch.applyForce(new CANNON.Vec3(-vel.x * k, -vel.y * k, -vel.z * k));
    }

    if (this.fuel <= 0) { this.flying = false; this.thrustLevel = 0; }
  }

  _trySoftLand() {
    const ch = this.chassis;
    // damp vertical velocity for soft landing
    if (ch.velocity.y < -FLIGHT.softLandSpeed) {
      ch.velocity.y *= 0.35;
    }
    // gently level pitch/roll
    const up = this.up(this._up);
    if (up.y > 0.3) {
      ch.angularVelocity.x *= 0.5;
      ch.angularVelocity.z *= 0.5;
    }
  }

  reset(x, z, yaw) {
    const ch = this.chassis;
    ch.position.set(x, 0.9, z);
    ch.quaternion.setFromEuler(0, yaw, 0);
    ch.velocity.setZero(); ch.angularVelocity.setZero(); ch.force.setZero(); ch.torque.setZero();
    this.steer = 0;
    this.flying = false;
    this.thrustLevel = 0;
    this.fuel = FLIGHT.maxFuel;
    for (const w of this.vehicle.wheelInfos) { w.rotation = 0; w.deltaRotation = 0; w.suspensionLength = CAR.restLength; }
  }
  isFlipped() {
    const up = this.chassis.quaternion.vmult(new CANNON.Vec3(0, 1, 0));
    return up.y < 0.3 && !this.flying;
  }
}
