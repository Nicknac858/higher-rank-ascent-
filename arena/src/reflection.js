// Planar floor reflection: renders the scene from a mirrored camera into a low-res target,
// then a two-pass gaussian produces a blurred copy. The floor shader mixes the two by a
// roughness noise, which reads as polished epoxy rather than a mirror.
import * as THREE from 'three';

const FS_TRI = new THREE.BufferGeometry();
FS_TRI.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
FS_TRI.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));

function blurMaterial() {
  return new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: { tMap: { value: null }, uDir: { value: new THREE.Vector2(1, 0) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform sampler2D tMap;
      uniform vec2 uDir;
      varying vec2 vUv;
      void main(){
        vec3 c = texture2D(tMap, vUv).rgb * 0.2270270270;
        c += texture2D(tMap, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
        c += texture2D(tMap, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
        c += texture2D(tMap, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
        c += texture2D(tMap, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
}

export function createReflection(renderer, { type = THREE.HalfFloatType } = {}) {
  const opts = { type, depthBuffer: true, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
  const rt = new THREE.WebGLRenderTarget(4, 4, opts);
  const blurA = new THREE.WebGLRenderTarget(4, 4, { ...opts, depthBuffer: false });
  const blurB = new THREE.WebGLRenderTarget(4, 4, { ...opts, depthBuffer: false });
  const mat = blurMaterial();
  const quad = new THREE.Mesh(FS_TRI, mat);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const virtualCamera = new THREE.PerspectiveCamera();
  virtualCamera.layers.set(0);
  const reflectorPlane = new THREE.Plane();
  const normal = new THREE.Vector3();
  const reflectorWorldPosition = new THREE.Vector3();
  const cameraWorldPosition = new THREE.Vector3();
  const rotationMatrix = new THREE.Matrix4();
  const lookAtPosition = new THREE.Vector3(0, 0, -1);
  const clipPlane = new THREE.Vector4();
  const view = new THREE.Vector3();
  const target = new THREE.Vector3();
  const q = new THREE.Vector4();
  const textureMatrix = new THREE.Matrix4();

  let scale = 0.5;
  let w = 4;
  let h = 4;

  function setSize(width, height, s = scale) {
    scale = s;
    w = Math.max(4, Math.floor(width * scale));
    h = Math.max(4, Math.floor(height * scale));
    rt.setSize(w, h);
    const bw = Math.max(4, Math.floor(w * 0.5));
    const bh = Math.max(4, Math.floor(h * 0.5));
    blurA.setSize(bw, bh);
    blurB.setSize(bw, bh);
  }

  function blurPass(src, dst, dx, dy) {
    mat.uniforms.tMap.value = src.texture;
    mat.uniforms.uDir.value.set(dx / dst.width, dy / dst.height);
    renderer.setRenderTarget(dst);
    renderer.render(quadScene, quadCam);
  }

  // mirror: the floor mesh (a horizontal plane whose local +Z is world +Y)
  function update(scene, camera, mirror, hide = []) {
    reflectorWorldPosition.setFromMatrixPosition(mirror.matrixWorld);
    cameraWorldPosition.setFromMatrixPosition(camera.matrixWorld);
    rotationMatrix.extractRotation(mirror.matrixWorld);
    normal.set(0, 0, 1).applyMatrix4(rotationMatrix);
    view.subVectors(reflectorWorldPosition, cameraWorldPosition);
    if (view.dot(normal) > 0) return false;
    view.reflect(normal).negate();
    view.add(reflectorWorldPosition);
    rotationMatrix.extractRotation(camera.matrixWorld);
    lookAtPosition.set(0, 0, -1).applyMatrix4(rotationMatrix);
    lookAtPosition.add(cameraWorldPosition);
    target.subVectors(reflectorWorldPosition, lookAtPosition);
    target.reflect(normal).negate();
    target.add(reflectorWorldPosition);
    virtualCamera.position.copy(view);
    virtualCamera.up.set(0, 1, 0).applyMatrix4(rotationMatrix).reflect(normal);
    virtualCamera.lookAt(target);
    virtualCamera.far = camera.far;
    virtualCamera.updateMatrixWorld();
    virtualCamera.projectionMatrix.copy(camera.projectionMatrix);

    textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    textureMatrix.multiply(virtualCamera.projectionMatrix);
    textureMatrix.multiply(virtualCamera.matrixWorldInverse);
    textureMatrix.multiply(mirror.matrixWorld);

    reflectorPlane.setFromNormalAndCoplanarPoint(normal, reflectorWorldPosition);
    reflectorPlane.applyMatrix4(virtualCamera.matrixWorldInverse);
    clipPlane.set(reflectorPlane.normal.x, reflectorPlane.normal.y, reflectorPlane.normal.z, reflectorPlane.constant);
    const pm = virtualCamera.projectionMatrix;
    q.x = (Math.sign(clipPlane.x) + pm.elements[8]) / pm.elements[0];
    q.y = (Math.sign(clipPlane.y) + pm.elements[9]) / pm.elements[5];
    q.z = -1.0;
    q.w = (1.0 + pm.elements[10]) / pm.elements[14];
    clipPlane.multiplyScalar(2.0 / clipPlane.dot(q));
    pm.elements[2] = clipPlane.x;
    pm.elements[6] = clipPlane.y;
    pm.elements[10] = clipPlane.z + 1.0 - 0.003;
    pm.elements[14] = clipPlane.w;

    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    mirror.visible = false;
    hide.forEach((o) => { o.visible = false; });
    renderer.autoClear = true;
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, virtualCamera);
    mirror.visible = true;
    hide.forEach((o) => { o.visible = true; });
    blurPass(rt, blurA, 1, 0);
    blurPass(blurA, blurB, 0, 1);
    blurPass(blurB, blurA, 2, 0);
    blurPass(blurA, blurB, 0, 2);
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
    return true;
  }

  return {
    setSize,
    update,
    textureMatrix,
    get sharp() { return rt.texture; },
    get blurred() { return blurB.texture; },
    get scale() { return scale; },
  };
}
