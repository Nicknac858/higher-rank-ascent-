// The arena: a round esports stage under a centre-hung halo of LED screens, a lighting
// truss with moving-head beams, a reflective floor and a two-tier bowl of crowd lights.
// Angles use three.js' lathe/cylinder convention: position = (r sin t, y, r cos t),
// so t = 0 points at the hero camera (+Z).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  ledMaterial, stripMaterial, beamMaterial, floorMaterial, crowdMaterial,
  bokehMaterial, hazeMaterial, flareMaterial, MAX_POOLS,
} from './materials.js';
import { makeHaloTexture, makeTickerTexture, makeUndersideTexture, makeMonitorTexture } from './textures.js';

const TAU = Math.PI * 2;
const polar = (r, t, y) => new THREE.Vector3(r * Math.sin(t), y, r * Math.cos(t));

export const DIM = {
  stageR: 7.5,
  stageH: 0.9,
  haloY: 10.9,
  haloR: 6.0,
  haloH: 2.6,
  tickY: 8.75,
  tickR: 4.7,
  tickH: 0.8,
  trussY: 15.6,
  trussR: 10.5,
  outerY: 19.8,
  outerR: 17.0,
  floorR: 26.6,
};

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Annular sector extruded upward, angles in the lathe convention.
function arcBox(r0, r1, y0, h, t0, t1, seg = 32) {
  const b0 = Math.PI / 2 - t1;
  const b1 = Math.PI / 2 - t0;
  const s = new THREE.Shape();
  s.moveTo(r1 * Math.cos(b0), r1 * Math.sin(b0));
  s.absarc(0, 0, r1, b0, b1, false);
  s.lineTo(r0 * Math.cos(b1), r0 * Math.sin(b1));
  s.absarc(0, 0, r0, b1, b0, true);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: seg });
  g.rotateX(Math.PI / 2);
  g.translate(0, y0 + h, 0);
  return g;
}

// Horizontal ring tube (torus lying flat) at radius r, height y.
function flatTorus(r, tube, y, radial = 6, tubular = 256) {
  const g = new THREE.TorusGeometry(r, tube, radial, tubular);
  g.rotateX(Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}


// mergeGeometries needs matching index/attribute layouts; normalise first.
function merge(geos) {
  const anyNonIndexed = geos.some((g) => !g.index);
  const list = geos.map((g0) => {
    const g = anyNonIndexed && g0.index ? g0.toNonIndexed() : g0;
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.clearGroups();
    return g;
  });
  return mergeGeometries(list);
}

const _up = new THREE.Vector3(0, 1, 0);
const _down = new THREE.Vector3(0, -1, 0);

function memberMatrix(a, b, t, out) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  dir.normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(_up, dir);
  out.compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q, new THREE.Vector3(t, len, t));
  return out;
}

function buildTruss(R, Y, segs, w, t, material, lacing = true) {
  const group = new THREE.Group();
  const chords = merge([
    flatTorus(R - w / 2, t * 1.4, Y + w / 2, 6, segs * 3),
    flatTorus(R + w / 2, t * 1.4, Y + w / 2, 6, segs * 3),
    flatTorus(R - w / 2, t * 1.4, Y - w / 2, 6, segs * 3),
    flatTorus(R + w / 2, t * 1.4, Y - w / 2, 6, segs * 3),
  ]);
  group.add(new THREE.Mesh(chords, material));
  if (!lacing) return group;
  const box = new THREE.BoxGeometry(1, 1, 1);
  const per = 8;
  const inst = new THREE.InstancedMesh(box, material, segs * per);
  const m = new THREE.Matrix4();
  let n = 0;
  for (let k = 0; k < segs; k++) {
    const t0 = (k / segs) * TAU;
    const t1 = ((k + 1) / segs) * TAU;
    const IT0 = polar(R - w / 2, t0, Y + w / 2);
    const IB0 = polar(R - w / 2, t0, Y - w / 2);
    const OT0 = polar(R + w / 2, t0, Y + w / 2);
    const OB0 = polar(R + w / 2, t0, Y - w / 2);
    const IT1 = polar(R - w / 2, t1, Y + w / 2);
    const OT1 = polar(R + w / 2, t1, Y + w / 2);
    const OB1 = polar(R + w / 2, t1, Y - w / 2);
    const pairs = [[IT0, IB0], [OT0, OB0], [IT0, OT0], [IB0, OB0], [IB0, IT1], [OB0, OT1], [IT0, OT1], [IB0, OB1]];
    for (const [a, b] of pairs) inst.setMatrixAt(n++, memberMatrix(a, b, t, m));
  }
  inst.instanceMatrix.needsUpdate = true;
  group.add(inst);
  return group;
}

