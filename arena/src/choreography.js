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
  const fh = 1000;
  const fw = fh * camera.aspect;
  camera.fov = k.fov;
  camera.setViewOffset(fw, fh, k.ox * fw, k.oy * fh, fw, fh);
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

// Broadcast screen paths in camera space. [x, y] are fractions of the half-extent of the
// view at that depth, z is depth (negative = in front), then yaw, pitch, roll in radians.
const PATHS = {
  desktop: {
    enter: [1.05, -1.05, -16, -0.85, 0.22, -0.20],
    focus: [0.27, 0.0, -9.6, -0.24, 0.0, 0.0],
    exit: [-0.55, 1.10, -14, 0.62, -0.18, 0.18],
  },
  mobile: {
    enter: [1.15, -0.55, -15, -0.85, 0.18, -0.18],
    focus: [0.0, 0.27, -10.5, -0.12, 0.0, 0.0],
    exit: [-1.15, 0.95, -13, 0.70, -0.12, 0.18],
  },
};
export const FOCUS_T = [1, 2, 3];

const _p = new THREE.Vector3();
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();

export function serviceState(i, T) {
  const u = T - FOCUS_T[i];
  const focus = 1 - smooth(0.1, 0.42, Math.abs(u));
  const opacity = smooth(-0.78, -0.62, u) * (1 - smooth(0.62, 0.78, u));
  const reveal = smooth(-0.74, -0.22, u);
  const text = 1 - smooth(0.12, 0.3, Math.abs(u));
  return { u, focus, opacity, reveal, text };
}

export function placeScreen(screen, i, T, camera, { mobile, velocity, time, motion }) {
  const path = mobile ? PATHS.mobile : PATHS.desktop;
  const s = serviceState(i, T);
  const { u } = s;
  const vis = s.opacity > 0.001 && Math.abs(u) < 0.8;
  screen.mesh.visible = vis;
  if (!vis) return s;
  let a;
  let b;
  let kx;
  let ky;
  let kz;
  let kr;
  if (u < -0.1) {
    const k = clamp((u + 0.78) / 0.68, 0, 1);
    a = path.enter;
    b = path.focus;
    kx = 1 - Math.pow(1 - k, 2.0);
    ky = 1 - Math.pow(1 - k, 3.0);
    kz = 1 - Math.pow(1 - k, 2.4);
    kr = 1 - Math.pow(1 - k, 2.6);
  } else if (u > 0.1) {
    const k = clamp((u - 0.1) / 0.68, 0, 1);
    a = path.focus;
    b = path.exit;
    kx = Math.pow(k, 2.4);
    ky = Math.pow(k, 1.7);
    kz = Math.pow(k, 2.0);
    kr = Math.pow(k, 2.2);
  } else {
    a = path.focus;
    b = path.focus;
    kx = ky = kz = kr = 0;
  }
  if (!motion) {
    a = path.focus;
    b = path.focus;
  }
  const z = THREE.MathUtils.lerp(a[2], b[2], kz);
  const halfH = Math.abs(z) * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const halfW = halfH * camera.aspect;
  const x = THREE.MathUtils.lerp(a[0], b[0], kx) * halfW;
  const y = THREE.MathUtils.lerp(a[1], b[1], ky) * halfH;
  _p.set(x, y, z);
  _e.set(
    THREE.MathUtils.lerp(a[4], b[4], kr),
    THREE.MathUtils.lerp(a[3], b[3], kr),
    THREE.MathUtils.lerp(a[5], b[5], kr),
    'YXZ',
  );
  _q.setFromEuler(_e);
  screen.mesh.position.copy(_p).applyMatrix4(camera.matrixWorld);
  screen.mesh.quaternion.copy(camera.quaternion).multiply(_q);
  const sizeK = mobile ? Math.min(1.0, (halfW * 2 * 0.92) / screen.W) : 1;
  screen.mesh.scale.setScalar(sizeK);

  const m = screen.mat.uniforms;
  m.uTime.value = time;
  m.uOpacity.value = s.opacity;
  m.uReveal.value = motion ? s.reveal : 1;
  m.uFocus.value = s.focus;
  const lean = motion ? -Math.sign(u) * (1 - s.focus) * 0.55 : 0;
  const target = clamp(lean + velocity * 1.4 * (motion ? 1 : 0), -1.1, 1.1);
  screen.bend += (target - screen.bend) * 0.12;
  m.uBend.value = screen.bend;
  m.uFlutter.value = motion ? Math.min(1, Math.abs(velocity) * 2.5 + (1 - s.focus) * 0.25) : 0;
  return s;
}
