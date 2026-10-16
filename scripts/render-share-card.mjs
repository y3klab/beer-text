// Renders demo/share-card.html to demo/share-card.png at exactly 1280 x 640 in headless Chrome over CDP.
// Needs the repo root served at http://127.0.0.1:8830 (python3 -m http.server 8830); the page imports
// ../src/beer-text.js as a module, which file:// cannot do. No dependencies: Node 22+ for fetch and WebSocket.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const URL_ = process.env.SHARE_CARD_URL || 'http://127.0.0.1:8830/demo/share-card.html';
const OUT = resolve(here, '../demo/share-card.png');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const W = 1280, H = 640;
const PORT = 9335;
// The faces the card sets; a fallback for any of them is a different card, so the render refuses.
const FACES = ['Anton', 'Fraunces', 'JetBrains Mono'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'beer-text-share-card-'));
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
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else if (d.method) events.push(d.method); };
  const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; pend.set(i, (d) => d.error ? j(new Error(`${method}: ${d.error.message}`)) : r(d.result)); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`in page: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  };

  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  // Full motion on purpose: with reduced motion the library skips the carbonation, and the card needs its bubbles.
  // autoplay: false still lands on the settled pint; the bubbles then rise over it.
  await send('Page.navigate', { url: URL_ });
  for (let i = 0; i < 100 && !events.includes('Page.loadEventFired'); i++) await sleep(100);
  if (!events.includes('Page.loadEventFired')) throw new Error(`${URL_} did not finish loading; is the server up?`);

  // The fonts: document.fonts.check() answers true for a family the page never declared, so ask the face itself.
  const loaded = await evaluate(`(async () => {
    await document.fonts.ready;
    await Promise.all(${JSON.stringify(FACES)}.map((f) => document.fonts.load('16px "' + f + '"').catch(() => [])));
    const faces = [...document.fonts];
    return ${JSON.stringify(FACES)}.filter((f) => faces.some((x) => x.family.replace(/^["']|["']$/g, '') === f && x.status === 'loaded'));
  })()`);
  const missing = FACES.filter((f) => !loaded.includes(f));
  if (missing.length) throw new Error(`font(s) did not load: ${missing.join(', ')}; refusing to render the card with a fallback face`);

  // The pour: the title's text goes transparent and the overlay svg carries the letter paths.
  let poured = false;
  for (let i = 0; i < 60 && !poured; i++) {
    poured = await evaluate(`(() => { const t = document.getElementById('title'); return getComputedStyle(t).color === 'rgba(0, 0, 0, 0)' && !!t.querySelector('svg[data-beer-text] path[d]'); })()`);
    if (!poured) await sleep(100);
  }
  if (!poured) throw new Error('the title was not poured (no svg[data-beer-text] overlay); refusing to write a card with plain white letters');
  // Time one real pour to its settle, then pour again and capture LEAD ms before the settle: the stream has just
  // stopped, the head's bubbles haven't popped and the carbonation is densest.
  const LEAD = Number(process.env.SHARE_CARD_LEAD || 3200);
  let settled = false;
  for (let i = 0; i < 150 && !settled; i++) { await sleep(100); settled = await evaluate('!!window.settled'); }
  if (!settled) throw new Error('the pour never settled within 15 s');
  const D = await evaluate('window.settled - window.started');
  await evaluate('window.pourOnce()');
  await sleep(Math.max(0, D - LEAD));
  let fizz = 0;
  for (let i = 0; i < 80 && fizz < 40; i++) {
    await sleep(100);
    fizz = await evaluate(`(() => { const c = document.querySelector('#title canvas[data-beer-text]'); if (!c) return 0; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++; return n; })()`);
  }
  if (fizz < 40) throw new Error(`no carbonation on the card (${fizz} bubble pixels after 8 s); refusing to write a flat pint`);

  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
  const png = Buffer.from(shot.data, 'base64');
  // PNG header: width and height are big-endian at bytes 16 and 20.
  const pw = png.readUInt32BE(16), ph = png.readUInt32BE(20);
  if (pw !== W || ph !== H) throw new Error(`screenshot is ${pw} x ${ph}, not ${W} x ${H}`);
  writeFileSync(OUT, png);
  console.log(`wrote ${OUT} (${pw} x ${ph}, fonts: ${loaded.join(', ')})`);
  ws.close();
} finally {
  // Chrome keeps writing its profile for a moment after SIGTERM; wait for it to exit before removing the directory.
  const gone = new Promise((r) => chrome.once('exit', r));
  chrome.kill();
  await Promise.race([gone, sleep(5000)]);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
