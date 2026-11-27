/* Sky: gradient dome (zenith -> horizon -> below-horizon = fog colour, so there is no void), sun disc and glow, moon disc with a
   real terminator, and a star field that rotates with the sidereal angle. One draw call for the dome, one for the stars.
   Colour management: uniforms are linear working-space colours (THREE.Color from sRGB), the shader ends with colorspace_fragment. */
import { BackSide, BufferGeometry, Color, Float32BufferAttribute, Mesh, Points, ShaderMaterial, SphereGeometry, SRGBColorSpace, Vector3 } from 'three';

export const SKY_RADIUS = 9000;
const MOON_ANG = 0.033;   // angular radius (rad), larger than the real 0.0045 so it reads
const SUN_ANG = 0.034;

const DOME_VS = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w;   // always at the far plane
}`;

const DOME_FS = /* glsl */`
uniform vec3 uZenith, uHorizon, uSunDir, uSunCol, uMoonDir, uMoonRight, uMoonUp;
uniform vec3 uDuskCol;
uniform float uDusk;
uniform float uSunGlow, uSunVis, uMoonVis, uMoonGlow, uCosSun, uMoonR;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(smoothstep(-0.02, 0.9, h), 0.62));
  // dusk/dawn: warm glow hugging the horizon, strongest on the sun side
  float hz = exp(-abs(h) * 8.0);
  float side = pow(max(dot(normalize(d.xz + 1e-5), normalize(uSunDir.xz + 1e-5)), 0.0), 2.5);
  col += uDuskCol * hz * (0.15 + 0.85 * side) * uDusk * 1.5;
  // sun glow and disc
  float sd = max(dot(d, uSunDir), 0.0);
  float above = smoothstep(-0.03, 0.03, h);
  col += uSunCol * (pow(sd, 5.0) * 0.14 + pow(sd, 40.0) * 0.30) * uSunGlow * (0.35 + 0.65 * above);
  float disc = smoothstep(uCosSun - 0.00018, uCosSun + 0.00012, sd) * above * uSunVis;
  col = mix(col, uSunCol * 1.5 + 0.2, disc);
  // moon with phase (n is the sphere normal facing the viewer, expressed in the (right, up, moonDir) basis)
  float md = dot(d, uMoonDir);
  col += vec3(0.55, 0.62, 0.85) * (pow(max(md, 0.0), 220.0) * 0.35 + pow(max(md, 0.0), 40.0) * 0.05) * uMoonGlow * above;
  if (md > 0.97) {
    vec3 rel = d - uMoonDir * md;
    float px = dot(rel, uMoonRight) / uMoonR, py = dot(rel, uMoonUp) / uMoonR;
    float rr = px * px + py * py;
    if (rr < 1.0) {
      vec3 n = vec3(px, py, -sqrt(1.0 - rr));
      vec3 L = vec3(dot(uSunDir, uMoonRight), dot(uSunDir, uMoonUp), dot(uSunDir, uMoonDir));
      float lit = smoothstep(-0.06, 0.12, dot(n, L));
      float maria = 0.9 + 0.1 * sin(px * 2.3 + 1.3) * sin(py * 2.1 - 0.7);
      vec3 mc = mix(vec3(0.045, 0.055, 0.085), vec3(0.93, 0.91, 0.82) * maria, lit);
      float a = (1.0 - smoothstep(0.90, 1.0, sqrt(rr))) * uMoonVis * smoothstep(-0.02, 0.03, h);
      col = mix(col, mc, a);
    }
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const STAR_VS = /* glsl */`
attribute float aSize;
attribute float aBright;
attribute float aPhase;
attribute vec3 aColor;
uniform float uPx, uTime;
varying vec3 vCol;
varying float vA;
void main() {
  vCol = aColor;
  vA = aBright * (0.78 + 0.22 * sin(uTime * (1.2 + aPhase * 2.0) + aPhase * 40.0));
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uPx;
}`;
const STAR_FS = /* glsl */`
uniform float uNight;
varying vec3 vCol;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = (1.0 - smoothstep(0.05, 0.5, d)) * vA * uNight * 1.3;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vCol, a);
  #include <colorspace_fragment>
}`;

function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

export function createSky(scope, scene, opts = {}) {
  const lat = opts.lat || 0.81;
  // dome
  const domeGeo = scope.track(new SphereGeometry(SKY_RADIUS, 48, 24));
  const domeUniforms = {
    uZenith: { value: new Color() }, uHorizon: { value: new Color() }, uSunDir: { value: new Vector3(0, 1, 0) }, uSunCol: { value: new Color() },
    uMoonDir: { value: new Vector3(0, -1, 0) }, uMoonRight: { value: new Vector3(1, 0, 0) }, uMoonUp: { value: new Vector3(0, 1, 0) },
    uDuskCol: { value: new Color() }, uDusk: { value: 0 },
    uSunGlow: { value: 1 }, uSunVis: { value: 1 }, uMoonVis: { value: 0 }, uMoonGlow: { value: 0 }, uCosSun: { value: Math.cos(SUN_ANG) }, uMoonR: { value: Math.sin(MOON_ANG) },
  };
  const domeMat = scope.track(new ShaderMaterial({ vertexShader: DOME_VS, fragmentShader: DOME_FS, uniforms: domeUniforms, side: BackSide, depthWrite: false, depthTest: false, fog: false }));
  const dome = new Mesh(domeGeo, domeMat);
  dome.renderOrder = -1000;
  dome.frustumCulled = false; dome.userData.cat = 'sky';
  scope.add(scene, dome);

  // stars: unit vectors in the equatorial frame, rotated by the sidereal angle each frame
  const NS = 1700, rnd = lcg(90210);
  const pos = new Float32Array(NS * 3), size = new Float32Array(NS), bright = new Float32Array(NS), phase = new Float32Array(NS), col = new Float32Array(NS * 3);
  const tint = [[1, 1, 1], [1, 0.9, 0.75], [0.75, 0.85, 1]];
  for (let i = 0; i < NS; i++) {
    const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    pos[i * 3] = r * Math.cos(a) * 8500; pos[i * 3 + 1] = r * Math.sin(a) * 8500; pos[i * 3 + 2] = z * 8500;
    const m = Math.pow(rnd(), 5);                      // few bright stars, many faint
    size[i] = 2.4 + m * 4.2; bright[i] = 0.6 + m * 0.4; phase[i] = rnd();
    const t = tint[rnd() < 0.7 ? 0 : rnd() < 0.5 ? 1 : 2];
    const c = new Color().setRGB(t[0], t[1], t[2], SRGBColorSpace);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const starGeo = scope.track(new BufferGeometry());
  starGeo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  starGeo.setAttribute('aSize', new Float32BufferAttribute(size, 1));
  starGeo.setAttribute('aBright', new Float32BufferAttribute(bright, 1));
  starGeo.setAttribute('aPhase', new Float32BufferAttribute(phase, 1));
  starGeo.setAttribute('aColor', new Float32BufferAttribute(col, 3));
  const starUniforms = { uPx: { value: 1 }, uTime: { value: 0 }, uNight: { value: 0 } };
  const starMat = scope.track(new ShaderMaterial({ vertexShader: STAR_VS, fragmentShader: STAR_FS, uniforms: starUniforms, transparent: true, depthWrite: false, fog: false }));
  const stars = new Points(starGeo, starMat);
  stars.renderOrder = -999;
  stars.frustumCulled = false; stars.userData.cat = 'sky';
  stars.matrixAutoUpdate = false;
  scope.add(scene, stars);

  const sinLat = Math.sin(lat), cosLat = Math.cos(lat);
  const up = new Vector3(0, 1, 0), mr = new Vector3(), mu = new Vector3();
  let time = 0;

  return {
    dome, stars,
    /* A: atmosphere output (atmosphere.js), cam: camera position {x,y,z}, cloud 0..1, dt real seconds, px device pixel ratio */
    update(A, cam, cloud, dt, px) {
      time += dt;
      dome.position.set(cam.x, cam.y, cam.z);
      const u = domeUniforms;
      u.uZenith.value.setRGB(A.zenith[0], A.zenith[1], A.zenith[2], SRGBColorSpace);
      u.uHorizon.value.setRGB(A.horizon[0], A.horizon[1], A.horizon[2], SRGBColorSpace);
      u.uSunCol.value.setRGB(A.sunCol[0], A.sunCol[1], A.sunCol[2], SRGBColorSpace);
      u.uSunDir.value.set(A.sunDir[0], A.sunDir[1], A.sunDir[2]);
      u.uMoonDir.value.set(A.moonDir[0], A.moonDir[1], A.moonDir[2]);
      mr.copy(u.uMoonDir.value).cross(up);
      if (mr.lengthSq() < 1e-8) mr.set(1, 0, 0);
      mr.normalize();
      mu.copy(mr).cross(u.uMoonDir.value);
      u.uMoonRight.value.copy(mr); u.uMoonUp.value.copy(mu);
      u.uDuskCol.value.setRGB(A.duskCol[0], A.duskCol[1], A.duskCol[2], SRGBColorSpace);
      u.uDusk.value = A.dusk * (1 - 0.6 * cloud);
      u.uSunGlow.value = Math.max(0, Math.min(1, (A.sunSin + 0.14) / 0.2)) * (1 - 0.7 * cloud);
      u.uSunVis.value = 1 - 0.85 * cloud;
      u.uMoonVis.value = (1 - 0.8 * cloud) * Math.max(0, Math.min(1, (A.moonSin + 0.02) / 0.05));
      u.uMoonGlow.value = A.illum * (1 - 0.8 * cloud);
      // stars: equatorial -> horizon rotation for the sidereal angle, translated to the camera
      const L = A.lst, sL = Math.sin(L), cL = Math.cos(L);
      stars.matrix.set(
        -sL, cL, 0, cam.x,
        cosLat * cL, cosLat * sL, sinLat, cam.y,
        sinLat * cL, sinLat * sL, -cosLat, cam.z,
        0, 0, 0, 1);
      stars.matrixWorldNeedsUpdate = true;
      starUniforms.uNight.value = A.night;
      starUniforms.uTime.value = time;
      starUniforms.uPx.value = px;
    },
  };
}