export function buildArena({ quality, renderer, accent = null }) {
  const ACC = accent ? accent.hex : null;
  const root = new THREE.Group();
  const anim = {
    leds: [], strips: [], beams: [], spots: [], monitors: null, chairPiping: null,
    crowd: null, dust: null, hazes: [], halo: null, floor: null, pedestalBeam: null,
  };
  const rand = rng(20270101);

  // ---------- materials ----------
  const M = {
    metal: new THREE.MeshStandardMaterial({ color: 0x1d222b, metalness: 0.95, roughness: 0.3, envMapIntensity: 1.4 }),
    metalDark: new THREE.MeshStandardMaterial({ color: 0x0b0e13, metalness: 0.85, roughness: 0.42, envMapIntensity: 1.0 }),
    truss: new THREE.MeshStandardMaterial({ color: 0x2a303a, metalness: 0.9, roughness: 0.38, envMapIntensity: 1.1 }),
    matte: new THREE.MeshStandardMaterial({ color: 0x07090c, metalness: 0.15, roughness: 0.78, envMapIntensity: 0.5 }),
    stageTop: new THREE.MeshPhysicalMaterial({ color: 0x030406, metalness: 0.0, roughness: 0.32, clearcoat: 1.0, clearcoatRoughness: 0.05, envMapIntensity: 1.0 }),
    bowl: new THREE.MeshStandardMaterial({ color: 0x080a0f, metalness: 0.05, roughness: 0.92, envMapIntensity: 0.16, side: THREE.DoubleSide }),
    chair: new THREE.MeshStandardMaterial({ color: 0x0d1016, metalness: 0.3, roughness: 0.55, envMapIntensity: 0.8 }),
  };
  anim.materials = M;

  // ---------- floor ----------
  const floorMat = floorMaterial();
  if (ACC) floorMat.uniforms.uAccentColor.value.setHex(ACC);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(DIM.floorR, 180), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.updateMatrixWorld();
  root.add(floor);
  anim.floor = floor;

  // ---------- stage ----------
  const stage = new THREE.Group();
  root.add(stage);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(DIM.stageR, DIM.stageR, DIM.stageH, 160, 1, true), M.metalDark);
  body.position.y = DIM.stageH / 2;
  stage.add(body);
  const top = new THREE.Mesh(new THREE.CircleGeometry(DIM.stageR, 160), M.stageTop);
  top.rotation.x = -Math.PI / 2;
  top.position.y = DIM.stageH;
  stage.add(top);
  const step = new THREE.Mesh(arcBox(DIM.stageR, DIM.stageR + 0.9, 0, 0.32, 0, TAU, 160), M.metalDark);
  stage.add(step);

  const tickerItems = ['HIGHER RANK', 'WEB DESIGN', 'MARKETING', 'LIVE EVENTS', 'ESPORTS'];
  const fasciaTex = makeTickerTexture({ items: tickerItems, height: 96 });
  const fascia = new THREE.Mesh(
    new THREE.CylinderGeometry(DIM.stageR + 0.02, DIM.stageR + 0.02, 0.36, 320, 1, true),
    ledMaterial({ map: fasciaTex, grid: [1700, 13], intensity: 2.2, dot: 0.38, cab: [26, 13] }),
  );
  fascia.material.uniforms.uRepeat.value = 4;
  fascia.position.y = 0.56;
  stage.add(fascia);
  anim.leds.push({ mesh: fascia, group: 'stage', speed: -0.012 });

  const stageEdge = new THREE.Mesh(flatTorus(DIM.stageR - 0.18, 0.025, DIM.stageH + 0.005, 6, 320), stripMaterial({ color: 0x5a9bff, intensity: 3.2 }));
  stage.add(stageEdge);
  anim.strips.push({ mat: stageEdge.material, group: 'stage' });
  const innerEdge = new THREE.Mesh(flatTorus(2.2, 0.02, DIM.stageH + 0.005, 6, 160), stripMaterial({ color: ACC ?? 0x2f7dff, intensity: 2.6 }));
  stage.add(innerEdge);
  anim.strips.push({ mat: innerEdge.material, group: 'stage' });

  // centre pedestal and the light column that links stage and halo
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.35, 0.32, 96), M.metal);
  ped.position.y = DIM.stageH + 0.16;
  stage.add(ped);
  const pedRing = new THREE.Mesh(flatTorus(1.05, 0.03, DIM.stageH + 0.33, 6, 128), stripMaterial({ color: ACC ?? 0x9ccaff, intensity: 4 }));
  stage.add(pedRing);
  anim.strips.push({ mat: pedRing.material, group: 'stage' });

  // ---------- team booths ----------
  const monitorTex = makeMonitorTexture();
  const monitorMat = new THREE.MeshBasicMaterial({ map: monitorTex, color: new THREE.Color(0, 0, 0), toneMapped: false });
  anim.monitors = monitorMat;
  const pipingMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0), toneMapped: false });
  anim.chairPiping = pipingMat;
  const deskGeos = [];
  const chairGeos = [];
  const pipeGeos = [];
  const screenGeos = [];
  for (const side of [-1, 1]) {
    const tc = side * Math.PI / 2;
    const span = 0.62;
    deskGeos.push(arcBox(4.0, 4.75, DIM.stageH, 0.74, tc - span, tc + span, 40));
    const stripGeo = new THREE.CylinderGeometry(4.77, 4.77, 0.05, 64, 1, true, tc - span, span * 2);
    stripGeo.translate(0, DIM.stageH + 0.62, 0);
    const strip = new THREE.Mesh(stripGeo, stripMaterial({ color: 0x2f7dff, intensity: 3.4 }));
    stage.add(strip);
    anim.strips.push({ mat: strip.material, group: 'desks' });
    for (let i = 0; i < 5; i++) {
      const t = tc - span * 0.8 + (i / 4) * span * 1.6;
      const mp = polar(4.42, t, DIM.stageH + 0.74 + 0.3);
      const sg = new THREE.PlaneGeometry(0.66, 0.38);
      sg.rotateY(t);
      sg.translate(mp.x, mp.y, mp.z);
      screenGeos.push(sg);
      const back = new THREE.BoxGeometry(0.7, 0.42, 0.04);
      back.rotateY(t);
      const bp = polar(4.39, t, mp.y);
      back.translate(bp.x, bp.y, bp.z);
      deskGeos.push(back);
      const seat = new THREE.BoxGeometry(0.52, 0.09, 0.5);
      seat.rotateY(t);
      const spos = polar(5.35, t, DIM.stageH + 0.48);
      seat.translate(spos.x, spos.y, spos.z);
      chairGeos.push(seat);
      const backrest = new THREE.BoxGeometry(0.54, 0.95, 0.09);
      backrest.rotateY(t);
      const brp = polar(5.62, t, DIM.stageH + 1.0);
      backrest.translate(brp.x, brp.y, brp.z);
      chairGeos.push(backrest);
      const postG = new THREE.CylinderGeometry(0.035, 0.035, 0.42, 8);
      const pp = polar(5.35, t, DIM.stageH + 0.22);
      postG.translate(pp.x, pp.y, pp.z);
      chairGeos.push(postG);
      const pipe = new THREE.BoxGeometry(0.035, 0.85, 0.02);
      pipe.rotateY(t);
      for (const off of [-0.25, 0.25]) {
        const pg = pipe.clone();
        const dir = new THREE.Vector3(Math.cos(t), 0, -Math.sin(t)).multiplyScalar(off);
        const pos = polar(5.67, t, DIM.stageH + 1.0).add(dir);
        pg.translate(pos.x, pos.y, pos.z);
        pipeGeos.push(pg);
      }
    }
  }
  stage.add(new THREE.Mesh(merge(deskGeos), M.metalDark));
  stage.add(new THREE.Mesh(merge(chairGeos), M.chair));
  stage.add(new THREE.Mesh(merge(pipeGeos), pipingMat));
  stage.add(new THREE.Mesh(merge(screenGeos), monitorMat));

  // ---------- halo ----------
  const halo = new THREE.Group();
  root.add(halo);
  anim.halo = halo;
  const haloTex = makeHaloTexture();
  const haloGrid = [Math.round((TAU * DIM.haloR) / 0.03), Math.round(DIM.haloH / 0.03)];
  const outer = new THREE.Mesh(
    new THREE.CylinderGeometry(DIM.haloR, DIM.haloR, DIM.haloH, 256, 1, true),
    ledMaterial({ map: haloTex, grid: haloGrid, intensity: 2.4, cab: [24, 29] }),
  );
  outer.position.y = DIM.haloY;
  halo.add(outer);
  anim.leds.push({ mesh: outer, group: 'halo', speed: 0 });
  const inner = new THREE.Mesh(
    new THREE.CylinderGeometry(DIM.haloR - 0.12, DIM.haloR - 0.12, DIM.haloH, 256, 1, true),
    ledMaterial({ map: haloTex, grid: haloGrid, intensity: 1.6, side: THREE.BackSide, flip: true, cab: [24, 29] }),
  );
  inner.position.y = DIM.haloY;
  halo.add(inner);
  anim.leds.push({ mesh: inner, group: 'halo', speed: 0 });
  const capGeo = (y, up) => {
    const g = new THREE.RingGeometry(DIM.haloR - 0.14, DIM.haloR + 0.03, 256, 1);
    g.rotateX(up ? -Math.PI / 2 : Math.PI / 2);
    g.translate(0, y, 0);
    return g;
  };
  const topY = DIM.haloY + DIM.haloH / 2;
  const botY = DIM.haloY - DIM.haloH / 2;
  const lid = new THREE.CircleGeometry(DIM.haloR - 0.12, 128);
  lid.rotateX(-Math.PI / 2);
  lid.translate(0, topY + 0.01, 0);
  halo.add(new THREE.Mesh(merge([capGeo(topY, true), capGeo(botY, false), lid]), M.metal));
  const edges = new THREE.Mesh(
    merge([flatTorus(DIM.haloR + 0.035, 0.03, topY, 6, 320), flatTorus(DIM.haloR + 0.035, 0.03, botY, 6, 320)]),
    stripMaterial({ color: 0xcfe2ff, intensity: 3.6 }),
  );
  halo.add(edges);
  anim.strips.push({ mat: edges.material, group: 'halo' });

  // lower ticker ring
  const tickTex = makeTickerTexture({ items: tickerItems, height: 96, fg: '#8cc6ff' });
  const tickGrid = [Math.round((TAU * DIM.tickR) / 0.028), Math.round(DIM.tickH / 0.028)];
  const tick = new THREE.Mesh(
    new THREE.CylinderGeometry(DIM.tickR, DIM.tickR, DIM.tickH, 200, 1, true),
    ledMaterial({ map: tickTex, grid: tickGrid, intensity: 2.2, cab: [24, 28] }),
  );
  tick.position.y = DIM.tickY;
  halo.add(tick);
  anim.leds.push({ mesh: tick, group: 'ticker', speed: 0.018 });
  const tickTop = DIM.tickY + DIM.tickH / 2;
  const tickBot = DIM.tickY - DIM.tickH / 2;
  const tickCaps = [];
  for (const [y, up] of [[tickTop, true], [tickBot, false]]) {
    const g = new THREE.RingGeometry(DIM.tickR - 0.12, DIM.tickR + 0.03, 200, 1);
    g.rotateX(up ? -Math.PI / 2 : Math.PI / 2);
    g.translate(0, y, 0);
    tickCaps.push(g);
  }
  for (let i = 0; i < 8; i++) {
    const t = (i / 8) * TAU + 0.2;
    const s = new THREE.BoxGeometry(0.08, botY - tickTop, 0.08);
    const p = polar(DIM.tickR - 0.05, t, (botY + tickTop) / 2);
    s.translate(p.x, p.y, p.z);
    tickCaps.push(s);
  }
  halo.add(new THREE.Mesh(merge(tickCaps), M.metal));

  // underside dial
  const underTex = makeUndersideTexture();
  const under = new THREE.Mesh(new THREE.CircleGeometry(DIM.tickR - 0.1, 160), ledMaterial({ map: underTex, grid: [220, 220], intensity: 1.1, planar: true, cab: [22, 22] }));
  under.rotation.x = Math.PI / 2;
  under.position.y = tickBot - 0.02;
  halo.add(under);
  anim.leds.push({ mesh: under, group: 'under', speed: 0 });

  // hoist cables
  const cables = [];
  for (let i = 0; i < 8; i++) {
    const t = (i / 8) * TAU + Math.PI / 8;
    const c = new THREE.CylinderGeometry(0.018, 0.018, 34, 5);
    const p = polar(DIM.haloR - 0.6, t, topY + 17);
    c.translate(p.x, p.y, p.z);
    cables.push(c);
  }
  root.add(new THREE.Mesh(merge(cables), M.metal));

  // ---------- truss + fixtures ----------
  root.add(buildTruss(DIM.trussR, DIM.trussY, quality.trussSegs, 0.7, 0.045, M.truss, true));
  root.add(buildTruss(DIM.outerR, DIM.outerY, Math.round(quality.trussSegs * 1.4), 0.6, 0.04, M.truss, quality.tier >= 2));

  const coneGeo = (half) => {
    const g = new THREE.CylinderGeometry(0.004, Math.tan(half), 1, 36, 1, true);
    g.translate(0, -0.5, 0);
    return g;
  };
  const spotCone = coneGeo(THREE.MathUtils.degToRad(5.2));
  const washCone = coneGeo(THREE.MathUtils.degToRad(13));
  const headGeo = new THREE.CylinderGeometry(0.17, 0.21, 0.5, 20);
  headGeo.translate(0, -0.15, 0);
  const lensGeo = new THREE.CircleGeometry(0.15, 24);
  lensGeo.rotateX(Math.PI / 2);
  lensGeo.translate(0, -0.405, 0);
  const yokeGeo = merge([
    new THREE.BoxGeometry(0.34, 0.07, 0.34).translate(0, 0.32, 0),
    new THREE.BoxGeometry(0.05, 0.42, 0.14).translate(-0.24, 0.1, 0),
    new THREE.BoxGeometry(0.05, 0.42, 0.14).translate(0.24, 0.1, 0),
  ]);
  const palette = [0xdde9ff, 0x2f6dff, ACC ?? 0xdde9ff, 0x4f8dff];
  const nSpots = quality.spots;
  for (let i = 0; i < nSpots; i++) {
    const t = ((i + 0.5) / nSpots) * TAU;
    const pos = polar(DIM.trussR, t, DIM.trussY - 0.78);
    const color = palette[i % palette.length];
    const fixture = new THREE.Group();
    fixture.position.copy(pos);
    const yoke = new THREE.Mesh(yokeGeo, M.metalDark);
    fixture.add(yoke);
    const head = new THREE.Group();
    head.add(new THREE.Mesh(headGeo, M.metalDark));
    const lensMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0), toneMapped: false });
    head.add(new THREE.Mesh(lensGeo, lensMat));
    fixture.add(head);
    root.add(fixture);
    const beam = new THREE.Mesh(spotCone, beamMaterial(color));
    beam.frustumCulled = false;
    beam.position.copy(pos).add(new THREE.Vector3(0, -0.1, 0));
    root.add(beam);
    const toCrowd = i % 4 === 3;
    anim.beams.push({
      kind: 'spot', i, t, pos: beam.position.clone(), head, lensMat, beam, color: new THREE.Color(color),
      half: THREE.MathUtils.degToRad(5.2), toCrowd, seed: rand() * 10, target: new THREE.Vector3(), dir: new THREE.Vector3(0, -1, 0), len: 15,
      gain: color === 0x2f6dff ? 1.5 : (ACC && color === ACC ? 1.15 : 1.0),
    });
  }
  const nWash = quality.washes;
  for (let i = 0; i < nWash; i++) {
    const t = ((i + 0.25) / nWash) * TAU;
    const pos = polar(DIM.outerR, t, DIM.outerY - 0.7);
    const fixture = new THREE.Mesh(yokeGeo, M.metalDark);
    fixture.position.copy(pos);
    root.add(fixture);
    const beam = new THREE.Mesh(washCone, beamMaterial(0x1f45ff));
    beam.frustumCulled = false;
    beam.position.copy(pos);
    root.add(beam);
    anim.beams.push({
      kind: 'wash', i, t, pos: pos.clone(), beam, color: new THREE.Color(0x1f45ff), half: THREE.MathUtils.degToRad(13),
      seed: rand() * 10, target: new THREE.Vector3(), dir: new THREE.Vector3(0, -1, 0), len: 20, gain: 0.5,
    });
  }

  // lens points on every fixture (crisp cores with a thin anamorphic streak)
  {
    const flareGeo = new THREE.PlaneGeometry(1, 1);
    const n = anim.beams.length;
    const colors = new Float32Array(n * 3);
    anim.beams.forEach((b, i) => {
      const c = b.kind === 'wash' ? b.color.clone().lerp(new THREE.Color(0xffffff), 0.35) : b.color;
      colors.set([c.r, c.g, c.b], i * 3);
    });
    flareGeo.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3));
    const ia = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    ia.setUsage(THREE.DynamicDrawUsage);
    flareGeo.setAttribute('aIntensity', ia);
    const flares = new THREE.InstancedMesh(flareGeo, flareMaterial(), n);
    flares.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    flares.frustumCulled = false;
    flares.renderOrder = 6;
    root.add(flares);
    anim.flares = flares;
  }

  // hoists: chain motors over the trusses, chains up into the roof
  {
    const geos = [];
    const hoist = (R, Y, n, off) => {
      for (let i = 0; i < n; i++) {
        const t = ((i + off) / n) * TAU;
        const p = polar(R, t, Y + 0.66);
        geos.push(new THREE.BoxGeometry(0.34, 0.46, 0.3).translate(p.x, p.y, p.z));
        const len = 46.5 - (Y + 0.9);
        const chain = new THREE.CylinderGeometry(0.022, 0.022, len, 5);
        chain.translate(p.x, Y + 0.9 + len / 2, p.z);
        geos.push(chain);
        const bar = new THREE.BoxGeometry(0.06, 0.06, 1.0);
        bar.rotateY(t);
        bar.translate(p.x, Y + 0.4, p.z);
        geos.push(bar);
      }
    };
    hoist(DIM.trussR, DIM.trussY, 8, 0.25);
    hoist(DIM.outerR, DIM.outerY, 12, 0.5);
    root.add(new THREE.Mesh(merge(geos), M.metalDark));
  }

  // crowd barrier around the floor
  {
    const wallMat = M.metalDark.clone();
    wallMat.side = THREE.DoubleSide;
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(24.3, 24.3, 1.1, 256, 1, true), wallMat);
    wall.position.y = 0.55;
    root.add(wall);
    root.add(new THREE.Mesh(flatTorus(24.3, 0.045, 1.12, 6, 400), M.metal));
    const led = new THREE.Mesh(flatTorus(24.26, 0.016, 0.9, 6, 400), stripMaterial({ color: 0x2f7dff, intensity: 1.5 }));
    root.add(led);
    anim.strips.push({ mat: led.material, group: 'rings' });
  }

  // light column from the pedestal up into the halo
  const colGeo = new THREE.CylinderGeometry(0.004, Math.tan(THREE.MathUtils.degToRad(9)), 1, 36, 1, true);
  colGeo.translate(0, -0.5, 0);
  const column = new THREE.Mesh(colGeo, beamMaterial(ACC ?? 0x6aa8ff));
  column.frustumCulled = false;
  column.position.set(0, DIM.stageH + 0.35, 0);
  column.rotation.x = Math.PI;
  column.scale.setScalar(tickBot - DIM.stageH - 0.4);
  root.add(column);
  anim.pedestalBeam = column;

  // real lights so the stage furniture catches the rig
  const spotTargets = [0, Math.floor(nSpots / 3), Math.floor((2 * nSpots) / 3)].slice(0, quality.realSpots);
  for (const idx of spotTargets) {
    const b = anim.beams[idx];
    const sl = new THREE.SpotLight(0xdde9ff, 0, 0, b.half * 2.4, 0.7, 2);
    sl.position.copy(b.pos);
    root.add(sl);
    root.add(sl.target);
    anim.spots.push({ light: sl, beam: b });
  }
  const haloLight = new THREE.PointLight(0x3c7dff, 0, 0, 2);
  haloLight.position.set(0, tickBot - 1.0, 0);
  root.add(haloLight);
  anim.haloLight = haloLight;
  const rim = new THREE.DirectionalLight(0x9fc3ff, 0);
  rim.position.set(-20, 30, -30);
  root.add(rim);
  anim.rim = rim;

  // ---------- bowl ----------
  const lowerProfile = [new THREE.Vector2(DIM.floorR, 0), new THREE.Vector2(DIM.floorR, 1.5)];
  const lowerRows = [];
  {
    let r = DIM.floorR;
    let y = 1.5;
    for (let i = 0; i < 19; i++) {
      lowerRows.push({ r: r + 0.55, y });
      lowerProfile.push(new THREE.Vector2(r + 0.95, y));
      r += 0.95;
      y += 0.42;
      lowerProfile.push(new THREE.Vector2(r, y));
    }
    lowerProfile.push(new THREE.Vector2(r + 0.4, y));
    lowerProfile.push(new THREE.Vector2(r + 0.4, y + 2.4));
  }
  const upperProfile = [new THREE.Vector2(43.4, 11.4), new THREE.Vector2(43.4, 13.0)];
  const upperRows = [];
  {
    let r = 43.4;
    let y = 13.0;
    for (let i = 0; i < 22; i++) {
      upperRows.push({ r: r + 0.55, y });
      upperProfile.push(new THREE.Vector2(r + 0.95, y));
      r += 0.95;
      y += 0.55;
      upperProfile.push(new THREE.Vector2(r, y));
    }
    upperProfile.push(new THREE.Vector2(r + 0.4, y));
    upperProfile.push(new THREE.Vector2(r + 0.4, y + 8));
  }
  const sections = 16;
  const gap = THREE.MathUtils.degToRad(1.6);
  const bowlGeos = [];
  for (let s = 0; s < sections; s++) {
    const p0 = (s / sections) * TAU + gap / 2;
    const len = TAU / sections - gap;
    for (const prof of [lowerProfile, upperProfile]) {
      const g = new THREE.LatheGeometry(prof, 18, p0, len).toNonIndexed();
      g.computeVertexNormals();
      bowlGeos.push(g);
    }
  }
  root.add(new THREE.Mesh(merge(bowlGeos), M.bowl));

  const ribbonTex = makeTickerTexture({ items: tickerItems, height: 96, fg: '#cfe2ff', band: '#0a2a80' });
  const ribbon = new THREE.Mesh(
    new THREE.CylinderGeometry(43.37, 43.37, 1.15, 360, 1, true),
    ledMaterial({ map: ribbonTex, grid: [Math.round((TAU * 43.37) / 0.05), 23], intensity: 0.24, side: THREE.BackSide, flip: true, cab: [32, 23] }),
  );
  ribbon.material.uniforms.uRepeat.value = 6;
  ribbon.position.y = 12.25;
  root.add(ribbon);
  anim.leds.push({ mesh: ribbon, group: 'ticker', speed: 0.004 });
  const rails = new THREE.Mesh(
    merge([flatTorus(DIM.floorR - 0.02, 0.035, 1.5, 6, 400), flatTorus(43.36, 0.03, 13.0, 6, 400), flatTorus(43.36, 0.03, 11.45, 6, 400)]),
    stripMaterial({ color: 0x2f7dff, intensity: 2.2 }),
  );
  root.add(rails);
  anim.strips.push({ mat: rails.material, group: 'rings' });

  // crowd lights
  {
    const pts = [];
    for (const rows of [lowerRows, upperRows]) {
      for (const row of rows) {
        const n = Math.floor((TAU * row.r) / 0.52);
        for (let k = 0; k < n; k++) {
          const t = ((k + rand() * 0.4) / n) * TAU;
          const local = ((t % (TAU / sections)) + TAU) % (TAU / sections);
          if (local < gap * 0.9 || local > TAU / sections - gap * 0.9) continue;
          if (rand() > 0.86) continue;
          const pr = row.r + (rand() - 0.5) * 0.2;
          const py = row.y + 0.55 + rand() * 0.25;
          // keep the hero camera's aisle clear
          if (Math.hypot(pr * Math.sin(t), py - 6.6, pr * Math.cos(t) - 33) < 6.5) continue;
          pts.push([pr, py, t]);
        }
      }
    }
    for (let i = pts.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [pts[i], pts[j]] = [pts[j], pts[i]];
    }
    const N = Math.min(pts.length, quality.crowd);
    const pos = new Float32Array(N * 3);
    const data = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      const [r, y, t] = pts[i];
      pos[i * 3] = r * Math.sin(t);
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = r * Math.cos(t);
      data[i * 4] = rand();
      data[i * 4 + 1] = rand();
      data[i * 4 + 2] = 0.09 + rand() * 0.07;
      data[i * 4 + 3] = rand();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aData', new THREE.BufferAttribute(data, 4));
    const crowd = new THREE.Points(g, crowdMaterial());
    if (ACC) crowd.material.uniforms.uWaveColor.value.setHex(ACC);
    crowd.material.uniforms.uAccent.value.setHex(ACC ?? 0x4f8dff);
    crowd.frustumCulled = false;
    root.add(crowd);
    anim.crowd = crowd;
  }

  // roof rigging grid, barely visible in the haze
  {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const count = 2 * 15;
    const inst = new THREE.InstancedMesh(box, M.metalDark, count);
    const m = new THREE.Matrix4();
    let n = 0;
    for (let i = 0; i < 15; i++) {
      const o = (i - 7) * 9;
      inst.setMatrixAt(n++, memberMatrix(new THREE.Vector3(-70, 47, o), new THREE.Vector3(70, 47, o), 0.5, m));
      inst.setMatrixAt(n++, memberMatrix(new THREE.Vector3(o, 46.4, -70), new THREE.Vector3(o, 46.4, 70), 0.5, m));
    }
    inst.instanceMatrix.needsUpdate = true;
    root.add(inst);
  }

  // haze glows
  for (const [pos, sx, sy, color, k] of [
    [[0, 10.5, 0], 44, 30, 0x2f63ff, 0.009],
    [[0, 2.5, 0], 50, 12, 0x1e3fb0, 0.006],
    [[0, 22, 0], 100, 46, 0x16307a, 0.0025],
  ]) {
    const h = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), hazeMaterial(color));
    h.position.set(...pos);
    h.scale.set(sx, sy, 1);
    h.frustumCulled = false;
    h.renderOrder = -1;
    root.add(h);
    anim.hazes.push({ mesh: h, k });
  }

  // bokeh dust (main camera only: layer 1)
  {
    const N = quality.dust;
    const pos = new Float32Array(N * 3);
    const data = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      let p;
      if (i < N * 0.65) {
        const r = Math.sqrt(rand()) * 22;
        const t = rand() * TAU;
        p = polar(r, t, 0.6 + rand() * 20);
      } else {
        p = new THREE.Vector3((rand() - 0.5) * 26, 0.5 + rand() * 9, 8 + rand() * 18);
      }
      pos.set([p.x, p.y, p.z], i * 3);
      data.set([rand(), 0.15 + Math.pow(rand(), 2.0) * 0.85, 0.02 + rand() * 0.035, rand()], i * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aData', new THREE.BufferAttribute(data, 4));
    const dust = new THREE.Points(g, bokehMaterial());
    dust.frustumCulled = false;
    dust.layers.set(1);
    dust.renderOrder = 5;
    root.add(dust);
    anim.dust = dust;
  }

  // ---------- update ----------
  const tmpV = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const PI2 = Math.PI / 2;

  function aimBeams(time, motion) {
    const tm = time * motion;
    let poolIdx = 0;
    const pools = floorMat.uniforms.uPools.value;
    const poolCols = floorMat.uniforms.uPoolCols.value;
    for (const b of anim.beams) {
      if (b.kind === 'spot') {
        if (b.toCrowd) {
          const tt = b.t + 0.35 * Math.sin(tm * 0.11 + b.seed);
          b.target.copy(polar(34, tt, 7 + 4 * Math.sin(tm * 0.07 + b.seed * 2.0)));
        } else {
          const tt = b.t + Math.PI * 0.82 + 0.55 * Math.sin(tm * 0.13 + b.seed);
          const rr = 4.5 + 7.5 * (0.5 + 0.5 * Math.sin(tm * 0.09 + b.seed * 1.7));
          b.target.copy(polar(rr, tt, 0));
          if (rr < DIM.stageR) b.target.y = DIM.stageH;
        }
      } else {
        const tt = b.t + Math.PI + 0.25 * Math.sin(tm * 0.05 + b.seed);
        b.target.copy(polar(9 + 3 * Math.sin(tm * 0.04 + b.seed), tt, 0));
      }
      b.dir.subVectors(b.target, b.pos);
      b.len = b.dir.length();
      b.dir.multiplyScalar(1 / b.len);
      b.beam.quaternion.setFromUnitVectors(_down, b.dir);
      b.beam.scale.setScalar(b.len);
      if (b.head) {
        tmpQ.setFromUnitVectors(_down, b.dir);
        b.head.quaternion.copy(tmpQ);
      }
      if (b.kind === 'spot' && !b.toCrowd && poolIdx < MAX_POOLS) {
        const radius = Math.max(0.6, b.len * Math.tan(b.half) * 1.25);
        pools[poolIdx].set(b.target.x, b.target.y, b.target.z, radius);
        const k = (b.power || 0) * b.gain * 1.4 / (radius * 0.9);
        poolCols[poolIdx].set(b.color.r * k, b.color.g * k, b.color.b * k);
        poolIdx++;
      }
    }
    for (let i = poolIdx; i < MAX_POOLS; i++) poolCols[i].set(0, 0, 0);
  }

  const _m4 = new THREE.Matrix4();
  const _lens = new THREE.Vector3();
  const _toCam = new THREE.Vector3();
  function update({ time, power, motion = 1, camera, viewHeight, pixelRatio = 1 }) {
    const P = power;
    for (const l of anim.leds) {
      const u = l.mesh.material.uniforms;
      u.uTime.value = time;
      u.uOffset.value = (time * l.speed * motion) % 1;
      u.uBoot.value = P[l.group] ?? 1;
      if (l.base === undefined) l.base = u.uIntensity.value;
      u.uIntensity.value = l.base * (1 - 0.32 * (P.screenFocus || 0));
    }
    for (const s of anim.strips) {
      s.mat.uniforms.uTime.value = time;
      s.mat.uniforms.uPower.value = P[s.group] ?? 1;
    }
    floorMat.uniforms.uTime.value = time;
    floorMat.uniforms.uRings.value = P.rings;
    floorMat.uniforms.uCamPos.value.copy(camera.position);

    const flick = P.desks < 1 ? (Math.sin(time * 61.0) > 0.2 ? 1 : 0.35) : 1;
    anim.monitors.color.setScalar(1.35 * P.desks * flick);
    anim.chairPiping.color.setRGB(0.18 * 3.0, 0.45 * 3.0, 1.0 * 3.0).multiplyScalar(P.desks);

    halo.rotation.y = time * 0.035 * motion;

    aimBeams(time, motion);
    const nb = anim.beams.length;
    anim.beams.forEach((b, idx) => {
      const local = THREE.MathUtils.clamp(P.beams * (nb + 6) - idx * 0.9, 0, 1);
      const snap = local > 0 && local < 1 ? 1.0 + 1.6 * (1 - local) : 1.0;
      b.power = local * snap;
      const base = b.kind === 'wash' ? 0.028 : 0.36;
      b.beam.material.uniforms.uIntensity.value = base * b.gain * b.power;
      b.beam.material.uniforms.uTime.value = time;
      if (b.lensMat) b.lensMat.color.copy(b.color).multiplyScalar(6.0 * b.power);
    });
    for (const s of anim.spots) {
      s.light.position.copy(s.beam.pos);
      s.light.target.position.copy(s.beam.target);
      s.light.intensity = 2600 * (s.beam.power || 0);
    }
    anim.haloLight.intensity = 260 * P.halo;
    anim.rim.intensity = 0.15 * P.haze;
    anim.pedestalBeam.material.uniforms.uIntensity.value = 0.32 * P.stage;
    anim.pedestalBeam.material.uniforms.uTime.value = time;

    const cu = anim.crowd.material.uniforms;
    cu.uTime.value = time;
    cu.uPower.value = P.crowd;
    cu.uWave.value = P.waveAngle;
    cu.uWaveOn.value = P.waveOn;
    cu.uWaveWidth.value = P.waveWidth || 30;
    cu.uMotion.value = motion;
    cu.uScale.value = viewHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    {
      const cb = cu.uBeams.value;
      const cbc = cu.uBeamCols.value;
      let ci = 0;
      for (const b of anim.beams) {
        if (!b.toCrowd || ci >= cb.length) continue;
        const radius = Math.max(1.4, b.len * Math.tan(b.half) * 1.8);
        cb[ci].set(b.target.x, b.target.y, b.target.z, radius);
        const k = (b.power || 0) * 0.6;
        cbc[ci].set(b.color.r * k, b.color.g * k, b.color.b * k);
        ci++;
      }
    }

    {
      const fl = anim.flares;
      const fi = fl.geometry.attributes.aIntensity;
      anim.beams.forEach((b, i) => {
        _lens.copy(b.pos).addScaledVector(b.dir, b.kind === 'wash' ? 0.25 : 0.42);
        _m4.makeTranslation(_lens.x, _lens.y, _lens.z);
        fl.setMatrixAt(i, _m4);
        _toCam.subVectors(camera.position, _lens).normalize();
        const facing = Math.max(0, b.dir.dot(_toCam));
        fi.array[i] = (b.power || 0) * (b.kind === 'wash' ? 0.22 : 0.5) * (0.5 + 1.8 * Math.pow(facing, 3));
      });
      fl.instanceMatrix.needsUpdate = true;
      fi.needsUpdate = true;
      fl.material.uniforms.uScale.value = cu.uScale.value;
      fl.material.uniforms.uPixel.value = pixelRatio;
    }

    const du = anim.dust.material.uniforms;
    du.uTime.value = time;
    du.uPower.value = P.dust;
    du.uScale.value = cu.uScale.value;

    for (const h of anim.hazes) {
      h.mesh.material.uniforms.uIntensity.value = h.k * P.haze;
      h.mesh.material.uniforms.uTime.value = time;
    }
  }

  return { root, anim, floor, update, M };
}

