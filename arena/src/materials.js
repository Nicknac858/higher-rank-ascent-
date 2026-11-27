// Custom shader materials. All output linear HDR colour; tone mapping happens in post.
import * as THREE from 'three';
import { NOISE, FOG } from './glsl.js';

export const fogUniforms = {
  uFogColor: { value: new THREE.Color(0x010206) },
  uFogDensity: { value: 0.011 },
};

const VERT_BASIC = /* glsl */ `
varying vec2 vUv;
varying float vDist;
varying vec3 vWorld;
void main(){
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mv = viewMatrix * wp;
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

// LED wall: content sampled per LED cell and drawn as round diodes that blend to an
// even glow at distance (no moire). uBoot wipes the panel on with a flicker.
export function ledMaterial({ map, grid, intensity = 2.4, tint = 0xffffff, side = THREE.FrontSide, flip = false, dot = 0.36, planar = false, cab = [16, 16] }) {
  return new THREE.ShaderMaterial({
    side,
    uniforms: {
      map: { value: map },
      uGrid: { value: new THREE.Vector2(grid[0], grid[1]) },
      uTint: { value: new THREE.Color(tint) },
      uIntensity: { value: intensity },
      uOffset: { value: 0 },
      uRepeat: { value: 1 },
      uTime: { value: 0 },
      uBoot: { value: 0 },
      uFlip: { value: flip ? 1 : 0 },
      uDot: { value: dot },
      uCab: { value: new THREE.Vector2(cab[0], cab[1]) },
      uPlanar: { value: planar ? 1 : 0 },
      ...fogUniforms,
    },
    vertexShader: VERT_BASIC,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec2 uGrid;
      uniform vec3 uTint;
      uniform float uIntensity, uOffset, uRepeat, uTime, uBoot, uFlip, uDot, uPlanar;
      uniform vec2 uCab;
      varying vec2 vUv;
      varying float vDist;
      varying vec3 vWorld;
      ${NOISE}
      ${FOG}
      void main(){
        vec2 uv0 = vUv;
        if (uFlip > 0.5) uv0.x = 1.0 - uv0.x;
        // diodes stay fixed; content scrolls across them, stepping LED to LED like a real wall
        vec2 g = uv0 * uGrid;
        vec2 cell = floor(g);
        vec2 f = fract(g) - 0.5;
        vec2 cuv = (cell + 0.5) / uGrid;
        float px = length(fwidth(g));
        // each diode shows the average of the content under it (filtered over its footprint, like an LED
        // processor scaling video); once diodes are smaller than a pixel, sample the content continuously so
        // small type stays smooth instead of breaking into blocks
        vec2 suv = vec2(fract(cuv.x * uRepeat + uOffset), cuv.y);
        vec3 cDiode = textureGrad(map, suv, vec2(uRepeat / uGrid.x, 0.0), vec2(0.0, 1.0 / uGrid.y)).rgb;
        vec2 ucont = vec2(uv0.x * uRepeat + uOffset, uv0.y);
        vec3 cCont = textureGrad(map, vec2(fract(ucont.x), ucont.y), dFdx(ucont), dFdy(ucont)).rgb;
        vec3 c = mix(cDiode, cCont, smoothstep(0.45, 0.95, px));
        float d = length(f);
        float dotm = 1.0 - smoothstep(uDot - px * 0.7, uDot + px * 0.7, d);
        float cover = 3.14159 * uDot * uDot;
        float m = mix(dotm, cover, smoothstep(0.22, 0.65, px)) / cover;
        // cabinet seams between LED panels, fading out before they could shimmer
        vec2 cd = abs(fract(g / uCab + 0.5) - 0.5) * uCab;
        float seam = max(1.0 - smoothstep(0.1, 0.1 + px, cd.x), 1.0 - smoothstep(0.1, 0.1 + px, cd.y));
        seam *= 1.0 - smoothstep(0.3, 0.75, px);
        vec2 uv = cuv;
        // boot: top-down wipe with a stuttering scan
        float wipe = smoothstep(0.0, 0.06, uBoot * 1.12 - (1.0 - uv.y));
        float stutter = uBoot < 0.999 ? (0.45 + 0.55 * step(0.35, hash12(vec2(floor(uTime * 30.0), cell.y * 0.13)))) : 1.0;
        float scan = 0.92 + 0.08 * sin((uv.y * 2.0 - uTime * 0.35) * 6.2831);
        vec3 base = vec3(0.010, 0.012, 0.018) * dotm;
        vec3 col = (c * uTint * uIntensity * m * wipe * stutter * scan + base) * (1.0 - 0.9 * seam);
        gl_FragColor = vec4(applyFog(col, vDist), 1.0);
      }
    `,
  });
}

