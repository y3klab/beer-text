// Physics tests: run with `node --test`. SIM points at the module under test so the same suite
// can be fired at an older copy (it must fail there for the stability case to mean anything).
import test from 'node:test';
import assert from 'node:assert/strict';

const SIM = process.env.BEER_TEXT_SIM || '../src/physics.js';
const { createPourSim, calibratePour } = await import(new URL(SIM, import.meta.url));

function geo(H, Wg, head) {
  const headT = head * H;
  return { H, Wg, hFinal: H - headT, headT };
}

function run(g) {
  const sim = createPourSim(g, calibratePour(g));
  let maxAbs = 0;
  while (sim.t < 14 && (sim.pouring || sim.t - sim.stopT < 3)) {
    sim.advanceTo(sim.t + 0.05);
    for (let j = 0; j < sim.N; j++) maxAbs = Math.max(maxAbs, Math.abs(sim.h[j]));
  }
  let dry = 0;
  for (let j = 0; j < sim.N; j++) dry += sim.dry[j];
  return { sim, maxAbs, dry: dry / sim.N };
}

const cases = {
  'wide homepage title (1108 x 480)': geo(480, 1108, 0.2),
  'one line, phone width (339 x 120)': geo(120, 339, 0.27),
  'square glass (200 x 200)': geo(200, 200, 0.27),
  'tall narrow word (60 x 200)': geo(200, 60, 0.27),
  'single letter (25 x 180)': geo(180, 25, 0.27)
};

for (const [name, g] of Object.entries(cases)) {
  test(`${name}: stays stable, stops pouring, lands on its marks`, () => {
    const { sim, maxAbs, dry } = run(g);
    assert.ok(Number.isFinite(maxAbs) && maxAbs < 0.05 * g.H, `surface waves stay small (max ${maxAbs.toFixed(3)} px vs H ${g.H})`);
    assert.equal(sim.pouring, false, 'the pour stops');
    assert.ok(Math.abs(sim.hl - g.hFinal) < 0.03 * g.H, `liquid lands at its final level (${sim.hl.toFixed(1)} vs ${g.hFinal.toFixed(1)})`);
    assert.ok(Math.abs(dry - 1.12 * g.headT) < 0.08 * g.headT, `settled head on target (${dry.toFixed(1)} vs ${(1.12 * g.headT).toFixed(1)})`);
  });
}