// Studio-style environment so metal and lacquer pick up believable highlights.
export function buildEnvironment(renderer) {
  const env = new THREE.Scene();
  const bright = (hex, k) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), side: THREE.DoubleSide });
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(90, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 c = mix(vec3(0.004,0.006,0.012), vec3(0.02,0.04,0.09), smoothstep(-0.1, 0.25, h)); c = mix(c, vec3(0.002), smoothstep(0.5, 1.0, h)); gl_FragColor = vec4(c,1.0); }`,
    }),
  );
  env.add(dome);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(6, 0.9, 10, 64), bright(0x4a86ff, 4));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 11;
  env.add(ring);
  for (let i = 0; i < 16; i++) {
    const t = (i / 16) * TAU;
    const p = polar(10.5, t, 17);
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.3, 1.6), bright(i % 2 ? 0xdde9ff : 0x2f6dff, 8));
    b.position.copy(p);
    env.add(b);
  }
  const floorRing = new THREE.Mesh(new THREE.TorusGeometry(9.4, 0.25, 6, 96), bright(0x2f7dff, 3));
  floorRing.rotation.x = Math.PI / 2;
  env.add(floorRing);
  const crowdBand = new THREE.Mesh(new THREE.CylinderGeometry(40, 50, 20, 64, 1, true), bright(0x1a3a9a, 0.12));
  crowdBand.position.y = 10;
  env.add(crowdBand);
  const key = new THREE.Mesh(new THREE.PlaneGeometry(18, 6), bright(0xcfe0ff, 3));
  key.position.set(-24, 22, 14);
  key.lookAt(0, 4, 0);
  env.add(key);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.04).texture;
  pmrem.dispose();
  return tex;
}
