// Records the demo's hero pour to demo/pour.gif, the animation at the top of the README, in headless Chrome
// over CDP. Needs the repo root served at http://127.0.0.1:8830 (python3 -m http.server 8830) and ffmpeg on
// the PATH. No npm dependencies: Node 22+ for fetch and WebSocket.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const URL_ = process.env.GIF_URL || 'http://127.0.0.1:8830/demo/';
const OUT = resolve(here, '../demo/pour.gif');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const W = 960, H = 720;
const PORT = 9336;
const FPS = 25;
// How long the settled pint stays on screen after the pour, carbonation still rising, before the GIF loops.
const TAIL = Number(process.env.GIF_TAIL || 1500);
const PAD = 20;
// The faces the hero uses; a fallback face is a different heading, so the recording refuses.
const FACES = ['Anton'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'beer-text-gif-'));
const frames = mkdtempSync(join(tmpdir(), 'beer-text-gif-frames-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--hide-scrollbars', '--no-first-run',
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
try {
  let up = false;
  for (let i = 0; i < 50 && !up; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); up = true; } catch { await sleep(200); } }
  if (!up) throw new Error(`Chrome did not open its debugging port (${CHROME})`);
  const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(tgt.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map(); const events = [];
  const shots = []; let t0 = Infinity;
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); return; }
    if (d.method === 'Page.screencastFrame') {
      // Every painted frame arrives with its own timestamp; each one must be acknowledged or the stream stops.
      ws.send(JSON.stringify({ id: ++id, method: 'Page.screencastFrameAck', params: { sessionId: d.params.sessionId } }));
      const f = join(frames, `f${String(shots.length).padStart(5, '0')}.png`);
      writeFileSync(f, Buffer.from(d.params.data, 'base64'));
      shots.push({ f, t: d.params.metadata.timestamp * 1000 - t0 });
    } else if (d.method) events.push(d.method);
  };
  const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; pend.set(i, (d) => d.error ? j(new Error(`${method}: ${d.error.message}`)) : r(d.result)); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`in page: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  };

  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL_ });
  for (let i = 0; i < 100 && !events.includes('Page.loadEventFired'); i++) await sleep(100);
  if (!events.includes('Page.loadEventFired')) throw new Error(`${URL_} did not finish loading; is the server up?`);

  // document.fonts.check() answers true for a family the page never declared, so ask the face itself.
  const loaded = await evaluate(`(async () => {
    await document.fonts.ready;
    await Promise.all(${JSON.stringify(FACES)}.map((f) => document.fonts.load('16px "' + f + '"').catch(() => [])));
    const faces = [...document.fonts];
    return ${JSON.stringify(FACES)}.filter((f) => faces.some((x) => x.family.replace(/^["']|["']$/g, '') === f && x.status === 'loaded'));
  })()`);
  const missing = FACES.filter((f) => !loaded.includes(f));
  if (missing.length) throw new Error(`font(s) did not load: ${missing.join(', ')}; refusing to record a fallback face`);

  // Let the load-time pour and the page's entrance animations finish, so the recording starts from a still page.
  let settled = false;
  for (let i = 0; i < 150 && !settled; i++) { await sleep(100); settled = await evaluate(`document.getElementById('status').dataset.state === 'settled'`); }
  if (!settled) throw new Error('the first pour never settled within 15 s');
  await sleep(500);
  // The heading box spans the whole column; crop to its letters (its text node), keeping the box's line height.
  const r = await evaluate(`(() => {
    const h = document.getElementById('hero'), b = h.getBoundingClientRect();
    const t = [...h.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
    const g = document.createRange(); g.selectNodeContents(t); const k = g.getBoundingClientRect();
    return { x: k.left, y: b.top, w: k.width, h: b.height };
  })()`);
  if (!(r.w > 100 && r.h > 40)) throw new Error(`the hero heading is ${r.w} x ${r.h}; refusing to record`);
  // Even dimensions keep ffmpeg's scaler exact.
  const clip = { x: Math.max(0, Math.floor(r.x - PAD)), y: Math.max(0, Math.floor(r.y - PAD)) };
  clip.width = Math.min(W - clip.x, Math.ceil(r.w + 2 * PAD)) & ~1;
  clip.height = Math.min(H - clip.y, Math.ceil(r.h + 2 * PAD)) & ~1;

  // The Pour again button, not a click on the title, so the title takes no focus ring.
  await send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  await sleep(300);
  t0 = await evaluate(`performance.timeOrigin + performance.now()`);
  await evaluate(`document.getElementById('replay').click()`);
  for (let i = 0; !await evaluate(`document.getElementById('status').dataset.state === 'settled'`); i++) {
    if (i > 200) throw new Error('the pour did not settle within 20 s of Pour again');
    await sleep(100);
  }
  await sleep(TAIL);
  await send('Page.stopScreencast');
  await sleep(200);
  // The stream sends a frame only when something paints, so the last frame before the click opens the GIF.
  const before = shots.filter((x) => x.t <= 0).at(-1);
  shots.splice(0, shots.length, ...(before ? [{ ...before, t: 0 }] : []), ...shots.filter((x) => x.t > 0));
  if (shots.length < 40) throw new Error(`only ${shots.length} frames captured; is the screencast running?`);

  // Each frame shows until the next one was taken: ffmpeg's concat demuxer with per-frame durations.
  const list = shots.map((s, i) => `file '${s.f}'\nduration ${(((shots[i + 1]?.t ?? s.t + 1000 / FPS) - s.t) / 1000).toFixed(3)}`).join('\n') + `\nfile '${shots.at(-1).f}'\n`;
  writeFileSync(join(frames, 'list.txt'), list);
  const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(frames, 'list.txt'),
    '-vf', `crop=${clip.width}:${clip.height}:${clip.x}:${clip.y},fps=${FPS},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
    '-loop', '0', OUT], { stdio: 'inherit' });
  if (ff.error) throw new Error(`ffmpeg did not run: ${ff.error.message}`);
  if (ff.status !== 0) throw new Error(`ffmpeg exited ${ff.status}`);
  const kb = Math.round(statSync(OUT).size / 1024);
  console.log(`wrote ${OUT} (${clip.width} x ${clip.height}, ${shots.length} frames over ${(shots.at(-1).t / 1000).toFixed(1)} s, ${kb} KB, fonts: ${loaded.join(', ')})`);
  ws.close();
} finally {
  // Chrome keeps writing its profile for a moment after SIGTERM; wait for it to exit before removing the directory.
  const gone = new Promise((r) => chrome.once('exit', r));
  chrome.kill();
  await Promise.race([gone, sleep(5000)]);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  rmSync(frames, { recursive: true, force: true });
}
