// Device tiers and a frame-time governor that trades resolution for smoothness.

const TIERS = {
  3: { tier: 3, dpr: 1.5, msaa: 4, refl: 0.5, crowd: 20000, dust: 380, spots: 16, washes: 12, realSpots: 3, trussSegs: 96 },
  2: { tier: 2, dpr: 1.25, msaa: 4, refl: 0.42, crowd: 14000, dust: 300, spots: 16, washes: 8, realSpots: 2, trussSegs: 80 },
  1: { tier: 1, dpr: 1.0, msaa: 0, refl: 0.32, crowd: 7000, dust: 180, spots: 12, washes: 0, realSpots: 1, trussSegs: 64 },
};

export function probeGPU() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return { webgl2: false, renderer: '' };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { webgl2: true, renderer: String(renderer || '') };
  } catch (e) {
    return { webgl2: false, renderer: '' };
  }
}

export function detectQuality(params) {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) < 820;
  const mobile = coarse && small;
  const gpu = probeGPU();
  if (!gpu.webgl2) return { ok: false, mobile, reason: 'no-webgl2' };
  const software = /swiftshader|llvmpipe|software|basic render|softpipe/i.test(gpu.renderer);
  const forced = params.get('q');
  let tier = mobile ? 2 : 3;
  if (forced === 'low') tier = 1;
  else if (forced === 'mid') tier = 2;
  else if (forced === 'high') tier = 3;
  const q = { ...TIERS[tier], mobile, software, gpu: gpu.renderer, ok: true };
  if (mobile) {
    q.dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    q.refl = 0.36;
    q.crowd = Math.min(q.crowd, 10000);
    q.dust = Math.min(q.dust, 240);
    q.msaa = 4;
  } else {
    // Desktop renders above native resolution where the pixel budget allows, so fine
    // lines (truss lacing, LED strips, rails) stay crisp; the governor backs off if slow.
    const dev = window.devicePixelRatio || 1;
    const want = tier === 3 ? Math.min(2, Math.max(dev, 1.5)) : tier === 2 ? Math.min(1.5, Math.max(dev, 1.25)) : 1;
    const budget = tier === 3 ? 5.2e6 : 3.4e6;
    const css = Math.max(1, innerWidth * innerHeight);
    q.dpr = Math.max(1, Math.min(want, Math.sqrt(budget / css)));
    q.msaa = q.dpr >= 1.45 ? 2 : q.msaa;
  }
  return q;
}

// Steps: resolution multiplier and reflection multiplier, lowest last.
const STEPS = [
  { res: 1.0, refl: 1.0 },
  { res: 0.86, refl: 0.85 },
  { res: 0.74, refl: 0.7 },
  { res: 0.62, refl: 0.55 },
  { res: 0.52, refl: 0.45 },
];

export class Governor {
  constructor(onChange) {
    this.onChange = onChange;
    this.step = 0;
    this.ema = 16.7;
    this.slow = 0;
    this.fast = 0;
    this.last = 0;
    this.frames = 0;
  }
  get current() { return STEPS[this.step]; }
  sample(dtMs, nowMs) {
    // The loop pauses while the tab is hidden, so long frames here are real: count them.
    if (dtMs <= 0) return;
    if (!this.start) this.start = nowMs;
    const d = Math.min(dtMs, 1500);
    this.frames++;
    // adapt faster while the estimate is young
    const k = this.frames < 20 ? 0.25 : 0.07;
    this.ema = this.ema * (1 - k) + d * k;
    const settled = this.frames >= 30 || (nowMs - this.start > 2500 && this.frames >= 4);
    if (!settled) return;
    if (this.ema > 21) { this.slow += Math.max(1, Math.round(d / 16.7)); this.fast = 0; } else if (this.ema < 13) { this.fast++; this.slow = 0; } else { this.slow = 0; this.fast = 0; }
    if (nowMs - this.last < 1500) return;
    if (this.slow > 45 && this.step < STEPS.length - 1) {
      // far too slow (under ~16 fps): skip a step
      this.step = Math.min(STEPS.length - 1, this.step + (this.ema > 60 ? 2 : 1));
      this.last = nowMs;
      this.slow = 0;
      this.onChange(STEPS[this.step]);
    } else if (this.fast > 600 && this.step > 0) {
      this.step--;
      this.last = nowMs;
      this.fast = 0;
      this.onChange(STEPS[this.step]);
    }
  }
}
