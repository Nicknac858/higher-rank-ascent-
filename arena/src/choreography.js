// Scroll story: T runs 0..4 (one unit per viewport of scroll).
//   0   hero: low, in the floor seats, looking up at the stage and halo
//   1-3 one service per unit: camera orbits and climbs while a broadcast screen
//       swings in on a diagonal, settles, then swings out
//   4   close: high above the rig, looking down on the stage
import * as THREE from 'three';
import { DIM } from './arena.js';

const clamp = THREE.MathUtils.clamp;
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// th: orbit angle (deg), r: radius, y: height, ty: look-at height, fov: vertical fov,
// ox/oy: frame offset as a fraction of the view (negative ox moves the arena right).
const KEYS = {
  desktop: [
    { th: 0, r: 33.0, y: 6.6, ty: 4.2, fov: 40, ox: -0.085, oy: 0 },
    { th: 26, r: 22.5, y: 4.6, ty: 6.4, fov: 41, ox: 0, oy: 0 },
    { th: 64, r: 20.5, y: 6.2, ty: 7.0, fov: 41, ox: 0, oy: 0 },
    { th: 106, r: 21.0, y: 8.2, ty: 6.8, fov: 41, ox: 0, oy: 0 },
    { th: 150, r: 27.0, y: 21.0, ty: 3.6, fov: 44, ox: -0.17, oy: 0.06 },
  ],
  mobile: [
    { th: 0, r: 41.0, y: 9.0, ty: 5.2, fov: 58, ox: 0, oy: 0.15 },
    { th: 26, r: 31.0, y: 6.4, ty: 7.0, fov: 58, ox: 0, oy: 0.12 },
    { th: 64, r: 29.5, y: 7.4, ty: 7.4, fov: 58, ox: 0, oy: 0.12 },
    { th: 106, r: 30.0, y: 9.0, ty: 7.2, fov: 58, ox: 0, oy: 0.12 },
    { th: 150, r: 34.0, y: 24.0, ty: 3.0, fov: 58, ox: 0, oy: 0.2 },
  ],
};

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function sampleKeys(keys, T) {
  const n = keys.length;
  const x = clamp(T, 0, n - 1);
  const i = Math.min(n - 2, Math.floor(x));
  const t = x - i;
  const k0 = keys[Math.max(0, i - 1)];
  const k1 = keys[i];
  const k2 = keys[i + 1];
  const k3 = keys[Math.min(n - 1, i + 2)];
  const out = {};
  for (const key of Object.keys(k1)) out[key] = catmull(k0[key], k1[key], k2[key], k3[key], t);
  return out;
}

const _look = new THREE.Vector3();

export function placeCamera(camera, T, { mobile, time, pointer, motion }) {
  const k = sampleKeys(mobile ? KEYS.mobile : KEYS.desktop, T);
  const drift = motion ? 1 : 0;
  const th = THREE.MathUtils.degToRad(k.th + Math.sin(time * 0.06) * 1.6 * drift + pointer.x * 1.8 * drift);
  const y = k.y + Math.sin(time * 0.09) * 0.18 * drift - pointer.y * 0.35 * drift;
  camera.position.set(k.r * Math.sin(th), y, k.r * Math.cos(th));
  _look.set(pointer.x * 0.6 * drift, k.ty + pointer.y * 0.25 * drift, 0);
  camera.lookAt(_look);
  // Frame offsets as a small turn of the camera rather than a lens shift: a shifted
  // frustum breaks the mirrored camera used for the floor reflection.
  camera.fov = k.fov;
  const vf = THREE.MathUtils.degToRad(k.fov);
  const hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
  camera.rotateY(-k.ox * hf);
  camera.rotateX(-k.oy * vf);
  camera.updateProjectionMatrix();
  // focus distance for the bokeh dust: the stage centre
  return Math.hypot(camera.position.x, camera.position.y - DIM.stageH, camera.position.z);
}

