// Broadcast windows as rigid, slightly see-through glass.
//
// GlassPass runs right after the scene render: it blurs the frame at quarter resolution (the frosted
// backdrop), then draws a copy of the frame plus the glass panes into the next buffer in ONE render
// call. One call matters: three.js resolves and invalidates a multisampled buffer after each render,
// so panes drawn in a second call over the scene buffer could land on undefined pixels.
//
// Each pane is a rounded slab (rounded corners, fully rounded edges). Its normals come from the slab's
// distance function per pixel, so the rim is perfectly smooth however coarse the mesh.
import * as THREE from 'three';
import { Pass, KawaseBlurPass, KernelSize } from 'postprocessing';
import { FOG } from './glsl.js';
import { fogUniforms } from './materials.js';

export class GlassPass extends Pass {
  constructor(glassScene, camera, { type = THREE.UnsignedByteType, scale = 0.25, kernel = KernelSize.LARGE } = {}) {
    super('GlassPass', glassScene, camera);
    this.needsSwap = true;
    this.blur = new KawaseBlurPass({ kernelSize: kernel, resolutionScale: scale });
    this.backdrop = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, type });
    this.backdrop.texture.name = 'Glass.Backdrop';
    this.uniforms = {
      tBackdrop: { value: this.backdrop.texture },
      uResolution: { value: new THREE.Vector2(1, 1) },
    };
    // full-frame copy of the scene, drawn first in the same call as the panes (vertex shader ignores the camera)
    this.copy = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: { tFrame: { value: null }, uDebug: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: 'uniform sampler2D tFrame; uniform float uDebug; varying vec2 vUv; void main(){ gl_FragColor = mix(texture2D(tFrame, vUv), vec4(1.0, 0.0, 1.0, 1.0), uDebug); }',
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.copy.frustumCulled = false;
    this.copy.renderOrder = -100000;
    glassScene.add(this.copy);
  }

  initialize(renderer, alpha, frameBufferType) {
    this.blur.initialize(renderer, alpha, frameBufferType);
    // blur in the scene's own (half-float) format, so dark gradients behind the glass don't band
    if (frameBufferType !== undefined) {
      for (const t of [this.blur.renderTargetA, this.blur.renderTargetB]) t.texture.type = frameBufferType;
    }
  }

  render(renderer, inputBuffer, outputBuffer) {
    this.blur.render(renderer, inputBuffer, this.backdrop);
    this.copy.material.uniforms.tFrame.value = inputBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }

  setSize(width, height) {
    this.blur.setSize(width, height);
    const r = this.blur.resolution;
    this.backdrop.setSize(r.width, r.height);
    this.uniforms.uResolution.value.set(width, height);
  }

  dispose() {
    this.blur.dispose();
    this.backdrop.dispose();
    this.copy.geometry.dispose();
    this.copy.material.dispose();
    super.dispose();
  }
}

// Rounded slab: W x H outer size, edge radius r (= half the thickness), outer corner radius `corner`.
export function paneGeometry(W, H, r, corner) {
  const hw = W / 2 - r;
  const hh = H / 2 - r;
  const cr = Math.max(corner - r, 0.001);
  const s = new THREE.Shape();
  s.moveTo(-hw + cr, -hh);
  s.lineTo(hw - cr, -hh);
  s.absarc(hw - cr, -hh + cr, cr, -Math.PI / 2, 0, false);
  s.lineTo(hw, hh - cr);
  s.absarc(hw - cr, hh - cr, cr, 0, Math.PI / 2, false);
  s.lineTo(-hw + cr, hh);
  s.absarc(-hw + cr, hh - cr, cr, Math.PI / 2, Math.PI, false);
  s.lineTo(-hw, -hh + cr);
  s.absarc(-hw + cr, -hh + cr, cr, Math.PI, Math.PI * 1.5, false);
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.0002, bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelSegments: 7, curveSegments: 10,
  });
  geo.translate(0, 0, -0.0001);
  geo.computeBoundingSphere();
  return geo;
}

