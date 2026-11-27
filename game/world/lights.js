/* Light rig (render-port-map section 4). Constant light count: 1 key DirectionalLight (sun cross-fading to moon, the only shadow
   caster, texel-snapped), 1 HemisphereLight (with a night floor), 1 torch SpotLight, 1 torch halo PointLight = 4 lights.
   Intensities are changed, `visible` and `castShadow` never are, so shaders do not recompile at dusk.
   Light units are three's physical ones (no 1/pi legacy factor): noon sun ~3, hemisphere ~1.3 (see atmosphere.js). */
import { Color, DirectionalLight, HemisphereLight, PointLight, SpotLight, SRGBColorSpace, Vector3 } from 'three';

const SHADOW_SIZES = { low: 512, medium: 1024, high: 2048 };
const TORCH_COLOR = [1.0, 0.86, 0.62];
const TORCH_SPOT_I = 70, TORCH_HALO_I = 34;

export function createLights(scope, scene) {
  const hemi = new HemisphereLight(0xffffff, 0x444444, 1);
  scope.add(scene, hemi);

  const key = new DirectionalLight(0xffffff, 1);
  key.castShadow = true;
  let shadowSize = SHADOW_SIZES.medium;
  key.shadow.mapSize.set(shadowSize, shadowSize);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.5;
  key.shadow.radius = 2;
  scope.add(scene, key);
  scope.add(scene, key.target);
  scope.onDispose(() => key.shadow.dispose());

  const spot = new SpotLight(0xffdc9e, 0, 62, 0.62, 1.0, 1.2);
  spot.castShadow = false;
  scope.add(scene, spot);
  scope.add(scene, spot.target);
  const halo = new PointLight(0xffdc9e, 0, 9, 2);
  scope.add(scene, halo);
  spot.color.setRGB(TORCH_COLOR[0], TORCH_COLOR[1], TORCH_COLOR[2], SRGBColorSpace);
  halo.color.copy(spot.color);

  const torch = { x: 0, y: 0, z: 0, dx: 0, dz: 1, on: false, k: 0, eff: 0 };
  const tgt = new Vector3(), right = new Vector3(), upv = new Vector3(), ld = new Vector3(), up = new Vector3(0, 1, 0);
  const col = new Color();
  const shadowTarget = new Vector3(), lastTarget = new Vector3(), lastLd = new Vector3(0, 1, 0);
  let lastExt = 0, lastShadowT = -1e9, clock = 0, dirty = true;
  const COS_SUN = Math.cos(0.2 * Math.PI / 180);   // re-render the shadow map when the sun moved more than 0.2 deg

  return {
    key, hemi, spot, halo,
    get torchLevel() { return torch.eff; },
    /* The shadow map is re-rendered only when asked (renderer.shadowMap.autoUpdate = false): returns true once when the focus moved > 2 m,
       the key direction moved > 0.2 deg, the box size changed, or the map is older than 0.5 s while the focus is moving / 1 s otherwise. */
    takeShadowDirty() { const d = dirty; dirty = false; return d; },
    invalidateShadow() { dirty = true; },
    /* quality: 'low' (no shadows) | 'medium' (1024) | 'high' (2048). Toggling castShadow recompiles once; fine for a governor. */
    setQuality(q) {
      const on = q !== 'low', size = SHADOW_SIZES[q] || SHADOW_SIZES.medium;
      key.castShadow = on;
      dirty = true;
      if (size !== shadowSize) {
        shadowSize = size; key.shadow.mapSize.set(size, size);
        if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
      }
    },
    setTorch(t) {
      torch.x = t.x; torch.y = t.y; torch.z = t.z;
      torch.dx = t.dx || 0; torch.dz = t.dz || 0;
      torch.on = !!t.on;
    },
    /* A: atmosphere output; focus {x,y,z}: camera look-at point (shadow box centre); camDist: camera-to-focus distance (shadow box size) */
    update(A, focus, camDist, dt) {
      clock += dt;
      col.setRGB(A.hemiSky[0], A.hemiSky[1], A.hemiSky[2], SRGBColorSpace); hemi.color.copy(col);
      col.setRGB(A.hemiGround[0], A.hemiGround[1], A.hemiGround[2], SRGBColorSpace); hemi.groundColor.copy(col);
      hemi.intensity = A.hemiI;

      key.color.setRGB(A.keyCol[0], A.keyCol[1], A.keyCol[2], SRGBColorSpace);
      key.intensity = A.keyI;
      // shadow box: follows the focus, sized by camera distance, snapped to shadow texels so edges do not shimmer
      const ext = Math.max(120, Math.min(720, camDist * 0.75 + 60));
      const sc = key.shadow.camera;
      if (sc.right !== ext) { sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 10; sc.far = 3600; sc.updateProjectionMatrix(); }
      ld.set(A.keyDir[0], Math.max(A.keyDir[1], 0.05), A.keyDir[2]).normalize();   // shadow camera only: never look from below the ground
      right.crossVectors(up, ld).normalize();
      upv.crossVectors(ld, right);
      const texel = (2 * ext) / shadowSize;
      const pr = focus.x * right.x + focus.y * right.y + focus.z * right.z;
      const pu = focus.x * upv.x + focus.y * upv.y + focus.z * upv.z;
      const sr = Math.round(pr / texel) * texel - pr, su = Math.round(pu / texel) * texel - pu;
      shadowTarget.set(focus.x + right.x * sr + upv.x * su, focus.y + right.y * sr + upv.y * su, focus.z + right.z * sr + upv.z * su);
      const mv = Math.hypot(shadowTarget.x - lastTarget.x, shadowTarget.y - lastTarget.y, shadowTarget.z - lastTarget.z), age = clock - lastShadowT;
      if (ext !== lastExt || ld.dot(lastLd) < COS_SUN || mv > 2 || (mv > 0.05 && age > 0.15) || age > (mv > 0.05 ? 0.5 : 1.0)) {
        dirty = true; lastExt = ext; lastTarget.copy(shadowTarget); lastLd.copy(ld); lastShadowT = clock;
      }
      key.target.position.copy(shadowTarget);
      key.position.set(shadowTarget.x + ld.x * 1800, shadowTarget.y + ld.y * 1800, shadowTarget.z + ld.z * 1800);
      key.target.updateMatrixWorld();

      // torch: eased on/off (intensity only)
      const goal = torch.on ? 1 : 0;
      torch.k += (goal - torch.k) * Math.min(1, dt * 10);
      if (Math.abs(goal - torch.k) < 1e-3) torch.k = goal;
      const dark = 1 - 0.97 * Math.min(1, Math.max(0, A.sunSin / 0.25));   // negligible in daylight
      torch.eff = torch.k * dark;
      spot.intensity = TORCH_SPOT_I * torch.k * dark;
      halo.intensity = TORCH_HALO_I * torch.k * dark;
      const eye = torch.y;
      spot.position.set(torch.x, eye, torch.z);
      const l = Math.hypot(torch.dx, torch.dz) || 1;
      tgt.set(torch.x + (torch.dx / l) * 12, torch.y - 3.2, torch.z + (torch.dz / l) * 12);   // pitched ~15 deg down
      spot.target.position.copy(tgt);
      spot.target.updateMatrixWorld();
      halo.position.set(torch.x, torch.y - 0.4, torch.z);
    },
  };
}