// Emissive LED strip with a chase reveal (uPower 0..1 lights it along u) and a slow pulse.
export function stripMaterial({ color = 0x2f7dff, intensity = 3.0, segments = 0, speed = 1.2, reveal = 'u' } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: intensity },
      uTime: { value: 0 },
      uPower: { value: 0 },
      uSegments: { value: segments },
      uSpeed: { value: speed },
      uRevealV: { value: reveal === 'v' ? 1 : 0 },
      ...fogUniforms,
    },
    vertexShader: VERT_BASIC,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity, uTime, uPower, uSegments, uSpeed, uRevealV;
      varying vec2 vUv;
      varying float vDist;
      ${FOG}
      void main(){
        float t = mix(vUv.x, vUv.y, uRevealV);
        float on = smoothstep(0.0, 0.015, uPower * 1.03 - t);
        float seg = uSegments > 0.0 ? 0.55 + 0.45 * smoothstep(0.2, 0.5, abs(fract(vUv.x * uSegments - uTime * uSpeed) - 0.5) * 2.0) : 1.0;
        float pulse = 0.88 + 0.12 * sin(uTime * 1.3 + vUv.x * 6.2831);
        vec3 col = uColor * uIntensity * on * seg * pulse;
        // fresh light flashes brighter right at the chase head
        col += uColor * uIntensity * 2.0 * smoothstep(0.03, 0.0, abs(uPower * 1.03 - t)) * step(uPower, 0.999);
        float fogK = 1.0 - fogFactor(vDist) * 0.85;
        gl_FragColor = vec4(col * fogK + uFogColor * (1.0 - fogK), 1.0);
      }
    `,
  });
}

// Volumetric beam: an open cone, apex at origin pointing down -Y, unit length.
export function beamMaterial(color) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: 0 },
      uTime: { value: 0 },
      uCheap: { value: 0 },
      ...fogUniforms,
    },
    vertexShader: /* glsl */ `
      varying float vAlong;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vWorld;
      varying float vDist;
      void main(){
        vAlong = -position.y;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mv = viewMatrix * wp;
        vV = -mv.xyz;
        vDist = -mv.z;
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity, uTime, uCheap;
      varying float vAlong;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vWorld;
      varying float vDist;
      ${NOISE}
      ${FOG}
      void main(){
        float facing = abs(dot(normalize(vN), normalize(vV)));
        float soft = pow(facing, 3.4);
        float a = clamp(vAlong, 0.0, 1.0);
        float fall = exp(-a * 1.6) * (0.25 + 0.75 * (1.0 - a));
        float tip = smoothstep(0.0, 0.025, a);
        float dust = 0.95;
        if (uCheap < 0.5) {
          vec3 dp = vWorld * vec3(0.20, 0.32, 0.20) + vec3(0.0, -uTime * 0.10, uTime * 0.04);
          dust = 0.45 + 1.0 * (0.62 * vnoise3(dp) + 0.38 * vnoise3(dp * 2.3 + 4.1));
        }
        float floorFade = smoothstep(0.05, 1.6, vWorld.y);
        float fogK = 1.0 - fogFactor(vDist) * 0.9;
        float k = soft * fall * tip * dust * floorFade * fogK * uIntensity;
        gl_FragColor = vec4(uColor * k, 1.0);
      }
    `,
  });
}

// Polished arena floor with blurred planar reflections, light pools and inlaid rings.
export const MAX_POOLS = 16;
export function floorMaterial() {
  const pools = [];
  const poolCols = [];
  for (let i = 0; i < MAX_POOLS; i++) {
    pools.push(new THREE.Vector4(0, -100, 0, 1));
    poolCols.push(new THREE.Vector3(0, 0, 0));
  }
  return new THREE.ShaderMaterial({
    uniforms: {
      tRefl: { value: null },
      tReflBlur: { value: null },
      uTexMatrix: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uRings: { value: 0 },
      uRingColor: { value: new THREE.Color(0x2f7dff) },
      uAccentColor: { value: new THREE.Color(0x2f7dff) },
      uReflPower: { value: 1 },
      uCheap: { value: 0 },
      uPools: { value: pools },
      uPoolCols: { value: poolCols },
      ...fogUniforms,
    },
    vertexShader: /* glsl */ `
      uniform mat4 uTexMatrix;
      varying vec4 vRefl;
      varying vec3 vWorld;
      varying float vDist;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vRefl = uTexMatrix * vec4(position, 1.0);
        vec4 mv = viewMatrix * wp;
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tRefl;
      uniform sampler2D tReflBlur;
      uniform vec3 uCamPos;
      uniform float uTime, uRings, uReflPower, uCheap;
      uniform vec3 uRingColor;
      uniform vec3 uAccentColor;
      uniform vec4 uPools[${MAX_POOLS}];
      uniform vec3 uPoolCols[${MAX_POOLS}];
      varying vec4 vRefl;
      varying vec3 vWorld;
      varying float vDist;
      ${NOISE}
      ${FOG}
      void main(){
        vec2 p = vWorld.xz;
        float r = length(p);
        float n1 = uCheap > 0.5 ? vnoise2(p * 0.3) : fbm2(p * 0.22);
        float n2 = vnoise2(p * 9.0);
        vec2 distort = uCheap > 0.5 ? (vec2(n1, vnoise2(p * 1.3 + 5.2)) - 0.5) * 0.01 : (vec2(fbm2(p * 1.3), fbm2(p * 1.3 + 5.2)) - 0.5) * 0.012;
        vec4 ruv = vRefl;
        ruv.xy += distort * ruv.w;
        vec3 sharp = texture2DProj(tRefl, ruv).rgb;
        vec3 blurred = texture2DProj(tReflBlur, ruv).rgb;
        float rough = smoothstep(0.3, 0.75, n1);
        vec3 refl = mix(sharp, blurred, clamp(0.55 + 0.42 * rough, 0.0, 1.0));
        vec3 V = normalize(uCamPos - vWorld);
        float ndv = clamp(V.y, 0.0, 1.0);
        float fres = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
        vec3 base = vec3(0.006, 0.008, 0.011) * (0.75 + 0.5 * n2);
        vec2 tile = abs(fract(p / 2.4) - 0.5);
        float seam = smoothstep(0.492, 0.5, max(tile.x, tile.y));
        base *= 1.0 - seam * 0.5;
        // the polished deck is strongest around the stage; out by the barrier it turns satin
        float deck = mix(0.28, 1.0, smoothstep(22.0, 13.0, r));
        refl = min(refl, vec3(1.6));
        vec3 col = base + refl * mix(0.32, 1.0, fres) * uReflPower * deck * (1.0 - seam * 0.35);
        for (int i = 0; i < ${MAX_POOLS}; i++){
          vec2 d = p - uPools[i].xz;
          float rr = uPools[i].w;
          float k = exp(-dot(d, d) / (rr * rr));
          col += uPoolCols[i] * k * (0.75 + 0.25 * n2);
        }
        float ang = atan(p.y, p.x) / 6.28318 + 0.5;
        float chase = smoothstep(0.0, 0.01, uRings * 1.02 - ang);
        float ring1 = 1.0 - smoothstep(0.025, 0.07, abs(r - 9.4));
        float ring2 = (1.0 - smoothstep(0.015, 0.05, abs(r - 12.4))) * step(0.45, fract(ang * 96.0));
        float ring3 = 1.0 - smoothstep(0.02, 0.06, abs(r - 25.9));
        col += (uRingColor * (ring1 * 3.2 + ring3 * 1.6) + uAccentColor * ring2 * 1.6) * chase;
        col += uRingColor * exp(-abs(r - 9.4) * 1.6) * 0.035 * uRings;
        gl_FragColor = vec4(applyFog(col, vDist), 1.0);
      }
    `,
  });
}

// Crowd lights on the bowl. Motion is built so it never reads as a loop: every person
// sways at their own tempo with a phase that wanders, whole sections get livelier and
// calmer on a slow noise field, phones come up and go down at random moments, wristbands
// follow a drifting show pattern, and beams sweeping the bowl light up whoever they touch.
export const CROWD_BEAMS = 4;
export function crowdMaterial() {
  const beams = [];
  const beamCols = [];
  for (let i = 0; i < CROWD_BEAMS; i++) {
    beams.push(new THREE.Vector4(0, -100, 0, 1));
    beamCols.push(new THREE.Vector3(0, 0, 0));
  }
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uPower: { value: 0 },
      uScale: { value: 600 },
      uWave: { value: 0 },
      uWaveOn: { value: 0 },
      uWaveWidth: { value: 30 },
      uWaveColor: { value: new THREE.Color(0x73b3ff) },
      uAccent: { value: new THREE.Color(0x4f8dff) },
      uBeams: { value: beams },
      uBeamCols: { value: beamCols },
      uMotion: { value: 1 },
      ...fogUniforms,
    },
    vertexShader: /* glsl */ `
      attribute vec4 aData;
      uniform float uTime, uPower, uScale, uWave, uWaveOn, uWaveWidth, uFogDensity, uMotion;
      uniform vec3 uWaveColor, uAccent;
      uniform vec4 uBeams[${CROWD_BEAMS}];
      uniform vec3 uBeamCols[${CROWD_BEAMS}];
      varying vec3 vColor;
      varying float vAlpha;
      ${NOISE}
      void main(){
        vec3 base = position;
        float r1 = aData.x;
        float r2 = hash13(base * 3.17 + 1.3);
        float r3 = hash13(base * 0.73 + 7.9);
        float ang = atan(base.x, base.z);
        float rad = max(length(base.xz), 0.001);
        float t = uTime * uMotion;

        float energy = smoothstep(0.15, 0.95, vnoise3(vec3(ang * 5.0, base.y * 0.12, t * 0.045 + 3.0)));
        float tempo = 1.6 + r2 * 2.2;
        float wander = vnoise3(vec3(r1 * 40.0, t * 0.07, r3 * 20.0)) * 5.0;
        float sway = sin(t * tempo + r1 * 6.2831 + wander);
        vec3 tang = vec3(base.z, 0.0, -base.x) / rad;
        vec3 p = base + tang * sway * (0.035 + 0.11 * energy) * uMotion;
        p.y += (0.5 + 0.5 * sin(t * tempo * 0.9 + r3 * 6.2831 + wander * 0.6)) * 0.05 * energy * uMotion;

        float kind = aData.y;
        vec3 col = vec3(0.0);
        float a = 0.0;
        if (kind < 0.16) {
          float raise = smoothstep(0.58, 0.74, vnoise3(vec3(r1 * 13.0 + ang * 2.0, r2 * 7.0, t * 0.035 + r3 * 31.0)));
          p.y += raise * 0.38;
          float flick = 0.85 + 0.15 * sin(t * (7.0 + r2 * 9.0) + r3 * 40.0);
          col = vec3(0.86, 0.9, 1.0) * 1.6 * flick;
          a = raise;
        } else if (kind < 0.52) {
          float cue = vnoise3(vec3(ang * 2.2 - t * 0.11, base.y * 0.09 + t * 0.02, t * 0.03));
          float lvl = 0.3 + 0.7 * smoothstep(0.42, 0.72, cue) * (0.7 + 0.3 * energy);
          vec3 blue = mix(vec3(0.05, 0.22, 1.0), vec3(0.25, 0.55, 1.0), r2);
          col = mix(blue, uAccent, step(0.68, r3)) * 1.25;
          a = lvl;
        } else {
          // everyone else: faint spill from the stage on the lower rows, so the bowl reads as people
          float spill = smoothstep(46.0, 30.0, rad) * smoothstep(13.0, 3.0, base.y);
          col = vec3(0.32, 0.4, 0.62);
          a = spill * (0.05 + 0.1 * energy) * (0.6 + 0.4 * r2);
        }

        float lit = 0.0;
        vec3 litCol = vec3(0.0);
        for (int i = 0; i < ${CROWD_BEAMS}; i++) {
          vec3 d = base - uBeams[i].xyz;
          float k = exp(-dot(d, d) / (uBeams[i].w * uBeams[i].w));
          lit += k;
          litCol += uBeamCols[i] * k;
        }
        col += litCol * 1.4;
        a = max(a, min(1.0, lit) * (0.3 + 0.7 * r2));

        float dA = abs(mod(ang - uWave + 3.14159, 6.28318) - 3.14159);
        float wave = exp(-dA * dA * uWaveWidth) * uWaveOn * step(kind, 0.7);
        col += uWaveColor * wave * 2.0;
        a = max(a, wave);
        a *= step(aData.w, uPower);

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = -mv.z;
        float fd = uFogDensity * dist;
        float fog = exp(-fd * fd * 1.6);
        float s = aData.z * uScale / max(dist, 0.1);
        gl_PointSize = clamp(s, 1.0, 10.0);
        vAlpha = a * min(1.0, s * s) * fog;
        vColor = col;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float m = smoothstep(0.5, 0.1, d);
        gl_FragColor = vec4(vColor * vAlpha * m, 1.0);
      }
    `,
  });
}

// Lens points on every fixture: a hard core with a thin anamorphic streak and a faint
// four-point star. Sized in screen pixels so they stay crisp at any distance.
export function flareMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uScale: { value: 600 },
      uPixel: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aIntensity;
      uniform float uScale;
      uniform float uPixel;
      varying vec2 vP;
      varying vec3 vColor;
      varying float vI;
      void main(){
        vec4 c = viewMatrix * modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float dist = max(-c.z, 0.1);
        float core = 3.0 * uPixel;
        float streak = (34.0 + 26.0 * aIntensity) * uPixel;
        vec2 sizePx = vec2(streak * 2.0, core * 5.0);
        vec2 world = sizePx * dist / uScale;
        vP = position.xy * sizePx;
        c.xy += position.xy * world;
        gl_Position = projectionMatrix * c;
        vColor = aColor;
        vI = aIntensity;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uPixel;
      varying vec2 vP;
      varying vec3 vColor;
      varying float vI;
      void main(){
        vec2 p = vP / uPixel;
        float r2 = dot(p, p);
        float core = exp(-r2 / 3.2) * 3.2 + exp(-r2 / 22.0) * 0.5;
        float streak = exp(-abs(p.y) / 0.55) * exp(-abs(p.x) / 26.0) * 0.55;
        float star = exp(-abs(p.x) / 0.5) * exp(-abs(p.y) / 6.0) * 0.35;
        vec3 tint = mix(vColor, vec3(1.0), 0.55);
        vec3 col = tint * core + mix(vColor, vec3(0.6, 0.75, 1.0), 0.4) * (streak + star);
        gl_FragColor = vec4(col * vI, 1.0);
      }
    `,
  });
}

