import './style.css';
import * as THREE from 'three';
import Lenis from 'lenis';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode,
  VignetteEffect, ChromaticAberrationEffect, Effect,
} from 'postprocessing';
import { buildArena, buildEnvironment } from './arena.js';
import { fogUniforms, screenMaterial } from './materials.js';
import { makeScreenTexture, setAccent } from './textures.js';
import { placeCamera, powerAt, placeScreen, serviceState } from './choreography.js';
import { detectQuality, Governor } from './quality.js';
import { createReflection } from './reflection.js';

const params = new URLSearchParams(location.search);
const TEST = params.has('test');
if (params.has('poster')) document.documentElement.classList.add('posterize');
const REDUCED = params.has('reduced') || (matchMedia('(prefers-reduced-motion: reduce)').matches && !params.has('motion'));
const MOTION = !REDUCED;
// Second colour: magenta by default (owner's pick, 2026-11-27). Compare others with
// ?accent=name or, inside the artifact viewer, #name (e.g. #purple). #blue = blue only.
const ACCENTS = {
  magenta: { hex: 0xff3d9a, css: '#ff3d9a' },
  purple: { hex: 0xc04bff, css: '#c04bff' },
  violet: { hex: 0x8f5bff, css: '#8f5bff' },
  gold: { hex: 0xffb547, css: '#ffb547' },
  aqua: { hex: 0x2ff3d2, css: '#2ff3d2' },
  blue: null,
};
const accentKey = [params.get('accent'), location.hash.slice(1)].find((k) => k && k in ACCENTS) || 'magenta';
const ACCENT = ACCENTS[accentKey];
if (ACCENT) document.documentElement.style.setProperty('--accent', ACCENT.css);
const html = document.documentElement;
const probe = document.querySelector('.probe');
const svcEls = [...document.querySelectorAll('.svc')];
const heroEl = document.querySelector('.hero');
const mobileMQ = matchMedia('(max-width: 760px)');

// ---------- type fitting ----------
function fitGiant() {
  document.querySelectorAll('.giant [data-fit]').forEach((el) => {
    if (!el.offsetParent && getComputedStyle(el).display === 'none') return;
    const parent = el.parentElement;
    if (getComputedStyle(parent).display === 'none') return;
    const avail = parent.clientWidth;
    el.style.fontSize = '100px';
    const prev = el.style.display;
    el.style.display = 'inline-block';
    const w = el.getBoundingClientRect().width;
    el.style.display = prev;
    if (w > 0 && avail > 0) el.style.fontSize = `${(100 * avail) / w}px`;
  });
}
fitGiant();
document.fonts?.ready.then(fitGiant);
addEventListener('resize', fitGiant);

// ---------- scroll ----------
let unit = probe.offsetHeight || innerHeight;
let lenis = null;
if (MOTION && !TEST) {
  lenis = new Lenis({ lerp: 0.085, smoothWheel: true, wheelMultiplier: 0.9, syncTouch: false, autoRaf: false });
}
function scrollToY(y) {
  if (lenis) lenis.scrollTo(y, { duration: 1.8 });
  else window.scrollTo({ top: y, behavior: MOTION ? 'smooth' : 'auto' });
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#"]');
  if (!a) return;
  const id = a.getAttribute('href');
  if (id === '#main') return;
  const el = id === '#top' ? null : document.querySelector(id);
  if (id !== '#top' && !el) return;
  e.preventDefault();
  scrollToY(id === '#top' ? 0 : el.getBoundingClientRect().top + window.scrollY);
  try { history.replaceState(null, '', id); } catch (err) { /* sandboxed frame */ }
});

// ---------- DOM choreography (runs with or without WebGL) ----------
let lastDom = '';
function updateDOM(T) {
  const mobile = mobileMQ.matches;
  let side = 0;
  svcEls.forEach((el, i) => {
    const s = serviceState(i, T);
    side = Math.max(side, s.text);
    const y = MOTION ? -s.u * (mobile ? 50 : 90) : 0;
    el.style.opacity = s.text.toFixed(3);
    el.style.transform = mobile ? `translate3d(0, ${y.toFixed(1)}px, 0)` : `translate3d(0, calc(-50% + ${y.toFixed(1)}px), 0)`;
  });
  const heroFade = 1 - Math.min(1, Math.max(0, (T - 0.22) / 0.42));
  heroEl.style.opacity = heroFade.toFixed(3);
  const bottom = 1 - 0.6 * Math.min(1, Math.max(0, T - 0.35) / 0.6) + 0.6 * Math.min(1, Math.max(0, T - 3.3) / 0.6);
  const key = `${side.toFixed(3)}|${bottom.toFixed(3)}`;
  if (key !== lastDom) {
    html.style.setProperty('--veil-side', side.toFixed(3));
    html.style.setProperty('--veil-bottom', bottom.toFixed(3));
    lastDom = key;
  }
}

