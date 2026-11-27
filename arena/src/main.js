import './style.css';
import * as THREE from 'three';
import Lenis from 'lenis';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode,
  VignetteEffect, ChromaticAberrationEffect, Effect, EffectAttribute, BlendFunction,
  SMAAEffect, SMAAPreset,
} from 'postprocessing';
import { buildArena, buildEnvironment } from './arena.js';
import { fogUniforms } from './materials.js';
import { GlassPass, paneGeometry, glassMaterial } from './glass.js';
import { makeScreenTexture, setAccent } from './textures.js';
import { placeCamera, powerAt, placeScreen, serviceState } from './choreography.js';
import { detectQuality, Governor } from './quality.js';
import { createReflection } from './reflection.js';

const params = new URLSearchParams(location.search);
const TEST = params.has('test');
if (params.has('poster')) document.documentElement.classList.add('posterize');
const REDUCED = params.has('reduced') || (matchMedia('(prefers-reduced-motion: reduce)').matches && !params.has('motion'));
const MOTION = !REDUCED;
// Second colour: ultraviolet #9d00ff by default (owner's pick, option H, 2026-11-27). Compare others with
// ?accent=name or, inside the artifact viewer, #name (e.g. #purple). #blue = blue only.
const ACCENTS = {
  magenta: { hex: 0xff3d9a, css: '#ff3d9a' },
  purple: { hex: 0xc04bff, css: '#c04bff' },
  electric: { hex: 0xb41fff, css: '#b41fff' },
  ultraviolet: { hex: 0x9d00ff, css: '#9d00ff' },
  hot: { hex: 0xcc00ff, css: '#cc00ff' },
  violet: { hex: 0x8f5bff, css: '#8f5bff' },
  gold: { hex: 0xffb547, css: '#ffb547' },
  aqua: { hex: 0x2ff3d2, css: '#2ff3d2' },
  blue: null,
};
const accentKey = [params.get('accent'), location.hash.slice(1)].find((k) => k && k in ACCENTS) || 'ultraviolet';
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