// Power-up on arrival, seconds since the scene first rendered.
const SCHEDULE = {
  haze: [0.0, 1.6],
  rings: [0.15, 1.5],
  dust: [0.3, 2.2],
  stage: [0.5, 1.2],
  desks: [0.85, 0.7],
  halo: [1.0, 1.25],
  under: [1.2, 1.0],
  ticker: [1.35, 1.2],
  beams: [1.55, 1.5],
  crowd: [1.9, 1.9],
};

export function powerAt(elapsed, instant = false) {
  const p = {};
  for (const [key, [start, dur]] of Object.entries(SCHEDULE)) {
    p[key] = instant ? 1 : clamp((elapsed - start) / dur, 0, 1);
  }
  // Crowd waves on an irregular schedule: different gaps, speeds, directions and spans.
  p.waveAngle = 0;
  p.waveOn = 0;
  p.waveWidth = 30;
  if (!instant) {
    for (const w of WAVES) {
      if (w.start > elapsed) break;
      const k = (elapsed - w.start) / w.dur;
      if (k >= 0 && k <= 1) {
        p.waveAngle = w.a0 + w.dir * w.span * k;
        p.waveOn = Math.sin(k * Math.PI);
        p.waveWidth = w.width;
        break;
      }
    }
  }
  return p;
}

const WAVES = (() => {
  let seed = 90871;
  const r = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const list = [];
  let t = 4.2;
  for (let i = 0; i < 240; i++) {
    const full = r() < 0.6;
    const span = full ? Math.PI * 2 : Math.PI * (0.7 + r() * 0.9);
    const speed = 1.4 + r() * 1.3;
    list.push({ start: t, dur: span / speed, dir: r() < 0.5 ? -1 : 1, span, a0: r() * Math.PI * 2, width: 16 + r() * 34 });
    t += span / speed + 9 + r() * 24;
  }
  return list;
})();

// Glass window paths in camera space. [x, y] are fractions of the half-extent of the view at that
// depth, z is depth (negative = in front). Then yaw, pitch, roll in radians, measured from "facing the
// camera" (so 0 always means square-on wherever the pane is in frame).
// A pane enters edge-on from beyond the right edge, a sliver of light, turns open as it glides into
// place, then keeps turning the same way as it leaves left: one continuous revolution through the frame.
const PATHS = {
  desktop: {
    enter: [1.45, -0.08, -13.0, 1.45, 0.05, -0.04],
    focus: [0.27, 0.0, -9.6, -0.10, 0.0, 0.0],
    exit: [-1.45, 0.12, -12.0, -1.45, -0.05, 0.04],
  },
  mobile: {
    enter: [1.6, -0.12, -14.0, 1.45, 0.05, -0.04],
    focus: [0.0, 0.27, -10.5, 0.0, 0.0, 0.0],
    exit: [-1.6, 0.5, -13.0, -1.45, -0.05, 0.04],
  },
};
export const FOCUS_T = [1, 2, 3];

const _p = new THREE.Vector3();
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _m4 = new THREE.Matrix4();
const _target = new Array(6).fill(0);

export function serviceState(i, T) {
  const u = T - FOCUS_T[i];
  const focus = 1 - smooth(0.1, 0.42, Math.abs(u));
  const opacity = smooth(-0.78, -0.62, u) * (1 - smooth(0.62, 0.78, u));
  // content powers on once the glass has mostly turned to face you
  const reveal = smooth(-0.5, -0.16, u);
  const text = 1 - smooth(0.12, 0.3, Math.abs(u));
  return { u, focus, opacity, reveal, text };
}

// Pane follows its scroll-driven target through a slightly under-damped spring: it carries a little
// weight and settles, instead of being glued to the scrollbar.
const OMEGA = 10;
const ZETA = 0.78;

