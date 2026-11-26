export const VERTEX = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

// Raymarched cloud layer; uAscent lifts the camera through it
export const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uMouse;
uniform float uAscent;
out vec4 outColor;

const float BOTTOM = 0.0;
const float TOP = 2.4;
const vec3 SUN = normalize(vec3(0.55, 0.42, 0.72));
const vec3 SUNBREAK = vec3(0.961, 0.773, 0.259);

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x),
        mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
        mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

float fbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 5; i++) {
    s += a * noise(p);
    p = p * 2.03 + vec3(0.13, 0.71, 0.37);
    a *= 0.5;
  }
  return s;
}

float density(vec3 p) {
  vec3 q = p * 0.42 + vec3(uTime * 0.035, 0.0, uTime * 0.02);
  float shape = fbm(q);
  float h = (p.y - BOTTOM) / (TOP - BOTTOM);
  float band = smoothstep(0.0, 0.25, h) * smoothstep(1.0, 0.45, h);
  return clamp((shape * band - 0.2) * 2.6, 0.0, 1.0);
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - uRes) / uRes.y;
  float a = smoothstep(0.0, 1.0, uAscent);
  vec3 ro = vec3(uTime * 0.04, mix(-0.9, 4.2, a), uTime * 0.08);
  float pitch = mix(0.32, -0.42, a) + uMouse.y * 0.05;
  float yaw = uMouse.x * 0.08;
  vec3 fw = normalize(vec3(sin(yaw), pitch, cos(yaw)));
  vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), fw));
  vec3 up = cross(fw, rt);
  vec3 rd = normalize(fw * 1.7 + uv.x * rt + uv.y * up);

  float sunAmt = max(dot(rd, SUN), 0.0);
  float clear = smoothstep(0.55, 1.0, a);
  vec3 skyLow = mix(vec3(0.80, 0.84, 0.87), vec3(0.93, 0.95, 0.96), clear);
  vec3 skyHigh = mix(vec3(0.70, 0.76, 0.81), vec3(0.78, 0.85, 0.92), clear);
  vec3 sky = mix(skyLow, skyHigh, clamp(rd.y * 1.4 + 0.25, 0.0, 1.0));
  sky += SUNBREAK * pow(sunAmt, 6.0) * mix(0.12, 0.45, clear);
  sky += vec3(1.0, 0.98, 0.92) * pow(sunAmt, 90.0) * mix(0.2, 0.9, clear);

  // Only march where the ray is inside the cloud slab
  float tA = (BOTTOM - ro.y) / rd.y;
  float tB = (TOP - ro.y) / rd.y;
  float tNear = max(min(tA, tB), 0.0);
  float tFar = min(max(tA, tB), 22.0);
  if (abs(rd.y) < 0.0001) {
    tNear = 0.0;
    tFar = 22.0;
  }

  vec4 acc = vec4(0.0);
  if (tFar > tNear) {
    float stepLen = (tFar - tNear) / 64.0;
    float t = tNear + stepLen * hash(vec3(gl_FragCoord.xy, fract(uTime)));
    for (int i = 0; i < 64; i++) {
      if (acc.a > 0.96 || t > tFar) break;
      vec3 p = ro + rd * t;
      float d = density(p);
      if (d > 0.005) {
        float lit = clamp((d - density(p + SUN * 0.4)) * 2.4, 0.0, 1.0);
        float height = clamp((p.y - BOTTOM) / (TOP - BOTTOM), 0.0, 1.0);
        vec3 shade = mix(vec3(0.55, 0.62, 0.69), vec3(0.98, 0.99, 1.0), 0.35 + 0.45 * height + 0.3 * lit);
        shade += SUNBREAK * lit * 0.22;
        float fog = 1.0 - exp(-t * 0.05);
        shade = mix(shade, sky, fog);
        float alpha = clamp(d * stepLen * 2.2, 0.0, 1.0);
        acc.rgb += shade * alpha * (1.0 - acc.a);
        acc.a += alpha * (1.0 - acc.a);
      }
      t += stepLen;
    }
  }

  vec3 col = acc.rgb + sky * (1.0 - acc.a);
  col = pow(col, vec3(0.95));
  outColor = vec4(col, 1.0);
}
`;
