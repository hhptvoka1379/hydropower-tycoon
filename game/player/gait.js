/* Gait numbers (pure). The demo's pose swings the hip by A = (0.46 + 0.18 climb) * move radians and the stance foot is planted when
   stride = 2 pi * legLength * A (the demo's own 2.8 m). Her walk is 5 m/s and her run 11 m/s, so the swing is scaled with speed (amp, capped at 1.8) and the
   stride follows from it: about 3.6 m walking (1.4 cycles/s), 4.7 m running (2.3 cycles/s). The avatar multiplies the hip, knee and arm angles by amp. */
export const AMP = (speed) => Math.min(1.8, 0.78 + 0.12 * speed);
export const strideOf = (speed, climb, leg) => 6.2831853 * leg * (0.46 + 0.18 * climb) * AMP(speed);
/* horizontal speed of the stance foot relative to the ground, as a fraction of body speed, for a body of the given rig (0 = perfectly planted) */
export function footSlip(body, speed, climb = 0) {
  const rig = body.rig, po = body.newPose(), N = 720, amp = AMP(speed), stride = strideOf(speed, climb, rig.standH);
  const w = 6.2831853 * speed / stride;           // rad of phase per second
  const foot = (ph) => { // z of the right foot's sole in the pelvis frame and its height (pelvis frame, y up)
    body.pose(po, ph, 0, 1, climb);
    const hip = po.hipR * amp, knee = po.kneeR * amp;
    return { z: rig.Lt * Math.sin(hip) * -1 + -(rig.Ls + rig.sole) * Math.sin(hip + knee), y: -(rig.Lt * Math.cos(hip) + (rig.Ls + rig.sole) * Math.cos(hip + knee)) };
  };
  let worst = 0, n = 0, sum = 0, lo = Infinity;
  const ys = [], zs = [];
  for (let i = 0; i <= N; i++) { const f = foot(i / N * 6.2831853); ys.push(f.y); zs.push(f.z); if (f.y < lo) lo = f.y; }
  for (let i = 1; i < N; i++) {
    if (ys[i] > lo + 0.03) continue;                 // stance only: the foot within 3 cm of its lowest point
    const dz = (zs[i + 1] - zs[i - 1]) / (2 * 6.2831853 / N) * w; // m/s of the foot in the body frame (forward is +z, the body moves +z, so a planted foot moves at -speed)
    const slip = Math.abs(dz + speed) / speed; worst = Math.max(worst, slip); sum += slip; n++;
  }
  return { mean: n ? sum / n : NaN, worst, samples: n };
}