function fallback(reason) {
  html.classList.add('no-gl');
  html.dataset.fallback = reason;
  const loop = () => {
    lenis?.raf(performance.now());
    updateDOM(window.scrollY / unit);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// ---------- grain + corner haze (perceptual space, after tone mapping) ----------
class GrainEffect extends Effect {
  constructor({ amount = 0.03, haze = 1 } = {}) {
    super('GrainEffect', /* glsl */ `
      uniform float uAmount;
      uniform float uHaze;
      float gh(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){
        vec3 s = pow(max(inputColor.rgb, vec3(0.0)), vec3(1.0 / 2.2));
        float n = gh(floor(uv * resolution) + floor(fract(time * 24.0) * 97.0)) - 0.5;
        s += n * uAmount;
        vec2 q = (uv - vec2(0.0, 1.0)) * vec2(aspect, 1.0);
        s += vec3(0.008, 0.030, 0.055) * uHaze * smoothstep(1.15, 0.0, length(q));
        vec2 q2 = (uv - vec2(1.0, 0.0)) * vec2(aspect, 1.0);
        s += vec3(0.0, 0.016, 0.045) * uHaze * smoothstep(1.0, 0.0, length(q2));
        outputColor = vec4(pow(max(s, vec3(0.0)), vec3(2.2)), inputColor.a);
      }
    `, {
      uniforms: new Map([['uAmount', new THREE.Uniform(amount)], ['uHaze', new THREE.Uniform(haze)]]),
    });
  }
}

const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));

