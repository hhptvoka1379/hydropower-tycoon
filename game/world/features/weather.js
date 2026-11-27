/* Weather feature (D9, milestone M8): rain streaks and snow flakes that live in a box following the camera and fade out toward every face of it
   (no visible box edge), and a storm-darkening factor for the sky / light owner.
   Intensity comes from env.rain (mm/h of the sim climate) and env.snow / temperature; see envread.js.
   Hook for the sky/lights owner:  env.stormDarken (0..1, written every frame) == feature.state.darken == world.weather.darken.
   Suggested use: key and hemisphere intensity *= 1 - 0.35 * darken; zenith/horizon colour mixed toward a grey by 0.5 * darken.
   Cloud shadows: not implemented (not cheap enough for the benefit). */
import { BufferAttribute, BufferGeometry, LineSegments, Points, ShaderMaterial, Vector3 } from 'three';
import { hash3, clamp01, smoothstep } from './hash.js';
import { createEnvReader } from './envread.js';

export const RAIN_N = 9000, SNOW_N = 6000;
const BOX = [64, 44, 64];

const RAIN_VS = `
attribute float aEnd;
uniform vec3 uCenter; uniform vec3 uBox; uniform float uTime; uniform vec3 uVel; uniform float uLen; uniform float uAlpha;
varying float vA;
void main() {
  vec3 rel = mod( position * uBox + uVel * uTime - uCenter + uBox * 0.5, uBox ) - uBox * 0.5;
  vec3 p = uCenter + rel;
  vec3 q = abs( rel ) / ( uBox * 0.5 );
  float e = ( 1.0 - smoothstep( 0.55, 1.0, max( q.x, q.z ) ) ) * ( 1.0 - smoothstep( 0.6, 1.0, q.y ) );
  float near = smoothstep( 1.2, 5.0, distance( p, cameraPosition ) );
  vA = e * near * uAlpha;
  vec3 dir = normalize( uVel );
  p -= dir * uLen * aEnd;
  gl_Position = projectionMatrix * viewMatrix * vec4( p, 1.0 );
}`;
const RAIN_FS = `uniform vec3 uColor; varying float vA; void main() { gl_FragColor = vec4( uColor, vA * 0.55 ); }`;
const SNOW_VS = `
attribute float aSize;
uniform vec3 uCenter; uniform vec3 uBox; uniform float uTime; uniform vec3 uVel; uniform float uScale; uniform float uAlpha;
varying float vA;
void main() {
  vec3 w = position * uBox + uVel * uTime;
  w.x += sin( uTime * 0.9 + position.y * 37.0 ) * 0.9; w.z += cos( uTime * 0.7 + position.x * 41.0 ) * 0.9;
  vec3 rel = mod( w - uCenter + uBox * 0.5, uBox ) - uBox * 0.5;
  vec3 p = uCenter + rel;
  vec3 q = abs( rel ) / ( uBox * 0.5 );
  float e = ( 1.0 - smoothstep( 0.55, 1.0, max( q.x, q.z ) ) ) * ( 1.0 - smoothstep( 0.6, 1.0, q.y ) );
  vec4 mv = viewMatrix * vec4( p, 1.0 );
  float near = smoothstep( 0.8, 3.5, -mv.z );
  vA = e * near * uAlpha;
  gl_PointSize = clamp( aSize * uScale / max( 0.5, -mv.z ), 1.0, 22.0 );
  gl_Position = projectionMatrix * mv;
}`;
const SNOW_FS = `varying float vA; void main() { float d = length( gl_PointCoord - 0.5 ); if ( d > 0.5 ) discard; gl_FragColor = vec4( vec3( 0.95, 0.97, 1.0 ), vA * smoothstep( 0.5, 0.15, d ) ); }`;

