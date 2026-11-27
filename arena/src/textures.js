// Canvas-drawn content for the arena's LED surfaces and the broadcast screens.
// Everything here is graphic placeholder content: no logos, clients or results.
import * as THREE from 'three';

export const DISPLAY = '"Archivo HR", "Archivo", "Arial Black", system-ui, sans-serif';
export const MONO = '"Plex Mono HR", ui-monospace, "SFMono-Regular", Menlo, monospace';

const WHITE = '#eef4ff';
const BLUE = '#2f7dff';
const BLUE_HI = '#8cc6ff';
const DEEP = '#0a2a80';
let ACCENT = BLUE;
let ACCENT_HI = BLUE_HI;
// Second colour for rank insignia and highlight moments (null = blue only).
export function setAccent(css) {
  ACCENT = css || BLUE;
  ACCENT_HI = css || BLUE_HI;
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function font(ctx, weight, size, family, stretch = 'normal') {
  ctx.font = `${weight} ${size}px ${family}`;
  if ('fontStretch' in ctx) ctx.fontStretch = stretch;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
}

function spacing(ctx, px) {
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`;
}

function finish(c, { wrap = false, mipmaps = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = mipmaps;
  t.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 8;
  if (wrap) t.wrapS = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

// Rank insignia: stacked chevrons pointing up. Filled bands, apex at top.
export function drawChevrons(ctx, x, y, w, h, n, color, thickness = 0.28) {
  ctx.fillStyle = color;
  const step = h / (n + 0.6);
  const th = step * thickness * 2.2;
  const rise = w * 0.42;
  for (let i = 0; i < n; i++) {
    const apex = y + i * step;
    ctx.beginPath();
    ctx.moveTo(x, apex + rise);
    ctx.lineTo(x + w / 2, apex);
    ctx.lineTo(x + w, apex + rise);
    ctx.lineTo(x + w, apex + rise + th);
    ctx.lineTo(x + w / 2, apex + th);
    ctx.lineTo(x, apex + rise + th);
    ctx.closePath();
    ctx.fill();
  }
}

function fitText(ctx, text, maxWidth, weight, maxSize, family, stretch) {
  let size = maxSize;
  font(ctx, weight, size, family, stretch);
  const w = ctx.measureText(text).width;
  if (w > maxWidth) {
    size = Math.floor(size * (maxWidth / w));
    font(ctx, weight, size, family, stretch);
  }
  return size;
}

// Halo main ring: four "pages" wrapping 360 degrees.
export function makeHaloTexture() {
  const W = 4096;
  const H = 288;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  const page = W / 4;

  const wordmark = (x0) => {
    drawChevrons(g, x0 + 54, 62, 120, 170, 3, ACCENT, 0.3);
    g.fillStyle = WHITE;
    g.textBaseline = 'middle';
    fitText(g, 'HIGHER RANK', page - 290, 800, 150, DISPLAY, 'expanded');
    g.fillText('HIGHER RANK', x0 + 230, H * 0.5 + 6);
    g.fillStyle = BLUE;
    g.fillRect(x0 + 232, H - 46, page - 300, 6);
  };

  // word + caption on the left, leaving ~300px on the right for a graphic
  const bigWord = (x0, word, sub) => {
    g.textBaseline = 'middle';
    g.fillStyle = WHITE;
    fitText(g, word, page - 360, 800, 150, DISPLAY, 'expanded');
    g.fillText(word, x0 + 60, H * 0.5 - 14);
    font(g, 500, 28, MONO);
    spacing(g, 6);
    let size = 28;
    while (g.measureText(sub).width > page - 380 && size > 14) {
      size -= 1;
      font(g, 500, size, MONO);
      spacing(g, Math.round(size * 0.22));
    }
    g.fillStyle = BLUE_HI;
    g.fillText(sub, x0 + 64, H - 44);
    spacing(g, 0);
  };

  // Page 1: wordmark
  wordmark(0);

  // Page 2: LIVE EVENTS + equaliser-style bars
  bigWord(page, 'LIVE EVENTS', 'PRODUCE  /  PROMOTE  /  PARTNER');
  for (let i = 0; i < 18; i++) {
    const bh = 30 + Math.abs(Math.sin(i * 0.7) * 120) + (i % 3) * 14;
    g.fillStyle = i % 4 === 0 ? ACCENT_HI : BLUE;
    g.fillRect(page * 2 - 230 + i * 11, H - 40 - bh, 6, bh);
  }

  // Page 3: wordmark again so it reads from most angles
  wordmark(page * 2);

  // Page 4: ESPORTS + bracket lines
  bigWord(page * 3, 'ESPORTS', 'PRODUCED  &  SPONSORED');
  g.strokeStyle = BLUE;
  g.lineWidth = 5;
  const bx = page * 4 - 250;
  for (let i = 0; i < 4; i++) {
    const y1 = 46 + i * 56;
    g.beginPath();
    g.moveTo(bx, y1);
    g.lineTo(bx + 60, y1);
    g.lineTo(bx + 60, y1 + 28);
    g.lineTo(bx + 110, y1 + 28);
    g.stroke();
  }
  g.beginPath();
  g.moveTo(bx + 110, 74);
  g.lineTo(bx + 110, 186);
  g.moveTo(bx + 110, 130);
  g.lineTo(bx + 190, 130);
  g.stroke();
  g.fillStyle = ACCENT_HI;
  g.fillRect(bx + 186, 118, 24, 24);

  return finish(c, { wrap: true, mipmaps: true });
}

// Seamless scrolling ticker band.
export function makeTickerTexture({ items, height = 96, fg = BLUE_HI, accent = null, bg = '#000', band = null, width = 4096 }) {
  accent = accent || ACCENT;
  const c = makeCanvas(width, height);
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, width, height);
  const size = Math.round(height * 0.56);
  font(g, 700, size, DISPLAY, 'expanded');
  spacing(g, Math.round(size * 0.06));
  const gap = size * 1.5;
  const widths = items.map((t) => g.measureText(t).width);
  const unit = widths.reduce((a, b) => a + b, 0) + gap * items.length;
  const reps = Math.max(1, Math.round(width / unit));
  const sx = width / (unit * reps);
  g.save();
  g.scale(sx, 1);
  g.textBaseline = 'middle';
  let x = gap * 0.5;
  for (let r = 0; r < reps; r++) {
    items.forEach((t, i) => {
      if (band && i % 2 === 1) {
        g.fillStyle = band;
        g.fillRect(x - gap * 0.25, 0, widths[i] + gap * 0.5, height);
      }
      g.fillStyle = i === 0 ? '#ffffff' : fg;
      g.fillText(t, x, height * 0.53);
      x += widths[i];
      // chevron separator
      const cs = size * 0.55;
      drawChevrons(g, x + gap * 0.5 - cs * 0.5, height * 0.5 - cs * 0.55, cs, cs * 1.05, 2, accent, 0.3);
      x += gap;
    });
  }
  g.restore();
  return finish(c, { wrap: true, mipmaps: true });
}

// Underside of the halo: a dial with the rank insignia at its centre.
export function makeUndersideTexture() {
  const S = 1024;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  const cx = S / 2;
  const cy = S / 2;
  const grad = g.createRadialGradient(cx, cy, 40, cx, cy, S * 0.5);
  grad.addColorStop(0, '#0d2a6e');
  grad.addColorStop(0.55, '#06142f');
  grad.addColorStop(1, '#000');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  g.strokeStyle = BLUE;
  for (const [r, w] of [[470, 10], [405, 3], [300, 6], [190, 3]]) {
    g.strokeStyle = r === 470 ? ACCENT : BLUE;
    g.lineWidth = w;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.stroke();
  }
  g.strokeStyle = BLUE_HI;
  g.lineWidth = 4;
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const r0 = i % 6 === 0 ? 410 : 428;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    g.lineTo(cx + Math.cos(a) * 455, cy + Math.sin(a) * 455);
    g.stroke();
  }
  drawChevrons(g, cx - 150, cy - 170, 300, 340, 3, WHITE, 0.3);
  return finish(c, { mipmaps: true });
}

// Small monitor content for the players' desks.
export function makeMonitorTexture() {
  const W = 512;
  const H = 288;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#0b1f4d');
  grad.addColorStop(1, '#02060f');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#2f7dff';
  g.fillRect(0, H - 30, W, 30);
  g.fillStyle = '#8cc6ff';
  for (let i = 0; i < 6; i++) g.fillRect(24 + i * 34, H - 22, 24, 14);
  g.strokeStyle = 'rgba(140,198,255,0.6)';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(W / 2, H / 2 - 12, 22, 0, Math.PI * 2);
  g.moveTo(W / 2 - 40, H / 2 - 12);
  g.lineTo(W / 2 + 40, H / 2 - 12);
  g.moveTo(W / 2, H / 2 - 52);
  g.lineTo(W / 2, H / 2 + 28);
  g.stroke();
  return finish(c, { mipmaps: true });
}

// Broadcast screens for the three services. Each carries a clear placeholder label.
export function makeScreenTexture(kind) {
  const W = 1280;
  const H = 720;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');

  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#061433');
  bg.addColorStop(0.6, '#020815');
  bg.addColorStop(1, '#00030a');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  // fine grid
  g.strokeStyle = 'rgba(80,140,255,0.08)';
  g.lineWidth = 1;
  for (let x = 0; x <= W; x += 40) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); g.stroke(); }
  for (let y = 0; y <= H; y += 40) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); g.stroke(); }

  // corner brackets
  g.strokeStyle = BLUE_HI;
  g.lineWidth = 4;
  const m = 34;
  const L = 46;
  for (const [x, y, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) {
    g.beginPath();
    g.moveTo(x, y + sy * L);
    g.lineTo(x, y);
    g.lineTo(x + sx * L, y);
    g.stroke();
  }

  // placeholder tag
  font(g, 500, 22, MONO);
  spacing(g, 5);
  g.fillStyle = BLUE_HI;
  g.textBaseline = 'alphabetic';
  g.fillText('PLACEHOLDER  —  PROJECT FOOTAGE GOES HERE', 74, 96);
  spacing(g, 0);

  g.lineCap = 'round';
  g.lineJoin = 'round';

  if (kind === 0) {
    // Web design: a browser wireframe being laid out.
    const x = 520;
    const y = 150;
    const w = 660;
    const h = 420;
    g.fillStyle = 'rgba(20,50,120,0.55)';
    g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(140,198,255,0.85)';
    g.fillRect(x, y, w, 34);
    g.fillStyle = '#061433';
    for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(x + 22 + i * 22, y + 17, 6, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = 'rgba(47,125,255,0.9)';
    g.fillRect(x + 30, y + 70, w * 0.55, 54);
    g.fillStyle = 'rgba(140,198,255,0.55)';
    g.fillRect(x + 30, y + 140, w * 0.42, 14);
    g.fillRect(x + 30, y + 164, w * 0.36, 14);
    g.fillStyle = 'rgba(47,125,255,0.35)';
    for (let i = 0; i < 3; i++) g.fillRect(x + 30 + i * 204, y + 220, 184, 160);
    g.fillStyle = WHITE;
    g.beginPath();
    g.moveTo(x + 420, y + 300);
    g.lineTo(x + 420, y + 344);
    g.lineTo(x + 432, y + 332);
    g.lineTo(x + 446, y + 358);
    g.lineTo(x + 454, y + 354);
    g.lineTo(x + 440, y + 328);
    g.lineTo(x + 456, y + 326);
    g.closePath();
    g.fill();
  } else if (kind === 1) {
    // Marketing: reach graph with bars and a rising line.
    const x0 = 500;
    const y0 = 590;
    for (let i = 0; i < 12; i++) {
      const hgt = 40 + i * 24 + Math.sin(i * 1.3) * 26;
      g.fillStyle = i > 8 ? 'rgba(140,198,255,0.9)' : 'rgba(47,125,255,0.55)';
      g.fillRect(x0 + i * 56, y0 - hgt, 34, hgt);
    }
    g.strokeStyle = WHITE;
    g.lineWidth = 6;
    g.beginPath();
    for (let i = 0; i < 12; i++) {
      const px = x0 + 17 + i * 56;
      const py = y0 - 90 - i * 30 - Math.sin(i * 0.9) * 30;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.stroke();
    g.fillStyle = BLUE_HI;
    g.beginPath();
    g.arc(x0 + 17 + 11 * 56, y0 - 90 - 11 * 30 - Math.sin(11 * 0.9) * 30, 13, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(140,198,255,0.35)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x0 - 20, y0 + 1);
    g.lineTo(x0 + 680, y0 + 1);
    g.stroke();
  } else {
    // Events & esports: an eight-team bracket.
    g.strokeStyle = 'rgba(140,198,255,0.9)';
    g.lineWidth = 5;
    const x = 520;
    const top = 140;
    const rowH = 50;
    const colW = 150;
    const slot = (col, i) => top + (rowH * Math.pow(2, col)) * (i + 0.5);
    for (let col = 0; col < 3; col++) {
      const n = 8 / Math.pow(2, col);
      for (let i = 0; i < n; i++) {
        const y = slot(col, i);
        g.fillStyle = col === 0 ? 'rgba(47,125,255,0.45)' : 'rgba(47,125,255,0.7)';
        g.fillRect(x + col * colW, y - 16, 110, 32);
        if (i % 2 === 0) {
          const y2 = slot(col, i + 1);
          g.beginPath();
          g.moveTo(x + col * colW + 110, y);
          g.lineTo(x + col * colW + 130, y);
          g.lineTo(x + col * colW + 130, y2);
          g.lineTo(x + col * colW + 110, y2);
          g.moveTo(x + col * colW + 130, (y + y2) / 2);
          g.lineTo(x + (col + 1) * colW, (y + y2) / 2);
          g.stroke();
        }
      }
    }
    const fy = slot(3, 0);
    g.fillStyle = WHITE;
    g.fillRect(x + 3 * colW, fy - 20, 130, 40);
    drawChevrons(g, x + 3 * colW + 160, fy - 46, 70, 92, 3, BLUE_HI, 0.3);
  }

  // lower third
  const title = ['WEB DESIGN', 'MARKETING', 'LIVE EVENTS & ESPORTS'][kind];
  g.fillStyle = 'rgba(0,4,14,0.75)';
  g.fillRect(0, H - 150, W, 150);
  g.fillStyle = ACCENT;
  g.fillRect(74, H - 112, 10, 74);
  g.fillStyle = WHITE;
  g.textBaseline = 'middle';
  fitText(g, title, W - 220, 800, 64, DISPLAY, 'expanded');
  g.fillText(title, 108, H - 74);

  return finish(c, { mipmaps: true });
}