export function glassMaterial({ map, W, H, r, corner, accent = 0x2f6dff, shared }) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      ...shared,
      map: { value: map },
      uSize: { value: new THREE.Vector2(W, H) },
      uR: { value: r },
      uCorner: { value: corner },
      uObjToView: { value: new THREE.Matrix3() },
      uViewToWorld: { value: new THREE.Matrix3() },
      uPaneView: { value: new THREE.Vector3() },
      uScale: { value: 1 },
      uAccent: { value: new THREE.Color(accent) },
      uReveal: { value: 0 },
      uFocus: { value: 0 },
      uOpacity: { value: 1 },
      uEdge: { value: 1 },
      uSheen: { value: 0.06 },
      uKill: { value: new THREE.Vector4(0, 0, 0, 0) },
      ...fogUniforms,
    },
    vertexShader: /* glsl */ `
      varying vec3 vObj;
      varying float vDist;
      void main(){
        vObj = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform sampler2D tBackdrop;
      uniform vec2 uResolution;
      uniform vec2 uSize;
      uniform float uR, uCorner, uScale, uReveal, uFocus, uOpacity, uEdge, uSheen;
      uniform mat3 uObjToView, uViewToWorld;
      uniform vec3 uPaneView, uAccent;
      uniform vec4 uKill; // diagnostics: x env reflection, y sheen, z edge + lip, w backdrop (skipped, not zeroed)
      varying vec3 vObj;
      varying float vDist;
      ${FOG}

      // What the glass reflects: the arena's light columns, the ring of light at truss height, a soft roof
      // and the accent glow of the stage below. No arc tangent here: on the owner's Intel GPU (ANGLE/D3D) its
      // branch cut produced NaN along a line across the pane. The 7 columns come from (cos az, sin az) raised
      // to the 7th power as a unit complex number, and the narrow peak from repeated squaring. Squares are
      // written out: a negative base raised to a power is NaN on D3D, and bloom spreads NaN over the frame.
      vec3 arenaEnv(vec3 r){
        float up = r.y;
        vec2 e = r.zx / max(length(r.zx), 1e-4);
        vec2 z2 = vec2(e.x * e.x - e.y * e.y, 2.0 * e.x * e.y);
        vec2 z4 = vec2(z2.x * z2.x - z2.y * z2.y, 2.0 * z2.x * z2.y);
        vec2 z6 = vec2(z4.x * z2.x - z4.y * z2.y, z4.x * z2.y + z4.y * z2.x);
        vec2 z7 = vec2(z6.x * e.x - z6.y * e.y, z6.x * e.y + z6.y * e.x);
        float b = max(0.5 + 0.5 * (z7.x * 0.825336 - z7.y * 0.564642), 0.0);
        float b2 = b * b; float b4 = b2 * b2; float b8 = b4 * b4; float b16 = b8 * b8;
        float cols = b16 * b16 * b8 * smoothstep(-0.05, 0.3, up) * (1.0 - smoothstep(0.6, 0.95, up));
        float re = (up - 0.38) * 8.0;
        float ring = exp(-re * re);
        float roof = smoothstep(0.55, 1.0, up);
        vec3 c = vec3(0.50, 0.70, 1.0) * (cols * 1.6 + ring * 0.55 + roof * 0.35);
        c += uAccent * 0.16 * smoothstep(0.0, -0.5, up);
        return c;
      }

      void main(){
        vec3 p = vObj;
        // smooth slab normal from its distance function (rounded rect core, rounded edge of radius uR)
        vec2 hb = uSize * 0.5 - vec2(uR);
        float cr = max(uCorner - uR, 0.001);
        vec2 q2 = abs(p.xy) - (hb - vec2(cr));
        float d2 = length(max(q2, 0.0)) + min(max(q2.x, q2.y), 0.0) - cr;
        vec2 g2 = (q2.x > 0.0 && q2.y > 0.0) ? normalize(q2) : (q2.x > q2.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
        g2 *= vec2(p.x < 0.0 ? -1.0 : 1.0, p.y < 0.0 ? -1.0 : 1.0);
        float out2 = max(d2, 0.0);
        vec3 nObj = normalize(vec3(g2 * out2, p.z));
        float rim = clamp(out2 / uR, 0.0, 1.0);          // 0 across the flat face, 1 at the outer edge

        vec3 n = normalize(uObjToView * nObj);
        vec3 pv = uObjToView * (p * uScale) + uPaneView;
        vec3 V = normalize(-pv);
        float ndv = clamp(dot(n, V), 0.0, 1.0);
        float f1 = 1.0 - ndv;
        float fres = f1 * f1 * f1 * f1;

        // frosted backdrop, bent gently across the face and strongly around the rounded rim
        vec2 suv = gl_FragCoord.xy / uResolution;
        vec2 off = n.xy * (0.006 + 0.05 * rim * rim);
        vec3 back = vec3(0.05, 0.06, 0.1);
        if (uKill.w < 0.5) back = texture2D(tBackdrop, suv - off).rgb;
        vec3 col = back * vec3(0.60, 0.68, 0.84) + vec3(0.008, 0.013, 0.026) * (0.6 + 0.4 * suv.y);

        // content on the face; its transparent parts let the glass show through
        vec2 cuv = p.xy / uSize + 0.5;
        float face = 1.0 - smoothstep(0.0, 0.2, rim);
        float diag = cuv.x * 0.82 + (1.0 - cuv.y) * 0.18;
        float wipe = uReveal * 1.25 - 0.1;
        float rev = smoothstep(diag - 0.02, diag, wipe) * face;
        vec4 c = texture2D(map, cuv);                     // premultiplied alpha
        col = col * (1.0 - c.a * rev) + c.rgb * 1.15 * rev * (0.62 + 0.38 * uFocus);
        // the content powers on behind a crisp hairline
        float wipeLine = (1.0 - smoothstep(0.0, max(fwidth(diag), 1e-6) * 1.5, abs(diag - wipe - 0.01))) * step(uReveal, 0.98) * face;
        col += vec3(0.45, 0.68, 1.0) * wipeLine;

        // reflections: faint face-on, strong at grazing angles, so light sweeps across as the pane turns
        vec3 R = reflect(-V, n);
        if (uKill.x < 0.5) {
          vec3 Rw = uViewToWorld * R;
          col += arenaEnv(Rw) * mix(0.10, 1.0, fres) * (1.0 - 0.4 * rim);
        }

        // a broad sheen across the face; it slides as the pane turns, so light sweeps over the glass
        float sweepPos = 0.55 + n.x * 1.7;
        float se = (cuv.x + (1.0 - cuv.y) * 0.35 - sweepPos) * 3.2;
        float sheen = exp(-se * se);
        if (uKill.y < 0.5) col += vec3(0.62, 0.78, 1.0) * sheen * uSheen * face;

        // light-pipe edge: glass edges glow; cool on top, picking up the accent underneath
        float upW = (uViewToWorld * n).y;
        vec3 edgeCol = mix(vec3(0.62, 0.86, 1.0), uAccent * 1.4, smoothstep(0.2, -0.7, upW) * 0.8);
        if (uKill.z < 0.5) col += edgeCol * (rim * sqrt(rim)) * (0.55 + 1.6 * fres) * uEdge;
        // a crisp lip where the flat face rolls into the edge
        float lip = 1.0 - smoothstep(0.0, max(fwidth(d2), 1e-6) * 1.6, abs(d2 + 0.004));
        float topLit = 0.35 + 0.65 * smoothstep(-0.3, 0.7, g2.y);
        if (uKill.z < 0.5) col += vec3(0.70, 0.85, 1.0) * lip * (0.25 + 0.75 * fres) * 0.75 * topLit;

        // last line of defence: max() returns the non-NaN operand on D3D, so a stray NaN can't reach bloom
        gl_FragColor = vec4(max(applyFog(col, vDist), vec3(0.0)), uOpacity);
      }
    `,
  });
}
