/* beer-text physics: a 1D shallow-water surface, a pour that fills by volume, and a foam layer that
   the stream makes, that spreads, partly collapses, and drains back into the beer. Pure math, no DOM:
   geometry in, state out, so it runs the same in the browser and in Node tests.
   Time is compressed: a real head takes minutes to settle, this one about a second (same shape of decay).
   geo: { H: glass height px, Wg: glass width px, hFinal: final liquid height px, headT: final head px } */
export function createPourSim(geo, tune) {
  // Bad geometry would make the step count infinite or NaN and hang the page: refuse it.
  if (!(geo.H > 0 && geo.Wg > 0 && geo.hFinal > 0 && geo.headT >= 0) || ![geo.H, geo.Wg, geo.hFinal, geo.headT].every(isFinite)) throw new RangeError('beer-text physics: geometry needs finite H, Wg, hFinal > 0 and headT >= 0');
  var N = 48, DT = 1 / 480;
  var H = geo.H, dx = geo.Wg / (N - 1);
  var g = 9.81 * (H / 0.15);                     // the glass height stands for a 15 cm pint
  var ip = Math.round((N - 1) * 0.28);           // the stream lands a third of the way in, poured against the wall
  // Foam spreading (px^2/s), in 4 sub-steps to stay stable. Per sub-step k = (N-1)^2 * DT / 42 = 0.44 < 0.5,
  // whatever the glass size, because dx scales with Wg; it only breaks if N or DT change.
  var SPREAD_SUB = 4, D = SPREAD_SUB * geo.Wg * geo.Wg / 10.5;
  // Waves: wave speed * step / column width must stay under 1 or the surface blows up. A wide title
  // runs well under it in one step; a narrow, tall glass (one letter) needs the wave step split.
  var WAVE_SUB = Math.max(1, Math.ceil(Math.sqrt(g * Math.max(geo.hFinal, 0.02 * H)) * DT / dx / 0.5));
  if (WAVE_SUB > 1000) throw new RangeError('beer-text physics: glass too narrow for its height');
  var TAU_WET = 1.3, DRAIN = 0.25, WET = 0.35;   // wet foam collapses; a quarter of it drains back as beer
  var QMAX = geo.hFinal / 4.2, EASE = 0.12 * geo.hFinal;
  var kappa = tune.kappa, beta = tune.beta;

  var kickShape = new Float64Array(N), foamShape = new Float64Array(N), sum = 0, i;
  for (i = 0; i < N; i++) {
    kickShape[i] = Math.exp(-Math.pow((i - ip) / 1.6, 2));
    foamShape[i] = Math.exp(-Math.pow((i - ip) / (0.6 * (N - 1)), 2));   // foam forms across most of the surface, a little more under the stream
    sum += foamShape[i];
  }
  for (i = 0; i < N; i++) foamShape[i] *= N / sum;     // mean deposit equals the source rate

  var s = {
    t: 0, hl: 0, Q: 0, pouring: true, stopT: Infinity, haze: 0, maxWave: 0,
    h: new Float64Array(N), v: new Float64Array(N), wet: new Float64Array(N), dry: new Float64Array(N),
    N: N, ip: ip, QMAX: QMAX
  };
  var acc = new Float64Array(N), nWet = new Float64Array(N), nDry = new Float64Array(N);

  function smoothstep(a, b, x) { var t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

  function step() {
    var t = s.t, j;
    // Pour control: stop when the beer plus what the wet foam will drain reaches the final level.
    var pending = 0;
    for (j = 0; j < N; j++) pending += s.wet[j];
    var remaining = geo.hFinal - (s.hl + DRAIN * pending / N);
    if (s.pouring) {
      var ramp = smoothstep(0, 0.3, t);
      s.Q = QMAX * ramp * Math.min(1, Math.max(0.18, remaining / EASE));
      if (remaining <= 0) { s.pouring = false; s.stopT = t; s.Q = 0; }
    } else s.Q = 0;
    s.hl += s.Q * DT;

    // Surface: linear shallow-water waves, speed sqrt(g * depth), reflective walls, foam damps.
    var c2 = g * Math.max(s.hl, 0.02 * H);
    var fall = Math.max(0, H - s.hl + 0.15 * H);   // the stream falls from just above the rim
    // A real stream breaks up and splashes, so its push on the surface flickers; a steady push would only dent it.
    var flicker = 0.55 + 0.45 * Math.sin(2 * Math.PI * 5.3 * t) + 0.3 * Math.sin(2 * Math.PI * 8.9 * t + 1) + 0.2 * Math.sin(2 * Math.PI * 13.7 * t + 2);
    var kick = kappa * s.Q * Math.sqrt(2 * g * fall) * Math.max(0, flicker);
    var dtw = DT / WAVE_SUB;
    for (var w = 0; w < WAVE_SUB; w++) {
      for (j = 0; j < N; j++) {
        var l = j ? s.h[j - 1] : s.h[j], r = j < N - 1 ? s.h[j + 1] : s.h[j];
        var damp = 1.5 + 4 * (s.wet[j] + s.dry[j]) / H;
        acc[j] = c2 * (l - 2 * s.h[j] + r) / (dx * dx) - damp * s.v[j] + kick * kickShape[j];
      }
      var mean = 0;
      for (j = 0; j < N; j++) { s.v[j] += acc[j] * dtw; s.h[j] += s.v[j] * dtw; mean += s.h[j]; }
      mean /= N;
      for (j = 0; j < N; j++) s.h[j] -= mean;
    }
    if (t < 1.5) for (j = 0; j < N; j++) s.maxWave = Math.max(s.maxWave, Math.abs(s.h[j]));

    // Foam: made at the impact (more as the glass is straightened near the end), spreads, wet part collapses.
    var weight = 0.3 + 0.7 * smoothstep(0.55, 0.9, s.hl / geo.hFinal);
    var src = beta * s.Q * Math.sqrt(fall / H) * weight, drained = 0;
    for (j = 0; j < N; j++) {          // made and collapsing
      var collapse = s.wet[j] / TAU_WET;
      s.wet[j] = Math.max(0, s.wet[j] + (WET * src * foamShape[j] - collapse) * DT);
      s.dry[j] = Math.max(0, s.dry[j] + (1 - WET) * src * foamShape[j] * DT);
      drained += collapse;
    }
    var sub = DT / SPREAD_SUB, k = D * sub / (dx * dx);
    for (var r = 0; r < SPREAD_SUB; r++) {   // spreading sideways
      for (j = 0; j < N; j++) {
        var wl = j ? s.wet[j - 1] : s.wet[j], wr = j < N - 1 ? s.wet[j + 1] : s.wet[j];
        var dl = j ? s.dry[j - 1] : s.dry[j], dr = j < N - 1 ? s.dry[j + 1] : s.dry[j];
        nWet[j] = s.wet[j] + k * (wl - 2 * s.wet[j] + wr);
        nDry[j] = s.dry[j] + k * (dl - 2 * s.dry[j] + dr);
      }
      for (j = 0; j < N; j++) { s.wet[j] = nWet[j]; s.dry[j] = nDry[j]; }
    }
    s.hl += DRAIN * drained / N * DT;

    // Entrained air near the impact: clouds while pouring, clears after.
    s.haze += (s.Q / QMAX - s.haze) * DT / (s.Q > 0 ? 0.35 : 0.9);
    s.t += DT;
  }

  // At most 60 s of simulated time per call (a full pour takes under 14): a far-off or non-finite target would never return.
  s.advanceTo = function (T) { if (!(T - s.t <= 60)) throw new RangeError('beer-text physics: advanceTo(' + T + ') is too far ahead'); while (s.t + DT <= T) step(); return s; };
  s.DT = DT;
  return s;
}

// Calibrate wave strength and foam production for this glass so the first waves reach about 1.6% of H
// and the settled head ends just above the glyph tops. Both are linear in their knob, so two passes suffice.
export function calibratePour(geo) {
  var tune = { kappa: 1, beta: 1 };
  for (var pass = 0; pass < 2; pass++) {
    var sim = createPourSim(geo, tune);
    // maxWave is measured before 1.5 s and the dry-foam total stops changing when the pour stops
    // (spreading conserves it), so there is nothing to learn after that; 14 s is only a safety cap.
    while (sim.t < 14 && (sim.pouring || sim.t < 1.5)) sim.advanceTo(sim.t + 0.1);
    var dry = 0;
    for (var j = 0; j < sim.N; j++) dry += sim.dry[j];
    dry /= sim.N;
    tune = {
      kappa: tune.kappa * (0.016 * geo.H) / Math.max(1e-9, sim.maxWave),
      beta: tune.beta * (1.12 * geo.headT) / Math.max(1e-9, dry)
    };
  }
  return tune;
}