// Floating dust rendered as out-of-focus bokeh discs (cheap depth of field).
export function bokehMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uPower: { value: 0 },
      uScale: { value: 600 },
      uFocus: { value: 20 },
      uAperture: { value: 40 },
      ...fogUniforms,
    },
    vertexShader: /* glsl */ `
      attribute vec4 aData;
      uniform float uTime, uPower, uScale, uFocus, uAperture, uFogDensity;
      varying float vAlpha;
      varying vec3 vColor;
      void main(){
        vec3 p = position;
        p.x += sin(uTime * 0.07 + aData.x * 6.2831) * 0.9;
        p.y += sin(uTime * 0.11 + aData.x * 17.0) * 0.6;
        p.z += cos(uTime * 0.06 + aData.x * 9.0) * 0.9;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = max(-mv.z, 0.1);
        float sharp = aData.z * uScale / dist;
        float coc = uAperture * abs(dist - uFocus) / dist;
        float size = sharp + coc;
        gl_PointSize = clamp(size, 1.0, 160.0);
        float energy = (max(sharp, 1.5) * max(sharp, 1.5)) / (size * size);
        float fd = uFogDensity * dist;
        vAlpha = 0.55 * aData.y * clamp(energy, 0.01, 1.0) * exp(-fd * fd) * uPower * smoothstep(150.0, 60.0, size);
        vColor = mix(vec3(0.55, 0.72, 1.0), vec3(0.9, 0.95, 1.0), aData.x);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      varying vec3 vColor;
      void main(){
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float edge = smoothstep(1.0, 0.86, d);
        float rim = mix(0.7, 1.0, smoothstep(0.45, 0.95, d));
        gl_FragColor = vec4(vColor * vAlpha * edge * rim, 1.0);
      }
    `,
  });
}

