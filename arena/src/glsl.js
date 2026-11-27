// Shared GLSL chunks.

export const NOISE = /* glsl */ `
float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise3(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i), n100 = hash13(i + vec3(1,0,0)), n010 = hash13(i + vec3(0,1,0)), n110 = hash13(i + vec3(1,1,0));
  float n001 = hash13(i + vec3(0,0,1)), n101 = hash13(i + vec3(1,0,1)), n011 = hash13(i + vec3(0,1,1)), n111 = hash13(i + vec3(1,1,1));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}
float vnoise2(vec2 x){
  vec2 i = floor(x); vec2 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1,0)), f.x), mix(hash12(i + vec2(0,1)), hash12(i + vec2(1,1)), f.x), f.y);
}
float fbm2(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++){ s += a * vnoise2(p); p = p * 2.03 + vec2(17.1, 3.7); a *= 0.5; } return s; }
float fbm3(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++){ s += a * vnoise3(p); p = p * 2.04 + vec3(5.1, 1.3, 7.7); a *= 0.5; } return s; }
`;

// Exponential-squared fog, matching THREE.FogExp2 so custom shaders blend with built-in materials.
export const FOG = /* glsl */ `
uniform vec3 uFogColor;
uniform float uFogDensity;
float fogFactor(float dist){ float d = uFogDensity * dist; return clamp(1.0 - exp(-d * d), 0.0, 1.0); }
vec3 applyFog(vec3 col, float dist){ return mix(col, uFogColor, fogFactor(dist)); }
`;