export function makeWeather(world) {
  const readEnv = createEnvReader();
  const state = { rain: 0, snow: 0, storm: 0, darken: 0, wind: 0 };
  const fwd = new Vector3();
  let S = null, time = 0, stormK = 0, rainK = 0, snowK = 0;

  const feature = {
    name: 'weather',
    signature: () => 'weather1',
    state,
    build(scope, site, surface, env) {
      const scene = (env && env.scene) || world.scene;
      const seeds = (n, extra) => {
        const p = new Float32Array(n * 3), x = new Float32Array(n);
        for (let i = 0; i < n; i++) { p[i * 3] = hash3(11, i, 1); p[i * 3 + 1] = hash3(11, i, 2); p[i * 3 + 2] = hash3(11, i, 3); x[i] = extra(i); }
        return [p, x];
      };
      // rain: each streak = 2 vertices (head, tail) sharing a seed
      const [rp, re] = (() => { const p = new Float32Array(RAIN_N * 6), e = new Float32Array(RAIN_N * 2); for (let i = 0; i < RAIN_N; i++) for (let k = 0; k < 2; k++) { const o = (i * 2 + k) * 3; p[o] = hash3(11, i, 1); p[o + 1] = hash3(11, i, 2); p[o + 2] = hash3(11, i, 3); e[i * 2 + k] = k; } return [p, e]; })();
      const rg = scope.track(new BufferGeometry());
      rg.setAttribute('position', new BufferAttribute(rp, 3)); rg.setAttribute('aEnd', new BufferAttribute(re, 1));
      rg.setDrawRange(0, 0);
      const ru = { uCenter: { value: new Vector3() }, uBox: { value: new Vector3(BOX[0], BOX[1], BOX[2]) }, uTime: { value: 0 }, uVel: { value: new Vector3(0, -17, 0) }, uLen: { value: 0.9 }, uAlpha: { value: 0 }, uColor: { value: new Vector3(0.74, 0.82, 0.9) } };
      const rm = scope.track(new ShaderMaterial({ vertexShader: RAIN_VS, fragmentShader: RAIN_FS, uniforms: ru, transparent: true, depthWrite: false }));
      const rain = new LineSegments(rg, rm); rain.frustumCulled = false; rain.renderOrder = 5; rain.name = 'weather-rain'; rain.visible = false;
      scope.add(scene, rain);
      const [sp, ss] = seeds(SNOW_N, (i) => 0.05 + hash3(11, i, 4) * 0.07);
      const sg = scope.track(new BufferGeometry());
      sg.setAttribute('position', new BufferAttribute(sp, 3)); sg.setAttribute('aSize', new BufferAttribute(ss, 1));
      sg.setDrawRange(0, 0);
      const su = { uCenter: { value: new Vector3() }, uBox: { value: new Vector3(BOX[0], BOX[1], BOX[2]) }, uTime: { value: 0 }, uVel: { value: new Vector3(0, -1.3, 0) }, uScale: { value: 700 }, uAlpha: { value: 0 } };
      const sm = scope.track(new ShaderMaterial({ vertexShader: SNOW_VS, fragmentShader: SNOW_FS, uniforms: su, transparent: true, depthWrite: false }));
      const snow = new Points(sg, sm); snow.frustumCulled = false; snow.renderOrder = 5; snow.name = 'weather-snow'; snow.visible = false;
      scope.add(scene, snow);
      S = { rain, snow, rg, sg, ru, su, surface, site };
      if (world && world.weather === undefined) world.weather = state;
      scope.onDispose(() => { if (S && S.rain === rain) S = null; });
    },

    frame(dt, env) {
      dt = Math.min(dt > 0 ? dt : 0, 0.1);
      const E = readEnv(env, env && env.site), k = Math.min(1, dt * 0.8);
      rainK += (E.rain - rainK) * k; snowK += (E.snowing - snowK) * k;
      stormK += (E.storm - stormK) * k * 0.5;
      state.rain = rainK; state.snow = snowK; state.storm = stormK; state.wind = E.wind;
      // storms darken the day; heavy rain or snow a little (0..1)
      state.darken = clamp01(0.7 * stormK + 0.35 * Math.max(rainK, snowK * 0.8) * (0.5 + 0.5 * clamp01(E.cloud + 0.4)));
      if (env && typeof env === 'object') env.stormDarken = state.darken;
      if (!S) return;
      time = (time + dt) % 997;
      const cam = env && env.camera;
      if (!cam) { S.rain.visible = S.snow.visible = false; return; }
      cam.getWorldDirection(fwd);
      const ground = S.surface.y(cam.position.x, cam.position.z), h = Math.max(0, cam.position.y - ground);
      const alt = 1 - smoothstep(120, 420, h), grow = 1 + Math.min(1.5, h / 80);
      const cx = cam.position.x + fwd.x * 18 * grow, cy = cam.position.y + 6 + (h > 60 ? -h * 0.25 : 0), cz = cam.position.z + fwd.z * 18 * grow;
      const wv = E.windDir, drift = Math.min(E.wind, 20) * 0.45;
      // rain
      const nr = Math.floor(RAIN_N * rainK);
      S.rain.visible = nr > 20 && alt > 0.01;
      if (S.rain.visible) {
        const u = S.ru;
        u.uCenter.value.set(cx, cy, cz); u.uBox.value.set(BOX[0] * grow, BOX[1] * grow, BOX[2] * grow);
        u.uVel.value.set(Math.sin(wv) * drift, -(14 + 7 * rainK), Math.cos(wv) * drift);
        u.uTime.value = time; u.uLen.value = 0.7 + 0.6 * rainK;
        u.uAlpha.value = alt * (0.5 + 0.5 * rainK) * (1 - 0.6 * clamp01(E.night));
        S.rg.setDrawRange(0, nr * 2);
      }
      // snow
      const ns = Math.floor(SNOW_N * snowK);
      S.snow.visible = ns > 20 && alt > 0.01;
      if (S.snow.visible) {
        const u = S.su, vh = (env.view && env.view.height) || 720, dpr = (env.view && env.view.dpr) || 1;
        u.uCenter.value.set(cx, cy, cz); u.uBox.value.set(BOX[0] * grow, BOX[1] * grow, BOX[2] * grow);
        u.uVel.value.set(Math.sin(wv) * drift * 0.6, -1.3, Math.cos(wv) * drift * 0.6);
        u.uTime.value = time; u.uScale.value = vh * dpr * 0.5 / Math.tan(cam.fov * Math.PI / 360);
        u.uAlpha.value = alt * (0.45 + 0.4 * snowK) * (0.55 + 0.45 * (1 - clamp01(E.night)));
        S.sg.setDrawRange(0, ns);
      }
    },
  };
  return feature;
}