// Soft additive haze glow, billboarded, centred on the brightest part of the arena.
export function hazeMaterial(color = 0x3a6dff) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: 0 },
      uTime: { value: 0 },
      uCheap: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main(){
        vUv = uv;
        vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 center = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float sx = length(modelMatrix[0].xyz);
        float sy = length(modelMatrix[1].xyz);
        vec3 wp = center + camRight * position.x * sx + camUp * position.y * sy;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity, uTime, uCheap;
      varying vec2 vUv;
      ${NOISE}
      void main(){
        vec2 p = vUv - 0.5;
        float r = length(p) * 2.0;
        float g = exp(-r * r * 3.2);
        if (g * uIntensity < 0.0004) discard;
        float n = uCheap > 0.5 ? 1.0 : 0.65 + 0.7 * fbm2(vUv * 3.0 + vec2(uTime * 0.01, -uTime * 0.015));
        gl_FragColor = vec4(uColor * g * n * uIntensity, 1.0);
      }
    `,
  });
}

// Broadcast screen: bends like a flexible LED sheet with scroll velocity, has a bezel,
// a reveal wipe and a glass sheen. Plane is W x H in XY, facing +Z.
export function screenMaterial(map, W, H) {
  return new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    uniforms: {
      map: { value: map },
      uTime: { value: 0 },
      uBend: { value: 0 },
      uFlutter: { value: 0 },
      uReveal: { value: 0 },
      uFocus: { value: 0 },
      uOpacity: { value: 0 },
      uSize: { value: new THREE.Vector2(W, H) },
      ...fogUniforms,
    },
    vertexShader: /* glsl */ `
      uniform float uTime, uBend, uFlutter;
      uniform vec2 uSize;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vDist;
      void main(){
        vUv = uv;
        vec3 p = position;
        float u = uv.x - 0.5;
        float v = uv.y - 0.5;
        p.z += uBend * (u * u * 4.0 - 0.33) * uSize.x * 0.22;
        p.z += sin(uv.x * 5.0 + uTime * 2.3 + uv.y * 2.0) * uFlutter * 0.22;
        p.z += sin(uv.y * 4.0 - uTime * 1.7) * uFlutter * 0.08 * u * 2.0;
        p.y += sin(uv.x * 3.14159) * uFlutter * 0.05;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorld = wp.xyz;
        vec4 mv = viewMatrix * wp;
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform float uTime, uReveal, uFocus, uOpacity;
      uniform vec2 uSize;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vDist;
      ${NOISE}
      ${FOG}
      void main(){
        vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
        vec3 V = normalize(cameraPosition - vWorld);
        float facing = abs(dot(N, V));
        vec2 bz = vec2(0.10) / uSize;
        vec2 inner = (vUv - bz) / (1.0 - 2.0 * bz);
        float inside = step(0.0, inner.x) * step(inner.x, 1.0) * step(0.0, inner.y) * step(inner.y, 1.0);
        vec3 content = texture2D(map, clamp(inner, 0.0, 1.0)).rgb;
        float diag = inner.x * 0.82 + (1.0 - inner.y) * 0.18;
        float wipe = uReveal * 1.25 - 0.1;
        float rev = smoothstep(diag - 0.02, diag, wipe);
        // wipe edge: a hairline ~2 px wide at any size, kept under the bloom threshold so it stays crisp
        float edge = (1.0 - smoothstep(0.0, fwidth(diag) * 1.5, abs(diag - wipe - 0.01))) * step(uReveal, 0.98);
        float scan = 0.93 + 0.07 * sin(inner.y * 540.0);
        vec3 col = content * 1.25 * scan * rev * (0.55 + 0.45 * uFocus);
        col += vec3(0.45, 0.68, 1.0) * edge;
        float sweepPos = fract(uTime * 0.06) * 2.2 - 0.6;
        float sweep = smoothstep(0.07, 0.0, abs(inner.x + inner.y * 0.35 - sweepPos)) * 0.035;
        float fres = pow(1.0 - facing, 3.0);
        col += vec3(0.55, 0.72, 1.0) * (sweep + fres * 0.18) * inside;
        // bezel: dark brushed frame with a thin light edge
        vec2 e = min(vUv, 1.0 - vUv) * uSize;
        float edgeLine = smoothstep(0.012, 0.0, abs(min(e.x, e.y) - 0.035));
        vec3 bezel = vec3(0.012, 0.014, 0.02) * (0.8 + 0.4 * vnoise2(vUv * vec2(300.0, 6.0))) + vec3(0.25, 0.55, 1.0) * edgeLine * 0.9;
        col = mix(bezel + vec3(0.3, 0.45, 0.7) * fres * 0.25, col, inside);
        gl_FragColor = vec4(applyFog(col, vDist), uOpacity);
      }
    `,
  });
}