async function boot() {
  const q = detectQuality(params);
  if (params.has('nogl')) return fallback('forced');
  if (!q.ok) return fallback(q.reason);
  if (q.software && !TEST && !params.has('force')) return fallback('software-renderer');

  const canvas = document.getElementById('gl');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: false, stencil: false, depth: true,
      powerPreference: 'high-performance', preserveDrawingBuffer: TEST,
    });
  } catch (e) {
    return fallback('renderer-failed');
  }
  renderer.setClearColor(0x000000, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;

  const halfFloat = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
  const bufferType = halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(fogUniforms.uFogColor.value.getHex(), fogUniforms.uFogDensity.value);
  scene.background = fogUniforms.uFogColor.value.clone();
  scene.environment = buildEnvironment(renderer);

  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 420);
  camera.layers.enable(1);

  // canvas textures need the fonts
  await Promise.race([
    Promise.all([
      document.fonts.load('800 100px "Archivo HR"'),
      document.fonts.load('500 20px "Plex Mono HR"'),
    ]),
    new Promise((r) => setTimeout(r, 2500)),
  ]).catch(() => {});

  setAccent(ACCENT ? ACCENT.css : null);
  const arena = buildArena({ quality: q, renderer, accent: ACCENT });
  scene.add(arena.root);

  const SW = 4.8;
  const SH = 2.7;
  const screenGeo = new THREE.PlaneGeometry(SW, SH, 48, 27);
  const screens = [0, 1, 2].map((k) => {
    const mat = screenMaterial(makeScreenTexture(k), SW, SH);
    const mesh = new THREE.Mesh(screenGeo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 8;
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, mat, W: SW, H: SH, bend: 0 };
  });

  const reflection = createReflection(renderer, { type: bufferType });
  const floorU = arena.floor.material.uniforms;
  floorU.uTexMatrix.value = reflection.textureMatrix;

  const composer = new EffectComposer(renderer, { frameBufferType: bufferType, multisampling: q.msaa });
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 1.0, luminanceSmoothing: 0.3, intensity: 0.7, radius: 0.56, levels: 7 });
  const toneMode = params.get('tone') === 'agx' ? ToneMappingMode.AGX : ToneMappingMode.ACES_FILMIC;
  const tone = new ToneMappingEffect({ mode: toneMode });
  const vignette = new VignetteEffect({ offset: 0.3, darkness: 0.62 });
  const ca = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0006, 0.0004), radialModulation: true, modulationOffset: 0.22 });
  const grain = new GrainEffect({ amount: 0.028, haze: 1 });
  const effects = q.tier >= 2 ? [ca, bloom, tone, vignette, grain] : [bloom, tone, vignette, grain];
  const effectPass = new EffectPass(camera, ...effects);
  effectPass.dithering = true;
  composer.addPass(effectPass);

  // ---------- sizing ----------
  let viewH = innerHeight;
  let lastW = 0;
  let lastH = 0;
  const gov = new Governor(() => resize(true));
  function resize(force = false) {
    unit = probe.offsetHeight || innerHeight;
    const w = canvas.clientWidth || innerWidth;
    const h = canvas.clientHeight || innerHeight;
    if (!force && w === lastW && Math.abs(h - lastH) < 2) return;
    lastW = w;
    lastH = h;
    const dpr = q.dpr * gov.current.res;
    renderer.setPixelRatio(dpr);
    composer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    reflection.setSize(w * dpr, h * dpr, q.refl * gov.current.refl);
    floorU.tRefl.value = reflection.sharp;
    floorU.tReflBlur.value = reflection.blurred;
    viewH = h * dpr;
  }
  resize(true);
  addEventListener('resize', () => resize());

  // ---------- pointer ----------
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  if (matchMedia('(pointer: fine)').matches && MOTION) {
    addEventListener('pointermove', (e) => {
      pointer.tx = (e.clientX / innerWidth) * 2 - 1;
      pointer.ty = (e.clientY / innerHeight) * 2 - 1;
    }, { passive: true });
  }

  // ---------- frame ----------
  let camT = window.scrollY / unit;
  let prevT = camT;
  let velocity = 0;
  let startTime = null;

  function renderFrame({ T, time, elapsed, dt }) {
    const mobile = camera.aspect < 0.9 || mobileMQ.matches;
    const power = powerAt(elapsed, !MOTION);
    pointer.x = damp(pointer.x, pointer.tx, 2.5, dt);
    pointer.y = damp(pointer.y, pointer.ty, 2.5, dt);
    const focusDist = placeCamera(camera, MOTION ? T : 0, { mobile, time, pointer, motion: MOTION });
    camera.updateMatrixWorld();
    screens.forEach((s, i) => placeScreen(s, i, T, camera, { mobile, velocity, time, motion: MOTION }));
    let screenFocus = 0;
    for (let i = 0; i < 3; i++) screenFocus = Math.max(screenFocus, serviceState(i, T).focus);
    power.screenFocus = screenFocus;
    arena.update({ time, power, motion: MOTION ? 1 : 0, camera, viewHeight: viewH });
    arena.anim.dust.material.uniforms.uFocus.value = focusDist;
    arena.anim.dust.material.uniforms.uAperture.value = (mobile ? 26 : 38) * (viewH / 1000);
    scene.updateMatrixWorld();
    reflection.update(scene, camera, arena.floor);
    composer.render(dt);
  }

  let raf = 0;
  let last = performance.now();
  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dtMs = now - last;
    last = now;
    const dt = Math.min(0.1, Math.max(0.001, dtMs / 1000));
    lenis?.raf(now);
    if (startTime === null) startTime = now;
    const targetT = window.scrollY / unit;
    camT = MOTION ? damp(camT, targetT, 5.0, dt) : targetT;
    velocity = damp(velocity, (camT - prevT) / dt, 8, dt);
    prevT = camT;
    renderFrame({ T: camT, time: now / 1000, elapsed: (now - startTime) / 1000, dt });
    updateDOM(camT);
    gov.sample(dtMs, now);
  }

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    cancelAnimationFrame(raf);
    html.classList.remove('gl-ready');
    fallback('context-lost');
  });
  document.addEventListener('visibilitychange', () => {
    if (TEST) return;
    if (document.hidden) cancelAnimationFrame(raf);
    else { last = performance.now(); raf = requestAnimationFrame(loop); }
  });

  // compile everything before the first visible frame so the power-up doesn't stutter
  screens.forEach((s) => { s.mesh.visible = true; });
  placeCamera(camera, 0, { mobile: camera.aspect < 0.9 || mobileMQ.matches, time: 0, pointer, motion: MOTION });
  camera.updateMatrixWorld();
  try { await renderer.compileAsync(scene, camera); } catch (e) { /* compile lazily */ }
  screens.forEach((s) => { s.mesh.visible = false; });

  if (TEST) {
    html.classList.add('gl-ready', 'test');
    window.__hr = {
      quality: q,
      renderAt({ T = 0, time = 12, elapsed = 12, frames = 2, vel = 0 } = {}) {
        velocity = vel;
        for (let i = 0; i < frames; i++) renderFrame({ T, time: time + i / 60, elapsed: elapsed + i / 60, dt: 1 / 60 });
        updateDOM(T);
        return true;
      },
    };
    window.__hrReady = true;
    return;
  }
  html.classList.add('gl-ready');
  raf = requestAnimationFrame(loop);
}

boot().catch((e) => {
  console.error(e);
  fallback('boot-error');
});