export function placeScreen(screen, i, T, camera, { mobile, velocity, motion, dt = 1 / 60, snap = false }) {
  const path = mobile ? PATHS.mobile : PATHS.desktop;
  const s = serviceState(i, T);
  const { u } = s;
  // reduced motion: panes stay put; one fades out before the next fades in (never overlapping)
  const still = 1 - smooth(0.3, 0.46, Math.abs(u));
  const vis = motion ? Math.abs(u) < 0.95 : still > 0.001;
  screen.mesh.visible = vis;
  if (!vis) {
    if (screen.spring) screen.spring.live = false;
    return s;
  }
  let a = path.focus;
  let b = path.focus;
  let kx = 0;
  let ky = 0;
  let kz = 0;
  let kr = 0;
  if (motion && u < -0.1) {
    const k = clamp((u + 0.78) / 0.68, 0, 1);
    a = path.enter;
    kx = 1 - Math.pow(1 - k, 2.4);
    ky = 1 - Math.pow(1 - k, 2.0);
    kz = 1 - Math.pow(1 - k, 2.2);
    kr = k * k * (3 - 2 * k);
  } else if (motion && u > 0.1) {
    const k = clamp((u - 0.1) / 0.68, 0, 1);
    b = path.exit;
    kx = Math.pow(k, 2.2);
    ky = Math.pow(k, 1.8);
    kz = Math.pow(k, 2.0);
    kr = k * k * (3 - 2 * k);
  }
  const lerp = THREE.MathUtils.lerp;
  _target[0] = lerp(a[0], b[0], kx);
  _target[1] = lerp(a[1], b[1], ky);
  _target[2] = lerp(a[2], b[2], kz);
  // inertia: a quick scroll leans the pane a few degrees, the spring brings it back
  const v = motion ? velocity : 0;
  _target[3] = lerp(a[3], b[3], kr) + clamp(v * 0.22, -0.14, 0.14);
  _target[4] = lerp(a[4], b[4], kr) - clamp(v * 0.06, -0.04, 0.04);
  _target[5] = lerp(a[5], b[5], kr);

  let sp = screen.spring;
  if (!sp) sp = screen.spring = { x: new Array(6).fill(0), v: new Array(6).fill(0), live: false };
  if (snap || !motion || !sp.live) {
    for (let j = 0; j < 6; j++) { sp.x[j] = _target[j]; sp.v[j] = 0; }
    sp.live = true;
  } else {
    let left = Math.min(dt, 0.1);
    while (left > 1e-6) {
      const h = Math.min(left, 1 / 120);
      for (let j = 0; j < 6; j++) {
        const acc = OMEGA * OMEGA * (_target[j] - sp.x[j]) - 2 * ZETA * OMEGA * sp.v[j];
        sp.v[j] += acc * h;
        sp.x[j] += sp.v[j] * h;
      }
      left -= h;
    }
  }

  const z = sp.x[2];
  const halfH = Math.abs(z) * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const halfW = halfH * camera.aspect;
  const x = sp.x[0] * halfW;
  const y = sp.x[1] * halfH;
  _p.set(x, y, z);
  // angles are relative to facing the camera from where the pane is
  const yaw = sp.x[3] - Math.atan2(x, -z);
  const pitch = sp.x[4] + Math.atan2(y, -z);
  _e.set(pitch, yaw, sp.x[5], 'YXZ');
  _q.setFromEuler(_e);
  screen.mesh.position.copy(_p).applyMatrix4(camera.matrixWorld);
  screen.mesh.quaternion.copy(camera.quaternion).multiply(_q);
  const sizeK = mobile ? Math.min(1.0, (halfW * 2 * 0.92) / screen.W) : 1;
  screen.mesh.scale.setScalar(sizeK);
  // nearer panes draw last
  screen.mesh.renderOrder = Math.round(1000 - Math.abs(z) * 10);

  const m = screen.mat.uniforms;
  m.uObjToView.value.setFromMatrix4(_m4.makeRotationFromQuaternion(_q));
  m.uViewToWorld.value.setFromMatrix4(_m4.makeRotationFromQuaternion(camera.quaternion));
  m.uPaneView.value.copy(_p);
  m.uScale.value = sizeK;
  m.uOpacity.value = motion ? 1 : still;
  m.uReveal.value = motion ? s.reveal : 1;
  m.uFocus.value = s.focus;
  m.uEdge.value = 1 + 1.2 * (1 - s.focus);
  m.uSheen.value = 0.06 + 0.3 * (1 - s.focus);
  return s;
}