// Contrast-adaptive sharpening after tone mapping: crisp fine lines without halos.
class SharpenEffect extends Effect {
  constructor({ amount = 0.55 } = {}) {
    super('SharpenEffect', /* glsl */ `
      uniform float uSharp;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){
        vec3 c = inputColor.rgb;
        vec3 a = texture2D(inputBuffer, uv + vec2(-texelSize.x, 0.0)).rgb;
        vec3 b = texture2D(inputBuffer, uv + vec2(0.0, -texelSize.y)).rgb;
        vec3 d = texture2D(inputBuffer, uv + vec2(texelSize.x, 0.0)).rgb;
        vec3 e = texture2D(inputBuffer, uv + vec2(0.0, texelSize.y)).rgb;
        vec3 mn = min(min(min(a, b), min(d, e)), c);
        vec3 mx = max(max(max(a, b), max(d, e)), c);
        vec3 amp = sqrt(clamp(min(mn, 2.0 - mx) / max(mx, vec3(1e-4)), 0.0, 1.0));
        vec3 w = amp * (-1.0 / mix(8.0, 5.0, uSharp));
        vec3 res = (c + (a + b + d + e) * w) / (1.0 + 4.0 * w);
        outputColor = vec4(max(res, vec3(0.0)), inputColor.a);
      }
    `, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map([['uSharp', new THREE.Uniform(amount)]]),
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
  // glass panes live in their own scene, drawn by the glass pass over a frosted copy of the frame
  const glassScene = new THREE.Scene();
  const glassPass = new GlassPass(glassScene, camera, { type: bufferType });
  const paneGeo = paneGeometry(SW, SH, 0.035, 0.16);
  const screens = [0, 1, 2].map((k) => {
    const mat = glassMaterial({
      map: makeScreenTexture(k), W: SW, H: SH, r: 0.035, corner: 0.16,
      accent: ACCENT ? ACCENT.hex : 0x2f6dff, shared: glassPass.uniforms,
    });
    const mesh = new THREE.Mesh(paneGeo, mat);
    mesh.frustumCulled = false;
    mesh.visible = false;
    glassScene.add(mesh);
    return { mesh, mat, W: SW, H: SH, spring: null };
  });

  const reflection = createReflection(renderer, { type: bufferType });
  const floorU = arena.floor.material.uniforms;
  // light profile: cheaper beams, haze and floor; heavy see-through layers skip the reflection
  let reflFrame = 0;
  const reflHide = [...arena.anim.beams.map((b) => b.beam), arena.anim.pedestalBeam, arena.anim.flares, arena.anim.crowd, ...arena.anim.hazes.map((h) => h.mesh)];
  if (q.cheap) {
    arena.anim.beams.forEach((b) => { b.beam.material.uniforms.uCheap.value = 1; });
    arena.anim.pedestalBeam.material.uniforms.uCheap.value = 1;
    arena.anim.hazes.forEach((h) => { h.mesh.material.uniforms.uCheap.value = 1; });
    floorU.uCheap.value = 1;
  }
  floorU.uTexMatrix.value = reflection.textureMatrix;

  const composer = new EffectComposer(renderer, { frameBufferType: bufferType, multisampling: q.msaa });
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(glassPass);
  // Diagnostics via the URL hash (the only part of the URL the artifact host passes through), e.g.
  // #crack-nosmaa. crack: frame behind the glass in magenta; nosmaa / nosharp: drop those passes;
  // noenv / nosheen / noedge / noback: switch off one glass term.
  const DIAG = new Set(location.hash.slice(1).split(/[-+_,]/));
  if (DIAG.has('crack')) glassPass.copy.material.uniforms.uDebug.value = 1;
  screens.forEach((sc) => {
    sc.mat.uniforms.uKill.value.set(+DIAG.has('noenv'), +DIAG.has('nosheen'), +DIAG.has('noedge'), +DIAG.has('noback'));
  });
  const bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 1.0, luminanceSmoothing: 0.3, intensity: 0.7, radius: 0.56, levels: 7, resolutionScale: q.bloomScale });
  const toneMode = params.get('tone') === 'agx' ? ToneMappingMode.AGX : ToneMappingMode.ACES_FILMIC;
  const tone = new ToneMappingEffect({ mode: toneMode });
  const vignette = new VignetteEffect({ offset: 0.3, darkness: 0.62 });
  const ca = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.00022, 0.00014), radialModulation: true, modulationOffset: 0.45 });
  const grain = new GrainEffect({ amount: 0.02, haze: 1 });
  const sharpen = new SharpenEffect({ amount: q.mobile ? 0.35 : 0.6 });
  const effects = q.tier >= 2 && q.profile === 'full' ? [ca, bloom, tone, vignette] : [bloom, tone, vignette];
  const mainPass = new EffectPass(camera, ...effects);
  composer.addPass(mainPass);
  if (q.smaa && !DIAG.has('nosmaa')) composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.MEDIUM })));
  const finishPass = DIAG.has('nosharp') ? new EffectPass(camera, grain) : new EffectPass(camera, sharpen, grain);
  finishPass.dithering = true;
  composer.addPass(finishPass);

  // ---------- sizing ----------
  let viewH = innerHeight;
  let lastW = 0;
  let lastH = 0;
  // Resizing the canvas clears it. Requests are applied at the start of the next frame, before it
  // renders, so a quality step or window resize never leaves an empty (black) frame on screen.
  let pendingResize = 0;
  const gov = new Governor(() => { pendingResize = 2; }, q.targetMs);
  // Feature switches (used by the weak-GPU profile and the #bench run).
  const features = { dpr: null, reflection: true };
  function resize(force = false) {
    unit = probe.offsetHeight || innerHeight;
    const w = canvas.clientWidth || innerWidth;
    const h = canvas.clientHeight || innerHeight;
    if (!force && w === lastW && Math.abs(h - lastH) < 2) return;
    lastW = w;
    lastH = h;
    const dpr = features.dpr ?? q.dpr * gov.current.res;
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
  addEventListener('resize', () => { pendingResize = Math.max(pendingResize, 1); });

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
    screens.forEach((s, i) => placeScreen(s, i, T, camera, { mobile, velocity, motion: MOTION, dt, snap: TEST }));
    glassPass.enabled = screens.some((s) => s.mesh.visible);
    let screenFocus = 0;
    for (let i = 0; i < 3; i++) screenFocus = Math.max(screenFocus, serviceState(i, T).focus);
    power.screenFocus = screenFocus;
    arena.update({ time, power, motion: MOTION ? 1 : 0, camera, viewHeight: viewH, pixelRatio: renderer.getPixelRatio() });
    arena.anim.dust.material.uniforms.uFocus.value = focusDist;
    arena.anim.dust.material.uniforms.uAperture.value = (mobile ? 26 : 38) * (viewH / 1000);
    scene.updateMatrixWorld();
    reflFrame++;
    if (features.reflection && (reflFrame % q.reflEvery === 0 || reflFrame < 3)) reflection.update(scene, camera, arena.floor, q.reflHide ? reflHide : []);
    composer.render(dt);
  }

  // #stats on the link (or ?stats) shows frame rate and render resolution for tuning.
  let statsEl = null;
  if (location.hash === '#stats' || DIAG.size > 1 || ['crack', 'nosmaa', 'nosharp', 'noenv', 'nosheen', 'noedge', 'noback'].some((k) => DIAG.has(k)) || params.has('stats')) {
    statsEl = document.createElement('div');
    statsEl.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:60;font:500 12px/1.4 ui-monospace,monospace;color:#cfe2ff;background:rgba(0,0,0,.72);padding:8px 10px;border-radius:8px;pointer-events:none;white-space:pre';
    document.body.appendChild(statsEl);
  }
  if (statsEl) window.__hrGov = gov;
  let fpsEma = 60;
  let statsAt = 0;
  function updateStats(dtMs, now) {
    if (!statsEl || dtMs <= 0) return;
    fpsEma = fpsEma * 0.94 + (1000 / dtMs) * 0.06;
    if (now - statsAt < 400) return;
    statsAt = now;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    statsEl.textContent = `${fpsEma.toFixed(0)} fps\n${size.x}x${size.y} (${renderer.getPixelRatio().toFixed(2)}x)\n${q.profile} · MSAA ${q.msaa}${q.smaa ? ' · SMAA' : ''} · step ${gov.step}\n${q.gpu.slice(0, 48)}\nbuild ${__BUILD__}`;
  }

  let raf = 0;
  let last = performance.now();
  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dtMs = now - last;
    last = now;
    const dt = Math.min(0.1, Math.max(0.001, dtMs / 1000));
    if (pendingResize) { const force = pendingResize === 2; pendingResize = 0; resize(force); }
    lenis?.raf(now);
    if (startTime === null) startTime = now;
    const targetT = window.scrollY / unit;
    camT = MOTION ? damp(camT, targetT, 5.0, dt) : targetT;
    velocity = damp(velocity, (camT - prevT) / dt, 8, dt);
    prevT = camT;
    renderFrame({ T: camT, time: now / 1000, elapsed: (now - startTime) / 1000, dt });
    updateDOM(camT);
    gov.sample(dtMs, now);
    updateStats(dtMs, now);
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
  screens.forEach((s) => { s.mesh.visible = true; });
  try { await renderer.compileAsync(glassScene, camera); } catch (e) { /* compile lazily */ }
  screens.forEach((s) => { s.mesh.visible = false; });

  if (TEST) {
    html.classList.add('gl-ready', 'test');
    window.__hr = {
      quality: q,
      screens,
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
  if (location.hash === '#bench') { runBench(); return; }
  raf = requestAnimationFrame(loop);

  // #bench: time each costly feature on this device and print a table on screen.
  function runBench() {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:60;font:500 13px/1.45 ui-monospace,monospace;color:#e6f0ff;background:rgba(0,0,0,.82);padding:10px 12px;border-radius:8px;white-space:pre;pointer-events:none';
    document.body.appendChild(box);
    const beamsOf = (kind) => arena.anim.beams.filter((b) => b.kind === kind);
    const setBeams = (kind, on) => beamsOf(kind).forEach((b) => { b.beam.visible = on; });
    const setCheap = (on) => {
      arena.anim.beams.forEach((b) => { b.beam.material.uniforms.uCheap.value = on ? 1 : 0; });
      arena.anim.hazes.forEach((h) => { h.mesh.material.uniforms.uCheap.value = on ? 1 : 0; });
      floorU.uCheap.value = on ? 1 : 0;
    };
    const setBloom = (on) => bloom.blendMode.setBlendFunction(on ? BlendFunction.ADD : BlendFunction.SKIP);
    const reset = () => {
      features.dpr = null; features.reflection = true; floorU.uReflPower.value = 1;
      setBeams('spot', true); setBeams('wash', true); setCheap(q.cheap); setBloom(true);
      composer.multisampling = q.msaa; arena.anim.crowd.visible = true; arena.anim.flares.visible = true;
    };
    const dpr1 = Math.min(1, q.dpr);
    const configs = [
      [`as shipped (${q.profile})`, () => {}],
      ['render 1.0x', () => { features.dpr = dpr1; }],
      ['1.0x, no reflection', () => { features.dpr = dpr1; features.reflection = false; floorU.uReflPower.value = 0; }],
      ['1.0x, no wash beams', () => { features.dpr = dpr1; setBeams('wash', false); }],
      ['1.0x, cheap beams', () => { features.dpr = dpr1; setCheap(true); }],
      ['1.0x, no beams', () => { features.dpr = dpr1; setBeams('spot', false); setBeams('wash', false); }],
      ['1.0x, no bloom', () => { features.dpr = dpr1; setBloom(false); }],
      ['1.0x, MSAA off', () => { features.dpr = dpr1; composer.multisampling = 0; }],
      ['1.0x, no crowd', () => { features.dpr = dpr1; arena.anim.crowd.visible = false; }],
      ['1.0x, all light', () => { features.dpr = dpr1; features.reflection = false; floorU.uReflPower.value = 0; setBeams('wash', false); setCheap(true); composer.multisampling = 0; }],
    ];
    const results = [];
    let ci = 0;
    let phase = 'warm';
    let count = 0;
    let acc = 0;
    let lastT = performance.now();
    let t0 = performance.now();
    const start = (i) => { reset(); configs[i][1](); resize(true); phase = 'warm'; count = 0; acc = 0; t0 = performance.now(); };
    const show = (extra = '') => {
      box.textContent = `bench · ${q.gpu.slice(0, 52)}\nviewport ${innerWidth}x${innerHeight}\n` +
        results.map((r) => `${r.ms.toFixed(1).padStart(6)} ms ${(1000 / r.ms).toFixed(0).padStart(4)} fps  ${r.name}`).join('\n') + extra;
    };
    start(0);
    const tick = (now) => {
      const dt = now - lastT;
      lastT = now;
      renderFrame({ T: 0, time: now / 1000, elapsed: 30, dt: Math.min(0.1, dt / 1000) });
      if (phase === 'warm') {
        if (now - t0 > 1200) { phase = 'measure'; t0 = now; count = 0; acc = 0; }
      } else {
        acc += dt; count++;
        if (now - t0 > 2500 && count >= 8) {
          results.push({ name: configs[ci][0], ms: acc / count });
          ci++;
          if (ci >= configs.length) { reset(); resize(true); show('\ndone'); return; }
          start(ci);
        }
      }
      show(`\n… ${configs[ci] ? configs[ci][0] : ''}`);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

boot().catch((e) => {
  console.error(e);
  fallback('boot-error');
});
